using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using RestSharp;
using cbcmSchema.ExtensionPolicy;

namespace cbcmClient
{
    public sealed class ChromeMgmtPolicy : BaseHelper
    {
        public ChromeMgmtPolicy(string keyFile, string customerID, string adminUserToImpersonate) : base(keyFile, adminUserToImpersonate)
        {
            base.CustomerID = customerID;
        }

        public string BatchUploadExtensionsToOU(List<string> extensionIDs, string orgUnitId, string installPolicy)
        {
            string appInstallType = this.ExtensionInstallPolicyParse(installPolicy);
                       
            PolicyTargetKey policyTargetKey;
            PolicyValue policyValue;
            Value value;
            UpdateMask updateMask;
            Request request1;
            ExtensionMgmtPolicy extensionMgmt = new ExtensionMgmtPolicy();
            List<Request> extensionInstallRequests = new List<Request>();

            foreach (string extensionID in extensionIDs)
            {
                //policyTargetKey
                policyTargetKey = new PolicyTargetKey();
                policyTargetKey.TargetResource = String.Format("orgunits/{0}", orgUnitId);
                AdditionalTargetKeys additionalTargetKeys = new AdditionalTargetKeys();
                additionalTargetKeys.AppId = String.Format("chrome:{0}", extensionID);
                policyTargetKey.AdditionalTargetKeys = additionalTargetKeys;

                //Value
                value = new Value();
                value.AppInstallType = appInstallType;
                //policyValue
                policyValue = new PolicyValue();
                policyValue.Value = value;
                policyValue.PolicySchema = "chrome.users.apps.InstallType";

                //updateMask
                updateMask = new UpdateMask();
                updateMask.Paths = "appInstallType";

                //requests
                request1 = new Request();
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
            client.Timeout = -1;

            request.AddHeader("Content-Type", "application/json");
            request.AddHeader("Authorization", String.Format("Bearer {0}", token));

            request.AddParameter("application/json", body, ParameterType.RequestBody);
            IRestResponse response = client.Execute(request);

            return response.Content;
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

    }
}
