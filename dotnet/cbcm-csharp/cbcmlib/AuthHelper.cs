using System;
using System.IO;
using System.Threading.Tasks;
using Google.Apis.Auth.OAuth2;

namespace cbcmlib
{
    public class AuthHelper
    {
        private string _keyFile = string.Empty;
        private string _scope = String.Empty;

        public AuthHelper(string keyFile, string scope)
        {
            this._keyFile = keyFile;
            this._scope = scope;
        }

        internal string GetAuthBearerToken()
        {
            string bearer;
            GoogleCredential credential;

            using (Stream stream = new FileStream(this._keyFile, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                credential = GoogleCredential.FromStream(stream);
            }
            credential = credential.CreateScoped(new[] { this._scope });
            //credential = credential.CreateWithUser("niro-chrome-browser-readonly@cbcm-api-project-72514.iam.gserviceaccount.com");

            try
            {
                Task<string> task = ((ITokenAccess)credential).GetAccessTokenForRequestAsync();
                task.Wait();
                bearer = task.Result;

            }
            catch (AggregateException ex)
            {
                throw ex.InnerException;
            }

            return bearer;
        }
    }
}
