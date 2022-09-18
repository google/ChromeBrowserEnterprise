# Reports API
The [Reports API](https://developers.google.com/admin-sdk/reports/v1/get-start/overview) is a RESTful API you can use to access information about the Chrome browser and CBCM activities. The Reports API is part of the Admin SDK API.
- Postman collection: [Reports API.postman_collection.json](https://github.com/google/ChromeBrowserEnterprise/blob/main/postman/Reports%20API.postman_collection.json)
- Scope: https://www.googleapis.com/auth/admin.reports.audit.readonly

## Retrieve all administrative activities
To retrieve a report of all administrative activities done for an account, use the following GET HTTP request and include the authorization token.
#### Request
```
GET https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/admin?endTime=2022-12-07T00:00:00.000Z&startTime=2022-06-07T00:00:00.000Z&maxResults=1
```
#### Response
```
{
    "kind": "admin#reports#activities",
    "etag": "\"7dD2lEGw_cSWElgnmooDH6C54E0q2uifMqS1m-4dUqU/Po7XaYXJI_DvPGK5hJKu8H9pS4U\"",
    "nextPageToken": "A:1663351168102997:7097050198975420298:207535951991:C033fmrgf",
    "items": [
        {
            "kind": "admin#reports#activity",
            "id": {
                "time": "2022-09-16T17:59:28.102Z",
                "uniqueQualifier": "7097050198975420298",
                "applicationName": "admin",
                "customerId": "xxxx"
            },
            "etag": "\"7dD2lEGw_cSWElgnmooDH6C54E0q2uifMqS1m-4dUqU/aWuDJDUr-XB3-zEjVz1XTCnbRL0\"",
            "actor": {
                "callerType": "USER",
                "email": "xxxxx@example.com",
                "profileId": "123456789"
            },
            "ipAddress": "1.2.3.4",
            "events": [
                {
                    "type": "ALERT_CENTER",
                    "name": "ALERT_CENTER_VIEW",
                    "parameters": [
                        {
                            "name": "ALERT_ID",
                            "value": "38b74e21-9477-4773-a3f2-3bf1534e7b0d,6888bfd6-70c3-49ae-b478-890c6a979b2c,be18b0d5-5947-4c50-84c1-3f084eb02f1b,de759c53-9011-4563-a9e9-3b5347e49286"
                        }
                    ]
                }
            ]
        }
    ]
}
```

## Retrieve all activities by event name
To retrieve a report of all Admin console changes for a specific event name done by a specific administrator, use the following GET HTTP request and include the authorization token.  For the eventName information, see the [administrator event names reference](https://developers.google.com/admin-sdk/reports/v1/reference/activity-ref-appendix-a/admin-event-names) information.
#### Request
```
GET https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/admin?endTime=2022-11-07T00:00:00.000Z&startTime=2022-01-07T00:00:00.000Z&maxResults=1&eventName=CHANGE_CHROME_OS_USER_SETTING
```
#### Response
```
{
    "kind": "admin#reports#activities",
    "etag": "\"7dD2lEGw_cSWElgnmooDH6C54E0q2uifMqS1m-4dUqU/LlQSXUVv04wHu885w_uZtvKinWo\"",
    "nextPageToken": "A:1663190980190000:1644351083196407755:207535951991:C033fmrgf",
    "items": [
        {
            "kind": "admin#reports#activity",
            "id": {
                "time": "2022-09-14T21:29:40.190Z",
                "uniqueQualifier": "1644351083196407755",
                "applicationName": "admin",
                "customerId": "123456789"
            },
            "etag": "\"7dD2lEGw_cSWElgnmooDH6C54E0q2uifMqS1m-4dUqU/qGGCLZkMXjMgbcnjLgAD7MUpiIc\"",
            "actor": {
                "callerType": "USER",
                "email": "test@example.com",
                "profileId": "123456789"
            },
            "ipAddress": "1.2.3.4",
            "events": [
                {
                    "type": "CHROME_OS_SETTINGS",
                    "name": "CHANGE_CHROME_OS_USER_SETTING",
                    "parameters": [
                        {
                            "name": "SETTING_NAME",
                            "value": "cookies_allowed_for_urls"
                        },
                        {
                            "name": "ORG_UNIT_NAME",
                            "value": "Austin"
                        },
                        {
                            "name": "OLD_VALUE",
                            "value": "MANDATORY|[http://dev.example.com]"
                        },
                        {
                            "name": "NEW_VALUE",
                            "value": "INHERITED"
                        }
                    ]
                }
            ]
        }
    ]
}
```

## Reporting Connector Events
### Retrieve malware transfer activities
A [type for malware transfer events](https://developers.google.com/admin-sdk/reports/v1/appendix/activity/chrome#MALWARE_TRANSFER_TYPE). Events of this type are returned with type=MALWARE_TRANSFER_TYPE
#### Request
```
GET https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/chrome?endTime=2022-11-07T00:00:00.000Z&startTime=2022-01-07T00:00:00.000Z&maxResults=1&eventName=MALWARE_TRANSFER
```
#### Response
```
{
    "kind": "admin#reports#activities",
    "etag": "\"7dD2lEGw_cSWElgnmooDH6C54E0q2uifMqS1m-4dUqU/0E7khqepxIQtQqqh6W2_nFS7QPU\"",
    "nextPageToken": "A:1662580216296879:-5705444195636762939:667484350296:C033fmrgf",
    "items": [
        {
            "kind": "admin#reports#activity",
            "id": {
                "time": "2022-09-07T19:50:16.296Z",
                "uniqueQualifier": "-5705444195636762939",
                "applicationName": "chrome",
                "customerId": "123456789"
            },
            "etag": "\"7dD2lEGw_cSWElgnmooDH6C54E0q2uifMqS1m-4dUqU/_LxO4GtCuQYOp0bMs1nTObOXWjg\"",
            "actor": {
                "callerType": "EXTERNAL_USER",
                "email": "test@example.com"
            },
            "events": [
                {
                    "type": "MALWARE_TRANSFER_TYPE",
                    "name": "MALWARE_TRANSFER",
                    "parameters": [
                        {
                            "name": "TIMESTAMP",
                            "intValue": "1662580216296"
                        },
                        {
                            "name": "EVENT_REASON",
                            "value": "MALWARE_TRANSFER_DANGEROUS_FILE_TYPE"
                        },
                        {
                            "name": "BROWSER_VERSION",
                            "value": "105.0.5195.102"
                        },
                        {
                            "name": "CLIENT_TYPE",
                            "value": "CHROME_BROWSER"
                        },
                        {
                            "name": "CONTENT_HASH",
                            "value": "D9B8C97683955E58BD8FFC2D06DA51E07B1B24A902B6AF342C3EF3DF4543AD23"
                        },
                        {
                            "name": "CONTENT_NAME",
                            "value": "badrep.exe"
                        },
                        {
                            "name": "CONTENT_TYPE",
                            "value": "application/x-msdownload"
                        },
                        {
                            "name": "DEVICE_ID",
                            "value": "4fc4eeaa-e3bf-4d34-a831-1affb7c89d08"
                        },
                        {
                            "name": "DEVICE_NAME",
                            "value": "example-Intune"
                        },
                        {
                            "name": "DEVICE_PLATFORM",
                            "value": "Windows 11"
                        },
                        {
                            "name": "DEVICE_USER",
                            "value": "AzureAD\\example"
                        },
                        {
                            "name": "DIRECTORY_DEVICE_ID",
                            "value": "cc865512-8373-44f8-a61d-f0e0aa624e80"
                        },
                        {
                            "name": "EVENT_RESULT",
                            "value": "BLOCKED"
                        },
                        {
                            "name": "EVIDENCE_LOCKER_FILEPATH",
                            "value": ""
                        },
                        {
                            "name": "MALWARE_CATEGORY",
                            "value": ""
                        },
                        {
                            "name": "MALWARE_FAMILY",
                            "value": ""
                        },
                        {
                            "name": "PROFILE_USER_NAME",
                            "value": ""
                        },
                        {
                            "name": "TRIGGER_TYPE",
                            "value": "FILE_DOWNLOAD"
                        },
                        {
                            "name": "URL",
                            "value": "https://testsafebrowsing.appspot.com/s/badrep.exe"
                        },
                        {
                            "name": "USER_AGENT",
                            "value": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/105.0.0.0 Safari/537.36"
                        },
                        {
                            "name": "VIRTUAL_DEVICE_ID",
                            "value": "4fc4eeaa-e3bf-4d34-a831-1affb7c89d08"
                        },
                        {
                            "name": "CONTENT_SIZE",
                            "intValue": "267"
                        }
                    ]
                }
            ]
        }
    ]
}
```

### Retrieve unsafe site visit events
A [type for unsafe site visit events](https://developers.google.com/admin-sdk/reports/v1/appendix/activity/chrome#UNSAFE_SITE_VISIT_TYPE). Events of this type are returned with type=UNSAFE_SITE_VISIT_TYPE
#### Request
```
GET https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/chrome?endTime=2022-11-07T00:00:00.000Z&startTime=2022-01-07T00:00:00.000Z&maxResults=1&eventName=UNSAFE_SITE_VISIT
```
#### Response
```
{
    "kind": "admin#reports#activities",
    "etag": "\"7dD2lEGw_cSWElgnmooDH6C54E0q2uifMqS1m-4dUqU/KTrKF6My1H_kmjdwSgyx3VnFIqY\"",
    "nextPageToken": "A:1662579892612079:3840495812098847295:667484350296:C033fmrgf",
    "items": [
        {
            "kind": "admin#reports#activity",
            "id": {
                "time": "2022-09-07T19:44:52.612Z",
                "uniqueQualifier": "3840495812098847295",
                "applicationName": "chrome",
                "customerId": "12345678"
            },
            "etag": "\"7dD2lEGw_cSWElgnmooDH6C54E0q2uifMqS1m-4dUqU/j77GdnmMB7vAUgULT0vDM9tmBsw\"",
            "actor": {
                "callerType": "EXTERNAL_USER",
                "email": "test@example.com"
            },
            "events": [
                {
                    "type": "UNSAFE_SITE_VISIT_TYPE",
                    "name": "UNSAFE_SITE_VISIT",
                    "parameters": [
                        {
                            "name": "TIMESTAMP",
                            "intValue": "1662579892612"
                        },
                        {
                            "name": "EVENT_REASON",
                            "value": "UNSAFE_SITE_VISIT_SOCIAL_ENGINEERING"
                        },
                        {
                            "name": "BROWSER_VERSION",
                            "value": "105.0.5195.102"
                        },
                        {
                            "name": "CLIENT_TYPE",
                            "value": "CHROME_BROWSER"
                        },
                        {
                            "name": "DEVICE_ID",
                            "value": "4fc4eeaa-e3bf-4d34-a831-1affb7c89d08"
                        },
                        {
                            "name": "DEVICE_NAME",
                            "value": "example-Intune"
                        },
                        {
                            "name": "DEVICE_PLATFORM",
                            "value": "Windows 11"
                        },
                        {
                            "name": "DEVICE_USER",
                            "value": "AzureAD\\example"
                        },
                        {
                            "name": "DIRECTORY_DEVICE_ID",
                            "value": "cc865512-8373-44f8-a61d-f0e0aa624e80"
                        },
                        {
                            "name": "EVENT_RESULT",
                            "value": "WARNED"
                        },
                        {
                            "name": "PROFILE_USER_NAME",
                            "value": ""
                        },
                        {
                            "name": "URL",
                            "value": "https://testsafebrowsing.appspot.com/s/phishing.html"
                        },
                        {
                            "name": "USER_AGENT",
                            "value": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/105.0.0.0 Safari/537.36"
                        },
                        {
                            "name": "VIRTUAL_DEVICE_ID",
                            "value": "4fc4eeaa-e3bf-4d34-a831-1affb7c89d08"
                        }
                    ]
                }
            ]
        }
    ]
}
```

### Retrieve password changed activities
A [type for any Chrome Safe Browsing password events](https://developers.google.com/admin-sdk/reports/v1/appendix/activity/chrome#SAFE_BROWSING_PASSWORD_ALERT). Events of this type are returned with type=SAFE_BROWSING_PASSWORD_ALERT.
#### Request
```
GET https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/chrome?endTime=2022-11-07T00:00:00.000Z&startTime=2022-01-07T00:00:00.000Z&maxResults=1&eventName=PASSWORD_BREACH
```
#### Response
```
coming soon..
```

### Retrieve password breach events
A [type for password breach events](https://developers.google.com/admin-sdk/reports/v1/appendix/activity/chrome#PASSWORD_BREACH_TYPE), indicating that one of the user's password was identified as being leaked. Events of this type are returned with type=PASSWORD_BREACH_TYPE.
#### Request
```
GET https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/chrome?endTime=2022-11-07T00:00:00.000Z&startTime=2022-01-07T00:00:00.000Z&maxResults=1&eventName=PASSWORD_BREACH
```
#### Response
```
coming soon..
```

### Retrieve content transfer activities
A [type for content transfer events](https://developers.google.com/admin-sdk/reports/v1/appendix/activity/chrome#CONTENT_TRANSFER_TYPE). Events of this type are returned with type=CONTENT_TRANSFER_TYPE.
#### Request
```
GET https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/chrome?endTime=2022-11-07T00:00:00.000Z&startTime=2022-01-07T00:00:00.000Z&maxResults=1&eventName=CONTENT_TRANSFER
```
#### Response
```
{
    "kind": "admin#reports#activities",
    "etag": "\"7dD2lEGw_cSWElgnmooDH6C54E0q2uifMqS1m-4dUqU/mtjNVtQli5Nxd2fXOQeqZ4Bcb2g\"",
    "nextPageToken": "A:1657891880136000:-3321753295470096160:667484350296:C033fmrgf",
    "items": [
        {
            "kind": "admin#reports#activity",
            "id": {
                "time": "2022-07-15T13:31:20.136Z",
                "uniqueQualifier": "-3321753295470096160",
                "applicationName": "chrome",
                "customerId": "123456789"
            },
            "etag": "\"7dD2lEGw_cSWElgnmooDH6C54E0q2uifMqS1m-4dUqU/A0Np-Jc_nVxBSKBD-6EsqfldrjI\"",
            "actor": {
                "callerType": "USER",
                "email": "test@example.com",
                "profileId": "116860270302525210569"
            },
            "events": [
                {
                    "type": "CONTENT_TRANSFER_TYPE",
                    "name": "CONTENT_TRANSFER",
                    "parameters": [
                        {
                            "name": "BROWSER_VERSION",
                            "value": "96.0.4664.45"
                        },
                        {
                            "name": "CLIENT_TYPE",
                            "value": "CHROME_PROFILE"
                        },
                        {
                            "name": "DEVICE_NAME",
                            "value": ""
                        },
                        {
                            "name": "DEVICE_PLATFORM",
                            "value": ""
                        },
                        {
                            "name": "DEVICE_USER",
                            "value": ""
                        },
                        {
                            "name": "TIMESTAMP",
                            "intValue": "1657891880136"
                        },
                        {
                            "name": "USER_AGENT",
                            "value": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.45 Safari/537.36,gzip(gfe)"
                        },
                        {
                            "name": "VIRTUAL_DEVICE_ID",
                            "value": ""
                        },
                        {
                            "name": "DEVICE_ID",
                            "value": ""
                        },
                        {
                            "name": "EVENT_RESULT",
                            "value": "DETECTED"
                        },
                        {
                            "name": "PROFILE_USER_NAME",
                            "value": "test@example.com"
                        },
                        {
                            "name": "URL",
                            "value": "https://optimizationguide-pa.googleapis.com/downloads?name=1656939770331&target=OPTIMIZATION_TARGET_LANGUAGE_DETECTION"
                        },
                        {
                            "name": "CONTENT_NAME",
                            "value": "C:\\Users\\example\\AppData\\Local\\Google\\Chrome\\User Data\\Profile 5\\Download Service\\Files\\66d1bbc0-9f76-4d8a-af7c-7cb30a6fc2a5"
                        },
                        {
                            "name": "CONTENT_SIZE",
                            "intValue": "265060"
                        },
                        {
                            "name": "CONTENT_TYPE",
                            "value": "text/html"
                        },
                        {
                            "name": "CONTENT_HASH",
                            "value": "86ffaf608b95357bf80de97f68e698ec3010490e4f525fea1ffac349a027e44c"
                        },
                        {
                            "name": "TRIGGER_TYPE",
                            "value": "FILE_DOWNLOAD"
                        },
                        {
                            "name": "SCAN_ID",
                            "value": "CC45F3C4EFD7FE6DA1953EC9EC46ADA2EAF400D43AA3FE1256C750DBE96FBDC627CE359B46453908A2E76A39EFD2ABB2BC917EDAC527E9A5C333D301C7555B0F1F881566A68B1EB11CCC2F9FFEB6F80CAF5B06FC4640701FC3D8268FB840D96A9F210B3AA3D23E38BCF13BE59A0E9A283CA55960B253E7BAA720C10BE8E66DF6"
                        }
                    ]
                }
            ]
        }
    ]
}
```

### Retrieve content unscanned activities
A [type for conent unscanned events](https://developers.google.com/admin-sdk/reports/v1/appendix/activity/chrome#CONTENT_UNSCANNED_TYPE). Events of this type are returned with type=CONTENT_UNSCANNED_TYPE.
#### Request
```
GET https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/chrome?endTime=2022-11-07T00:00:00.000Z&startTime=2022-01-07T00:00:00.000Z&maxResults=1&eventName=CONTENT_UNSCANNED
```
#### Response
```
{
    "kind": "admin#reports#activities",
    "etag": "\"7dD2lEGw_cSWElgnmooDH6C54E0q2uifMqS1m-4dUqU/HDpNg_bGQ-wPmoMQGOPEUDFAK-Y\"",
    "nextPageToken": "A:1652799300805000:8409638696137142723:667484350296:C033fmrgf",
    "items": [
        {
            "kind": "admin#reports#activity",
            "id": {
                "time": "2022-05-17T14:55:00.805Z",
                "uniqueQualifier": "8409638696137142723",
                "applicationName": "chrome",
                "customerId": "123456789"
            },
            "etag": "\"7dD2lEGw_cSWElgnmooDH6C54E0q2uifMqS1m-4dUqU/hd5KDhWGqo48DAx0LsBJqXmEUcc\"",
            "actor": {
                "callerType": "EXTERNAL_USER",
                "email": "example@gmail.com"
            },
            "events": [
                {
                    "type": "CONTENT_UNSCANNED_TYPE",
                    "name": "CONTENT_UNSCANNED",
                    "parameters": [
                        {
                            "name": "TIMESTAMP",
                            "intValue": "1652799300805"
                        },
                        {
                            "name": "EVENT_REASON",
                            "value": "CONTENT_UNSCANNED_FILE_TOO_LARGE"
                        },
                        {
                            "name": "EVENT_RESULT",
                            "value": "WARNED"
                        },
                        {
                            "name": "DEVICE_NAME",
                            "value": "MSI"
                        },
                        {
                            "name": "DEVICE_USER",
                            "value": "MSI\\fletc"
                        },
                        {
                            "name": "PROFILE_USER_NAME",
                            "value": "*****@gmail.com"
                        },
                        {
                            "name": "URL",
                            "value": "https://download.splunk.com/products/splunk/releases/8.2.6/windows/splunk-8.2.6-a6fe1ee8894b-x64-release.msi"
                        },
                        {
                            "name": "CONTENT_NAME",
                            "value": "C:\\Users\\example\\Downloads\\splunk-8.2.6-a6fe1ee8894b-x64-release.msi"
                        },
                        {
                            "name": "CONTENT_SIZE",
                            "intValue": "393428992"
                        },
                        {
                            "name": "CONTENT_TYPE",
                            "value": "binary/octet-stream"
                        },
                        {
                            "name": "CONTENT_HASH",
                            "value": "B6BD3099437FD88B43F244882AB3291690C810DC79DD7E40B9F54A7881FBD145"
                        },
                        {
                            "name": "TRIGGER_TYPE",
                            "value": "FILE_DOWNLOAD"
                        },
                        {
                            "name": "DEVICE_ID",
                            "value": "a4894a31-0071-4537-b6a7-ad6836e3cd35"
                        },
                        {
                            "name": "VIRTUAL_DEVICE_ID",
                            "value": "a4894a31-0071-4537-b6a7-ad6836e3cd35"
                        },
                        {
                            "name": "DEVICE_PLATFORM",
                            "value": "Windows 10"
                        },
                        {
                            "name": "BROWSER_VERSION",
                            "value": "101.0.4951.67"
                        },
                        {
                            "name": "USER_AGENT",
                            "value": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.67 Safari/537.36"
                        },
                        {
                            "name": "CLIENT_TYPE",
                            "value": "CHROME_BROWSER"
                        },
                        {
                            "name": "DIRECTORY_DEVICE_ID",
                            "value": "0c7a027c-c14d-4f04-992d-d87febda4782"
                        }
                    ]
                }
            ]
        }
    ]
}
```

### Retrieve login events
A [type for login events](https://developers.google.com/admin-sdk/reports/v1/appendix/activity/chrome#LOGIN_EVENT_TYPE). Events of this type are returned with type=LOGIN_EVENT_TYPE.
#### Request
```
GET https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/chrome?endTime=2022-11-07T00:00:00.000Z&startTime=2022-01-07T00:00:00.000Z&maxResults=25&eventName=LOGIN_EVENT
```
#### Response
```
coming soon..
```

### Retrieve senstive data transfer events
A [type for senstive data transfer events](https://developers.google.com/admin-sdk/reports/v1/appendix/activity/chrome#SENSITIVE_DATA_TRANSFER_TYPE). Events of this type are returned with type=SENSITIVE_DATA_TRANSFER_TYPE.
#### Request
```
GET https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/chrome?endTime=2022-11-07T00:00:00.000Z&startTime=2022-01-07T00:00:00.000Z&maxResults=1&eventName=SENSITIVE_DATA_TRANSFER
```
#### Response
```
coming soon..
```

### Retrieve Chrome Safe Browsing password event type
A [type for any Chrome Safe Browsing password events](https://developers.google.com/admin-sdk/reports/v1/appendix/activity/chrome#SAFE_BROWSING_PASSWORD_ALERT). Events of this type are returned with type=SAFE_BROWSING_PASSWORD_ALERT.
#### Request
```
GET https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/chrome?endTime=2022-11-07T00:00:00.000Z&startTime=2022-01-07T00:00:00.000Z&maxResults=1&eventName=SAFE_BROWSING_PASSWORD_ALERT
```
#### Response
```
coming soon..
```

## Retrieve extension request activities
A [type for extension request events](https://developers.google.com/admin-sdk/reports/v1/appendix/activity/chrome#EXTENSION_REQUEST_TYPE). Events of this type are returned with type=EXTENSION_REQUEST_TYPE.
#### Request
```
GET https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/chrome?endTime=2022-11-07T00:00:00.000Z&startTime=2022-01-07T00:00:00.000Z&maxResults=1&eventName=EXTENSION_REQUEST
```
#### Response
```
{
    "kind": "admin#reports#activities",
    "etag": "\"7dD2lEGw_cSWElgnmooDH6C54E0q2uifMqS1m-4dUqU/8vqGIwGkrUsIDoIaJ6-OlEA9EpE\"",
    "nextPageToken": "A:1659336988083000:-3378881328843331650:667484350296:C033fmrgf",
    "items": [
        {
            "kind": "admin#reports#activity",
            "id": {
                "time": "2022-08-01T06:56:28.083Z",
                "uniqueQualifier": "-3378881328843331650",
                "applicationName": "chrome",
                "customerId": "123456789"
            },
            "etag": "\"7dD2lEGw_cSWElgnmooDH6C54E0q2uifMqS1m-4dUqU/Vn4OMfDh8g6UlrjLa_MD3HeRJEc\"",
            "actor": {
                "callerType": "USER",
                "profileId": "105250506097979753968"
            },
            "events": [
                {
                    "type": "EXTENSION_REQUEST_TYPE",
                    "name": "EXTENSION_REQUEST",
                    "parameters": [
                        {
                            "name": "TIMESTAMP",
                            "intValue": "1659336988083"
                        },
                        {
                            "name": "DIRECTORY_DEVICE_ID",
                            "value": "c097300e-0808-4dba-851d-de0201b1f57a"
                        },
                        {
                            "name": "APP_NAME",
                            "value": "iMacros for Chrome"
                        },
                        {
                            "name": "APP_ID",
                            "value": "cplklnmnlbnpmjogncfgfijoopmnlemp"
                        },
                        {
                            "name": "DEVICE_USER",
                            "value": ""
                        },
                        {
                            "name": "CLIENT_TYPE",
                            "value": "CHROME_BROWSER"
                        },
                        {
                            "name": "ORG_UNIT_NAME",
                            "value": "EW-Eng"
                        },
                        {
                            "name": "CHROME_ORG_UNIT_ID",
                            "value": "123456789"
                        },
                        {
                            "name": "USER_JUSTIFICATION",
                            "value": "NEED HELP"
                        },
                        {
                            "name": "DEVICE_NAME",
                            "value": "LUZ-RAKUNATHAN"
                        },
                        {
                            "name": "CHROME_EXTENSION_REQUESTER",
                            "value": "LUZ-RAKUNATHAN"
                        }
                    ]
                }
            ]
        }
    ]
}
```

## Retrieve all authorization token events for a domain
A [type for extension request events](https://developers.google.com/admin-sdk/reports/v1/appendix/activity/chrome#EXTENSION_REQUEST_TYPE). Events of this type are returned with type=EXTENSION_REQUEST_TYPE.
#### Request
```
GET https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/token?endTime=2022-11-07T00:00:00.000Z&startTime=2022-01-07T00:00:00.000Z&maxResults=1
```
#### Response
```
{
    "kind": "admin#reports#activities",
    "etag": "\"7dD2lEGw_cSWElgnmooDH6C54E0q2uifMqS1m-4dUqU/UoOQhh5mjH5lhgm_eIpflRvYYkA\"",
    "nextPageToken": "A:1663519351789550:2267463811441111309:151219070090:C033fmrgf",
    "items": [
        {
            "kind": "admin#reports#activity",
            "id": {
                "time": "2022-09-18T16:42:31.789Z",
                "uniqueQualifier": "2267463811441111309",
                "applicationName": "token",
                "customerId": "12345678"
            },
            "etag": "\"7dD2lEGw_cSWElgnmooDH6C54E0q2uifMqS1m-4dUqU/-NTHnYoIZAldUWgeTfvNc-kAjtg\"",
            "actor": {
                "email": "test@example.com",
                "profileId": "113456549147281770764"
            },
            "ipAddress": "1.2.3.4",
            "events": [
                {
                    "type": "auth",
                    "name": "activity",
                    "parameters": [
                        {
                            "name": "api_name",
                            "value": "admin"
                        },
                        {
                            "name": "method_name",
                            "value": "reports.activities.list"
                        },
                        {
                            "name": "client_id",
                            "value": "423.apps.googleusercontent.com"
                        },
                        {
                            "name": "num_response_bytes",
                            "intValue": "670"
                        },
                        {
                            "name": "product_bucket",
                            "value": "GSUITE_ADMIN"
                        },
                        {
                            "name": "app_name",
                            "value": "Chrome Browser Postman"
                        },
                        {
                            "name": "client_type",
                            "value": "WEB"
                        }
                    ]
                }
            ]
        }
    ]
}
```
