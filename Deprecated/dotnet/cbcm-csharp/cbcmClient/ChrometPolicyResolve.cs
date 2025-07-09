using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using RestSharp;
using cbcmSchema.ExtensionPolicy;
using cbcmSchema.ChromeBrowserPolicy;
using cbcmSchema.ChromeBrowserPolicyRequest;
using cbcmSchema.Extension;
using Newtonsoft.Json.Linq;
using cbcmSchema.OU;
using System.Timers;

namespace cbcmClient
{
    public sealed class ChrometPolicyResolve : BaseHelper
    {
        public ChrometPolicyResolve(string keyFile, string customerID):base(keyFile)
        {
            base.CustomerID = customerID;   
        }
        public ChrometPolicyResolve(string keyFile, string customerID, string adminUserToImpersonate) : base(keyFile, adminUserToImpersonate)
        {
            base.CustomerID = customerID;
        }

        /// <summary>
        /// Upload an extension one at a time (slow). Use the batch upload method for bulk import. 
        /// </summary>
        /// <param name="extensionIDs">App and Extension IDs</param>
        /// <param name="orgUnitId">OU ID</param>
        /// <param name="installPolicy">FORCED, ALLOWED, BLOCKED. Default is ALLOWED</param>
        /// <returns></returns>
        public string SingletonUploadExtensionsToOU(List<string> extensionIDs, string orgUnitId, string installPolicy)
        {
            //parse install policy
            string appInstallType = this.ExtensionInstallPolicyParse(installPolicy);

            StringBuilder sb = new StringBuilder();

            //prepare Chrome Web Store validation
            ExtensionDetails extensionDetails = new ExtensionDetails(KeyFile, CustomerID, AdminUserToImpersonate);
            List<ExtensionItem> extensionItemList = extensionDetails.LookupExtensionsFromCWS(extensionIDs);

            string[] scope = { "https://www.googleapis.com/auth/chrome.management.policy" };
            string serviceURL = String.Format("https://chromepolicy.googleapis.com/v1/customers/{0}/policies/orgunits:batchModify", this.CustomerID);
            Uri baseUrl = new Uri(serviceURL);

            string token = this.GetAuthBearerToken(scope);


            foreach (ExtensionItem extensionItem in extensionItemList)
            {
                if (extensionItem is null)
                    continue;

                if (extensionItem.DetailUri is null)
                {
                    sb.AppendLine(String.Format("Cannot find extension ID {0} in the Chrome Web Store", extensionItem.UnverifiedExtensionId));
                    continue;
                }

                cbcmSchema.ExtensionPolicy.ExtensionMgmtPolicy extensionMgmt = this.BuildExtensionPolicyRequest(appInstallType, extensionItem.AppId, orgUnitId);

                string body = extensionMgmt.ToJson();
                
                var request = new RestRequest(Method.POST);

                RestClient client = new RestClient();
                client.BaseUrl = baseUrl;
                client.Timeout = base._timeout;

                request.AddHeader("Content-Type", "application/json");
                request.AddHeader("Authorization", String.Format("Bearer {0}", token));

                request.AddParameter("application/json", body, ParameterType.RequestBody);
                IRestResponse response = client.Execute(request);
                sb.AppendLine(String.Format("{0}: App Id {1}. Response content {2}", DateTime.Now.ToString("HH:mm:ss.fff"), extensionItem.AppId, response.Content));

                //[hack] write operation with "modify" - 1QpS. Resolve has a 5QpS limit.
                this.SetTimer(2000);
                
            }

                return sb.ToString();
        }

        //write operation with "modify" - 1QpS. Resolve has a 5QpS limit.
        private void SetTimer(double interval)
        {
            // Create a timer with the specificed internal (seconds).
            using (Timer timer = new System.Timers.Timer(interval))
            {
                timer.Elapsed += OnTimedEvent;
                // Have the timer fire repeated events (true is the default)
                timer.AutoReset = false;
                // Start the timer
                timer.Enabled = true;
            }
        }

        private  void OnTimedEvent(Object source, ElapsedEventArgs e)
        {
            //do nothing
        }


