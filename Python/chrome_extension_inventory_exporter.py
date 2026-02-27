# -*- coding: utf-8 -*-
# Copyright 2026 Google LLC
# Licensed under the Apache License, Version 2.0
"""
Chrome Enterprise Extension Inventory Exporter
Purpose: Exports a comprehensive inventory of installed Chrome extensions across managed browsers.
Features: 
  - Traverses the accurate v1.1beta1 hierarchy: devices(browsers) -> browsers -> profiles -> extensions.
  - Extracts device OS data and targeted profile email data.
  - Takes target_id (OU ID) as a positional input.
  - Supports both JSON and flattened CSV export formats for advanced analysis.
  - Multi-auth support (Service Account vs User OAuth) & debug logging.
"""

import argparse
import json
import csv
import os.path
import pickle
import datetime
import traceback
from collections import defaultdict

# Imports for Auth
from google.oauth2 import service_account
from google.auth.transport.requests import Request, AuthorizedSession
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# Scopes required
SCOPES = [
    "https://www.googleapis.com/auth/admin.directory.device.chromebrowsers.readonly",
    "https://www.googleapis.com/auth/admin.directory.orgunit.readonly", 
    "https://www.googleapis.com/auth/chrome.management.reports.readonly",
    "https://www.googleapis.com/auth/chrome.management.appdetails.readonly"
]

# --- CONFIGURATION ---
# TODO: Insert your Customer ID (e.g., "customers/C0xxxxxxx")
CUSTOMER_ID = "customers/C0xxxxxxx"

# --- AUTH SWITCH ---
USE_SERVICE_ACCOUNT = False 

# File Paths
# TODO: Update these file paths to point to your respective credential files
SERVICE_ACCOUNT_FILE = "service_account.json"
CLIENT_SECRETS_FILE = "client_secrets.json"
TOKEN_PICKLE_FILE = "token_extensions.pickle"

DEBUG = False

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

def get_ou_path_from_id(admin_service, customer_id, target_id):
    """Translates an Org Unit ID into an Org Unit Path."""
    print(f"Resolving OrgUnitPath for Target ID: '{target_id}'...")
    try:
        req = admin_service.orgunits().get(customerId=customer_id, orgUnitPath=f"id:{target_id}")
        res = req.execute()
        ou_path = res.get('orgUnitPath')
        print(f" -> Resolved to Path: {ou_path}")
        return ou_path
    except HttpError as e:
        print(f"Failed to resolve Target ID. Ensure the ID is correct. HTTP Error: {e.resp.status}")
        log_exception("get_ou_path_from_id", e)
        return None
    except Exception as e:
        print(f"Failed to resolve Target ID: {e}")
        log_exception("get_ou_path_from_id", e)
        return None

def get_browser_extensions(session, raw_customer_id, org_unit_path):
    """Fetches devices/browsers/profiles and maps extensions for a specific OU."""
    print(f"Fetching browser installations for OU Path: '{org_unit_path}'...")
    
    installations_map = defaultdict(list)
    page_token = ""
    
    while True:
        url = f"https://www.googleapis.com/admin/directory/v1.1beta1/customer/{raw_customer_id}/devices/chromebrowsers"
        params = {
            "projection": "FULL",
            "orgUnitPath": org_unit_path,
            "maxResults": 100
        }
        if page_token:
            params["pageToken"] = page_token
            
        try:
            response = session.get(url, params=params)
            
            if response.status_code != 200:
                print(f"Error fetching browsers: {response.status_code} - {response.text}")
                log_exception(f"fetch_browsers_ou", response.text)
                break
                
            data = response.json()
            
            devices = data.get('browsers', [])
            for device in devices:
                machine_name = device.get('machineName', 'Unknown_Machine')
                os_platform = device.get('osPlatform', 'Unknown')
                os_platform_version = device.get('osPlatformVersion', 'Unknown')
                last_device_user = device.get('lastDeviceUser', 'Unknown')
                
                browser_executables = device.get('browsers', [])
                for browser_exe in browser_executables:
                    browser_channel = browser_exe.get('channel', 'Unknown')
                    browser_version = browser_exe.get('browserVersion', 'Unknown')
                    
                    profiles = browser_exe.get('profiles', [])
                    for profile in profiles:
                        profile_name = profile.get('name', 'Default Profile')
                        email = profile.get('chromeSignedInUserEmail', 'N/A')
                        
                        extensions = profile.get('extensions', [])
                        for ext in extensions:
                            ext_id = ext.get('extensionId')
                            if not ext_id: continue
                            
                            installations_map[ext_id].append({
                                "machineName": machine_name,
                                "osPlatform": os_platform,
                                "osPlatformVersion": os_platform_version,
                                "lastDeviceUser": last_device_user,
                                "browserChannel": browser_channel,
                                "browserVersion": browser_version,
                                "profileName": profile_name,
                                "email": email,
                                "version": ext.get('version', ''),
                                "installType": ext.get('installType', ''),
                                "disabled": ext.get('disabled', False)
                            })
                    
            page_token = data.get('nextPageToken')
            if not page_token:
                break
                
        except Exception as e:
            print(f"Exception fetching browsers: {e}")
            log_exception(f"fetch_browsers_ou", e)
            break
            
    print(f" -> Found extension data across {len(installations_map)} unique extensions in this OU.")
    return installations_map

