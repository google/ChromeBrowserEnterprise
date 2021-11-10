# Getting Started
You can use the Postman collections to interact with Google APIs like Chrome Browser Cloud Management, Chrome Browser Enrollment Token API, Chrome Policy, and Extensions.

## Setup

### Create a Google project
Go to the [Google API Console](https://console.developers.google.com/project). Sign-in using the same Google Account that you use for the admin console. Click Create project, enter a name, and click Create.

### Enable Google APIs
Next, we need to enable the following Google APIs in your project.
* [Admin SDK API](https://console.developers.google.com/apis/api/admin.googleapis.com/overview?project=_)
* [Chrome Management API](https://console.developers.google.com/apis/api/chromemanagement.googleapis.com/overview?project=_)
* [Chrome Policy API](https://console.developers.google.com/apis/api/chromepolicy.googleapis.com/overview?project=_)

To enable an API for your project, do the following:

1. Open the [API Library](https://console.developers.google.com/apis/library) in the Google API Console. If prompted, select a project or create a new one. The API Library lists all available APIs, grouped by product family and popularity.
2. If the API you want to enable isn't visible in the list, use search to find it by name (described above).
3. Select the API you want to enable, then click the Enable button.
4. If prompted, accept the API's Terms of Service.

### Postman
You can use the latest Postman [on the web](https://identity.getpostman.com/signup?continue=https%3A%2F%2Fgo.postman.co%2Fbuild&_ga=2.39310499.1216381035.1635882050-1482705519.1632930853] or (desktop app)[https://www.postman.com/downloads/] to [import the collections](https://learning.postman.com/docs/getting-started/importing-and-exporting-data/).

## Authorization
Google APIs use the [OAuth 2.0 protocol](https://tools.ietf.org/html/rfc6749) for authentication and authorization. Google supports common OAuth 2.0 scenarios such as those for web server, client-side, installed, and limited-input device applications.
All applications follow a basic pattern when accessing a Google API using OAuth 2.0. At a high level, you follow five steps:
1. Obtain OAuth 2.0 credentials from the Google API Console
> Visit the [Google API Console](https://console.developers.google.com/) to obtain OAuth 2.0 credentials such as a client ID and client secret that are known to both Google and your application.
2. Obtain an access token from the Google Authorization Server.
> Before your application can access private data using a Google API, it must obtain an access token that grants access to that API. A single access token can grant varying degrees of access to multiple APIs. A variable parameter called scope controls the set of resources and operations that an access token permits. During the access-token request, your application sends one or more values in the scope parameter.
