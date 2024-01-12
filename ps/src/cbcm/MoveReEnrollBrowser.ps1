#/******* Start: Move browsers between OUs using the CBCM enrollment token *******/
#The value of this policy is an enrollment token you can retrieve from the Google Admin console.
$enrollmentToken = ''

#/******* Write to a local log fle  *******/
function Copy-WriteToLog
{
    Param (
        [string]$logString
    )

    $logfile =  $scriptFolder + "\" + "MoveReEnrollBrowser_log.txt"
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

$GoogleChromeRegistryPath = 'HKLM:\SOFTWARE\Policies\Google\Chrome'
#The enrollment token of cloud policy
$keyName = 'CloudManagementEnrollmentToken'

#chrome browser cloud enrollment token  
if ((Test-RegistryValue $GoogleChromeRegistryPath 'CloudManagementEnrollmentToken'))
{
    Set-ItemProperty -Path $GoogleChromeRegistryPath -Name $keyName -Value $enrollmentToken
    Copy-WriteToLog -logString "Cloud Management Enrollment Token Updated"
}

$dmTokenInRegularHive = 'HKLM:\SOFTWARE\Google\Chrome\Enrollment'

#device management token from regular hive
if ((Test-RegistryValue $dmTokenInRegularHive 'dmtoken'))
{
    Remove-Item $dmTokenInRegularHive
    Copy-WriteToLog -logString "dmtoken deleted from regular hive"
}

$dmTokenInWOWHive = 'HKLM:\SOFTWARE\WOW6432Node\Google\Enrollment'

#device management token from WOW6432Node hive
if ((Test-RegistryValue $dmTokenInWOWHive  'dmtoken'))
{
    Remove-Item $dmTokenInWOWHive 
    Copy-WriteToLog -logString "dmtoken deleted from WOW6432Node hive"
}


#/******* END: Move browsers between OUs using the CBCM enrollment token *******/