        /// <summary>
        /// Batch update extensions in a specific Organizational Unit Copy
        /// </summary>
        /// <param name="extensionIDs">App and Extension IDs</param>
        /// <param name="orgUnitId">OU ID</param>
        /// <param name="installPolicy">FORCED, ALLOWED, BLOCKED. Default is ALLOWED<</param>
        /// <returns></returns>
        public string BatchUploadExtensionsToOU(List<string> extensionIDs, string orgUnitId, string installPolicy)
        {
            //prepare Chrome Web Store validation
            ExtensionDetails extensionDetails = new ExtensionDetails(KeyFile, CustomerID, AdminUserToImpersonate);
            List<ExtensionItem> extensionItemList = extensionDetails.LookupExtensionsFromCWS(extensionIDs);

            string appInstallType = this.ExtensionInstallPolicyParse(installPolicy);
            StringBuilder sb = new StringBuilder(); 
                       
            cbcmSchema.ExtensionPolicy.PolicyTargetKey policyTargetKey;
            cbcmSchema.ExtensionPolicy.PolicyValue policyValue;
            cbcmSchema.ExtensionPolicy.Value value;
            cbcmSchema.ExtensionPolicy.UpdateMask updateMask;
            cbcmSchema.ExtensionPolicy.Request request1;
            cbcmSchema.ExtensionPolicy.ExtensionMgmtPolicy extensionMgmt = new cbcmSchema.ExtensionPolicy.ExtensionMgmtPolicy();
            List<cbcmSchema.ExtensionPolicy.Request> extensionInstallRequests = new List<cbcmSchema.ExtensionPolicy.Request>();

            foreach (ExtensionItem extensionItem in extensionItemList)
            {
                if (extensionItem is null)
                    continue;

                if (extensionItem.DetailUri is null)
                {
                    sb.AppendLine(String.Format("Cannot find extension ID {0} in the Chrome Web Store", extensionItem.UnverifiedExtensionId));
                    continue;
                }

                //policyTargetKey
                policyTargetKey = new cbcmSchema.ExtensionPolicy.PolicyTargetKey();
                policyTargetKey.TargetResource = String.Format("orgunits/{0}", orgUnitId);
                cbcmSchema.ExtensionPolicy.AdditionalTargetKeys additionalTargetKeys = new cbcmSchema.ExtensionPolicy.AdditionalTargetKeys();
                additionalTargetKeys.AppId = String.Format("chrome:{0}", extensionItem.AppId);
                policyTargetKey.AdditionalTargetKeys = additionalTargetKeys;

                //Value
                value = new Value();
                value.AppInstallType = appInstallType;
                //policyValue
                policyValue = new cbcmSchema.ExtensionPolicy.PolicyValue();
                policyValue.Value = value;
                policyValue.PolicySchema = "chrome.users.apps.InstallType";

                //updateMask
                updateMask = new cbcmSchema.ExtensionPolicy.UpdateMask();
                updateMask.Paths = "appInstallType";

                //requests
                request1 = new cbcmSchema.ExtensionPolicy.Request();
                request1.PolicyTargetKey = policyTargetKey;
                request1.PolicyValue = policyValue;
                request1.UpdateMask = updateMask;

                extensionInstallRequests.Add(request1);
            }

            extensionMgmt.Requests = extensionInstallRequests;
            string body = extensionMgmt.ToJson();

            string[] scope = { "https://www.googleapis.com/auth/chrome.management.policy" };
            string serviceURL = String.Format("https://chromepolicy.googleapis.com/v1/customers/{0}/policies/orgunits:batchModify", this.CustomerID);

            string token = this.GetAuthBearerToken(scope);
            var request = new RestRequest(Method.POST);

            RestClient client = new RestClient();
            Uri baseUrl = new Uri(serviceURL);
            client.BaseUrl = baseUrl;
            client.Timeout = base._timeout;

            request.AddHeader("Content-Type", "application/json");
            request.AddHeader("Authorization", String.Format("Bearer {0}", token));

            request.AddParameter("application/json", body, ParameterType.RequestBody);
            IRestResponse response = client.Execute(request);
            sb.AppendLine(String.Format("Response content {0}", response.Content));

            return sb.ToString();
        }

        /// <summary>
        /// Parse the extension install policy. This implementation is better than using Enum.Parse().
        /// </summary>
        /// <param name="value">Install policy</param>
        /// <returns>FORCED, ALLOWED, BLOCKED. Default is ALLOWED</returns>
        /// <exception cref="ApplicationException"></exception>
        private string ExtensionInstallPolicyParse(string value)
        {
            if (String.IsNullOrEmpty(value))
                throw new ApplicationException("Extension install type (FORCED, ALLOWED, BLOCKED) is required.");

            string ucaseValue = value.Trim().ToUpper();

            string forceInstall = "FORCED";
            string allowInstall = "ALLOWED";
            string blockInstall = "BLOCKED";

            if (String.Compare(value, forceInstall, true) == 0)
                return forceInstall;

            if (String.Compare(value, blockInstall, true) == 0)
                return blockInstall;

            return allowInstall;
        }

        public string BackupPolicies(string orgUnitId)
        {
            return this.BackupPoliciesByOU(orgUnitId, null);
        }

