# Random CBCM Scripts
## Enroll the browser
Consider using the [Add Enrollment Token then Register script](https://github.com/google/ChromeBrowserEnterprise/blob/main/ps/src/cbcm/AddEnrollmentTokenThenRegister.ps1) to set the [CloudManagementEnrollmentToken](https://chromeenterprise.google/policies/#CloudManagementEnrollmentToken) to register the browser with Chrome Browser Cloud Management (CBCM). In order to complete the registration process, the script will run the browser silently under the System context. 

**Note:** Insert the enrollment token from the Google Admin console in [line](https://github.com/google/ChromeBrowserEnterprise/blob/main/ps/src/cbcm/AddEnrollmentTokenThenRegister.ps1#L9) before running the script.

Dependency

[Invoke-CommandAs](https://github.com/mkellerman/Invoke-CommandAs). Invoke Command as System/User on Local/Remote computer :ok_hand:.
```
.\AddEnrollmentTokenThenRegister.ps1
```
