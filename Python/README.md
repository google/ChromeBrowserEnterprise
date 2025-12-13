# Chrome Enterprise Policy Management Suite

A robust set of Python tools designed for Chrome Enterprise administrators to **export**, **backup**, and **import** Chrome browser policies. This suite fully supports both **Organizational Units (OUs)** and **Google Groups**, handling complex App/Extension policies and intelligent "auto-repair" logic for seamless migrations.

## 🚀 Key Benefits

* **Universal Support:** Manage policies for both **OUs** (hierarchical) and **Groups** (flat).
* **Version Control:** Export policies to JSON to track changes over time using Git.
* **Disaster Recovery:** Restore complex policy configurations to any OU or Group in seconds.
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

Before running the scripts, open both `policy_exporter.py` and `policy_importer.py` and update the `CUSTOMER_ID` constant:

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

## 📦 Tool 1: Policy Exporter (`policy_exporter.py`)
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

## 📥 Tool 2: Policy Importer (policy_importer.py)
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
### 📝 Logging & Debugging
Both tools include a `DEBUG` toggle at the top of the script:
    ```Python
    DEBUG = False  # Set to True to enable file logging
    ```
- Console Output: Shows real-time progress, validation errors, and "Smart Fix" actions.
- debug_log.txt: If enabled, captures full stack traces, API response details, and input arguments for troubleshooting.

# Chrome Policy Migrator

