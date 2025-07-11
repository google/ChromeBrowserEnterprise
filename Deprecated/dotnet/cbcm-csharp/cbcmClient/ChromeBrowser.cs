﻿using System;
using System.Collections.Generic;
using System.Linq;
using System.IO;
using System.Text;
using System.Web;
using RestSharp;
using cbcmSchema.Browserdevices;
using cbcmSchema.BrowserToOU;
using cbcmSchema.Extension;
using System.Data.SqlClient;
using cbcmSchema.OU;
using System.Runtime.InteropServices.ComTypes;
using System.Collections;
using System.Net.Http.Headers;
using cbcmSchema.BrowserAnnotatedField;
using Newtonsoft.Json.Linq;

namespace cbcmClient
{
    public sealed class ChromeBrowser : BaseHelper
    {
        public ChromeBrowser(string keyFile, string customerID) : base(keyFile)
        {
            this.CustomerID = customerID;
        }

        public ChromeBrowser(string keyFile, string customerID, string adminUserToImpersonate) : base(keyFile, adminUserToImpersonate)
        {
            this.CustomerID = customerID;
        }


        [ObsoleteAttribute("This method is obsolete. Call AllBasicEnrolledBrowsersSaveToFile instead.", true)]
        /// <summary>
        /// Get all enrolled browsers - Full projection - with the optional org unit path.
        /// </summary>
        /// <param name="orgUnitPath">The full path of the organizational unit or its unique ID.</param>
        public void GetAllEnrolledBrowsers(string orgUnitPath)
        {

            string nextPageToken = String.Empty;
            BrowserDevices browserDevices = null;
            string content = String.Empty;
            RestClient client;


            string[] scope = { "https://www.googleapis.com/auth/admin.directory.device.chromebrowsers.readonly" };
            string token = this.GetAuthBearerToken(scope);

            string serviceURL = String.Format("https://www.googleapis.com/admin/directory/v1.1beta1/customer/{0}/devices/chromebrowsers?projection=FULL&orderBy=last_activity&sortOrder=DESCENDING&maxResults=100&pageToken="
                   , this.CustomerID);

            if (!String.IsNullOrEmpty(orgUnitPath))
                serviceURL = serviceURL + "&orgUnitPath=" + orgUnitPath;

            /*** Storing results in memory can lead to out of memory exception.
             * Therefore, this hack will append resulting paginated data to file. Consider storging in a database.
             */

            // Create a file to write to.
            using (StreamWriter sw = File.CreateText(String.Format("all-enrolled-browser-data-{0}.json", DateTime.Now.Ticks)))
            {
                do
                {
                    client = new RestClient();
                    client.Timeout = base._timeout;

                    UriBuilder builder = new UriBuilder(serviceURL);
                    var qs = HttpUtility.ParseQueryString(builder.Query);
                    qs.Set("pageToken", nextPageToken);
                    builder.Query = qs.ToString();

                    client.BaseUrl = builder.Uri;

                    var request = new RestRequest(Method.GET);
                    request.AddHeader("Content-Type", "application/json");
                    request.AddHeader("Authorization", String.Format("Bearer {0}", token));
                    IRestResponse response = client.Execute(request);

                    if (response is null)
                    {
                        nextPageToken = String.Empty;
                        continue;
                    }

                    content = response.Content;

                    browserDevices = BrowserDevices.FromJson(content);

                    sw.WriteLine(content);

                    //set next page token
                    nextPageToken = browserDevices.NextPageToken;


                } while (!String.IsNullOrEmpty(nextPageToken));
            }

        }

        /// <summary>
        /// Save all enrolled browsers - Full projection - with the optional org unit path.
        /// </summary>
        /// <param name="orgUnitPath">The full path of the organizational unit or its unique ID.</param>
        /// <param name="projection">Restrict information returned to a set of selected fields.</param>
        /// <param name="fileExt">Valid file extension types are "csv" or "json".</param>
        public void AllBasicEnrolledBrowsersSaveToFile(string orgUnitPath, string projection, string fileExt)
        {
            this.EnrolledBrowsersSaveToFile(string.Empty,
                orgUnitPath,
                projection,
                "machine_name",
                "ASCENDING",
                100,
                String.Compare(fileExt, "json", true)==0 ? "json": "csv");
        }

