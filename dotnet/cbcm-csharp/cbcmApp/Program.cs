using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using cbcmClient;


namespace cbcmApp
{
    internal class Program
    {
        static void Main(string[] args)
        {
            string errorLogFile = "error_log.txt";
            try
            {
                //Read data from app config file.
                ConfigHelper config = new ConfigHelper();
                string accountKeyFile = config.AccountKeyFile;  //service account key file.

                if (String.IsNullOrEmpty(accountKeyFile))
                    throw new ApplicationException("Account key file is missing. Please configure the application configuration file.");

                string customerID = config.CustomerID;     //Customer ID. You can find by navigating to your Google Admin Console instance > Account > Account Settings.

                if (String.IsNullOrEmpty(customerID))
                    throw new ApplicationException("Customer ID is missing. Please configure the application configuration file.");

                // Test if input arguments were supplied.
                if (args.Length == 0)
                {
                    Program.HelpWithArguments();
                    return;
                }

                // Try to convert the input arguments to numbers. This will throw an exception if the argument is not a number.
                int firstArg;
                bool test = int.TryParse(args[0], out firstArg);
                if (!test)
                {
                    Program.HelpWithArguments();
                    return;
                }

                switch (firstArg)
                {
                    case 1: //print access token
                        Program.AccessToken(accountKeyFile, customerID);
                        break;

                    case 2: //log all OU data.
                        Program.GetAllOrganizationalUnits(accountKeyFile, customerID);
                        break;

                    case 3: //Find enrolled browsers with missing profile, extensions, and policies.
                        Program.GetBrowserDevicesWithMissingData(accountKeyFile, customerID);                      
                        break;
                    case 4: //Find browsers installed on user's app data folder. Applies to Windows OS platform only.
                        Program.GetBrowserDevicesInstalledOnUserAppDataFolder(accountKeyFile, customerID);  
                        break;
                    case 5: //Append to an OU extension installation allow list.
                        Program.PostExtensions(accountKeyFile, customerID, args[1], args[2]);
                        break;
                    default:
                        Program.HelpWithArguments();
                        Program.DumpsterDive(accountKeyFile, customerID);
                        break;
                }

                Console.ReadLine();
            }
            catch (Exception ex)
            {
                Log(ex.ToString(), errorLogFile);
                Console.WriteLine(ex.ToString());
            }
        }

        private static void HelpWithArguments()
        {
            Console.WriteLine("Please enter a numeric argument. Usage:");
            Console.WriteLine("1 Get Authorization Token.");
            Console.WriteLine("2 Get All Organizational Units (OU).");
            Console.WriteLine("3 Find enrolled browsers with missing data (profile, extensions, and policies).");
            Console.WriteLine("4 Find browsers installed on user's app data folder. Applies to Windows OS platform only.");
            Console.WriteLine("5 Append to an OU extension installation allow list. Second argument is the orgUnitId.");
        }

        /// <summary>
        /// Print the acces token.
        /// </summary>
        /// <param name="accountKeyFile">service account key file</param>
        /// <param name="customerID">Customer ID. You can find by navigating to your Google Admin Console instance > Account > Account Settings.</param>
        public static void AccessToken(string accountKeyFile, string customerID)
        {
            AuthorizationToken authorizationToken = new AuthorizationToken(accountKeyFile, customerID);
            Console.WriteLine(authorizationToken.AccessToken);
        }
        /// <summary>
        /// Get all OUs.
        /// </summary>
        /// <param name="accountKeyFile"></param>
        /// <param name="customerID">Customer ID. You can find by navigating to your Google Admin Console instance > Account > Account Settings.</param>
        public static void GetAllOrganizationalUnits(string accountKeyFile, string customerID)
        {
            DirectoryOrgUnit directoryOrgUnit = new DirectoryOrgUnit(accountKeyFile, customerID);
            string result = directoryOrgUnit.GetAllOrganizationalUnits();
            Console.WriteLine(result);
        }

        /// <summary>
        /// Find enrlled browsers that have a shell created in CBCM. These don't have details like Browser profile, extensions, and policies.
        /// </summary>
        /// <param name="accountKeyFile">service account key file</param>
        /// <param name="customerID">Customer ID. You can find by navigating to your Google Admin Console instance > Account > Account Settings.</param>
        private static void GetBrowserDevicesWithMissingData(string accountKeyFile, string customerID)
        {
            ChromeBrowser chromeBrowser = new ChromeBrowser(accountKeyFile, customerID);
            chromeBrowser.GetBrowsersWithMissingData();
        }

        /// <summary>
        /// Find browsers installed on user's app data folder. Applies to Windows devices only.
        /// </summary>
        /// <param name="accountKeyFile">service account key file</param>
        /// <param name="customerID">Customer ID. You can find by navigating to your Google Admin Console instance > Account > Account Settings.</param>
        /// <exception cref="NotImplementedException"></exception>
        private static void GetBrowserDevicesInstalledOnUserAppDataFolder(string accountKeyFile, string customerID)
        {
            ChromeBrowser chromeBrowser = new ChromeBrowser(accountKeyFile, customerID);
            chromeBrowser.GetBrowserDevicesInstalledOnUserAppDataFolder();
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="accountKeyFile">>service account key file</param>
        /// <param name="customerID">Customer ID. You can find by navigating to your Google Admin Console instance > Account > Account Settings.</param>
        /// <param name="orgUnitId">OU ID</param>
        /// <param name="extensionInstallType">Extension install type (ALLOWED, </param>
        public static void PostExtensions(string accountKeyFile, string customerID, string orgUnitId, string extensionInstallType)
        {
            throw new NotImplementedException();
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="accountKeyFile"></param>
        /// <param name="customerID"></param>
        /// <exception cref="NotImplementedException"></exception>
        private static void DumpsterDive(string accountKeyFile, string customerID)
        {
            ChromeBrowser chromeBrowser = new ChromeBrowser(accountKeyFile, customerID);
            chromeBrowser.GetAllEnrolledBrowsers();
        }

        public static void Log(string logMessage, string logfile)
        {
            //string fullPathToLogFile = Directory.GetCurrentDirectory() + @"\Error_log\" +  logfile;
            using (StreamWriter streamWriter = File.AppendText(logfile))
            {
                streamWriter.Write("\r\nLog Entry : ");
                streamWriter.WriteLine($"{DateTime.Now.ToLongTimeString()} {DateTime.Now.ToLongDateString()}");
                streamWriter.WriteLine("  :");
                streamWriter.WriteLine($"  :{logMessage}");
                streamWriter.WriteLine("-------------------------------");
            }
        }


    }

    enum ExtensionInstallType
    {
        ALLOWED,
        FORCED,
        BLOCKED
    }
}
