var AWS = require('aws-sdk');
var async = require('async');

exports.handler = function(event, context) {
    console.log('ASG Barge ELB Handler at ' + new Date().toUTCString());
    console.log(JSON.stringify(event))
    var asg_msg = JSON.parse(event.Records[0].Sns.Message);
//    var asg_msg = JSON.parse(event.Message);
    var asg_name = asg_msg.AutoScalingGroupName;
    var instance_id = asg_msg.EC2InstanceId;
    var asg_event = asg_msg.Event;

    console.log('EVENT=' + asg_event);

    if (asg_event === "autoscaling:EC2_INSTANCE_LAUNCH" || asg_event === "autoscaling:EC2_INSTANCE_TERMINATE") {
        console.log("Handling Launch Event for " + asg_name + ' InstanceID=' + instance_id);

        var elb = new AWS.ELB({region: 'us-east-1'});
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
//                  console.log('retrieveASGInstances: ' + JSON.stringify(data));
                  next(err, data);
                });
            },

            function retrieveInstanceIds(asgResponse, next) {
                asg_instances = asgResponse.AutoScalingGroups[0].Instances.map(function(instance) {
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
                    if (data.nextMarker) {
                        console.log('getting next marker', data.nextMarker);
                        getLbs(lbData, data.nextMarker)
                    } else {
                        next(err, lbData);
                    }
                  });
                }
            },

            function findASGLoadBalancers(elbdata, next){
                var all_elbs = elbdata.map(function(e){
                    var elb = [];
                    elb[0] = e.LoadBalancerName;
                    elb[1] = e.Instances.map(function(i){return i.InstanceId});
                    return elb;
                });
//                console.log(all_elbs);
                var barge_elbs = all_elbs.filter(function(e){
                    for (elbinstance in e[1]){
                        if(asg_instances.indexOf(e[1][elbinstance]) > -1){
                            return true;
                        }
                    }
                    return false;
                }).map(function(e){return e[0]});
                console.log(barge_elbs);
//                instance_id =  'i-2ed2029d';

                var nextrun = Date.now();
                var increment = 100;

                var schedule_task = function(task, callback, p1, p2, p3){
                    var schedule = (nextrun+=increment) - Date.now();
//                    console.log('nextrun=' + nextrun + ' schedule=' + schedule);
                    if(schedule < 0) schedule = 0;
                    setTimeout(function(){callback(p1, p2, p3)}, schedule);
                };

                var todo = barge_elbs.length;
                console.log('Updating ' + todo + ' ELB-s');

                var runner = function(b){
                    if(asg_event === "autoscaling:EC2_INSTANCE_TERMINATE"){
                        elb.deregisterInstancesFromLoadBalancer({LoadBalancerName: barge_elbs[b], Instances: [{InstanceId: instance_id }]}, function(err, data){
                            if(err) {
                                if(err.code === 'Throttling'){
                                    console.log('Retrying ' + barge_elbs[b]);
                                    schedule_task({name: 'job_'+b}, runner, b);
                                }
                                else {
                                    context.fail(err);
                                }
                            }
                            else {
                                todo -= 1;
                                if(todo === 0){
                                    context.succeed('OK');
                                }
                            }
                        });
                    }
                    else if(asg_event === "autoscaling:EC2_INSTANCE_LAUNCH"){
                        elb.registerInstancesWithLoadBalancer({LoadBalancerName: barge_elbs[b], Instances: [{InstanceId: instance_id }]}, function(err, data){
                            if(err) {
                                if(err.code === 'Throttling'){
                                    console.log('Retrying ' + barge_elbs[b]);
                                    schedule_task({name: 'job_'+b}, runner, b);
                                }
                                else {
                                    context.fail(err);
                                }
                            }
                            else {
                                todo -= 1;
                                if(todo === 0){
                                    context.succeed('OK');
                                }
                            }
                        });
                    }
                };

                for(barge_elb in barge_elbs){
                    schedule_task({name: 'job_'+barge_elb}, runner, barge_elb);
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
