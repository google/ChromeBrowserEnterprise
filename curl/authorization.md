Create OAuth2.0 Client IDs and configure the OAuth concent screen. Refer to [Using OAuth 2.0 to Access Google APIs](https://developers.google.com/identity/protocols/oauth2).

#### Get the Authorization code from the OAuth 2.0 Playground
Navigate to the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/). Use the settings button to configure OAuth 2.0 configuration
<img width="359" alt="oAuth_Playground_Settings" src="https://user-images.githubusercontent.com/92223536/171961005-1647feaf-4493-4b5d-8f88-8ba5de8416fa.PNG">

Add [scope to authorize](/../main/docs/auth.md). Click on "Exchnage authorization code for tokens" button found in Step 2. Don't forget to consent the request. You will need the resulting Authorization code, Refresh token, and Access token.

Request using curl

```
curl -s --request POST --data "client_id=[CLIENT ID]&client_secret=[CLIENT SECRET]&refresh_token=[REFRESH TOKEN]&grant_type=refresh_token" https://accounts.google.com/o/oauth2/token
```

Response

```json
{
  "access_token": "ya29.some_hash_value",
  "expires_in": 3599,
  "scope": "https://www.googleapis.com/auth/admin.directory.device.chromebrowsers.readonly",
  "token_type": "Bearer"
}
```
