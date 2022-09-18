# Enrollment Token API 
The [Enrollment Token API](https://developers.google.com/admin-sdk/reports/v1/get-start/overview) is a RESTful API you can use to access information about the Chrome browser enrollment token.
- Postman collection: [Enrollment Token API.postman_collection.json](https://github.com/google/ChromeBrowserEnterprise/blob/main/postman/Enrollment%20Token%20API.postman_collection.json)
- Scope: https://www.googleapis.com/auth/admin.directory.device.chromebrowsers

## List all enrollment tokens for an account
To retrieve a report of all administrative activities done for an account, use the following GET HTTP request and include the authorization token.
#### Request
```
GET https://www.googleapis.com/admin/directory/v1.1beta1/customer/my_customer/chrome/enrollmentTokens?orgUnitPath=&pageToken&pageSize=100&query
```
#### Response
```
{
    "kind": "admin#directory#chromeEnrollmentTokens",
    "chromeEnrollmentTokens": [
        {
            "tokenPermanentId": "50a2573a-923c-4eac-b7f9-49a78e346684",
            "kind": "admin#directory#chromeEnrollmentToken",
            "token": "9e4e1468-e978-494e-9dd7-531b83ba1bee",
            "customerId": "033fmrgf",
            "orgUnitPath": "/AlexTest/FictionalCo",
            "state": "active",
            "createTime": "2022-08-23T14:08:38Z",
            "creatorId": "108572335719235898846",
            "tokenType": "chromeBrowser"
        },
        {
            "tokenPermanentId": "dc0087b9-8d32-46ff-bf9a-3d0966ead680",
            "kind": "admin#directory#chromeEnrollmentToken",
            "token": "ed61a74f-9040-458e-b799-4e4ac9120aef",
            "customerId": "033fmrgf",
            "orgUnitPath": "/AlexTest/FictionalCo/Test",
            "state": "active",
            "createTime": "2022-08-15T17:37:46Z",
            "creatorId": "108572335719235898846",
            "tokenType": "chromeBrowser"
        },
        ...
    ]
}
```

## List all enrollment tokens for an account
To retrieve a report of all administrative activities done for an account, use the following GET HTTP request and include the authorization token.
#### Request
```
GET https://www.googleapis.com/admin/directory/v1.1beta1/customer/my_customer/chrome/enrollmentTokens?orgUnitPath=&pageToken&pageSize=100&query
```
#### Response
```
{
    "kind": "admin#directory#chromeEnrollmentTokens",
    "chromeEnrollmentTokens": [
        {
            "tokenPermanentId": "50a2573a-923c-4eac-b7f9-49a78e346684",
            "kind": "admin#directory#chromeEnrollmentToken",
            "token": "9e4e1468-e978-494e-9dd7-531b83ba1bee",
            "customerId": "033fmrgf",
            "orgUnitPath": "/AlexTest/FictionalCo",
            "state": "active",
            "createTime": "2022-08-23T14:08:38Z",
            "creatorId": "108572335719235898846",
            "tokenType": "chromeBrowser"
        },
        {
            "tokenPermanentId": "dc0087b9-8d32-46ff-bf9a-3d0966ead680",
            "kind": "admin#directory#chromeEnrollmentToken",
            "token": "ed61a74f-9040-458e-b799-4e4ac9120aef",
            "customerId": "033fmrgf",
            "orgUnitPath": "/AlexTest/FictionalCo/Test",
            "state": "active",
            "createTime": "2022-08-15T17:37:46Z",
            "creatorId": "108572335719235898846",
            "tokenType": "chromeBrowser"
        },
        ...
    ]
}
```

## Create an enrollment token

#### Request
```
curl --location --request POST 'https://www.googleapis.com/admin/directory/v1.1beta1/customer/my_customer/chrome/enrollmentTokens' \
--header 'Authorization: Bearer ' \
--header 'Content-Type: application/json' \
--data-raw '{
  "token_type": "CHROME_BROWSER",
  "org_unit_path": "/UX/Research/Research_support"
}'
```
#### Response
```
{
    "tokenPermanentId": "77dc2a5a-ebec-44c1-bcee-84c09bb7312e",
    "kind": "admin#directory#chromeEnrollmentToken",
    "token": "33d20f0f-4d1e-4fa3-a39a-105e4b01c41b",
    "customerId": "033fmrgf",
    "orgUnitPath": "/UX/Research/Research_support",
    "state": "active",
    "createTime": "2022-09-18T21:08:18Z",
    "creatorId": "113456549147281770764",
    "tokenType": "chromeBrowser"
}
```

## Revoke an enrollment token
To revoke an enrollment token, use the following POST request and include the token Permanent Id
#### Request
```
curl --location --request POST 'https://www.googleapis.com/admin/directory/v1.1beta1/customer/my_customer/chrome/enrollmentTokens/77dc2a5a-ebec-44c1-bcee-84c09bb7312e:revoke' \
--header 'Authorization: Bearer '
```
#### Response
```

```

