# -*- coding: utf-8 -*-
# Copyright 2026 Google LLC
# Licensed under the Apache License, Version 2.0
"""
Chrome Browser Add to Group Utility
Purpose: Adds enrolled Chrome browsers to a target Cloud Identity Group based on a list of machine names.
Features:
  - Translates Machine Names to Device IDs via the v1.1beta1 Directory API.
  - Adds each Device ID to the Cloud Identity Group using the Google API Python Client.
  - Uses the 'cbcm-browser.' prefix to correctly bypass email validation for Chrome devices.
  - Dual Authentication (OAuth & Service Account).
  - Automatically parses customer IDs to ensure cross-API compatibility.
  - Generates a clean Execution Summary instead of bloating logs.
"""

import argparse
import csv
import json
import os
import pickle
import time
import logging

from google.oauth2 import service_account
from google.auth.transport.requests import Request, AuthorizedSession
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# --- CONFIGURATION ---
# TODO: Insert your Google Workspace Customer ID (e.g., "customers/C0xxxxxxx" or "my_customer")
CUSTOMER_ID = "customers/C0xxxxxxx" 

# Parse the raw ID for the Admin SDK (strips 'customers/' if present)
RAW_CUSTOMER_ID = CUSTOMER_ID.replace('customers/', '') if str(CUSTOMER_ID).startswith('customers/') else CUSTOMER_ID

SCOPES = [
    "https://www.googleapis.com/auth/admin.directory.device.chromebrowsers.readonly", 
    "https://www.googleapis.com/auth/cloud-identity.groups"       
]

# File Paths
SERVICE_ACCOUNT_FILE = "service_account.json"
CLIENT_SECRETS_FILE = "client_secrets.json"
TOKEN_PICKLE_FILE = "token_browser_group.pickle"

# Setup Logging
logger = logging.getLogger("BrowserGroupLogger")
logger.setLevel(logging.INFO)
formatter = logging.Formatter('%(asctime)s [%(levelname)s] %(message)s', datefmt='%Y-%m-%d %H:%M:%S')

ch = logging.StreamHandler()
ch.setFormatter(formatter)
logger.addHandler(ch)

fh = logging.FileHandler("browser_group_log.txt", encoding="utf-8")
fh.setFormatter(formatter)
logger.addHandler(fh)

def get_auth(use_service_account):
    """Authenticates and returns both the raw creds and an AuthorizedSession."""
    creds = None
    try:
        if use_service_account:
            logger.info("Mode: Service Account Authentication")
            if not os.path.exists(SERVICE_ACCOUNT_FILE):
                raise FileNotFoundError(f"Service account file '{SERVICE_ACCOUNT_FILE}' not found.")
            creds = service_account.Credentials.from_service_account_file(
                SERVICE_ACCOUNT_FILE, scopes=SCOPES
            )
            logger.info(" -> Service Account credentials loaded.")
        else:
            logger.info("Mode: User Authentication (OAuth 2.0)")
            if os.path.exists(TOKEN_PICKLE_FILE):
                with open(TOKEN_PICKLE_FILE, "rb") as token:
                    creds = pickle.load(token)
            if not creds or not creds.valid:
                if creds and creds.expired and creds.refresh_token:
                    logger.info(" -> Refreshing expired token...")
                    creds.refresh(Request())
                else:
                    logger.info(" -> Starting browser login flow...")
                    if not os.path.exists(CLIENT_SECRETS_FILE):
                        raise FileNotFoundError(f"'{CLIENT_SECRETS_FILE}' not found.")
                    flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRETS_FILE, SCOPES)
                    creds = flow.run_local_server(port=0)
                with open(TOKEN_PICKLE_FILE, "wb") as token:
                    pickle.dump(creds, token)
            logger.info(" -> User credentials loaded.")
        
        return creds, AuthorizedSession(creds)
    except Exception as e:
        logger.error(f"Authentication failed: {e}")
        return None, None

def read_machine_names(file_path):
    """Reads machine names from a text or CSV file, supporting both horizontal and vertical layouts."""
    machine_names = []
    if not os.path.exists(file_path):
        logger.error(f"Input file '{file_path}' not found.")
        return machine_names

    logger.info(f"Reading machine names from: {file_path}")
    with open(file_path, 'r', encoding='utf-8') as f:
        for line in f:
            parts = line.split(',')
            for part in parts:
                name = part.strip()
                if name:
                    machine_names.append(name)
    
    unique_names = list(set(machine_names))
    logger.info(f" -> Found {len(unique_names)} unique machine names to process.")
    return unique_names

