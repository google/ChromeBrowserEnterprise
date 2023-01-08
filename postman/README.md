# Configure the OAuth consent screen
When you use OAuth 2.0 for authorization, Google displays a consent screen to the user including a summary of your project, its policies, and the requested authorization scopes of access. Configuring your app's OAuth consent screen defines what is displayed to users and app reviewers, and registers your app so you can publish it later.

There are two types:
- **Internal** is just for users within your Google Workspace users. Requires Google Workspace or Google Identity to function. Select this option for your Postman app.
- **External** is available to any test user with a Google Account. Your app will start in testing mode and will only be available to users you add to the list of test users. Once your app is ready to push to production, you may need to verify your app.


## Configure OAuth consent for Postman
In the Google Cloud console, go to Menu menu > **APIs & Services > [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent)**.

<img align="right" width="300" height="400" alt="OAuth consent screen scope" src="../../main/docs/images/consent_screen_scope.png"><img align="right" width="300" height="400" alt="OAuth consent screen" src="../../main/docs/images/consent_screen_1.png">


1. Enter in the **App name**, the **user support email** (this is your admin account email in the admin console) and you can also choose to display a custom logo.
2. Under Authorized domains enter in **getpostman.com**
3. Enter in an **email address** that you want Google to notify you about changes in your project.
4. **Save and continue**. 
5. Click the Add or Remove Scopes button to add the specific scopes manually. Scopes are listed **[here](../../blob/main/docs/auth.md)**. **Note** that the list contains both read only and full access. Pick and choose which scopes you need for your specific use case.
6. **Save and continue**.
7. **Optional**: Add a user(s) that can access while the publishing status is listed as “Testing”. Enter in the account that you used to create the project and any others that you want to provide access to by hitting the add users button. 
8. Click **Save and continue**, review the summary screen and hit the back to dashboard button. 









