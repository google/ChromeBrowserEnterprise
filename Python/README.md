# Chrome Enterprise Policy Management Suite

A robust set of Python tools designed for Chrome Enterprise administrators to **export**, **backup**, **import**, and **clean** Chrome browser policies. This suite fully supports both **Organizational Units (OUs)** and **Google Groups**, handling complex App/Extension policies and intelligent "auto-repair" logic for seamless migrations.

## 🚀 Key Benefits

* **Universal Support:** Manage policies for both **OUs** (hierarchical) and **Groups** (flat).
* **Version Control:** Export policies to JSON to track changes over time using Git.
* **Disaster Recovery:** Restore complex policy configurations to any OU or Group in seconds.
* **Migrate:** Seamlessly promote policies from non-prod to prod environments.
* **Policy Hygiene:** Easily revert local overrides to inherited states with the new **Inheritor** tool.
* **Dual Authentication:** Supports both **Local Admin** (OAuth 2.0 browser flow) and **Service Accounts** (CI/CD automation).

---

## ⚙️ Prerequisites

1.  **Python 3.8+** installed.
2.  **Google Cloud Project** with the **Chrome Policy API** enabled.
3.  **Dependencies:** Install via pip:
    ```python
    pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib
    ```

---

## 🔧 Configuration

Before running the scripts, open the python files and update the `CUSTOMER_ID` constant:

```python
CUSTOMER_ID = "customers/C0xxxxxxx"  # Replace with your actual Customer ID
```

### Authentication Setup
The scripts support two modes. You can switch modes via the `--use-service-account` flag.

#### Mode A: Local Admin (Default)
Best for running scripts manually on your workstation.
1.  Download your OAuth 2.0 Client credentials from Google Cloud.
2.  Save the file as `client_secrets.json` in the script directory.
3.  The first run will open a browser window to authenticate.

#### Mode B: Service Account (Automation)
Best for scheduled tasks or CI/CD pipelines.
1.  Create a Service Account in Google Cloud.
2.  Grant it the Chrome Policy API roles (e.g., Chrome Policy API Viewer/Editor).
3.  Download the JSON key and save it as `service_account.json`.
4.  Run scripts with the --use-service-account flag.

## 📦 Tool 1: Policy Exporter ([`policy_exporter.py`](https://github.com/google/ChromeBrowserEnterprise/blob/main/Python/policy_exporter.py))
Exports policies from a source OU or Group into a timestamped JSON file.

### Features
- App Deduplication: Solves a common API issue where multiple apps share the same schema name. This tool correctly captures unique policies for every app.
- Raw JSON: Exports the full API payload, preserving metadata like `sourceKey` (where the policy came from) and `addedAt` timestamps.

#### Usage
1. Export from an Organizational UnitExports effective policies (Local + Inherited) by default.
   ```bash
    python policy_exporter.py orgunits/03ph8a2z12345
    ```

    Optional: Use `--local-only` to skip inherited policies.

2. Export from a Google GroupExports policies applied directly to the group.
    ```bash
    python policy_exporter.py groups/02gq7lqe2abc
    ```
3. Export using Service Account
    ```bash
    python policy_exporter.py orgunits/03ph8a2z12345 --use-service-account
    ```
### Output: 
A file named like `orgunits_03ph8a2z_Dec_12_2025_18-30.json` or `groups_02gq7lqe_...json` will be created.

## 📥 Tool 2: Policy Importer ([policy_importer.py](https://github.com/google/ChromeBrowserEnterprise/blob/main/Python/policy_importer.py))
Imports a JSON policy file into a target OU or Group.
### Features
- Strict Type Validation: The tool strictly validates the source and target types.
    - ✅ OU Export $\rightarrow$ OU Target
    - ✅ Group Export $\rightarrow$ Group Target
    - ❌ OU Export $\rightarrow$ Group Target (Blocked to prevent mismatches)
- Smart Fix (Auto-Repair): If you import an app configuration (e.g., Managed Config) but are missing the `InstallType` policy (often lost during "Local Only" exports), this tool detects the error and automatically injects `InstallType: ALLOWED`.
- Namespace Batching: Automatically groups policies by namespace (`chrome.users` vs `chrome.users.apps`) to prevent "Namespace Mismatch" API errors.

### Usage
1. Import to an Organizational Unit
    ```bash
    python policy_importer.py my_ou_backup.json orgunits/03ph8a2z98765
    ```
2. Import to a Google Group
    ```bash
    python policy_importer.py my_group_backup.json groups/02gq7lqe2abc
    ```
3. Import using Service Account
    ```bash
    python policy_importer.py my_backup.json orgunits/03ph8a2z98765 --use-service-account
    ```

## 🧹 Tool 3: Policy Inheritor ([`policy_inheritor.py`](https://github.com/google/ChromeBrowserEnterprise/blob/main/Python/policy_inheritor.py))
A cleanup tool that reverts "Locally Applied" policies on an OU back to their "Inherited" state. This effectively clears local settings.

### Features
- Smart App Reset: Uses wildcard inheritance (`chrome.users.apps.*`) to cleanly remove locally managed apps without causing API dependency errors.
- Safety Checks: Automatically filters out Root-Restricted policies that cannot be inherited
- Scope Protection: Only touches policies explicitly defined on the target OU; inherited settings from parents are left untouched.

#### Usage
1. Clean an Organizational Unit
   ```bash
    python policy_inheritor.py orgunits/03ph8a2z12345
    ```

    Note: The script will prompt for confirmation before making changes.

