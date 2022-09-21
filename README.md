# cbe-rest-api

Use the [Chrome Browser Enterprise (CBE)](https://support.google.com/chrome/a/topic/9025410?hl=en&ref_topic=4386754) REST API to manage the Chrome browser in your orgnization. 

## Documentation
* [Getting Started with Chrome Browser Cloud Management and Postman](https://services.google.com/fh/files/misc/chrome_browser_cloud_management_postman_api_integration.pdf)
* [Scopes](docs/auth.md)
* APIs
  * [App Details API](https://github.com/google/ChromeBrowserEnterprise/blob/main/docs/App_Details_api.md)
  * [Chrome Browser Cloud Management API](https://github.com/google/ChromeBrowserEnterprise/blob/main/docs/CBCM_api.md)
  * [Chrome Management Reports API](https://github.com/google/ChromeBrowserEnterprise/blob/main/docs/Chrome_Management_Reports_api.md)
  * [Chrome Policy API](https://github.com/google/ChromeBrowserEnterprise/blob/main/docs/Chrome_Policy_api.md)
  * [Directory API](https://github.com/google/ChromeBrowserEnterprise/blob/main/docs/Directory_api.md)
  * [Enrollment Token API](https://github.com/google/ChromeBrowserEnterprise/blob/main/docs/Enrollment_Token_api.md)
  * [Reports API](https://github.com/google/ChromeBrowserEnterprise/blob/main/docs/Reports_api.md)
* C#
  * [CBCM-CSharp](https://github.com/google/ChromeBrowserEnterprise/tree/main/dotnet) - a console based app that utilizes above mentioned APIs to perform various use-cases.
* [Postman Collections](https://github.com/google/ChromeBrowserEnterprise/tree/main/postman) - postman collection - requests that utilizes the above mentioned APIs.
* PowerShell 
  * [Random Scripts](https://github.com/google/ChromeBrowserEnterprise/tree/main/ps/src) - scripts to wake the browser and force browser to update.
  * [Random CBCM Scripts](https://github.com/google/ChromeBrowserEnterprise/tree/main/ps/src/cbcm) - script to add the enrollment token to the device and launch the browesr (complete the enrollment process).


## Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License
See [LICENSE](LICENSE) for details.
