# -*- coding: utf-8 -*-
# Copyright 2026 Google LLC
# Licensed under the Apache License, Version 2.0
"""
CEP Policy Manager (cep_policy_manager.py)
Purpose: Export and Import Chrome Enterprise Premium (CEP) configurations:
         - DLP Rules & Detectors
         - Context-Aware Access (CAA) Levels
         - BeyondCorp Secure Gateways & Applications
Features:
  - Cross-Tenant Support: Handles ALREADY_EXISTS to map dependencies between tenants.
  - Modular Architecture: Distinct methods for handling each API domain.
  - Dynamic Resolution: Automatically fetches Access Policy ID via GCP Organization ID.
  - Built-in Rate Limiting: 1.5s delay to prevent 429 quota exhaustion.
"""

import argparse
import json
import os
import sys
import pickle
import datetime
import time
import logging

# Imports for Auth
from google.oauth2 import service_account
from google.auth.transport.requests import Request, AuthorizedSession
from google_auth_oauthlib.flow import InstalledAppFlow
import requests

# ==========================================
# --- CONFIGURATION ---
# ==========================================
# TODO: Insert your Google Workspace Customer ID (e.g., "customers/C0xxxxxxx")
CUSTOMER_ID = "customers/C0xxxxxxx"

# TODO: Insert your GCP Organization ID (e.g., "organizations/123456789012")
ORGANIZATION_ID = "organizations/123456789012"

# TODO: Insert your GCP Project ID for Secure Gateways (e.g., "my-gcp-project")
PROJECT_ID = "my-gcp-project"
LOCATION = "global"

# Scopes required for Cloud Identity Policies AND Access Context Manager/BeyondCorp
SCOPES = [
    "https://www.googleapis.com/auth/cloud-identity.policies",          # Mutation
    "https://www.googleapis.com/auth/cloud-identity.policies.readonly", # Read-only
    "https://www.googleapis.com/auth/cloud-platform"                    # ACM & BeyondCorp
]

# API Endpoints
BASE_URL_READ = "https://cloudidentity.googleapis.com/v1/policies"
BASE_URL_WRITE = "https://cloudidentity.googleapis.com/v1beta1/policies"
BASE_URL_ACM = "https://accesscontextmanager.googleapis.com/v1"
BASE_URL_BEYONDCORP = "https://beyondcorp.googleapis.com/v1"

# Auth Files
USE_SERVICE_ACCOUNT = False 
SERVICE_ACCOUNT_FILE = "service_account.json"
CLIENT_SECRETS_FILE = "client_secrets.json"
TOKEN_PICKLE_FILE = "token_cep.pickle"

# DLP Filters (CEL syntax)
DLP_FILTERS = {
    "rules": 'setting.type.matches("settings/rule.dlp")',
    "word_list": 'setting.type.matches("settings/detector.word_list")',
    "regex": 'setting.type.matches("settings/detector.regular_expression")',
    "url_list": 'setting.type.matches("settings/detector.url_list")'
}


# ==========================================
# --- LOGGING SETUP ---
# ==========================================
def setup_logging(debug_mode):
    """Configures standard logging to console and file."""
    log_level = logging.DEBUG if debug_mode else logging.INFO
    log_format = '%(asctime)s - %(levelname)s - %(message)s'
    
    file_handler = logging.FileHandler('cep_policy_manager.log', encoding='utf-8')
    file_handler.setFormatter(logging.Formatter(log_format))
    
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(logging.Formatter(log_format))
    
    for handler in logging.root.handlers[:]:
        logging.root.removeHandler(handler)
        
    logging.basicConfig(level=log_level, handlers=[file_handler, console_handler])


