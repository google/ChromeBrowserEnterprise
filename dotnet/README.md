# CBCM-CSharp (C#)
cbcm-csharp is a C# .NET Framework solution written to demonstrate the use of CBCM APIs.  You can use it to learn, create, and solve complex use cases through automation and integration.

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
  "Agurment": "5" "OU ID" "Install Policy (ALLOWED, BLOCKED, FORCED)" "extensions ID csv file",
  "Usage": cbcmapp.exe 5 "03phkw8rsq" "BLOCKED" "C:/Temp/BatchUploadExtensions.csv",
  "Output": "BatchUploadExtensionsToOu.txt"
}
```
