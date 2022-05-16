using System;
using System.Text;
using RestSharp;
using cbcmSchema.OU;

namespace cbcmClient
{
    /// <summary>
    /// https://developers.google.com/admin-sdk/directory/reference/rest/v1/orgunits/
    /// </summary>
    public sealed class DirectoryOrgUnit : BaseHelper
    {
        //private const string Scope = "https://www.googleapis.com/auth/admin.directory.orgunit";
        private const string LogFileName = "CBCM_DirectoryOrgUnit.txt";
        //private string _customerID = String.Empty;


        public DirectoryOrgUnit(string keyFile, string customerID, string adminUserToImpersonate) : base(keyFile, adminUserToImpersonate)
        {
            this.CustomerID = customerID;
        }

        public string GetAllOrganizationalUnits()
        {
            string serviceURL = String.Format("https://www.googleapis.com/admin/directory/v1/customer/{0}/orgunits?type=ALL", this.CustomerID);

            string token = this.GetAuthBearerToken();

            RestClient client = new RestClient(serviceURL);
            client.Timeout = base._timeout;


            var request = new RestRequest(Method.GET);
            request.AddHeader("Content-Type", "application/json");
            request.AddHeader("Authorization", String.Format("Bearer {0}", token));
            IRestResponse response = client.Execute(request);

            var orgUnits = OrgUnits.FromJson(response.Content);

            base.WriteToFile(LogFileName, this.CovertToCSV(orgUnits));

            return response.Content;
        }

        private string CovertToCSV(OrgUnits orgUnits)
        {
            StringBuilder stringBuilder = new StringBuilder();

            //write the header
            stringBuilder.AppendLine("orgUnitId, name,description,orgUnitPath,parentOrgUnitId,parentOrgUnitPath");

            if (orgUnits is null || orgUnits.OrganizationUnits is null)
                return stringBuilder.ToString();

            foreach(OrganizationUnit orgUnit in orgUnits.OrganizationUnits)
            {
                stringBuilder.AppendLine(String.Format("{0},{1},{2},{3},{4},{5}",
                    orgUnit.OrgUnitId,
                    orgUnit.Name,
                    orgUnit.Description,
                    orgUnit.OrgUnitPath,
                    orgUnit.ParentOrgUnitId,
                    orgUnit.ParentOrgUnitPath)
                    );
            }

            return stringBuilder.ToString();
        }
        
    }
}
