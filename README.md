# asg-barge-lb-update

This lambda is supposed to be set up with an asg group, which will fire when an instance
is either Termindate or Launched. The lambda will run through the asg and all the elbs in the
account. It will update each lb that should be attached to the correct instances in the ASG group.

### How To Update The Lambda

``` shell
zip -r lambda.zip . -x *.git*
aws lambda update-function-code --function-name $FUNCTION_NAME --zip-file fileb://lambda.zip
```


### Sample JSON Payload

This is what can be used to test the lambda. It will crawl all the elbs, but it will not update anything.

``` JSON
{
	"Records": [{
		"EventSource": "aws:sns",
		"EventVersion": "1.0",
		"EventSubscriptionArn": "foobarArn",
		"Sns": {
			"Type": "Notification",
			"MessageId": "1",
			"TopicArn": "fooBarArn2",
			"Subject": "Auto Scaling: launch for group \"the-best-group\"",
			"Message": "{\"Progress\":50,\"AccountId\":\"hehe\",\"Description\":\"Launching a new EC2 instance: i-ffff\",\"RequestId\":\"foobar\",\"EndTime\":\"2017-06-02T18:40:48.198Z\",\"AutoScalingGroupARN\":\"fooBarBar\",\"ActivityId\":\"aaa\",\"StartTime\":\"2017-06-02T18:40:15.965Z\",\"Service\":\"AWS Auto Scaling\",\"Time\":\"2017-06-02T18:40:48.198Z\",\"EC2InstanceId\":\"lololol\",\"StatusCode\":\"InProgress\",\"StatusMessage\":\"\",\"Details\":{\"Subnet ID\":\"subnet-ffssddd\",\"Availability Zone\":\"us-east-1b\"},\"AutoScalingGroupName\":\"the-asg\",\"Cause\":\"At 2017-06-02T18:40:14Z an instance was started in response to a difference between desired and actual capacity, increasing the capacity from 3 to 4.\",\"Event\":\"autoscaling:EC2_INSTANCE_TERMINATE\"}",
			"Timestamp": "2017-06-02T18:40:48.220Z",
			"SignatureVersion": "1",
			"Signature": ":)",
			"SigningCertUrl": "haha",
			"UnsubscribeUrl": "tester",
			"MessageAttributes": {}
		}
	}]
}
```
