import json
import socket

from types import SimpleNamespace
from google.auth.transport.requests import AuthorizedSession
from google.oauth2.service_account import Credentials

#/******* BEGIN: Customer to modify this section *******/
#Add service account key json file.
service_account_key_path = ""
#Add the customer id here. You can find the customer Id by navigating to the Google Admin Console > Account > Account Settings.
customerId = ""
#Add the destination OU path. An example of the destination OU path 'North America/Austin/AUS Managed User'
destinationOrgUnitPath = ""
#/******* END: Customer to modify this section *******/

machineName = socket.gethostname()

service_account_info = json.load(open(service_account_key_path))

credentials = Credentials.from_service_account_info(
      service_account_info,
      scopes=[
          'https://www.googleapis.com/auth/admin.directory.device.chromebrowsers'
      ])


chromeBrowserServiceUrl = "https://www.googleapis.com/admin/directory/v1.1beta1/customer/{0}/devices/chromebrowsers?query=machine_name:{1}&projection=BASIC".format(customerId, machineName)

response = AuthorizedSession(credentials).request(
    "GET",
    chromeBrowserServiceUrl
)

browserdevices = json.loads(response._content.decode("utf-8"), object_hook=lambda d: SimpleNamespace(**d))
browser = browserdevices.browsers[0]

payload = '{"org_unit_path":"' + destinationOrgUnitPath + '","resource_ids":["' + browser.deviceId + '"]}'
headers = {'Content-Type': 'application/json'}
moveChromeBrowsersToOuServiceUrl = "https://www.googleapis.com/admin/directory/v1.1beta1/customer/{0}/devices/chromebrowsers/moveChromeBrowsersToOu".format(customerId)

response = AuthorizedSession(credentials).request(
        method="POST", 
        headers=headers, 
        url=moveChromeBrowsersToOuServiceUrl,
        data=payload,
    )
print("Move browser to OU: ", response.status_code)
print(response._content.decode("utf-8"))
