# Getting started with CBCM API
CBCM offers a wide range of APIs that let you integrate your services with CBCM. 

### 5 steps to get started
1. [Create a Google Cloud project](#create-a-google-cloud-project) for your Google Workspace app, extension, or integration.

2. [Enable the APIs you want to use](#enable-google-cbcm-apis) in your Google Cloud project.

3. [Learn how authentication and authorization work](#learn-about-authentication--authorization) when developing for Google Workspace.

4. [Configure OAuth consent]() to ensure users can understand and approve what access your app has to their data.

5. Create a [service account]().

## Create a Google Cloud project
A Google Cloud project is required to use CBCM APIs. This project forms the basis for creating, enabling, and using all Google Cloud services, including managing APIs.

To create a Google Cloud project:

1. In the Google Cloud console, go to **Menu > IAM & Admin > Create a Project**.

> Go to [Create a Project](https://console.cloud.google.com/projectcreate)

2. In the **Project Name** field, enter a descriptive name for your project.
Optional: To edit the **Project ID**, click **Edit**. The project ID can't be changed after the project is created, so choose an ID that meets your needs for the lifetime of the project.

3. In the **Location** field, click **Browse** to display potential locations for your project. Then, click Select.

4. Click **Create**. The console navigates to the Dashboard page, and your project is created within a few minutes.
For further information on Google Cloud projects, refer to [Creating and managing projects](https://cloud.google.com/resource-manager/docs/creating-managing-projects).

## Enable Google CBCM APIs
Before using Google APIs, you need to turn them on in a Google Cloud project. You can turn on one or more APIs in a single Google Cloud project. APIs you need to enable:
* Admin SDK API
* Chrome Management API
* Chrome Policy API
* Audit API

To enable an API in your Cloud project:

1. In the Google Cloud console, go to **Menu > API/Service Details**.
> Go to [Product Library](https://console.cloud.google.com/apis/dashboard?project=)

2. Click the API that you want to turn on.
3. Click **Enable**.
4. To enable more APIs, repeat these steps.

## Learn about authentication & authorization
Authentication and authorization are used to verify identity and access to resources. This document identifies key terms you should know before implementing authentication and authorization in your app.

### OAuth consent process overview
Use this credential to authenticate as an end user and requires your app to request and receive consent from the user (usefule in Postman).
The following diagram shows the high-level steps of authentication and authorization for oAuth consent.
<img align="right" width="300" height="400" alt="OAuth consent process overview" src="https://github.com/google/ChromeBrowserEnterprise/blob/main/docs/images/OAuthConsentProcess.svg">
1. **Configure your Google Cloud project and app**: During development, you register your app in the Google Cloud console, defining authorization scopes and access credentials to authenticate your app.

2. **Authenticate your app for access**: The registered access credentials are evaluated when your app runs. A sign-in prompt might be displayed if your app authenticates as an end user.

3. **Request resources**: When your app needs access to Google resources, it asks Google to use the relevant scopes of access you previously registered.

4. **Ask for user consent**: If your app authenticates as an end user, Google displays the OAuth consent screen so the user can decide whether to grant your app access to the requested data.

5. **Send approved request for resources**: If the user consents to the scopes of access, your app bundles the credentials and the user-approved scopes of access into a request. The request is sent to the Google authorization server to obtain an access token.

6. **Google returns an access token**: The access token contains a list of granted scopes of access. If the returned list of scopes is more limited than the requested scopes of access, your app disables any features limited by the token.

7. **access requested resources**: Your app uses the access token from Google to invoke the relevant APIs and access the resources.

### Service Account process overview
Service accounts represent non-human users. They're intended for scenarios where a workload, such as a custom application, needs to access resources or perform actions without end-user involvement (beneficial for [CBCM-CSharp](https://github.com/google/ChromeBrowserEnterprise/tree/main/dotnet), [Python](https://github.com/google/ChromeBrowserEnterprise/tree/main/Python), and [PowerShell](https://github.com/google/ChromeBrowserEnterprise/tree/main/ps/src/cbcm) scripts). Authorization using a service account does **not** require consent from the user.

Since you are creating [user-managed service accounts](https://cloud.google.com/iam/docs/service-accounts#user-managed-keys) in your project, **You are responsible for managing and securing these accounts**. See [Best practices for working with service accounts](https://cloud.google.com/iam/docs/best-practices-service-accounts)

## Next Steps
- Configure the [OAuth consent screen for Postman](https://github.com/google/ChromeBrowserEnterprise/blob/main/postman/README.md)
- Configure the [Service account](https://github.com/google/ChromeBrowserEnterprise/blob/main/docs/service_acct.MD) for automated services that runs as a process - [CBCM-CSharp](https://github.com/google/ChromeBrowserEnterprise/tree/main/dotnet), [Python](https://github.com/google/ChromeBrowserEnterprise/tree/main/Python), and [PowerShell](https://github.com/google/ChromeBrowserEnterprise/tree/main/ps/src/cbcm) scripts.
