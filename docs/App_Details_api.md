# App Details API
The [App Details API](https://developers.google.com/chrome/management/guides/app_details_api) enables you to get detailed information about requested or specified apps. The Reports API is part of the [Chrome Management API](https://developers.google.com/chrome/management/?hl=en_US).
- Postman collection: [App Details API.postman_collection.json](https://github.com/google/ChromeBrowserEnterprise/blob/main/postman/App%20Details%20API.postman_collection.json)
- Scope: https://www.googleapis.com/auth/chrome.management.appdetails.readonly

## Retrieve a specific app by its resource name
Get a specific app for a customer by its resource name. If successful, the response body contains an instance of [AppDetails](https://developers.google.com/chrome/management/reference/rest/v1/customers.apps.android#AppDetails).
#### Request
```
GET https://chromemanagement.googleapis.com/v1/customers/my_customer/apps/chrome/blipmdconlkpinefehnmjammfjpmpbjk
```
#### Response
```
{
    "name": "customers/C033fmrgf/apps/chrome/blipmdconlkpinefehnmjammfjpmpbjk",
    "displayName": "Lighthouse",
    "appId": "blipmdconlkpinefehnmjammfjpmpbjk",
    "revisionId": "100.0.0.0",
    "type": "CHROME",
    "iconUri": "https://lh3.googleusercontent.com/JsGtt7BHEbHhQl5OzJikROL49WGoN0fBNcU_mvLRjWqx7nm7r7rzdG0DpET4qcK1FhNkFpcKf600G-Eoxx-_q3D4iA",
    "detailUri": "https://chrome.google.com/webstore/detail/blipmdconlkpinefehnmjammfjpmpbjk",
    "firstPublishTime": "2016-03-20T00:58:48.378Z",
    "latestPublishTime": "2019-11-21T03:56:08.202Z",
    "publisher": "developers.google.com/web",
    "homepageUri": "https://developers.google.com/web/tools/lighthouse/",
    "reviewNumber": "286",
    "reviewRating": 4.4,
    "chromeAppInfo": {
        "supportEnabled": false,
        "minUserCount": 800000,
        "permissions": [
            {
                "type": "activetab",
                "documentationUri": "https://developer.chrome.com/docs/extensions/mv3/manifest/activeTab/",
                "accessUserData": true
            },
            {
                "type": "storage",
                "documentationUri": "https://developer.chrome.com/docs/extensions/reference/storage/",
                "accessUserData": false
            }
        ],
        "isTheme": false,
        "googleOwned": false,
        "isCwsHosted": true,
        "kioskEnabled": false,
        "isKioskOnly": false,
        "type": "EXTENSION",
        "isExtensionPolicySupported": false
    }
}
```

## Retrieve Extension Workflow Request Count
Generate summary of [app installation requests](https://developers.google.com/chrome/management/reference/rest/v1/customers.apps/countChromeAppRequests).
#### Request
```
GET https://chromemanagement.googleapis.com/v1/customers/my_customer/apps:countChromeAppRequests?orgUnitId=&pageSize=1&orderBy=latestRequestTime desc
```
#### Response
```
{
    "requestedApps": [
        {
            "appId": "hkgfoiooedgoejojocmhlaklaeopbecg",
            "displayName": "Picture-in-Picture Extension (by Google)",
            "appDetails": "customers/C033fmrgf/apps/chrome/hkgfoiooedgoejojocmhlaklaeopbecg",
            "iconUri": "https://lh3.googleusercontent.com/cvfpnTKw3B67DtM1ZpJG2PNAIjP6hVMOyYy403X4FMkOuStgG1y4cjCn21vmTnnsip1dTZSVsWBA9IxutGuA3dVDWhg",
            "detailUri": "https://chrome.google.com/webstore/detail/hkgfoiooedgoejojocmhlaklaeopbecg",
            "requestCount": "1",
            "latestRequestTime": "2022-07-29T13:15:23.423Z"
        }
    ],
    "nextPageToken": "AGwWS9CHvU_3ge1dP_ewstOVAA8ZDbLoFeCCGcpv3CJ1Dbh-06wgGPvWYaW5cD84fs5bcvo48e0sEXdpVI8=",
    "totalSize": 19
}
```
