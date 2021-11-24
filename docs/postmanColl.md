# Postman Collections
Create a new Workspace. You can name it what ever you like. Import the Collections.

# Collections

## [App Details API](/postman/App%20Details%20API.postman_collection.json)
> Get a specific app by its resource name
> > Description: Get detailed information about a given Chrome extension. 
> > Reference: [customers.apps.chrome.get ](https://developers.google.com/chrome/management/reference/rest/v1/customers.apps.chrome/get)
>
> Get Extension Workflow Request Count
> > Description: Get summary of extension requests.
> > Reference: [customers.apps.countChromeAppRequests](https://developers.google.com/chrome/management/reference/rest/v1/customers.apps/countChromeAppRequests)

## [Chrome Browser Cloud Management API](/postman/Chrome%20Browser%20Cloud%20Management%20API.postman_collection.json)
> Find browser by machine name and org unit path
> > Description: Retrieve browser properties by machine name and OU name.
> > Reference: [Retrieve a Chrome browser Device](https://support.google.com/chrome/a/answer/9681204#retrieve_a_chrome_browser_device)
>
> Retrieve a Chrome browser Device
> > Description: Retrieve browser  properties by device id. 
> > Reference: [Retrieve a Chrome browser Device](https://support.google.com/chrome/a/answer/9681204#retrieve_a_chrome_browser_device)
>
> Find browser by machine name
> > Description: Retrieve browser  properties by machine name. 
> > Reference: [Retrieve a Chrome browser Device](https://support.google.com/chrome/a/answer/9681204#retrieve_a_chrome_browser_device)
>
> Find browsers by org unit path
> > Description: Retrieve all browsers in an OU. 
> > Reference: [Retrieve a Chrome browser Device](https://support.google.com/chrome/a/answer/9681204#retrieve_a_chrome_browser_device)
>
> Retrieve Chrome browsers where the Device ID is shared by multiple machines
> > Description: Retrieve all browsers that has device id collision. 
> > Reference: [Retrieve a Chrome browser Device](https://support.google.com/chrome/a/answer/9681204#retrieve_a_chrome_browser_device)
>
> Retrieve Chrome browser remote commands
> > Description: NA
> > Reference: NA
> 
> Update a Chrome browser Device
> > Description: update the annotated fields of a Chrome browser. 
> > Reference: [Update a Chrome browser Device](https://support.google.com/chrome/a/answer/9681204#update_a_chrome_browser_device)
> 
> Move a Chrome browser Device between Organization Units
> > Description: Move one or more enrolled browser between OUs. 
> > Reference: [### Move a Chrome browser Device between Organization Units](https://support.google.com/chrome/a/answer/9681204#move_a_chrome_browser_device_between_organization_units)
> 
> Delete a Chrome browser Device
> > Description: Delete an enrolled Chrome browser. 
> > Reference: [Delete a Chrome Browser Device](https://support.google.com/chrome/a/answer/9681204#delete_a_chrome_browser_device)

## [Chrome Management Reports API](/postman/Chrome%20Management%20Reports%20API.postman_collection.json)
> Generate report of all installed Chrome versions
> > Description: Generate report of all installed Chrome versions.
> > Reference: [countChromeVersions](https://developers.google.com/chrome/management/reference/rest/v1/customers.reports/countChromeVersions)
>
> Generate report of installed Chrome versions by organizational unit
> > Description: Generate report of installed Chrome versions by organizational unit.
> > Reference: [countChromeVersions](https://developers.google.com/chrome/management/reference/rest/v1/customers.reports/countChromeVersions)
>
> Generate report to find devices that have an app installed
> > Description: Generate report to find devices that have an app installed.
> > Reference: [countInstalledApps](https://developers.google.com/chrome/management/reference/rest/v1/customers.reports/countInstalledApps)
>
> Generate report of app installations by organizational unit
> > Description: Generate report of app installations by organizational unit.
> > Reference: [countInstalledApps](https://developers.google.com/chrome/management/reference/rest/v1/customers.reports/countInstalledApps)
>
> Generate report of devices that have a specified app installed
> > Description: Generate report of devices that have a specified app installed.
> > Reference: [findInstalledAppDevices](https://developers.google.com/chrome/management/reference/rest/v1/customers.reports/countInstalledApps)

## [Chrome Policy API](/postman/Chrome%20Policy%20API.postman_collection.json)
> Get a list of policy schemas
> > Description: Gets a list of policy schemas that match an optional filter value.
> > Reference: [List schemas](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policySchemas/list)
>
> Get a policy schema by filter
> > Description: Gets a list of policy schema.
> > Reference: [Get schema](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policySchemas/get)
> 
> Get or list policies for an Organizational Unit
> > Description: Gets the resolved policy values for a list of policies that match a search query.
> > Reference: [Get or list policies for an Organizational Unit](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policies/resolve)
> 
> Modify a policy in an Organizational Unit
> > Description: Modify a policy value that are applied to a specific org unit.
> > Reference: [Modify policies in an Organizational Unit](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policies.orgunits/batchModify)
> 
> Modify multiple policies at once in an Organizational Unit
> > Description: Modify multiple policy values that are applied to a specific org unit.
> > Reference: [Modify policies in an Organizational Unit](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policies.orgunits/batchModify)
> 
> Inherit policies in an Organizational Unit
> > Description: Modify multiple policy values that are applied to a specific org unit so that they now inherit the value from a parent (if applicable).
> > Reference: [Inherit policies in an Organizational Unit](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policies.orgunits/batchInherit)
> 
> Force install an app in a specific Organizational Unit
> > Description: Force install an app in a specific Organizational Unit.
> > Reference: [Modify policies in an Organizational Unit](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policies.orgunits/batchModify)
> 
> Allow install an app in a specific Organizational Unit
> > Description: Allow install an app in a specific Organizational Unit.
> > Reference: [Modify policies in an Organizational Unit](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policies.orgunits/batchModify)
> 
> Allow install an app in a specific Organizational Unit
> > Description: Deleting an app must be done at the Organizational Unit at which the app was installed. 
> > Reference: [Inherit policies in an Organizational Unit](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policies.orgunits/batchInherit)
> 
> Get App installation policy for an app in an Organizational Unit
> > Description: Get extension install policy by extension id and OU.
> > Reference: [Get or list policies for an Organizational Unit](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policies/resolve)
>
> Get App installation policy for all apps in an Organizational Unit
> > Description: Get extension install policy by OU.
> > Reference: [Get or list policies for an Organizational Unit](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policies/resolve)
>
> List all policies for an app in an Organizational Unit
> > Description: Get extension policy by extension id and OU.
> > Reference: [Get or list policies for an Organizational Unit](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policies/resolve)
>
> List all policies for all apps in an Organizational Unit
> > Description: Get all extension policies by OU.
> > Reference: [Get or list policies for an Organizational Unit](https://developers.google.com/chrome/policy/reference/rest/v1/customers.policies/resolve)

## [Directory API](/postman/Directory%20API.postman_collection.json)
> Retrieves all organizational units
> > Description: Retrieves a list of all organizational units .
> > Reference: [orgunits.list](https://developers.google.com/admin-sdk/directory/reference/rest/v1/orgunits/list)
>
> Retrieve an organizational unit
> > Description: Retrieves an organizational unit.
> > Reference: [orgunits.get](https://developers.google.com/admin-sdk/directory/reference/rest/v1/orgunits/get)
>
> Retrieve all or children organizational units
> > Description: Retrieves child organizational unit(s).
> > Reference: [orgunits.list](https://developers.google.com/admin-sdk/directory/reference/rest/v1/orgunits/list)
>
> Delete an organizational unit
> > Description: Removes an organizational unit.
> > Reference: [orgunits.delete](https://developers.google.com/admin-sdk/directory/reference/rest/v1/orgunits/delete)
>
> Update an organizational unit
> > Description: Updates an organizational unit.
> > Reference: [orgunits.update](https://developers.google.com/admin-sdk/directory/reference/rest/v1/orgunits/update)
>
> Create an organizational unit
> > Description: Adds an organizational unit.
> > Reference: [orgunits.insert](https://developers.google.com/admin-sdk/directory/reference/rest/v1/orgunits/insert)

## [Enrollment Token API](/postman/Enrollment%20Token%20API.postman_collection.json)
> List all enrollment tokens for an account
> > Description: Retrieves all enrollment tokens.
> > Reference: [Use the Chrome Browser Enrollment Token API](https://support.google.com/chrome/a/answer/9949706?hl=en&ref_topic=9301744)
>
> Get enrollment token by specific organization unit
> > Description: Retrieve enrollment token by specific organization unit.
> > Reference: [Use the Chrome Browser Enrollment Token API](https://support.google.com/chrome/a/answer/9949706?hl=en&ref_topic=9301744)
>
> Create an enrollment token
> > Description: Create an enrollment token.
> > Reference: [Use the Chrome Browser Enrollment Token API](https://support.google.com/chrome/a/answer/9949706?hl=en&ref_topic=9301744)
>
> Revoke an enrollment token
> > Description: Revoke an enrollment token.
> > Reference: [Use the Chrome Browser Enrollment Token API](https://support.google.com/chrome/a/answer/9949706?hl=en&ref_topic=9301744)

## Google Service Account
> Javascript sample to get OAuth token using a Service Account.

## [Reports API](/postman/Reports%20API.postman_collection.json)
> Retrieve all administrative activities
> > Description: Retrieve a report of all Admin console changes for a specific event name done by a specific administrator.
> > Reference: [Retrieve all activities by event and administrator](https://developers.google.com/admin-sdk/reports/v1/guides/manage-audit-admin#get_admin_event)
> 
> Retrieve all activities by event name
> > Description: Retrieve a report of all activities for a specific event name.
> > Reference: [Retrieve all activities by event name](https://developers.google.com/admin-sdk/reports/v1/guides/manage-audit-admin#get_all_events)
>
> Retrieve all authorization token events for a domain
> > Description: Retrieve all authorization events for third party applications.
> > Reference: [Retrieve all authorization token events for a domain](https://developers.google.com/admin-sdk/reports/v1/guides/manage-audit-tokens#retrieve_all_authorization_token_events_for_a_domain)

## [Version History API](/postman/VersionHistory%20API.postman_collection.json)
> List all releases for Windows (64bit) in the stable channel
> > Description: List all releases for Windows (64bit) in the stable channel.
> > Reference: [VersionHistory API referencer](https://developer.chrome.com/docs/versionhistory/reference/)
>
> List all releases for Windows (64bit) in the extended stable channel
> > Description: List all releases for Windows (64bit) in the extended stable channel.
> > Reference: [VersionHistory API referencer](https://developer.chrome.com/docs/versionhistory/reference/)
> 
> List all releases for Mac in the stable channel
> > Description: List all releases for Mac in the stable channel.
> > Reference: [VersionHistory API referencer](https://developer.chrome.com/docs/versionhistory/reference/)