        /// <summary>
        /// Save all Chrome browser devices to file
        /// https://support.google.com/chrome/a/answer/9681204?hl=en
        /// CSV output file will contain basic info only - deviceId,machineName,orgUnitPath,lastDeviceUser,lastActivityTime,serialNumber,osPlatform,osArchitecture,osVersion
        /// </summary>
        /// <param name="query">Search string using the list page query language</param>
        /// <param name="orgUnitPath">The full path of the organizational unit or its unique ID.</param>
        /// <param name="projection">Restrict information returned to a set of selected fields. "BASIC" - Includes only the basic metadata fields. "FULL" - Includes all metadata fields</param>
        /// <param name="orderBy">Chrome browser device property to use for sorting results</param>
        /// <param name="sortOrder">"ASCENDING" - Ascending order. "DESCENDING" - Descending order.</param>
        /// <param name="maxResults">Maximum number of results to return. Maximum, is 100.</param>
        /// <param name="fileExt">Valid input types "csv" or "json". Default is cvs</param>
        private void EnrolledBrowsersSaveToFile(string query, string orgUnitPath, string projection, string orderBy, string sortOrder, int maxResults, string fileExt)
        {
            string nextPageToken = String.Empty;
            BrowserDevices browserDevices = null;
            string content = String.Empty;
            RestClient client;
            StringBuilder stringBuilder = new StringBuilder();
            string outputFileName = String.Format("all-enrolled-browser-data-{0}.csv", DateTime.Now.Ticks);

            string[] scope = { "https://www.googleapis.com/auth/admin.directory.device.chromebrowsers.readonly" };
            string token = this.GetAuthBearerToken(scope);

            string serviceURL = String.Format("https://www.googleapis.com/admin/directory/v1.1beta1/customer/{0}/devices/chromebrowsers?projection={1}&orderBy={2}&sortOrder={3}&maxResults={4}&pageToken=",
                  this.CustomerID,
                  projection,
                  String.IsNullOrEmpty(orderBy) ? "last_activity" : orderBy,
                  String.IsNullOrEmpty(sortOrder) ? "DESCENDING" : sortOrder,
                  maxResults);

            if (!String.IsNullOrEmpty(query))
                serviceURL = serviceURL + "&query=" + query;

            if (!String.IsNullOrEmpty(orgUnitPath))
                serviceURL = serviceURL + "&orgUnitPath=" + orgUnitPath;

            if (String.Compare(projection, "FULL", true) == 0)
                stringBuilder.AppendLine("deviceId,machineName,orgUnitPath,lastDeviceUser,lastActivityTime,serialNumber,osPlatform,osArchitecture,osVersion,policyCount,machinePolicies,extensionCount,extensionId,extensionName");
            else
                stringBuilder.AppendLine("deviceId,machineName,orgUnitPath,lastDeviceUser,lastActivityTime,serialNumber,osPlatform,osArchitecture,osVersion,policyCount,extensionCount");

            // Create a file to write to.
            using (StreamWriter sw = File.CreateText(outputFileName))
            {
                do
                {
                    client = new RestClient();
                    client.Timeout = base._timeout;

                    UriBuilder builder = new UriBuilder(serviceURL);
                    var qs = HttpUtility.ParseQueryString(builder.Query);
                    qs.Set("pageToken", nextPageToken);
                    builder.Query = qs.ToString();

                    client.BaseUrl = builder.Uri;

                    var request = new RestRequest(Method.GET);
                    request.AddHeader("Content-Type", "application/json");
                    request.AddHeader("Authorization", String.Format("Bearer {0}", token));
                    IRestResponse response = client.Execute(request);

                    if (response is null)
                    {
                        nextPageToken = String.Empty;
                        continue;
                    }

                    content = response.Content;
                    browserDevices = BrowserDevices.FromJson(content);

                    if (browserDevices == null)
                        continue;


                    //set next page token
                    nextPageToken = String.IsNullOrEmpty(browserDevices.NextPageToken) ? String.Empty : browserDevices.NextPageToken;

                    foreach (var browser in browserDevices.Browsers)
                    {
                        

                        if (String.Compare(projection, "FULL", true) == 0)
                        {
                            stringBuilder.AppendLine(String.Format("{0},{1},{2},{3},{4},{5},{6},{7},{8},{9},\"[{10}]\",{11},\"[{12}]\"",
                            browser.DeviceId,                                           //0
                            browser.MachineName,                                        //1
                            browser.OrgUnitPath,                                        //2
                            browser.LastDeviceUser,                                     //3
                            browser.LastActivityTime?.ToString("yyyy-MM-dd hh:mm"),     //4
                            browser.SerialNumber,                                       //5
                            browser.OsPlatform,                                         //6
                            browser.OsArchitecture,                                     //7
                            browser.OsVersion,                                          //8
                            browser.PolicyCount?.ToString(),                            //9
                            this.PrettyPrint(browser.MachinePolicies),                  //10
                            browser.ExtensionCount?.ToString(),                         //11
                            this.PrettyPrint(browser.AllExtensions)                     //12
                            ));
                        }
                        else
                        {
                            stringBuilder.AppendLine(String.Format("{0},{1},{2},{3},{4},{5},{6},{7},{8},{9},{10}",
                            browser.DeviceId,
                            browser.MachineName,
                            browser.OrgUnitPath,
                            browser.LastDeviceUser,
                            browser.LastActivityTime?.ToString("yyyy-MM-dd hh:mm"),
                            browser.SerialNumber,
                            browser.OsPlatform,
                            browser.OsArchitecture,
                            browser.OsVersion,
                            browser.PolicyCount?.ToString(),
                            browser.ExtensionCount?.ToString()
                            ));
                        }

                    }//foreach browser in browserDevices.Browsers
                    sw.Write(stringBuilder.ToString());

                    //clean up work
                    stringBuilder.Clear();
                    browserDevices = null;  //to-do: nextpagetoken is duplicating and isn't easy to reproduce. adding this for safety.

                } while (!String.IsNullOrEmpty(nextPageToken));
            }

        }
        #region Policy Formatter Helper
        private string PrettyPrint(List<Policy> policies)
        {
            if (policies is null)
                return String.Empty;

            StringBuilder sb = new StringBuilder();

            foreach (Policy policy in policies)
            {
                if (policy is null)
                    continue;

                sb.Append(policy.ToString());
            }

            return sb.ToString();
        }

