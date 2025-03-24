# cbcm-browser-basic-export

#Libraries and Dependencies
#pip install google-api-python-client
#pip install google-auth
#pip install google-auth-oauthlib
#pip install google-auth-httplib2
#pip install urllib3

import csv
import json

from google.oauth2 import service_account

from google.auth.transport.requests import AuthorizedSession
from google.oauth2.service_account import Credentials
from urllib.parse import urlparse, parse_qs, parse_qsl, urlencode
from string import Template

#/******* BEGIN: Customer to modify this section *******/
#Add service account key json file.
SERVICE_ACCOUNT_KEY_PATH = ''
#Add the customer id here. You can find the customer Id by navigating to the Google Admin Console > Account > Account Settings.
CUSTOMER_ID = ""
#Add OU path. An example of the destination OU path 'North America/Austin/AUS Managed User'
ORG_UNIT_PATH = ""
# CSV Filename
CSV_FILENAME = "cbcm-browser-basic-export.csv"
#/******* END: Customer to modify this section *******/   


#/***** Get authorization token *****/
def create_authToken():
    service_account_info = json.load(open(SERVICE_ACCOUNT_KEY_PATH))

    credentials = Credentials.from_service_account_info(
        service_account_info,
        scopes=[
          'https://www.googleapis.com/auth/admin.directory.device.chromebrowsers.readonly'])
    
    return AuthorizedSession(credentials)

#/***** Modify the query string. *****/
def patch_url(url, **kwargs):
    return urlparse(url)._replace(query=urlencode(
        dict(parse_qsl(urlparse(url).query), **kwargs))).geturl()

#/***** Compute list of managed browsers. *****/
#/***** Args: *****/
#/*****    data: the data fetched from the Takeout API. *****/
def computeBrowserList(enrolledBrowserList, data):
   try:
      for device in data['browsers']:
         if 'browsers' not in device:
            continue
         for browser in device['browsers']:
            currrent_profile = {
               'deviceId':device['deviceId'],
               'orgUnitPath':device['orgUnitPath'],
               'machineName':device['machineName'],
               'browserVersion':browser['browserVersion'],
               'channel':browser['channel'],
               'pendingInstallVersion': (browser['pendingInstallVersion'] if 'pendingInstallVersion' in browser else ''),
               'extensionCount':device['extensionCount'],
               'policyCount':device['policyCount'],
               'lastActivityTime':device['lastActivityTime'],
               'lastDeviceUser':device['lastDeviceUser']
               }
            
            enrolledBrowserList.append(currrent_profile)

   except Exception as e:
      print(e)

#/***** Get enrolled browser data from CBCM for given OU path. *****/
def get_enrolledBrowsers():
    next_page_token = ''
    chromeBrowserServiceUrl = "https://www.googleapis.com/admin/directory/v1.1beta1/customer/{0}/devices/chromebrowsers?projection=FULL&maxResults=100&orgUnitPath={1}&&pageToken=".format(CUSTOMER_ID,
                                                                                                                                                                                            ORG_UNIT_PATH)
    browsers_processed = 0
    enrolledBrowserList = list()
    authSession = create_authToken()
    while True:
      response = authSession.request(
        "GET",
        chromeBrowserServiceUrl
      )
      data = json.loads(response._content.decode("utf-8"))
      browsers_in_data = len(data['browsers'])
      browsers_processed += browsers_in_data

      computeBrowserList(enrolledBrowserList, data)

      if data.get("nextPageToken") is not None:
        next_page_token = data.get("nextPageToken")
        chromeBrowserServiceUrl = patch_url(chromeBrowserServiceUrl, pageToken=next_page_token)
      else:
        next_page_token = ''

      if len(next_page_token) == 0:
        break;
    return enrolledBrowserList

#/***** Get enrolled browser data from CBCM for given OU path. *****/
def EnrolledBrowserExportAsCSV():
   try:
      browserProfileList = get_enrolledBrowsers()
      columnHeader = ['deviceId', 'orgUnitPath', 'machineName', 'browserVersion', 'channel', 'pendingInstallVersion', 'extensionCount', 'policyCount', 'lastActivityTime', 'lastDeviceUser']
      
      with open (CSV_FILENAME, mode='w', encoding='utf-8', newline='') as csv_file:
         writer = csv.DictWriter(csv_file, fieldnames=columnHeader)   
         writer.writeheader()
         writer.writerows(browserProfileList)


   except Exception as e:
      print(e)
      
   



# get basic browser  data
EnrolledBrowserExportAsCSV()