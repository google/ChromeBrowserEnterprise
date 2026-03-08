# -*- coding: utf-8 -*-
# Copyright 2026 Google LLC
# Licensed under the Apache License, Version 2.0
"""
CEP DLP Policy Manager
Purpose: Export and Import Chrome Enterprise Premium DLP Rules and Detectors.
Features:
  - Scopes rule exports EXCLUSIVELY to Chrome DLP rules.
  - Dual API Versions: Uses v1 for Read (Export) and v1beta1 for Mutation (Import/Create).
  - Built-in Rate Limiting (1.5s delay) to prevent 429 errors on Beta APIs.
  - Dynamic Scoping: Reads targets natively from JSON or overrides via CLI.
  - Dependency Mapping: Translates old Detector IDs to new IDs during Rule import.
  - Multi-auth support (Service Account vs User OAuth) & debug logging.
"""

import argparse
import json
import os.path
import pickle
import datetime
import traceback
import time

# Imports for Auth
from google.oauth2 import service_account
from google.auth.transport.requests import Request, AuthorizedSession
from google_auth_oauthlib.flow import InstalledAppFlow

# --- CONFIGURATION ---
# TODO: Insert your Google Workspace Customer ID (e.g., "customers/C0xxxxxxx")
CUSTOMER_ID = "customers/C0xxxxxxx"

# Scopes required for Cloud Identity Policies
SCOPES = [
    "https://www.googleapis.com/auth/cloud-identity.policies",          # Mutation
    "https://www.googleapis.com/auth/cloud-identity.policies.readonly"  # Read-only
]

# API Endpoints
BASE_URL_READ = "https://cloudidentity.googleapis.com/v1/policies"
BASE_URL_WRITE = "https://cloudidentity.googleapis.com/v1beta1/policies"

# --- AUTH SWITCH ---
USE_SERVICE_ACCOUNT = False 

# File Paths
# TODO: Ensure these point to your valid Google Cloud credential files
SERVICE_ACCOUNT_FILE = "service_account.json"
CLIENT_SECRETS_FILE = "client_secrets.json"
TOKEN_PICKLE_FILE = "token_dlp.pickle"

DEBUG = False

# DLP Filters based on Common Expression Language (CEL) syntax
DLP_FILTERS = {
    "rules": 'setting.type.matches("settings/rule.dlp")',
    "word_list": 'setting.type.matches("settings/detector.word_list")',
    "regex": 'setting.type.matches("settings/detector.regular_expression")',
    "url_list": 'setting.type.matches("settings/detector.url_list")'
}

def log_exception(context, error):
    """Logs errors to a file if DEBUG is enabled."""
    if DEBUG:
        try:
            with open("dlp_debug_log.txt", "a", encoding="utf-8") as f:
                timestamp = datetime.datetime.now().isoformat()
                f.write(f"\n[{timestamp}] ERROR in {context}:\n{error}\n{traceback.format_exc()}\n")
        except: pass

def get_session():
    """Authenticates and returns an AuthorizedSession for REST calls."""
    creds = None
    try:
        if USE_SERVICE_ACCOUNT:
            print("Mode: Service Account Authentication")
            if not os.path.exists(SERVICE_ACCOUNT_FILE):
                raise FileNotFoundError(f"Service account file '{SERVICE_ACCOUNT_FILE}' not found.")
            creds = service_account.Credentials.from_service_account_file(
                SERVICE_ACCOUNT_FILE, scopes=SCOPES
            )
            print(" -> Service Account credentials loaded.")
        else:
            print("Mode: User Authentication (OAuth 2.0)")
            if os.path.exists(TOKEN_PICKLE_FILE):
                with open(TOKEN_PICKLE_FILE, "rb") as token:
                    creds = pickle.load(token)
            if not creds or not creds.valid:
                if creds and creds.expired and creds.refresh_token:
                    print(" -> Refreshing expired token...")
                    creds.refresh(Request())
                else:
                    print(" -> Starting browser login flow...")
                    if not os.path.exists(CLIENT_SECRETS_FILE):
                        raise FileNotFoundError(f"'{CLIENT_SECRETS_FILE}' not found.")
                    flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRETS_FILE, SCOPES)
                    creds = flow.run_local_server(port=0)
                with open(TOKEN_PICKLE_FILE, "wb") as token:
                    pickle.dump(creds, token)
            print(" -> User credentials loaded.")
        
        return AuthorizedSession(creds)
    except Exception as e:
        print(f"Authentication failed: {e}")
        log_exception("get_session", e)
        return None

