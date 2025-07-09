#Requirement - https://github.com/mkellerman/Invoke-CommandAs
Install-Module -Name Invoke-CommandAs -Force

#add enrollment token
Write-Output "enrollment token"
Invoke-CommandAs -ScriptBlock { 
    # policy doc - https://chromeenterprise.google/policies/#CloudManagementEnrollmentToken
    #The value of this policy is an enrollment token you can retrieve from the Google Admin console.
    $enrollmentToken = ''

    #validate Google policy path
    $GoogleRegistryPath = 'HKLM:\SOFTWARE\Policies\Google'
    $test = test-path -path $GoogleRegistryPath

    #create if the required path doesn't exist
    if(-not($test)){
        New-Item -Path $GoogleRegistryPath
    }

    #validate Google/Chrome policy path
    $GoogleChromeRegistryPath = $GoogleRegistryPath + '\Chrome'
    $test = test-path -path $GoogleChromeRegistryPath

    #create if the required path doesn't exist
    if(-not($test)){
        New-Item -Path $GoogleChromeRegistryPath
    }

    #The enrollment token of cloud policy
    $keyName = 'CloudManagementEnrollmentToken'

    $member = (Get-Item $GoogleChromeRegistryPath).Property -contains $keyName

    if( $member ) {
        Set-ItemProperty -Path $GoogleChromeRegistryPath -Name $keyName -Value $enrollmentToken
    }
    else {
        New-ItemProperty -Path $GoogleChromeRegistryPath -Name $keyName -PropertyType String -Value $enrollmentToken
    } 
} -AsSystem

#print enrollment token
#Get-ItemProperty -Path HKLM:\SOFTWARE\Policies\Google\Chrome -Name "CloudManagementEnrollmentToken"

# Execute As System. Launch chrome browser as system in a temp data dir.
Write-Output "Launch the browser"
Invoke-CommandAs -ScriptBlock { 
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
} -AsSystem

Start-Sleep -Seconds 45

# Execute As System - Find chrome processes running as system and stop the process.
Write-Output "Stop the browser"
Invoke-CommandAs -ScriptBlock { 
    Get-Process -Name chrome -IncludeUserName | Where UserName -match system | Stop-Process -Force
} -AsSystem

# wait for the chrome processes to stop.
Start-Sleep -Seconds 15

# clean up chrome user data dir.
Write-Output "Clean up work"
$chromeUserDataDir = "c:/temp3"
if (Test-Path -Path $chromeUserDataDir) {
    Remove-Item $chromeUserDataDir -Recurse
}
