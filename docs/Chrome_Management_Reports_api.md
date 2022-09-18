# Chrome Management Reports API
The [Reports API](https://developers.google.com/chrome/management/guides/reports_api) enables you to generate reports that give you aggregate information on your managed Chrome Browser deployment.
- Postman collection: [Chrome Management Reports API.postman_collection.json](https://github.com/google/ChromeBrowserEnterprise/blob/main/postman/Chrome%20Management%20Reports%20API.postman_collection.json)
- Scope: https://www.googleapis.com/auth/chrome.management.reports.readonly

## Generate report of all installed Chrome versions
[countChromeVersions](https://developers.google.com/chrome/management/reference/rest/v1/customers.reports/countChromeVersions)
#### Request
```
GET https://chromemanagement.googleapis.com/v1/customers/my_customer/reports:countChromeVersions?filter=last_active_date>=2022-01-01&pageSize=2&pageToken&orgUnitId
```
#### Response
```
{
    "browserVersions": [
        {
            "version": "100.0.4896.85",
            "count": "1",
            "channel": "STABLE",
            "system": "SYSTEM_IOS"
        },
        {
            "version": "96.0.4664.45",
            "count": "1",
            "channel": "STABLE",
            "system": "SYSTEM_WINDOWS"
        }
    ],
    "nextPageToken": "AGwWS9AdP6FQ5VSQdTJRYaUlByGhZNCNVmrzHcHQbduh4v8ORAHWEt6R50dsC94wOB5ohRl2q3cjwm9CAqH-Iq4U0nmZfSY=",
    "totalSize": 17
}
```

## Generate report to find devices that have an app installed
[findInstalledAppDevices ](https://developers.google.com/chrome/management/reference/rest/v1/customers.reports/findInstalledAppDevices)
#### Request
```
GET https://chromemanagement.googleapis.com/v1/customers/my_customer/reports:findInstalledAppDevices?orgUnitId=&appId=mefhakmgclhhfbdadeojlkbllmecialg&appType=EXTENSION&pageSize=100&pageToken
```
#### Response
```
{
    "devices": [
        {
            "deviceId": "130bb64a-0cdb-47a5-b4e0-508564384af1",
            "machine": "HELSTEST-CBCM-1"
        },
        {
            "deviceId": "d64a7424-e047-4c99-900d-7e705f20fe80",
            "machine": "HELSTEST-CBCM-4"
        }
    ],
    "totalSize": 2
}
```

## Generate report of app installations
[countInstalledApps](https://developers.google.com/chrome/management/reference/rest/v1/customers.reports/countInstalledApps)
#### Request
```
GET https://chromemanagement.googleapis.com/v1/customers/my_customer/reports:countInstalledApps?orgUnitId=&orderBy=total_install_count&pageSize=100&pageToken=
```
#### Response
```
{
    "installedApps": [
        {
            "appId": "pfjbakaelkkenbenekldmehijlbpjjea",
            "appType": "EXTENSION",
            "browserDeviceCount": "1",
            "appInstallType": "NORMAL",
            "appSource": "CHROME_WEBSTORE",
            "displayName": "Colorful Tic-Tac-Toe",
            "description": "Colorful Tic-Tac-Toe in Chrome from tCubed!",
            "homepageUri": "https://chrome.google.com/webstore/detail/pfjbakaelkkenbenekldmehijlbpjjea"
        },
        {
            "appId": "chhjbpecpncaggjpdakmflnfcopglcmi",
            "appType": "EXTENSION",
            "browserDeviceCount": "1",
            "appInstallType": "ADMIN",
            "appSource": "CHROME_WEBSTORE",
            "displayName": "Rakuten: Get Cash Back For Shopping",
            "description": "The best coupons and the most Cash Back. We do all the work. You just shop and save.",
            "homepageUri": "https://www.rakuten.com/",
            "permissions": [
                "cookies",
                "storage",
                "tabs",
                "webNavigation",
                "webRequest",
                "<all_urls>",
                "chrome://favicon/*"
            ]
        }
    ],
    "nextPageToken": "AGwWS9ChH7hEHH38CHSiMfPOIl_YS6mlPgs3mf2MlL9zoZudv5LxAnFM8RPBg9FpwFAAwZTm7p6RvdP6ZXw=",
    "totalSize": 76
}
```
