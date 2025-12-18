# Chrome Enterprise Policy Management with Terraform

This folder contains a reference implementation for managing Google Chrome Enterprise policies using **Infrastructure-as-Code (IaC)**. By using Terraform, administrators can enforce security baselines, maintain a version-controlled audit trail of changes, and prevent configuration drift across Organizational Units (OUs).



## 🚀 Overview
Managing Chrome via the Admin Console is often a manual, click-heavy process. This project allows you to:
* **Codify Security:** Define your "Golden Image" for browser security in `.tf` files.
* **Automate Deployment:** Use Terraform Cloud to push updates to Google Workspace.
* **Ensure Parity:** Easily replicate settings across Sandbox and Production OUs.

---

## 🛠 1. Tool Configuration

### Required Software
* **Terraform CLI:** Download and install the CLI for your OS.
* **Visual Studio Code:** Recommended for editing.
* **VS Code Extension:** Install the **HashiCorp Terraform** and **HashiCorp HCL** extensions for syntax highlighting and autocomplete.

---

## 🔐 2. Security & Authentication (Admin Setup)

Terraform requires a **Service Account** with specific permissions to manage your Workspace environment.

### Step A: Google Cloud Service Account
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g., `chrome-enterprise-tf`).
3. **Enable APIs:** Search for and enable the **Chrome Policy API** and the **Admin SDK API**.
4. **Create Service Account:** Navigate to **IAM & Admin > Service Accounts**.
   * Name the account (e.g., `tf-chrome-admin`).
   * Do not assign GCP roles (Workspace roles are assigned in the next step).
5. **Generate JSON Key:** Click on the account > **Keys** > **Add Key** > **Create new key** > **JSON**. Save this file securely.

### Step B: Google Workspace Permissions
1. Go to the [Google Admin Console](https://admin.google.com/).
2. Navigate to **Account > Admin roles**.
3. Select **Chrome Administrator** (or create a custom role with Chrome Policy permissions).
4. Click **Admins > Assign service accounts** and paste the **Email Address** of the Service Account created in Step A.

---

## ☁️ 3. Terraform Cloud Configuration
This project is configured to use **Terraform Cloud** for state management and collaboration.

1. Create a **New Workspace** in [Terraform Cloud](https://app.terraform.io/) (choose the CLI-driven workflow).
2. Go to **Settings > Variables**.
3. Add an **Environment Variable**:
   * **Key:** `GOOGLE_CREDENTIALS`
   * **Value:** Paste the *entire content* of the Service Account JSON key.
   * **Sensitive:** Check this box.
4. Update the `cloud` block in `main.tf` with your Organization and Workspace names.

---

## 📁 4. Project Setup

### Folder Structure
* `main.tf`: The core logic for policy resources.
* `variables.tf`: Declaration of required inputs (Customer ID, Org Unit IDs).
* `terraform.tfvars.example`: A template for local configuration.
* `.gitignore`: Prevents sensitive IDs from being committed to Git.

### Local Variables
Copy `terraform.tfvars.example` to a new file named `terraform.tfvars` and fill in your environment-specific IDs. This file is ignored by Git to protect your data.
```hcl
customer_id                = "C0xxxxxxx"
root_org_unit_id           = "id:03phxxxxxxxx"
managed_chrome_org_unit_id = "id:03phxxxxxxxx"
```

## 🏗 5. Deployment Workflow
Run these commands in your VS Code terminal:

1. **Initialize**: Connects to Terraform Cloud and downloads the Google Workspace provider.
```Bash
terraform init
```
2. **Plan**: Review the proposed changes before they are applied.
```Bash
terraform plan
```
3. **Apply**: Deploys the policies to your Google Admin Console.
```Bash
terraform apply
```

## ✅ 6. How to Verify
1. **Google Admin Console: Navigate to Devices > Chrome > Settings**. Verify that the policies are now showing as managed.

2. Local Browser: On a managed machine, navigate to `chrome://policy`. Click Reload policies to see the new settings live in the browser.

## ⚠️ 7. Important Considerations & Limitations
The `hashicorp/googleworkspace` provider is a powerful but specialized tool. Users should be aware of the following:

- **Archived Status**: This provider is currently archived by HashiCorp. While stable for standard policies, it may not be updated for the newest Chrome features.

- **Complex Schemas (TYPE_MESSAGE)**: Newer "V2" Chrome policies often use nested Protocol Buffer messages. Ensure you use the `jsonencode({ field = value })` structure for these.

- **Enum Precision**: Policies using `TYPE_ENUM` require the exact string representation (e.g., `INCOGNITO_MODE_AVAILABILITY_ENUM_UNAVAILABLE`) rather than integers.

- **Validation Bugs**: Some complex list types (e.g., `PolicyMergelist`) may trigger type-mismatch errors in the provider. For these, consider using a direct Python API script as a "sidecar" to your Terraform workflow.