        private string PrettyPrint(List<Extension> extensions)
        {
            if (extensions is null)
                return String.Empty;

            StringBuilder sb = new StringBuilder();

            foreach(Extension extension in extensions)
            {
                sb.Append(String.Format("extensionId:{0};name{1};installType:{2};",
                            extension.ExtensionId,
                            extension.Name,
                            extension.InstallType
                            ));
            }

            return sb.ToString();
        }
        
        #endregion


        /// <summary>
        /// Get all Chrome browser devices. 
        /// https://support.google.com/chrome/a/answer/9681204?hl=en
        /// </summary>
        /// <param name="query">Search string using the list page query language</param>
        /// <param name="orgUnitPath">The full path of the organizational unit or its unique ID.</param>
        /// <param name="projection">Restrict information returned to a set of selected fields. "BASIC" - Includes only the basic metadata fields. "FULL" - Includes all metadata fields</param>
        /// <param name="orderBy">Chrome browser device property to use for sorting results</param>
        /// <param name="sortOrder">"ASCENDING" - Ascending order. "DESCENDING" - Descending order.</param>
        /// <param name="maxResults">Maximum number of results to return. Maximum, is 100.</param>
        /// <returns>Returns a list of Chrome browser devices.</returns>
        /// <exception cref="ApplicationException"></exception>
        public List<BrowserDevicesBrowser> GetEnrolledBrowsers(string query, string orgUnitPath, string projection, string orderBy, string sortOrder, int maxResults)
        {
            return this.GetEnrolledBrowsers(token: String.Empty,
                query: query,
                orgUnitPath: orgUnitPath,
                projection: projection,
                orderBy: orderBy,
                sortOrder: sortOrder,
                maxResults: maxResults);
        }

