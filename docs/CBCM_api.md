# Chrome Browser Cloud Management (CBCM) API
The [Chrome Browser Cloud Management API]([https://developers.google.com/admin-sdk/reports/v1/get-start/overview](https://support.google.com/chrome/a/answer/9681204)) is a RESTful API you can use to access/update CBCM enrolled Chrome browser information. 
- Postman collection: [Chrome Browser Cloud Management API.postman_collection.json](https://github.com/google/ChromeBrowserEnterprise/blob/main/postman/Chrome%20Browser%20Cloud%20Management%20API.postman_collection.json)
- Scope: https://www.googleapis.com/auth/admin.directory.device.chromebrowsers or https://www.googleapis.com/auth/admin.directory.device.chromebrowsers.readonly

## Retrieve browser by machine name and org unit path
To retrieve an enrolled browser by maachine name and OU path, use the following GET HTTP request and include the authorization token.
#### Request
```
GET https://www.googleapis.com/admin/directory/v1.1beta1/customer/my_customer/devices/chromebrowsers?query=machine_name:WIN-10-ACNT-01-CP&orderBy=machine_name&sortOrder=ASCENDING&orgUnitPath=/North America/Austin&projection=FULL&maxResults=100&pageToken
```
#### Response
```
{
    "kind": "admin#directory#browserdevices",
    "browsers": [
        {
            "deviceId": "9c6de4c1-cd4e-45f9-891b-708cee47696a",
            "kind": "admin#directory#browserdevice",
            "lastPolicyFetchTime": "2019-02-12T21:08:33.000Z",
            "osPlatform": "Windows",
            "osArchitecture": "x86_64",
            "osVersion": "10.0.16299.904",
            "machineName": "WIN-10-ACNT-01-CP",
            "lastRegistrationTime": "2019-02-15T18:42:33.594Z",
            "extensionCount": "3",
            "policyCount": "2",
            "lastDeviceUser": "Chunder Patel",
            "lastActivityTime": "2019-02-15T18:43:02.751Z",
            "osPlatformVersion": "Windows 10",
            "browserVersions": [
                "72.0.3626.96"
            ],
            "lastStatusReportTime": "2019-02-15T18:43:02.751Z",
            "lastDeviceUsers": [
                {
                    "userName": "Chunder Patel",
                    "lastStatusReportTime": "2019-02-15T18:43:02.751Z"
                }
            ],
            "machinePolicies": [
                {
                    "source": "UNKNOWN",
                    "name": "MachineLevelUserCloudPolicyEnrollmentToken",
                    "value": "\"e544ff8b-7a07-4505-9dc8-29da1291b432\""
                },
                {
                    "source": "UNKNOWN",
                    "name": "MetricsReportingEnabled",
                    "value": "\"True\""
                }
            ],
            "browsers": [
                {
                    "browserVersion": "72.0.3626.96",
                    "channel": "STABLE",
                    "lastStatusReportTime": "2019-02-15T18:43:02.751Z",
                    "executablePath": "c:\\program files (x86)\\google\\chrome\\application",
                    "plugins": [
                        {
                            "name": "Chrome PDF Plugin",
                            "description": "Portable Document Format",
                            "filename": "internal-pdf-viewer"
                        },
                        {
                            "name": "Chrome PDF Viewer",
                            "filename": "mhjfbmdgcfjbbpaeojofohoefgiehjai"
                        }
                    ],
                    "profiles": [
                        {
                            "name": "Corp",
                            "id": "corp",
                            "lastStatusReportTime": "2019-02-15T18:43:02.751Z",
                            "lastPolicyFetchTime": "2019-02-12T21:08:33.000Z",
                            "chromeSignedInUserEmail": "alice@wonderland.com",
                            "extensions": [
                                {
                                    "extensionId": "ghbmnnjooekpmoecnnnilnnbdlolhkhi",
                                    "version": "1.7",
                                    "name": "Google Docs Offline",
                                    "appType": "UNKNOWN_TYPE",
                                    "installType": "UNKNOWN"
                                },
                                {
                                    "extensionId": "fhcagphnoanpgcbhcjlijdbeeggldbof",
                                    "version": "1.1.4",
                                    "name": "Policy Notifier",
                                    "appType": "UNKNOWN_TYPE",
                                    "installType": "UNKNOWN"
                                },
                                {
                                    "extensionId": "kngjcibmkbngcpnaoafbgkicpgmdehje",
                                    "name": "SecureConnect Reporting",
                                    "appType": "UNKNOWN_TYPE",
                                    "installType": "UNKNOWN"
                                }
                            ]
                        }
                    ]
                }
            ],
            "serialNumber": "CZC611C9QM",
            "virtualDeviceId": "dPc5nfxpYmT43TEDbfFgwd",
            "orgUnitPath": "/North America/Austin",
            "deviceIdentifiersHistory": {}
        }
    ]
}
```

## Retrieve a Chrome browser Device ID
To retrieve an enrolled browser by device Id, use the following GET HTTP request and include the authorization token.
#### Request
```
GET https://www.googleapis.com/admin/directory/v1.1beta1/customer/my_customer/devices/chromebrowsers/9c6de4c1-cd4e-45f9-891b-708cee47696a?projection=FULL
```
#### Response
```
{
    "deviceId": "9c6de4c1-cd4e-45f9-891b-708cee47696a",
    "kind": "admin#directory#browserdevice",
    "lastPolicyFetchTime": "2019-02-12T21:08:33.000Z",
    "osPlatform": "Windows",
    "osArchitecture": "x86_64",
    "osVersion": "10.0.16299.904",
    "machineName": "WIN-10-ACNT-01-CP",
    "lastRegistrationTime": "2019-02-15T18:42:33.594Z",
    "extensionCount": "3",
    "policyCount": "2",
    "lastDeviceUser": "Chunder Patel",
    "lastActivityTime": "2019-02-15T18:43:02.751Z",
    "osPlatformVersion": "Windows 10",
    "browserVersions": [
        "72.0.3626.96"
    ],
    "lastStatusReportTime": "2019-02-15T18:43:02.751Z",
    "lastDeviceUsers": [
        {
            "userName": "Chunder Patel",
            "lastStatusReportTime": "2019-02-15T18:43:02.751Z"
        }
    ],
    "machinePolicies": [
        {
            "source": "UNKNOWN",
            "name": "MachineLevelUserCloudPolicyEnrollmentToken",
            "value": "\"e544ff8b-7a07-4505-9dc8-29da1291b432\""
        },
        {
            "source": "UNKNOWN",
            "name": "MetricsReportingEnabled",
            "value": "\"True\""
        }
    ],
    "browsers": [
        {
            "browserVersion": "72.0.3626.96",
            "channel": "STABLE",
            "lastStatusReportTime": "2019-02-15T18:43:02.751Z",
            "executablePath": "c:\\program files (x86)\\google\\chrome\\application",
            "plugins": [
                {
                    "name": "Chrome PDF Plugin",
                    "description": "Portable Document Format",
                    "filename": "internal-pdf-viewer"
                },
                {
                    "name": "Chrome PDF Viewer",
                    "filename": "mhjfbmdgcfjbbpaeojofohoefgiehjai"
                }
            ],
            "profiles": [
                {
                    "name": "Corp",
                    "id": "corp",
                    "lastStatusReportTime": "2019-02-15T18:43:02.751Z",
                    "lastPolicyFetchTime": "2019-02-12T21:08:33.000Z",
                    "chromeSignedInUserEmail": "alice@wonderland.com",
                    "extensions": [
                        {
                            "extensionId": "ghbmnnjooekpmoecnnnilnnbdlolhkhi",
                            "version": "1.7",
                            "name": "Google Docs Offline",
                            "appType": "UNKNOWN_TYPE",
                            "installType": "UNKNOWN"
                        },
                        {
                            "extensionId": "fhcagphnoanpgcbhcjlijdbeeggldbof",
                            "version": "1.1.4",
                            "name": "Policy Notifier",
                            "appType": "UNKNOWN_TYPE",
                            "installType": "UNKNOWN"
                        },
                        {
                            "extensionId": "kngjcibmkbngcpnaoafbgkicpgmdehje",
                            "name": "SecureConnect Reporting",
                            "appType": "UNKNOWN_TYPE",
                            "installType": "UNKNOWN"
                        }
                    ]
                }
            ]
        }
    ],
    "serialNumber": "CZC611C9QM",
    "virtualDeviceId": "dPc5nfxpYmT43TEDbfFgwd",
    "orgUnitPath": "/North America/Austin",
    "deviceIdentifiersHistory": {}
}
```

## Retrieve browsers by org unit path
To retrieve all enrolled browser by OU, use the following GET HTTP request and include the authorization token. Limitation: The nextPageToken returned by the listing request has a 1 hour lifetime. If your listing request has a large number of Chrome browser devices, your page token may expire before you can finish listing all the devices. In this case you may want to apply a filter to your listing request in order to reduce the number of devices returned by the query. Typically, filtering by OU is a good way to reduce the number of results.
#### Request
```
GET https://www.googleapis.com/admin/directory/v1.1beta1/customer/my_customer/devices/chromebrowsers?orderBy=browser_version_sortable&sortOrder=DESCENDING&orgUnitPath=/North America/Austin&projection=FULL&maxResults=1&pageToken
```
#### Response
```
{
    "kind": "admin#directory#browserdevices",
    "browsers": [
        {
            "deviceId": "196791de-fb8d-4e27-9bd3-cc3cdeef9532",
            "kind": "admin#directory#browserdevice",
            "lastPolicyFetchTime": "2022-07-22T02:32:51.980Z",
            "osPlatform": "Windows",
            "osArchitecture": "x86_64",
            "osVersion": "10.0.22000.795",
            "machineName": "ExampleAD-AD-Joined-",
            "lastRegistrationTime": "2022-07-08T15:00:03.630Z",
            "extensionCount": "7",
            "policyCount": "34",
            "lastDeviceUser": "ExampleAD\\example",
            "lastActivityTime": "2022-07-22T20:59:34.214Z",
            "osPlatformVersion": "Windows 11",
            "browserVersions": [
                "103.0.5060.134"
            ],
            "lastStatusReportTime": "2022-07-22T20:11:55.933Z",
            "lastDeviceUsers": [
                {
                    "userName": "ExampleAD\\example",
                    "lastStatusReportTime": "2022-07-22T20:11:55.933Z"
                },
                {
                    "userName": "WORKGROUP\\example",
                    "lastStatusReportTime": "2022-07-13T17:20:29.272Z"
                }
            ],
            "machinePolicies": [
                {
                    "source": "MACHINE_PLATFORM",
                    "name": "--BlockThirdPartyCookies",
                    "value": "0",
                    "error": "Unknown policy."
                },
                {
                    "source": "MACHINE_PLATFORM",
                    "name": "--ForceEphemeralProfiles",
                    "value": "0",
                    "error": "Unknown policy."
                },
                {
                    "source": "MACHINE_LEVEL_USER_CLOUD",
                    "name": "AlternativeBrowserPath",
                    "value": "\"${edge}\""
                },
                {
                    "source": "MACHINE_LEVEL_USER_CLOUD",
                    "name": "AuthNegotiateDelegateAllowlist",
                    "value": "\"ExampleAD.com\""
                },
                {
                    "source": "MACHINE_LEVEL_USER_CLOUD",
                    "name": "AutoplayAllowlist",
                    "value": "[\"https://voice.google.com\"]"
                },
                {
                    "source": "MACHINE_LEVEL_USER_CLOUD",
                    "name": "BrowserSwitcherDelay",
                    "value": "0"
                },
                {
                    "source": "MACHINE_LEVEL_USER_CLOUD",
                    "name": "BrowserSwitcherEnabled",
                    "value": "false"
                },
                {
                    "source": "MACHINE_LEVEL_USER_CLOUD",
                    "name": "BrowserSwitcherParsingMode",
                    "value": "1"
                },
                {
                    "source": "MACHINE_LEVEL_USER_CLOUD",
                    "name": "BrowserSwitcherUseIeSitelist",
                    "value": "true"
                },
                {
                    "source": "MACHINE_PLATFORM",
                    "name": "CloudManagementEnrollmentToken",
                    "value": "\"9f8f4185-4594-4f36-94ac-ce83bf872536\""
                },
                {
                    "source": "MACHINE_LEVEL_USER_CLOUD",
                    "name": "CloudReportingEnabled",
                    "value": "true"
                },
                {
                    "source": "MACHINE_LEVEL_USER_CLOUD",
                    "name": "CloudReportingUploadFrequency",
                    "value": "3"
                },
                {
                    "source": "MACHINE_LEVEL_USER_CLOUD",
                    "name": "ComponentUpdatesEnabled",
                    "value": "true"
                },
                {
                    "source": "MACHINE_LEVEL_USER_CLOUD",
                    "name": "DeveloperToolsDisabled",
                    "value": "false",
                    "error": "This policy has been deprecated"
                },
                {
                    "source": "MACHINE_LEVEL_USER_CLOUD",
                    "name": "DownloadRestrictions",
                    "value": "0"
                },
                {
                    "source": "MACHINE_LEVEL_USER_CLOUD",
                    "name": "EnterpriseRealTimeUrlCheckMode",
                    "value": "0"
                },
                {
                    "source": "MACHINE_MERGED",
                    "name": "ExtensionInstallBlocklist",
                    "value": "[\"bihmplhobchoageeokmgbdihknkjbknd\",\"fcfhplploccackoneaefokcmbjfbkenj\",\"fdcgdnkidjaadafnichfpabhfomcebme\",\"majdfhpaihoncoakbjgbdhglocklcgno\",\"nbcojefnccbanplpoffopkoepjmhgdgh\",\"nlbejmccbhkncgokjcmghpfloaajcffj\",\"omghfjlpggmjjaagoclmmobgdodcjboh\",\"oocalimimngaihdkbihfgmpkcpnmlaoa\"]"
                },
                {
                    "source": "MACHINE_MERGED",
                    "name": "ExtensionInstallForcelist",
                    "value": "[\"feolagkacappiaieohahjkeaikhjjcfa;https://clients2.google.com/service/update2/crx\",\"jifpbeccnghkjeaalbbjmodiffmgedin;https://clients2.google.com/service/update2/crx\",\"lkpemakdpfhgpafifejgiglfonmbfhmk;https://addons.whatfix.com/whatfix-store/chrome\",\"lpcaedmchfhocbbapmcbpinfpgnhiddi;https://clients2.google.com/service/update2/crx\",\"mooikfkahbdckldjjndioackbalphokd;https://clients2.google.com/service/update2/crx\",\"ejgnolahdlcimijhloboakpjogbfdkkp;https://clients2.google.com/service/update2/crx\"]"
                },
                {
                    "source": "MACHINE_LEVEL_USER_CLOUD",
                    "name": "ExtensionInstallSources",
                    "value": "[\"https://addons.whatfix.com/whatfix-store/chrome\"]"
                },
                {
                    "source": "MACHINE_PLATFORM",
                    "name": "ExtensionSettings",
                    "value": "{\"feolagkacappiaieohahjkeaikhjjcfa\":{\"installation_mode\":\"normal_installed\",\"runtime_allowed_hosts\":[\"*://*.hcpnv.com\",\"https://tw1.hcpnv.com\",\"https://tw2.hcpnv.com\",\"https://tw3.hcpnv.com\",\"https://tw4.hcpnv.com\"],\"runtime_blocked_hosts\":[\"*://*\"],\"update_url\":\"https://clients2.google.com/service/update2/crx\"}}"
                },
                {
                    "source": "MACHINE_LEVEL_USER_CLOUD",
                    "name": "HSTSPolicyBypassList",
                    "value": "[\"support\"]"
                },
                {
                    "source": "MACHINE_LEVEL_USER_CLOUD",
                    "name": "ManagedBookmarks",
                    "value": "[]"
                },
                {
                    "source": "MACHINE_LEVEL_USER_CLOUD",
                    "name": "OnSecurityEventEnterpriseConnector",
                    "value": "[{\"enabled_opt_in_events\":[],\"service_provider\":\"google\"}]"
                },
                {
                    "source": "MACHINE_LEVEL_USER_CLOUD",
                    "name": "PasswordProtectionChangePasswordURL",
                    "value": "\"https://fletcheroliver.wixsite.com/website/reset-your-corp-password\""
                },
                {
                    "source": "MACHINE_LEVEL_USER_CLOUD",
                    "name": "PasswordProtectionLoginURLs",
                    "value": "[\"https://fletcheroliver.wixsite.com/website\"]"
                },
                {
                    "source": "MACHINE_LEVEL_USER_CLOUD",
                    "name": "PasswordProtectionWarningTrigger",
                    "value": "1"
                },
                {
                    "source": "MACHINE_LEVEL_USER_CLOUD",
                    "name": "PolicyListMultipleSourceMergeList",
                    "value": "[\"ExtensionInstallAllowlist\",\"ExtensionInstallBlocklist\",\"ExtensionInstallForcelist\"]"
                },
                {
                    "source": "MACHINE_PLATFORM",
                    "name": "RegisteredProtocolHandlers",
                    "value": "[{\"default\":true,\"protocol\":\"mailto\",\"url\":\"https://mail.google.com/mail/?extsrc=mailto&url=%s\"}]"
                },
                {
                    "source": "MACHINE_LEVEL_USER_CLOUD",
                    "name": "RelaunchNotification",
                    "value": "2"
                },
                {
                    "source": "MACHINE_LEVEL_USER_CLOUD",
                    "name": "RelaunchNotificationPeriod",
                    "value": "3600000"
                },
                {
                    "source": "MACHINE_PLATFORM",
                    "name": "RelaunchWindow",
                    "value": "{\"entries\":[{\"duration_mins\":540,\"start\":{\"hour\":18,\"minute\":0}}]}"
                },
                {
                    "source": "MACHINE_LEVEL_USER_CLOUD",
                    "name": "SafeBrowsingEnabled",
                    "value": "true",
                    "error": "Ignored because it was overridden by SafeBrowsingProtectionLevel.\nThis policy has been deprecated\n"
                },
                {
                    "source": "MACHINE_LEVEL_USER_CLOUD",
                    "name": "SafeBrowsingProtectionLevel",
                    "value": "1"
                },
                {
                    "source": "MACHINE_LEVEL_USER_CLOUD",
                    "name": "TotalMemoryLimitMb",
                    "value": "1024"
                }
            ],
            "browsers": [
                {
                    "browserVersion": "103.0.5060.134",
                    "channel": "STABLE",
                    "lastStatusReportTime": "2022-07-22T20:11:55.933Z",
                    "executablePath": "c:\\program files\\google\\chrome\\application",
                    "plugins": [
                        {
                            "name": "Chrome PDF Viewer",
                            "filename": "mhjfbmdgcfjbbpaeojofohoefgiehjai"
                        },
                        {
                            "name": "Native Client",
                            "filename": "internal-nacl-plugin"
                        },
                        {
                            "name": "Chrome PDF Plugin",
                            "description": "Portable Document Format",
                            "filename": "internal-pdf-viewer"
                        }
                    ],
                    "profiles": [
                        {
                            "name": "Person 1",
                            "id": "c:\\users\\example\\appdata\\local\\google\\chrome\\user data\\default",
                            "lastStatusReportTime": "2022-07-22T20:11:55.933Z",
                            "lastPolicyFetchTime": "2022-07-22T02:32:51.980Z",
                            "extensions": [
                                {
                                    "extensionId": "ejgnolahdlcimijhloboakpjogbfdkkp",
                                    "version": "1.11.9",
                                    "permissions": [
                                        "alarms",
                                        "notifications",
                                        "storage",
                                        "<all_urls>"
                                    ],
                                    "name": "Meow, The Cat Pet",
                                    "description": "Meow is a virtual Cat pet who walks on your screen while you're browsing the web.",
                                    "appType": "EXTENSION",
                                    "homepageUrl": "https://chrome.google.com/webstore/detail/ejgnolahdlcimijhloboakpjogbfdkkp",
                                    "installType": "ADMIN",
                                    "manifestVersion": 3
                                },
                                {
                                    "extensionId": "feolagkacappiaieohahjkeaikhjjcfa",
                                    "version": "22.2.789.0",
                                    "permissions": [
                                        "nativeMessaging",
                                        "tabs",
                                        "*://*/*"
                                    ],
                                    "name": "Dragon (DMO, DMD, DPA, DLA) Web Extension",
                                    "description": "Dragon Web Extension",
                                    "appType": "EXTENSION",
                                    "homepageUrl": "https://chrome.google.com/webstore/detail/feolagkacappiaieohahjkeaikhjjcfa",
                                    "installType": "SIDELOAD",
                                    "manifestVersion": 2
                                },
                                {
                                    "extensionId": "ghbmnnjooekpmoecnnnilnnbdlolhkhi",
                                    "version": "1.44.2",
                                    "permissions": [
                                        "alarms",
                                        "storage",
                                        "unlimitedStorage",
                                        "https://docs.google.com/*",
                                        "https://drive.google.com/*"
                                    ],
                                    "name": "Google Docs Offline",
                                    "description": "Edit, create, and view your documents, spreadsheets, and presentations — all without internet access.",
                                    "appType": "EXTENSION",
                                    "homepageUrl": "https://chrome.google.com/webstore/detail/ghbmnnjooekpmoecnnnilnnbdlolhkhi",
                                    "installType": "SIDELOAD",
                                    "manifestVersion": 2
                                },
                                {
                                    "extensionId": "jifpbeccnghkjeaalbbjmodiffmgedin",
                                    "version": "1.6.13",
                                    "permissions": [
                                        "contextMenus",
                                        "declarativeContent",
                                        "downloads",
                                        "downloadsInternal",
                                        "storage",
                                        "tabs",
                                        "*://clients2.google.com/*",
                                        "*://clients2.googleusercontent.com/*"
                                    ],
                                    "name": "Chrome extension source viewer",
                                    "description": "View source code of Chrome extensions, Firefox addons or Opera extensions (crx/nex/xpi) from the Chrome web store and elsewhere.",
                                    "appType": "EXTENSION",
                                    "homepageUrl": "https://chrome.google.com/webstore/detail/jifpbeccnghkjeaalbbjmodiffmgedin",
                                    "installType": "ADMIN",
                                    "manifestVersion": 2
                                },
                                {
                                    "extensionId": "lpcaedmchfhocbbapmcbpinfpgnhiddi",
                                    "version": "4.22282.540.1",
                                    "permissions": [
                                        "activeTab",
                                        "contextMenus",
                                        "identity",
                                        "identity.email",
                                        "storage",
                                        "tabs",
                                        "unlimitedStorage",
                                        "file:///*",
                                        "http://*/*",
                                        "https://*/*"
                                    ],
                                    "name": "Google Keep Chrome Extension",
                                    "description": "Save to Google Keep in a single click!",
                                    "appType": "EXTENSION",
                                    "homepageUrl": "https://chrome.google.com/webstore/detail/lpcaedmchfhocbbapmcbpinfpgnhiddi",
                                    "installType": "ADMIN",
                                    "manifestVersion": 2
                                },
                                {
                                    "extensionId": "mooikfkahbdckldjjndioackbalphokd",
                                    "version": "3.17.2",
                                    "permissions": [
                                        "activeTab",
                                        "contextMenus",
                                        "debugger",
                                        "downloads",
                                        "downloadsInternal",
                                        "storage",
                                        "tabs",
                                        "webNavigation",
                                        "<all_urls>",
                                        "chrome://favicon/*"
                                    ],
                                    "name": "Selenium IDE",
                                    "description": "Selenium Record and Playback tool for ease of getting acquainted with Selenium WebDriver.",
                                    "appType": "EXTENSION",
                                    "homepageUrl": "https://github.com/SeleniumHQ/selenium-ide",
                                    "installType": "ADMIN",
                                    "manifestVersion": 2
                                },
                                {
                                    "extensionId": "pioclpoplcdbaefihamjohnefbikjilc",
                                    "version": "7.24.0",
                                    "permissions": [
                                        "activeTab",
                                        "contextMenus",
                                        "cookies",
                                        "tabs",
                                        "<all_urls>",
                                        "chrome://favicon/*"
                                    ],
                                    "name": "Evernote Web Clipper",
                                    "description": "Use the Evernote extension to save things you see on the web into your Evernote account.",
                                    "appType": "EXTENSION",
                                    "homepageUrl": "https://chrome.google.com/webstore/detail/pioclpoplcdbaefihamjohnefbikjilc",
                                    "installType": "NORMAL",
                                    "manifestVersion": 2
                                }
                            ]
                        },
                        {
                            "name": "Person 1",
                            "id": "c:\\temp3\\cbcmlauncher\\cbcmprofile",
                            "lastStatusReportTime": "2022-07-13T17:20:29.272Z",
                            "lastPolicyFetchTime": "2022-07-13T17:11:32.251Z"
                        },
                        {
                            "name": "Person 1",
                            "id": "c:\\windows\\system32\\config\\systemprofile\\appdata\\local\\google\\chrome\\user data\\default",
                            "lastStatusReportTime": "2022-07-08T15:16:13.733Z",
                            "lastPolicyFetchTime": "2022-07-08T15:16:12.382Z"
                        }
                    ]
                }
            ],
            "serialNumber": "0000-0006-0605-6480-0243-9779-30",
            "virtualDeviceId": "d125b747-b3d6-43ee-93a4-3422b135549c",
            "orgUnitPath": "/North America/Austin",
            "deviceIdentifiersHistory": {
                "records": [
                    {
                        "identifiers": {
                            "machineName": "ExampleAD-AD-Joined-",
                            "serialNumber": "0000-0006-0605-6480-0243-9779-30"
                        },
                        "firstRecordTime": "2022-07-08T15:00:09.309Z",
                        "lastActivityTime": "2022-07-22T20:11:56.055Z"
                    }
                ]
            }
        }
    ],
    "nextPageToken": "CrMBCMjxi8PtnvoCEqcBCn0wMTAzLjAwMDAuMDUwNjAuMDEzNAD_Aff95-bd287GycjGzpua0pmdx5vSy5rNyNLGnZvM0pyczJybmpqZxsrMzc8IT3-2_wD-__7_9_3n5t3bzsbJyMbOm5rSmZ3Hm9LLms3I0sadm8zSnJzMnJuampnGyszNzwhPf7b__hABIcG4G1qbJqqJUABaCwlsj_d0kTLuOBADYJ3axZEBcgYI5IudmQYQABofEgQIExAAGhcSFS9Ob3J0aCBBbWVyaWNhL0F1c3Rpbg"
}
```

## Retrieve Chrome browsers where the Device ID is shared by multiple machines

#### Request
```
GET https://www.googleapis.com/admin/directory/v1.1beta1/customer/my_customer/devices/chromebrowsers?query=has_device_id_collision:true&orderBy=browser_version_sortable&sortOrder=DESCENDING&orgUnitPath=/North America/Austin&projection=BASIC&maxResults=100&pageToken
```
#### Response
```
{
    "kind": "admin#directory#browserdevices"
}
```

## Retrieve Chrome browsers by last activity date

#### Request
```
GET https://www.googleapis.com/admin/directory/v1.1beta1/customer/my_customer/devices/chromebrowsers?query=last_activity:2021-01-01..2022-01-01 &orderBy=last_activity&sortOrder=ASCENDING&orgUnitPath=&projection=BASIC&maxResults=1&pageToken
```
#### Response
```
{
    "kind": "admin#directory#browserdevices",
    "browsers": [
        {
            "deviceId": "822afb26-84dd-4404-93c0-747e521affbd",
            "kind": "admin#directory#browserdevice",
            "lastPolicyFetchTime": "2021-02-05T19:57:29.120Z",
            "osPlatform": "Windows",
            "osArchitecture": "x86_64",
            "osVersion": "10.0.18363.1316",
            "machineName": "DESKTOP-KU9BS7D",
            "lastRegistrationTime": "2021-02-01T19:55:44.402Z",
            "extensionCount": "8",
            "policyCount": "32",
            "lastDeviceUser": "DESKTOP-KU9BS7D\\alex",
            "lastActivityTime": "2021-02-05T19:58:14.224Z",
            "osPlatformVersion": "Windows 10",
            "browserVersions": [
                "88.0.4324.146",
                "89.0.4389.23 (Beta)"
            ],
            "serialNumber": "VMware-56 4d 5b d6 51 bc f0 9b-4b e9 b2 ef e2 b6 00 a5",
            "virtualDeviceId": "f9e1ac5d-1acf-4628-a6a2-e9eeb82e5703",
            "orgUnitPath": "/North America/Seattle",
            "deviceIdentifiersHistory": {
                "records": [
                    {
                        "identifiers": {
                            "machineName": "DESKTOP-KU9BS7D",
                            "serialNumber": "VMware-56 4d 5b d6 51 bc f0 9b-4b e9 b2 ef e2 b6 00 a5"
                        },
                        "firstRecordTime": "2021-02-01T19:55:47.034Z",
                        "lastActivityTime": "2021-02-05T19:58:14.539Z"
                    }
                ]
            }
        }
    ],
    "nextPageToken": "Cq0BCMjf1qPwnvoCEqEBCnc9iIjDn3L_AAD__wAA__8A_vf95-bd28fNzZ6Znc3J0sfLm5vSy8vPy9LGzJzP0sjLyJrKzc6emZmdm88IT3-2_wD-__7_9_3n5t3bx83NnpmdzcnSx8ubm9LLy8_L0sbMnM_SyMvImsrNzp6ZmZ2bzwhPf7b__hABIcG4G1qbJqqJUABaCwkXGs9KMy7nDBADYL7zxLUDcgYI9KedmQYaLQolbGFzdF9hY3Rpdml0eToyMDIxLTAxLTAxLi4yMDIyLTAxLTAxIBIECBIQAQ"
}
```

## Update annotated fields of a Chrome Browser

#### Request
```
curl --location --request PUT 'https://www.googleapis.com/admin/directory/v1.1beta1/customer/my_customer/devices/chromebrowsers/9c6de4c1-cd4e-45f9-891b-708cee47696a/' \
--header 'Authorization: Bearer ' \
--header 'Content-Type: application/json' \
--data-raw '{
  "deviceId": "9c6de4c1-cd4e-45f9-891b-708cee47696a",
  "annotatedUser": "user 1",
  "annotatedLocation": "North America/Austin",
  "annotatedNotes": "Test notes 09/08/2022",
  "annotatedAssetId":"WIN-10-ACNT-01-CP"

}'
```
#### Response
```
{
    "deviceId": "9c6de4c1-cd4e-45f9-891b-708cee47696a",
    "kind": "admin#directory#browserdevice",
    "lastPolicyFetchTime": "2019-02-12T21:08:33.000Z",
    "osPlatform": "Windows",
    "osArchitecture": "x86_64",
    "osVersion": "10.0.16299.904",
    "machineName": "WIN-10-ACNT-01-CP",
    "annotatedLocation": "North America/Austin",
    "annotatedUser": "user 1",
    "annotatedAssetId": "WIN-10-ACNT-01-CP",
    "annotatedNotes": "Test notes 09/08/2022",
    "lastRegistrationTime": "2019-02-15T18:42:33.594Z",
    "extensionCount": "3",
    "policyCount": "2",
    "lastDeviceUser": "Chunder Patel",
    "lastActivityTime": "2019-02-15T18:43:02.751Z",
    "osPlatformVersion": "Windows 10",
    "browserVersions": [
        "72.0.3626.96"
    ],
    "lastStatusReportTime": "2019-02-15T18:43:02.751Z",
    "lastDeviceUsers": [
        {
            "userName": "Chunder Patel",
            "lastStatusReportTime": "2019-02-15T18:43:02.751Z"
        }
    ],
    "machinePolicies": [
        {
            "source": "UNKNOWN",
            "name": "MachineLevelUserCloudPolicyEnrollmentToken",
            "value": "\"e544ff8b-7a07-4505-9dc8-29da1291b432\""
        },
        {
            "source": "UNKNOWN",
            "name": "MetricsReportingEnabled",
            "value": "\"True\""
        }
    ],
    "browsers": [
        {
            "browserVersion": "72.0.3626.96",
            "channel": "STABLE",
            "lastStatusReportTime": "2019-02-15T18:43:02.751Z",
            "executablePath": "c:\\program files (x86)\\google\\chrome\\application",
            "plugins": [
                {
                    "name": "Chrome PDF Plugin",
                    "description": "Portable Document Format",
                    "filename": "internal-pdf-viewer"
                },
                {
                    "name": "Chrome PDF Viewer",
                    "filename": "mhjfbmdgcfjbbpaeojofohoefgiehjai"
                }
            ],
            "profiles": [
                {
                    "name": "Corp",
                    "id": "corp",
                    "lastStatusReportTime": "2019-02-15T18:43:02.751Z",
                    "lastPolicyFetchTime": "2019-02-12T21:08:33.000Z",
                    "chromeSignedInUserEmail": "alice@wonderland.com",
                    "extensions": [
                        {
                            "extensionId": "ghbmnnjooekpmoecnnnilnnbdlolhkhi",
                            "version": "1.7",
                            "name": "Google Docs Offline",
                            "appType": "UNKNOWN_TYPE",
                            "installType": "UNKNOWN"
                        },
                        {
                            "extensionId": "fhcagphnoanpgcbhcjlijdbeeggldbof",
                            "version": "1.1.4",
                            "name": "Policy Notifier",
                            "appType": "UNKNOWN_TYPE",
                            "installType": "UNKNOWN"
                        },
                        {
                            "extensionId": "kngjcibmkbngcpnaoafbgkicpgmdehje",
                            "name": "SecureConnect Reporting",
                            "appType": "UNKNOWN_TYPE",
                            "installType": "UNKNOWN"
                        }
                    ]
                }
            ]
        }
    ],
    "serialNumber": "CZC611C9QM",
    "virtualDeviceId": "dPc5nfxpYmT43TEDbfFgwd",
    "orgUnitPath": "/North America/Austin",
    "deviceIdentifiersHistory": {}
}
```

## Move Chrome browsers between Organization Units

#### Request
```
curl --location --request POST 'https://www.googleapis.com/admin/directory/v1.1beta1/customer/my_customer/devices/chromebrowsers/moveChromeBrowsersToOu' \
--header 'Authorization: Bearer ' \
--header 'Content-Type: application/json' \
--data-raw '{"org_unit_path":"North America/Austin","resource_ids":["9c6de4c1-cd4e-45f9-891b-708cee47696a","39cba31d-7a9c-42c6-b7b1-4597d7fc5e76"]}'
```
#### Response
```

```

## Delete a Chrome browser Device

#### Request
```
curl --location --request DELETE 'https://www.googleapis.com/admin/directory/v1.1beta1/customer/my_customer/devices/chromebrowsers/236da872-e62d-4eec-af68-eb859daa6ad6' \
--header 'Authorization: Bearer '
```
#### Response
```

```
