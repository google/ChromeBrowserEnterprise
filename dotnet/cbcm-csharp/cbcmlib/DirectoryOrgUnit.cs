using System;
using System.Collections.Generic;
using RestSharp;
using RestSharp.Serialization.Json;
using cbcmSchema;
using System.Linq;
using System.Text;
using System.Threading.Tasks;


namespace cbcmlib
{
    /// <summary>
    /// https://developers.google.com/admin-sdk/directory/reference/rest/v1/orgunits/
    /// </summary>
    public sealed class DirectoryOrgUnit : AuthHelper
    {
        private const string Scope = "https://www.googleapis.com/auth/admin.directory.orgunit";

        public DirectoryOrgUnit(string keyFile, string scope) : base(keyFile, scope)
        {
        }

        public List<OrgUnit> GetAllOrganizationalUnits ()
        {
            string serviceURL = "https://www.googleapis.com/admin/directory/v1/customer/my_customer/orgunits?type=ALL";

            OrgUnits orgUnits = new OrgUnits();
            string token = this.GetAuthBearerToken();

            RestClient client = new RestClient(serviceURL);          

            
            var request = new RestRequest(Method.GET);
            request.AddHeader("Content-Type", "application/json");
            request.AddHeader("Authorization", String.Format("Bearer {0}", token));
            IRestResponse response = client.Execute(request);
            RestSharp.Serialization.Json.JsonDeserializer jsonDeserializer = new JsonDeserializer();
            orgUnits = jsonDeserializer.Deserialize<OrgUnits>(response);

            return orgUnits.organizationUnits;
        }
    }
}
