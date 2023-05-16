# cbcm-device-group-based-policies

#Libraries and Dependencies
#pip install google-api-python-client
#pip install google-auth
#pip install google-auth-oauthlib
#pip install google-auth-httplib2
#pip install urllib3

import json
import cloudidentitymembership

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
#Add the Device Group ID key
DEVICE_GROUP_KEY = ""
#/******* END: Customer to modify this section *******/

#/***** Get authorization token *****/
def create_authToken():
    service_account_info = json.load(open(SERVICE_ACCOUNT_KEY_PATH))

    credentials = Credentials.from_service_account_info(
        service_account_info,
        scopes=[
            'https://www.googleapis.com/auth/admin.directory.device.chromebrowsers.readonly',
            'https://www.googleapis.com/auth/cloud-identity.groups'
            ])
    
    return AuthorizedSession(credentials)

#/***** Modify the query string. *****/
def patch_url(url, **kwargs):
    return urlparse(url)._replace(query=urlencode(
        dict(parse_qsl(urlparse(url).query), **kwargs))).geturl()

#/***** Get enrolled browser data from CBCM for given OU path. *****/
def get_enrolledBrowsers():
    next_page_token = ''
    chromeBrowserServiceUrl = "https://www.googleapis.com/admin/directory/v1.1beta1/customer/{0}/devices/chromebrowsers?projection=BASIC&maxResults=100&orgUnitPath={1}&&pageToken=".format(CUSTOMER_ID,
                                                                                                                                                                                            ORG_UNIT_PATH)
    browsers_processed = 0
    managedBrowsers = dict()
    authSession = create_authToken()
    while True:
      response = authSession.request(
        "GET",
        chromeBrowserServiceUrl
      )
      data = json.loads(response._content.decode("utf-8"))
      browsers_in_data = len(data['browsers'])
      browsers_processed += browsers_in_data

      if (browsers_in_data > 0):
        for browserItem in data['browsers']:
          managedBrowsers[browserItem['deviceId']] = browserItem['machineName']

      if data.get("nextPageToken") is not None:
        next_page_token = data.get("nextPageToken")
        chromeBrowserServiceUrl = patch_url(chromeBrowserServiceUrl, pageToken=next_page_token)
      else:
        next_page_token = ''

      if len(next_page_token) == 0:
        break;

    return managedBrowsers

#List memberships in specifid group
def list_device_group_memberships(group_id):
  try:
    cloudIdentityMembershipServiceUrl = "https://cloudidentity.googleapis.com/v1beta1/groups/{0}/memberships".format(group_id)
    authSession = create_authToken()
    response = authSession.request(
        "GET",
        cloudIdentityMembershipServiceUrl
    )
    deviceGroupDict = json.loads(response._content.decode("utf-8"))

    membershipList = []

    for member in deviceGroupDict['memberships']:
      #look for cbcm-browser keyword
      if "cbcm-browser." in member['preferredMemberKey']['id']:
        #add roles
        for memberRoles in member['roles']:
          if ('MEMBER' in memberRoles['name']):
            cloud_identity_role = cloudidentitymembership.Role(name="MEMBER")
            break;
        #add membership key
        cloud_identity_member_key = cloudidentitymembership.MemberKey(id=member['memberKey']['id'])
        #add preferred Member Key
        cloud_identity_preferred_member_key = cloudidentitymembership.PreferredMemberKey(id=member['preferredMemberKey']['id'])
        #add membership
        cloud_identity_membership = cloudidentitymembership.Membership(name=member['name'],
                                                                       member_key=cloud_identity_member_key,
                                                                       role=cloud_identity_role,
                                                                       preferred_member_key=cloud_identity_preferred_member_key)
        membershipList.append(cloud_identity_membership)

    cloud_identity_membership = cloudidentitymembership.Cloudidentitymembership(memberships=membershipList)

    return cloud_identity_membership
  except Exception as e:
    print(e)

def ComputeEnrolledBrowserWithCloudDdentityMembership(managedbrowserDict, cloudIdentityMembershipInstance):
  try:
    membershipList = []
    for key, value in managedbrowserDict.items():
      memberKeyID = "cbcm-browser.{0}".format(key)
      cloud_identity_role = cloudidentitymembership.Role(name="MEMBER")
      cloud_identity_member_key = cloudidentitymembership.MemberKey(id=memberKeyID)
      cloud_identity_preferred_member_key = cloudidentitymembership.PreferredMemberKey(id=memberKeyID, device_id=key, name=value, is_member=False)
      cloud_identity_membership = cloudidentitymembership.Membership(name=None, 
                                                                     member_key=cloud_identity_member_key, 
                                                                     role=cloud_identity_role, 
                                                                     preferred_member_key=cloud_identity_preferred_member_key)
      
      if len(cloudIdentityMembershipInstance.memberships) == 0:
        #add to membership list since the group doesn't have members.
        membershipList.append(cloud_identity_membership)
      else:
        #check if the group has matching cbcm browser id. if none are found, add to the list.
        for memberItem in cloudIdentityMembershipInstance.memberships:
          if (memberItem.member_key.id.casefold() != memberKeyID.casefold()):
            membershipList.append(cloud_identity_membership)
    
    cloud_identity_membership = cloudidentitymembership.Cloudidentitymembership(memberships=membershipList)
          
    return cloud_identity_membership
  except Exception as e:
    print(e)

#Add new new members to device group
def create_device_group_membership(group_id, computedBrowserMemberList):
  try:
    membershipList = computedBrowserMemberList.memberships
  
    for memberItem in membershipList:      
      payload = json.dumps({"roles": [ {"name": memberItem.role.name } ], "preferredMemberKey": { "id": memberItem.preferred_member_key.id }})

      cloudIdentityMembershipServiceUrl = "https://cloudidentity.googleapis.com/v1beta1/groups/{0}/memberships".format(group_id)
      authSession = create_authToken()
      response = authSession.request(
        "POST",
        url=cloudIdentityMembershipServiceUrl,
        data=payload)
      
      result = json.loads(response._content.decode("utf-8"))
      
      print(result)
  except Exception as e:
    print(e)

# get enrolled browser
managedbrowsers = get_enrolledBrowsers()
#get device group members
cloudIdentityMembership = list_device_group_memberships(DEVICE_GROUP_KEY)
#filter enrolled browsers that are members of the group
computedMemberList = ComputeEnrolledBrowserWithCloudDdentityMembership(managedbrowsers, cloudIdentityMembership)
#create members in specified group key
create_device_group_membership(DEVICE_GROUP_KEY, computedMemberList)