def fetch_policies_by_filter(session, filter_string, label):
    """Fetches a specific type of DLP policy using the v1 Read API with rate limiting."""
    print(f"Fetching {label}...")
    params = {'filter': filter_string, 'pageSize': 50}
    policies = []
    page_token = None

    try:
        while True:
            if page_token: params['pageToken'] = page_token
            time.sleep(1.5) # THROTTLE: 1.5 second delay to prevent 429 RESOURCE_EXHAUSTED
            
            response = session.get(BASE_URL_READ, params=params)
            if response.status_code != 200:
                print(f" -> Error fetching {label}: HTTP {response.status_code} - {response.text}")
                log_exception(f"fetch_{label}", response.text)
                break
            
            data = response.json()
            if 'policies' in data:
                policies.extend(data['policies'])
            
            page_token = data.get('nextPageToken')
            if not page_token: break
                
        print(f" -> Found {len(policies)} {label} (total).")
        return policies
    except Exception as e:
        print(f" -> Exception fetching {label}: {e}")
        log_exception(f"fetch_{label}", e)
        return []

def filter_chrome_only_rules(raw_rules):
    """Filters a list of DLP rules, returning only those with Chrome triggers."""
    chrome_rules = []
    for rule in raw_rules:
        triggers = rule.get("setting", {}).get("value", {}).get("triggers", [])
        if any("google.workspace.chrome" in trigger for trigger in triggers):
            chrome_rules.append(rule)
    print(f" -> Filtered down to {len(chrome_rules)} Chrome-specific rules.")
    return chrome_rules

def export_all_dlp_configs(session, output_file):
    """Exports Chrome DLP Rules and all Detectors to a single JSON file."""
    print(f"\nStarting Chrome DLP Export for {CUSTOMER_ID}...")
    
    raw_rules = fetch_policies_by_filter(session, DLP_FILTERS["rules"], "DLP Rules")
    chrome_rules = filter_chrome_only_rules(raw_rules)
    
    all_configs = {
        "rules": chrome_rules,
        "word_list_detectors": fetch_policies_by_filter(session, DLP_FILTERS["word_list"], "Word List Detectors"),
        "regex_detectors": fetch_policies_by_filter(session, DLP_FILTERS["regex"], "Regex Detectors"),
        "url_list_detectors": fetch_policies_by_filter(session, DLP_FILTERS["url_list"], "URL List Detectors")
    }
    
    total_items = sum(len(items) for items in all_configs.values())
    output_data = {
        "meta": {
            "customer_id": CUSTOMER_ID,
            "exported_at": str(datetime.datetime.now()),
            "format": "cep_dlp_chrome_export",
            "total_items": total_items
        },
        "dlp_configurations": all_configs
    }

    if not output_file:
        timestamp = datetime.datetime.now().strftime("%b_%d_%Y_%H-%M")
        output_file = f"chrome_dlp_export_{timestamp}.json"

    try:
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, indent=2, sort_keys=True)
        print(f"\nSuccessfully exported {total_items} configurations to: {output_file}")
    except Exception as e:
        print(f"Failed to write file: {e}")
        log_exception("export_write_file", e)

