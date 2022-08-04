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
  "Agurment": 2,
  "Usage": "cbcmapp.exe 2",
  "Output": "CBCM_DirectoryOrgUnit.csv"
}
```
### Find enrolled browsers with missing data (profile, extensions, and policies)
```
{
  "Agurment": 3,
  "Usage": "cbcmapp.exe 3",
  "Output": "CBCM_BrowsersWithMissingData.csv"
}
```
### Find browsers installed on the user's app data folder. Applies to Windows OS platform only
```
{
  "Agurment": 4,
  "Usage": "cbcmapp.exe 4",
  "Output": "CBCM_BrowserDevicesInstalledOnUserAppDataFolder.csv"
}
```
### Bulk upload extension IDs to an OU with install policy
```
{
  "Agurment": "5" "OU ID" "Install Policy (ALLOWED, BLOCKED, FORCED)" "extensions ID csv/txt file",
  "Usage": cbcmapp.exe 5 "03phkw8rsq" "BLOCKED" "C:/Temp/BatchUploadExtensions.[csv|txt]",
  "Output": "BatchUploadExtensionsToOu.txt"
}
```
### Move Chrome browser Devices between Organization Units
```
{
  "Agurment": "6" "OU Path" "machine names csvtxt file"
  "Usage": cbcmapp.exe 6 "/APAC/Tokyo" ""C:/Temp/MoveDevices.[csv|txt]"
  "Output": "moveChromeBrowsersToOu.txt"
}
```
### Backup policies for an Organizational Unit (OU)
```
{
  "Agurment": "20" "OU ID"
  "Usage": cbcmapp.exe 20 "03phkw8rsq"
  "Output": "policybackup.json"
}
```
### Get all enrolled browser data with an optional argument to query by orgnizational unit (demo purpose)
:exclamation: Note: the recommended approach  is to fast-write to a data store. In this sample code it writes to the local disk.
{deviceId,machineName,orgUnitPath,lastDeviceUser,lastActivityTime,serialNumber,osPlatform,osArchitecture,osVersion,policyCount,machinePolicies,extensionCount,extensionId,extensionName}
```
{
  "Agurment": "100" "OU Path"
  "Usage": cbcmapp.exe 100 "/APAC/Tokyo"
  "Usage": cbcmapp.exe 100
  "Output": "all-enrolled-browser-data.csv"
}
```
### Get basic enrolled browser data with an optional argument to query by orgnizational unit. Output columns {deviceId,machineName,orgUnitPath,lastDeviceUser,lastActivityTime,serialNumber,osPlatform,osArchitecture,osVersion,policyCount,extensionCount}
```
{
  "Agurment": "101" "OU Path"
  "Usage": cbcmapp.exe 101 "/APAC/Tokyo"
  "Output": "all-enrolled-browser-data.csv"
}
```
### Inactive Browser
#### Find browsers in an Organizational Unit (OU) where the last activity date is between given start and end days (format yyyy-MM-dd)
```
{
  "Agurment": "800"  "OU Path" "Start date" "End date"
  "Usage sample 1": cbcmapp.exe 800  "/North America/Algonquin" "2022-01-01" "2022-04-01"
  "Usage sample 2": cbcmapp.exe 800  "" "2022-01-01" "2022-04-01"
  "Output": "CBCM_BrowsersFilteredByLastActivityDate.csv"
}
```
#### Delete inactive browser in an Organizational Unit (OU) where the last activity date is between given start and end days (format yyyy-MM-dd)
```
{
  "Agurment": "890"  "OU Path" "Start date" "End date"
  "Usage sample 1": cbcmapp.exe 890  "/North America/Algonquin" "2022-01-01" "2022-04-01"
  "Usage sample 2": cbcmapp.exe 890  "" "2022-01-01" "2022-04-01"
  "Output": none
}
```
### Delete Enrolled Browser
#### Delete enrolled browsers from the admin console. Input file must contain a comma-separated list of machine names.
```
{
  "Agurment": "990" "machine names csv file"
  "Usage": cbcmapp.exe 990 "C:/Temp/deleteBrowsers.csv"
  "Output": "deleteChromeBrowsers.csv"
}
```
#### Delete enrolled browsers from the admin console. Input file must contain a comma-separated list of deviceIds.
```
{
  "Agurment": "991" "deviceId csv file"
  "Usage": cbcmapp.exe 991 "C:/Temp/deleteBrowsers.csv"
  "Output": "deleteChromeBrowsers.csv"
}
```
