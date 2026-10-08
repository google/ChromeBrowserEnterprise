# CERA (Chrome Egress Risk Analysis) — Disclaimer, Terms of Use & Tenant Privacy Policy

> **Not an Official Google Product:** This repository and the Chrome Egress Risk Analysis (CERA) tool are **not officially supported Google products**. CERA is an open-source reference utility released on an **"AS IS"** basis under the [Apache License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0).

---

## 1. No Official Google Support or Service Level Agreement (SLA)

CERA is provided as a self-hosted open-source reference tool for Google Workspace and Chrome Enterprise administrators.
* It is **not** covered by any Google Workspace, Google Cloud, or Chrome Enterprise Service Level Agreement (SLA), support contract, or technical support entitlement.
* Google Technical Support Services (TSS) does not provide support, troubleshooting, or bug fixes for CERA deployments.

---

## 2. "AS IS" Open-Source Release & Limitation of Liability

In accordance with **Sections 7 and 8 of the Apache License, Version 2.0**:
* **No Warranty:** Unless required by applicable law or agreed to in writing, the authors and contributors provide this software on an **"AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND**, either express or implied, including, without limitation, any warranties or conditions of title, non-infringement, merchantability, or fitness for a particular purpose. You are solely responsible for determining the appropriateness of using or redistributing the software.
* **No Liability:** In no event and under no legal theory, whether in tort (including negligence), contract, or otherwise, shall any author or contributor be liable to you for damages, including any direct, indirect, special, incidental, or consequential damages of any character arising as a result of this license or out of the use or inability to use the software (including but not limited to damages for loss of goodwill, work stoppage, quota exhaustion, computer failure or malfunction, or any and all other commercial damages or losses).

---

## 3. Informational Sample Only — Not a Comprehensive Security Audit

CERA is designed to provide **directional visibility and executive insights** from a sample of Chrome Enterprise log events (by default, a 7-day sample). It is **not** a continuous Data Loss Prevention (DLP) enforcement engine, a Security Information and Event Management (SIEM) system, or a formal compliance audit certification:
* **Log Completeness Depends on Tenant Configuration:** CERA can only report events that were logged by Chrome and exported or returned by the Admin SDK. If Chrome event reporting is not enabled on specific organizational units (OUs), if users operate unmanaged browsers or unmonitored profiles, or if required log columns are absent, those activities will not appear in the generated reports.
* **Absence of Findings Is Not Proof of Zero Egress:** A report showing zero sensitive transfers or zero security signals means only that none were recorded in the supplied log sample. Organizations must not rely on CERA outputs as legal, regulatory, or forensic certification that no data egress or security incident has occurred.
* **Classification Heuristic Limits:** Destination categories (Personal Accounts, Shadow AI, Unmanaged Apps, Web Messaging) rely on domain lists and log metadata configured during setup. Administrators are responsible for reviewing and customizing corporate, partner, and sanctioned domain lists for their environment.

---

## 4. Customer Environment Execution, Quotas & Administrator Responsibility

CERA executes entirely within the customer's own Google Workspace environment under the OAuth credentials of the administrator who authorizes and runs the script:
* **Google Apps Script & API Quotas:** Running CERA (particularly Direct Ingestion via the Admin SDK Reports API and automated 1-minute background triggers) consumes the authorizing user's daily Google Apps Script execution time quota (typically 6 hours/day for Google Workspace accounts), Admin SDK Reports API quota, and Google Drive storage for partition spreadsheets.
* **Access Control & Governance:** Generated Google Slides presentations, Google Sheets workbooks, and Google Drive partition folders contain sensitive organizational audit metadata (such as user email addresses, organizational units, file names, and destination URLs). The customer and the running administrator are solely responsible for securing access permissions, sharing settings, and retention policies on the host spreadsheet and all generated Drive files.

---

## 5. Tenant Privacy & Local Execution Architecture

### 5.1 100% In-Tenant Apps Script Sandbox
All Chrome security log ingestion, action assembly, threat classification, spreadsheet generation, and slide deck rendering execute exclusively within your organization's Google Workspace domain and Google Apps Script runtime.

### 5.2 Zero Data Exfiltration & Zero External Telemetry
No audit logs, user identifiers, browsing histories, file names, domain names, or usage telemetry are ever transmitted to Google developer servers or any third-party cloud. CERA makes **zero** external network calls outside the Google Workspace APIs required to read your logs and generate your reports.

### 5.3 In-Tenant Google Drive Ownership
All partition spreadsheets, analytical workbooks, and executive slide decks are created directly in your organization's Google Drive under your explicit access control and corporate governance policies.

### 5.4 Minimal OAuth Scopes Used Within Your Tenant
When you authorize CERA in your Google Sheet, the consent screen requests only the scopes required to operate inside your Google Workspace account:

| OAuth Scope | Purpose Within Your Tenant |
|---|---|
| `spreadsheets` | Read exported log sheets and partitions; write the analytical workbook and Ingestion Monitor tab |
| `presentations` | Create the executive Google Slides briefing deck in your Google Drive |
| `drive.metadata.readonly` | Distinguish a single Sheet from a Drive folder and list exported Sheets inside the folder you select |
| `drive.file` | Create the partitions folder and partition spreadsheets generated by Direct Ingestion |
| `admin.reports.audit.readonly` | Read Chrome audit logs (`applicationName=chrome`) during Pre-Flight estimation and Direct Ingestion |
| `admin.directory.domain.readonly` | Read your tenant's verified corporate domains and aliases so internal transfers are not classified as personal accounts |
| `userinfo.email` | Determine the running user's primary corporate domain default |
| `script.container.ui` | Render the `🛡️ CERA` menu and setup dialog inside Google Sheets |
| `script.scriptapp` | Manage the 1-minute background trigger used by Direct Ingestion |
| `script.external_request` | Issue parallel Google Admin SDK Reports API requests (`googleapis.com`) during Pre-Flight volume estimation |
