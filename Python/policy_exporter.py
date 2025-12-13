# -*- coding: utf-8 -*-
# Copyright 2024 Google LLC
# Licensed under the Apache License, Version 2.0
"""
Chrome Policy Exporter
Purpose: Exports policies to JSON for Git version control or backup.
Features: 
  - FIXED: App Deduplication Logic (correctly exports ALL apps).
  - Raw JSON export (preserves metadata).
  - Dual Auth: Service Account (IAM) & OAuth 2.0 (User).
"""

import argparse
import json
import os.path
import pickle
import datetime
import traceback
import sys

# Imports for Service Account
from google.oauth2 import service_account

# Imports for User OAuth
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

SCOPES = ["https://www.googleapis.com/auth/chrome.management.policy"]
# TODO: Insert your Customer ID
CUSTOMER_ID = "customers/INSERT_YOUR_CUSTOMER_ID_HERE"

# --- AUTH SWITCH ---
USE_SERVICE_ACCOUNT = False 

# File Paths
SERVICE_ACCOUNT_FILE = "service_account.json"
CLIENT_SECRETS_FILE = "client_secrets.json"
TOKEN_PICKLE_FILE = "token.pickle"

DEBUG = False
# Filters to capture Core User Policies + App/Extension Policies
POLICY_FILTERS = ["chrome.users.*", "chrome.users.apps.*"]

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

def get_resolved_policies(service, target_resource, local_only=False):
    is_group = target_resource.startswith("groups/")
    unique_policies_map = {}
    print(f"\nFetching policies for '{target_resource}'...")

    try:
        for schema_filter in POLICY_FILTERS:
            page_token = None
            while True:
                body = {
                    "policyTargetKey": {"targetResource": target_resource},
                    "policySchemaFilter": schema_filter,
                    "pageSize": 1000,
                    "pageToken": page_token
                }
                req = service.customers().policies().resolve(customer=CUSTOMER_ID, body=body)
                res = req.execute()
                
                for policy in res.get("resolvedPolicies", []):
                    # Local Only Filter
                    if local_only and not is_group:
                        source = policy.get("sourceKey", {}).get("targetResource")
                        if source != target_resource: continue
                    
                    # --- DEDUPLICATION LOGIC ---
                    val = policy.get("value", {})
                    schema = val.get("policySchema")
                    
                    if not schema: continue

                    # Construct unique key: Schema + App ID (if present)
                    target_key_meta = policy.get("targetKey", {})
                    additional_keys = target_key_meta.get("additionalTargetKeys", {})
                    
                    if additional_keys:
                        add_keys_str = json.dumps(additional_keys, sort_keys=True)
                        unique_key = f"{schema}:{add_keys_str}"
                    else:
                        unique_key = schema
                    
                    unique_policies_map[unique_key] = policy
                    # ---------------------------

                page_token = res.get("nextPageToken")
                if not page_token: break
        
        all_policies = list(unique_policies_map.values())
        print(f"Total Unique Policies Found: {len(all_policies)}")
        return all_policies
    except Exception as e:
        print(f"Error fetching policies: {e}")
        log_exception("get_resolved_policies", e)
        return None

def export_policies_to_file(policies, target_id, output_file):
    if not policies:
        print("No policies to export.")
        return

    source_type = "group" if target_id.startswith("groups/") else "orgunit"
    
    # Sort by schema
    sorted_policies = sorted(policies, key=lambda x: x.get('value', {}).get('policySchema', ''))

    output_data = {
        "meta": {
            "source_type": source_type,
            "source_id": target_id,
            "exported_at": str(datetime.datetime.now()),
            "format": "raw"
        },
        "policies": sorted_policies
    }

    try:
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, indent=2, sort_keys=True)
        print(f"\nSuccessfully exported policies to: {output_file}")
    except Exception as e:
        print(f"Failed to write file: {e}")

def main():
    parser = argparse.ArgumentParser(description="Export Chrome Policies to JSON.")
    parser.add_argument("target_id", help="OU ID (orgunits/...) or Group ID (groups/...)")
    parser.add_argument("--local-only", action="store_true", help="Ignore inherited policies")
    parser.add_argument("--file", help="Output filename.")
    parser.add_argument("--use-service-account", action="store_true", help="Force Service Account Auth")
    args = parser.parse_args()

    global USE_SERVICE_ACCOUNT
    if args.use_service_account:
        USE_SERVICE_ACCOUNT = True

    creds = get_credentials()
    if not creds: return
    
    try:
        service = build("chromepolicy", "v1", credentials=creds)
    except Exception as e:
        print(f"Service build failed: {e}")
        return

    policies = get_resolved_policies(service, args.target_id, args.local_only)
    
    if policies:
        filename = args.file
        if not filename:
            timestamp = datetime.datetime.now().strftime("%b_%d_%Y_%H-%M")
            safe_id = args.target_id.replace("/", "_")
            filename = f"{safe_id}_{timestamp}.json"
        export_policies_to_file(policies, args.target_id, filename)

if __name__ == "__main__":
    main()
