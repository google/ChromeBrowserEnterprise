# Execute As System. Launch chrome browser as system in a temp data dir.
Write-Output "Launch the browser"

# set chrome user data dir.
$chromeUserDataDir = "c:/temp/ChromeLauncherProfile"
#Write-Output $chromeUserDataDir

# set a name for the chrome profile.
$chromeProfile = "CECProfile"
#Write-Output $chromeProfile

$chromepaths = $chromeUserDataDir, $chromeUserDataDir + "\" + $chromeProfile

# construct the chrome arg list.
$chromeArgList =  "--user-data-dir=""" + $chromeUserDataDir + """ --profile-directory=""" + $chromeProfile + """"
#Write-Output $chromeArgList
Start-Process "chrome.exe" -ArgumentList $chromeArgList 

Start-Sleep -Seconds 45

# Execute As System - Find chrome processes running as system and stop the process.
Write-Output "Stop the browser"

Get-Process -Name chrome -IncludeUserName | Where UserName -match system | Stop-Process -Force

# wait for the chrome processes to stop.
Start-Sleep -Seconds 15

# clean up chrome user data dir.
Write-Output "Clean up work"

if (Test-Path -Path $chromeUserDataDir) {
    # Folder exists, so delete it and its contents
    Remove-Item -Path $chromeUserDataDir -Recurse -Force
    Write-Host "Folder '$chromeUserDataDir' and its contents have been deleted."
}
