# -*- coding: utf-8 -*-
# Copyright 2024 Google LLC
# Licensed under the Apache License, Version 2.0
"""
Chrome Policy Importer
Purpose: Imports policies from JSON to OU/Group.
Features:
  - AUTO-FIX: Injects 'InstallType: ALLOWED' for orphaned app configurations.
  - FIXED: Correctly passes 'app_id' for extensions.
  - FIXED: Groups requests by namespace to prevent batch errors.
  - Auth Modes: Service Account (IAM) & OAuth 2.0 (User).
"""

import argparse
import json
import os.path
import pickle
import traceback
import sys
import datetime
from collections import defaultdict

from google.oauth2 import service_account
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

SCOPES = ["https://www.googleapis.com/auth/chrome.management.policy"]
# TODO: Insert your Customer ID
CUSTOMER_ID = "customers/INSERT_YOUR_CUSTOMER_ID_HERE"

# --- AUTH SWITCH ---
USE_SERVICE_ACCOUNT = False 

SERVICE_ACCOUNT_FILE = "service_account.json"
CLIENT_SECRETS_FILE = "client_secrets.json"
TOKEN_PICKLE_FILE = "token.pickle"

DEBUG = False
ROOT_RESTRICTED_POLICIES = []

def log_exception(context, error):
    if DEBUG:
        try:
            with open("debug_log.txt", "a", encoding="utf-8") as f:
                timestamp = datetime.datetime.now().isoformat()
                f.write(f"\n[{timestamp}] ERROR in {context}:\n{error}\n{traceback.format_exc()}\n")
        except: pass

def get_credentials():
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
        return creds
    except Exception as e:
        print(f"Authentication failed: {e}")
        log_exception("get_credentials", e)
        return None

def get_root_restricted_policies(service):
    print("\nFetching restricted policies list...")
    restricted = []
    page_token = None
    try:
        while True:
            req = service.customers().policySchemas().list(
                parent=CUSTOMER_ID, filter="access_restrictions=root", pageSize=100, pageToken=page_token
            )
            res = req.execute()
            for schema in res.get("policySchemas", []):
                if "schemaName" in schema: restricted.append(schema["schemaName"])
            page_token = res.get("nextPageToken")
            if not page_token: break
        return restricted
    except Exception as e:
        print(f"Warning: Could not fetch restricted policies: {e}")
        return []

def is_migratable(schema):
    if schema in ROOT_RESTRICTED_POLICIES:
        print(f"  -> Skipping restricted policy: {schema}")
        return False
    return True

def get_namespace(policy_schema):
    if "." in policy_schema:
        return policy_schema.rsplit(".", 1)[0]
    return policy_schema

def apply_policies(service, export_data, target_id):
    if isinstance(export_data, list):
        print("Error: Legacy export file detected.")
        return

    meta = export_data.get("meta", {})
    policies = export_data.get("policies", [])
    source_type = meta.get("source_type", "unknown")
    
    target_is_group = target_id.startswith("groups/")
    target_is_ou = target_id.startswith("orgunits/")

    if source_type == "orgunit" and not target_is_ou:
        print("\n[!] VALIDATION ERROR: Cannot import OU export to Group.")
        return
    if source_type == "group" and not target_is_group:
        print("\n[!] VALIDATION ERROR: Cannot import Group export to OU.")
        return

    print(f"\nProcessing {len(policies)} policies for import...")

    batched_requests = defaultdict(list)
    apps_with_install_type = set()
    configured_apps = set()

    for policy_data in policies:
        val_obj = policy_data.get("value", {})
        if "policySchema" in val_obj:
            schema = val_obj.get("policySchema")
            settings = val_obj.get("value")
        else:
            schema = policy_data.get("policySchema")
            settings = policy_data.get("value")

        if not schema or not settings or not is_migratable(schema): continue

        namespace = get_namespace(schema)
        
        # --- APP ID HANDLING ---
        policy_target_key = {"targetResource": target_id}
        original_target_key = policy_data.get("targetKey", {})
        additional_keys = original_target_key.get("additionalTargetKeys")
        
        app_id = None
        if additional_keys:
            policy_target_key["additionalTargetKeys"] = additional_keys
            app_id = additional_keys.get("app_id")

        if app_id:
            configured_apps.add(app_id)
            if schema == "chrome.users.apps.InstallType":
                apps_with_install_type.add(app_id)
        # -----------------------

        batched_requests[namespace].append({
            "policyTargetKey": policy_target_key,
            "policyValue": {"policySchema": schema, "value": settings},
            "updateMask": {"paths": list(settings.keys())}
        })

    # --- AUTO-FIX ORPHANS ---
    orphaned_apps = configured_apps - apps_with_install_type
    if orphaned_apps:
        print(f"[*] Auto-Fix: Found {len(orphaned_apps)} apps with missing InstallType. Injecting defaults...")
        for app_id in orphaned_apps:
            print(f"  -> Injecting 'InstallType: ALLOWED' for {app_id}")
            fix_request = {
                "policyTargetKey": {
                    "targetResource": target_id,
                    "additionalTargetKeys": {"app_id": app_id}
                },
                "policyValue": {
                    "policySchema": "chrome.users.apps.InstallType",
                    "value": {"appInstallType": "ALLOWED"}
                },
                "updateMask": {"paths": ["appInstallType"]}
            }
            batched_requests["chrome.users.apps"].append(fix_request)

    if not batched_requests:
        print("No valid policies to apply.")
        return

    for namespace, requests in batched_requests.items():
        print(f"Sending batch for namespace '{namespace}' ({len(requests)} policies)...")
        try:
            body = {"requests": requests}
            if target_is_ou:
                service.customers().policies().orgunits().batchModify(customer=CUSTOMER_ID, body=body).execute()
            elif target_is_group:
                service.customers().policies().groups().batchModify(customer=CUSTOMER_ID, body=body).execute()
            print("  -> Success.")
        except HttpError as e:
            print(f"  -> API Error: {e}")
            log_exception(f"apply_policies ({namespace})", e)
    print("\nImport operation complete.")

def main():
    parser = argparse.ArgumentParser(description="Import Chrome Policies.")
    parser.add_argument("file", help="Path to JSON file")
    parser.add_argument("target_id", help="Target OU or Group ID")
    parser.add_argument("--use-service-account", action="store_true", help="Force Service Account Auth")
    args = parser.parse_args()

    global USE_SERVICE_ACCOUNT
    if args.use_service_account:
        USE_SERVICE_ACCOUNT = True

    if not os.path.exists(args.file):
        print(f"Error: File '{args.file}' not found.")
        return

    try:
        with open(args.file, 'r', encoding='utf-8') as f:
            export_data = json.load(f)
    except Exception:
        print(f"Error: Invalid JSON.")
        return

    creds = get_credentials()
    if not creds: return

    try:
        service = build("chromepolicy", "v1", credentials=creds)
    except Exception as e:
        print(f"Service build failed: {e}")
        return

    global ROOT_RESTRICTED_POLICIES
    ROOT_RESTRICTED_POLICIES = get_root_restricted_policies(service)
    apply_policies(service, export_data, args.target_id)

if __name__ == "__main__":
    main()