        /// <summary>
        /// Get Chrome browser devices. 
        /// </summary>
        /// <param name="token">Authentication token</param>
        /// <param name="query">Search string using the list page query language</param>
        /// <param name="orgUnitPath">The full path of the organizational unit or its unique ID.</param>
        /// <param name="projection">Restrict information returned to a set of selected fields. "BASIC" - Includes only the basic metadata fields. "FULL" - Includes all metadata fields</param>
        /// <param name="orderBy">Chrome browser device property to use for sorting results</param>
        /// <param name="sortOrder">"ASCENDING" - Ascending order. "DESCENDING" - Descending order.</param>
        /// <param name="maxResults">Maximum number of results to return. Maximum, is 100.</param>
        /// <returns>Returns a list of Chrome browser devices.</returns>
        /// <exception cref="ApplicationException"></exception>
        internal List<BrowserDevicesBrowser> GetEnrolledBrowsers(string token, string query, string orgUnitPath, string projection, string orderBy, string sortOrder, int maxResults)
        {
            string nextPageToken = String.Empty;
            BrowserDevices browserDevices = null;
            List<BrowserDevicesBrowser> browserList = new List<BrowserDevicesBrowser>();
            string content = String.Empty;
            RestClient client;


            //Get a new token if needed.
            if (String.IsNullOrEmpty(token))
            {
                string[] scope = { "https://www.googleapis.com/auth/admin.directory.device.chromebrowsers.readonly" };
                token = this.GetAuthBearerToken(scope);
            }


            string serviceURL = String.Format("https://www.googleapis.com/admin/directory/v1.1beta1/customer/{0}/devices/chromebrowsers?projection={1}&orderBy={2}&sortOrder={3}&maxResults={4}&pageToken=",
                   this.CustomerID,
                   projection,
                   String.IsNullOrEmpty(orderBy) ? "last_activity" : orderBy,
                   String.IsNullOrEmpty(sortOrder) ? "DESCENDING" : sortOrder,
                   maxResults);

            if (!String.IsNullOrEmpty(query))
                serviceURL = serviceURL + "&query=" + query;

            if (!String.IsNullOrEmpty(orgUnitPath))
                serviceURL = serviceURL + "&orgUnitPath=" + orgUnitPath;

            do
            {
                client = new RestClient();
                client.Timeout = base._timeout;

                UriBuilder builder = new UriBuilder(serviceURL);
                var qs = HttpUtility.ParseQueryString(builder.Query);
                qs.Set("pageToken", nextPageToken);
                builder.Query = qs.ToString();

                client.BaseUrl = builder.Uri;

                var request = new RestRequest(Method.GET);
                request.AddHeader("Content-Type", "application/json");
                request.AddHeader("Authorization", String.Format("Bearer {0}", token));
                IRestResponse response = client.Execute(request);

                if (response is null)
                {
                    nextPageToken = String.Empty;
                    continue;
                }

                content = response.Content;

                browserDevices = BrowserDevices.FromJson(content);

                //set next page token
                nextPageToken = browserDevices.NextPageToken;

                if (browserDevices.Browsers != null)
                    browserList.AddRange(browserDevices.Browsers);


            } while (!String.IsNullOrEmpty(nextPageToken));



            return browserList;
        }


        /// <summary>
        /// Find enrlled browsers that have a shell created in CBCM. These don't have details like Browser profile, extensions, and policies.
        /// </summary>
        public void GetBrowsersWithMissingData()
        {
            List<BrowserDevicesBrowser> browserList = this.GetEnrolledBrowsers(
                String.Empty, String.Empty, "BASIC", "last_activity", "DESCENDING", 100);

            StringBuilder stringBuilder = new StringBuilder();
            //write the header.
            stringBuilder.AppendLine("OrgUnitPath,deviceId,machineName,lastRegisterTimestamp,extensionCount,policyCount");

            foreach (BrowserDevicesBrowser browser in browserList)
            {
                if ((!browser.LastStatusReportTime.HasValue &&
                    !browser.LastPolicyFetchTime.HasValue) &&
                    !browser.LastStatusReportTime.HasValue)
                    stringBuilder.AppendLine(String.Format("{0},{1},{2},{3},{4},{5}",
                        browser.OrgUnitPath, 
                        browser.DeviceId,
                        browser.MachineName,
                        browser.LastRegistrationTime,
                        browser.ExtensionCount.HasValue ? browser.ExtensionCount.Value.ToString() : String.Empty,
                        browser.PolicyCount.HasValue ? browser.PolicyCount.Value.ToString() : String.Empty)
                        );
            }

            base.WriteToFile("CBCM_BrowsersWithMissingData", stringBuilder.ToString());
        }