# ==========================================
# --- CORE UTILITIES ---
# ==========================================
def get_session():
    """Handles OAuth or Service Account Authentication."""
    creds = None
    try:
        if USE_SERVICE_ACCOUNT:
            logging.info("Auth Mode: Service Account")
            if not os.path.exists(SERVICE_ACCOUNT_FILE):
                raise FileNotFoundError(f"Service account file '{SERVICE_ACCOUNT_FILE}' not found.")
            creds = service_account.Credentials.from_service_account_file(
                SERVICE_ACCOUNT_FILE, scopes=SCOPES
            )
        else:
            logging.info("Auth Mode: User Authentication (OAuth 2.0)")
            if os.path.exists(TOKEN_PICKLE_FILE):
                with open(TOKEN_PICKLE_FILE, "rb") as token:
                    creds = pickle.load(token)
            if not creds or not creds.valid:
                if creds and creds.expired and creds.refresh_token:
                    logging.info("Refreshing expired OAuth token...")
                    creds.refresh(Request())
                else:
                    if not os.path.exists(CLIENT_SECRETS_FILE):
                        raise FileNotFoundError(f"'{CLIENT_SECRETS_FILE}' not found.")
                    logging.info("Starting local browser login flow...")
                    flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRETS_FILE, SCOPES)
                    creds = flow.run_local_server(port=0)
                with open(TOKEN_PICKLE_FILE, "wb") as token:
                    pickle.dump(creds, token)
        logging.info("Authentication successful.")
        return AuthorizedSession(creds)
    except Exception as e:
        logging.error(f"Authentication failed: {e}", exc_info=True)
        return None

def fetch_policies_by_filter(session, filter_string, label):
    """Generic fetcher for Cloud Identity API with pagination."""
    logging.info(f"Fetching {label}...")
    params = {'filter': filter_string, 'pageSize': 50}
    policies = []
    page_token = None

    try:
        while True:
            if page_token: params['pageToken'] = page_token
            time.sleep(1.5)
            response = session.get(BASE_URL_READ, params=params)
            
            if response.status_code != 200:
                logging.error(f"Failed fetching {label}: HTTP {response.status_code} - {response.text}")
                break
            
            data = response.json()
            if 'policies' in data:
                policies.extend(data['policies'])
            
            page_token = data.get('nextPageToken')
            if not page_token: break
                
        logging.info(f"Found {len(policies)} {label}.")
        return policies
    except requests.exceptions.RequestException as e:
        logging.error(f"Network error while fetching {label}: {e}", exc_info=True)
        return []
    except Exception as e:
        logging.error(f"Unexpected error while fetching {label}: {e}", exc_info=True)
        return []

def get_access_policy_id(session, organization_id):
    """Dynamically fetches the Access Policy ID using the Organization ID."""
    logging.info(f"Resolving Access Policy ID for {organization_id}...")
    url = f"{BASE_URL_ACM}/accessPolicies"
    params = {'parent': organization_id}
    
    try:
        response = session.get(url, params=params)
        if response.status_code != 200:
            logging.error(f"Error resolving Access Policy: HTTP {response.status_code} - {response.text}")
            return None
        
        policies = response.json().get('accessPolicies', [])
        if not policies:
            logging.warning("No Access Policies found for this organization.")
            return None
        
        policy_id = policies[0].get('name')
        logging.info(f"Resolved Access Policy: {policy_id}")
        return policy_id
    except Exception as e:
        logging.error(f"Exception resolving Access Policy: {e}", exc_info=True)
        return None


# ==========================================
# --- EXPORT MODULES ---
# ==========================================
def export_caa_policies(session, access_policy_id):
    logging.info("Fetching CAA Access Levels...")
    url = f"{BASE_URL_ACM}/{access_policy_id}/accessLevels"
    levels = []
    page_token = None

    try:
        while True:
            params = {'pageToken': page_token} if page_token else {}
            response = session.get(url, params=params)
            if response.status_code != 200:
                logging.error(f"Error fetching Access Levels: HTTP {response.status_code} - {response.text}")
                break
            
            data = response.json()
            if 'accessLevels' in data:
                levels.extend(data['accessLevels'])
            
            page_token = data.get('nextPageToken')
            if not page_token: break
            
        logging.info(f"Found {len(levels)} Access Levels.")
        return levels
    except Exception as e:
        logging.error(f"Exception fetching Access Levels: {e}", exc_info=True)
        return []

