using System;
using System.Collections.Generic;
using System.Linq;
using RestSharp;
using cbcmSchema.Crxcavator;
using cbcmSchema.Spin;
using cbcmSchema.Extension;
using cbcmSchema.InstalledAppsReport;
using cbcmSchema.InstalledAppDevices;
using System.Data;
using System.Web;
using System.Text;
using cbcmSchema.OU;
using System.Diagnostics;
using System.Net.Http.Headers;
using System.Globalization;

namespace cbcmClient
{
    public sealed class ExtensionDetails : BaseHelper
    {
        #region constructor
        public ExtensionDetails(string keyFile, string customerID) : base(keyFile) 
        {
            this.CustomerID = customerID;
        }

        public ExtensionDetails(string keyFile, string customerID, string adminUserToImpersonate) : base(keyFile, adminUserToImpersonate)
        {
            this.CustomerID = customerID;
        }
        #endregion

        public string ExtensionRiskMap(IList<string> importedExtList)
        {
            if (importedExtList == null)
                return string.Empty;

            List<ExtensionItem> extensionItems = this.ValidatList(importedExtList);

            //create the generic object to hold extension data
            ExtensionInstallReport extensionInstallReport = new ExtensionInstallReport();
            extensionInstallReport.InstalledApps = new List<InstalledApp>();


            foreach(ExtensionItem extensionItem in extensionItems)
            {
                InstalledApp installedApp = new InstalledApp();
                installedApp.AppId = extensionItem.AppId;
                installedApp.Version = extensionItem.RevisionId;
                extensionInstallReport.InstalledApps.Add(installedApp);
            }
            List<ExtensionInstallReport> extensionInstallReports = new List<ExtensionInstallReport>();
            extensionInstallReports.Add(extensionInstallReport);

            this.AddExtensionSignals(ref extensionInstallReports);

            StringBuilder stringBuilder = new StringBuilder();
            //header
            stringBuilder.AppendLine("appId,version,crxcavatorRiskScore,spinRiskScore");

            foreach (ExtensionInstallReport item in extensionInstallReports)
            {
                if (item == null)
                    continue;

                foreach (InstalledApp installedAppItem in item.InstalledApps)
                {
                    if (installedAppItem == null)
                        continue;

                    stringBuilder.AppendLine(installedAppItem.ToString("S", CultureInfo.CurrentCulture));
                }
            }



            return stringBuilder.ToString();
        }
        /// <summary>
        /// Collect extension data from a given OU and generate a CSV output
        /// </summary>
        /// <param name="orgUnitId">Org unit Id</param>
        /// <returns>A CSV containing extension details and risk score.</returns>
        public string ExtensionRiskMap(string orgUnitId)
        {
            List<ExtensionInstallReport> extReport = this.BuildInstalledAppReport(orgUnitId, true, true);

            if (extReport == null)
                return String.Empty;

            StringBuilder stringBuilder = new StringBuilder();
            //header
            stringBuilder.AppendLine("appId,displayName,version,crxcavatorRiskScore,crxcavatorRiskUrl,spinRiskScore,spinRiskUrl,browserDeviceCount,appInstallType");

            foreach(ExtensionInstallReport extensionInstallReport in extReport)
            {
                if (extensionInstallReport == null)
                    continue;

                foreach(InstalledApp installedApp in extensionInstallReport.InstalledApps)
                {
                    if (installedApp == null)
                        continue;

                    stringBuilder.AppendLine(installedApp.ToString("L", CultureInfo.CurrentCulture));
                }
            }

            return stringBuilder.ToString();
        }

