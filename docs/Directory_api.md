# Directory API
The [Directory API](https://developers.google.com/admin-sdk/directory) is used to create and manage resources attached to your Google domain, such as users, org charts, and groups.
- Postman collection: [Directory API.postman_collection.json](https://github.com/google/ChromeBrowserEnterprise/blob/main/postman/Directory%20API.postman_collection.json)
- Scope: https://www.googleapis.com/auth/admin.directory.orgunit

## Retrieves all organizational units
Retrieves a [list](https://developers.google.com/admin-sdk/directory/reference/rest/v1/orgunits/list) of all organizational units for an account.
#### Request
```
GET https://www.googleapis.com/admin/directory/v1/customer/my_customer/orgunits?type=ALL&maxResults=1&pageToken
```
#### Response
```
{
    "kind": "admin#directory#orgUnits",
    "etag": "\"7dD2lEGw_cSWElgnmooDH6C54E0q2uifMqS1m-4dUqU/7fLPaFivzUt-IwJ16r-To7s2daU\"",
    "organizationUnits": [
        {
            "kind": "admin#directory#orgUnit",
            "etag": "\"7dD2lEGw_cSWElgnmooDH6C54E0q2uifMqS1m-4dUqU/mzVAzGt4X7LTuMjT4MDeg-x-Dl0\"",
            "name": "Seattle",
            "description": "Seattle Office",
            "orgUnitPath": "/North America/Seattle",
            "orgUnitId": "id:03ph8a2z496ipdk",
            "parentOrgUnitPath": "/North America",
            "parentOrgUnitId": "id:03ph8a2z1v3xa3o"
        },
        {
            "kind": "admin#directory#orgUnit",
            "etag": "\"7dD2lEGw_cSWElgnmooDH6C54E0q2uifMqS1m-4dUqU/jU8l7HvmxKEYE1tPO6852LN52WI\"",
            "name": "Sydney",
            "description": "Sydney Office",
            "orgUnitPath": "/APAC/Sydney",
            "orgUnitId": "id:03ph8a2z2awn3mc",
            "parentOrgUnitPath": "/APAC",
            "parentOrgUnitId": "id:03ph8a2z0vl7zj4"
        },
        ...
    ]
}
```

## Retrieve an organizational unit
Retrieves [an organizational unit](https://developers.google.com/admin-sdk/directory/reference/rest/v1/orgunits/get).
#### Request
```
GET https://www.googleapis.com/admin/directory/v1/customer/my_customer/orgunits/North America/Austin
```
#### Response
```
{
    "kind": "admin#directory#orgUnit",
    "etag": "\"7dD2lEGw_cSWElgnmooDH6C54E0q2uifMqS1m-4dUqU/oGdJG7Et1xmNUR5VdTTYF5MjflM\"",
    "name": "Austin",
    "description": "Austin Office",
    "orgUnitPath": "/North America/Austin",
    "orgUnitId": "id:03ph8a2z4jbpnn4",
    "parentOrgUnitPath": "/North America",
    "parentOrgUnitId": "id:03ph8a2z1v3xa3o"
}
```

## Retrieve all child organizational units

#### Request
```
GET https://www.googleapis.com/admin/directory/v1/customer/my_customer/orgunits/?orgUnitPath=North America&type=all
```
#### Response
```
{
    "kind": "admin#directory#orgUnits",
    "etag": "\"7dD2lEGw_cSWElgnmooDH6C54E0q2uifMqS1m-4dUqU/WUDXpc9TJxyJ3Qap_CccFJsCz8k\"",
    "organizationUnits": [
        {
            "kind": "admin#directory#orgUnit",
            "etag": "\"7dD2lEGw_cSWElgnmooDH6C54E0q2uifMqS1m-4dUqU/mzVAzGt4X7LTuMjT4MDeg-x-Dl0\"",
            "name": "Seattle",
            "description": "Seattle Office",
            "orgUnitPath": "/North America/Seattle",
            "orgUnitId": "id:03ph8a2z496ipdk",
            "parentOrgUnitPath": "/North America",
            "parentOrgUnitId": "id:03ph8a2z1v3xa3o"
        },
        {
            "kind": "admin#directory#orgUnit",
            "etag": "\"7dD2lEGw_cSWElgnmooDH6C54E0q2uifMqS1m-4dUqU/h2j9vXveK_uWIphIPmBwj8fRXNY\"",
            "name": "New York",
            "description": "New York Office",
            "orgUnitPath": "/North America/New York",
            "orgUnitId": "id:03ph8a2z1604z3y",
            "parentOrgUnitPath": "/North America",
            "parentOrgUnitId": "id:03ph8a2z1v3xa3o"
        },
        ...
       ]
}
```

## Delete an organizational unit
[Removes](https://developers.google.com/admin-sdk/directory/reference/rest/v1/orgunits/delete) an organizational unit.
#### Request
```
curl --location --request DELETE 'https://www.googleapis.com/admin/directory/v1/customer/my_customer/orgunits/UX/Research/Research_support' \
--header 'Authorization: Bearer '
```
#### Response
```

```

## Update an organizational unit
[Updates](https://developers.google.com/admin-sdk/directory/reference/rest/v1/orgunits/update) an organizational unit.
#### Request
```
curl --location --request PUT 'https://www.googleapis.com/admin/directory/v1/customer/my_customer/orgunits/UX/Research/Research_support' \
--header 'Authorization: Bearer ' \
--header 'Content-Type: application/json' \
--data-raw '{
    "description": "Where is Algonquin"
}'
```
#### Response
```

```

## Create an organizational unit
[Adds](https://developers.google.com/admin-sdk/directory/reference/rest/v1/orgunits/insert) an organizational unit.
#### Request
```
curl --location --request POST 'https://admin.googleapis.com/admin/directory/v1/customer/my_customer/orgunits' \
--header 'Authorization: Bearer ' \
--header 'Content-Type: application/json' \
--data-raw '{
    "name": "Research_support",
    "description": "The research support team",
    "parentOrgUnitPath": "/UX/Research",
    "blockInheritance": false
}'
```
#### Response
```

```