def fetch_device_ids(session, machine_names):
    """Translates a list of machine names into Google deviceIds silently."""
    logger.info("Starting Device ID lookup phase (this may take a moment)...")
    device_ids = []
    not_found = []

    for name in machine_names:
        query = f"machine_name:{name}"
        url = f"https://www.googleapis.com/admin/directory/v1.1beta1/customer/{RAW_CUSTOMER_ID}/devices/chromebrowsers"
        params = {
            "query": query,
            "projection": "BASIC"
        }
        
        response = session.get(url, params=params)
        
        if response.status_code == 200:
            data = response.json()
            if 'browsers' in data and len(data['browsers']) > 0:
                dev_id = data['browsers'][0].get('deviceId')
                device_ids.append(dev_id)
            else:
                not_found.append(name)
        elif response.status_code == 429:
            time.sleep(2)
            not_found.append(name) 
        else:
            not_found.append(name)
            
        time.sleep(0.1)

    logger.info("Lookup Complete.")
    return device_ids, not_found

def verify_group(cloudidentity_service, group_id):
    """Looks up the target group by group ID using the Cloud Identity Client Library."""
    logger.info(f"Verifying target group: {group_id}...")
    group_name = group_id if str(group_id).startswith('groups/') else f"groups/{group_id}"
    
    try:
        request = cloudidentity_service.groups().get(name=group_name)
        response = request.execute()
        verified_group_name = response.get("name")
        logger.info(f" -> Group verified successfully. Resource Name: {verified_group_name}")
        return verified_group_name
    except HttpError as e:
        logger.error(f" -> Group lookup failed for '{group_id}'. HTTP {e.resp.status}: {e.content.decode('utf-8')}")
        return None
    except Exception as e:
        logger.error(f" -> Group lookup failed for '{group_id}': {e}")
        return None

def add_browsers_to_group(cloudidentity_service, device_ids, group_id):
    """Adds the translated device IDs to the Cloud Identity Group using the Python Client."""
    if not device_ids:
        logger.info("No valid device IDs to add. Skipping add operation.")
        return 0, 0

    logger.info(f"Starting Add Operation to Group: {group_id} ...")
    parent = group_id if str(group_id).startswith('groups/') else f"groups/{group_id}"
    
    success_count = 0
    failure_count = 0
    
    for idx, dev_id in enumerate(device_ids):
        # Correctly identifies the entity using the cbcm-browser prefix
        preferred_member_id = f"cbcm-browser.{dev_id}"
        
        payload = {
            "preferredMemberKey": {
                "id": preferred_member_id
            },
            "roles": [{"name": "MEMBER"}]
        }
        
        try:
            request = cloudidentity_service.groups().memberships().create(
                parent=parent, 
                body=payload
            )
            request.execute()
            success_count += 1
            
        except HttpError as e:
            if e.resp.status == 409:
                logger.info(f"    [SKIP] Device ID {dev_id} is already a member of the group.")
                success_count += 1
            else:
                logger.error(f"    [FAILED] HTTP {e.resp.status} for Device {dev_id}: {e.content.decode('utf-8')}")
                failure_count += 1
        except Exception as e:
            logger.error(f"    [FAILED] Unexpected error for Device {dev_id}: {e}")
            failure_count += 1
            
        time.sleep(0.1)
        
        if (idx + 1) % 50 == 0:
            logger.info(f" -> Processed {idx + 1} of {len(device_ids)} devices...")
        
    return success_count, failure_count

def main():
    parser = argparse.ArgumentParser(description="Add Enrolled Chrome Browsers to a Target Cloud Identity Group.")
    parser.add_argument("--file", required=True, help="Path to TXT or CSV file containing machine names.")
    parser.add_argument("--group-id", required=True, help="The target Google Cloud Identity Group email or ID key")
    parser.add_argument("--use-service-account", action="store_true", help="Force Service Account Authentication")
    
    args = parser.parse_args()

    creds, session = get_auth(args.use_service_account)
    if not creds or not session: return

    try:
        cloudidentity_service = build('cloudidentity', 'v1', credentials=creds)
    except Exception as e:
        logger.error(f"Failed to build Cloud Identity service: {e}")
        return

    target_group_name = verify_group(cloudidentity_service, args.group_id)
    if not target_group_name:
        logger.error("Aborting script due to invalid Group ID or missing permissions.")
        return

    machine_names = read_machine_names(args.file)
    if not machine_names: return

    device_ids, not_found = fetch_device_ids(session, machine_names)
    
    success_count, failure_count = add_browsers_to_group(cloudidentity_service, device_ids, target_group_name)
    
    logger.info("")
    logger.info("==================================================")
    logger.info("               EXECUTION SUMMARY                  ")
    logger.info("==================================================")
    logger.info(f"Target Group Resolved: {target_group_name}")
    logger.info(f"Total Browsers Successfully Processed/Added: {success_count}")
    logger.info(f"Total Browsers Failed to Add: {failure_count}")
    logger.info(f"Total Machine Names Not Found in Admin Console: {len(not_found)}")
    
    if not_found:
        logger.info("-" * 50)
        logger.info("List of Machine Names Not Found in Tenant:")
        for name in not_found:
            logger.info(f"  • {name}")
    logger.info("==================================================")

if __name__ == "__main__":
    main()