def clean_policy_for_import(policy_obj, target_ou_id=None, target_group_id=None):
    """
    Strips system fields (root and nested) and establishes the policyQuery block.
    """
    import_obj = policy_obj.copy()
    
    # 1. Remove Root Read-Only System Fields
    for field in ['name', 'createTime', 'updateTime', 'deleteTime', 'etag']:
        import_obj.pop(field, None)
        
    # 2. Remove Nested Read-Only Fields inside setting.value
    setting_value = import_obj.get('setting', {}).get('value', {})
    for field in ['createTime', 'updateTime']:
        setting_value.pop(field, None)
        
    # 3. Reassign Customer ID
    import_obj['customer'] = CUSTOMER_ID
    
    # 4. Construct Target Policy Query dynamically
    if target_ou_id:
        import_obj['policyQuery'] = {
            "query": f"entity.org_units.exists(org_unit, org_unit.org_unit_id == orgUnitId('{target_ou_id}'))",
            "orgUnit": f"orgUnits/{target_ou_id}"
        }
    elif target_group_id:
        import_obj['policyQuery'] = {
            "query": f"entity.groups.exists(group, group.group_id == groupId('{target_group_id}'))",
            "group": f"groups/{target_group_id}",
            "sortOrder": 1
        }
    elif 'policyQuery' not in import_obj:
        raise ValueError("No policyQuery found in rule and no CLI override provided.")
    
    # 5. Prevent Error Code 7 by removing empty nested dictionaries recursively
    def remove_empty_dicts(d):
        if not isinstance(d, dict): return d
        return {k: remove_empty_dicts(v) for k, v in d.items() if v != {}}
        
    return remove_empty_dicts(import_obj)

def import_detectors(session, detectors, label, target_ou_id, target_group_id, id_mapping):
    """Imports a specific list of detectors and maps their old IDs to the new ones."""
    if not detectors: return

    print(f"\n -> Importing {len(detectors)} {label}...")
    for detector in detectors:
        old_id = detector.get("name")
        display_name = detector.get("setting", {}).get("value", {}).get("displayName", "Unknown Detector")
        print(f"    -> Creating: '{display_name}'...")
        
        try:
            cleaned_payload = clean_policy_for_import(detector, target_ou_id, target_group_id)
        except ValueError as ve:
            print(f"       [FAILED] {ve}")
            continue

        time.sleep(1.5) # THROTTLE
        response = session.post(BASE_URL_WRITE, json=cleaned_payload)
        
        if response.status_code == 200:
            resp_json = response.json()
            if 'error' in resp_json:
                print(f"       [FAILED] Logical Error: {resp_json['error']}")
                log_exception(f"import_detector_{display_name}", resp_json)
            else:
                # Capture the new ID for Dependency Mapping
                new_id = resp_json.get('response', {}).get('name')
                print(f"       [SUCCESS] Created: {new_id}")
                if old_id and new_id:
                    id_mapping[old_id] = new_id
        else:
            print(f"       [FAILED] HTTP {response.status_code}: {response.text}")
            log_exception(f"import_detector_http_{display_name}", response.text)

