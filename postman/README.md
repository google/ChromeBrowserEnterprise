# Getting started with the Chrome Browser Cloud Management API with Postman
Using [Postman](https://www.postman.com/), you can accelerate the design, mocking, and testing of your scripts to make the process easier than ever to use Chrome Browser Cloud Management APIs.

## Configure the OAuth consent screen
When you use OAuth 2.0 for authorization, Google displays a consent screen to the user, including a summary of your project, its policies, and the requested authorization scopes of access. Configuring your app's OAuth consent screen defines what is displayed to users and app reviewers and registers your app so you can publish it later.

There are two types:
- **Internal** is just for users within your Google Workspace users. Requires Google Workspace or Google Identity to function. Select this option for your Postman app.
- **External** is available to any test user with a Google Account. Your app will start in testing mode and will only be available to users you add to the list of test users. Once your app is ready to push to production, you may need to verify your app.


### Configure OAuth consent for Postman
Go to Menu menu > **APIs & Services > [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent)** in the Google Cloud console.

<img align="right" width="300" height="400" alt="OAuth consent screen scope" src="../../main/docs/images/consent_screen_scope.png"><img align="right" width="300" height="400" alt="OAuth consent screen" src="../../main/docs/images/consent_screen_1.png">


1. Enter the **App name** and the **user support email** (this is your admin account email in the admin console), and you can also choose to display a custom logo.
2. Under Authorized domains, enter **getpostman.com**.
3. Enter an **email address** that you want Google to notify you about changes in your project.
4. **Save and continue**. 
5. Scopes are listed **[here](../../blob/main/docs/auth.md)**. **Note** that the list contains both read-only and full access. Pick and choose which scopes you need for your specific use case or add all (recommended).
6. **Save and continue**.
7. **Optional**: Add a user(s) that can access while the publishing status is listed as “Testing”. Enter the account you used to create the project and any others you want to provide access to by hitting the add users button. 
8. Click **Save and continue**, review the summary screen, and hit the back to dashboard button. 

### OAuth client ID credentials
To authenticate as an end user and access user data in your app, you must create one OAuth 2.0 Client IDs.
<img align="right" width="200" height="300" alt="OAuth credentials" src="../../main/docs/images/oAuth_Cred_Create.PNG">
1. Go to Menu menu > **APIs & Services > [Credentials](https://console.cloud.google.com/apis/credentials)** in the Google Cloud console.
2. Click **Create Credentials** > **OAuth client ID**.
3. Click **Application type** > **Web application**.
4. In the **Name** field, type a name for the credential. This name is only shown in the Google Cloud console.
5. For **authorized redirect URI** enter the following:
    1. https://www.getpostman.com/oauth2/callback
6. Click **Create**. The OAuth client-created screen shows your new Client ID and Client secret.
7. Click **OK**. The newly created credential appears under OAuth 2.0 Client IDs.
8. On the OAuth client created window, click the **DOWNLOAD JSON** button.

### Setting up Postman
#### Install and Learn
1. Get the latest version of the Postman desktop app from the **[download page](https://www.postman.com/downloads/)** and select Download for your platform. For additional information, see [Installing and updating Postman](https://learning.postman.com/docs/getting-started/installation-and-updates/).
2. If you are unfamiliar with the Postman interface, take a few minutes to learn [Navigating Postman](https://learning.postman.com/docs/getting-started/navigating-postman/).
#### Environments
An **[environment](https://learning.postman.com/docs/sending-requests/managing-environments/#creating-environments)** is a set of **[variables](https://learning.postman.com/docs/sending-requests/variables/)** you can use in your Postman requests.
1. Create a new environment, select **Environments** on the left, and select **+**
2. Please enter a **name** for your Environment, and initialize it with the following **variables and values**. **Save** when your changes are complete.

| Variable     | Type     | Initial Value  | Current Value  |
| ------------- |:-------:|:--------------:|:--------------:|
| client_id     | default | Add value from the downloaded JSON file from OAuth client ID credentials  | Add value from the downloaded JSON file from OAuth client ID credentials  |
| client_secret | default | Add value from the downloaded JSON file from OAuth client ID credentials  | Add value from the downloaded JSON file from OAuth client ID credentials  |
| auth_uri      | default | https://accounts.google.com/o/oauth2/auth  | https://accounts.google.com/o/oauth2/auth  |
| token_uri     | default | https://oauth2.googleapis.com/token        | https://oauth2.googleapis.com/token        |
| redirect_uris | default | https://www.getpostman.com/oauth2/callback | https://www.getpostman.com/oauth2/callback |


#### Workspaces
[Workspaces](https://learning.postman.com/docs/collaborating-in-postman/using-workspaces/creating-workspaces/) enable you to organize your Postman work. To create a new workspace, select **Workspaces** in the header, then select **Create Workspace**. Select the **Environment** you created in the previous step from the environment selector at the top right of the workbench. 

##### Importing Collections
You can import [Collections](https://learning.postman.com/docs/getting-started/creating-the-first-collection/) from the [Chrome Enterprise GitHub](https://github.com/google/ChromeBrowserEnterprise/tree/main/postman) or the file import into your Workspace. 
1. You can follow **[these instructions](https://learning.postman.com/docs/getting-started/importing-and-exporting-data/#importing-from-github-repositories)** to import from https://github.com/google/ChromeBrowserEnterprise/tree/main/postman
2. Alternatively, you can import Collections from the file system.
    1. Browse to the [Chrome Enterprise GitHub](https://github.com/google/ChromeBrowserEnterprise/tree/main/postman) and select the collection that you want to import. 
    2. Click on the **Raw** button
    3. Right-click and save as **.json**.
    4. In Postman, with your **Workspace** chosen, click on **Import ** from the left navigation menu.
    5. Select the files you want to import.
    6. Select **Import** to bring your data into Postman.
3. You should see all of the [Collections](https://github.com/google/ChromeBrowserEnterprise/edit/main/postman/README.md#collections) in your Postman workspace once complete.

# Collections

## [App Details API](/postman/App%20Details%20API.postman_collection.json)
> Get a specific app by its resource name
> > Description: Get detailed information about a given Chrome extension. 
> > Reference: [customers.apps.chrome.get ](https://developers.google.com/chrome/management/reference/rest/v1/customers.apps.chrome/get)
>
> Get Extension Workflow Request Count
> > Description: Get summary of extension requests.
> > Reference: [customers.apps.countChromeAppRequests](https://developers.google.com/chrome/management/reference/rest/v1/customers.apps/countChromeAppRequests)

## [Chrome Browser Cloud Management API](/postman/Chrome%20Browser%20Cloud%20Management%20API.postman_collection.json)
> Find browser by machine name and org unit path
> > Description: Retrieve browser properties by machine name and OU name.
> > Reference: [Retrieve a Chrome browser Device](https://support.google.com/chrome/a/answer/9681204#retrieve_a_chrome_browser_device)
>
> Retrieve a Chrome browser Device
> > Description: Retrieve browser  properties by device id. 
> > Reference: [Retrieve a Chrome browser Device](https://support.google.com/chrome/a/answer/9681204#retrieve_a_chrome_browser_device)
>
> Find browser by machine name
> > Description: Retrieve browser  properties by machine name. 
> > Reference: [Retrieve a Chrome browser Device](https://support.google.com/chrome/a/answer/9681204#retrieve_a_chrome_browser_device)
>
> Find browsers by org unit path
> > Description: Retrieve all browsers in an OU. 
> > Reference: [Retrieve a Chrome browser Device](https://support.google.com/chrome/a/answer/9681204#retrieve_a_chrome_browser_device)
>
> Retrieve Chrome browsers where the Device ID is shared by multiple machines
> > Description: Retrieve all browsers that has device id collision. 
> > Reference: [Retrieve a Chrome browser Device](https://support.google.com/chrome/a/answer/9681204#retrieve_a_chrome_browser_device)
>
> Retrieve Chrome browser remote commands
> > Description: NA
> > Reference: NA
> 
> Update a Chrome browser Device
> > Description: update the annotated fields of a Chrome browser. 
> > Reference: [Update a Chrome browser Device](https://support.google.com/chrome/a/answer/9681204#update_a_chrome_browser_device)
> 
> Move a Chrome browser Device between Organization Units
> > Description: Move one or more enrolled browser between OUs. 
> > Reference: [### Move a Chrome browser Device between Organization Units](https://support.google.com/chrome/a/answer/9681204#move_a_chrome_browser_device_between_organization_units)
> 
> Delete a Chrome browser Device
> > Description: Delete an enrolled Chrome browser. 
> > Reference: [Delete a Chrome Browser Device](https://support.google.com/chrome/a/answer/9681204#delete_a_chrome_browser_device)

## [Chrome Management Reports API](/postman/Chrome%20Management%20Reports%20API.postman_collection.json)
> Generate report of all installed Chrome versions
> > Description: Generate report of all installed Chrome versions.
> > Reference: [countChromeVersions](https://developers.google.com/chrome/management/reference/rest/v1/customers.reports/countChromeVersions)
>
> Generate report of installed Chrome versions by organizational unit
> > Description: Generate report of installed Chrome versions by organizational unit.
> > Reference: [countChromeVersions](https://developers.google.com/chrome/management/reference/rest/v1/customers.reports/countChromeVersions)
>
> Generate report to find devices that have an app installed
> > Description: Generate report to find devices that have an app installed.
> > Reference: [countInstalledApps](https://developers.google.com/chrome/management/reference/rest/v1/customers.reports/countInstalledApps)
>
> Generate report of app installations by organizational unit
> > Description: Generate report of app installations by organizational unit.
> > Reference: [countInstalledApps](https://developers.google.com/chrome/management/reference/rest/v1/customers.reports/countInstalledApps)
>
> Generate report of devices that have a specified app installed
> > Description: Generate report of devices that have a specified app installed.
> > Reference: [findInstalledAppDevices](https://developers.google.com/chrome/management/reference/rest/v1/customers.reports/countInstalledApps)

## [Chrome Policy API](/postman/Chrome%20Policy%20API.postman_collection.json)
> Get a list of policy schemas
> > Description: Gets a list of policy schemas that match an optional filter value.
> > Reference: [List schemas](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policySchemas/list)
>
> Get a policy schema by filter
> > Description: Gets a list of policy schema.
> > Reference: [Get schema](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policySchemas/get)
> 
> Get or list policies for an Organizational Unit
> > Description: Gets the resolved policy values for a list of policies that match a search query.
> > Reference: [Get or list policies for an Organizational Unit](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policies/resolve)
> 
> Modify a policy in an Organizational Unit
> > Description: Modify a policy value that are applied to a specific org unit.
> > Reference: [Modify policies in an Organizational Unit](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policies.orgunits/batchModify)
> 
> Modify multiple policies at once in an Organizational Unit
> > Description: Modify multiple policy values that are applied to a specific org unit.
> > Reference: [Modify policies in an Organizational Unit](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policies.orgunits/batchModify)
> 
> Inherit policies in an Organizational Unit
> > Description: Modify multiple policy values that are applied to a specific org unit so that they now inherit the value from a parent (if applicable).
> > Reference: [Inherit policies in an Organizational Unit](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policies.orgunits/batchInherit)
> 
> Force install an app in a specific Organizational Unit
> > Description: Force install an app in a specific Organizational Unit.
> > Reference: [Modify policies in an Organizational Unit](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policies.orgunits/batchModify)
> 
> Allow install an app in a specific Organizational Unit
> > Description: Allow install an app in a specific Organizational Unit.
> > Reference: [Modify policies in an Organizational Unit](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policies.orgunits/batchModify)
> 
> Allow install an app in a specific Organizational Unit
> > Description: Deleting an app must be done at the Organizational Unit at which the app was installed. 
> > Reference: [Inherit policies in an Organizational Unit](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policies.orgunits/batchInherit)
> 
> Get App installation policy for an app in an Organizational Unit
> > Description: Get extension install policy by extension id and OU.
> > Reference: [Get or list policies for an Organizational Unit](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policies/resolve)
>
> Get App installation policy for all apps in an Organizational Unit
> > Description: Get extension install policy by OU.
> > Reference: [Get or list policies for an Organizational Unit](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policies/resolve)
>
> List all policies for an app in an Organizational Unit
> > Description: Get extension policy by extension id and OU.
> > Reference: [Get or list policies for an Organizational Unit](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policies/resolve)
>
> List all policies for all apps in an Organizational Unit
> > Description: Get all extension policies by OU.
> > Reference: [Get or list policies for an Organizational Unit](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policies/resolve)

## [Directory API](/postman/Directory%20API.postman_collection.json)
> Retrieves all organizational units
> > Description: Retrieves a list of all organizational units .
> > Reference: [orgunits.list](https://developers.google.com/admin-sdk/directory/reference/rest/v1/orgunits/list)
>
> Retrieve an organizational unit
> > Description: Retrieves an organizational unit.
> > Reference: [orgunits.get](https://developers.google.com/admin-sdk/directory/reference/rest/v1/orgunits/get)
>
> Retrieve all or children organizational units
> > Description: Retrieves child organizational unit(s).
> > Reference: [orgunits.list](https://developers.google.com/admin-sdk/directory/reference/rest/v1/orgunits/list)
>
> Delete an organizational unit
> > Description: Removes an organizational unit.
> > Reference: [orgunits.delete](https://developers.google.com/admin-sdk/directory/reference/rest/v1/orgunits/delete)
>
> Update an organizational unit
> > Description: Updates an organizational unit.
> > Reference: [orgunits.update](https://developers.google.com/admin-sdk/directory/reference/rest/v1/orgunits/update)
>
> Create an organizational unit
> > Description: Adds an organizational unit.
> > Reference: [orgunits.insert](https://developers.google.com/admin-sdk/directory/reference/rest/v1/orgunits/insert)

## [Enrollment Token API](/postman/Enrollment%20Token%20API.postman_collection.json)
> List all enrollment tokens for an account
> > Description: Retrieves all enrollment tokens.
> > Reference: [Use the Chrome Browser Enrollment Token API](https://support.google.com/chrome/a/answer/9949706?hl=en&ref_topic=9301744)
>
> Get enrollment token by specific organization unit
> > Description: Retrieve enrollment token by specific organization unit.
> > Reference: [Use the Chrome Browser Enrollment Token API](https://support.google.com/chrome/a/answer/9949706?hl=en&ref_topic=9301744)
>
> Create an enrollment token
> > Description: Create an enrollment token.
> > Reference: [Use the Chrome Browser Enrollment Token API](https://support.google.com/chrome/a/answer/9949706?hl=en&ref_topic=9301744)
>
> Revoke an enrollment token
> > Description: Revoke an enrollment token.
> > Reference: [Use the Chrome Browser Enrollment Token API](https://support.google.com/chrome/a/answer/9949706?hl=en&ref_topic=9301744)

## [Reports API](/postman/Reports%20API.postman_collection.json)
> Retrieve all administrative activities
> > Description: Retrieve a report of all Admin console changes for a specific event name done by a specific administrator.
> > Reference: [Retrieve all activities by event and administrator](https://developers.google.com/admin-sdk/reports/v1/guides/manage-audit-admin#get_admin_event)
> 
> Retrieve all activities by event name
> > Description: Retrieve a report of all activities for a specific event name.
> > Reference: [Retrieve all activities by event name](https://developers.google.com/admin-sdk/reports/v1/guides/manage-audit-admin#get_all_events)
>
> Retrieve all authorization token events for a domain
> > Description: Retrieve all authorization events for third party applications.
> > Reference: [Retrieve all authorization token events for a domain](https://developers.google.com/admin-sdk/reports/v1/guides/manage-audit-tokens#retrieve_all_authorization_token_events_for_a_domain)

## [Version History API](/postman/VersionHistory%20API.postman_collection.json)
> List all releases for Windows (64bit) in the stable channel
> > Description: List all releases for Windows (64bit) in the stable channel.
> > Reference: [VersionHistory API referencer](https://developer.chrome.com/docs/versionhistory/reference/)
>
> List all releases for Windows (64bit) in the extended stable channel
> > Description: List all releases for Windows (64bit) in the extended stable channel.
> > Reference: [VersionHistory API referencer](https://developer.chrome.com/docs/versionhistory/reference/)
> 
> List all releases for Mac in the stable channel
> > Description: List all releases for Mac in the stable channel.
> > Reference: [VersionHistory API referencer](https://developer.chrome.com/docs/versionhistory/reference/)


