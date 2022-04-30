using System;
using System.Collections.Generic;
using System.Text;
using RestSharp;
using cbcmSchema.Browserdevices;
using cbcmSchema.ApplicationException;

namespace cbcmClient
{
    public sealed class ChromeBrowser : BaseHelper
    {
        public ChromeBrowser(string keyFile, string customerID) : base(keyFile)
        {
            this.CustomerID = customerID;
        }

        public void GetAllEnrolledBrowsers()
        {
            List<BrowserDevicesBrowser> browserList = this.GetEnrolledBrowsers(
                String.Empty
                , String.Empty
                , "FULL"
                , "last_activity"
                , "DESCENDING"
                , 100);

            StringBuilder stringBuilder = new StringBuilder();

            //write the header
            stringBuilder.AppendLine("DeviceId, MachineName, ExtensionCount");

            foreach (BrowserDevicesBrowser item in browserList)
            {
                stringBuilder.AppendLine(String.Format("{0}, {1}, {2}"
                    , item.DeviceId
                    , item.MachineName
                    , item.ExtensionCount
                    )
                    );
            }

            base.WriteToFile("CBCM_ChromeBrowser", stringBuilder.ToString());
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
            string[] scope = { "https://www.googleapis.com/auth/admin.directory.device.chromebrowsers.readonly" };
            string token = this.GetAuthBearerToken(scope);
            string nextPageToken = String.Empty;
            Uri baseUrl = null;
            BrowserDevices browserDevices = null;
            List<BrowserDevicesBrowser> browserList = new List<BrowserDevicesBrowser>();

            RestClient client = new RestClient();
            
            string serviceURL = String.Format("https://www.googleapis.com/admin/directory/v1.1beta1/customer/{0}/devices/chromebrowsers?projection={1}&orderBy={2}&sortOrder={3}&maxResults={4}"
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
                serviceURL = serviceURL + "&pageToken=" + nextPageToken;

                baseUrl = new Uri(serviceURL);

                client.BaseUrl = baseUrl;

                var request = new RestRequest(Method.GET);
                request.AddHeader("Content-Type", "application/json");
                request.AddHeader("Authorization", String.Format("Bearer {0}", token));
                IRestResponse response = client.Execute(request);

                if (response.Content.Contains("errors"))
                {
                    throw new ApplicationException(String.Format("\r\nToken: {0}\r\nResponse URI:{1}\r\n:Response Content: {2}"
                        , token
                        , response.ResponseUri.ToString()
                        , response.Content));
                }

                browserDevices = BrowserDevices.FromJson(response.Content);
                browserList.AddRange(browserDevices.Browsers);
                nextPageToken = browserDevices.NextPageToken;
            } while (!String.IsNullOrEmpty(nextPageToken));

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
                        , browser.ExtensionCount.HasValue? browser.ExtensionCount.Value.ToString() : String.Empty
                        , browser.PolicyCount.HasValue? browser.PolicyCount.Value.ToString() : String.Empty)
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



    }
}
