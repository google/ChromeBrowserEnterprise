# Chrome Enterprise API Setup Guide

This guide provides a unified walkthrough for setting up APIs for **Chrome Enterprise Core** and **Chrome Enterprise Premium (CEP)**. 

## 1. Prerequisites
* **Google Admin Console:** Access to [admin.google.com](https://admin.google.com).
* **Google Cloud Project:** A project created in the [Google Cloud Console](https://console.cloud.google.com).
* **Licenses:** For Premium features, ensure users/devices have **SKU 1010400001** assigned (Product **101040**).

---

## 2. Authentication Strategy: The Hybrid Pattern
This guide utilizes a **Hybrid Auth Module** that allows developers to swap between Service Accounts and User OAuth without changing core logic.

### Method A: User OAuth 2.0 (Interactive)
Best for local scripts and one-off administrative tasks.
* **Permissions:** The application inherits the specific permissions of the logged-in administrator.
* **Setup:** Create an **OAuth Client ID** (Desktop App) in the Google Cloud Console.
* **Persistence:** Credentials are stored locally (e.g., `token.pickle`) to minimize repeated browser logins.

### Method B: Service Account (Automation)
Best for backend servers and CI/CD pipelines.
* **Security Configuration:** Domain-Wide Delegation (DWD) is discouraged. Instead, assign the Service Account a specific **Admin Role** (e.g., *Chrome Management Admin*) directly in the Google Admin Console.
* **Setup:** Create a Service Account in GCP, download the **JSON Key**, and copy its **Unique ID** to the Admin Console for role assignment.

---

## 3. Implementation Pattern: Switchable Auth
The following implementation is the standard for the Python management suite. It allows a script to adapt its authentication method based on the environment.

```python
def get_credentials(use_service_account=False):
    """
    Standardized Auth Switch: Supports Service Account Keys or User OAuth.
    """
    creds = None
    if use_service_account:
        # Load from JSON Key for Server/Headless environments
        creds = service_account.Credentials.from_service_account_file(
            SERVICE_ACCOUNT_FILE, scopes=SCOPES)
    else:
        # Load/Refresh local OAuth token for Interactive environments
        if os.path.exists(TOKEN_PICKLE_FILE):
            with open(TOKEN_PICKLE_FILE, "rb") as token:
                creds = pickle.load(token)
        
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                flow = InstalledAppFlow.from_client_secrets_file(
                    CLIENT_SECRETS_FILE, SCOPES)
                creds = flow.run_local_server(port=0)
            with open(TOKEN_PICKLE_FILE, "wb") as token:
                pickle.dump(creds, token)
    return creds
```

## 3. The Master Scope Reference

| Functional Area | Read-Only Scope | Read/Write Scope |
| :--- | :--- | :--- |
| **Managed Browsers** | `.../auth/admin.directory.device.chromebrowsers.readonly` | `.../auth/admin.directory.device.chromebrowsers` |
| **Policies** | `.../auth/chrome.management.policy.readonly` | `.../auth/chrome.management.policy` |
| **Org Units** | `.../auth/admin.directory.orgunit.readonly` | `.../auth/admin.directory.orgunit` |
| **Identity/Groups** | `.../auth/cloud-identity.policies.readonly` | `.../auth/cloud-identity.policies` |
| **App Inventory** | `.../auth/chrome.management.appdetails.readonly` | N/A |
| **Reports** | `.../auth/chrome.management.reports.readonly` | N/A |
| **Audit Logs** | `.../auth/admin.reports.audit.readonly` | N/A |

## 4. Key Implementation Patterns

### Identifying Your Tier
Before calling Premium APIs (like DLP events), verify the SKU assignment:
* **Product ID:** `101040`
* **Premium SKU ID:** `1010400001`

### Checking Chrome Version Status
Use the public **Version History API** to verify if your fleet is up to date:
`GET https://versionhistory.googleapis.com/v1/chrome/platforms/win64/channels/stable/versions/all/releases?order_by=version%20desc&filter=version>=145,pinnable=true`

## 5. Troubleshooting
* **Error 403 (Forbidden):** Ensure the Service Account has been explicitly assigned an Admin Role in the Admin Console. GCP project permissions alone are insufficient for Workspace data.
* **Error 401 (Unauthorized):** Your `token.json` has expired or the scopes have changed. Delete the file and re-authenticate.
* **Scope Issues:** If you add a new scope to your code, you MUST delete your local token and re-authorize.
* **Secure Storage**: Never commit `service-account.json` or `token.pickle` files to version control.

## 6. Resources
* [Chrome Management API Reference](https://developers.google.com/chrome/management)
* [Chrome Policy API Overview](https://developers.google.com/chrome/policy/guides/overview)
* [Directory API OrgUnits](https://developers.google.com/workspace/admin/directory/reference/rest/v1/orgunits)
* [Managing Licenses (How-to)](https://www.google.com/search?q=https://developers.google.com/workspace/admin/licensing/v1/how-tos/using%23managing_licenses)
* [Cloud Identity Documentation](https://docs.cloud.google.com/identity/docs)
* [Workspace Admin SDK Home](https://developers.google.com/workspace/admin)
