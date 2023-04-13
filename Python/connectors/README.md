# Adding Chrome Browser Cloud Management remediation actions in Splunk using Alert Actions

## Setup
Open the `$SPLUNK_HOME/etc/apps/appname/appserver/static/` directory and place an image for the app icon within the directory. This should be a png file with size 48x48 pixel. In our example the appname is `cbcm` hence the directory path will be `$SPLUNK_HOME/etc/apps/cbcm/default/`. We have named the file as app_icon.png in our example. Any custom name can be used to name the png file.

Open the `$SPLUNK_HOME/etc/apps/cbcm/default/` directory and create a file called `alert_actions.conf` with the following text.
```
[cbcm]
is_custom = 1
label = CBCM Remediation
description = Move browser to restricted OU
icon_path = app_icon.png
payload_format = json
```
Please note we have mentioned the root as `[cbcm]` in our case. This root value has to correspond to the name of the python script and html files.

In the `$SPLUNK_HOME/etc/apps/cbcm/default/` directory update the [install] section of the file called `app.conf` with the following text. Keep the other sections unchanged.
```
[install]
is_configured = 1
state = enabled
```

Open the `$SPLUNK_HOME/etc/apps/cbcm/default/data/ui/alerts` directory (create the directory if it does not exist) and create a file called `cbcm.html`. The filename of the html file corresponds to the root element of the `alert_actions.conf` file as stated above.
```html
<form class="form-horizontal form-complex">
 <div class="control-group">
       <label class="control-label" for="ou_path">Destination OU Path</label>


       <div class="controls">
           <input type="text" name="action.cbcm.param.oupath" id="ou_path" />
           <span class="help-block">
             The path of the destination OU.
           </span>
       </div>
   </div>
 <div class="control-group">
       <label class="control-label" for="cust_id">Customer Id</label>


       <div class="controls">
           <input type="text" name="action.cbcm.param.custid" id="cust_id" />
           <span class="help-block">
             The Id of the customer domain.
           </span>
       </div>
   </div>
 <div class="control-group">
       <label class="control-label" for="service_key_json">Service Key JSON</label>


       <div class="controls">
           <textarea name="action.cbcm.param.servicekey" id="service_key_json" />
           <span class="help-block">
               The service account key in JSON format.
               <a href="https://cloud.google.com/iam/docs/keys-create-delete#creating" target="_blank"
                  title="Google help">Learn More <i class="icon-external"></i></a>
           </span>
       </div>
   </div>
</form>
```
Please note that the names of the various input elements in the html file (for e.g. `action.cbcm.param.custid`) have to correspond to the values specified in the `savedsearches.conf`.spec file.

Open the `$SPLUNK_HOME/etc/apps/cbcm/` directory and create a file called `cbcm.py`.The filename of the python file corresponds to the root element of the `alert_actions.conf` file
```python
import os
import logging
import sys
import requests
import json
import logging.handlers
from google.auth.credentials import with_scopes_if_required
from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account

def setup_logger(level):
    logger = logging.getLogger("cbcm_alert_logger")
    logger.propagate = False
    logger.setLevel(level)
    file_handler = logging.handlers.RotatingFileHandler(os.environ['SPLUNK_HOME'] + '/var/log/splunk/cbcm_alert.log',maxBytes=2500000,backupCount=5)
    formatter = logging.Formatter('%(asctime)s %(levelname)s %(message)s')
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)
    return logger
    
logger = setup_logger(logging.INFO)
    
def move2ouMB(config, device_id):
    oupath = config.get('oupath')
    custid = config.get('custid')
    servicekey = json.loads(config.get('servicekey'))
    credentials = service_account.Credentials.from_service_account_info(servicekey)
    credentials = with_scopes_if_required(credentials,\
					["https://www.googleapis.com/auth/admin.directory.device.chromebrowsers"],)
    response = AuthorizedSession(credentials).request("POST",
            	'https://www.googleapis.com/admin/directory/v1.1beta1/customer/{0}/devices/chromebrowsers/moveChromeBrowsersToOu'.format(custid),\
		data=json.dumps({"org_unit_path": oupath,\
		"resource_ids": [device_id]}))
    logger.info("response code: {0}".format(response.status_code))
    logger.info("response: {0}".format(response._content.decode("utf-8")))

def move2ouMD(config, device_id):
    oupath = config.get('oupath')
    custid = config.get('custid')
    servicekey = json.loads(config.get('servicekey'))
    credentials = service_account.Credentials.from_service_account_info(servicekey)
    credentials = with_scopes_if_required(credentials,\
					["https://www.googleapis.com/auth/admin.directory.device.chromeos"],)
    response = AuthorizedSession(credentials).request("POST",
            	'https://admin.googleapis.com/admin/directory/v1/customer/{0}/devices/chromeos/moveDevicesToOu?orgUnitPath={1}'.format(custid,oupath),\
		data=json.dumps({"deviceIds": [device_id]}))
    logger.info("response code: {0}".format(response.status_code))
    logger.info("response: {0}".format(response._content.decode("utf-8")))


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--execute":
        payload = json.loads(sys.stdin.read())
        logger.info(payload.get('result'))
        config = payload.get('configuration')
        event = payload.get('result')
        if event.get('client_type') == 'CHROME_BROWSER':
            move2ouMB(config, event.get('directory_device_id')) 
        elif event.get('client_type') == 'CHROME_OS_DEVICE':
            move2ouMD(config, event.get('directory_device_id'))
        else:
            logger.info("Unknown Client Type")    
if __name__ == "__main__":
    main()
```
In the '$SPLUNK_HOME/etc/apps/cbcm/bin/' directory manually copy the python dependencies. The bin directory should look something like below once all dependencies have been copied.
- [ ] bin
  - [X] pyasn1
  - [X] pyasn1-modules
  - [X] rsa
  - [X] cachetools
  - [x] google-auth
  - [ ] cbcm.py
  - [ ] README

Open the `$SPLUNK_HOME/etc/apps/cbcm/README/` directory (create the directory if it does not exist) and create a file called `savedsearches.conf.spec`.
```
action.cbcm.param.oupath = <string>
action.cbcm.param.custid = <string>
action.cbcm.param.servicekey = <string>
```
The line items correspond to the html input elements of cbcm.html

Open the `$SPLUNK_HOME/etc/apps/cbcm/metadata/` directory (create the directory if it does not exist) and add the below lines to the `default.meta` file.
```
[alert_actions]
export = system

[alerts]
export = system

[restmap]
export = system
```
Restart the Splunk Enterprise instance.
