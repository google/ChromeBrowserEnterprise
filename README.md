# cbe-rest-api

Use the [Chrome Browser Enterprise (CBE)](https://support.google.com/chrome/a/topic/9025410?hl=en&ref_topic=4386754) REST API to manage the Chrome browser in your orgnization. 

## General Concepts
###### Authorization
Before using all Chrome Browser Cloud Management (CBCM) APIs, you will need to enable a few APIs (if they are not already enabled) in the Google Developer Console by following each link and selecting the project on which you wish to enable the APIs:
- [Admin SDK API](https://console.developers.google.com/apis/api/admin.googleapis.com/overview?project=_)
- [Chrome Management API](https://console.developers.google.com/apis/api/chromemanagement.googleapis.com/overview?project=_)
- [Chrome Policy API](https://console.developers.google.com/apis/api/chromepolicy.googleapis.com/overview?project=_)

From there, you have 2 choices of obtaining a token to access the API:

- Oauth2.0 with impersonation using a service account (Read below the section "Authorize With Impersonation")
- 3-legged Oauth2.0 without impersonation (You can authorize your requests following the Oauth2 Guideline)
To us a service account for impersonation, check out the [Authorize With Impersonation](https://support.google.com/chrome/a/answer/9681204#authorization).

###### Scope
Requires one of the following scopes to authorize your access to each API. Note: the `readonly` scope doesn't allow any mutation operations. For more information, see the [Authentication Overview](https://cloud.google.com/docs/authentication/).
- [App Details API](https://developers.google.com/chrome/management/guides/app_details_api)
  - https://www.googleapis.com/auth/chrome.management.appdetails.readonly
- [Chrome Browser Cloud Management API](https://support.google.com/chrome/a/answer/9681204#calling_the_api) & [Enrollment Token API](https://support.google.com/chrome/a/answer/9949706?hl=en&ref_topic=9301744)
  - https://www.googleapis.com/auth/admin.directory.device.chromebrowsers
  - https://www.googleapis.com/auth/admin.directory.device.chromebrowsers.readonly
- [Chrome Management Reports API](https://developers.google.com/chrome/management/reference/rest/v1/customers.reports)
  - https://www.googleapis.com/auth/chrome.management.reports.readonly
- [Chrome Policy API](https://developers.google.com/chrome/policy/guides/policy-api)
  - https://www.googleapis.com/auth/chrome.management.policy
  - https://www.googleapis.com/auth/chrome.management.policy.readonly
- [Directory API](https://developers.google.com/admin-sdk/directory/reference/rest/v1/orgunits/)
  - https://www.googleapis.com/auth/admin.directory.orgunit
  - https://www.googleapis.com/auth/admin.directory.orgunit.readonly 

## Postman
[Postman](https://www.postman.com/downloads/) allows you to create Workspaces, create API calls, validate APIs, convert to a different programming language, and share code.
- You can download or use the web based version.
- Create a new Workspace. You can name it what ever you like.
- Import the collections 
  - [App Details API.postman_collection](App%20Details%20API.postman_collection.json)
    - Here you can find sample request(s) to get detailed information about a specified app/extension and extension workflow requests.
  - [Chrome Browser Cloud Management API.postman_collection](Chrome%20Browser%20Cloud%20Management%20API.postman_collection.json) 
    - Here you can find sample requests to retrieve Chrome browser device data, update device data, move a browser between orgnization units (OUs), manage enrollement tokens, and delete a browser. 
  - [Chrome Management Reports API.postman_collection](Chrome%20Management%20Reports%20API.postman_collection.json)
    - Here you can find sample requests to get a report of installed Chrome versions, a report of devices that have an app installed, and a report of app install count.
  - [Chrome Policy API.postman_collection](Chrome%20Policy%20API.postman_collection.json)
    -  This is one of the most important APIs to view browser policies, change browser policies, policy inheritance, and manage extensions. You can find sample requests for various use cases in this collection.
  - [Directory API.postman_collection](Directory%20API.postman_collection.json)
    - This collection allows you to manage the organizational units (OU). Remember that OU hierarchy is limited to 35 levels of depth.

## Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License
See [LICENSE](LICENSE) for details.
