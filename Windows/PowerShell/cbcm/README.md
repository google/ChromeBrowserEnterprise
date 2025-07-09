# Random CBCM Scripts
## Enroll the browser
Consider using the [Add Enrollment Token then Register script](AddEnrollmentTokenThenRegister.ps1) to set the [CloudManagementEnrollmentToken](https://chromeenterprise.google/policies/#CloudManagementEnrollmentToken) to register the browser with Chrome Browser Cloud Management (CBCM). In order to complete the registration process, the script should run under the System context.

**Note:** Insert the enrollment token from the Google Admin console in [line](AddEnrollmentTokenThenRegister.ps1#L9) before running the script.

```
.\AddEnrollmentTokenThenRegister.ps1
```

## Move browsers between OU using enrollment token 
Consider using the [Move Re-enroll Browser script](MoveReEnrollBrowser.ps1) to move enrolled browsers between OUs based on the enrollment token. In order to update registry settings, the script should run under the System context. 

This feature is only available via an allowlist - please contaact your Chrome Browser Enterprise team to add your domain to the allowlist. 

**Note:** Insert the enrollment token from the Google Admin console in [line](MoveReEnrollBrowser.ps1#L3) before running the script.

```
.\MoveReEnrollBrowser.ps1
```

## Unenroll the browser
Consider using the [Unenroll Browser script](UnenrollBrowser.ps1) to unenroll a browser from CBCM and delete the CloudManagementEnrollmentToken and device management token from the device. Unenrolling devices from CBCM also deletes the already uploaded data to the Admin console. Platform policies and cloud-based user policies are not affected.

**Note:** You will need to add the customer ID and the OAuth key JSON file to the script to allow an API call to delete an enrolled browser. Run the script from devices that should be unenrolled. 

 :point_right: Add the customer id [here](https://github.com/google/ChromeBrowserEnterprise/blob/main/ps/src/cbcm/UnenrollBrowser.ps1#L159). You can find the customer Id by navigating to the  [Google Admin Console](https://admin.google.com)  > Account > Account Settings. 
 
 :point_right: Add the path to the OAuth client secret file [here](https://github.com/google/ChromeBrowserEnterprise/blob/main/ps/src/cbcm/UnenrollBrowser.ps1#L161). You can download the file from the [Google Developer Console](https://console.developers.google.com/apis/api/admin.googleapis.com/overview?project=_)


```
.\UnenrollBrowser.ps1
```

## Move Chrome browsers between Organization Units
Consider using the [Move enrolled browser by Windows OS Name](MoveEnrolledBrowserByWindowsOSName.ps1) to move enrolled browser between Organization Units (OU). The script performs the move if the Windows OS is qualifies as [Long-Term Servicing Channel (LTSC, formerly LTSB)](https://learn.microsoft.com/en-us/windows/client-management/windows-version-search). However, you can change the qualification rule(s) to fit your business needs.

**Note:** You will need to add the customer ID, the service account key JSON file, and the destination OU path to the script. 

 :point_right: Add the customer id [here](https://github.com/google/ChromeBrowserEnterprise/blob/main/ps/src/cbcm/MoveEnrolledBrowserByWindowsOSName.ps1#L33). You can find the customer Id by navigating to the  [Google Admin Console](https://admin.google.com)  > Account > Account Settings. 
 
 :point_right: Add the path to the OAuth client secret file [here]((https://github.com/google/ChromeBrowserEnterprise/blob/main/ps/src/cbcm/MoveEnrolledBrowserByWindowsOSName.ps1#L48)). You can download the file from the [Google Developer Console](https://console.developers.google.com/apis/api/admin.googleapis.com/overview?project=_)
 
  :point_right: Add the destination [OU path](https://github.com/google/ChromeBrowserEnterprise/blob/main/ps/src/cbcm/MoveEnrolledBrowserByWindowsOSName.ps1#L50). An example of the  destination OU path 'North America/Austin/AUS Managed User'


```
.\MoveEnrolledBrowserByWindowsOSName.ps1
```

