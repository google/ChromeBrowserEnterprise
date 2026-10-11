# -*- coding: utf-8 -*-
# Copyright 2026 Google LLC
# Licensed under the Apache License, Version 2.0
"""
CEP Policy Manager (cep_policy_manager.py)
Purpose: Export and Import Chrome Enterprise Premium (CEP) configurations:
         - DLP Rules & Detectors (Cloud Identity Policies API)
         - Context-Aware Access (CAA) Levels (Access Context Manager API)
         - BeyondCorp Secure Gateways & Applications (BeyondCorp API)
Features:
  - Split-Session & Multi-Mode Auth: Supports Workspace Super Admin User OAuth 2.0 / ADC,
    pre-minted Bearer Access Tokens (`--access-token`), and Service Account + Domain-Wide
    Delegation (`--use-service-account --subject <admin@domain.com>`) for Cloud Identity
    DLP APIs while using direct GCP credentials for ACM and BeyondCorp APIs.
  - Cross-Tenant Support: Handles ALREADY_EXISTS to map dependencies between tenants.
  - Modular Architecture: Distinct methods for handling each API domain.
  - Dynamic Resolution: Automatically fetches Access Policy ID via GCP Organization ID.
  - Built-in Rate Limiting: 1.5s delay to prevent 429 quota exhaustion.
"""

import argparse
import copy
import datetime
import json
import logging
import os
import pickle
import sys
import time

# Imports for Auth
from google.auth.exceptions import RefreshError
from google.auth.transport.requests import AuthorizedSession, Request
from google.oauth2 import credentials as oauth2_credentials
from google.oauth2 import service_account
from google_auth_oauthlib.flow import InstalledAppFlow
import requests

# ==========================================
# --- CONFIGURATION ---
# ==========================================
# TODO: Insert your Google Workspace Customer ID (e.g., "customers/C0xxxxxxx") or pass --customer
CUSTOMER_ID = os.environ.get("CEP_CUSTOMER_ID", "customers/C0xxxxxxx")

# TODO: Insert your GCP Organization ID (e.g., "organizations/123456789012") or pass --org-id
ORGANIZATION_ID = os.environ.get("CEP_ORGANIZATION_ID", "organizations/123456789012")

# TODO: Insert your GCP Project ID for Secure Gateways (e.g., "my-gcp-project") or pass --project-id
PROJECT_ID = os.environ.get("CEP_PROJECT_ID", "my-gcp-project")
LOCATION = "global"

# Scopes separated by API authorization domain:
# 1. Cloud Identity Policies API (requires Workspace Super Admin identity; DWD if using a Service Account)
DLP_SCOPES = [
    "https://www.googleapis.com/auth/cloud-identity.policies",          # Mutation
    "https://www.googleapis.com/auth/cloud-identity.policies.readonly", # Read-only
]
# 2. GCP Infrastructure APIs (Access Context Manager & BeyondCorp; supports direct Service Account IAM)
GCP_SCOPES = [
    "https://www.googleapis.com/auth/cloud-platform"                    # ACM & BeyondCorp
]
# Combined scopes for interactive User OAuth 2.0
SCOPES = DLP_SCOPES + GCP_SCOPES

# API Endpoints
BASE_URL_READ = "https://cloudidentity.googleapis.com/v1/policies"
BASE_URL_WRITE = "https://cloudidentity.googleapis.com/v1beta1/policies"
BASE_URL_ACM = "https://accesscontextmanager.googleapis.com/v1"
BASE_URL_BEYONDCORP = "https://beyondcorp.googleapis.com/v1"

# Auth Files & Options
USE_SERVICE_ACCOUNT = False
SERVICE_ACCOUNT_FILE = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "service_account.json")
IMPERSONATE_SUBJECT = os.environ.get("CEP_IMPERSONATE_SUBJECT")
ACCESS_TOKEN = os.environ.get("CEP_ACCESS_TOKEN") or os.environ.get("TF_VAR_access_token")
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
def _load_adc_user_credentials():
    """Loads authorized_user credentials from ~/.config/gcloud/application_default_credentials.json if present."""
    adc_path = os.path.expanduser("~/.config/gcloud/application_default_credentials.json")
    if not os.path.exists(adc_path):
        return None
    try:
        with open(adc_path, "r", encoding="utf-8") as f:
            adc_data = json.load(f)
        if adc_data.get("type") != "authorized_user":
            return None
        creds = oauth2_credentials.Credentials.from_authorized_user_info(adc_data)
        if creds and not creds.valid and creds.refresh_token:
            creds.refresh(Request())
        return creds if (creds and creds.valid) else None
    except Exception as e:
        logging.debug(f"Could not load user credentials from gcloud ADC: {e}")
        return None


