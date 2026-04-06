# Getting Started with Chrome Browser Enterprise APIs

This guide provides the foundation for using the automation scripts and tools found in this repository. To interact with Google Chrome Enterprise services, you must first configure a Google Cloud project and establish a secure authentication method.
### Identifying Your Tier
Before calling Premium APIs (like DLP events), verify the SKU assignment:
* **Product ID:** `101040`
* **Premium SKU ID:** `1010400001`

---

## 1. Enable APIs at the Project Level
Before any script can run, the specific Google Cloud APIs must be enabled within your Google Cloud Project. This acts as the "on switch" for the services.

1.  Go to the [Google Cloud Console](https://console.cloud.google.com/).
2.  Select (or create) your project.
3.  Navigate to **APIs & Services > Library**.
4.  Search for and **Enable** the following APIs:
    * **[Chrome Management API](https://developers.google.com/chrome/management)**: For browser reporting, telemetry, and app management.
    * **[Chrome Policy API](https://developers.google.com/chrome/polic)**: For managing browser policies programmatically.
    * **[Admin SDK API](https://support.google.com/chrome/a/answer/9681204?ref_topic=9301744&hl=en)**: For managing Organizational Units (OUs) and Directory settings.
    * **[Cloud Identity API](https://docs.cloud.google.com/identity/)**: For provisioning and managing identity resources.
    * **[Access Context Manager API](https://docs.cloud.google.com/access-context-manager/docs/reference/rest)**: For setting attribute based access control to requests to Google Cloud services.
    * **[Cloud Resource Manager API](https://docs.cloud.google.com/resource-manager/docs)**: Creates, reads, and updates metadata for Google Cloud Platform resource containers.

---

## 2. Identify Required Scopes
Scopes define the level of access a script has. The tools in the `/Python` folder typically require one or more of the following:

| Service | Scope URL | 
| :--- | :--- | 
| **Chrome Management** | `https://www.googleapis.com/auth/chrome.management.appdetails.readonly`, `https://www.googleapis.com/auth/chrome.management.profiles`, `https://www.googleapis.com/auth/chrome.management.reports.readonly` | 
| **Chrome Policy** | `https://www.googleapis.com/auth/chrome.management.policy`, `https://www.googleapis.com/auth/chrome.management.policy.readonly` | 
| **Admin SDK** | `https://www.googleapis.com/auth/admin.directory.device.chromebrowsers`, `https://www.googleapis.com/auth/admin.directory.device.chromebrowsers.readonly`, `https://www.googleapis.com/auth/admin.directory.orgunit.readonly`, `https://www.googleapis.com/auth/admin.reports.audit.readonly` | 
| **Cloud Identity API** | `https://www.googleapis.com/auth/cloud-identity.groups`, `https://cloudidentity.googleapis.com/v1/policies`, `https://cloudidentity.googleapis.com/v1beta1/policies`, ``, | 
| **Access Context Manager API** | `https://accesscontextmanager.googleapis.com/v1`,`https://beyondcorp.googleapis.com/v1` | 

*Note: Always use the most restrictive scope possible (e.g., `.readonly`) if your script does not need to make changes.*

---

## 3. Choose Your Authentication Method
We prioritize two methods that avoid the security overhead of Domain-Wide Delegation.

### Option A: OAuth 2.0 Interactive (User-Based)
**Best for:** Local testing or manual scripts run by an administrator.
1.  In Cloud Console, go to **APIs & Services > Credentials**.
2.  Click **Create Credentials > OAuth client ID**.
3.  Select **Desktop App**.
4.  Download the `client_secrets.json`. When you run a script, it will prompt you to log in via a browser to authorize the action.

### Option B: Service Account + Custom Roles (Automation)
**Best for:** Server-side automation, cron jobs, and CI/CD pipelines.

**Step 1: Create the Service Account**
1.  Go to **IAM & Admin > Service Accounts**.
2.  Click **Create Service Account**, name it, and click **Done**.
3.  Click the Service Account email > **Keys** > **Add Key** > **Create new key (JSON)**.
4.  Download and save this key securely (never commit this to GitHub).

**Step 2: Assign the Service Account to an Admin Role**
Instead of granting broad impersonation rights, we assign the service account email directly to a role in the Admin Console.
1.  Go to the [Google Admin Console](https://admin.google.com) > **Account > Admin roles**.
2.  Create a **Custom Role** (e.g., "Chrome API Automator") and select the specific Chrome Management privileges required.
3.  Click **Assign service accounts**.
4.  Paste the **Service Account Email** address and click **Add**.
5.  Click **Assign Role**.

---

## 🛠 Troubleshooting
* **403 Forbidden:** Ensure the API is enabled in the Cloud Project **and** the Service Account has been assigned the correct Role in the Admin Console.
* **Insufficient Permissions:** Verify the script is requesting the same scopes that were authorized during setup.
* **Credential Security:** If a Service Account key is ever accidentally shared or committed to code, delete it immediately in the Cloud Console and generate a new one.
