# Random CBCM Scripts
## Enroll the browser
Consider using the [Add Enrollment Token then Register script](AddEnrollmentTokenThenRegister.ps1) to set the [CloudManagementEnrollmentToken](https://chromeenterprise.google/policies/#CloudManagementEnrollmentToken) to register the browser with Chrome Browser Cloud Management (CBCM). In order to complete the registration process, the script should run under the System context.

**Note:** Insert the enrollment token from the Google Admin console in [line](AddEnrollmentTokenThenRegister.ps1#L9) before running the script.

```
.\AddEnrollmentTokenThenRegister.ps1
```

## Unenroll the browser
Consider using the [Unenroll Browser script](UnenrollBrowser.ps1) to unenroll a browser from CBCM and delete the CloudManagementEnrollmentToken and device management token from the device. Unenrolling devices from CBCM also deletes the already uploaded data to the Admin console. Platform policies and cloud-based user policies are not affected.

**Note:** You will need to add the customer ID and the OAuth key JSON file to the script to allow an API call to delete an enrolled browser. Run the script from devices that should be unenrolled. 

 :point_right: Add the customer id [here](https://github.com/google/ChromeBrowserEnterprise/blob/main/ps/src/cbcm/UnenrollBrowser.ps1#L159). You can find the customer Id by navigating to the  [Google Admin Console](https://admin.google.com)  > Account > Account Settings. 
 
 :point_right: Add the path to the OAuth client secret file [here](https://github.com/google/ChromeBrowserEnterprise/blob/main/ps/src/cbcm/UnenrollBrowser.ps1#L161). You can download the file from the [Google Developer Console](https://console.developers.google.com/apis/api/admin.googleapis.com/overview?project=_)


```
.\UnenrollBrowser.ps1
```

## Get extension list using Takeout API
Using the [script](extension_query.py) (
[python 2.7 compatible version](extension_query_py2.py)) to download extensions
list from all browsers.

### Setup Access to API

Before using CBCM Takeout API you will need to do some initial setup:

1.  Enable the Admin SDK API (if not already enabled) in the Google Developer
    Console by following this
    [link](https://console.developers.google.com/apis/api/admin.googleapis.com/overview?project=_)
    and selecting the project on which you wish to enable the API.
1.  Create a service account and have the necessary service account keys for
    this service account. You can follow
    [this](https://developers.google.com/admin-sdk/directory/v1/guides/delegation)
    for creating a service account and getting the service account keys. You
    must grant the service account the "Service Account User" role on the
    permissions during creation.
1.  The client ID for this service account will need to be authorized for the
    OAuth scopes listed below in the Admin Console under Security -> Advanced
    settings -> Manage API client access. On this page, the Client ID
    corresponds to the Unique ID of your service account. You will need to
    authorize the client ID for the scope:
    * https://www.googleapis.com/auth/admin.directory.device.chromebrowsers.readonly

### Running the Script


With the service account keys, you can now run the script which uses Google API
Client Libraries to make the necessary queries to the API. The script requires
that both the service account keys you downloaded from the developers console as
well as the e-mail of an admin user in your domain that is allowed to access the
data you wish to query.

You can run the script from the command-line:
```
python extension_query.py --service_account_key_path <service_account_key_file> --admin_email <admin_email>
```
(also: `python extension_query.py --help` for a reminder of the
argument names)

## Example Data output

Here is an example of what that data will look like:
![Sample Results](extension_query_sample.png)
