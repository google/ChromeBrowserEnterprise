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

#/******* BEGIN: Customer to modify this section *******/
$customerId = ''
$machineName = $env:computername
$secretFile = ''
$org_unit_path = ''
#/******* END: Customer to modify this section *******/


#/******* Unenrolling a browser from CBCM *******/
function Set-EnrolledBrowser
{
    param (
        [Parameter(Mandatory)] [string]$CustomerId,

        [Parameter(Mandatory)] [string]$MachineName,
        
        [Parameter(Mandatory)] [string]$SecretFile,

        [Parameter(Mandatory)] [string]$OrgUnitPath
    )

    $response = ""

    try
    {
        $qualified = Get-IsWindowsLTSC
        
        if (-Not $qualified) {
            return "Does not qualify."
        }
            
        $authToken = Get-GoogleToken -SecretFile $SecretFile

        $bearerToken = [string]::Format(“Bearer {0}”, $authToken)

        $deviceId = Get-EnrolledBrowser -Token $bearerToken -CustomerId $CustomerId -MachineName $MachineName

        $headers = New-Object "System.Collections.Generic.Dictionary[[String],[String]]"
        $headers.Add("Authorization", [string]::Format(“{0}”, $bearerToken))
        $headers.Add("Content-Type", "application/json")

        $body = "{`"org_unit_path`":`"$OrgUnitPath`",`"resource_ids`":[`"$deviceId`"]}"

        [string]$requestURL = [string]::Format(“https://www.googleapis.com/admin/directory/v1.1beta1/customer/{0}/devices/chromebrowsers/moveChromeBrowsersToOu”,$CustomerId)

        $response = Invoke-RestMethod $requestURL -Method 'POST' -Headers $headers -Body $body
        $response | ConvertTo-Json

        Copy-WriteToLog -logString $response.ToString()
    }
    catch [System.Net.WebException] {
        Copy-WriteToLog -logString  $_.Exception + "\r\n" +  ($_.Exception.Response.StatusCode.value__ ).ToString().Trim() + "\r\n" + ($_.Exception.Message).ToString().Trim() + "\r\n" + ($_.Exception.TargetSite).ToString().Trim()
    } catch {
        Copy-WriteToLog -logString  $_.Exception
    }


    return $response
}

#/******* What version of Windows am I running? *******/
function Get-IsWindowsLTSC
{
    # get OS name information. Ref: https://learn.microsoft.com/en-us/windows/client-management/windows-version-search
    $osName = systeminfo | findstr /B /C:"OS Name" /B 

    if (($osName -like "*LTSB*") -or ($osName -like "*LTSC*")){ 
        return $true
    }

    return $false
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

    $logfile =  $scriptFolder + "\" + "MoveBrowser.txt"
    $stamp = (Get-Date).toString("yyyy/MM/dd HH:mm:ss")
    $logMessage = "$stamp $logString"
    Add-content $logfile -value $logMessage
}


#/******* BEGIN: main *******/
Set-EnrolledBrowser -CustomerId $customerId -MachineName $machineName -SecretFile $secretFile -OrgUnitPath $org_unit_path
#/******* END: rmain *******/
