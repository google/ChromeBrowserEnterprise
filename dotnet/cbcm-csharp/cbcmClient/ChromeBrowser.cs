using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Text;
using System.Web;
using RestSharp;
using cbcmSchema.Browserdevices;
using cbcmSchema.BrowserToOU;

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

        /// <summary>
        /// Get all enrolled browsers - Full projection - with the optional org unit path.
        /// </summary>
        /// <param name="orgUnitPath">The full path of the organizational unit or its unique ID.</param>
        /// <returns></returns>
        /// <exception cref="ApplicationException"></exception>
        public string GetAllEnrolledBrowsers(string orgUnitPath)
        {
  
            string nextPageToken = String.Empty;
            BrowserDevices browserDevices = null;
            StringBuilder stringBuilder = new StringBuilder();
            string content = String.Empty;
            string responseUri = String.Empty;
            RestClient client;

            try
            {
                string[] scope = { "https://www.googleapis.com/auth/admin.directory.device.chromebrowsers.readonly" };
                string token = this.GetAuthBearerToken(scope);               


                string serviceURL = String.Format("https://www.googleapis.com/admin/directory/v1.1beta1/customer/{0}/devices/chromebrowsers?projection=FULL&orderBy=last_activity&sortOrder=DESCENDING&maxResults=100&pageToken="
                       , this.CustomerID);

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

                    //useful for debugging
                    if (response.ResponseUri != null && response.Content != null)
                    {
                        responseUri = response.ResponseUri.ToString();
                        content = response.Content;
                    }

                    browserDevices = BrowserDevices.FromJson(content);

                    stringBuilder.AppendLine(content);

                    //set next page token
                    nextPageToken = browserDevices.NextPageToken;


                } while (!String.IsNullOrEmpty(nextPageToken));

            }
            catch (Exception ex)
            {
                throw new ApplicationException(String.Format("Service URI: {0}\r\nContent: {1}.\r\n", responseUri, content), ex);
            }

            return stringBuilder.ToString();


        }

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
        private List<BrowserDevicesBrowser> GetEnrolledBrowsers(string query, string orgUnitPath, string projection, string orderBy, string sortOrder, int maxResults)
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
        private List<BrowserDevicesBrowser> GetEnrolledBrowsers(string token, string query, string orgUnitPath, string projection, string orderBy, string sortOrder, int maxResults)
        {
            string nextPageToken = String.Empty;
            BrowserDevices browserDevices = null;
            List<BrowserDevicesBrowser> browserList = new List<BrowserDevicesBrowser>();
            string content = String.Empty;
            string responseUri = String.Empty;
            RestClient client;

            try
            {
                //Get a new token if needed.
                if (String.IsNullOrEmpty(token))
                {
                    string[] scope = { "https://www.googleapis.com/auth/admin.directory.device.chromebrowsers.readonly" };
                    token = this.GetAuthBearerToken(scope);
                }
                

                string serviceURL = String.Format("https://www.googleapis.com/admin/directory/v1.1beta1/customer/{0}/devices/chromebrowsers?projection={1}&orderBy={2}&sortOrder={3}&maxResults={4}&pageToken="
                       , this.CustomerID
                       , projection
                       , String.IsNullOrEmpty(orderBy) ? "last_activity" : orderBy
                       , String.IsNullOrEmpty(sortOrder) ? "DESCENDING" : sortOrder
                       , maxResults);

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

                    //useful for debugging
                    if (response.ResponseUri != null && response.Content != null)
                    {
                        responseUri = response.ResponseUri.ToString();
                        content = response.Content;
                    }

                    browserDevices = BrowserDevices.FromJson(content);

                    //check if a matching browser was found and then add to list.
                    if (browserDevices != null && (browserDevices.Browsers != null && browserDevices.Browsers.Count > 0))
                        browserList.AddRange(browserDevices.Browsers);

                    //set next page token
                    nextPageToken = browserDevices.NextPageToken;


                } while (!String.IsNullOrEmpty(nextPageToken));

            }
            catch (Exception ex)
            {
                throw new ApplicationException(String.Format("Service URI: {0}\r\nContent: {1}.\r\n", responseUri, content), ex);
            }

            return browserList;
        }

        /// <summary>
        /// Find enrlled browsers that have a shell created in CBCM. These don't have details like Browser profile, extensions, and policies.
        /// </summary>
        public void GetBrowsersWithMissingData()
        {
            List<BrowserDevicesBrowser> browserList = this.GetEnrolledBrowsers(
                String.Empty
                , String.Empty
                , "FULL"
                , "last_activity"
                , "DESCENDING"
                , 100);

            StringBuilder stringBuilder = new StringBuilder();
            //write the header.
            stringBuilder.AppendLine("OrgUnitPath,deviceId,machineName,lastRegisterTimestamp,extensionCount,policyCount");

            foreach (BrowserDevicesBrowser browser in browserList)
            {
                if ((!browser.LastStatusReportTime.HasValue &&
                    !browser.LastPolicyFetchTime.HasValue) &&
                    !browser.LastStatusReportTime.HasValue)
                    stringBuilder.AppendLine(String.Format("{0},{1},{2},{3},{4},{5}"
                        , browser.OrgUnitPath
                        , browser.DeviceId
                        , browser.MachineName
                        , browser.LastRegistrationTime
                        , browser.ExtensionCount.HasValue ? browser.ExtensionCount.Value.ToString() : String.Empty
                        , browser.PolicyCount.HasValue ? browser.PolicyCount.Value.ToString() : String.Empty)
                        );
            }

            base.WriteToFile("CBCM_BrowsersWithMissingData", stringBuilder.ToString());
        }

        public void GetBrowserDevicesInstalledOnUserAppDataFolder()
        {
            List<BrowserDevicesBrowser> browserList = this.GetEnrolledBrowsers(
                "os_platform:Windows"
                , String.Empty
                , "FULL"
                , "last_activity"
                , "DESCENDING"
                , 100);

            StringBuilder stringBuilder = new StringBuilder();
            //write the header.
            stringBuilder.AppendLine("OrgUnitPath,deviceId,machineName,executablePath,channel,browserVersion,lastStatusReportTime");

            foreach (BrowserDevicesBrowser browserDevice in browserList)
            {
                foreach (BrowserBrowser browser in browserDevice.Browsers)
                {
                    if (!String.IsNullOrEmpty(browser.ExecutablePath) && browser.ExecutablePath.Contains("users"))
                    {
                        stringBuilder.AppendLine(String.Format("{0},{1},{2},{3},{4},{5}"
                            , browserDevice.OrgUnitPath
                            , browserDevice.DeviceId
                            , browserDevice.MachineName
                            , browser.ExecutablePath
                            , browser.Channel
                            , browser.BrowserVersion
                            , browser.LastStatusReportTime
                            ));
                    }
                }//foreach browserDevice.Browsers                    
            }//foreach browserList.

            base.WriteToFile("CBCM_BrowserDevicesInstalledOnUserAppDataFolder", stringBuilder.ToString());
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
            string serviceURL = String.Format("https://www.googleapis.com/admin/directory/v1.1beta1/customer/{0}/devices/chromebrowsers/moveChromeBrowsersToOu", this.CustomerID);
            string token = this.GetAuthBearerToken(scopes);

            RestClient client;
            Uri baseUrl;
            string foundDeviceId;
            MoveChromeBrowsersToOu chromeBrowsersToOu;

            foreach (string deviceName in deviceNames)
            {

                enrolledBrowserList = this.GetEnrolledBrowsers(token
                    , String.Format("machine_name:{0}", deviceName)
                    , String.Empty
                    , "BASIC"
                    , "last_activity"
                    , "DESCENDING"
                    , 100
                    );

                if (enrolledBrowserList.Count < 1)
                {
                    result.AppendLine(String.Format("Devices not found:{0}", deviceName));
                    continue;
                }

                //Take only the first item in the found result set.
                foundDeviceId = enrolledBrowserList[0].DeviceId;

                chromeBrowsersToOu = new MoveChromeBrowsersToOu();
                chromeBrowsersToOu.OrgUnitPath = orgUnitPath.Trim();
                chromeBrowsersToOu.ResourceIds = new string[1] { foundDeviceId };
                string body = chromeBrowsersToOu.ToJson();

                client = new RestClient();
                baseUrl = new Uri(serviceURL);
                client.BaseUrl = baseUrl;
                client.Timeout = -1;
                var request = new RestRequest(Method.POST);

                request.AddHeader("Content-Type", "application/json");
                request.AddHeader("Authorization", String.Format("Bearer {0}", token));

                request.AddParameter("application/json", body, ParameterType.RequestBody);
                IRestResponse response = client.Execute(request);
                result.AppendLine(String.Format("Device {0} moved to {1}. Resonse Code = {2}\r\nResponse Content = {3}", deviceName, orgUnitPath, response.StatusCode.ToString(), response.Content));
            }


            return result.ToString();

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

            RestClient client;
            Uri baseUrl;
            string foundDeviceId;

            foreach (string deviceName in deviceNames)
            {
                enrolledBrowserList = this.GetEnrolledBrowsers(token
                    , String.Format("machine_name:{0}", deviceName)
                    , String.Empty
                    , "BASIC"
                    , "last_activity"
                    , "DESCENDING"
                    , 100
                    );

                if (enrolledBrowserList.Count < 1)
                {
                    result.AppendLine(String.Format("Devices not found:{0}", deviceName));
                    continue;
                }

                //Take only the first item in the found result set.
                foundDeviceId = enrolledBrowserList[0].DeviceId;
                string serviceURL = String.Format("https://www.googleapis.com/admin/directory/v1.1beta1/customer/{0}/devices/chromebrowsers/{1}", this.CustomerID, foundDeviceId);

                client = new RestClient();
                baseUrl = new Uri(serviceURL);
                client.BaseUrl = baseUrl;
                client.Timeout = -1;
                var request = new RestRequest(Method.DELETE);

                request.AddHeader("Content-Type", "application/json");
                request.AddHeader("Authorization", String.Format("Bearer {0}", token));

                IRestResponse response = client.Execute(request);
                result.AppendLine(String.Format("Device {0} deleted. Resonse Code = {1}\r\nResponse Content = {2}", deviceName, response.StatusCode.ToString(), response.Content));
            }


            return result.ToString();
        }


    }
}