        public string ExtensionInstalledDevices(List<string> extensionIds)
        {
            if (extensionIds == null)
                return String.Empty;

            
            List<InstalledApp> installedApps = new List<InstalledApp>();

            foreach (string id in extensionIds)
            {
                if (String.IsNullOrEmpty(id))
                    continue;
                InstalledApp installedApp = new InstalledApp();
                installedApp.AppId = id;

                installedApps.Add(installedApp);

            }

            ExtensionInstallReport extensionInstallReport = new ExtensionInstallReport();
            extensionInstallReport.InstalledApps = installedApps;

            List<ExtensionInstallReport> extensionInstallReports = new List<ExtensionInstallReport>();
            extensionInstallReports.Add(extensionInstallReport);

            this.AddBrowsersToInstalledAppReport(String.Empty, ref extensionInstallReports);

            StringBuilder stringBuilder = new StringBuilder();
            //header
            stringBuilder.AppendLine("appId,deviceId,machine");

            foreach (ExtensionInstallReport extensionInstallReport1 in extensionInstallReports)
            {
                if (extensionInstallReport1 == null)
                    continue;

                foreach(InstalledApp installedApp1 in extensionInstallReport1.InstalledApps)
                {
                    if(installedApp1 == null)
                        continue ;
                    
                    foreach(cbcmSchema.InstalledAppsReport.Device device1 in installedApp1.Devices)
                    {
                        if (device1 == null)
                            continue;

                        stringBuilder.AppendLine(installedApp1.AppId + "," + device1.DeviceId + "," + device1.Machine);
                    } //Device
                } //InstalledApp

            } //ExtensionInstallReport

            return stringBuilder.ToString();
        }

        /// <summary>
        /// Create the extension install report
        /// </summary>
        /// <param name="orgUnitId">The ID of the organizational unit.</param>
        /// <returns>List of extensions installed in a given OU</returns>
        private List<ExtensionInstallReport> BuildInstalledAppReport(string orgUnitId, bool buildDeviceProfile, bool buildRiskSignal)
        {
            List<ExtensionInstallReport> extensionInstallReports = new List<ExtensionInstallReport>();

            string nextPageToken = String.Empty;
            string content = String.Empty;
            RestClient client;

            string[] scope = { "https://www.googleapis.com/auth/chrome.management.reports.readonly" };
            string token = this.GetAuthBearerToken(scope);

            string serviceURL = String.Format("https://chromemanagement.googleapis.com/v1/customers/{0}/reports:countInstalledApps?orderBy=total_install_count&pageSize=100&pageToken=",
                  this.CustomerID);

            if (!String.IsNullOrEmpty(orgUnitId))
                serviceURL = serviceURL + "&orgUnitId=" + orgUnitId;

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
                ExtensionInstallReport extensionInstallReport = ExtensionInstallReport.FromJson(content);

                if (extensionInstallReport == null)
                    continue;


                //set next page token
                nextPageToken = String.IsNullOrEmpty(extensionInstallReport.NextPageToken) ? String.Empty : extensionInstallReport.NextPageToken;

                extensionInstallReports.Add(extensionInstallReport);

            } while (!String.IsNullOrEmpty(nextPageToken));


            if (buildDeviceProfile)
                this.AddBrowsersToInstalledAppReport(orgUnitId, ref extensionInstallReports);

            if (buildRiskSignal)
                this.AddExtensionSignals(ref extensionInstallReports);

            return extensionInstallReports;
        }

        /// <summary>
        /// Build the extension report with enrolled browser device information
        /// </summary>
        /// <param name="orgUnitId">The ID of the organizational unit.</param>
        /// <param name="extensionInstallReports">List of extensions installed in a given OU</param>
        private void AddBrowsersToInstalledAppReport(string orgUnitId, ref List<ExtensionInstallReport> extensionInstallReports)
        {
            foreach(ExtensionInstallReport extensionInstallReport in extensionInstallReports)
            {
                if (extensionInstallReport.InstalledApps == null)
                    continue;

                foreach(InstalledApp installedApp in extensionInstallReport.InstalledApps)
                {
                    if (installedApp == null)
                        continue;

                    List<ExtensionInstallDeviceReport> extensionInstallDeviceReports = this.BuildInstalledAppDevicesReport(orgUnitId, installedApp.AppId);
                    List<cbcmSchema.InstalledAppsReport.Device> installedDevices = new List<cbcmSchema.InstalledAppsReport.Device>();

                    if (extensionInstallDeviceReports == null)
                        continue;

                    foreach(ExtensionInstallDeviceReport extensionInstallDeviceReport in extensionInstallDeviceReports)
                    {
                        if (extensionInstallDeviceReport.Devices == null)
                            continue;

                        foreach(cbcmSchema.InstalledAppDevices.Device deviceItem in extensionInstallDeviceReport.Devices)
                        {
                            cbcmSchema.InstalledAppsReport.Device installedDevice = new cbcmSchema.InstalledAppsReport.Device();
                            installedDevice.DeviceId = deviceItem.DeviceId;
                            installedDevice.Machine = deviceItem.Machine;
                            installedDevices.Add(installedDevice);
                        }
                    }

                    installedApp.Devices = installedDevices;
                }
            }
        }
        
