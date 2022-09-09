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
    $scopes = New-Object -TypeName System.Collections.Generic.List[string]
    $scopes.Add(https://www.googleapis.com/auth/admin.directory.device.chromebrowsers)
 
    $googleCred = [Google.Apis.Auth.OAuth2.GoogleCredential]::FromFile($JsonFilePath)
    $googleCred = $googleCred.CreateScoped($scopes)
 
    $token = ([Google.Apis.Auth.OAuth2.ITokenAccess]$googleCred).GetAccessTokenForRequestAsync().GetAwaiter().GetResult()
 
    return $token
}
