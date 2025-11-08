# -*- coding: utf-8 -*-
#
# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
A Python script to migrate Chrome policies from a source Organizational Unit (OU)
to a destination Organizational Unit (OU) using the Chrome Policy API.
"""

import argparse
import json
import os.path
import pickle

from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# --- Configuration ---
# The scope required for the Chrome Policy API.
SCOPES = ["https://www.googleapis.com/auth/chrome.management.policy"]

# TODO: Replace with your actual customer ID (e.g., 'customers/C12345678').
CUSTOMER_ID = "customers/INSERT_YOUR_CUSTOMER_ID_HERE"

# TODO: Update the path to your client_secrets.json file.
CLIENT_SECRETS_FILE = "client_secrets.json"

# Set to True to enable detailed logging to 'debug_log.txt'.
DEBUG = False

# File to store user's access and refresh tokens.
TOKEN_PICKLE_FILE = "token.pickle"

# --- Restricted Policy List ---
# Policies known to have a ROOT_OU_ONLY access restriction.
# These must be skipped to avoid 403 Permission Denied errors on non-root OUs.
ROOT_OU_ONLY_POLICIES = [
    "chrome.users.ChromeBrowserDmtokenDeletionEnabled",
]

def get_credentials():
    """
    Handles user authentication and authorization via OAuth 2.0.
    """
    creds = None
    if os.path.exists(TOKEN_PICKLE_FILE):
        with open(TOKEN_PICKLE_FILE, "rb") as token:
            creds = pickle.load(token)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            print("Credentials expired. Refreshing token...")
            creds.refresh(Request())
        else:
            print("No valid credentials found. Starting authentication flow...")
            if not os.path.exists(CLIENT_SECRETS_FILE):
                raise FileNotFoundError(
                    f"'{CLIENT_SECRETS_FILE}' not found. "
                    "Please ensure it is in the correct path defined in the script."
                )
            flow = InstalledAppFlow.from_client_secrets_file(
                CLIENT_SECRETS_FILE, SCOPES
            )
            creds = flow.run_local_server(port=0)

        with open(TOKEN_PICKLE_FILE, "wb") as token:
            pickle.dump(creds, token)
            print(f"Credentials saved to '{TOKEN_PICKLE_FILE}'.")

    return creds


def get_resolved_policies(service, org_unit_id, local_only=False):
    """
    Fetches resolved policies for a given OU, optionally filtering for only locally applied ones.
    """
    mode_str = "LOCAL ONLY" if local_only else "EFFECTIVE (Inherited + Local)"
    print(f"\nFetching {mode_str} policies from '{org_unit_id}'...")
    
    try:
        all_policies = []
        page_token = None

        while True:
            target_key = {"targetResource": org_unit_id}
            request_body = {
                "policyTargetKey": target_key,
                "policySchemaFilter": "chrome.users.*",
                "pageSize": 1000,
            }
            if page_token:
                request_body["pageToken"] = page_token

            request = service.customers().policies().resolve(
                customer=CUSTOMER_ID, body=request_body
            )
            response = request.execute()
            resolved_policies = response.get("resolvedPolicies", [])

            for policy in resolved_policies:
                if local_only:
                    # If the source OU of the policy does not match the requested OU,
                    # it is an inherited policy and should be skipped in local-only mode.
                    source_ou = policy.get("sourceKey", {}).get("targetResource")
                    if source_ou != org_unit_id:
                        continue
                
                all_policies.append(policy)

            page_token = response.get("nextPageToken")
            if not page_token:
                break

        print(f"Successfully fetched {len(all_policies)} {mode_str.lower()} policies.")

        if DEBUG:
            print("DEBUG: Writing resolved policies to debug_log.txt.")
            with open("debug_log.txt", "a", encoding="utf-8") as f:
                f.write(f"--- {mode_str} POLICIES FROM {org_unit_id} ---\n")
                f.write(json.dumps(all_policies, indent=2))
                f.write("\n\n")

        return all_policies

    except HttpError as error:
        print(f"An error occurred while fetching policies: {error}")
        return None
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        return None


def is_policy_migratable(policy_schema):
    """
    Checks if a policy is restricted to the Root OU and should be skipped.
    """
    if policy_schema in ROOT_OU_ONLY_POLICIES:
        print(f"  -> Skipping restricted policy: {policy_schema}")
        return False
    return True


def batch_update_policies(service, policies, destination_ou_id):
    """
    Applies a list of policies to a destination Organizational Unit in a single batch request.
    """
    if not policies:
        print("\nNo policies to update. Exiting.")
        return

    print(f"\nPreparing to update policies for '{destination_ou_id}'...")
    
    try:
        requests = []
        for policy in policies:
            policy_value = policy.get("value", {})
            policy_schema = policy_value.get("policySchema", "")
            settings = policy_value.get("value", {})

            if not settings:
                continue
            
            # Filter out policies that cannot be applied to non-root OUs.
            if not is_policy_migratable(policy_schema):
                continue
                
            update_mask = {"paths": list(settings.keys())}

            request_item = {
                "policyTargetKey": {"targetResource": destination_ou_id},
                "policyValue": {
                    "policySchema": policy_schema,
                    "value": settings
                },
                "updateMask": update_mask,
            }
            requests.append(request_item)

        if not requests:
            print("\nNo valid or migratable policies with settings found to update. Exiting.")
            return
            
        request_body = {"requests": requests}

        print(f"Sending batch update request with {len(requests)} policies...")

        if DEBUG:
            print("DEBUG: Writing batch modify request to debug_log.txt.")
            with open("debug_log.txt", "a", encoding="utf-8") as f:
                f.write(f"--- BATCH MODIFY REQUEST BODY FOR {destination_ou_id} ---\n")
                f.write(json.dumps(request_body, indent=2))
                f.write("\n\n")

        service.customers().policies().orgunits().batchModify(
            customer=CUSTOMER_ID, body=request_body
        ).execute()

        print("\nSuccessfully applied policies to the destination OU.")
        print("Please allow some time for policies to propagate to devices.")

    except HttpError as error:
        print(f"An error occurred during the batch update: {error}")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")


def main():
    parser = argparse.ArgumentParser(
        description="Migrate Chrome user policies from one OU to another."
    )
    parser.add_argument(
        "source_ou_id",
        help="The ID of the source OU (e.g., 'orgunits/123abcde').",
    )
    parser.add_argument(
        "destination_ou_id",
        help="The ID of the destination OU (e.g., 'orgunits/456fghij').",
    )
    parser.add_argument(
        "--local-only",
        action="store_true",
        help="Only migrate policies explicitly set on the source OU, ignoring inherited ones."
    )
    args = parser.parse_args()

    if args.source_ou_id == args.destination_ou_id:
        print("Error: Source and destination OU IDs cannot be the same.")
        return

    print("--- Chrome Policy Migration Script ---")

    credentials = get_credentials()

    try:
        service = build("chromepolicy", "v1", credentials=credentials)
    except Exception as e:
        print(f"Failed to build API service: {e}")
        return

    source_policies = get_resolved_policies(
        service, 
        args.source_ou_id, 
        local_only=args.local_only
    )

    if source_policies is not None:
        batch_update_policies(service, source_policies, args.destination_ou_id)


if __name__ == "__main__":
    main()