def get_count_installed_apps(chromemanagement_service, customer_id, target_id):
    """Fetches aggregate telemetry counts for installed apps scoped to the target ID."""
    print("Fetching Installed Apps Count data (Chrome Management API)...")
    installed_apps_map = {}
    page_token = None
    
    try:
        while True:
            req = chromemanagement_service.customers().reports().countInstalledApps(
                customer=customer_id, 
                orgUnitId=target_id,
                pageSize=100, 
                pageToken=page_token
            )
            res = req.execute()
            
            for app in res.get('installedApps', []):
                app_id = app.get('appId')
                if app_id:
                    installed_apps_map[app_id] = app
                    
            page_token = res.get('nextPageToken')
            if not page_token:
                break
    except Exception as e:
        print(f"Error fetching countInstalledApps: {e}")
        log_exception("get_count_installed_apps", e)
        
    return installed_apps_map

def get_app_details(chromemanagement_service, customer_id, app_id):
    """Fetches rich metadata for a specific extension from the Web Store/Management API."""
    name = f"{customer_id}/apps/chrome/{app_id}"
    try:
        req = chromemanagement_service.customers().apps().chrome().get(name=name)
        return req.execute()
    except HttpError as e:
        if e.resp.status == 404:
            return {"error": "App not found in Web Store or not available."}
        log_exception(f"get_app_details_{app_id}", e)
        return {"error": str(e)}
    except Exception as e:
        log_exception(f"get_app_details_{app_id}", e)
        return {"error": str(e)}

