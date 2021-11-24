# Authorization
Google APIs use the [OAuth 2.0 protocol](https://tools.ietf.org/html/rfc6749) for authentication and authorization. Google supports common OAuth 2.0 scenarios such as those for web server, client-side, installed, and limited-input device applications. All applications follow a basic pattern when accessing a Google API using OAuth 2.0. Check out [Using OAuth 2.0 to Access Google APIs ](https://developers.google.com/identity/protocols/oauth2) for more information.

## Authorize With Consent
Also known as '3-legged' OAuth without impersonation, is useful in scenarios where you want Google to handle user authentication, session selection, and user consent. The result is an authorization code, which the application can exchange for an access token and a refresh token. Postman collections in this repo are based on this authorization method. Get started by creating [OAuth client ID](https://developers.google.com/identity/protocols/oauth2/web-server#creatingcred) and then configure the [user consent screen](https://support.google.com/cloud/answer/6158849?hl=en#zippy=%2Cuser-consent). Don't forget to include the scopes list below.  For detailed information check out  [Web server applications](https://developers.google.com/identity/protocols/oauth2/web-server).
### 

## Authorize With Impersonation (Service Account)
If you want request authorization without user consent, then use a service account for impersonation. Here the service account belongs to your application/service instead of to an individual end-user. Your application calls Google APIs on behalf of the service account, and user consent is not required. You can follow [this](https://developers.google.com/admin-sdk/directory/v1/guides/delegation#create_the_service_account_and_credentials) for creating a service account and getting the service account keys.
### Delegate domain-wide authority
The client ID for this service account will need to be authorized for the OAuth scopes listed below. To do this, check out the [Delegate domain-wide authority to your service account](https://developers.google.com/admin-sdk/directory/v1/guides/delegation#delegate_domain-wide_authority_to_your_service_account)


## Scopes
|Scope                          |Description                         |
|-------------------------------|-----------------------------|
| `https://www.googleapis.com/auth/admin.directory.device.chromebrowsers.readonly`|Chrome Browser Cloud Managment (CBCM) - get detailed information on enrolled browsers and enrollment tokens (read-only)|
| `https://www.googleapis.com/auth/admin.directory.device.chromebrowsers`|Chrome Browser Cloud Managment (CBCM) - lets you view and modify enrolled browsers and enrollment tokens|
| `https://www.googleapis.com/auth/chrome.management.reports.readonly`|Reports - Chrome versions and installed apps |
| `https://www.googleapis.com/auth/chrome.management.appdetails.readonly`|App Details- get detailed information about requested or specified apps |
| `https://www.googleapis.com/auth/chrome.management.policy.readonly`|Chrome Policy - lets you view Chrome policies for devices and users |
| `https://www.googleapis.com/auth/chrome.management.policy`|Chrome Policy - lets you view and modify Chrome policies for devices and users |
| `https://www.googleapis.com/auth/admin.directory.orgunit.readonly`|Org Units - lets you view organizational units |
| `https://www.googleapis.com/auth/admin.directory.orgunit`|Org Units - lets you view and modify organizational units |
| `https://www.googleapis.com/auth/admin.reports.audit.readonly`|Admin Console Reports - lets you view activities done by administrators using the Admin console and oAuth token acivities |

## Postman OAuth 2.0

For the sake of keeping things simple, the Postman collections use OAuth 2.0. You can configure that by following the [Authorization requests instructions](https://learning.postman.com/docs/sending-requests/authorization/#oauth-20).

## Next > [Postman Collection](postmanColl.md)