        /// <summary>
        /// Gather risk scores from supported services
        /// </summary>
        /// <param name="extensionInstallReports">List of extension data</param>
        private void AddExtensionSignals(ref List<ExtensionInstallReport> extensionInstallReports)
        {
            foreach (ExtensionInstallReport extensionInstallReport in extensionInstallReports)
            {
                if (extensionInstallReport.InstalledApps == null)
                    continue;

                foreach (InstalledApp installedApp in extensionInstallReport.InstalledApps)
                {
                    if (String.IsNullOrEmpty(installedApp.Version))
                    {
                        ExtensionItem cwsValidatedItem = this.GetExtensionDetailFromCWS(String.Empty, installedApp.AppId);
                        installedApp.Version = cwsValidatedItem.RevisionId;
                    }

                    CrxcavatorRiskItem crxcavatorRiskItem = this.GetCrxcavatorScore(installedApp.AppId, installedApp.Version);

                    if (crxcavatorRiskItem != null)
                    {
                        installedApp.CrxcavatorRiskScore = crxcavatorRiskItem.Data.Risk.Total.HasValue ? crxcavatorRiskItem.Data.Risk.Total.Value.ToString() : String.Empty;
                        installedApp.CrxcavatorRiskUrl = crxcavatorRiskItem.RiskReport;
                    }

                    SpinRiskItem spinRiskItem = this.GetSpinScore(installedApp.AppId, installedApp.Version);

                    if (spinRiskItem != null)
                    {
                        installedApp.SpinRiskScore = spinRiskItem.TrustRate.HasValue ? spinRiskItem.TrustRate.Value.ToString() : String.Empty;
                        installedApp.SpinRiskUrl = spinRiskItem.Details;
                    }
                }
            }
        }

        /// <summary>
        /// Create the extension install device (browser) report
        /// </summary>
        /// <param name="orgUnitId">The ID of the organizational unit.</param>
        /// <returns>List of devices where the extensions is installed in a given OU</returns>
        private List<ExtensionInstallDeviceReport> BuildInstalledAppDevicesReport(string orgUnitId, string extensionId)
        {
            List<ExtensionInstallDeviceReport> result = new List<ExtensionInstallDeviceReport>();

            string nextPageToken = String.Empty;
            string content = String.Empty;
            RestClient client;

            string[] scope = { "https://www.googleapis.com/auth/chrome.management.reports.readonly" };
            string token = this.GetAuthBearerToken(scope);

            string serviceURL = String.Format("https://chromemanagement.googleapis.com/v1/customers/{0}/reports:findInstalledAppDevices?appId={1}&appType=EXTENSION&pageSize=1&pageToken=",
                  this.CustomerID,
                  extensionId);

            if (!String.IsNullOrEmpty(orgUnitId))
                serviceURL = serviceURL + "&orgUnitId=" + orgUnitId;

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
                ExtensionInstallDeviceReport extensionInstallDevice = ExtensionInstallDeviceReport.FromJson(content);

                if (extensionInstallDevice == null)
                    continue;


                //set next page token
                nextPageToken = String.IsNullOrEmpty(extensionInstallDevice.NextPageToken) ? String.Empty : extensionInstallDevice.NextPageToken;

                result.Add(extensionInstallDevice);

            } while (!String.IsNullOrEmpty(nextPageToken));


