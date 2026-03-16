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
    ```bash
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
   ```Bash
    python policy_exporter.py orgunits/03ph8a2z12345
    ```

    Optional: Use `--local-only` to skip inherited policies.

2. Export from a Google GroupExports policies applied directly to the group.
    ```Bash
    python policy_exporter.py groups/02gq7lqe2abc
    ```
3. Export using Service Account
    ```Bash
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
    ```Bash
    python policy_importer.py my_ou_backup.json orgunits/03ph8a2z98765
    ```
2. Import to a Google Group
    ```Bash
    python policy_importer.py my_group_backup.json groups/02gq7lqe2abc
    ```
3. Import using Service Account
    ```Bash
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
   ```Bash
    python policy_inheritor.py orgunits/03ph8a2z12345
    ```

    Note: The script will prompt for confirmation before making changes.

### 📝 Logging & Debugging
Both tools include a `DEBUG` toggle at the top of the script:
    ```Python
    DEBUG = False  # Set to True to enable file logging
    ```
- Console Output: Shows real-time progress, validation errors, and "Smart Fix" actions.
- debug_log.txt: If enabled, captures full stack traces, API response details, and input arguments for troubleshooting.

# Chrome Enterprise Premium (CEP) DLP Policy Manager

A robust Python utility designed for Chrome Enterprise administrators to export, backup, and restore Data Loss Prevention (DLP) Rules and Custom Detectors (Regex, Word Lists, URL Lists). 

Unlike standard Admin Console interfaces, this script allows for true "infrastructure as code" management of your Chrome DLP environment. It handles complex dependency mapping automatically, ensuring that rules which rely on custom detectors are restored correctly even when Google generates new backend Policy IDs.

## Features

* **Chrome-Scoped Exports:** Automatically filters the tenant's global Cloud Identity policies to export *only* rules containing `google.workspace.chrome` triggers.
* **Intelligent Dependency Mapping:** When importing from a backup, the script automatically translates old custom detector IDs in your rules to the newly generated Google backend IDs.
* **Dual API Support:** Uses the `v1` endpoint for safe read-only exports and the `v1beta1` endpoint for mutations (imports/creations).
* **Dynamic Scoping:** Restores rules exactly to their original Organizational Units or Groups as defined in the JSON, or allows CLI overrides to push a template of rules to a brand new OU/Group.
* **Built-in Rate Limiting:** Safely throttles API requests (1.5s delay) to respect Google's strict 1 QPS quota on Beta policy APIs, preventing `429 RESOURCE_EXHAUSTED` errors.
* **Flexible Authentication:** Supports both User OAuth 2.0 (for interactive admin runs) and Service Accounts (for automated/cron jobs).

---

## ⚠️ Important Note on Custom Detectors & Scoping

Due to the architecture of the Cloud Identity Policies API, **Custom Detectors (Regex, Word Lists, URL Lists) cannot be assigned to Google Groups.** They must be assigned to an Organizational Unit (OU). 

* **Best Practice:** When defining Detectors in your import JSON, always set their `policyQuery.orgUnit` to your **Root OU ID**. This ensures that the detectors are globally available and can be referenced by DLP Rules located anywhere in your domain.
* **Script Behavior:** If you use the `--group-id` flag during an import to override the targets, the script is smart enough to apply that Group *only* to the DLP Rules. For the Detectors, it will ignore the Group override and safely fall back to the native OU ID defined in your JSON file.

---

## Prerequisites

1. **Python 3.8+**
2. **Google Cloud Project** with the following APIs enabled:
   * [Cloud Identity API](https://docs.cloud.google.com/identity/docs/how-to/setup-policies)
3. **Required Python Packages:**
   ```bash
   pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib
   ```

---

## Required OAuth Scopes
Your application/credentials will need the following scopes:

- `https://www.googleapis.com/auth/cloud-identity.policies.readonly` (For Exporting)
- `https://www.googleapis.com/auth/cloud-identity.policies` (For Importing)

---

## 🔧 Setup
1. Clone or download this repository.
2. Open [`cep_dlp_policy_manager.py`](https://github.com/google/ChromeBrowserEnterprise/blob/main/Python/cep_dlp_policy_manager.py) in your text editor.
3. Update the `CUSTOMER_ID` variable with your Google Workspace Customer ID (e.g., `customers/C0xxxxxxx`).
4. Update the `SERVICE_ACCOUNT_FILE` and `CLIENT_SECRETS_FILE` variables to point to your local Google Cloud credential JSON files.

## :factory: Usage
The script is divided into two main commands: `export` and `import`.

### 1. Exporting DLP Configurations

Exports all Chrome-scoped DLP rules, Regex Detectors, Word Lists, and URL Lists into a single, version-controllable JSON file. 

The `--file` parameter is **optional**. If you omit it, the script will automatically generate a timestamped filename (e.g., `chrome_dlp_export_Mar_08_2026_16-00.json`).

**With an auto-generated filename:**
```bash
python cep_dlp_policy_manager.py export
```

### 2. Importing / Restoring (Native Targets)

Reads the backup JSON and restores the detectors and rules exactly as they were defined, applying them to their original OUs and Groups.

```bash
python cep_dlp_policy_manager.py import --file my_dlp_backup.json
```

### 3. Importing / Overriding Targets (Template Deployment)

If you want to take a backup file and deploy all of its rules to a completely new Organizational Unit or Group (ignoring the targets saved in the JSON), use the override flags.

**To apply all rules to a specific OU:**
```bash
python cep_dlp_policy_manager.py import --file my_dlp_backup.json --ou-id 03ph8a2zXXXX
```

**To apply all rules to a specific Group:**
```bash
python cep_dlp_policy_manager.py import --file my_dlp_backup.json --group-id 041mghmXXXX
```

### Service Account Authentication

For automated backups, bypass the interactive browser login by appending the Service Account flag to any command:

```bash
python cep_dlp_policy_manager.py export --use-service-account
```

### 4. Sample Import Data

A [`cep-dlp-sample_import.json`](https://github.com/google/ChromeBrowserEnterprise/blob/main/Python/cep-dlp-sample_import.json) file is included in this repository to demonstrate the exact payload structure required by the script. 

This sample includes three custom detectors (Regex, Word List, and URL List) and one Chrome DLP Rule that actively references the Regex and URL List. It perfectly demonstrates the script's automatic **Dependency Mapping** feature.

To test the script safely using this sample file, run an override command targeting a safe test Organizational Unit:

```bash
python cep_dlp_policy_manager.py import --file cep-dlp-sample_import.json --group-id 041mghmXXXX
```

## 📝 Logging & Debugging
- **HTTP 400 (INVALID_ARGUMENT):** Usually occurs if you attempt to import a rule that references a custom detector ID that does not exist in the JSON payload or the tenant. Ensure you are importing the entire backup payload so detectors are created first.

- **HTTP 429 (RESOURCE_EXHAUSTED):** The Cloud Identity Policies API has a strict 1 QPS limit. The script handles this automatically with a time.sleep(1.5) throttle. Do not remove this throttle.

- **Debug Logging:** Run the script with the `--debug` flag to generate a `dlp_debug_log.txt` containing full Python tracebacks and raw Google API JSON responses.

---

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
2. Open [`move_chrome_browsers.py`]() in a text editor.
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

