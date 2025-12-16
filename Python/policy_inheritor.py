# -*- coding: utf-8 -*-
# Copyright 2024 Google LLC
# Licensed under the Apache License, Version 2.0
"""
Chrome Policy Inheritor (Cleaner)
Purpose: Reverts "Locally Applied" policies to "Inherited" status.
Features:
  - FIXED: Uses 'chrome.users.apps.*' wildcard to cleanly remove/reset Apps.
  - Root Protection: Skips root-restricted policies.
  - Namespace Batching: Prevents API errors.
  - Dual Auth: Service Account (IAM) & OAuth 2.0 (User).
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

USE_SERVICE_ACCOUNT = False 
SERVICE_ACCOUNT_FILE = "service_account.json"
CLIENT_SECRETS_FILE = "client_secrets.json"
TOKEN_PICKLE_FILE = "token.pickle"

DEBUG = False
POLICY_FILTERS = ["chrome.users.*", "chrome.users.apps.*"]
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

def is_safe_to_inherit(schema):
    if schema in ROOT_RESTRICTED_POLICIES:
        return False
    return True

def get_namespace(policy_schema):
    if "." in policy_schema:
        return policy_schema.rsplit(".", 1)[0]
    return policy_schema

def get_local_policies(service, target_ou):
    print(f"\nScanning for local policies on '{target_ou}'...")
    local_policies = []
    try:
        for schema_filter in POLICY_FILTERS:
            page_token = None
            while True:
                body = {
                    "policyTargetKey": {"targetResource": target_ou},
                    "policySchemaFilter": schema_filter,
                    "pageSize": 1000,
                    "pageToken": page_token
                }
                req = service.customers().policies().resolve(customer=CUSTOMER_ID, body=body)
                res = req.execute()
                
                for policy in res.get("resolvedPolicies", []):
                    source = policy.get("sourceKey", {}).get("targetResource")
                    if source == target_ou:
                        local_policies.append(policy)

                page_token = res.get("nextPageToken")
                if not page_token: break
                
        print(f" -> Found {len(local_policies)} policies locally applied.")
        return local_policies
    except Exception as e:
        print(f"Error scanning policies: {e}")
        log_exception("get_local_policies", e)
        return []

def clean_policies(service, policies, target_ou):
    """
    Cleans policies by:
    1. Using batchInherit for Standard User Policies.
    2. Using batchInherit with 'chrome.users.apps.*' for Apps (Reset/Delete).
    """
    if not policies:
        print("No local policies found to clean.")
        return

    print(f"\nPreparing to clean {len(policies)} policies...")
    
    inherit_requests = defaultdict(list)
    apps_to_reset = set()
    skipped_count = 0

    for p in policies:
        val_obj = p.get("value", {})
        schema = val_obj.get("policySchema")
        
        if not schema: continue
        
        # Safety: Skip Root-Restricted
        if not is_safe_to_inherit(schema):
            print(f"  -> Skipping Root-Restricted policy: {schema}")
            skipped_count += 1
            continue
        
        # --- LOGIC SPLIT ---
        # CASE A: App Policy -> Collect App ID for a single Wildcard Reset
        if schema.startswith("chrome.users.apps"):
            target_key_meta = p.get("targetKey", {})
            additional_keys = target_key_meta.get("additionalTargetKeys", {})
            app_id = additional_keys.get("app_id")
            if app_id:
                apps_to_reset.add(app_id)
            
        # CASE B: Standard Policy -> Inherit individually
        else:
            namespace = get_namespace(schema)
            target_key = {"targetResource": target_ou}
            
            inherit_req = {
                "policySchema": schema,
                "policyTargetKey": target_key
            }
            inherit_requests[namespace].append(inherit_req)

    if skipped_count > 0:
        print(f"Skipped {skipped_count} root-restricted policies.")

    # 1. Add App Resets to the Batch
    if apps_to_reset:
        print(f"[*] Found {len(apps_to_reset)} unique apps to reset.")
        for app_id in apps_to_reset:
            # Construct the Wildcard Reset Request
            reset_req = {
                "policySchema": "chrome.users.apps.*", # Wildcard
                "policyTargetKey": {
                    "targetResource": target_ou,
                    "additionalTargetKeys": {"app_id": app_id}
                }
            }
            # Add to the apps namespace batch
            inherit_requests["chrome.users.apps"].append(reset_req)

    # 2. Execute Batch Inherit Requests
    for namespace, requests in inherit_requests.items():
        print(f"Sending batch INHERIT for '{namespace}' ({len(requests)} requests)...")
        try:
            body = {"requests": requests}
            service.customers().policies().orgunits().batchInherit(
                customer=CUSTOMER_ID, body=body
            ).execute()
            print("  -> Success.")
        except HttpError as e:
            print(f"  -> API Error: {e}")
            log_exception(f"clean_policies ({namespace})", e)
    
    print("\nOperation complete.")

def main():
    parser = argparse.ArgumentParser(description="Revert Chrome Policies to Inherited.")
    parser.add_argument("target_ou", help="The OU ID to clean (orgunits/...)")
    parser.add_argument("--use-service-account", action="store_true", help="Force Service Account Auth")
    args = parser.parse_args()

    global USE_SERVICE_ACCOUNT
    if args.use_service_account:
        USE_SERVICE_ACCOUNT = True
    
    if not args.target_ou.startswith("orgunits/"):
        print("Error: Target must be an Organizational Unit (orgunits/...).")
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

    local_policies = get_local_policies(service, args.target_ou)
    
    if local_policies:
        print(f"\nWarning: You are about to clear {len(local_policies)} local policies on {args.target_ou}.")
        confirm = input(f"Continue? (y/n): ")
        if confirm.lower() == 'y':
            clean_policies(service, local_policies, args.target_ou)
        else:
            print("Operation cancelled.")

if __name__ == "__main__":
    main()
