# **🏔️ CERA: Chrome Enterprise Reports & Analysis**

**Phonetic Guide:** /siˈɛrə/ (pronounced like Sierra)

CERA (Chrome Enterprise Reports & Analysis) was built as a standalone, lightweight, and high-performance visualization dashboard built entirely on top of the customer's own **Google Apps Script** environment.

CERA bridges the gap between the high-level visibility of Chrome Enterprise and the deep forensic analysis that typically requires an expensive SIEM. By establishing a direct pipeline to the Google Admin SDK API, CERA dynamically extracts, chunks, and aggregates thousands of Chrome telemetry events into an interactive dashboard. This provides IT and Security teams with immediate answers regarding Shadow IT, generative AI exposure, and Data Loss Prevention (DLP) alerts.

* CERA operates strictly within your organization's verified Google environment.  
* All data extraction, in-memory aggregation, and chart rendering occur locally within the administrator's browser via Apps Script.  


**Prerequisites**

* **Administrative Access:** Must be a Super Admin or a delegated Admin with access to the **Reports/Audit Logs** privilege in the Google Admin Console.  
* **Chrome Enterprise Deployment:** Chrome browsers must be managed (via CEC or CEP), and **Chrome audit reporting** must be turned on in the Admin Console.

**Step-by-Step Deployment Guide**

### **Step 1: Create a New Project**

1. Navigate to [script.google.com](https://script.google.com).  
2. Click **New Project** in the top left corner.  
3. Rename the project to CERA: Chrome Enterprise Analytics by clicking "Untitled project" at the top.

### **Step 2: Configure the Manifest**

1. In the left-hand navigation, click the **Gear Icon (Project Settings)**.  
2. Check the box that says **"Show 'appsscript.json' manifest file in editor"**.  
3. Return to the **Code Editor** (\<\> icon).  
4. Select appsscript.json from the file list.  
5. Replace its contents with the provided [appsscript.json](cera/appsscript.json) code and hit **Save (Ctrl/Cmd \+ S)**.

### **Step 3: Enable the Admin SDK API**

*This step allows the application to securely read Chrome audit logs.*

1. In the left panel of the editor, click the **Plus (+)** button next to **Services**.  
2. Scroll down and select **Admin SDK API**.  
3. Leave the version as default (v1) and the identifier as AdminReports.  
4. Click **Add**.

### **Step 4: Add Backend & Frontend Code**

1. Select the default Code.gs file. Delete the placeholder code, paste the [Code.gs](cera/Code.gs) code provided below, and **Save**.  
2. Click the **Plus (+)** button next to "Files" and select **HTML**.  
3. Name the file exactly Index (case-sensitive, without the .html extension).  
4. Paste the [Index.html](cera/Index.html) code provided below and **Save**.

### **Step 5: Deploy the Application**

1. Click the blue **Deploy** button in the top right corner.  
2. Select **New deployment**.  
3. Click the gear icon next to "Select type" and choose **Web app**.  
4. Configure the settings as follows:  
   * **Description:** CERA v1.0  
   * **Execute as:** User accessing the web app *(This ensures every user authenticates with their own Admin permissions, enforcing strict zero-trust).*  
   * **Who has access:** Only myself *(or Anyone within \[Your Organization\] if sharing with other internal Admins).*  
5. Click **Deploy**.  
6. Google will ask for Authorization. Click **Authorize access**, select the Admin account, and click "Allow" to grant read access to the audit logs.  
7. **Copy the Web App URL**. This is the secure, private link to the CERA Dashboard.
