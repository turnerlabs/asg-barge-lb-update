var AWS = require('aws-sdk');
var async = require('async');

exports.handler = function(event, context) {
    console.log('ASG Barge ELB Handler at ' + new Date().toUTCString());
    console.log(JSON.stringify(event))
    var asg_msg = JSON.parse(event.Records[0].Sns.Message);
    var asg_name = asg_msg.AutoScalingGroupName;
    var instance_id = asg_msg.EC2InstanceId;
    var asg_event = asg_msg.Event;

    console.log('EVENT=' + asg_event);

    if (asg_event === "autoscaling:EC2_INSTANCE_LAUNCH" || asg_event === "autoscaling:EC2_INSTANCE_TERMINATE") {
        console.log("Handling Launch Event for " + asg_name + ' InstanceID=' + instance_id);

        var elb = new AWS.ELB({region: 'us-east-1'});
        var alb = new AWS.ELBv2({region: 'us-east-1'});
        var route53 = new AWS.Route53();
        var asg_instances;

        async.waterfall([
            function retrieveASGInstances(next) {
                console.log("Retrieving Instances in ASG");
                var autoscaling = new AWS.AutoScaling({region: 'us-east-1'});
                autoscaling.describeAutoScalingGroups({
                  AutoScalingGroupNames: [asg_name],
                  MaxRecords: 1
                }, function(err, data) {
                    next(err, data);
                });
            },

            function retrieveInstanceIds(asgResponse, next) {
                asg_instances = asgResponse.AutoScalingGroups[0] && asgResponse.AutoScalingGroups[0].Instances.map(function(instance) {
                    return instance.InstanceId
                });
                console.log('INSTANCE IDS:' + JSON.stringify(asg_instances));
                var lbData = [];
                getLbs(lbData);

                function getLbs(lbData, nextMarker) {
                  elb.describeLoadBalancers({
                      PageSize: 400,
                      Marker: nextMarker
                  }, function(err, data) {
                    lbData = lbData.concat(data.LoadBalancerDescriptions);
                    if (data.NextMarker) {
                        console.log('getting next marker', data.NextMarker);
                        getLbs(lbData, data.NextMarker)
                    } else {
                        console.log("length of all the elbs", lbData.length)
                        getAlbs(lbData);
                    }
                  });
                }

                function getAlbs(lbData, nextMarker) {
                  alb.describeTargetGroups({
                      PageSize: 400,
                      Marker: nextMarker
                  }, function(err, data) {
                      lbData = lbData.concat(data.TargetGroups.map(function(_data) {
                          _data.isAsg = true;
                          return _data;
                      }));
                      if (data.NextMarker) {
                          console.log('getting next marker for asg', data.NextMarker);
                          getAlbs(lbData, data.NextMarker)
                      } else {
                          console.log("length of all the lbs", lbData.length)
                          next(err, lbData);
                      }
                  })
                }
            },

            function findASGLoadBalancers(elbdata, next) {
                var all_elbs = elbdata.map(function(e){
                    var elb = [];
                    e.Instances = e.Instances || [];
                    elb[0] = e.LoadBalancerName || e.TargetGroupName;
                    elb[1] = e.Instances.map(function(i){return i.InstanceId});
                    elb[2] = e.TargetGroupArn;
                    return elb;
                });

                var barge_elbs = all_elbs.filter(function(e) {


                    // check for k8s- in lb names
                    // if there is no e[1] then it is an alb
                    if (e[1].length === 0) {
                        if (e[0].includes('k8s-') || e[0].includes('k8sing-')) {
                            return true;
                        } else {
                            return false;
                        }
                    }

                    for (elbinstance in e[1]){
                        if(asg_instances && asg_instances.indexOf(e[1][elbinstance]) > -1){
                            return true;
                        }
                    }

                    return false;
                }).map(function(e) {
                    if (!e[2]) {
                        return e[0];
                    } else {
                        return {
                          name: e[0],
                          arn: e[2]
                        }
                    }
                });

                var nextrun = Date.now();
                var increment = 100;

                var schedule_task = function(task, callback, p1, p2, p3){
                    var schedule = (nextrun+=increment) - Date.now();
                    if(schedule < 0) schedule = 0;
                    setTimeout(function(){callback(p1, p2, p3)}, schedule);
                };

                var todo = barge_elbs.length;
                console.log('Updating ' + todo + ' ELB-s');

                for(barge_elb in barge_elbs){
                    schedule_task({name: 'job_'+barge_elb}, runner, barge_elb);
                }

                function runner(b) {
                    if(asg_event === "autoscaling:EC2_INSTANCE_TERMINATE") {

                        if (typeof barge_elbs[b] === 'string') {
                            elb.deregisterInstancesFromLoadBalancer({
                              LoadBalancerName: barge_elbs[b],
                              Instances: [{InstanceId: instance_id }]
                            }, awsCallback(b));
                        } else {
                            alb.deregisterTargets({
                              TargetGroupArn: barge_elbs[b].arn,
                              Targets: [{Id: instance_id}]
                            }, awsCallback(b));
                        }

                    } else if(asg_event === "autoscaling:EC2_INSTANCE_LAUNCH") {
                        if (typeof barge_elbs[b] === 'string') {
                            elb.registerInstancesWithLoadBalancer({
                              LoadBalancerName: barge_elbs[b],
                              Instances: [{InstanceId: instance_id }]
                            }, awsCallback(b));
                        } else {

                          alb.describeTargetHealth({
                                TargetGroupArn: barge_elbs[b].arn
                              }, function(err, targetData) {

                                 var targetInstances = targetData.TargetHealthDescriptions.map(function(instance) {
                                     return instance.Target.Id;
                                 }),
                                 shouldCheck = false;

                                for (var i in targetInstances) {
                                    if(asg_instances && asg_instances.indexOf(targetInstances[i]) > -1){
                                        shouldCheck = true;
                                    }
                                }

                                if (shouldCheck === false) {
                                    todo -= 1;
                                    return false;
                                }

                                console.log("Registering", instance_id, "with", barge_elbs[b].arn);

                                alb.registerTargets({
                                  TargetGroupArn: barge_elbs[b].arn,
                                  Targets: [{Id: instance_id}]
                                }, awsCallback(b));
                          });
                        }
                    }
                }

                function awsCallback(b) {
                    return function(err, data) {
                        if (err) {
                            if(err.code === 'Throttling') {
                                console.log('Retrying ' + barge_elbs[b], barges_elbs[b]);
                                schedule_task({name: 'job_'+b}, runner, b);
                            } else {
                                // should throw into a deadletter queue so we can reprocess (jkurz)
                                context.fail(err);
                                return;
                            }
                        } else {
                            todo -= 1;
                            if(todo === 0){
                                context.succeed('OK');
                            }
                        }
                    }
                }
            },

        ], function (err) {
              if (err) {
                console.error('Failed to process DNS updates for ASG event: ', err);
              } else {
                console.log("Successfully processed DNS updates for ASG event.");
              }
            })
    } else {
        console.log("Unsupported ASG event: " + asg_name, asg_event);
        context.done("Unsupported ASG event: " + asg_name, asg_event);
    }
};