        public void GetBrowserDevicesInstalledOnUserAppDataFolder()
        {
            List<BrowserDevicesBrowser> browserList = this.GetEnrolledBrowsers(
                "os_platform:Windows",
                String.Empty,
                "FULL",
                "last_activity",
                "DESCENDING",
                100);

            StringBuilder stringBuilder = new StringBuilder();
            //write the header.
            stringBuilder.AppendLine("OrgUnitPath,deviceId,machineName,executablePath,channel,browserVersion,lastActivityTime");

            foreach (BrowserDevicesBrowser browserDevice in browserList)
            {
                foreach (BrowserBrowser browser in browserDevice.Browsers)
                {
                    if (!String.IsNullOrEmpty(browser.ExecutablePath) && browser.ExecutablePath.Contains("users"))
                    {
                        stringBuilder.AppendLine(String.Format("{0},{1},{2},{3},{4},{5},{6}",
                            browserDevice.OrgUnitPath,
                            browserDevice.DeviceId,
                            browserDevice.MachineName,
                            browser.ExecutablePath,
                            browser.Channel,
                            browser.BrowserVersion,
                            browserDevice.LastActivityTime?.ToString("yyyy-MM-dd hh:mm")
                            ));
                    }
                }//foreach browserDevice.Browsers                    
            }//foreach browserList.

            base.WriteToFile("CBCM_BrowserDevicesInstalledOnUserAppDataFolder", stringBuilder.ToString());
        }

        /// <summary>
        /// Move an enrolled browser to a new org unit
        /// </summary>
        /// <param name="deviceId">Device ID of the enrolled browser</param>
        /// <param name="orgUnitPath">Destination Org Unity Path</param>
        /// <returns>Status of the move</returns>
        public string MoveChromeBrowserToOrgUnit(string deviceId, string orgUnitPath)
        {
            string[] scopes = { "https://www.googleapis.com/auth/admin.directory.device.chromebrowsers" };
            string serviceURL = String.Format("https://www.googleapis.com/admin/directory/v1.1beta1/customer/{0}/devices/chromebrowsers/moveChromeBrowsersToOu", this.CustomerID);
            string token = this.GetAuthBearerToken(scopes);

            MoveChromeBrowsersToOu chromeBrowsersToOu = new MoveChromeBrowsersToOu();
            chromeBrowsersToOu.OrgUnitPath = orgUnitPath.Trim();
            chromeBrowsersToOu.ResourceIds = new string[1] { deviceId };
            string body = chromeBrowsersToOu.ToJson();

            RestClient client = new RestClient();
            Uri baseUrl = new Uri(serviceURL);
            client.BaseUrl = baseUrl;
            client.Timeout = -1;
            var request = new RestRequest(Method.POST);

            request.AddHeader("Content-Type", "application/json");
            request.AddHeader("Authorization", String.Format("Bearer {0}", token));

            request.AddParameter("application/json", body, ParameterType.RequestBody);
            IRestResponse response = client.Execute(request);
            string result = String.Format("Device {0} moved to {1}. Resonse Code = {2}\r\nResponse Content = {3}", deviceId, orgUnitPath, response.StatusCode.ToString(), response.Content);

            return result;
        }

