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

### Extensions
#### Download extensions installed in your enterprise with 3rd party risk scores from [CRXcavator](https://crxcavator.io/) and [Spin.ai](https://spin.ai/platform/google-workspace/apps-security/)
```
{
  "Argument": "300" OU ID (optional)
  "Usage": cbcmapp.exe 300 03phkw8rsq
  "Output": "ExtensionRiskSignals_[OU ID].csv"
}
```
Sample output

![Sample Results](../../../blob/main/docs/ExtensionRiskSignals_FromOU.PNG)

#### Download  3rd party risk scores from [CRXcavator](https://crxcavator.io/) and [Spin.ai](https://spin.ai/platform/google-workspace/apps-security/) for {extension,version} input data
```
{
  "Argument": "301" file path
  "Usage": cbcmapp.exe 301 extensionsignalimport.txt
  "Output": "ExtensionRiskSignals_FromImport.csv"
}
```
Sample input
```
aapbdbdomjkkjkaonfhkkikfgjllcleb
blipmdconlkpinefehnmjammfjpmpbjk
mclkkofklkfljcocdinagocijmpgbhab,10.2.0.2
lpcaedmchfhocbbapmcbpinfpgnhiddi, 4.22452.1312.1
ldipcbpaocekfooobnbcddclnhejkcpn , 3.2
hkgfoiooedgoejojocmhlaklaeopbecg,1.11
```
Sample output

![Sample Results](../../../blob/main/docs/ExtensionRiskSignals_FromImport.PNG)

### Generate report to find devices that have extension(s) installed
```
{
  "Argument": 302 extension Id
  "Argument": 303 file containing extension Ids.txt
  "Usage": 302 mefhakmgclhhfbdadeojlkbllmecialg
  "Usage": 303 findinstalledAppDevices.txt
  "Output": CSV file containing appId,deviceId,machine
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
#### Move inactive browsers to an OU
```
{
  "Argument": "810"  "Source OU Path" "Destination OU Path" The number of days to specify (as a positive number) to determine the inactive date.
  "Usage": 810 "North America/Austin/AUS Managed Browser" "North America/Austin/AUS Inactive Browsers" 1394
  "Output": "MoveInactiveBrowsers.txt"
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