def _load_user_oauth_session():
    """Authenticates a human Workspace Super Admin via ADC or client_secrets.json + token_cep.pickle."""
    creds = None
    if os.path.exists(TOKEN_PICKLE_FILE):
        try:
            with open(TOKEN_PICKLE_FILE, "rb") as token:
                creds = pickle.load(token)
        except Exception as e:
            logging.warning(f"Could not read cached token '{TOKEN_PICKLE_FILE}': {e}")
            creds = None

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            logging.info("Refreshing expired OAuth token...")
            try:
                creds.refresh(Request())
            except RefreshError as e:
                logging.warning(f"Cached token refresh failed ({e}); checking ADC / browser flow...")
                creds = None

        if not creds or not creds.valid:
            adc_creds = _load_adc_user_credentials()
            if adc_creds:
                logging.info(
                    "Auth Mode: Application Default Credentials "
                    "(~/.config/gcloud/application_default_credentials.json)"
                )
                return AuthorizedSession(adc_creds)

            if not os.path.exists(CLIENT_SECRETS_FILE):
                raise FileNotFoundError(
                    f"'{CLIENT_SECRETS_FILE}' not found. Provide --client-secrets, "
                    "authenticate via `gcloud auth application-default login --client-id-file=client_secrets.json "
                    "--scopes=\"https://www.googleapis.com/auth/cloud-identity.policies,"
                    "https://www.googleapis.com/auth/cloud-platform\"`, "
                    "pass --access-token, or use --use-service-account --subject <admin@domain.com>."
                )
            logging.info("Starting local browser login flow (sign in as a Workspace Super Admin)...")
            flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRETS_FILE, SCOPES)
            creds = flow.run_local_server(port=0)

        with open(TOKEN_PICKLE_FILE, "wb") as token:
            pickle.dump(creds, token)

    return AuthorizedSession(creds)


