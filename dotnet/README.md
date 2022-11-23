# CBCM-CSharp (C#)
cbcm-csharp is a [C#](https://docs.microsoft.com/en-us/dotnet/csharp/) .NET Framework solution written to demonstrate the use of CBCM APIs.  You can use it to learn, create, and solve complex use cases through automation and integration.

## Building the site :building_construction:
You will need a recent version of [Visual Studio](https://visualstudio.microsoft.com/).

### config
Before buidling the solution, remember to modify the app.config file.
```xml
  "account_key_file": "Service Account Key File.json",
  "customer_id": "Customer ID. You can find by navigating to your Google Admin Console instance > Account > Account Settings.",
  "adminUserToImpersonate": "If you configured domain wide delegation (DwD), then you will have to provide admin/delegated admin account name."
```

## CBCM App :computer:
After you build the solution, you can run cbcmApp.exe from the Windows command prompt using various arguments.

### Get All Organizational Units (OU)
```
{
  "Argument": 2,
  "Usage": "cbcmapp.exe 2",
  "Output": "CBCM_DirectoryOrgUnit.csv"
}
```
### Find enrolled browsers with missing data (profile, extensions, and policies)
```
{
  "Argument": 3,
  "Usage": "cbcmapp.exe 3",
  "Output": "CBCM_BrowsersWithMissingData.csv"
}
```
### Find browsers installed on the user's app data folder. Applies to Windows OS platform only
```
{
  "Argument": 4,
  "Usage": "cbcmapp.exe 4",
  "Output": "CBCM_BrowserDevicesInstalledOnUserAppDataFolder.csv"
}
```
### Bulk upload extension IDs to an OU with install policy
```
{
  "Argument": "5" "OU ID" "Install Policy (ALLOWED, BLOCKED, FORCED)" "extensions ID csv/txt file",
  "Usage": cbcmapp.exe 5 "03phkw8rsq" "BLOCKED" "C:/Temp/BatchUploadExtensions.[csv|txt]",
  "Output": "BatchUploadExtensionsToOu.txt"
}
```
### Move Chrome browser Devices between Organization Units
```
{
  "Argument": "6" "OU Path" "machine names csvtxt file"
  "Usage": cbcmapp.exe 6 "/APAC/Tokyo" ""C:/Temp/MoveDevices.[csv|txt]"
  "Output": "moveChromeBrowsersToOu.txt"
}
```
### Backup policies for an Organizational Unit (OU)
```
{
  "Argument": "20" "OU ID"
  "Usage": cbcmapp.exe 20 "03phkw8rsq"
  "Output": "policybackup.json"
}
```
### Get all enrolled browser data with an optional argument to query by orgnizational unit (demo purpose)
:exclamation: Note: the recommended approach  is to fast-write to a data store. In this sample code it writes to the local disk.
{deviceId,machineName,orgUnitPath,lastDeviceUser,lastActivityTime,serialNumber,osPlatform,osArchitecture,osVersion,policyCount,machinePolicies,extensionCount,extensionId,extensionName}
```
{
  "Argument": "100" "OU Path"
  "Usage": cbcmapp.exe 100 "/APAC/Tokyo"
  "Usage": cbcmapp.exe 100
  "Output": "all-enrolled-browser-data.csv"
}
```
### Get basic enrolled browser data with an optional argument to query by orgnizational unit. 
Output columns {deviceId,machineName,orgUnitPath,lastDeviceUser,lastActivityTime,serialNumber,osPlatform,osArchitecture,osVersion,policyCount,extensionCount}
```
{
  "Argument": "101" "OU Path"
  "Usage": cbcmapp.exe 101 "/APAC/Tokyo"
  "Output": "all-enrolled-browser-data.csv"
}
```

### Extensions & Risk Assessment 
#### Download extensions installed in your enterprise with 3rd party risk scores from [CRXcavator](https://crxcavator.io/) and [Spin.ai](https://spin.ai/platform/google-workspace/apps-security/)
```
{
  "Argument": "300" OU ID (optional)
  "Usage": cbcmapp.exe 300 03phkw8rsq
  "Output": "ExtensionRiskSignals_[OU ID].csv"
}
```
Output
```
appId,displayName,version,crxcavatorRiskScore,crxcavatorRiskUrl,spinRiskScore,spinRiskUrl,browserDeviceCount,appInstallType
felcaaldnbdncclmgdcncolpebgiejap,"Sheets",1.2,7,https://crxcavator.io/report/felcaaldnbdncclmgdcncolpebgiejap/1.2,91,https://apps.spin.ai/app?appId=293df632-514f-11ed-81c5-c597d456c319,1,NORMAL
pjkljhegncpnkpknbcohdijeoejaedia,"Gmail",8.3,13,https://crxcavator.io/report/pjkljhegncpnkpknbcohdijeoejaedia/8.3,92,https://apps.spin.ai/app?appId=29bb2324-514f-11ed-81c5-c597d456c319,1,NORMAL
apdfllckaahabafndbhieahigkjlhalf,"Google Drive",14.5,37,https://crxcavator.io/report/apdfllckaahabafndbhieahigkjlhalf/14.5,75,https://apps.spin.ai/app?appId=2a3713d1-514f-11ed-81c5-c597d456c319,1,NORMAL
ghbmnnjooekpmoecnnnilnnbdlolhkhi,"Google Docs Offline",1.50.1,389,https://crxcavator.io/report/ghbmnnjooekpmoecnnnilnnbdlolhkhi/1.50.1,82,https://apps.spin.ai/app?appId=b5480949-4a9b-4d89-9d86-cf207e032a0e,1,SIDELOAD
aohghmighlieiainnegkcijnfilokake,"Docs",0.10,7,https://crxcavator.io/report/aohghmighlieiainnegkcijnfilokake/0.10,91,https://apps.spin.ai/app?appId=2a396105-514f-11ed-81c5-c597d456c319,1,NORMAL
blpcfgokakmgnkcojhhkbfbldkacnbeo,"YouTube",4.2.8,9,https://crxcavator.io/report/blpcfgokakmgnkcojhhkbfbldkacnbeo/4.2.8,88,https://apps.spin.ai/app?appId=28f559f6-514f-11ed-81c5-c597d456c319,1,NORMAL

```

#### Download  3rd party risk scores from [CRXcavator](https://crxcavator.io/) and [Spin.ai](https://spin.ai/platform/google-workspace/apps-security/) for {extension,version} input data
```
{
  "Argument": "301" file path
  "Usage": cbcmapp.exe 301 extensionsignalimport.txt
  "Output": "ExtensionRiskSignals_FromImport.csv"
}
```
Input
```
aapbdbdomjkkjkaonfhkkikfgjllcleb
blipmdconlkpinefehnmjammfjpmpbjk
mclkkofklkfljcocdinagocijmpgbhab,10.2.0.2
lpcaedmchfhocbbapmcbpinfpgnhiddi, 4.22452.1312.1
ldipcbpaocekfooobnbcddclnhejkcpn , 3.2
hkgfoiooedgoejojocmhlaklaeopbecg,1.11
```
Output
```
appId,version,crxcavatorRiskScore,spinRiskScore
aapbdbdomjkkjkaonfhkkikfgjllcleb,2.0.9,crx:406,spinai:
blipmdconlkpinefehnmjammfjpmpbjk,100.0.0.0,crx:405,spinai:77
mclkkofklkfljcocdinagocijmpgbhab,10.2.0.2,crx:435,spinai:76
lpcaedmchfhocbbapmcbpinfpgnhiddi,4.22452.1312.1,crx:450,spinai:81
ldipcbpaocekfooobnbcddclnhejkcpn,3.2,crx:396,spinai:75
hkgfoiooedgoejojocmhlaklaeopbecg,1.11,crx:388,spinai:76
```

### Inactive Browser
#### Find browsers in an Organizational Unit (OU) where the last activity date is between given start and end days (format yyyy-MM-dd)
```
{
  "Argument": "800"  "OU Path" "Start date" "End date"
  "Usage sample 1": cbcmapp.exe 800  "/North America/Algonquin" "2022-01-01" "2022-04-01"
  "Usage sample 2": cbcmapp.exe 800  "" "2022-01-01" "2022-04-01"
  "Output": "CBCM_BrowsersFilteredByLastActivityDate.csv"
}
```
#### Delete inactive browser in an Organizational Unit (OU) where the last activity date is between given start and end days (format yyyy-MM-dd)
```
{
  "Argument": "890"  "OU Path" "Start date" "End date"
  "Usage sample 1": cbcmapp.exe 890  "/North America/Algonquin" "2022-01-01" "2022-04-01"
  "Usage sample 2": cbcmapp.exe 890  "" "2022-01-01" "2022-04-01"
  "Output": none
}
```
### Delete Enrolled Browser
#### Delete enrolled browsers from the admin console. Input file must contain a comma-separated list of machine names.
```
{
  "Argument": "990" "machine names csv file"
  "Usage": cbcmapp.exe 990 "C:/Temp/deleteBrowsers.csv"
  "Output": "deleteChromeBrowsers.csv"
}
```
#### Delete enrolled browsers from the admin console. Input file must contain a comma-separated list of deviceIds.
```
{
  "Argument": "991" "deviceId csv file"
  "Usage": cbcmapp.exe 991 "C:/Temp/deleteBrowsers.csv"
  "Output": "deleteChromeBrowsers.csv"
}
```