def export_secure_gateway_applications(session, gateway_name):
    """Fetches Applications for a specific Secure Gateway."""
    gateway_short = gateway_name.split('/')[-1]
    logging.info(f"Fetching Applications for Secure Gateway: '{gateway_short}'...")
    url = f"{BASE_URL_BEYONDCORP}/{gateway_name}/applications"
    apps = []
    page_token = None

    try:
        while True:
            params = {'pageToken': page_token} if page_token else {}
            response = session.get(url, params=params)
            if response.status_code != 200:
                logging.error(f"Error fetching Applications: HTTP {response.status_code} - {response.text}")
                break
            
            data = response.json()
            if 'applications' in data:
                apps.extend(data['applications'])
            
            page_token = data.get('nextPageToken')
            if not page_token: break
        return apps
    except Exception as e:
        logging.error(f"Exception fetching Applications: {e}", exc_info=True)
        return []

def export_secure_gateways(session, project_id, location):
    logging.info(f"Fetching Secure Gateways from {project_id}/{location}...")
    url = f"{BASE_URL_BEYONDCORP}/projects/{project_id}/locations/{location}/securityGateways"
    gateways = []
    page_token = None

    try:
        while True:
            params = {'pageToken': page_token} if page_token else {}
            response = session.get(url, params=params)
            if response.status_code != 200:
                logging.error(f"Error fetching Secure Gateways: HTTP {response.status_code} - {response.text}")
                break
            
            data = response.json()
            if 'securityGateways' in data:
                new_gateways = data['securityGateways']
                # Retrieve the embedded applications for each gateway
                for gw in new_gateways:
                    gw['applications'] = export_secure_gateway_applications(session, gw['name'])
                gateways.extend(new_gateways)
            
            page_token = data.get('nextPageToken')
            if not page_token: break
            
        logging.info(f"Found {len(gateways)} Secure Gateways.")
        return gateways
    except Exception as e:
        logging.error(f"Exception fetching Secure Gateways: {e}", exc_info=True)
        return []

def export_detectors(session):
    return {
        "word_list_detectors": fetch_policies_by_filter(session, DLP_FILTERS["word_list"], "Word List Detectors"),
        "regex_detectors": fetch_policies_by_filter(session, DLP_FILTERS["regex"], "Regex Detectors"),
        "url_list_detectors": fetch_policies_by_filter(session, DLP_FILTERS["url_list"], "URL List Detectors")
    }

def export_dlp_rules(session):
    raw_rules = fetch_policies_by_filter(session, DLP_FILTERS["rules"], "DLP Rules")
    chrome_rules = []
    for rule in raw_rules:
        triggers = rule.get("setting", {}).get("value", {}).get("triggers", [])
        if any("google.workspace.chrome" in trigger for trigger in triggers):
            chrome_rules.append(rule)
    logging.info(f"Filtered down to {len(chrome_rules)} Chrome-specific rules.")
    return chrome_rules

def export_environment(session, output_file):
    logging.info("Starting Chrome Enterprise Premium (CEP) Environment Export...")
    
    access_policy_id = get_access_policy_id(session, ORGANIZATION_ID)
    if not access_policy_id:
        logging.error("Aborting export: Could not resolve Access Policy ID.")
        return

    # Gather data through domain-specific methods
    caa_levels = export_caa_policies(session, access_policy_id)
    secure_gateways = export_secure_gateways(session, PROJECT_ID, LOCATION)
    detectors = export_detectors(session)
    rules = export_dlp_rules(session)
    
    all_configs = {
        "caa_access_levels": caa_levels,
        "secure_gateways": secure_gateways,
        **detectors,
        "rules": rules
    }
    
    total_items = sum(len(items) for items in all_configs.values())
    output_data = {
        "meta": {
            "customer_id": CUSTOMER_ID,
            "organization_id": ORGANIZATION_ID,
            "project_id": PROJECT_ID,
            "location": LOCATION,
            "access_policy_id": access_policy_id,
            "exported_at": str(datetime.datetime.now()),
            "format": "cep_environment_export_v3",
            "total_items": total_items
        },
        "cep_configurations": all_configs
    }

    if not output_file:
        timestamp = datetime.datetime.now().strftime("%b_%d_%Y_%H-%M")
        output_file = f"cep_export_{timestamp}.json"

    try:
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, indent=2, sort_keys=True)
        logging.info(f"Successfully exported {total_items} CEP configurations to: {output_file}")
    except IOError as e:
        logging.error(f"Failed to write export file: {e}", exc_info=True)