### 📝 Logging & Debugging
Both tools include a `DEBUG` toggle at the top of the script:
    ```bash
    DEBUG = False  # Set to True to enable file logging
    ```
- Console Output: Shows real-time progress, validation errors, and "Smart Fix" actions.
- debug_log.txt: If enabled, captures full stack traces, API response details, and input arguments for troubleshooting.

# Chrome Enterprise Premium (CEP) Policy Manager

The CEP Policy Manager [cep_policy_manager.py](https://github.com/google/ChromeBrowserEnterprise/blob/main/Python/cep_policy_manager.py) is a comprehensive Python utility designed to export, backup, and restore Data Loss Prevention (DLP) Rules, Custom Detectors (Regex, Word Lists, URL Lists), Context-Aware Access (CAA) Levels, and BeyondCorp Secure Gateways.

Unlike standard Admin Console interfaces, this script allows for true "infrastructure as code" management of your CEP environment. It natively handles dependency mapping, making it an ideal tool for cross-tenant migrations (e.g., migrating from a Staging environment to Production).

## Features
* **Full Environment Export/Import:** Captures and restores:
  * **DLP Rules** (Automatically filtered to Chrome-specific triggers).
  * **Custom Detectors** (Word Lists, Regular Expressions, URL Lists).
  * **Context-Aware Access (CAA) Levels** (Via Access Context Manager).
  * **Secure Gateways & Applications** (Via BeyondCorp API).
* **Split-Session & Multi-Mode Authentication:** Separates Cloud Identity DLP API authentication (which strictly requires a **Google Workspace Super Administrator** identity) from GCP Infrastructure API authentication (Access Context Manager & BeyondCorp, which use `cloud-platform` IAM):
  * **Workspace Super Admin OAuth 2.0 / ADC (No Domain-Wide Delegation Required):** Supports local browser OAuth (`client_secrets.json` / `token_cep.pickle`) and `gcloud` Application Default Credentials (`~/.config/gcloud/application_default_credentials.json`).
  * **Pre-Minted OAuth 2.0 Bearer Access Token (`--access-token`):** Allows passing a short-lived Super Admin bearer token for DLP Rules & Detectors, optionally paired with `--use-service-account` for CAA and Secure Gateways.
  * **Service Account with Domain-Wide Delegation (`--use-service-account --subject`):** Impersonates a Workspace Super Admin only for `cloud-identity.policies` scopes while authenticating directly as the Service Account for `cloud-platform` (CAA & BeyondCorp).
* **Intelligent Dependency Mapping:** Automatically translates old Detector and Access Level IDs to their newly generated IDs during the rule import process.
* **Dual API Support:** Uses the `v1` endpoint for safe read-only exports and the `v1beta1` endpoint for mutations (imports/creations).
* **Cross-Tenant Migration Support:** Gracefully handles `409 ALREADY_EXISTS` errors. If an Access Level or Gateway already exists in the target environment, it safely skips creation and maps the rules to the existing resource.
* **Graceful Partial Export/Import:** If a GCP `ORGANIZATION_ID` or `PROJECT_ID` is not configured (or an Access Policy cannot be resolved), the script logs a warning, skips CAA Access Levels / Secure Gateways, and continues exporting or importing Chrome DLP Detectors and Rules.
* **Built-in Rate Limiting:** Safely throttles API requests (1.5s delay) to respect Google's strict 1 QPS quota on Beta policy APIs, preventing `429 RESOURCE_EXHAUSTED` errors.
* **Dynamic ID Resolution:** Automatically resolves your numeric Access Policy ID using your Google Cloud Organization ID.
* **Target Scoping Overrides & ID Normalization:** Allows you to safely sandbox imported rules and detectors to a specific test Organizational Unit (`--ou-id`) or Group (`--group-id`), automatically normalizing IDs whether or not `orgUnits/` or `groups/` prefixes are provided.
* **Robust Logging:** Outputs timestamped execution details, actionable `HTTP 403 Error(7001)` diagnostics, and error traces to both the console and a local `cep_policy_manager.log` file.

---

## ⚠️ Important Note on Custom Detectors & Scoping

* **Best Practice:** When defining Detectors (Regex, Word Lists, URL Lists) in your import JSON, set their `policyQuery.orgUnit` to your **Root OU ID** so they are globally available and can be referenced by DLP Rules scoped to any sub-OU or Group in your domain.
* **Prefix Normalization:** Both `--ou-id` and `--group-id` automatically strip leading `orgUnits/` or `groups/` prefixes before constructing `policyQuery` resource paths and CEL `orgUnitId(...)` / `groupId(...)` expressions.

---

## 📋 Prerequisites

1. **Python 3.8+**
2. **Google Cloud Project** with the following APIs enabled:
   * Cloud Identity API (`cloudidentity.googleapis.com`)
   * Access Context Manager API (`accesscontextmanager.googleapis.com`)
   * BeyondCorp API (`beyondcorp.googleapis.com`)
3. **Required Python Packages:**
   ```bash
   pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib requests
   ```
4. **Required Roles & Permissions:**
   * **Google Workspace (Required for DLP Rules & Detectors):** **Super Administrator** role.
     > **Important:** The Cloud Identity Policies API (`cloudidentity.googleapis.com/v1/policies` and `v1beta1/policies`) strictly enforces a hardcoded **Super Admin** check for `rule.dlp` and `detector.*` policies. Custom/delegated Workspace admin roles, GCP IAM roles (`roles/cloudidentity.policyAdmin`), or direct Service Account calls without Domain-Wide Delegation will fail with `HTTP 403 PERMISSION_DENIED: Error(7001)`.
   * **Google Cloud IAM (Required for CAA Levels & BeyondCorp Gateways):**
     * Access Context Manager Editor (`roles/accesscontextmanager.policyEditor`)
     * BeyondCorp Admin (`roles/beyondcorp.admin`)

---

## 🔧 Setup
1. Clone or download this repository.
2. Configure your tenant identifiers using **any** of the following methods:
   * **CLI Flags (Recommended):** Pass `--customer`, `--org-id`, and `--project-id` at runtime.
   * **Environment Variables:** Set `CEP_CUSTOMER_ID`, `CEP_ORGANIZATION_ID`, and `CEP_PROJECT_ID`.
   * **Script Constants:** Update the `CONFIGURATION` block at the top of [cep_policy_manager.py](https://github.com/google/ChromeBrowserEnterprise/blob/main/Python/cep_policy_manager.py):
     ```python
     # --- CONFIGURATION ---
     CUSTOMER_ID = os.environ.get("CEP_CUSTOMER_ID", "customers/C0xxxxxxx")
     ORGANIZATION_ID = os.environ.get("CEP_ORGANIZATION_ID", "organizations/123456789012")
     PROJECT_ID = os.environ.get("CEP_PROJECT_ID", "my-gcp-project")
     LOCATION = "global"
     ```

---

## :factory: Usage
The script uses standard command-line arguments. Use `python3 cep_policy_manager.py --help` to see all available options:

```text
options:
  --use-service-account          Use Service Account authentication
  --key-file KEY_FILE            Path to Service Account JSON key file (default: service_account.json or $GOOGLE_APPLICATION_CREDENTIALS)
  --subject SUBJECT              Workspace Super Admin email to impersonate via Domain-Wide Delegation for Cloud Identity DLP APIs
  --access-token ACCESS_TOKEN    Pre-minted OAuth 2.0 Bearer Access Token from a Workspace Super Admin
  --client-secrets CLIENT_SECRETS Path to OAuth 2.0 Desktop client_secrets.json file (default: client_secrets.json)
  --token-file TOKEN_FILE        Path to cached user OAuth token pickle file (default: token_cep.pickle)
  --customer CUSTOMER            Override Google Workspace Customer ID (e.g., customers/C0xxxxxxx)
  --org-id ORG_ID                Override GCP Organization ID (e.g., organizations/123456789012)
  --project-id PROJECT_ID        Override GCP Project ID for BeyondCorp Secure Gateways
  --debug                        Enable verbose debug logging
```

### 1. Exporting an Environment

Extracts configurations and saves them to a structured JSON file.

```bash
# Standard export (auto-generates a timestamped filename)
python3 cep_policy_manager.py export --customer C0xxxxxxx --org-id 123456789012

# Export to a specific file
python3 cep_policy_manager.py export --file my_cep_backup.json --customer C0xxxxxxx

# Enable verbose debug logging
python3 cep_policy_manager.py export --debug
```

### 2. Importing an Environment

Restores configurations from a JSON file. The script enforces a strict dependency order: `Access Levels -> Gateways -> Detectors -> DLP Rules`.

```bash
# Standard import (uses targets defined natively in the JSON)
python3 cep_policy_manager.py import --file my_cep_backup.json --customer C0xxxxxxx

# SAFE TEST: Override targets to apply rules/detectors ONLY to a specific Test OU
python3 cep_policy_manager.py import --file my_cep_backup.json --ou-id "03ph8a2zXXXXXXX"

# Override targets to apply rules/detectors ONLY to a specific Test Group
python3 cep_policy_manager.py import --file my_cep_backup.json --group-id "03oy7u29XXXXXXX"
```

### 3. Authentication Modes

Because the Cloud Identity Policies API requires a **Workspace Super Administrator** identity, `cep_policy_manager.py` supports three authentication patterns depending on whether your organization permits Domain-Wide Delegation (DWD):

#### Mode A: Super Admin OAuth 2.0 or `gcloud` ADC (Default — No DWD Required)
Ideal for interactive runs or environments where Domain-Wide Delegation is prohibited.
* **Option 1 (Local Browser OAuth):** Place your Desktop OAuth `client_secrets.json` in the working directory and run the script. It will launch a browser login flow as a Workspace Super Admin and cache credentials in `token_cep.pickle`:
  ```bash
  python3 cep_policy_manager.py export --customer C0xxxxxxx
  ```
* **Option 2 (`gcloud` Application Default Credentials):** Authenticate once via `gcloud` using your custom OAuth client file, and the script will automatically detect `~/.config/gcloud/application_default_credentials.json`:
  ```bash
  gcloud auth application-default login \
    --client-id-file=client_secrets.json \
    --scopes="https://www.googleapis.com/auth/cloud-identity.policies,https://www.googleapis.com/auth/cloud-platform"

  python3 cep_policy_manager.py export --customer C0xxxxxxx
  ```

#### Mode B: Pre-Minted Super Admin Bearer Token + Service Account (Hybrid — No DWD Required)
Ideal for CI/CD or Terraform pipelines without Domain-Wide Delegation. Pass a short-lived Super Admin access token via `--access-token` (or `CEP_ACCESS_TOKEN` / `TF_VAR_access_token`) for Cloud Identity DLP calls, and optionally combine it with `--use-service-account` so CAA and BeyondCorp calls use your GCP Service Account:

```bash
# Use a pre-minted Super Admin token for DLP + Service Account for GCP CAA/BeyondCorp
python3 cep_policy_manager.py import \
  --file my_cep_backup.json \
  --customer C0xxxxxxx \
  --org-id 123456789012 \
  --use-service-account \
  --key-file service_account.json \
  --access-token "$(gcloud auth application-default print-access-token)"
```

#### Mode C: Service Account with Domain-Wide Delegation (Unattended Automation)
For fully unattended runs using a Service Account:
1. Enable **Domain-Wide Delegation** for the Service Account's numeric Client ID in **Google Admin Console → Security → Access and data control → API controls → Manage Domain Wide Delegation** with scopes:
   * `https://www.googleapis.com/auth/cloud-identity.policies`
   * `https://www.googleapis.com/auth/cloud-identity.policies.readonly`
2. Grant the Service Account GCP IAM roles (`Access Context Manager Editor`, `BeyondCorp Admin`) on your GCP Organization/Project.
3. Run the script with `--use-service-account` and `--subject <super-admin@yourdomain.com>`. The script automatically uses split sessions—impersonating `--subject` only for Cloud Identity DLP calls while using direct Service Account credentials for GCP CAA and BeyondCorp calls:
   ```bash
   python3 cep_policy_manager.py export \
     --use-service-account \
     --key-file service_account.json \
     --subject super-admin@yourdomain.com \
     --customer C0xxxxxxx \
     --org-id 123456789012
   ```

---

## 🔄 Cross-Tenant Migration Guide

To migrate configurations from a Staging tenant to a Production tenant without editing the script:

1. Export from the **Staging** tenant:
   ```bash
   python3 cep_policy_manager.py export \
     --file staging_export.json \
     --customer C0staging \
     --org-id 111111111111 \
     --project-id staging-gcp-project
   ```
2. Import into the **Production** tenant (authenticating with a Production Super Admin / Service Account):
   ```bash
   python3 cep_policy_manager.py import \
     --file staging_export.json \
     --customer C0production \
     --org-id 222222222222 \
     --project-id prod-gcp-project
   ```
   * *Note:* The script automatically detects resources that already exist in Production (`409 ALREADY_EXISTS`) and maps imported DLP rules to those existing dependencies.

---

## 📝 Logging & Debugging
- **HTTP 403 (`PERMISSION_DENIED: Error(7001)`):** Returned by the Cloud Identity Policies API when the caller is not a Google Workspace Super Administrator (for example, running `--use-service-account` without `--subject` or `--access-token`, or signing in as a delegated admin). Use Mode A (Super Admin OAuth/ADC), Mode B (`--access-token`), or Mode C (`--use-service-account --subject super-admin@yourdomain.com`).

- **`unauthorized_client: Client is unauthorized to retrieve access tokens`:** Returned when `--subject` is used with a Service Account whose numeric Client ID has not been authorized in Google Workspace Admin Console (**Security → API controls → Domain-wide Delegation**) for `https://www.googleapis.com/auth/cloud-identity.policies`.

- **HTTP 400 (`INVALID_ARGUMENT`):** Usually occurs if you attempt to import a rule that references a custom detector ID that does not exist in the JSON payload or the tenant. Ensure you are importing the entire backup payload so detectors are created first.

- **HTTP 429 (`RESOURCE_EXHAUSTED`):** The Cloud Identity Policies API has a strict 1 QPS limit. The script handles this automatically with a `time.sleep(1.5)` throttle. Do not remove this throttle.

- **Missing BeyondCorp Applications:** Secure Gateways utilize Long-Running Operations (LROs) to provision. The script will trigger the creation, but you may need to wait a few minutes and check the GCP Console to see the Gateway reach a `RUNNING` state.

---

## 🏗️ Hybrid Terraform Integration

Because the official HashiCorp `google` / `google-beta` provider does not yet offer a native resource for Cloud Identity Chrome DLP rules, you can use a hybrid Terraform approach.

Deploy your Access Levels and Secure Gateways using native `.tf` resources (authenticated via your GCP Service Account), and use a `null_resource` with a `local-exec` provisioner to invoke `cep_policy_manager.py` for the DLP rules and detectors:

```hcl
resource "null_resource" "cep_dlp_manager" {
  depends_on = [
    google_access_context_manager_access_level.all,
    google_beyondcorp_security_gateway.all
  ]

  triggers = {
    export_hash = filemd5("${path.module}/cep_export.json")
  }

  # Option 1 (No DWD): Pass a short-lived Super Admin access token via TF_VAR_access_token
  # Option 2 (With DWD): Pass --use-service-account --subject super-admin@yourdomain.com
  provisioner "local-exec" {
    command = "python3 cep_policy_manager.py import --file cep_export.json --use-service-account --subject ${var.super_admin_email}"
  }
}
```

# Chrome Enterprise Extension Inventory Exporter

A Python tool designed for Chrome Enterprise administrators to export a comprehensive, highly-detailed inventory of Chrome extensions installed across their managed browser fleet.

Unlike standard Admin Console reports, this script cross-references multiple Google APIs to map every single extension installation to its specific device, OS, Chrome profile, and signed-in user, alongside rich metadata like requested permissions and risk assessments.

## Features

* **Deep Hierarchy Extraction:** Accurately traverses the `devices -> browsers -> profiles -> extensions` hierarchy using the Admin SDK `v1.1beta1` endpoint.
* **Rich Extension Metadata:** Augments installation data with Web Store details (Permissions, Risk Level, Display Name) using the [Chrome Management API](https://developers.google.com/chrome/management).
* **Flexible Authentication:** Supports both User OAuth 2.0 (for interactive administrative runs) and Service Accounts (for automated/cron jobs).
* **Analyzable Output:** Choose between a grouped JSON output or a **flattened CSV** format perfect for pivot tables and filtering in Excel or Google Sheets.

## ⚙️ Prerequisites

1. **Python 3.8+**
2. **Google Cloud Project** with the following APIs enabled:
   * Admin SDK API
   * Chrome Management API
3. **Required Python Packages:**
   ```bash
   pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib

## Required OAuth Scopes
Your application/credentials will need the following scopes:

- `https://www.googleapis.com/auth/admin.directory.device.chromebrowsers.readonly`
- `https://www.googleapis.com/auth/admin.directory.orgunit.readonly`
- `https://www.googleapis.com/auth/chrome.management.reports.readonly`
- `https://www.googleapis.com/auth/chrome.management.appdetails.readonly`

## 🔧 Setup
1. Clone or download this repository.
2. Open [chrome_extension_inventory_exporter.py](chrome_extension_inventory_exporter.py) in your text editor.
3. Update the CUSTOMER_ID variable with your Google Workspace Customer ID (e.g., customers/C0xxxxxxx).
4. Update the SERVICE_ACCOUNT_FILE and CLIENT_SECRETS_FILE variables to point to your local Google Cloud credential JSON files.

## :factory: Usage
The script requires a target_id (Organizational Unit ID) as a positional argument.

### Basic Run (JSON Output)
Exports the data grouped by Extension ID into a .json file.
```Bash
python chrome_extension_inventory_exporter.py 03ph8a2z1en
```
### CSV Export (Recommended for Analysis)
Exports a flattened tabular format where every row represents a single installation of an extension on a specific machine/profile.

```Bash
python chrome_extension_inventory_exporter.py 03ph8a2z1en --format csv
```

### 📝 Logging & Debugging
- **Missing Extension Data in JSON/CSV**: Ensure you are passing a specific OU ID. Querying the root without iterating through OUs can cause Google's API to truncate extension payloads.

- **403 Forbidden / 401 Unauthorized#**: Delete the `token_extensions.pickle` file to force a re-authentication and re-consent to the requested scopes. Ensure your Admin account has the required privileges.

- **Debug Logging**: Run the script with the `--debug` flag to generate a debug_log.txt containing full Python tracebacks and HTTP errors.


# Chrome Browser Move Utility

This script allows you to perform bulk moves of enrolled Chrome browsers to a specific Organizational Unit (OU) using a simple list of machine names.

Because the Google Admin Console and APIs require backend `deviceId` UUIDs to move browsers, this script bridges the gap by automatically translating your human-readable machine names into the necessary IDs before executing the move safely in batches.

## Key Features

* **Smart Translation:** Automatically queries the `v1.1beta1` Directory API to translate `machine_name`s into Google `deviceId`s.
* **Pre-Flight Validation:** Validates the target Organizational Unit ID before running to prevent failed API calls.
* **Safe Batching:** Automatically chunks move requests into batches of 600 to strictly adhere to API limits.
* **Robust File Parsing:** Supports `.txt` and `.csv` files. Understands both vertical lists (one per line) and horizontal lists (comma-separated on the same line). Automatically filters out duplicate names.
* **Dual Authentication:** Supports both User OAuth 2.0 (for interactive admin runs) and Service Accounts (for automated background tasks).
* **Clean Execution Summary:** Provides a neat audit trail in the console and `browser_move_log.txt` detailing exactly how many devices moved and explicitly listing any machine names that could not be found.

## ⚙️ Prerequisites

1. **Python 3.8+**
2. **Google Cloud Project** with the following API enabled:
   * Admin SDK API
3. **Required Python Packages:**
   ```bash
   pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib
   ```
4. **Required OAuth Scopes:**
   * `https://www.googleapis.com/auth/admin.directory.device.chromebrowsers`
   * `https://www.googleapis.com/auth/admin.directory.orgunit.readonly`

## 🔧 Setup

1. Clone or download this script.
2. Open [`move_chrome_browsers.py`](https://github.com/google/ChromeBrowserEnterprise/blob/main/Python/move_chrome_browsers.py) in a text editor.
3. Update the `CUSTOMER_ID` variable with your Google Workspace Customer ID (e.g., `C0xxxxxxx` or `my_customer`).
4. Ensure your credential files (`service_account.json` or `client_secrets.json`) are in the same directory as the script.

## :factory: Usage

### Input File Format

Create a `.txt` or `.csv` file containing the machine names you wish to move. 

**Vertical Format (Supported):**
```text
CLIENT2012
CLIENT2013
CLIENT2014
```

**Horizontal Format (Supported):**
```text
CLIENT2012, CLIENT2013, CLIENT2014
```


Run the script by passing your input file and the target **Organizational Unit ID**. 

### Standard Run (Interactive OAuth)
```bash
python move_chrome_browsers.py --file move_test.csv --ou-id 03ph8a2zXXXX
```

### Automated Run (Service Account)
Append the `--use-service-account` flag to bypass the browser login prompt.
```bash
python move_chrome_browsers.py --file move_test.csv --ou-id 03ph8a2zXXXX --use-service-account
```

### Output Example

The script runs quietly during the translation phase and outputs a clean summary upon completion:

```text
2026-03-16 14:00:00 [INFO] Reading machine names from: move_test.csv
2026-03-16 14:00:00 [INFO]  -> Found 3 unique machine names to process.
2026-03-16 14:00:00 [INFO] Starting Device ID lookup phase (this may take a moment)...
2026-03-16 14:00:02 [INFO] Lookup Complete.
2026-03-16 14:00:02 [INFO] Starting Move Operation to OU: /Managed Chrome/Austin ...
2026-03-16 14:00:02 [INFO]  -> Moving batch 1 to 2 of 2...
2026-03-16 14:00:03 [INFO]     [SUCCESS] Batch moved successfully.
2026-03-16 14:00:04 [INFO] 
2026-03-16 14:00:04 [INFO] ==================================================
2026-03-16 14:00:04 [INFO]                EXECUTION SUMMARY                  
2026-03-16 14:00:04 [INFO] ==================================================
2026-03-16 14:00:04 [INFO] Destination OU Path: /Managed Chrome/Austin
2026-03-16 14:00:04 [INFO] Total Browsers Successfully Moved: 2
2026-03-16 14:00:04 [INFO] Total Machine Names Not Found: 1
2026-03-16 14:00:04 [INFO] --------------------------------------------------
2026-03-16 14:00:04 [INFO] List of Machine Names Not Found in Tenant:
2026-03-16 14:00:04 [INFO]   • CLIENT2014
2026-03-16 14:00:04 [INFO] ==================================================
```

# Chrome Browser Group Assignment Tool

A specialized automation script for Chrome Enterprise administrators to bulk-add enrolled Chrome browsers to Cloud Identity Groups.

## The Challenge
Google's Cloud Identity API is primarily designed for user management. Standard attempts to add hardware UUIDs (device IDs) to groups often fail with a `400 Invalid Argument` error because the API expects a valid email address. This script solves that by utilizing the specific `cbcm-browser.` prefix required to bind managed browsers to configuration groups.

## Features
- **Auto-Translation:** Converts machine names from a text or CSV file into backend Google `deviceId`s.
- **Prefix Injection:** Automatically applies the `cbcm-browser.` prefix to ensure API compatibility.
- **Group Verification:** Confirms the target group exists and is accessible before processing devices.
- **Bulk Processing:** Handles comma-separated or line-by-line input files.
- **Dual Auth:** Supports interactive OAuth 2.0 and Service Account authentication.

## Prerequisites
- Python 3.8+
- A Google Cloud Project with the **Admin SDK API** and **Cloud Identity API** enabled.
- Required Libraries:
  ```bash
  pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib
  ```

## 🔧 Setup

1. Clone or download this script.
2. Open [`add_browsers_to_group.py`](https://github.com/google/ChromeBrowserEnterprise/blob/main/Python/add_browsers_to_group.py) in a text editor.
3. Update the `CUSTOMER_ID` variable with your Google Workspace Customer ID (e.g., `C0xxxxxxx` or `my_customer`).
4. Ensure your credential files (`service_account.json` or `client_secrets.json`) are in the same directory as the script.

## :factory: Usage
### Input File Format

Create a `.txt` or `.csv` file containing the machine names you wish to move. 

**Vertical Format (Supported):**
```text
CLIENT2012
CLIENT2013
CLIENT2014
```

**Horizontal Format (Supported):**
```text
CLIENT2012, CLIENT2013, CLIENT2014
```


Run the script by passing your input file and the target **Group ID**. 

### Standard Run (Interactive OAuth)
```bash
python add_browsers_to_group.py --file move_test.csv --group-id 03ph8a2zXXXX
```

### Automated Run (Service Account)
Append the `--use-service-account` flag to bypass the browser login prompt.
```bash
python add_browsers_to_group.py --file move_test.csv --group-id 03ph8a2zXXXX --use-service-account
```

### Output Example

The script runs quietly during the translation phase and outputs a clean summary upon completion:

```text
2026-03-19 11:10:05 [INFO] Mode: User Authentication (OAuth 2.0)
2026-03-19 11:10:05 [INFO]  -> User credentials loaded.
2026-03-19 11:10:06 [INFO] Verifying target group: 03ph8a2zXXXX...
2026-03-19 11:10:06 [INFO]  -> Group verified successfully: marketing-test@yourdomain.com (groups/03ph8a2zXXXX)
2026-03-19 11:10:06 [INFO] Reading machine names from: ./move_test.csv
2026-03-19 11:10:06 [INFO]  -> Found 3 unique machine names to process.
2026-03-19 11:10:06 [INFO] Starting Device ID lookup phase (this may take a moment)...
2026-03-19 11:10:08 [INFO] Lookup Complete.
2026-03-19 11:10:08 [INFO] Starting Add Operation to Group: marketing-test@yourdomain.com ...
2026-03-19 11:10:11 [INFO] 
2026-03-19 11:10:11 [INFO] ==================================================
2026-03-19 11:10:11 [INFO]                EXECUTION SUMMARY                  
2026-03-19 11:10:11 [INFO] ==================================================
2026-03-19 11:10:11 [INFO] Target Group: marketing-test@yourdomain.com
2026-03-19 11:10:11 [INFO] Group Resource: groups/03ph8a2zXXXX
2026-03-19 11:10:11 [INFO] Total Browsers Successfully Processed/Added: 2
2026-03-19 11:10:11 [INFO] Total Browsers Failed to Add: 0
2026-03-19 11:10:11 [INFO] Total Machine Names Not Found in Admin Console: 1
2026-03-19 11:10:11 [INFO] --------------------------------------------------
2026-03-19 11:10:11 [INFO] List of Machine Names Not Found in Tenant:
2026-03-19 11:10:11 [INFO]   • unknown-machine-01
2026-03-19 11:10:11 [INFO] ==================================================
```

# Chrome Enterprise Browser Wake Utility

A standalone, cross-platform Python utility ([`wake_browser.py`](https://github.com/google/ChromeBrowserEnterprise/blob/main/Python/wake_browser.py)) designed to silently "wake" system-installed Google Chrome browsers on **Windows, macOS, and Linux** endpoints so they enroll in **Chrome Enterprise Core (CEC / CBCM)**, fetch cloud policies, and upload device/extension telemetry.

## The Challenge
Deploying a `CloudManagementEnrollmentToken` via GPO, Registry, Configuration Profile (MDM), or Linux JSON policy does not immediately register a device in the Google Admin Console—Chrome must actually launch at least once to read the token, request a `DMToken` from Google's device management servers, and report initial status. On newly imaged workstations, VDI golden/session hosts, or unattended machines where no user has opened Chrome yet, devices remain invisible in the Admin Console.

Unlike legacy OS-specific scripts that rely on fragile username regex matching or hardcoded `C:\temp` folders, `wake_browser.py` uses **100% Python Standard Library** (zero `pip` dependencies) with strict security, binary signature, and process-isolation safeguards across all three desktop operating systems.

## Features
* **Cross-Platform & Zero Dependencies:** Runs out-of-the-box on **Windows**, **macOS**, and **Linux** using only the Python 3.8+ standard library—no `pip install` required on managed endpoints.
* **System-Level Installation Enforcement:** Strictly resolves Chrome from OS system application directories (`Program Files` / `Program Files (x86)` on Windows, `/Applications/Google Chrome.app` on macOS, and `/opt/google/chrome` or `/usr/bin` on Linux):
  * Explicitly rejects user-profile Chrome installations (`%LOCALAPPDATA%`, `~/Applications`, `/home`) and blocks symlink/junction redirection into user space.
  * Verifies Google Authenticode signatures on Windows, `codesign` signatures on macOS, and `root` (`uid=0`) file ownership on Linux before execution.
* **Same-User Process Protection (Exact SID / UID):** Inspects running Chrome processes using exact Windows Security Identifiers via native Win32 APIs (e.g., `S-1-5-18` for `NT AUTHORITY\SYSTEM` or the user's Entra/AD SID) and numeric POSIX UIDs on macOS/Linux. If Chrome is already running under the **same user** executing the script, it skips launching cleanly without disrupting active sessions or tripping over localized OS account names.
* **Enrollment Token Auditing & Live DMToken Detection:** Checks standard machine policy locations across 32-bit and 64-bit Windows `HKLM` registry views, macOS Managed Preferences/token files, and Linux managed policy JSONs:
  * **Flags Missing Tokens Without Skipping:** Logs an explicit `WARNING` (`FLAG: No CloudManagementEnrollmentToken was found...`) if no enrollment token is present on the host, while still launching Chrome so previously enrolled browsers can sync policies and telemetry.
  * Monitors for newly generated `DMToken` artifacts during the wake window to confirm first-time cloud enrollment in the logs.
* **Windows UAC De-Elevation Guard:** Automatically passes `--do-not-de-elevate` on Windows so running from an elevated Administrator context does not trigger Chromium's `RunDeElevated` relaunch via `explorer.exe` (which would otherwise orphan a browser process and exit the tracked PID prematurely).
* **Scoped Process-Tree Termination & Secure Cleanup:** Launches Chrome inside a `0700`-permissioned temporary profile directory (`tempfile.mkdtemp`), terminates **only** the exact spawned process tree (`taskkill /PID <pid> /T` on Windows; dedicated process group `os.killpg` on macOS/Linux), and removes temporary files in a guaranteed `finally` block with file-lock retries.
* **MDM-Ready Logging & Exit Codes:** Writes structured logs to both `stdout` and `wake_browser.log` (automatically falling back to the OS temp directory if the working directory is read-only) and returns distinct exit codes for Intune, SCCM, Jamf, Workspace ONE, or Ansible detection rules.

---

## ⚙️ Prerequisites

1. **Python 3.8+** installed on the target endpoint.
2. **System-Level Google Chrome** installed in the standard OS application folder:
   * **Windows:** `C:\Program Files\Google\Chrome\Application\chrome.exe` (or `Program Files (x86)`) — Enterprise MSI recommended.
   * **macOS:** `/Applications/Google Chrome.app` — Enterprise PKG recommended.
   * **Linux:** `/opt/google/chrome/chrome` or `/usr/bin/google-chrome-stable`.
3. **External Python Packages:** **None** (uses Python Standard Library only).

---

## 🔧 Setup

1. Download [`wake_browser.py`](https://github.com/google/ChromeBrowserEnterprise/blob/main/Python/wake_browser.py).
2. *(Recommended)* Ensure your `CloudManagementEnrollmentToken` policy is deployed to the machine via Group Policy, Intune, Jamf Configuration Profile, or `/etc/opt/chrome/policies/managed/`.
3. Deploy and execute `wake_browser.py` via your endpoint management tool (e.g., as `NT AUTHORITY\SYSTEM` in Intune/SCCM, `root` via Jamf/LaunchDaemon/cron, or in user context).

---

## :factory: Usage

Use `python3 wake_browser.py --help` to view all command-line options:

```text
options:
  --wait-seconds WAIT_SECONDS
                        Seconds to keep Chrome running for enrollment & telemetry upload (default: 45).
  --shutdown-grace-seconds SHUTDOWN_GRACE_SECONDS
                        Seconds to wait for graceful browser exit before force-killing (default: 10).
  --profile-name PROFILE_NAME
                        Temporary Chrome profile directory name (default: CECProfile).
  --headless            Pass --headless=new to Chrome (optional; auto-enabled on GUI-less Linux).
  --skip-signature-check
                        Skip OS binary signature verification on Chrome executable.
  --dry-run             Run all pre-flight checks (system install, same-user process, token) without launching Chrome.
  --log-file LOG_FILE   Path to log file (default: ./wake_browser.log, falling back to system temp dir).
  --verbose             Enable verbose DEBUG logging to stdout.
```

### 1. Standard Run (MDM / Unattended Wake)
Launches system Chrome in an isolated temporary profile, waits 45 seconds for CEC enrollment and telemetry reporting, terminates the spawned browser tree, and deletes the temporary profile:

```bash
# macOS / Linux
python3 wake_browser.py

# Windows
python wake_browser.py
```

### 2. Pre-Flight Validation Only (`--dry-run`)
Verifies the system-level Chrome binary, digital signature, `CloudManagementEnrollmentToken` presence, existing `DMToken` state, and same-user running Chrome processes without opening Chrome:

```bash
python3 wake_browser.py --dry-run --verbose
```

### 3. Silent / Headless Execution & Custom Duration
Suppresses visible browser windows when testing interactively or running on headless servers, with a custom wake duration and log location:

```bash
python3 wake_browser.py --headless --wait-seconds 60 --log-file /var/log/wake_browser.log
```

### 4. Windows `SYSTEM` Simulation (Testing Intune / SCCM Behavior)
Using Sysinternals `PsExec` to simulate unattended `NT AUTHORITY\SYSTEM` (`S-1-5-18`) execution:

```powershell
psexec -s python C:\Scripts\wake_browser.py --verbose
```

### Output Example

```text
2026-11-12 21:07:21,805 - INFO - Starting Chrome Wake check on Windows (11)...
2026-11-12 21:07:25,648 - DEBUG - Verified valid Google Authenticode signature on C:\Program Files\Google\Chrome\Application\chrome.exe
2026-11-12 21:07:25,650 - INFO - Verified system-level Chrome binary: C:\Program Files\Google\Chrome\Application\chrome.exe
2026-11-12 21:07:25,651 - INFO - Detected CloudManagementEnrollmentToken at 'HKLM\SOFTWARE\Policies\Google\Chrome\CloudManagementEnrollmentToken' (92b9...7fb3).
2026-11-12 21:07:25,669 - INFO - No existing Chrome processes detected for current user (S-1-5-18).
2026-11-12 21:07:25,676 - INFO - Launching Chrome with temporary profile 'C:\Windows\Temp\cec_wake_profile_f7fuxkwv' (waiting 45s)...
2026-11-12 21:07:31,910 - INFO - New Chrome Enterprise Core DMToken detected after 6.2s! Continuing wake window so initial policy & telemetry sync completes.
2026-11-12 21:08:10,702 - INFO - Wake duration (45s) completed.
2026-11-12 21:08:10,703 - INFO - Stopping temporary Chrome instance (root PID 10236)...
2026-11-12 21:08:13,115 - INFO - Cleaned up temporary Chrome profile directory: C:\Windows\Temp\cec_wake_profile_f7fuxkwv
```

---

## 📊 Exit Codes

| Exit Code | Status | Description |
| :--- | :--- | :--- |
| `0` | **Success / Skipped** | Browser wake cycle completed cleanly, `--dry-run` succeeded, **or** launch was skipped because Chrome is already running under the same user (SID/UID). |
| `2` | **No System Chrome** | System-level Google Chrome was not found (e.g., missing, installed only in a disallowed user folder like `%LOCALAPPDATA%` or `~/Applications`, or failed signature/ownership verification). |
| `3` | **Pre-Flight Error** | Unsupported operating system or failed current-user process/identity inspection. |
| `4` | **Launch Failure** | Chrome failed to start or exited unexpectedly before completing the wake window. |

---

## 📝 Logging & Debugging

* **`WARNING - FLAG: No CloudManagementEnrollmentToken was found in machine policy locations!`:** Indicates that no enrollment token was detected in `HKLM` (Windows), `/Library/Managed Preferences` or `/Library/Google/Chrome` (macOS), or `/etc/opt/chrome/policies` (Linux). By design, the script **still launches Chrome** so already-enrolled machines can refresh policies and report telemetry, while surfacing the missing policy in your MDM logs.
* **Exit Code `2` (`Detected user-level Chrome installation... which is disallowed`):** Chrome is installed in user space (`%LOCALAPPDATA%\Google\Chrome` or `~/Applications/Google Chrome.app`) rather than system-wide. Deploy the official Chrome Enterprise MSI (Windows) or PKG (macOS) to install Chrome at the machine level.
* **Skipping Launch When Chrome Is Already Open:** If you test the script interactively while your own Chrome browser is open, the script detects your matching UID/SID and exits `0` immediately without launching a second instance. Close Chrome or run the script under `SYSTEM` / `root` to execute a background wake cycle.
* **Log File Location:** Detailed `DEBUG` logs are written to `./wake_browser.log` by default. When launched by an MDM agent from a read-only working directory (such as `C:\Windows\System32` or `/`), the script automatically falls back to `<SystemTemp>/wake_browser.log` unless overridden with `--log-file`.