            return result;
        }

        /// <summary>
        /// Clean and validate the input data
        /// </summary>
        /// <param name="inputList">Extension Id and version data from input</param>
        /// <returns>List of extension items</returns>
        private List<ExtensionItem> ValidatList(IList<string> inputList)
        {
            List<ExtensionItem> result = new List<ExtensionItem>();

            foreach (string inputItem in inputList)
            {
                if (String.IsNullOrEmpty(inputItem))
                    continue;

                ExtensionItem item = new ExtensionItem();


                if (inputItem.Contains(","))
                {
                    string[] subs = inputItem.Split(',');
                    if (subs.Length != 2)
                        continue;

                    item.AppId = String.IsNullOrEmpty(subs[0]) ? String.Empty : subs[0].Trim();
                    item.RevisionId = String.IsNullOrEmpty(subs[1]) ? String.Empty : subs[1].Trim();
                }
                else
                {
                    ExtensionItem cwsValidatedItem = this.GetExtensionDetailFromCWS(String.Empty, inputItem.Trim());
                    if (cwsValidatedItem != null)
                    {
                        item.AppId = cwsValidatedItem.AppId;
                        item.RevisionId = cwsValidatedItem.RevisionId;
                    }
                }

                result.Add(item);
            }

            return result;
        }

        /// <summary>
        /// Look-up extensions from the Chrome Web Store
        /// </summary>
        /// <param name="extensionIdList">List of extensions</param>
        /// <returns></returns>
        internal List<ExtensionItem> LookupExtensionsFromCWS(List<string> extensionIdList)
        {
            List<ExtensionItem> result = new List<ExtensionItem>();
            string[] scope = { "https://www.googleapis.com/auth/chrome.management.appdetails.readonly" };
            string token = this.GetAuthBearerToken(scope);

            foreach (string extensionId in extensionIdList)
            {
                if (String.IsNullOrEmpty(extensionId))
                    continue;

                ExtensionItem item = this.GetExtensionDetailFromCWS(token, extensionId);
                result.Add(item);
            }

            return result;
        }

        /// <summary>
        /// Get extension details from the Chrome web store
        /// </summary>
        /// <param name="token">Auth token</param>
        /// <param name="extensionId">Extension ID</param>
        /// <returns>Extension data from the Chrome Web Store</returns>
        internal ExtensionItem GetExtensionDetailFromCWS(string token, string extensionId)
        {
            string[] scope = { "https://www.googleapis.com/auth/chrome.management.appdetails.readonly" };
            string authToken = String.IsNullOrEmpty(token) ? this.GetAuthBearerToken(scope) : token;

            string serviceURL = String.Format("https://chromemanagement.googleapis.com/v1/customers/{0}/apps/chrome/{1}",
                this.CustomerID,
                extensionId);

            RestClient client = new RestClient(serviceURL);
            client.Timeout = base._timeout;


            var request = new RestRequest(Method.GET);
            request.AddHeader("Content-Type", "application/json");
            request.AddHeader("Authorization", String.Format("Bearer {0}", authToken));
            IRestResponse response = client.Execute(request);

            ExtensionItem result = ExtensionItem.FromJson(response.Content);
            result.UnverifiedExtensionId = extensionId;

            return result;
        }


        /// <summary>
        /// Get risk score from Crxcavator
        /// </summary>
        /// <param name="extensionId">Extension Id<</param>
        /// <param name="version">Extension version</param>
        /// <returns></returns>
        private CrxcavatorRiskItem GetCrxcavatorScore(string extensionId, string version)
        {
            if (String.IsNullOrEmpty(version))
                return null;

            CrxcavatorRiskItem result;

            try
            {
                string serviceURL = String.Format("https://api.crxcavator.io/v1/report/{0}/{1}?platform=Chrome",
                       extensionId,
                       version);
                UriBuilder builder = new UriBuilder(serviceURL);

                RestClient client = new RestClient();
                client.BaseUrl = builder.Uri;
                client.Timeout = base._timeout;

                var request = new RestRequest(Method.GET);

                IRestResponse response = client.Execute(request);

                result = CrxcavatorRiskItem.FromJson(response.Content);
            }
            catch(Exception ex)
            {
                throw new Exception(String.Format("Extension ID: {0} and version: {1}", extensionId, version), ex);
            }


            return result;
        }
        /// <summary>
        /// Get risk score from Spin.ai
        /// </summary>
        /// <param name="extensionId">Extension Id</param>
        /// <param name="version">Extension version</param>
        /// <returns></returns>
        private SpinRiskItem GetSpinScore(string extensionId, string version)
        {
            SpinRiskItem result;

            try
            {
                string serviceURL = String.Format("https://apg-1.spin.ai/api/v1/assessment/platform/chrome/{0}{1}",
                       extensionId,
                       String.IsNullOrEmpty(version) ? String.Empty : "/version/" + version);
                UriBuilder builder = new UriBuilder(serviceURL);

                RestClient client = new RestClient();
                client.BaseUrl = builder.Uri;
                client.Timeout = base._timeout;

                var request = new RestRequest(Method.GET);

                IRestResponse response = client.Execute(request);

                result = SpinRiskItem.FromJson(response.Content);
            }
            catch (Exception ex)
            {
                throw new Exception(String.Format("Extension ID: {0} and version: {1}", extensionId, version), ex);
            }


            return result;
        }
    }

}