# ==========================================
# --- IMPORT MODULES ---
# ==========================================
def clean_policy_for_import(policy_obj, target_ou_id=None, target_group_id=None):
    import_obj = policy_obj.copy()
    for field in ['name', 'createTime', 'updateTime', 'deleteTime', 'etag']:
        import_obj.pop(field, None)
        
    setting_value = import_obj.get('setting', {}).get('value', {})
    for field in ['createTime', 'updateTime']:
        setting_value.pop(field, None)
        
    import_obj['customer'] = CUSTOMER_ID
    policy_type = import_obj.get('setting', {}).get('type', '')
    is_detector = 'detector' in policy_type

    if is_detector:
        if target_ou_id:
            import_obj['policyQuery'] = {"orgUnit": f"orgUnits/{target_ou_id}", "sortOrder": 1}
    else:
        if target_ou_id:
            import_obj['policyQuery'] = {
                "query": f"entity.org_units.exists(org_unit, org_unit.org_unit_id == orgUnitId('{target_ou_id}'))",
                "orgUnit": f"orgUnits/{target_ou_id}", "sortOrder": 1
            }
        elif target_group_id:
            import_obj['policyQuery'] = {
                "query": f"entity.groups.exists(group, group.group_id == groupId('{target_group_id}'))",
                "group": f"groups/{target_group_id}", "sortOrder": 1
            }
    
    if 'policyQuery' not in import_obj:
        raise ValueError("No policyQuery found in rule and no CLI override provided.")
    
    action_block = import_obj.get('setting', {}).get('value', {}).get('action', {})
    if 'alertCenterAction' in action_block:
        aca = action_block['alertCenterAction']
        if not aca or (isinstance(aca, dict) and not aca.get('alertCenterConfig')):
            del action_block['alertCenterAction']
        
    return import_obj

def import_caa_policies(session, access_levels, target_policy_id, id_mapping):
    if not access_levels: return
    logging.info(f"Importing {len(access_levels)} CAA Access Levels...")
    
    for al in access_levels:
        old_id = al.get("name")
        cleaned_payload = al.copy()
        for field in ['createTime', 'updateTime']:
            cleaned_payload.pop(field, None)
            
        short_name = old_id.split('/')[-1] if '/' in old_id else old_id
        new_id = f"{target_policy_id}/accessLevels/{short_name}"
        cleaned_payload['name'] = new_id
        
        logging.info(f"Creating Access Level: '{short_name}'...")
        url = f"{BASE_URL_ACM}/{target_policy_id}/accessLevels"

        try:
            time.sleep(1.5)
            response = session.post(url, json=cleaned_payload)
            
            if response.status_code in [200, 201] or 'name' in response.json():
                returned_id = response.json().get('name')
                logging.info(f"[SUCCESS] Created: {returned_id}")
                if old_id and returned_id: id_mapping[old_id] = returned_id
            elif response.status_code == 409:
                logging.warning(f"[SKIPPED] Access Level '{short_name}' already exists. Mapping dependencies.")
                if old_id: id_mapping[old_id] = new_id
            else:
                logging.error(f"[FAILED] HTTP {response.status_code}: {response.text}")
        except requests.exceptions.RequestException as e:
            logging.error(f"[FAILED] Network error during Access Level creation: {e}")

