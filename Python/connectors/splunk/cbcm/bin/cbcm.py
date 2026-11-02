import import_declare_test
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

def get_org_unit_id(session, customer_id, org_unit_path):
    url = 'https://admin.googleapis.com/admin/directory/v1/customer/{0}/orgunits'.format(customer_id)
    params = {'type': 'all', 'maxResults': 200}
    normalized_org_unit_path = org_unit_path if org_unit_path.startswith('/') else '/' + org_unit_path
    while True:
        response = session.get(url, params=params)
        response.raise_for_status()
        data = response.json()
        for org_unit in data.get('organizationUnits', []):
            if org_unit.get('orgUnitPath') == normalized_org_unit_path:
                return org_unit.get('orgUnitId')
        page_token = data.get('nextPageToken')
        if not page_token:
            return None
        params['pageToken'] = page_token
    
logger = setup_logger(logging.INFO)

# Move managed browser to restricted OU
def move2ouMB(config, device_id):
    oupath = config.get('oupath')
    custid = config.get('custid')
    servicekey = json.loads(config.get('servicekey'))
    credentials = service_account.Credentials.from_service_account_info(servicekey)
    credentials = with_scopes_if_required(credentials,\
                    ["https://www.googleapis.com/auth/chrome.management.browsers",
                     "https://www.googleapis.com/auth/admin.directory.orgunit.readonly"],)
    session = AuthorizedSession(credentials)
    org_unit_id = get_org_unit_id(session, custid, oupath)
    if not org_unit_id:
        logger.error("Unable to resolve destination OU path: {0}".format(oupath))
        return
    response = session.request(
        "POST",
        'https://chromemanagement.googleapis.com/v1/customers/{0}/chromeBrowsers:move'.format(custid),
        json={"destinationOrgUnitId": org_unit_id, "resourceIds": [device_id]},
    )
    logger.info("response code: {0}".format(response.status_code))
    logger.info("response: {0}".format(response._content.decode("utf-8")))

# Move user to restricted OU for a managed Chrome OS device
def move2ouMD(config, device_user, profile_user):
    oupath = config.get('oupath')
    custid = config.get('custid')
    servicekey = json.loads(config.get('servicekey'))
    credentials = service_account.Credentials.from_service_account_info(servicekey)
    credentials = with_scopes_if_required(
        credentials,
        ["https://www.googleapis.com/auth/admin.directory.user"],
    )
    if device_user != "":
        logger.info("Moving Chrome device user to Quarantine OU")
        response = AuthorizedSession(credentials).request(
            "PUT",
            'https://admin.googleapis.com/admin/directory/v1/users/{0}'.format(device_user),
            data=json.dumps({"orgUnitPath": oupath}),
        )
    if profile_user != "" and device_user != profile_user:
        logger.info("Moving Chrome profile user to Quarantine OU")
        response = AuthorizedSession(credentials).request(
            "PUT",
            'https://admin.googleapis.com/admin/directory/v1/users/{0}'.format(profile_user),
            data=json.dumps({"orgUnitPath": oupath}),
        )
    logger.info("response code: {0}".format(response.status_code))
    logger.info("response: {0}".format(response._content.decode("utf-8")))

# Move user to restricted OU for a managed profile
def move2ouMP(config, profile_user):
    oupath = config.get('oupath')
    custid = config.get('custid')
    servicekey = json.loads(config.get('servicekey'))
    credentials = service_account.Credentials.from_service_account_info(servicekey)
    credentials = with_scopes_if_required(
        credentials,
        ["https://www.googleapis.com/auth/admin.directory.user"],
    )
    response = AuthorizedSession(credentials).request(
        "PUT",
        'https://admin.googleapis.com/admin/directory/v1/users/{0}'.format(profile_user),
        data=json.dumps({"orgUnitPath": oupath}),
    )
    logger.info("response code: {0}".format(response.status_code))
    logger.info("response: {0}".format(response._content.decode("utf-8")))


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--execute":
        payload = json.loads(sys.stdin.read())
        logger.info(payload.get('result'))
        config = payload.get('configuration')
        event = payload.get('result')
        if event.get('client_type') == 'CHROME_BROWSER':
            logger.info("Moving Chrome Browser to Quarantine OU")
            browser_id = event.get('browser_permanent_id') or event.get('directory_device_id')
            move2ouMB(config, browser_id)
        elif event.get('client_type') == 'CHROME_OS_DEVICE':
            move2ouMD(config, event.get('device_user'), event.get('profile_user'))
        elif event.get('client_type') == 'CHROME_BROWSER_PROFILE':
            logger.info("Moving Chrome Profile to Quarantine OU")
            move2ouMP(config, event.get('profile_user'))
        else:
            logger.info("Unknown Client Type")

    
if __name__ == "__main__":
    main()