def write_csv_export(final_data, output_file):
    """Writes a flattened, highly analyzable CSV representing every single installation."""
    headers = [
        "Extension ID", "Extension Name", "Tenant Device Count", "Risk Level", 
        "Permissions (Summary)", "Machine Name", "OS Platform", "OS Version", 
        "Last Device User", "Browser Channel", "Browser Version", "Profile Name", 
        "Signed-In Email", "Extension Version", "Install Type", "Disabled"
    ]
    
    try:
        with open(output_file, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(headers)
            
            for app_id, data in final_data.items():
                app_details = data.get("appDetails", {})
                count_details = data.get("installCountDetails", {})
                installations = data.get("installations", [])
                
                # Extract Top-Level Metadata
                display_name = app_details.get("displayName", count_details.get("displayName", "Unknown"))
                tenant_device_count = count_details.get("browserDeviceCount", "0")
                risk_level = count_details.get("riskAssessment", {}).get("overallRiskLevel", "UNKNOWN")
                
                # Flatten permissions into a string
                perms = count_details.get("permissions", [])
                perms_str = ", ".join(perms) if perms else "None"
                
                if not installations:
                    # If the app exists in telemetry but has no local installations mapped
                    writer.writerow([
                        app_id, display_name, tenant_device_count, risk_level, perms_str,
                        "", "", "", "", "", "", "", "", "", "", ""
                    ])
                else:
                    for inst in installations:
                        writer.writerow([
                            app_id, 
                            display_name, 
                            tenant_device_count, 
                            risk_level, 
                            perms_str,
                            inst.get("machineName", ""),
                            inst.get("osPlatform", ""),
                            inst.get("osPlatformVersion", ""),
                            inst.get("lastDeviceUser", ""),
                            inst.get("browserChannel", ""),
                            inst.get("browserVersion", ""),
                            inst.get("profileName", ""),
                            inst.get("email", ""),
                            inst.get("version", ""),
                            inst.get("installType", ""),
                            str(inst.get("disabled", False))
                        ])
                        
        print(f"\nSuccessfully exported flattened CSV to: {output_file}")
    except Exception as e:
        print(f"Failed to write CSV file: {e}")
        log_exception("write_csv_export", e)

def export_extensions_grouped(admin_service, chromemanagement_service, session, customer_id, target_id, output_file, output_format):
    raw_customer_id = customer_id.replace('customers/', '') if customer_id.startswith('customers/') else customer_id
    
    ou_path = get_ou_path_from_id(admin_service, raw_customer_id, target_id)
    if not ou_path:
        print("Aborting export due to missing or invalid OrgUnitPath.")
        return
        
    installations_map = get_browser_extensions(session, raw_customer_id, ou_path)
    installed_apps_count = get_count_installed_apps(chromemanagement_service, customer_id, target_id)
    
    all_app_ids = set(installations_map.keys()).union(set(installed_apps_count.keys()))
    print(f"\nDiscovered {len(all_app_ids)} unique extensions. Fetching individual app details...")
    
    final_data = {}
    
    for count, app_id in enumerate(all_app_ids, 1):
        if count % 50 == 0:
            print(f" -> Processed {count}/{len(all_app_ids)} extensions...")
            
        app_details = get_app_details(chromemanagement_service, customer_id, app_id)
        
        final_data[app_id] = {
            "appDetails": app_details,
            "installCountDetails": installed_apps_count.get(app_id, {}),
            "installations": installations_map.get(app_id, [])
        }
    
    timestamp = datetime.datetime.now().strftime("%b_%d_%Y_%H-%M")
    
    if output_format == "csv":
        if not output_file:
            output_file = f"extension_inventory_{target_id}_{timestamp}.csv"
        write_csv_export(final_data, output_file)
        
    else: # Default JSON
        if not output_file:
            output_file = f"extension_inventory_{target_id}_{timestamp}.json"
            
        output_payload = {
            "meta": {
                "customer_id": customer_id,
                "target_id": target_id,
                "target_ou_path": ou_path,
                "exported_at": str(datetime.datetime.now()),
                "format": "grouped_by_extension_id",
                "total_extensions": len(final_data)
            },
            "extensions": final_data
        }
        
        try:
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(output_payload, f, indent=2, sort_keys=True)
            print(f"\nSuccessfully exported grouped extensions to: {output_file}")
        except Exception as e:
            print(f"Failed to write JSON file: {e}")
            log_exception("export_write_file", e)

def main():
    parser = argparse.ArgumentParser(description="Export Chrome Enterprise Extension Inventory.")
    
    parser.add_argument("target_id", help="Target Org Unit ID (e.g., '03ph8a2...')")
    parser.add_argument("--file", help="Output filename.")
    parser.add_argument("--format", choices=['json', 'csv'], default='json', help="Output format (default: json)")
    parser.add_argument("--use-service-account", action="store_true", help="Force Service Account Auth")
    parser.add_argument("--debug", action="store_true", help="Enable debug logging to file")
    
    args = parser.parse_args()

    global USE_SERVICE_ACCOUNT, DEBUG
    if args.use_service_account: USE_SERVICE_ACCOUNT = True
    if args.debug: DEBUG = True

    creds = get_credentials()
    if not creds: return
    
    try:
        admin_service = build("admin", "directory_v1", credentials=creds)
        chromemanagement_service = build("chromemanagement", "v1", credentials=creds)
        session = AuthorizedSession(creds)
    except Exception as e:
        print(f"Service build failed: {e}")
        return

    export_extensions_grouped(admin_service, chromemanagement_service, session, CUSTOMER_ID, args.target_id, args.file, args.format)

if __name__ == "__main__":
    main()
