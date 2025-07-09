:: This script will unenroll the Chrome browser from Chrome Browser Cloud Mgmt (CBCM) console by removing the :
:: CloudManagementEnrollmentToken
:: Device token
:: Note: You must delete the enrolled browser from CBCM in the Google Admin Console.
:: Use adminstrator mode when running this script in command prompt.

:: Remove CloudManagementEnrollmentToken
reg delete "HKLM\SOFTWARE\Policies\Google\Chrome" /v "CloudManagementEnrollmentToken" /f

:: Remove Device token
reg delete "HKLM\SOFTWARE\Google\Chrome\Enrollment" /f
reg delete "HKLM\SOFTWARE\WOW6432Node\Google\Enrollment" /f

::Delete the directory where Google Update writes cached cloud policies
rmdir /s /q "C:\Program Files (x86)\Google\Policies"