def get_sessions():
    """
    Returns a tuple of (dlp_session, gcp_session) for Cloud Identity Policies API
    and GCP Infrastructure APIs (Access Context Manager & BeyondCorp).

    Why two sessions are supported:
      - Cloud Identity Policies API (`v1/policies`, `v1beta1/policies`) strictly requires a
        Google Workspace Super Administrator identity. Direct Service Account authentication
        without Domain-Wide Delegation (`--subject`) is rejected with HTTP 403 Error(7001).
      - Access Context Manager and BeyondCorp APIs use GCP IAM (`cloud-platform` scope), where
        roles are granted directly to the Service Account principal without DWD.
    """
    try:
        dlp_session = None
        gcp_session = None

        # 1. If a pre-minted Bearer Access Token is provided, use it for DLP (and GCP if SA is not enabled)
        if ACCESS_TOKEN:
            logging.info("DLP Auth Mode: Pre-minted OAuth 2.0 Bearer Access Token")
            token_creds = oauth2_credentials.Credentials(token=ACCESS_TOKEN.strip())
            dlp_session = AuthorizedSession(token_creds)

        # 2. If Service Account mode is enabled
        if USE_SERVICE_ACCOUNT:
            if not os.path.exists(SERVICE_ACCOUNT_FILE):
                raise FileNotFoundError(f"Service account file '{SERVICE_ACCOUNT_FILE}' not found.")

            # GCP Session (ACM & BeyondCorp): Authenticate directly as the Service Account principal
            logging.info(f"GCP Auth Mode: Service Account ({SERVICE_ACCOUNT_FILE})")
            gcp_creds = service_account.Credentials.from_service_account_file(
                SERVICE_ACCOUNT_FILE, scopes=GCP_SCOPES
            )
            gcp_session = AuthorizedSession(gcp_creds)

            # DLP Session (Cloud Identity Policies API): Use DWD subject if not already using ACCESS_TOKEN
            if dlp_session is None:
                if IMPERSONATE_SUBJECT:
                    logging.info(
                        f"DLP Auth Mode: Service Account ({SERVICE_ACCOUNT_FILE}) with "
                        f"Domain-Wide Delegation subject '{IMPERSONATE_SUBJECT}'"
                    )
                    dlp_creds = service_account.Credentials.from_service_account_file(
                        SERVICE_ACCOUNT_FILE,
                        scopes=DLP_SCOPES,
                        subject=IMPERSONATE_SUBJECT,
                    )
                    dlp_session = AuthorizedSession(dlp_creds)
                else:
                    logging.warning(
                        "WARNING: --use-service-account was set without --subject "
                        "(or env CEP_IMPERSONATE_SUBJECT) or --access-token. "
                        "The Cloud Identity Policies API requires a Google Workspace Super Admin "
                        "identity and will return HTTP 403 Error(7001) for DLP Rules & Detectors "
                        "unless Domain-Wide Delegation (--subject <super-admin@domain.com>) or "
                        "Super Admin OAuth 2.0 is used."
                    )
                    dlp_creds = service_account.Credentials.from_service_account_file(
                        SERVICE_ACCOUNT_FILE, scopes=SCOPES
                    )
                    dlp_session = AuthorizedSession(dlp_creds)
        else:
            # 3. User OAuth 2.0 / ADC mode (No DWD required)
            if dlp_session is None:
                logging.info("Auth Mode: User Authentication (OAuth 2.0 / ADC as Workspace Super Admin)")
                user_session = _load_user_oauth_session()
                dlp_session = user_session
                gcp_session = user_session
            else:
                # ACCESS_TOKEN was provided without --use-service-account; use it for both
                gcp_session = dlp_session

        logging.info("Authentication initialized successfully.")
        return dlp_session, gcp_session
    except Exception as e:
        logging.error(f"Authentication failed: {e}", exc_info=True)
        return None, None


def get_session():
    """Backwards-compatible helper returning the primary DLP session."""
    dlp_session, _ = get_sessions()
    return dlp_session


def _log_dlp_403_hint(status_code, response_text):
    """Logs an actionable troubleshooting hint when Cloud Identity Policies API returns 403 Error(7001)."""
    if status_code == 403 and ("7001" in response_text or "PERMISSION_DENIED" in response_text):
        logging.error(
            "Hint: Cloud Identity Policies API requires a Google Workspace Super Administrator "
            "identity. Direct Service Account authentication without Domain-Wide Delegation "
            "(or a non-Super-Admin user) is rejected with HTTP 403 Error(7001).\n"
            "  -> Option 1 (No DWD): Run without --use-service-account to use Super Admin OAuth 2.0 / ADC, "
            "or pass --access-token \"$(gcloud auth application-default print-access-token)\".\n"
            "  -> Option 2 (With DWD): Pass --use-service-account --subject super-admin@yourdomain.com."
        )


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
                _log_dlp_403_hint(response.status_code, response.text)
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

