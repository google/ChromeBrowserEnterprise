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
3. You should see all of the Collections in your Postman workspace once complete.

### Collections
Each collection contains examples for GET, PUT, POST and DEL requests. Review the CBCM Postman [Collections](postmanColl.md) document for details.

### Run 
1. You will need to get the Bearer token before running a request in a collection. **Bearer tokens** enable requests to authenticate using an access key. The token is a text string, included in the request header. The requests inside the collection will **inherit** the collection level. 
    1. Select a Collection and click on the **Get New Access Token**.
    2. If a consent windows shows, choose the **account** you to authentication and **allow** the requested scope.
    3. Click on the **Use Token** button.
2. Select the request under the parent Collection, make any changes to the params or body as needed, and click on **Send**.
3. The response from the API call will be shown in the lower pane.



