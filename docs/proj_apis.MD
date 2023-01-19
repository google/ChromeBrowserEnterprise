# Enable Google CBCM APIs
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

## Next step
Configure the [Service account](https://github.com/google/ChromeBrowserEnterprise/blob/main/docs/service_acct.MD) for automated services that runs as a process - [CBCM-CSharp](https://github.com/google/ChromeBrowserEnterprise/tree/main/dotnet), [Python](https://github.com/google/ChromeBrowserEnterprise/tree/main/Python), and [PowerShell](https://github.com/google/ChromeBrowserEnterprise/tree/main/ps/src/cbcm) scripts.