        /// <summary>
        /// Move enrolled browser to a different OU
        /// </summary>
        /// <param name="deviceNames">List of device names</param>
        /// <param name="orgUnitPath">Destination OU path</param>
        /// <returns></returns>
        public string MoveChromeBrowsersToOu(List<string> deviceNames, string orgUnitPath)
        {
            List<BrowserDevicesBrowser> enrolledBrowserList = null;
            StringBuilder result = new StringBuilder();
            string[] scopes = { "https://www.googleapis.com/auth/admin.directory.device.chromebrowsers" };
            string token = this.GetAuthBearerToken(scopes);
            string foundDeviceId;
            string moveStatus;

            foreach (string deviceName in deviceNames)
            {

                enrolledBrowserList = this.GetEnrolledBrowsers(token, 
                    String.Format("machine_name:{0}", deviceName), 
                    String.Empty, 
                    "BASIC", 
                    "last_activity",
                    "DESCENDING",
                    100
                    );

                if (enrolledBrowserList.Count < 1)
                {
                    result.AppendLine(String.Format("Devices not found:{0}", deviceName));
                    continue;
                }

                //Take only the first item in the found result set.
                foundDeviceId = enrolledBrowserList[0].DeviceId;
                moveStatus = this.MoveChromeBrowserToOrgUnit(foundDeviceId, orgUnitPath);

                result.AppendLine(moveStatus);
            }

            return result.ToString();

        }

        public string MoveBrowsersToOUOnOrBeforeActivityDate(string sourceOrgUnitPath, string destinationOrgUnitPath, DateTime lastActivity, string filterQuery)
        {
            string query = String.Format("last_activity:..{0}", lastActivity.ToString("yyyy-MM-dd"));

            return this.MoveBrowsersToOUByActivityDate(sourceOrgUnitPath, destinationOrgUnitPath, query, filterQuery);
        }

        public string MoveBrowsersToOUOnOrAfterActivityDate(string sourceOrgUnitPath, string destinationOrgUnitPath, DateTime lastActivity, string filterQuery)
        {
            string query = String.Format("last_activity:{0}..", lastActivity.ToString("yyyy-MM-dd"));

            return this.MoveBrowsersToOUByActivityDate(sourceOrgUnitPath, destinationOrgUnitPath, query, filterQuery);
        }

        private string MoveBrowsersToOUByActivityDate(string sourceOrgUnitPath, string destinationOrgUnitPath, string filterLastActivity, string filterQuery)
        {
            if (String.IsNullOrEmpty(filterLastActivity))
                throw new ArgumentNullException(nameof(filterLastActivity));

            List<BrowserDevicesBrowser> browserDevicesBrowsers = GetBrowsersFilteredByActivityDate(sourceOrgUnitPath, filterLastActivity, filterQuery);
            

            return this.MoveBrowserToOU(browserDevicesBrowsers, destinationOrgUnitPath);
        }

        public string MoveBrowserToOU(List<BrowserDevicesBrowser> browserDevices, string orgUnitPath)
        {
            if (browserDevices == null && String.IsNullOrEmpty(orgUnitPath))
                return String.Empty;

            string[] deviceIds = new string[browserDevices.Count];
            List<BrowserAnnotatedItem> browserAnnotatedItems = new List<BrowserAnnotatedItem>();
            for (int x = 0; x < browserDevices.Count; x++)
            {
                deviceIds[x] = browserDevices[x].DeviceId;
                BrowserAnnotatedItem browserAnnotatedItem = new BrowserAnnotatedItem();
                browserAnnotatedItem.DeviceId = browserDevices[x].DeviceId;
                browserAnnotatedItem.AnnotatedLocation = browserDevices[x].OrgUnitPath;
                browserAnnotatedItems.Add(browserAnnotatedItem);
            }
           

            string[] scopes = { "https://www.googleapis.com/auth/admin.directory.device.chromebrowsers" };
            string serviceURL = String.Format("https://www.googleapis.com/admin/directory/v1.1beta1/customer/{0}/devices/chromebrowsers/moveChromeBrowsersToOu", this.CustomerID);
            string token = this.GetAuthBearerToken(scopes);
            int bucketSize = 400;

            StringBuilder result = new StringBuilder();

            //loop taking 400 elements each time
            for (int i = 0; i < deviceIds.Length; i+=bucketSize)
            {
                string[] deviceCsv =  deviceIds.Skip(i).Take(bucketSize).ToArray();

                MoveChromeBrowsersToOu chromeBrowsersToOu = new MoveChromeBrowsersToOu();
                chromeBrowsersToOu.OrgUnitPath = orgUnitPath.Trim();
                chromeBrowsersToOu.ResourceIds = deviceCsv;
                string body = chromeBrowsersToOu.ToJson();

                RestClient client = new RestClient();
                Uri baseUrl = new Uri(serviceURL);
                client.BaseUrl = baseUrl;
                client.Timeout = -1;
                var request = new RestRequest(Method.POST);

                request.AddHeader("Content-Type", "application/json");
                request.AddHeader("Authorization", String.Format("Bearer {0}", token));

                request.AddParameter("application/json", body, ParameterType.RequestBody);
                IRestResponse response = client.Execute(request);
                result.AppendLine(String.Format("Request body [0]. Resonse Code = {1}\r\nResponse Content = {2}", body, response.StatusCode.ToString(), response.Content));
            }

            //string annotationResult = this.UpdateBrowserAnnotatedField(browserAnnotatedItems);

            return result.ToString();       
        }


