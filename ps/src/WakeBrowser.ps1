#print enrollment token
#Get-ItemProperty -Path HKLM:\SOFTWARE\Policies\Google\Chrome -Name "CloudManagementEnrollmentToken"

# Execute As System. Launch chrome browser as system in a temp data dir.
Write-Output "Launch the browser"
Invoke-Command -ScriptBlock { 
    # set chrome user data dir.
    $chromeUserDataDir = "c:/temp3/cbcmLauncher"
    #Write-Output $chromeUserDataDir

    # set a name for the chrome profile.
    $chromeProfile = "cbcmProfile"
    #Write-Output $chromeProfile

    $chromepaths = $chromeUserDataDir, $chromeUserDataDir + "\" + $chromeProfile

    # construct the chrome arg list.
    $chromeArgList =  "--user-data-dir=""" + $chromeUserDataDir + """ --profile-directory=""" + $chromeProfile + """"
    #Write-Output $chromeArgList
    Start-Process "chrome.exe" -ArgumentList $chromeArgList 
} 

Start-Sleep -Seconds 45

# Execute As System - Find chrome processes running as system and stop the process.
Write-Output "Stop the browser"
Invoke-Command -ScriptBlock { 
    Get-Process -Name chrome -IncludeUserName | Where UserName -match system | Stop-Process -Force
} 

# wait for the chrome processes to stop.
Start-Sleep -Seconds 15

# clean up chrome user data dir.
Write-Output "Clean up work"
$chromeUserDataDir = "c:/temp3"
if (Test-Path -Path $chromeUserDataDir) {
    Remove-Item $chromeUserDataDir -Recurse
}