        /// <summary>
        /// Get the configured policies for the given OU
        /// </summary>
        /// <param name="orgUnitId"> OU ID</param>
        /// <param name="token">Auth token</param>
        /// <returns>Resolved policy file</returns>
        /// <exception cref="ApplicationException"></exception>
        private string BackupPoliciesByOU(string orgUnitId, string token)
        {
            string nextPageToken = String.Empty;
            string content = String.Empty;
            string responseUri = String.Empty;
            string serviceURL = String.Format("https://chromepolicy.googleapis.com/v1/customers/{0}/policies:resolve", this.CustomerID);
            ChromeMgmtPolicy chromeMgmtPolicy;
            StringBuilder stringBuilder = new StringBuilder();

            try
            {

                //set the org unit.
                cbcmSchema.ChromeBrowserPolicyRequest.PolicyTargetKey policyTargetKey = new cbcmSchema.ChromeBrowserPolicyRequest.PolicyTargetKey();
                policyTargetKey.TargetResource = String.Format("orgunits/{0}", orgUnitId);

                //build the request object.
                BrowserPolicyRequest browserPolicyRequest = new cbcmSchema.ChromeBrowserPolicyRequest.BrowserPolicyRequest();
                browserPolicyRequest.PolicyTargetKey = policyTargetKey;
                browserPolicyRequest.PolicySchemaFilter = "chrome.users.*";
                browserPolicyRequest.PageSize = 100;

                //Get a new token if needed.
                if (String.IsNullOrEmpty(token))
                {
                    string[] scope = { "https://www.googleapis.com/auth/chrome.management.policy" };
                    token = this.GetAuthBearerToken(scope);
                }

                UriBuilder builder = new UriBuilder(serviceURL);
                Uri baseUrl = new Uri(serviceURL);

                do
                {
                    browserPolicyRequest.PageToken = nextPageToken; 
                    string body = browserPolicyRequest.ToJson();

                    var request = new RestRequest(Method.POST);

                    RestClient client = new RestClient();                    
                    client.BaseUrl = baseUrl;
                    client.Timeout = base._timeout;

                    request.AddHeader("Content-Type", "application/json");
                    request.AddHeader("Authorization", String.Format("Bearer {0}", token));

                    request.AddParameter("application/json", body, ParameterType.RequestBody);
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

                    chromeMgmtPolicy = ChromeMgmtPolicy.FromJson(content);

                    //check if a matching browser was found and then add to list.
                    if (chromeMgmtPolicy != null)
                    {
                        if (chromeMgmtPolicy.ResolvedPolicies != null && chromeMgmtPolicy.ResolvedPolicies.Count > 0)
                            //foreach(ResolvedPolicy policy in chromeMgmtPolicy.ResolvedPolicies)
                            //  stringBuilder.AppendLine(policy.ToString());
                            stringBuilder.AppendLine(content);

                        //set next page token
                        nextPageToken = chromeMgmtPolicy.NextPageToken;
                    }

                } while (!String.IsNullOrEmpty(nextPageToken));

            }
            catch (Exception ex)
            {
                throw new ApplicationException(String.Format("Service URI: {0}\r\nContent: {1}.\r\n", responseUri, content), ex);
            }

            return stringBuilder.ToString();
        }

        /// <summary>
        /// Build the extension import policy object.
        /// </summary>
        /// <param name="extensionInstallPolicy">FORCED, ALLOWED, BLOCKED. Default is ALLOWED</param>
        /// <param name="appId">App and Extension ID</param>
        /// <param name="orgUnitId">OU ID</param>
        /// <returns></returns>
        private cbcmSchema.ExtensionPolicy.ExtensionMgmtPolicy BuildExtensionPolicyRequest(string extensionInstallPolicy, string appId, string orgUnitId)
        {
            //policyTargetKey
            cbcmSchema.ExtensionPolicy.PolicyTargetKey policyTargetKey = new cbcmSchema.ExtensionPolicy.PolicyTargetKey();
            policyTargetKey.TargetResource = String.Format("orgunits/{0}", orgUnitId);
            cbcmSchema.ExtensionPolicy.AdditionalTargetKeys additionalTargetKeys = new cbcmSchema.ExtensionPolicy.AdditionalTargetKeys();
            additionalTargetKeys.AppId = String.Format("chrome:{0}", appId);
            policyTargetKey.AdditionalTargetKeys = additionalTargetKeys;

            //Value
            cbcmSchema.ExtensionPolicy.Value value = new Value();
            value.AppInstallType = extensionInstallPolicy;
            //policyValue
            cbcmSchema.ExtensionPolicy.PolicyValue policyValue = new cbcmSchema.ExtensionPolicy.PolicyValue();
            policyValue.Value = value;
            policyValue.PolicySchema = "chrome.users.apps.InstallType";

            //updateMask
            cbcmSchema.ExtensionPolicy.UpdateMask updateMask = new cbcmSchema.ExtensionPolicy.UpdateMask();
            updateMask.Paths = "appInstallType";

            //requests
            cbcmSchema.ExtensionPolicy.Request request1 = new cbcmSchema.ExtensionPolicy.Request();
            request1.PolicyTargetKey = policyTargetKey;
            request1.PolicyValue = policyValue;
            request1.UpdateMask = updateMask;

            List<cbcmSchema.ExtensionPolicy.Request> extensionInstallRequests = new List<cbcmSchema.ExtensionPolicy.Request>();
            extensionInstallRequests.Add(request1);

            cbcmSchema.ExtensionPolicy.ExtensionMgmtPolicy extensionMgmt = new cbcmSchema.ExtensionPolicy.ExtensionMgmtPolicy();
            extensionMgmt.Requests = extensionInstallRequests;

            return extensionMgmt;
        }

    }
}