def import_secure_gateway_applications(session, apps, target_parent_path, gw_id):
    if not apps: return
    logging.info(f"Importing {len(apps)} Applications for Gateway '{gw_id}'...")
    url = f"{BASE_URL_BEYONDCORP}/{target_parent_path}/securityGateways/{gw_id}/applications"
    
    for app in apps:
        old_name = app.get('name', '')
        app_id = old_name.split('/')[-1] if '/' in old_name else old_name
        
        cleaned_app = app.copy()
        for field in ['name', 'createTime', 'updateTime']:
            cleaned_app.pop(field, None)
            
        logging.info(f"Creating Application: '{app_id}'...")
        params = {'applicationId': app_id}
        
        try:
            time.sleep(1.5)
            response = session.post(url, json=cleaned_app, params=params)
            
            # The API returns an Operation object, so we look for "name" containing "/operations/"
            if response.status_code == 200 or 'name' in response.json():
                op_name = response.json().get('name')
                logging.info(f"[SUCCESS] Provisioning started (LRO): {op_name}")
            elif response.status_code == 409:
                logging.warning(f"[SKIPPED] Application '{app_id}' already exists.")
            else:
                logging.error(f"[FAILED] HTTP {response.status_code}: {response.text}")
        except requests.exceptions.RequestException as e:
            logging.error(f"[FAILED] Network error during Application creation: {e}")

def import_secure_gateways(session, gateways, project_id, location):
    if not gateways: return
    logging.info(f"Importing {len(gateways)} Secure Gateways to {project_id}/{location}...")
    parent = f"projects/{project_id}/locations/{location}"
    url = f"{BASE_URL_BEYONDCORP}/{parent}/securityGateways"
    
    for gw in gateways:
        old_name = gw.get('name', '')
        gw_id = old_name.split('/')[-1] if '/' in old_name else old_name
        if not gw_id: continue
        
        # Pop applications out to import them separately after the gateway
        apps = gw.pop('applications', [])
        
        cleaned_gw = gw.copy()
        for field in ['name', 'createTime', 'updateTime', 'state']:
            cleaned_gw.pop(field, None)
            
        logging.info(f"Creating Secure Gateway: '{gw_id}'...")
        params = {'securityGatewayId': gw_id}
        
        try:
            time.sleep(1.5)
            response = session.post(url, json=cleaned_gw, params=params)
            
            if response.status_code == 200 or 'name' in response.json():
                op_name = response.json().get('name')
                logging.info(f"[SUCCESS] Provisioning started (LRO): {op_name}")
            elif response.status_code == 409:
                logging.warning(f"[SKIPPED] Secure Gateway '{gw_id}' already exists.")
            else:
                logging.error(f"[FAILED] HTTP {response.status_code}: {response.text}")
        except requests.exceptions.RequestException as e:
            logging.error(f"[FAILED] Network error during Gateway creation: {e}")
            
        # Trigger import of nested applications for this gateway
        import_secure_gateway_applications(session, apps, parent, gw_id)

def import_detectors(session, detectors, label, target_ou_id, target_group_id, id_mapping):
    if not detectors: return
    logging.info(f"Importing {len(detectors)} {label}...")
    
    for detector in detectors:
        old_id = detector.get("name")
        display_name = detector.get("setting", {}).get("value", {}).get("displayName", "Unknown")
        logging.info(f"Creating Detector: '{display_name}'...")
        
        try:
            cleaned_payload = clean_policy_for_import(detector, target_ou_id, target_group_id)
        except ValueError:
            logging.warning(f"[SKIPPED] Missing valid target scope (OU or Group) for '{display_name}'.")
            continue

        try:
            time.sleep(1.5)
            response = session.post(BASE_URL_WRITE, json=cleaned_payload)
            
            if response.status_code == 200 and 'error' not in response.json():
                new_id = response.json().get('response', {}).get('name')
                logging.info(f"[SUCCESS] Created: {new_id}")
                if old_id and new_id: id_mapping[old_id] = new_id
            else:
                logging.error(f"[FAILED] HTTP {response.status_code}: {response.text}")
        except requests.exceptions.RequestException as e:
            logging.error(f"[FAILED] Network error during Detector creation: {e}")

