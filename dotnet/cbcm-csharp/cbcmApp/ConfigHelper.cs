using System;
using System.Configuration;

namespace cbcmApp
{
   
    internal sealed class ConfigHelper
    {
        private AppSettingsReader appSettingsReader = null;

        internal string AccountKeyFile { 
            get
            {
                return this.appSettingsReader.GetValue("account_key_file", typeof(string)).ToString();
            }

        }
        internal string CustomerID
        {
            get
            {
                return this.appSettingsReader.GetValue("customer_id", typeof(string)).ToString();
            }
        }

        public ConfigHelper()
        {
            this.appSettingsReader = new AppSettingsReader();
        }


    }

}