        /// <summary>
        /// Get enrolled browser data based on last activity.
        /// </summary>
        /// <param name="orgUnitPath">The full path of the organizational unit or its unique ID.</param>
        /// <param name="startDate">Start date</param>
        /// <param name="endDate">End data</param>
        public string GetBrowsersFilteredByActivityDate(string orgUnitPath, DateTime startDate, DateTime endDate)
        {
            List<BrowserDevicesBrowser> browserList = this.GetEnrolledBrowsers(
                String.Format("last_activity:{0}..{1}", startDate.ToString("yyyy-MM-dd"), endDate.ToString("yyyy-MM-dd")),
                orgUnitPath,
                "BASIC",
                "last_activity",
                "ASCENDING",
                100);

            if (browserList == null)
                return String.Empty;

            StringBuilder stringBuilder = new StringBuilder();
            //write the header.
            stringBuilder.AppendLine("OrgUnitPath,deviceId,machineName,lastActivityTime,lastPolicyFetchTime,osPlatform");

            foreach (BrowserDevicesBrowser browser in browserList)
            {
                stringBuilder.AppendLine(String.Format("{0},{1},{2},{3},{4},{5}",
                    browser.OrgUnitPath,
                    browser.DeviceId,
                    browser.MachineName,
                    browser.LastActivityTime?.ToString("yyyy-MM-dd hh:mm"),
                    browser.LastPolicyFetchTime?.ToString("yyyy-MM-dd hh:mm"),
                    browser.OsPlatform)
                    );
            }

            return stringBuilder.ToString();
        }

        private List<BrowserDevicesBrowser> GetBrowsersFilteredByActivityDate (string orgUnitPath, string filterLastActivity, string additionalQueryFilter)
        {
            string query = filterLastActivity;

            if (!String.IsNullOrEmpty(additionalQueryFilter))
                query += String.Format(" {0}", additionalQueryFilter);
                

            List<BrowserDevicesBrowser> browserList = this.GetEnrolledBrowsers(
                query,
                orgUnitPath,
                "BASIC",
                "last_activity",
                "ASCENDING",
                100);

            return browserList;
        }

        /// <summary>
        /// Delete a Chrome browser Device 
        /// </summary>
        /// <param name="deviceNames">List of device names</param>
        /// <returns></returns>
        public string DeleteChromeBrowsers(List<string> deviceNames)
        {
            List<BrowserDevicesBrowser> enrolledBrowserList = null;
            StringBuilder result = new StringBuilder();
            string[] scopes = { "https://www.googleapis.com/auth/admin.directory.device.chromebrowsers" };
            string token = this.GetAuthBearerToken(scopes);
            string foundDeviceId;
            string deleteOp;

            foreach (string deviceName in deviceNames)
            {
                enrolledBrowserList = this.GetEnrolledBrowsers(token,
                    String.Format("machine_name:{0}", deviceName),
                    String.Empty,
                    "BASIC",
                    "last_activity",
                    "DESCENDING",
                    100
                    );

                if (enrolledBrowserList.Count < 1)
                {
                    result.AppendLine(String.Format("Devices not found:{0}", deviceName));
                    continue;
                }

                //Take only the first item in the found result set.
                foundDeviceId = enrolledBrowserList[0].DeviceId;
                deleteOp = this.DeleteEnrolledBrowser(token, foundDeviceId);
                result.AppendLine(String.Format("Device {0} deleted. {1}", deviceName, deleteOp));
            }

            return result.ToString();
        }

