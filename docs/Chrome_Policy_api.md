# Chrome Policy API
The [Chrome Policy API](https://developers.google.com/chrome/policy) is a suite of services that empower Chrome administrators to programmatically view, manage, and get policies for Chrome browsers in their organization.
- Postman collection: [Chrome Policy API.postman_collection.json](https://github.com/google/ChromeBrowserEnterprise/blob/main/postman/Chrome%20Policy%20API.postman_collection.json)
- Scope: https://www.googleapis.com/auth/chrome.management.policy

## Get a list of policy schemas
Gets a list of policy schemas that match a specified filter value. Method: [customers.policySchemas.get](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policySchemas/get)
#### Request
```
GET https://chromepolicy.googleapis.com/v1/customers/my_customer/policySchemas?pageSize=100&pageToken&filter=field_descriptions.field=autoplayAllowlist
```
#### Response
```
{
    "policySchemas": [
        {
            "name": "customers/C033fmrgf/policySchemas/chrome.users.AutoplayAllowlist",
            "policyDescription": "Autoplay video.",
            "definition": {
                "messageType": [
                    {
                        "name": "AutoplayAllowlist",
                        "field": [
                            {
                                "name": "autoplayAllowlist",
                                "number": 1,
                                "label": "LABEL_REPEATED",
                                "type": "TYPE_STRING"
                            }
                        ]
                    }
                ]
            },
            "fieldDescriptions": [
                {
                    "field": "autoplayAllowlist",
                    "description": "Allowed URLs. URL patterns allowed to autoplay. Prefix domain with [*.] to include all subdomains. Use * to allow all domains.",
                    "name": "Allowed URLs.",
                    "fieldDescription": "URL patterns allowed to autoplay. Prefix domain with [*.] to include all subdomains. Use * to allow all domains."
                }
            ],
            "supportUri": "https://support.google.com/chrome/a/answer/2657289?hl=en#autoplay_allowlist",
            "schemaName": "chrome.users.AutoplayAllowlist",
            "validTargetResources": [
                "ORG_UNIT"
            ],
            "policyApiLifecycle": {
                "policyApiLifecycleStage": "API_CURRENT"
            },
            "categoryTitle": "Content"
        },
        {
            "name": "customers/C033fmrgf/policySchemas/chrome.devices.managedguest.AutoplayAllowlist",
            "policyDescription": "Autoplay video.",
            "definition": {
                "messageType": [
                    {
                        "name": "AutoplayAllowlist",
                        "field": [
                            {
                                "name": "autoplayAllowlist",
                                "number": 1,
                                "label": "LABEL_REPEATED",
                                "type": "TYPE_STRING"
                            }
                        ]
                    }
                ]
            },
            "fieldDescriptions": [
                {
                    "field": "autoplayAllowlist",
                    "description": "Allowed URLs. URL patterns allowed to autoplay. Prefix domain with [*.] to include all subdomains. Use * to allow all domains.",
                    "name": "Allowed URLs.",
                    "fieldDescription": "URL patterns allowed to autoplay. Prefix domain with [*.] to include all subdomains. Use * to allow all domains."
                }
            ],
            "schemaName": "chrome.devices.managedguest.AutoplayAllowlist",
            "validTargetResources": [
                "ORG_UNIT"
            ],
            "policyApiLifecycle": {
                "policyApiLifecycleStage": "API_CURRENT"
            },
            "categoryTitle": "Content"
        }
    ]
}
```

## List policies for an Organizational Unit
Gets the resolved policy values for a list of policies that match a search query. Method: [customers.policies.resolve](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policies/resolve)
#### Request
```
curl --location --request POST 'https://chromepolicy.googleapis.com/v1/customers/my_customer/policies:resolve' \
--header 'Authorization: Bearer ' \
--header 'Content-Type: application/json' \
--data-raw '{
  "policySchemaFilter": "chrome.users.*",
  "policyTargetKey": {
    "targetResource": "orgunits/03ph8a2z4jbpnn4"
  },
  "pageSize": 2,
  "pageToken": ""
}'
```
#### Response
```
{
    "resolvedPolicies": [
        {
            "targetKey": {
                "targetResource": "orgunits/03ph8a2z4jbpnn4"
            },
            "value": {
                "policySchema": "chrome.users.BrowserSignin",
                "value": {
                    "browserSignin": "BROWSER_SIGNIN_MODE_ENUM_DISABLE"
                }
            },
            "sourceKey": {
                "targetResource": "orgunits/03ph8a2z191zmfv"
            }
        },
        {
            "targetKey": {
                "targetResource": "orgunits/03ph8a2z4jbpnn4"
            },
            "value": {
                "policySchema": "chrome.users.SigninInterceptionEnabled",
                "value": {
                    "signinInterceptionEnabled": true
                }
            },
            "sourceKey": {
                "targetResource": "orgunits/03ph8a2z191zmfv"
            }
        }
    ],
    "nextPageToken": "AGwWS9DYTntMa5VxoSEQRnMOKK9kZbGIs_374gQPGhrqyhgzdYwl8IeAyH_TAFnK3V13mP4HwDVEzW327rQEFW6H_RTLMBsuTvPyZRg6-vk4aXsx9FrLjkWI-4Ur2n3GA9_P4kpuZ7I1Fr9w"
}
```

## Modify a policy in an Organizational Unit
Modify multiple policy values that are applied to a specific org unit. Method: [customers.policies.orgunits.batchModify](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policies.orgunits/batchModify)
#### Request
```
curl --location --request POST 'https://chromepolicy.googleapis.com/v1/customers/my_customer/policies/orgunits:batchModify' \
--header 'Authorization: Bearer ' \
--header 'Content-Type: application/json' \
--data-raw '{
  "requests": [
    {
      "policyTargetKey": {
          "targetResource": "orgunits/03ph8a2z4jbpnn4"
      },
      "policyValue": {
        "policySchema": "chrome.users.AutoplayAllowlist",
        "value": {autoplayAllowlist: ["https://voice.google.com"]}
      },
      "updateMask": {paths:"autoplayAllowlist"}
    }
  ]
}
'
```
#### Response
```
{}
```

## Modify multiple policies at once in an Organizational Unit
Modify multiple policy values that are applied to a specific org unit. Method: [customers.policies.orgunits.batchModify](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policies.orgunits/batchModify)
#### Request
```
curl --location --request POST 'https://chromepolicy.googleapis.com/v1/customers/my_customer/policies/orgunits:batchModify' \
--header 'Authorization: Bearer ' \
--header 'Content-Type: application/json' \
--data-raw '{
  "requests": [
    {
      "policyTargetKey": {
          "targetResource": "orgunits/03ph8a2z4jbpnn4"
      },
      "policyValue": {
        "policySchema": "chrome.users.ChromeCleanupEnabled",
        "value": {chromeCleanupEnabled: false}
      },
      "updateMask": {paths:"chromeCleanupEnabled"}
    },
    {
      "policyTargetKey": {
          "targetResource": "orgunits/03ph8a2z4jbpnn4"
      },
      "policyValue": {
        "policySchema": "chrome.users.IncognitoMode",
        "value": {incognitoModeAvailability: 2}
      },
      "updateMask": {paths:"incognitoModeAvailability"}
    }
  ]
}
'
```
#### Response
```
{}
```

## Inherit policies in an Organizational Unit
Modify multiple policy values that are applied to a specific org unit. Method: [customers.policies.orgunits.batchModify](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policies.orgunits/batchModify)
#### Request
```
curl --location --request POST 'https://chromepolicy.googleapis.com/v1/customers/my_customer/policies/orgunits:batchInherit' \
--header 'Authorization: Bearer ' \
--header 'Content-Type: application/json' \
--data-raw '
{
  "requests": [
    {
      "policyTargetKey": {
        "targetResource": "orgunits/03ph8a2z4jbpnn4"
      },
      "policySchema": "chrome.users.ChromeCleanupEnabled"
    },
    {
      "policyTargetKey": {
        "targetResource": "orgunits/03ph8a2z4jbpnn4"
      },
      "policySchema": "chrome.users.IncognitoMode"
    }
  ]
}
'
```
#### Response
```
{}
```

## Force install an extension in a specific Organizational Unit
Modify multiple policy values that are applied to a specific org unit. Method: [customers.policies.orgunits.batchModify](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policies.orgunits/batchModify)
#### Request
```
curl --location --request POST 'https://chromepolicy.googleapis.com/v1/customers/my_customer/policies/orgunits:batchModify' \
--header 'Authorization: Bearer ' \
--header 'Content-Type: application/json' \
--data-raw '
{
  "requests": [
    {
      "policyTargetKey": {
        "targetResource": "orgunits/03ph8a2z4jbpnn4",
        "additionalTargetKeys": {
          "app_id": "chrome:aapbdbdomjkkjkaonfhkkikfgjllcleb"
        }
      },
      policyValue: {
          policySchema: "chrome.users.apps.InstallType",
          value: {appInstallType: "FORCED"}
      },
        updateMask: {paths: "appInstallType"}
    }
  ]
}
'
```
#### Response
```
{}
```

## Block an extension from a specific Organizational Unit
Modify multiple policy values that are applied to a specific org unit. Method: [customers.policies.orgunits.batchModify](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policies.orgunits/batchModify)
#### Request
```
curl --location --request POST 'https://chromepolicy.googleapis.com/v1/customers/my_customer/policies/orgunits:batchModify' \
--header 'Authorization: Bearer ' \
--header 'Content-Type: application/json' \
--data-raw '
{
  "requests": [
    {
      "policyTargetKey": {
        "targetResource": "orgunits/03ph8a2z4jbpnn4",
        "additionalTargetKeys": {
          "app_id": "chrome:aapbdbdomjkkjkaonfhkkikfgjllcleb"
        }
      },
      policyValue: {
          policySchema: "chrome.users.apps.InstallType",
          value: {appInstallType: "BLOCKED"}
      },
        updateMask: {paths: "appInstallType"}
    }
  ]
}
'
```
#### Response
```
{}
```

## Batch update extensions in a specific Organizational Unit
Modify multiple policy values that are applied to a specific org unit. Method: [customers.policies.orgunits.batchModify](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policies.orgunits/batchModify)
#### Request
```
curl --location --request POST 'https://chromepolicy.googleapis.com/v1/customers/my_customer/policies/orgunits:batchModify' \
--header 'Authorization: Bearer ' \
--header 'Content-Type: application/json' \
--data-raw '{
  "requests": [
    {
      "policyTargetKey": {
        "targetResource": "orgunits/03ph8a2z4jbpnn4",
        "additionalTargetKeys": {
          "app_id": "chrome:jfbnmfgkohlfclfnplnlenbalpppohkm"
        }
      },
      "policyValue": {
          "policySchema": "chrome.users.apps.InstallType",
          "value": {"appInstallType": "ALLOWED"}
      },
        "updateMask": {"paths": "appInstallType"}
    },
    {
      "policyTargetKey": {
        "targetResource": "orgunits/03ph8a2z4jbpnn4",
        "additionalTargetKeys": {
          "app_id": "chrome:lpcaedmchfhocbbapmcbpinfpgnhiddi"
        }
      },
      "policyValue": {
          "policySchema": "chrome.users.apps.InstallType",
          "value": {"appInstallType": "FORCED"}
      },
        "updateMask": {"paths": "appInstallType"}
    },
    {
      "policyTargetKey": {
        "targetResource": "orgunits/03ph8a2z4jbpnn4",
        "additionalTargetKeys": {
          "app_id": "chrome:oocalimimngaihdkbihfgmpkcpnmlaoa"
        }
      },
      "policyValue": {
          "policySchema": "chrome.users.apps.InstallType",
          "value": {"appInstallType": "BLOCKED"}
      },
        "updateMask": {"paths": "appInstallType"}
    }
  ]
}
'
```
#### Response
```
{}
```

## Deleting an extension
Deleting an app must be done at the Organizational Unit at which the app was explicitly added for management. Method: [customers.policies.orgunits.batchModify](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policies.orgunits/batchModify)
#### Request
```
curl --location --request POST 'https://chromepolicy.googleapis.com/v1/customers/my_customer/policies/orgunits:batchInherit' \
--header 'Authorization: Bearer ' \
--header 'Content-Type: application/json' \
--data-raw '{
        requests: [
            {
                policyTargetKey: {
                        targetResource: "orgunits/03ph8a2z4jbpnn4",
                        additionalTargetKeys: {"app_id": "chrome:aapbdbdomjkkjkaonfhkkikfgjllcleb"}
                        },
                policySchema: "chrome.users.apps.*",
            }
        ]
}'
```
#### Response
```
{}
```

## Get Extension installation policy for an app in an Organizational Unit
To get a policy for a specific app, you must specify both the policy and App Id in the request.
#### Request
```
curl --location --request POST 'https://chromepolicy.googleapis.com/v1/customers/my_customer/policies:resolve' \
--header 'Authorization: Bearer ' \
--header 'Content-Type: application/json' \
--data-raw '{
        policyTargetKey: {
          targetResource: "orgunits/03ph8a2z4jbpnn4",
          additionalTargetKeys: {"app_id": "chrome:aapbdbdomjkkjkaonfhkkikfgjllcleb"}
        },
        policySchemaFilter: "chrome.users.apps.InstallType"
}'
```
#### Response
```
{
    "resolvedPolicies": [
        {
            "targetKey": {
                "targetResource": "orgunits/03ph8a2z4jbpnn4",
                "additionalTargetKeys": {
                    "app_id": "chrome:aapbdbdomjkkjkaonfhkkikfgjllcleb"
                }
            },
            "value": {
                "policySchema": "chrome.users.apps.InstallType",
                "value": {
                    "appInstallType": "ALLOWED"
                }
            },
            "sourceKey": {
                "targetResource": "orgunits/03ph8a2z4jbpnn4"
            },
            "addedSourceKey": {
                "targetResource": "orgunits/03ph8a2z4jbpnn4"
            }
        }
    ]
}
```

## Get App installation policy for all apps in an Organizational Unit
A request for the value of the InstallType policy for all apps under that OU.
#### Request
```
curl --location --request POST 'https://chromepolicy.googleapis.com/v1/customers/my_customer/policies:resolve' \
--header 'Authorization: Bearer ' \
--header 'Content-Type: application/json' \
--data-raw '{
        policyTargetKey: {
          targetResource: "orgunits/03ph8a2z4jbpnn4"
        },
        policySchemaFilter: "chrome.users.apps.InstallType"
}'
```
#### Response
```
{
  "resolvedPolicies": [
        {
            "targetKey": {
                "targetResource": "orgunits/03ph8a2z4jbpnn4",
                "additionalTargetKeys": {
                    "app_id": "chrome:aapbdbdomjkkjkaonfhkkikfgjllcleb"
                }
            },
            "value": {
                "policySchema": "chrome.users.apps.InstallType",
                "value": {
                    "appInstallType": "ALLOWED"
                }
            },
            "sourceKey": {
                "targetResource": "orgunits/03ph8a2z4jbpnn4"
            },
            "addedSourceKey": {
                "targetResource": "orgunits/03ph8a2z4jbpnn4"
            }
        },
        {
            "targetKey": {
                "targetResource": "orgunits/03ph8a2z4jbpnn4",
                "additionalTargetKeys": {
                    "app_id": "chrome:jfbnmfgkohlfclfnplnlenbalpppohkm"
                }
            },
            "value": {
                "policySchema": "chrome.users.apps.InstallType",
                "value": {
                    "appInstallType": "ALLOWED"
                }
            },
            "sourceKey": {
                "targetResource": "orgunits/03ph8a2z4jbpnn4"
            },
            "addedSourceKey": {}
        },
    ...
  ]
}
```

## List all policies for an extension in an Organizational Unit
Get all policies for a single app by using a wildcard in the policy. In this example, we are getting the values of all policies for the Hoxx VPN Proxy
extension.
#### Request
```
curl --location --request POST 'https://chromepolicy.googleapis.com/v1/customers/my_customer/policies:resolve' \
--header 'Authorization: Bearer ' \
--header 'Content-Type: application/json' \
--data-raw '{
        policyTargetKey: {
          targetResource: "orgunits/03ph8a2z4jbpnn4",
          additionalTargetKeys: {"app_id": "chrome:nbcojefnccbanplpoffopkoepjmhgdgh"}
        },
        policySchemaFilter: "chrome.users.apps.*"
}'
```
#### Response
```
{
    "resolvedPolicies": [
        {
            "targetKey": {
                "targetResource": "orgunits/03ph8a2z4jbpnn4",
                "additionalTargetKeys": {
                    "app_id": "chrome:nbcojefnccbanplpoffopkoepjmhgdgh"
                }
            },
            "value": {
                "policySchema": "chrome.users.apps.InstallType",
                "value": {
                    "appInstallType": "BLOCKED"
                }
            },
            "sourceKey": {
                "targetResource": "orgunits/03ph8a2z4jbpnn4"
            },
            "addedSourceKey": {
                "targetResource": "orgunits/03ph8a2z4jbpnn4"
            }
        }
    ]
}
```

## List all policies for all extensions in an Organizational Unit
The App Id can be omitted and a wildcard can be used in the policy in order to request all app settings for all extensions under an OU.
#### Request
```
curl --location --request POST 'https://chromepolicy.googleapis.com/v1/customers/my_customer/policies:resolve' \
--header 'Authorization: Bearer ' \
--header 'Content-Type: application/json' \
--data-raw '{
        policyTargetKey: {
          targetResource: "orgunits/03ph8a2z4jbpnn4"
        },
        policySchemaFilter: "chrome.users.apps.*"
}'
```
#### Response
```
{
    "resolvedPolicies": [
        {
            "targetKey": {
                "targetResource": "orgunits/03ph8a2z4jbpnn4",
                "additionalTargetKeys": {
                    "app_id": "chrome:aapbdbdomjkkjkaonfhkkikfgjllcleb"
                }
            },
            "value": {
                "policySchema": "chrome.users.apps.InstallType",
                "value": {
                    "appInstallType": "ALLOWED"
                }
            },
            "sourceKey": {
                "targetResource": "orgunits/03ph8a2z4jbpnn4"
            },
            "addedSourceKey": {
                "targetResource": "orgunits/03ph8a2z4jbpnn4"
            }
        },
        {
            "targetKey": {
                "targetResource": "orgunits/03ph8a2z4jbpnn4",
                "additionalTargetKeys": {
                    "app_id": "chrome:jfbnmfgkohlfclfnplnlenbalpppohkm"
                }
            },
            "value": {
                "policySchema": "chrome.users.apps.InstallType",
                "value": {
                    "appInstallType": "ALLOWED"
                }
            },
            "sourceKey": {
                "targetResource": "orgunits/03ph8a2z4jbpnn4"
            },
            "addedSourceKey": {}
        },
        ...
    ]
}
```
