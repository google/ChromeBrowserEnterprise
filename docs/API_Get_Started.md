# Develop on CBCM
CBCM offeres a wide range of APIs that let you integrate your services with CBCM. 

### 5 steps to get started
1. Create a Google Cloud project for your Google Workspace app, extension, or integration.

2. Enable the APIs you want to use in your Google Cloud project.

3. Learn how authentication and authorization works when developing for Google Workspace.

4. Configure OAuth consent to ensure users can understand and approve what access your app has to their data.

5. Create access credentials to authenticate your app's end users or service accounts.

## Create a Google Cloud project
A Google Cloud project is required to use CBCM APIs. This project forms the basis for creating, enabling, and using all Google Cloud services, including managing APIs.

To create a Google Cloud project:

1. In the Google Cloud console, go to **Menu > IAM & Admin > Create a Project**.

> Go to [Create a Project](https://console.cloud.google.com/projectcreate)

2. In the **Project Name** field, enter a descriptive name for your project.
Optional: To edit the **Project ID**, click **Edit**. The project ID can't be changed after the project is created, so choose an ID that meets your needs for the lifetime of the project.

3. In the **Location** field, click **Browse** to display potential locations for your project. Then, click Select.

4. Click **Create**. The console navigates to the Dashboard page and your project is created within a few minutes.
For further information on Google Cloud projects, refer to [Creating and managing projects](https://cloud.google.com/resource-manager/docs/creating-managing-projects).

## Enable Google CBCM APIs
Before using Google APIs, you need to turn them on in a Google Cloud project. You can turn on one or more APIs in a single Google Cloud project. APIs you need to enable are
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
Authentication and authorization are mechanisms used to verify identity and access to resources, respectively. This document identifies key terms that you should know before implementing authentication and authorization in your app.

### OAuth consent process overview
The following diagram shows the high-level steps of authentication and authorization for oAuth concent (used in Postman collections).