        /// <summary>
        /// Delete enrolled browser by device ID.
        /// </summary>
        /// <param name="deviceIDs">List of device IDs.</param>
        /// <returns></returns>
        public string DeleteChromeBrowserByDeviceId(List<string> deviceIDs)
        {
            StringBuilder result = new StringBuilder();
            string deleteOp;
            foreach (string deviceID in deviceIDs)
            {
                deleteOp = this.DeleteEnrolledBrowser(string.Empty, deviceID);
                result.AppendLine(deleteOp);
            }
            return result.ToString();
        }

        /// <summary>
        /// Delete inactive browsers based on last activity start and end dates.
        /// </summary>
        /// <param name="orgUnitPath">The full path of the organizational unit or its unique ID.</param>
        /// <param name="startDate">Last activity start date.</param>
        /// <param name="endDate">Last activity end date.</param>
        public void DeleteInactiveBrowsers(string orgUnitPath, DateTime lastActivity, string additionalQueryFilter)
        {
            string query = String.Format("last_activity:..{0}", lastActivity.ToString("yyyy-MM-dd"));

            if (!String.IsNullOrEmpty(additionalQueryFilter))
                query += String.Format(" {0}", additionalQueryFilter);

            List<BrowserDevicesBrowser> browserList = this.GetEnrolledBrowsers(
                query,
                orgUnitPath,
                "BASIC",
                "last_activity",
                "ASCENDING",
                100);


            foreach (BrowserDevicesBrowser browser in browserList)
            {
                this.DeleteEnrolledBrowser(String.Empty, browser.DeviceId);
            }

        }

        /// <summary>
        /// Delete a Chrome browser Device 
        /// </summary>
        /// <param name="deviceID">The deviceId is a unique identifier for a device and is found in the response of the Retrieve all Chrome devices operation. </param>
        /// <returns>Response status and result.</returns>     
        private string DeleteEnrolledBrowser(string token, string deviceID)
        {
            string[] scopes = { "https://www.googleapis.com/auth/admin.directory.device.chromebrowsers" };
            string serviceURL = String.Format("https://www.googleapis.com/admin/directory/v1.1beta1/customer/{0}/devices/chromebrowsers/{1}", this.CustomerID, deviceID);

            RestClient client = new RestClient();
            Uri baseUrl = new Uri(serviceURL);
            client.BaseUrl = baseUrl;
            client.Timeout = -1;
            var request = new RestRequest(Method.DELETE);

            request.AddHeader("Content-Type", "application/json");

            if (String.IsNullOrEmpty(token))
                token = this.GetAuthBearerToken(scopes);

            request.AddHeader("Authorization", String.Format("Bearer {0}", token));

            IRestResponse response = client.Execute(request);

            return String.Format("Resonse Code = {0}. Response Content = {1}", response.StatusCode.ToString(), response.Content);
        }

        private string UpdateBrowserAnnotatedField(List<BrowserAnnotatedItem> browserAnnotatedItems)
        {
            string[] scopes = { "https://www.googleapis.com/auth/admin.directory.device.chromebrowsers" };
            
            string token = this.GetAuthBearerToken(scopes);

            StringBuilder builder = new StringBuilder();    
            foreach (BrowserAnnotatedItem browserAnnotatedItem in browserAnnotatedItems)
            {
                string body = browserAnnotatedItem.ToJson();
                string serviceURL = String.Format("https://www.googleapis.com/admin/directory/v1.1beta1/customer/{0}/devices/chromebrowsers/{1}", this.CustomerID, browserAnnotatedItem.DeviceId);
                Uri baseUrl = new Uri(serviceURL);

                RestClient client = new RestClient();
                
                client.BaseUrl = baseUrl;
                client.Timeout = -1;
                var request = new RestRequest(Method.PUT);

                request.AddHeader("Content-Type", "application/json");
                request.AddHeader("Authorization", String.Format("Bearer {0}", token));

                request.AddParameter("application/json", body, ParameterType.RequestBody);
                IRestResponse response = client.Execute(request);
                builder.AppendLine(String.Format("Request body [0]. Resonse Code = {1}\r\nResponse Content = {2}", body, response.StatusCode.ToString(), response.Content));
            }

            return builder.ToString();
        }

    }
}
