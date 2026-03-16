# -*- coding: utf-8 -*-
# Copyright 2026 Google LLC
# Licensed under the Apache License, Version 2.0
"""
Chrome Browser Move Utility
Purpose: Moves enrolled Chrome browsers to a new OU based on a list of machine names.
Features:
  - Validates destination OU ID using the validated admin_service.orgunits().get() method.
  - Translates Machine Names to Device IDs via the v1.1beta1 Directory API.
  - Batches move operations (max 600 per request).
  - Dual Authentication (OAuth & Service Account).
  - Automatically parses customer IDs to ensure cross-API compatibility.
  - Generates a clean Execution Summary instead of bloating logs.
  - Robust File Parsing (Supports both vertical and horizontal/comma-separated lists in TXT/CSV).
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
CUSTOMER_ID = "my_customer" 

# Parse the raw ID for the Admin SDK (strips 'customers/' if present)
RAW_CUSTOMER_ID = CUSTOMER_ID.replace('customers/', '') if str(CUSTOMER_ID).startswith('customers/') else CUSTOMER_ID

SCOPES = [
    "https://www.googleapis.com/auth/admin.directory.device.chromebrowsers", 
    "https://www.googleapis.com/auth/admin.directory.orgunit.readonly"       
]

# File Paths
# TODO: Ensure these point to your valid Google Cloud credential files
SERVICE_ACCOUNT_FILE = "service_account.json"
CLIENT_SECRETS_FILE = "client_secrets.json"
TOKEN_PICKLE_FILE = "token_browser_move.pickle"

# Setup Logging
logger = logging.getLogger("BrowserMoveLogger")
logger.setLevel(logging.INFO)
formatter = logging.Formatter('%(asctime)s [%(levelname)s] %(message)s', datefmt='%Y-%m-%d %H:%M:%S')

ch = logging.StreamHandler()
ch.setFormatter(formatter)
logger.addHandler(ch)

fh = logging.FileHandler("browser_move_log.txt", encoding="utf-8")
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

def get_ou_path_from_id(admin_service, customer_id, target_id):
    """Translates an Org Unit ID into an Org Unit Path using the Admin SDK."""
    logger.info(f"Resolving OrgUnitPath for Target ID: '{target_id}'...")
    try:
        req = admin_service.orgunits().get(customerId=customer_id, orgUnitPath=f"id:{target_id}")
        res = req.execute()
        ou_path = res.get('orgUnitPath')
        logger.info(f" -> Resolved to Path: {ou_path}")
        return ou_path
    except HttpError as e:
        logger.error(f"Failed to resolve Target ID. Ensure the ID is correct. HTTP Error: {e.resp.status}")
        return None
    except Exception as e:
        logger.error(f"Failed to resolve Target ID: {e}")
        return None

def read_machine_names(file_path):
    """Reads machine names from a text or CSV file, supporting both horizontal and vertical layouts."""
    machine_names = []
    if not os.path.exists(file_path):
        logger.error(f"Input file '{file_path}' not found.")
        return machine_names

    logger.info(f"Reading machine names from: {file_path}")
    with open(file_path, 'r', encoding='utf-8') as f:
        if file_path.lower().endswith('.csv'):
            reader = csv.reader(f)
            for row in reader:
                for item in row:
                    name = item.strip()
                    if name:
                        machine_names.append(name)
        else:
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
            
        time.sleep(0.1) # Micro-sleep to respect API quotas

    logger.info("Lookup Complete.")
    return device_ids, not_found

def move_browsers(session, device_ids, ou_id, ou_path):
    """Batches and moves the translated device IDs to the destination OU."""
    if not device_ids:
        logger.info("No valid device IDs to move. Skipping move operation.")
        return 0

    logger.info(f"Starting Move Operation to OU: {ou_path} ...")
    url = f"https://www.googleapis.com/admin/directory/v1.1beta1/customer/{RAW_CUSTOMER_ID}/devices/chromebrowsers/moveChromeBrowsersToOu"
    
    batch_size = 600 
    success_count = 0
    
    for i in range(0, len(device_ids), batch_size):
        batch = device_ids[i:i + batch_size]
        logger.info(f" -> Moving batch {i+1} to {i+len(batch)} of {len(device_ids)}...")
        
        payload = {
            "org_unit_path": f"id:{ou_id}",
            "resource_ids": batch
        }
        
        response = session.post(url, json=payload)
        
        if response.status_code == 200:
            logger.info("    [SUCCESS] Batch moved successfully.")
            success_count += len(batch)
        else:
            logger.error(f"    [FAILED] HTTP {response.status_code}: {response.text}")
            
        time.sleep(1) # Sleep between mutation batches
        
    return success_count

def main():
    parser = argparse.ArgumentParser(description="Move Enrolled Chrome Browsers to a Target OU.")
    parser.add_argument("--file", required=True, help="Path to TXT or CSV file containing machine names.")
    parser.add_argument("--ou-id", required=True, help="The target Google Workspace OU ID (e.g., 03ph8a2zXXXX)")
    parser.add_argument("--use-service-account", action="store_true", help="Force Service Account Authentication")
    
    args = parser.parse_args()

    # 1. Authenticate
    creds, session = get_auth(args.use_service_account)
    if not creds or not session: return
    
    try:
        admin_service = build("admin", "directory_v1", credentials=creds)
    except Exception as e:
        logger.error(f"Service build failed: {e}")
        return

    # 2. Validate Target OU
    ou_path = get_ou_path_from_id(admin_service, RAW_CUSTOMER_ID, args.ou_id)
    if not ou_path:
        logger.error("Aborting script due to invalid Organizational Unit ID.")
        return

    # 3. Read Machine Names from File
    machine_names = read_machine_names(args.file)
    if not machine_names: return

    # 4. Lookup Device IDs (Silently)
    device_ids, not_found = fetch_device_ids(session, machine_names)
    
    # 5. Execute the Move
    success_count = move_browsers(session, device_ids, args.ou_id, ou_path)
    
    # 6. Print Execution Summary
    logger.info("")
    logger.info("==================================================")
    logger.info("               EXECUTION SUMMARY                  ")
    logger.info("==================================================")
    logger.info(f"Destination OU Path: {ou_path}")
    logger.info(f"Total Browsers Successfully Moved: {success_count}")
    logger.info(f"Total Machine Names Not Found: {len(not_found)}")
    
    if not_found:
        logger.info("-" * 50)
        logger.info("List of Machine Names Not Found in Tenant:")
        for name in not_found:
            logger.info(f"  • {name}")
    logger.info("==================================================")

if __name__ == "__main__":
    main()
