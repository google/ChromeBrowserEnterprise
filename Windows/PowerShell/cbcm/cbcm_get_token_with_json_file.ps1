#Define Variables
$scriptFolder = Split-Path ($MyInvocation.MyCommand.Path) -Parent

#Configure NuGet and then download required libraries
if (Get-PackageProvider -Name NuGet) {
    Copy-WriteToLog -logString "Version of NuGet installed = " + (Get-PackageProvider -Name NuGet).version
}
else {
    register-packagesource -Name NuGet -ProviderName NuGet -location https://www.nuget.org/api/v2/
}

#https://www.nuget.org/packages/Newtonsoft.Json/13.0.1
Install-Package Newtonsoft.Json -Destination $scriptFolder -Force -Source 'https://www.nuget.org/api/v2' -ProviderName NuGet -RequiredVersion '13.0.1' -SkipDependencies -ErrorAction SilentlyContinue
#https://www.nuget.org/packages/Google.Apis.Core/1.57.0
Install-Package Google.Apis.Core -Destination $scriptFolder -Force -Source 'https://www.nuget.org/api/v2' -ProviderName NuGet -RequiredVersion '1.57.0' -SkipDependencies -ErrorAction SilentlyContinue
#https://www.nuget.org/packages/Google.Apis/1.57.0
Install-Package Google.Apis -Destination $scriptFolder -Force -Source 'https://www.nuget.org/api/v2' -ProviderName NuGet -RequiredVersion '1.57.0' -SkipDependencies -ErrorAction SilentlyContinue
#https://www.nuget.org/packages/Google.Apis.Auth/1.57.0
Install-Package Google.Apis.Auth -Destination $scriptFolder -Force -Source 'https://www.nuget.org/api/v2' -ProviderName NuGet -RequiredVersion '1.57.0' -SkipDependencies -ErrorAction SilentlyContinue



#/******* Required Add Types for Google APIs *******/
Add-Type -Path "$scriptFolder\Newtonsoft.Json.13.0.1\lib\net45\Newtonsoft.Json.dll"

Add-Type -Path "$scriptFolder\Google.Apis.Core.1.57.0\lib\net45\Google.Apis.Core.dll"

Add-Type -Path "$scriptFolder\Google.Apis.1.57.0\lib\net45\Google.Apis.dll"

Add-Type -Path "$scriptFolder\Google.Apis.Auth.1.57.0\lib\net45\Google.Apis.Auth.dll"

   
   
#/******* Get Auth Token *******/
function Get-GoogleToken
{
    param (
        [Parameter(Mandatory)] [string]$SecretFile
    )
    $token = ''
    try
    {
        $JsonFilePath = $scriptFolder + "\" + $SecretFile
        $scopes = New-Object -TypeName System.Collections.Generic.List[string]
        #add additional scope to the collection
        $scopes.Add('https://www.googleapis.com/auth/admin.directory.device.chromebrowsers')
 
        $googleCred = [Google.Apis.Auth.OAuth2.GoogleCredential]::FromFile($JsonFilePath)
        $googleCred = $googleCred.CreateScoped($scopes)
 
        $token = ([Google.Apis.Auth.OAuth2.ITokenAccess]$googleCred).GetAccessTokenForRequestAsync().GetAwaiter().GetResult()
        Copy-WriteToLog -logString "The token is $($token)"

    }
    catch
    {
        Copy-WriteToLog -logString  $_.Exception.Message
    }
 
    return $token
}

#/******* Write to a local log fle  *******/
function Copy-WriteToLog
{
    Param (
        [string]$logString
    )

    $logfile =  $scriptFolder + "\" + "cbcmLog.txt"
    $stamp = (Get-Date).toString("yyyy/MM/dd HH:mm:ss")
    $logMessage = "$stamp $logString"
    Add-content $logfile -value $logMessage
}


#/******* BEGIN: Customer to modify this section *******/
$secretFile = ''
#/******* END: Customer to modify this section *******/

#/******* BEGIN: Get auth token  *******/
$authToken = Get-GoogleToken -SecretFile $secretFile
