#Define Variables
$scriptFolder = Split-Path ($MyInvocation.MyCommand.Path) -Parent

#Configure NuGet and then download required libraries
if (Get-PackageProvider -Name NuGet) {
    Copy-WriteToLog -logString "NuGet is installed"
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



#/******* Unenrolling a browser from CBCM *******/
function Clear-EnrolledBrowser
{
    param (
        [Parameter(Mandatory)] [string]$CustomerId,

        [Parameter(Mandatory)] [string]$MachineName,
        
        [Parameter(Mandatory)] [string]$SecretFile
    )

    $response = ""

    try
    {    
        $authToken = Get-GoogleToken -SecretFile $SecretFile

        $bearerToken = [string]::Format(“Bearer {0}”, $authToken)

        $deviceId = Get-EnrolledBrowser -Token $bearerToken -CustomerId $CustomerId -MachineName $MachineName

        $headers = New-Object "System.Collections.Generic.Dictionary[[String],[String]]"
        $headers.Add("Authorization", [string]::Format(“{0}”, $bearerToken))

        [string]$requestURL = [string]::Format(“https://www.googleapis.com/admin/directory/v1.1beta1/customer/{0}/devices/chromebrowsers/{1}”,$CustomerId, $deviceId)

        $response = Invoke-RestMethod $requestURL -Method 'DELETE' -Headers $headers
        $response | ConvertTo-Json

        Copy-WriteToLog -logString $response.ToString()
    }
    catch
    {
        Copy-WriteToLog -logString  $_.Exception.GetType().FullName + "::" + $_.Exception.Message
    }

    return $response
}

#/******* Get the device Id from the enrolled browser *******/
function Get-EnrolledBrowser 
{ 
    param (
        [Parameter(Mandatory)] [Object[]]$Token,

        [Parameter(Mandatory)] [string]$CustomerId,

        [Parameter(Mandatory)] [string]$MachineName
    )
    $deviceId = ""
    try
    {

        $headers = New-Object "System.Collections.Generic.Dictionary[[String],[String]]"
        $headers.Add("Authorization", [string]::Format(“{0}”, $Token))
        [string]$requestURL = [string]::Format(“https://www.googleapis.com/admin/directory/v1.1beta1/customer/{0}/devices/chromebrowsers?query=machine_name:{1}&projection=BASIC”,$CustomerId, $MachineName)

        $response = Invoke-RestMethod $requestURL -Method 'GET' -Headers $headers

        $deviceId = $response.browsers[0].deviceId
        Copy-WriteToLog -logString "The device ID is $($deviceId)"
    }
    catch
    {
        Copy-WriteToLog -logString  $_.Exception.Message
    }

    return $deviceId

}
   
   
#/******* Get Auth Token *******/
function Get-GoogleToken
{
    param (
        [Parameter(Mandatory)] [string]$SecretFile
    )
    $token = ''
    try
    {
        $JsonFilePath = $SecretFile
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

    $logfile =  $scriptFolder + "\" + "UnenrollBrowser.txt"
    $stamp = (Get-Date).toString("yyyy/MM/dd HH:mm:ss")
    $logMessage = "$stamp $logString"
    Add-content $logfile -value $logMessage
}

#/******* Test registry value  *******/
Function Test-RegistryValue ($regkey, $name) {
     if (Get-ItemProperty -Path $regkey -Name $name -ErrorAction Ignore) {
         return $true
     } else {
         return $false
     }
 }


#/******* BEGIN: Customer to modify this section *******/
$customerId = ''
$machineName = $env:computername
$secretFile = ''
#/******* END: Customer to modify this section *******/

#/******* BEGIN: remove browser from CBCM *******/
Clear-EnrolledBrowser -CustomerId $customerId -MachineName $machineName -SecretFile $secretFile
#/******* END: remove browser from CBCM *******/

#/******* BEGIN: cbcm data from local device *******/

#CloudManagementEnrollmentToken
if ((Test-RegistryValue 'HKLM:\SOFTWARE\Policies\Google\Chrome', 'CloudManagementEnrollmentToken'))
{
    Remove-ItemProperty –Path 'HKLM:\SOFTWARE\Policies\Google\Chrome' –Name 'CloudManagementEnrollmentToken'
    Copy-WriteToLog -logString "CloudManagementEnrollmentToken deleted"
}

#device management token from regular hive
if ((Test-RegistryValue 'HKLM:\SOFTWARE\Google\Chrome\Enrollment' 'dmtoken'))
{
    Remove-Item 'HKLM:\SOFTWARE\Google\Chrome\Enrollment'
    Copy-WriteToLog -logString "dmtoken deleted from regular hive"
}

#device management token from WOW6432Node hive
if ((Test-RegistryValue 'HKLM:\SOFTWARE\WOW6432Node\Google\Enrollment' 'dmtoken'))
{
    Remove-Item 'HKLM:\SOFTWARE\WOW6432Node\Google\Enrollment'
    Copy-WriteToLog -logString "dmtoken deleted from WOW6432Node hive"
}

#/******* END: cbcm data from local device *******/
