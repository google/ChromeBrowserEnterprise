using System;
using System.Configuration;

namespace cbcmApp
{
   
    internal sealed class ConfigHelper
    {
        private AppSettingsReader appSettingsReader = null;

        /// <summary>
        /// Service Account Key File.json
        /// </summary>
        internal string AccountKeyFile { 
            get
            {
                return this.appSettingsReader.GetValue("account_key_file", typeof(string)).ToString();
            }

        }
        /// <summary>
        /// Customer ID. You can find by navigating to your Google Admin Console instance > Account > Account Settings.
        /// </summary>
        internal string CustomerID
        {
            get
            {
                return this.appSettingsReader.GetValue("customer_id", typeof(string)).ToString();
            }
        }

        /// <summary>
        /// If you configured domain wide delegation (DwD), then you will have to provide admin/delegated admin account name.
        /// </summary>
        internal string adminUserToImpersonate
        {
            get 
            {
                return this.appSettingsReader.GetValue("adminUserToImpersonate", typeof(string)).ToString();
            }
        }

        public ConfigHelper()
        {
            this.appSettingsReader = new AppSettingsReader();
        }


    }

}
