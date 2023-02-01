using System;
using System.Collections.Generic;
using System.Linq;
using System.IO;
using System.Text;
using System.Web;
using RestSharp;
using cbcmSchema;
using cbcmSchema.EnrollmentTokenSchema;

namespace cbcmClient
{
    public sealed class CBCMEnrollmentToken : BaseHelper
    {
        #region constructor
        public CBCMEnrollmentToken(string keyFile, string customerID) : base(keyFile)
        {
            this.CustomerID = customerID;
        }

        public CBCMEnrollmentToken(string keyFile, string customerID, string adminUserToImpersonate) : base(keyFile, adminUserToImpersonate)
        {
            this.CustomerID = customerID;
        }
        #endregion

        public cbcmSchema.EnrollmentTokenSchema.ChromeEnrollmentToken FindChromeEnrollmentToken(string token)
        {
            List < cbcmSchema.EnrollmentTokenSchema.ChromeEnrollmentToken > chromeEnrollmentTokenList  = this.GetAllEnrollmentToken();
            cbcmSchema.EnrollmentTokenSchema.ChromeEnrollmentToken result = null;

            if (chromeEnrollmentTokenList == null)
                return null;

            foreach(cbcmSchema.EnrollmentTokenSchema.ChromeEnrollmentToken item in chromeEnrollmentTokenList)
            {
                if(String.Compare(token, item.Token, StringComparison.OrdinalIgnoreCase) == 0)
                    result = item;
            }

            return result;
        }

        public List<cbcmSchema.EnrollmentTokenSchema.ChromeEnrollmentToken> GetAllEnrollmentToken()
        {
            string nextPageToken = String.Empty;
            List<cbcmSchema.EnrollmentTokenSchema.ChromeEnrollmentToken> chromeEnrollmentTokenList = new List<cbcmSchema.EnrollmentTokenSchema.ChromeEnrollmentToken>();
            string content = String.Empty;
            RestClient client;


            
            string[] scope = { "https://www.googleapis.com/auth/admin.directory.device.chromebrowsers" };
            string token = this.GetAuthBearerToken(scope);


            string serviceURL = String.Format("https://www.googleapis.com/admin/directory/v1.1beta1/customer/{0}/chrome/enrollmentTokens?pageSize=100&pageToken=", this.CustomerID);

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

                var chromeEnrollmentToken = cbcmSchema.EnrollmentTokenSchema.EnrollmentTokenItem.FromJson(content);

                //set next page token
                nextPageToken = chromeEnrollmentToken.NextPageToken;

                if (chromeEnrollmentToken.ChromeEnrollmentTokens != null)
                    chromeEnrollmentTokenList.AddRange(chromeEnrollmentToken.ChromeEnrollmentTokens);


            } while (!String.IsNullOrEmpty(nextPageToken));



            return chromeEnrollmentTokenList;
        }
    }
}