def export_environment(dlp_session, output_file, gcp_session=None):
    logging.info("Starting Chrome Enterprise Premium (CEP) Environment Export...")
    if gcp_session is None:
        gcp_session = dlp_session

    access_policy_id = None
    if ORGANIZATION_ID and ORGANIZATION_ID != "organizations/123456789012":
        access_policy_id = get_access_policy_id(gcp_session, ORGANIZATION_ID)
    if not access_policy_id:
        logging.warning(
            "Could not resolve Access Policy ID (or ORGANIZATION_ID not configured). "
            "Skipping CAA Access Levels export and continuing with DLP Detectors & Rules."
        )

    # Gather data through domain-specific methods (GCP session for ACM/BeyondCorp, DLP session for Cloud Identity)
    caa_levels = export_caa_policies(gcp_session, access_policy_id) if access_policy_id else []
    secure_gateways = (
        export_secure_gateways(gcp_session, PROJECT_ID, LOCATION)
        if PROJECT_ID and PROJECT_ID != "my-gcp-project"
        else []
    )
    detectors = export_detectors(dlp_session)
    rules = export_dlp_rules(dlp_session)
    
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
    import_obj = copy.deepcopy(policy_obj)
    for field in ['name', 'createTime', 'updateTime', 'deleteTime', 'etag']:
        import_obj.pop(field, None)
        
    setting_value = import_obj.get('setting', {}).get('value', {})
    for field in ['createTime', 'updateTime']:
        setting_value.pop(field, None)
        
    customer_norm = CUSTOMER_ID if CUSTOMER_ID.startswith("customers/") else f"customers/{CUSTOMER_ID}"
    import_obj['customer'] = customer_norm
    policy_type = import_obj.get('setting', {}).get('type', '')
    is_detector = 'detector' in policy_type

    clean_ou_id = target_ou_id.removeprefix("orgUnits/").strip() if target_ou_id else None
    clean_group_id = target_group_id.removeprefix("groups/").strip() if target_group_id else None

    if is_detector:
        if clean_ou_id:
            import_obj['policyQuery'] = {"orgUnit": f"orgUnits/{clean_ou_id}", "sortOrder": 1}
        elif clean_group_id:
            import_obj['policyQuery'] = {"group": f"groups/{clean_group_id}", "sortOrder": 1}
    else:
        if clean_ou_id:
            import_obj['policyQuery'] = {
                "query": f"entity.org_units.exists(org_unit, org_unit.org_unit_id == orgUnitId('{clean_ou_id}'))",
                "orgUnit": f"orgUnits/{clean_ou_id}", "sortOrder": 1
            }
        elif clean_group_id:
            import_obj['policyQuery'] = {
                "query": f"entity.groups.exists(group, group.group_id == groupId('{clean_group_id}'))",
                "group": f"groups/{clean_group_id}", "sortOrder": 1
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
                _log_dlp_403_hint(response.status_code, response.text)
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
                _log_dlp_403_hint(response.status_code, response.text)
        except requests.exceptions.RequestException as e:
            logging.error(f"[FAILED] Network error during Rule creation: {e}")

def import_environment(dlp_session, input_file, target_ou_id=None, target_group_id=None, gcp_session=None):
    logging.info("Starting Chrome Enterprise Premium (CEP) Environment Import...")
    if gcp_session is None:
        gcp_session = dlp_session

    if not os.path.exists(input_file):
        logging.error(f"Error: Import file '{input_file}' not found.")
        return
        
    try:
        with open(input_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        logging.error(f"Failed to parse JSON file '{input_file}': {e}")
        return
        
    configs = data.get("cep_configurations") or data.get("dlp_configurations", {})
    id_mapping = {}

    caa_levels = configs.get("caa_access_levels", [])
    if caa_levels:
        access_policy_id = get_access_policy_id(gcp_session, ORGANIZATION_ID)
        if access_policy_id:
            import_caa_policies(gcp_session, caa_levels, access_policy_id, id_mapping)
        else:
            logging.warning(
                "Could not resolve Target Access Policy ID. Skipping CAA Access Levels import "
                "and continuing with DLP Detectors & Rules."
            )

    gateways = configs.get("secure_gateways", [])
    if gateways:
        import_secure_gateways(gcp_session, gateways, PROJECT_ID, LOCATION)

    import_detectors(dlp_session, configs.get("word_list_detectors", []), "Word List Detectors", target_ou_id, target_group_id, id_mapping)
    import_detectors(dlp_session, configs.get("regex_detectors", []), "Regex Detectors", target_ou_id, target_group_id, id_mapping)
    import_detectors(dlp_session, configs.get("url_list_detectors", []), "URL List Detectors", target_ou_id, target_group_id, id_mapping)
    import_dlp_rules(dlp_session, configs.get("rules", []), target_ou_id, target_group_id, id_mapping)
    
    logging.info("Import sequence completed.")


# ==========================================
# --- CLI ENTRY POINT ---
# ==========================================
def _add_common_arguments(target_parser, suppress_defaults=False):
    default_val = argparse.SUPPRESS if suppress_defaults else None
    default_bool = argparse.SUPPRESS if suppress_defaults else False
    target_parser.add_argument(
        "--use-service-account",
        action="store_true",
        default=default_bool,
        help="Use Service Account authentication",
    )
    target_parser.add_argument(
        "--key-file",
        default=default_val,
        help="Path to Service Account JSON key file (default: service_account.json or $GOOGLE_APPLICATION_CREDENTIALS).",
    )
    target_parser.add_argument(
        "--subject",
        default=default_val,
        help="Workspace Super Admin email to impersonate via Domain-Wide Delegation for Cloud Identity DLP APIs.",
    )
    target_parser.add_argument(
        "--access-token",
        default=default_val,
        help="Pre-minted OAuth 2.0 Bearer Access Token from a Workspace Super Admin (e.g. `gcloud auth application-default print-access-token`).",
    )
    target_parser.add_argument(
        "--client-secrets",
        default=default_val,
        help="Path to OAuth 2.0 Desktop client_secrets.json file (default: client_secrets.json).",
    )
    target_parser.add_argument(
        "--token-file",
        default=default_val,
        help="Path to cached user OAuth token pickle file (default: token_cep.pickle).",
    )
    target_parser.add_argument(
        "--customer",
        default=default_val,
        help="Override Google Workspace Customer ID (e.g., customers/C0xxxxxxx).",
    )
    target_parser.add_argument(
        "--org-id",
        default=default_val,
        help="Override GCP Organization ID (e.g., organizations/123456789012).",
    )
    target_parser.add_argument(
        "--project-id",
        default=default_val,
        help="Override GCP Project ID for BeyondCorp Secure Gateways.",
    )
    target_parser.add_argument(
        "--debug",
        action="store_true",
        default=default_bool,
        help="Enable verbose debug logging",
    )


def main():
    parser = argparse.ArgumentParser(description="Manage Chrome Enterprise Premium (CEP) Policies (DLP, Detectors, CAA, Gateways).")
    _add_common_arguments(parser, suppress_defaults=False)
    subparsers = parser.add_subparsers(dest='command', help='Action to perform')
    
    parser_export = subparsers.add_parser('export', help='Export CEP Environment (Rules, Detectors, Access Levels, Gateways)')
    parser_export.add_argument("--file", help="Output JSON filename.")
    _add_common_arguments(parser_export, suppress_defaults=True)
    
    parser_import = subparsers.add_parser('import', help='Import CEP Environment from JSON')
    parser_import.add_argument("--file", required=True, help="Input JSON filename.")
    target_group = parser_import.add_mutually_exclusive_group(required=False)
    target_group.add_argument("--ou-id", help="Override Target Org Unit ID")
    target_group.add_argument("--group-id", help="Override Target Group ID")
    _add_common_arguments(parser_import, suppress_defaults=True)
    
    args = parser.parse_args()

    # Configure Logging First
    setup_logging(args.debug)

    global USE_SERVICE_ACCOUNT, SERVICE_ACCOUNT_FILE, IMPERSONATE_SUBJECT, ACCESS_TOKEN
    global CLIENT_SECRETS_FILE, TOKEN_PICKLE_FILE, CUSTOMER_ID, ORGANIZATION_ID, PROJECT_ID
    if args.use_service_account: 
        USE_SERVICE_ACCOUNT = True
    if args.key_file:
        SERVICE_ACCOUNT_FILE = args.key_file
    if args.subject:
        IMPERSONATE_SUBJECT = args.subject
    if args.access_token:
        ACCESS_TOKEN = args.access_token
    if args.client_secrets:
        CLIENT_SECRETS_FILE = args.client_secrets
    if args.token_file:
        TOKEN_PICKLE_FILE = args.token_file
    if args.customer:
        CUSTOMER_ID = args.customer if args.customer.startswith("customers/") else f"customers/{args.customer}"
    if args.org_id:
        ORGANIZATION_ID = args.org_id if args.org_id.startswith("organizations/") else f"organizations/{args.org_id}"
    if args.project_id:
        PROJECT_ID = args.project_id

    if not args.command:
        parser.print_help()
        return

    dlp_session, gcp_session = get_sessions()
    if not dlp_session: 
        return

    if args.command == 'export': 
        export_environment(dlp_session, args.file, gcp_session=gcp_session)
    elif args.command == 'import': 
        import_environment(dlp_session, args.file, args.ou_id, args.group_id, gcp_session=gcp_session)
    else: 
        parser.print_help()

if __name__ == "__main__":
    main()