def import_dlp_rules(session, rules, target_ou_id, target_group_id, id_mapping):
    if not rules: return
    logging.info(f"Importing {len(rules)} CEP DLP Rules...")
    
    for rule in rules:
        display_name = rule.get("setting", {}).get("value", {}).get("displayName", "Unknown")
        logging.info(f"Creating Rule: '{display_name}'...")
        
        condition = rule.get("setting", {}).get("value", {}).get("condition", {})
        for condition_type in ["contentCondition", "contextCondition"]:
            cond_str = condition.get(condition_type, "")
            if cond_str:
                for old_id, new_id in id_mapping.items():
                    if old_id in cond_str:
                        cond_str = cond_str.replace(old_id, new_id)
                rule["setting"]["value"]["condition"][condition_type] = cond_str

        try:
            cleaned_payload = clean_policy_for_import(rule, target_ou_id=target_ou_id, target_group_id=target_group_id)
        except ValueError:
            logging.warning(f"[SKIPPED] Missing valid target scope (OU or Group) for '{display_name}'.")
            continue
        
        try:
            time.sleep(1.5)
            response = session.post(BASE_URL_WRITE, json=cleaned_payload)
            
            if response.status_code == 200 and 'error' not in response.json():
                logging.info(f"[SUCCESS] Created: {response.json().get('response', {}).get('name')}")
            else:
                logging.error(f"[FAILED] HTTP {response.status_code}: {response.text}")
        except requests.exceptions.RequestException as e:
            logging.error(f"[FAILED] Network error during Rule creation: {e}")

def import_environment(session, input_file, target_ou_id=None, target_group_id=None):
    logging.info("Starting Chrome Enterprise Premium (CEP) Environment Import...")
    if not os.path.exists(input_file):
        logging.error(f"Error: Import file '{input_file}' not found.")
        return
        
    try:
        with open(input_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        logging.error(f"Failed to parse JSON file '{input_file}': {e}")
        return
        
    configs = data.get("cep_configurations", {})
    
    access_policy_id = get_access_policy_id(session, ORGANIZATION_ID)
    if not access_policy_id:
        logging.error("Aborting import: Could not resolve Target Access Policy ID.")
        return

    id_mapping = {}

    import_caa_policies(session, configs.get("caa_access_levels", []), access_policy_id, id_mapping)
    import_secure_gateways(session, configs.get("secure_gateways", []), PROJECT_ID, LOCATION)
    import_detectors(session, configs.get("word_list_detectors", []), "Word List Detectors", target_ou_id, target_group_id, id_mapping)
    import_detectors(session, configs.get("regex_detectors", []), "Regex Detectors", target_ou_id, target_group_id, id_mapping)
    import_detectors(session, configs.get("url_list_detectors", []), "URL List Detectors", target_ou_id, target_group_id, id_mapping)
    import_dlp_rules(session, configs.get("rules", []), target_ou_id, target_group_id, id_mapping)
    
    logging.info("Import sequence completed.")


# ==========================================
# --- CLI ENTRY POINT ---
# ==========================================
def main():
    parser = argparse.ArgumentParser(description="Manage Chrome Enterprise Premium (CEP) Policies (DLP, Detectors, CAA, Gateways).")
    subparsers = parser.add_subparsers(dest='command', help='Action to perform')
    
    parser_export = subparsers.add_parser('export', help='Export CEP Environment (Rules, Detectors, Access Levels, Gateways)')
    parser_export.add_argument("--file", help="Output JSON filename.")
    
    parser_import = subparsers.add_parser('import', help='Import CEP Environment from JSON')
    parser_import.add_argument("--file", required=True, help="Input JSON filename.")
    target_group = parser_import.add_mutually_exclusive_group(required=False)
    target_group.add_argument("--ou-id", help="Override Target Org Unit ID")
    target_group.add_argument("--group-id", help="Override Target Group ID")

    parser.add_argument("--use-service-account", action="store_true", help="Force Service Account Auth")
    parser.add_argument("--debug", action="store_true", help="Enable verbose debug logging")
    
    args = parser.parse_args()

    # Configure Logging First
    setup_logging(args.debug)

    global USE_SERVICE_ACCOUNT
    if args.use_service_account: 
        USE_SERVICE_ACCOUNT = True

    session = get_session()
    if not session: 
        return

    if args.command == 'export': 
        export_environment(session, args.file)
    elif args.command == 'import': 
        import_environment(session, args.file, args.ou_id, args.group_id)
    else: 
        parser.print_help()

if __name__ == "__main__":
    main()
