#Requirement - https://github.com/mkellerman/Invoke-CommandAs
Install-Module -Name Invoke-CommandAs -Force

#TO-DO: add capability to delete device from CBCM console. Also get auth token.
function DeleteEnrolledBrowserFromCBCM {

    param (
        [string]$DeviceId,
        [string]$AuthToken
    )

    $headers = New-Object "System.Collections.Generic.Dictionary[[String],[String]]"
    $headers.Add("Authorization", $AuthToken)
    $serviceUrl = [string]::Format("https://www.googleapis.com/admin/directory/v1.1beta1/customer/my_customer/devices/chromebrowsers/{0}", $DeviceId)

    $response = Invoke-RestMethod $serviceUrl  -Method 'DELETE' -Headers $headers
    $response | ConvertTo-Json
    Write-Output $response

}

#DeleteEnrolledBrowserFromCBCM -DeviceId "f2130b91-a6ae-" -AuthToken "Bearer "

#dmtoken 
$wowNode = "HKLM:\SOFTWARE\WOW6432Node\Google\Enrollment"
$regularNode = "HKLM:\SOFTWARE\Google\Chrome\Enrollment"

#remove dmtoken data.
if (Test-Path -Path $wowNode) {
    Remove-Item $wowNode
    Write-Output "dmtoken deleted from " + $wowNode
}

if (Test-Path -Path $regularNode) {
    Remove-Item $regularNode
    Write-Output "dmtoken deleted from " + $wowNode
}


#print enrollment token
Get-ItemProperty -Path HKLM:\SOFTWARE\Policies\Google\Chrome -Name "CloudManagementEnrollmentToken"

# Execute As System. Launch chrome browser as system in a temp data dir.
Invoke-CommandAs -ScriptBlock { 
    # set chrome user data dir.
    $chromeUserDataDir = "c:/temp3/cbcmLauncher"
    Write-Output $chromeUserDataDir

    # set a name for the chrome profile.
    $chromeProfile = "cbcmProfile"
    Write-Output $chromeProfile

    $chromepaths = $chromeUserDataDir, $chromeUserDataDir + "\" + $chromeProfile

    # construct the chrome arg list.
    $chromeArgList =  "--user-data-dir=""" + $chromeUserDataDir + """ --profile-directory=""" + $chromeProfile + """"
    Write-Output $chromeArgList
    Start-Process "chrome.exe" -ArgumentList $chromeArgList 
} -AsSystem

Start-Sleep -Seconds 45

# Execute As System - Find chrome processes running as system and stop the process.
Invoke-CommandAs -ScriptBlock { 
    Get-Process -Name chrome -IncludeUserName | Where UserName -match system | Stop-Process -Force
} -AsSystem

# wait for the chrome processes to stop.
Start-Sleep -Seconds 15

# clean up chrome user data dir.
$chromeUserDataDir = "c:/temp3"
if (Test-Path -Path $chromeUserDataDir) {
    Remove-Item $chromeUserDataDir -Recurse
}
