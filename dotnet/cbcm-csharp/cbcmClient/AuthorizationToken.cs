using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace cbcmClient
{
    public sealed class AuthorizationToken : BaseHelper
    {

        private string _customerID = String.Empty;

        public AuthorizationToken(string keyFile, string customerID, string adminUserToImpersonate) : base(keyFile, adminUserToImpersonate)
        {
            this._customerID = customerID;
        }

        public AuthorizationToken(string keyFile) : base(keyFile)
        {
        }

        public string AccessToken
        {
            get { return base.GetAuthBearerToken();  }

        }
        
    }
}
