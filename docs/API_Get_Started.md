# Getting started with CBCM API
CBCM offers a wide range of APIs that let you integrate your services with CBCM. 

## Learn about how authentication & authorization works in the CBCM API
Authentication and authorization are used to verify identity and access to resources. This document identifies key terms you should know before implementing authentication and authorization in your app.

### OAuth consent process overview
Use this credential to authenticate as an end user and requires your app to request and receive consent from the user (helpful in [Postman](https://github.com/google/ChromeBrowserEnterprise/tree/main/postman)).
The following diagram shows the high-level steps of authentication and authorization for OAuth consent.
<img align="right" width="300" height="400" alt="OAuth consent process overview" src="https://github.com/google/ChromeBrowserEnterprise/blob/main/docs/images/OAuthConsentProcess.svg">
1. **Configure your Google Cloud project and app**: During development, you register your app in the Google Cloud console, defining authorization scopes and access credentials to authenticate your app.

2. **Authenticate your app for access**: The registered access credentials are evaluated when your app runs. A sign-in prompt might be displayed if your app authenticates as an end user.

3. **Request resources**: When your app needs access to Google resources, it asks Google to use the relevant scopes of access you previously registered.

4. **Ask for user consent**: If your app authenticates as an end user, Google displays the OAuth consent screen so the user can decide whether to grant your app access to the requested data.

5. **Send approved request for resources**: If the user consents to the scopes of access, your app bundles the credentials and the user-approved scopes of access into a request. The request is sent to the Google authorization server to obtain an access token.

6. **Google returns an access token**: The access token contains a list of granted scopes of access. If the returned list of scopes is more limited than the requested scopes of access, your app disables any features limited by the token.

7. **Access requested resources**: Your app uses the access token from Google to invoke the relevant APIs and access the resources.

### Service Account process overview
Service accounts represent non-human users. They're intended for scenarios where a workload, such as a custom application, needs to access resources or perform actions without end-user involvement (beneficial for [CBCM-CSharp](https://github.com/google/ChromeBrowserEnterprise/tree/main/dotnet), [Python](https://github.com/google/ChromeBrowserEnterprise/tree/main/Python), and [PowerShell](https://github.com/google/ChromeBrowserEnterprise/tree/main/ps/src/cbcm) scripts). Authorization using a service account does **not** require consent from the user.

Since you are creating [user-managed service accounts](https://cloud.google.com/iam/docs/service-accounts#user-managed-keys) in your project, **You are responsible for managing and securing these accounts**. See [Best practices for working with service accounts](https://cloud.google.com/iam/docs/best-practices-service-accounts).

## Follow these steps to set up the CBCM API
1. [Create a Google Cloud project](https://github.com/google/ChromeBrowserEnterprise/blob/main/docs/create_proj.MD) for your Google Workspace app, extension, or integration.

2. [Enable the APIs you want to use](https://github.com/google/ChromeBrowserEnterprise/blob/main/docs/proj_apis.MD) in your Google Cloud project.

3. Create a [service account](https://github.com/google/ChromeBrowserEnterprise/blob/main/docs/service_acct.MD).

4. Configure [OAuth consent](https://github.com/google/ChromeBrowserEnterprise/blob/main/postman/README.md) to ensure users can understand and approve what access your app has to their data.
