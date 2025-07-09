#Define Variables
$scriptFolder = Split-Path ($MyInvocation.MyCommand.Path) -Parent
 

#Add Types for Google APIs

Add-Type -Path "$scriptFolder\Newtonsoft.Json.dll"

Add-Type -Path "$scriptFolder\Google.Apis.Core.dll"

Add-Type -Path "$scriptFolder\Google.Apis.Auth.dll"

Add-Type -Path "$scriptFolder\Google.Apis.dll"

Add-Type -Path "$scriptFolder\Google.Apis.ChromeManagement.v1.dll"

Add-Type -Path "$scriptFolder\Google.Apis.Auth.PlatformServices.dll"

 

function Get-GoogleToken
{
        #Set private key start/end tags
        $GooglePrivateKey = "-----BEGIN PRIVATE KEY-----\n$($GooglePrivateKey)\n-----END PRIVATE KEY-----\n"
 
        #Build json for authorization certificate
        $jsonFile = @{ }
        $jsonFile.Add("type", "service_account")
        $jsonFile.Add("project_id", $GoogleProjectID)
        $jsonFile.Add("private_key_id", $GooglePrivateID)
        $jsonFile.Add("private_key", $GooglePrivateKey)
        $jsonFile.Add("client_email", $GoogleClienteMail)
        $jsonFile.Add("client_id", $GoogleClientID)
        $jsonFile.Add("auth_uri", https://accounts.google.com/o/oauth2/auth)
        $jsonFile.Add("token_uri", https://oauth2.googleapis.com/token)
        $jsonFile.Add("auth_provider_x509_cert_url", https://www.googleapis.com/oauth2/v1/certs)
        $jsonFile.Add("client_x509_cert_url", https://www.googleapis.com/robot/v1/metadata/x509/$($GoogleClienteMail.Replace('@','%40')))
        
        #Convert to json and fix
        $jsonCert = $jsonFile | ConvertTo-Json
        $jsonCert = $jsonCert.Replace(\\n, "\n")
        
        #Add necessary scopes
        $scopes = New-Object -TypeName System.Collections.Generic.List[string]
        $scopes.Add(https://www.googleapis.com/auth/admin.directory.device.chromebrowsers)
        
        #Create the credential and get token
        $googleCred = [Google.Apis.Auth.OAuth2.GoogleCredential]::FromJson($jsonCert)
        $googleCred = $googleCred.CreateScoped($scopes)
        $token = ([Google.Apis.Auth.OAuth2.ITokenAccess]$googleCred).GetAccessTokenForRequestAsync().GetAwaiter().GetResult()
        
        return $token
}