A script to automate the migration of Chrome user policies between Organizational Units (OUs) in Manage User Settings using the [Chrome Policy API](https://developers.google.com/chrome/policy/guides/overview).

## 🚀 Features

* **Full Migration:** Copies the *effective* policy state (inherited + local policies) from a source OU to a destination OU.
* **Local-Only Migration:** Optional flag (`--local-only`) to copy *only* policies explicitly set at the source OU level, ignoring inherited policies.
* **Smart Filtering:** automatically skips known restricted policies (e.g., `Root OU Only` policies) to prevent API permission errors.
* **Batch Processing:** Uses efficient batch requests to apply policies.

## ⚙️ Prerequisites

1.  **Python 3.x** installed.
2.  **Google Client Libraries:** Install required packages:
    ```bash
    pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib
    ```

## 🔧 Configuration

1.  Place [policy_migrator.py](policy_migrator.py) and your `client_secrets.json` file in the same directory.
2.  Open `policy_migrator.py` in a text editor.
3.  **Update Configuration:**
    * Set `CUSTOMER_ID` to your Google Workspace customer ID (e.g., `customers/C00xxxxxx`).
    * (Optional) Update `CLIENT_SECRETS_FILE` if your JSON file has a different name or path.

## :package: Usage

Run the script from the command line, providing the Source OU ID and Destination OU ID.

### Local-Only Migration
Copies only the policies that are explicitly configured on the source OU.
```bash
python policy_migrator.py orgunits/source_id orgunits/destination_id --local-only
```

### Migrate Effective Policies
Copies all policies that apply to users in the source OU, including those inherited from parent OUs.
```bash
python policy_migrator.py orgunits/source_id orgunits/destination_id
```

##  📝  Troubleshooting
* **Debug Mode:** To see detailed API responses and error stack traces, change `DEBUG = False` to `DEBUG = True` inside the script. Logs will be written to `debug_log.txt`.

* **403 Errors:** If you receive permission errors, ensure your admin account has the correct Chrome Management privileges and that the API is enabled in your GCP project.


# Move Chrome browsers between Organization Units
You can use the [moveBrowserToOrgUnit](moveBrowserToOrgUnit.py) to move enrolled browser between Organization Units (OU). 

Note: You will need to add the customer ID, the service account key JSON file, and the destination OU path to the script.

👉 Add the customer id [here](https://github.com/google/ChromeBrowserEnterprise/blob/main/Python/moveBrowserToOrgUnit.py#L12). You can find the customer Id by navigating to the Google Admin Console > Account > Account Settings.

👉 Add the path to the OAuth client secret file [here](https://github.com/google/ChromeBrowserEnterprise/blob/main/Python/moveBrowserToOrgUnit.py#L10). You can download the file from the Google Developer Console

👉 Add the [destination OU path](https://github.com/google/ChromeBrowserEnterprise/blob/main/Python/moveBrowserToOrgUnit.py#L14). An example of the destination OU path 'North America/Austin/AUS Managed User'

```
python moveBrowserToOrgUnit.py
```

# Get Chrome Signed-On User account names
You can use the [cbcm-profiles-export.py](cbcm-profiles-export.py) to get a CSV export of Signed-On User account names. 

Note: You will need to add the customer ID, the service account key JSON file, and the destination OU path to the script.

👉 Add the customer id [here](https://github.com/google/ChromeBrowserEnterprise/blob/main/Python/cbcm-profiles-export.py#L24). You can find the customer Id by navigating to the Google Admin Console > Account > Account Settings.

👉 Add the path to the OAuth client secret file [here](https://github.com/google/ChromeBrowserEnterprise/blob/main/Python/cbcm-profiles-export.py#L22). You can download the file from the Google Developer Console

👉 Optional: Add the [destination OU path](https://github.com/google/ChromeBrowserEnterprise/blob/main/Python/cbcm-profiles-export.py#L26). An example of the destination OU path 'North America/Austin/AUS Managed User'

```
python cbcm-profiles-export.py
```

# Get extension list with Chrome Profile 
You can use the [cbcm-browser-extension-profile-export.py](cbcm-browser-extension-profile-export.py) to get a CSV export of all extensions from managed browser including Profile and Signed-On User account names. 

Note: You will need to add the customer ID, the service account key JSON file, and the destination OU path to the script.

👉 Add the customer id [here](https://github.com/google/ChromeBrowserEnterprise/blob/main/Python/cbcm-profiles-export.py#L24). You can find the customer Id by navigating to the Google Admin Console > Account > Account Settings.

👉 Add the path to the OAuth client secret file [here](https://github.com/google/ChromeBrowserEnterprise/blob/main/Python/cbcm-profiles-export.py#L22). You can download the file from the Google Developer Console

👉 Optional: Add the [destination OU path](https://github.com/google/ChromeBrowserEnterprise/blob/main/Python/cbcm-profiles-export.py#L26). An example of the destination OU path 'North America/Austin/AUS Managed User'

```
python cbcm-browser-extension-profile-export.py
```
Here is an example of what that data will look like:
![Sample output](cbcm-browser-extension-profile-export-Capture.PNG)


# BlockExtensionBasedOnRiskScore Script

This Python script, `BlockExtensionBasedOnRiskScore.py`, automates the process of identifying and blocking potentially risky Chrome extensions in a Chrome Browser Cloud Management environment. It evaluates extensions based on risk scores obtained from Crxcavator and Spin.ai.

Note: If the risk scores of the newest versions of installed extensions are not available, this script will pick up the scores from the older versions.

### Configuration 

👉 `SERVICE_ACCOUNT_FILE`: Path to your service account key JSON file. 

👉 `CUSTOMER_ID`: Your Google Workspace customer ID. You can find the customer Id by navigating to the Google Admin Console > Account > Account Settings.

👉 `CRX_RISK_THRESHOLD` and `SPIN_RISK_THRESHOLD`: The risk thresholds for Crxcavator and Spin.ai scores.

👉 `ADMIN_USER_EMAIL`: The email address of an admin user in your Google Workspace.

👉 `TARGET_OU`: The OU name where extensions will be blocked.  An example of the destination OU name would be ’AUS Managed User'


```
python BlockExtensionBasedOnRiskScore.py
```

![Sample output](BlockExtensionBasedOnRiskScoreOutput.png)

# Get information about Chrome browsers that are managed by your organization using Chrome Enterprise Core
[cbcm-browser-basic-export.py](https://github.com/google/ChromeBrowserEnterprise/blob/main/Python/cbcm-browser-basic-export.py) automates the process of collecting and organizing important details about Chrome browsers managed using Chrome Enterprise Core (CEC), making it easier to keep track of them.

The output include things like:
* Which computer it's on
* The browser's version
* Whether it has any updates waiting
* Number of installed extensions
* Number of configured browser policies
* When it was last used

The code takes all the collected browser information and neatly puts it into a CSV file.
