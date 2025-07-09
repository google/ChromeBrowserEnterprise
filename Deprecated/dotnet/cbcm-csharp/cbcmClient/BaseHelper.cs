using System;
using System.IO;
using System.Threading.Tasks;
using Google.Apis.Auth.OAuth2;

namespace cbcmClient
{
    public class BaseHelper
    {
        //private string _keyFile = string.Empty;
        private string _customerID = string.Empty;
        protected int _timeout = 3597;  //client timeout interval in seconds.
        protected string CustomerID { 
            get { return String.IsNullOrEmpty(_customerID) ? "my_customer" : this._customerID; }
            set { this._customerID = value; }
        }
        protected string KeyFile { get; set; }

        protected string AdminUserToImpersonate { get; set; }    

        private string[] _scopes = {"https://www.googleapis.com/auth/admin.directory.device.chromebrowsers.readonly"
                ,"https://www.googleapis.com/auth/admin.directory.device.chromebrowsers"
                ,"https://www.googleapis.com/auth/chrome.management.reports.readonly"
                ,"https://www.googleapis.com/auth/chrome.management.appdetails.readonly"
                ,"https://www.googleapis.com/auth/chrome.management.policy.readonly"
                ,"https://www.googleapis.com/auth/chrome.management.policy"
                ,"https://www.googleapis.com/auth/admin.directory.orgunit.readonly"
                ,"https://www.googleapis.com/auth/admin.directory.orgunit"
                ,"https://www.googleapis.com/auth/admin.reports.audit.readonly" };

        internal string LogOutputFormat = "csv";

        public BaseHelper(string keyFile)
        {
            this.KeyFile = keyFile;
        }
        

        public BaseHelper(string keyFile, string adminUserToImpersonate)
        {
            this.KeyFile = keyFile;
            this.AdminUserToImpersonate = adminUserToImpersonate;
        }

        internal string GetAuthBearerToken(string[] scopes)
        {
            string bearer;
            GoogleCredential credential;

            using (Stream stream = new FileStream(this.KeyFile, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                credential = GoogleCredential.FromStream(stream);
            }
            credential = credential.CreateScoped(scopes);
            //domain-wide delegation
            if (!String.IsNullOrEmpty(this.AdminUserToImpersonate))
                credential.CreateWithUser(this.AdminUserToImpersonate);

            try
            {
                Task<string> task = ((ITokenAccess)credential).GetAccessTokenForRequestAsync();
                task.Wait();
                bearer = task.Result;

            }
            catch (Exception ex)
            {
                throw ex;
            }

            return bearer;
        }

        internal string GetAuthBearerToken()
        {
            return this.GetAuthBearerToken(this._scopes);
        }

        internal void WriteToFile(string logFileName, string data)
        {
            string logfiilefullname = String.Format("{0}_{1}.{2}",
                logFileName,
                DateTime.Now.ToString("MM-dd-yyyy_hh-mm-ss"),
                this.LogOutputFormat);

            using (StreamWriter sw = File.AppendText(logfiilefullname))
            {
                sw.WriteLine(data);
            }
        }

    }
}