def import_dlp_configs(session, input_file, target_ou_id=None, target_group_id=None):
    """Coordinates the import of Detectors first, maps IDs, then imports Rules."""
    if not os.path.exists(input_file):
        print(f"Error: Import file '{input_file}' not found.")
        return
        
    try:
        with open(input_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
        configs = data.get("dlp_configurations", {})
        
        # Determine logging prefix based on mode
        if target_ou_id or target_group_id:
            target_label = f"OU: {target_ou_id}" if target_ou_id else f"Group: {target_group_id}"
            print(f"\n=== Starting Full Import (OVERRIDING target to {target_label}) ===")
        else:
            print(f"\n=== Starting Full Import (Using targets defined natively in JSON) ===")
        
        # Dictionary to hold { "old_detector_policy_id": "new_detector_policy_id" }
        id_mapping = {}

        # 1. Import Detectors First
        import_detectors(session, configs.get("word_list_detectors", []), "Word List Detectors", target_ou_id, target_group_id, id_mapping)
        import_detectors(session, configs.get("regex_detectors", []), "Regex Detectors", target_ou_id, target_group_id, id_mapping)
        import_detectors(session, configs.get("url_list_detectors", []), "URL List Detectors", target_ou_id, target_group_id, id_mapping)

        # 2. Import Rules
        rules = configs.get("rules", [])
        if not rules:
            print("\nNo DLP rules found to import.")
            return

        print(f"\n -> Importing {len(rules)} DLP Rules...")
        for rule in rules:
            display_name = rule.get("setting", {}).get("value", {}).get("displayName", "Unknown Rule")
            print(f"    -> Creating Rule: '{display_name}'...")
            
            # 2a. Perform Dependency Mapping (Patch old detector IDs with new ones)
            condition_str = rule.get("setting", {}).get("value", {}).get("condition", {}).get("contentCondition", "")
            if condition_str:
                for old_id, new_id in id_mapping.items():
                    if old_id in condition_str:
                        condition_str = condition_str.replace(old_id, new_id)
                        print(f"       [Mapped Dependency: {old_id} -> {new_id}]")
                # Update the rule with the patched condition string
                rule["setting"]["value"]["condition"]["contentCondition"] = condition_str

            try:
                cleaned_payload = clean_policy_for_import(rule, target_ou_id=target_ou_id, target_group_id=target_group_id)
            except ValueError as ve:
                print(f"       [FAILED] {ve}")
                continue
            
            time.sleep(1.5) # THROTTLE
            response = session.post(BASE_URL_WRITE, json=cleaned_payload)
            
            if response.status_code == 200:
                resp_json = response.json()
                if 'error' in resp_json:
                    print(f"       [FAILED] Logical Error: {resp_json['error']}")
                    log_exception(f"import_rule_{display_name}", resp_json)
                else:
                    new_rule_id = resp_json.get('response', {}).get('name')
                    print(f"       [SUCCESS] Created: {new_rule_id}")
            else:
                print(f"       [FAILED] HTTP {response.status_code}: {response.text}")
                log_exception(f"import_rule_http_{display_name}", response.text)
                
    except Exception as e:
        print(f"Exception during full import: {e}")
        log_exception("import_dlp_configs", e)

def main():
    parser = argparse.ArgumentParser(description="Manage Chrome Enterprise Premium DLP Policies.")
    subparsers = parser.add_subparsers(dest='command', help='Action to perform')
    
    # Export Command
    parser_export = subparsers.add_parser('export', help='Export Chrome DLP Rules and all Detectors')
    parser_export.add_argument("--file", help="Output JSON filename.")
    
    # Import Command
    parser_import = subparsers.add_parser('import', help='Import Detectors and Rules from a JSON export')
    parser_import.add_argument("--file", required=True, help="Input JSON filename to import.")
    
    target_group = parser_import.add_mutually_exclusive_group(required=False)
    target_group.add_argument("--ou-id", help="Override: Apply all configs to this Target Org Unit ID")
    target_group.add_argument("--group-id", help="Override: Apply all configs to this Target Group ID")

    # Global Flags
    parser.add_argument("--use-service-account", action="store_true", help="Force Service Account Auth")
    parser.add_argument("--debug", action="store_true", help="Enable debug logging to file")
    
    args = parser.parse_args()

    global USE_SERVICE_ACCOUNT, DEBUG
    if args.use_service_account: USE_SERVICE_ACCOUNT = True
    if args.debug: DEBUG = True

    session = get_session()
    if not session: return

    if args.command == 'export':
        export_all_dlp_configs(session, args.file)
        
    elif args.command == 'import':
        import_dlp_configs(session, args.file, target_ou_id=args.ou_id, target_group_id=args.group_id)
        
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
