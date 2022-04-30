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

        public AuthorizationToken(string keyFile, string customerID) : base(keyFile)
        {
            this._customerID = customerID;
        }

        public string AccessToken
        {
            get { return base.GetAuthBearerToken();  }

        }
        
    }
}
