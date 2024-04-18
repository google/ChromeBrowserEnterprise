# Chrome Management API
The [Chrome Management API](https://developers.google.com/chrome/management/reference/rest) enables you to generate reports that give you aggregate information on your managed Chrome Browser deployment.
- Postman collections:
  [Chrome Management - Apps API](https://www.postman.com/google-chrome-enterprise-apis/workspace/google-chrome-enterprise-public/collection/17723612-1f198842-802b-4900-af38-7ffc1f32bfdf)
  [Chrome Management - Reports API](https://www.postman.com/google-chrome-enterprise-apis/workspace/google-chrome-enterprise-public/collection/17723612-cae3a18e-7399-4e9f-83b2-084b8798ffed)
- Scope: https://www.googleapis.com/auth/chrome.management.reports.readonly

## Chrome Management Apps API

### Retrieve a specific app by its resource name
[customers.apps.chrome.get](https://developers.google.com/chrome/management/reference/rest/v1/customers.apps.chrome/get)

### Retrieve Extension Workflow Requests
[countChromeAppRequests](https://developers.google.com/chrome/management/reference/rest/v1/customers.apps/countChromeAppRequests)

## Retrieve a list of devices that have requested to install an extension
[fetchDevicesRequestingExtension](https://developers.google.com/chrome/management/reference/rest/v1/customers.apps/fetchDevicesRequestingExtension)

### Retrieve a list of users that have requested to install an extension
[fetchUsersRequestingExtension](https://developers.google.com/chrome/management/reference/rest/v1/customers.apps/fetchUsersRequestingExtension)

## Chrome Management Reports API

### Chrome Browsers Needing Attention
[countChromeBrowsersNeedingAttention](https://developers.google.com/chrome/management/reference/rest/v1/customers.reports/countChromeBrowsersNeedingAttention)

### Get a count of Chrome crash events
[countChromeCrashEvents](https://developers.google.com/chrome/management/reference/rest/v1/customers.reports/countChromeCrashEvents)

### Generate report of all installed Chrome versions
[countChromeVersions](https://developers.google.com/chrome/management/reference/rest/v1/customers.reports/countChromeVersions)

### Generate report of app installations
[countInstalledApps](https://developers.google.com/chrome/management/reference/rest/v1/customers.reports/countInstalledApps)

### Generate report to find devices that have an app installed
[findInstalledAppDevices ](https://developers.google.com/chrome/management/reference/rest/v1/customers.reports/findInstalledAppDevices)





