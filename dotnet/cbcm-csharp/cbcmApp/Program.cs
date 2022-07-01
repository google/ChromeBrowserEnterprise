using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
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

                string adminUserToImpersonate = config.adminUserToImpersonate;

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
                        Program.AccessToken(accountKeyFile, customerID, adminUserToImpersonate);
                        break;

                    case 2: //log all OU data.
                        Program.GetAllOrganizationalUnits(accountKeyFile, customerID, adminUserToImpersonate);
                        break;
                    case 3: //Find enrolled browsers with missing profile, extensions, and policies.
                        Program.GetBrowserDevicesWithMissingData(accountKeyFile, customerID, adminUserToImpersonate);                      
                        break;
                    case 4: //Find browsers installed on user's app data folder. Applies to Windows OS platform only.
                        Program.GetBrowserDevicesInstalledOnUserAppDataFolder(accountKeyFile, customerID, adminUserToImpersonate);  
                        break;
                    case 5: //Append to an OU extension installation allow list.
                        Program.PostExtensions(accountKeyFile, customerID, adminUserToImpersonate, args[1], args[2], args[3]);
                        break;
                    case 6: //Move Chrome browser Devices between Organization Units 
                        Program.MoveChromeBrowserDevicesToOU(accountKeyFile, customerID, adminUserToImpersonate, args[1], args[2]);
                        break;
                    case 7: //Delete a Chrome browser Device 
                        Program.DeleteEnrolledBrowser(accountKeyFile, customerID, adminUserToImpersonate, args[1]);
                        break;
                    case 8: //backup policies for an Organizational Unit (OU)
                        Program.BackupBrowserPolicyByOU(accountKeyFile, customerID, adminUserToImpersonate, args[1]);
                        break;
                    case 100: //get detailed data from enrolled browsers.
                        Program.GetAllEnrolledBrowsers(accountKeyFile, customerID, adminUserToImpersonate, args.Length > 1 ? args[1] : String.Empty);
                        break;
                    default:
                        Program.HelpWithArguments();
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
            Console.WriteLine("4 Find browsers installed on the user's app data folder. Applies to Windows OS platform only.");
            Console.WriteLine(@"5 Bulk upload extension IDs to an OU with install policy. Required arguments OU ID, Install policy (ALLOWED, BLOCKED, FORCED), and file to CSV.\r\n\t Usage: cbcmapp.exe 5  ""OU ID"" ""BLOCKED"" ""C:/Temp/BatchUploadExtensions.csv""");
            Console.WriteLine(@"6 Move Chrome browser Devices between Organization Units. Required arguments OU path, and file to CSV.\r\n\t Usage: cbcmapp.exe 6  ""/OU Name"" ""C:/Temp/MoveDevices.csv""");
            Console.WriteLine(@"7 Delete enrolled browsers from the admin console. Required argument file to CSV.\r\n\t Usage: cbcmapp.exe 7  ""C:/Temp/deleteBrowsers.csv""");
            Console.WriteLine(@"8 Backup policies for an Organizational Unit (OU). Required arguments OU ID. \r\n\t Usage: cbcmapp.exe 8  ""OU ID""");
            Console.WriteLine(@"100 Get all enrolled browser data with an optional argument to query by orgnizational unit. \r\n\t Usage: cbcmapp.exe 100 \r\n\t cbcm.exe 100 ""/North America/Algonquin""");
        }

        /// <summary>
        /// Print the acces token.
        /// </summary>
        /// <param name="accountKeyFile">service account key file</param>
        /// <param name="customerID">Customer ID. You can find by navigating to your Google Admin Console instance > Account > Account Settings.</param>
        /// <param name="adminUserToImpersonate">If you configured domain wide delegation (DwD), then you will have to provide admin/delegated admin account name.</param>
        public static void AccessToken(string accountKeyFile, string customerID, string adminUserToImpersonate)
        {
            AuthorizationToken authorizationToken = new AuthorizationToken(accountKeyFile, customerID, adminUserToImpersonate);
            Console.WriteLine(authorizationToken.AccessToken);
        }
        /// <summary>
        /// Get all OUs.
        /// </summary>
        /// <param name="accountKeyFile">>service account key file</param>
        /// <param name="customerID">Customer ID. You can find by navigating to your Google Admin Console instance > Account > Account Settings.</param>
        /// <param name="adminUserToImpersonate">If you configured domain wide delegation (DwD), then you will have to provide admin/delegated admin account name.</param>
        public static void GetAllOrganizationalUnits(string accountKeyFile, string customerID, string adminUserToImpersonate)
        {
            DirectoryOrgUnit directoryOrgUnit = new DirectoryOrgUnit(accountKeyFile, customerID, adminUserToImpersonate);
            string result = directoryOrgUnit.GetAllOrganizationalUnits();
            Console.WriteLine(result);
        }

        /// <summary>
        /// Find enrlled browsers that have a shell created in CBCM. These don't have details like Browser profile, extensions, and policies.
        /// </summary>
        /// <param name="accountKeyFile">service account key file</param>
        /// <param name="customerID">Customer ID. You can find by navigating to your Google Admin Console instance > Account > Account Settings.</param>
        /// <param name="adminUserToImpersonate">If you configured domain wide delegation (DwD), then you will have to provide admin/delegated admin account name.</param>
        private static void GetBrowserDevicesWithMissingData(string accountKeyFile, string customerID, string adminUserToImpersonate)
        {
            ChromeBrowser chromeBrowser = new ChromeBrowser(accountKeyFile, customerID, adminUserToImpersonate);
            chromeBrowser.GetBrowsersWithMissingData();
        }

        /// <summary>
        /// Find browsers installed on user's app data folder. Applies to Windows devices only.
        /// </summary>
        /// <param name="accountKeyFile">service account key file</param>
        /// <param name="customerID">Customer ID. You can find by navigating to your Google Admin Console instance > Account > Account Settings.</param>
        /// <param name="adminUserToImpersonate">If you configured domain wide delegation (DwD), then you will have to provide admin/delegated admin account name.</param>
        /// <exception cref="NotImplementedException"></exception>
        private static void GetBrowserDevicesInstalledOnUserAppDataFolder(string accountKeyFile, string customerID, string adminUserToImpersonate)
        {
            ChromeBrowser chromeBrowser = new ChromeBrowser(accountKeyFile, customerID, adminUserToImpersonate);
            chromeBrowser.GetBrowserDevicesInstalledOnUserAppDataFolder();
        }

        /// <summary>
        /// Bulk add extensions to an orgnization unit. 
        /// </summary>
        /// <param name="accountKeyFile">>service account key file</param>
        /// <param name="customerID">Customer ID. You can find by navigating to your Google Admin Console instance > Account > Account Settings.</param>
        /// <param name="adminUserToImpersonate">If you configured domain wide delegation (DwD), then you will have to provide admin/delegated admin account name.</param>
        /// <param name="orgUnitId">OU ID</param>
        /// <param name="extensionInstallType">Extension install type (FORCED, ALLOWED, BLOCKED).</param>
        /// <param name="filePath">File path to CSV with no header data. Limit row count to 400 app IDs.</param>
        public static void PostExtensions(string accountKeyFile, string customerID, string adminUserToImpersonate, string orgUnitId, string extensionInstallType, string filePath)
        {
            if (String.IsNullOrEmpty(orgUnitId))
                throw new ArgumentNullException("OrgUnitId is required.");

            if (String.IsNullOrEmpty(extensionInstallType))
                throw new ArgumentNullException("Extension install type (FORCED, ALLOWED, BLOCKED) is required.");

            List<string> extensions = Program.ImportData(filePath);
            ChrometPolicyResolve chromeMgmtPolicy = new ChrometPolicyResolve(accountKeyFile, customerID, adminUserToImpersonate);
            string result = chromeMgmtPolicy.BatchUploadExtensionsToOU(extensions, orgUnitId.Trim(), extensionInstallType.Trim());
            Program.Log(result, "BatchUploadExtensionsToOu.txt");
        }
        /// <summary>
        /// Move a list of Chrome browser enrolled devices to a different orgnization unit.
        /// </summary>
        /// <param name="accountKeyFile">service account key file</param>
        /// <param name="customerID">Customer ID. You can find by navigating to your Google Admin Console instance > Account > Account Settings.</param>
        /// <param name="adminUserToImpersonate">If you configured domain wide delegation (DwD), then you will have to provide admin/delegated admin account name.</param>
        /// <param name="orgUnitPath">OU path</param>
        /// <param name="filePath">File path to CSV with no header data. Limit row count to 400 app IDs</param>
        public static void MoveChromeBrowserDevicesToOU(string accountKeyFile, string customerID, string adminUserToImpersonate, string orgUnitPath, string filePath)
        {
            if (String.IsNullOrEmpty(orgUnitPath))
                throw new ArgumentNullException("OrgUnitId is required.");

            ChromeBrowser chromeBrowser = new ChromeBrowser(accountKeyFile, customerID, adminUserToImpersonate);
            List<string> items = Program.ImportData(filePath);
            string result =  chromeBrowser.MoveChromeBrowsersToOu(items, orgUnitPath.Trim());
            Program.Log(result, "moveChromeBrowsersToOu.txt");
        }

        /// <summary>
        /// Delete a Chrome browser Device 
        /// </summary>
        /// <param name="accountKeyFile">>service account key file</param>
        /// <param name="customerID">>Customer ID. You can find by navigating to your Google Admin Console instance > Account > Account Settings.</param>
        /// <param name="adminUserToImpersonate">If you configured domain wide delegation (DwD), then you will have to provide admin/delegated admin account name.</param>
        /// <param name="filePath">File path to CSV with no header data. Limit row count to 400 app IDs</param>
        private static void DeleteEnrolledBrowser(string accountKeyFile, string customerID, string adminUserToImpersonate, string filePath)
        {
            ChromeBrowser chromeBrowser = new ChromeBrowser(accountKeyFile, customerID, adminUserToImpersonate);
            List<string> items = Program.ImportData(filePath);
            string result = chromeBrowser.DeleteChromeBrowsers(items);
            Program.Log(result, "deleteChromeBrowsers.txt");
        }
        /// <summary>
        /// 
        /// </summary>
        /// <param name="accountKeyFile">service account key file</param>
        /// <param name="customerID">Customer ID. You can find by navigating to your Google Admin Console instance > Account > Account Settings.</param>
        /// <param name="adminUserToImpersonate">If you configured domain wide delegation (DwD), then you will have to provide admin/delegated admin account name.</param>
        /// <param name="orgUnitId">OU ID</param>
        private static void BackupBrowserPolicyByOU(string accountKeyFile, string customerID, string adminUserToImpersonate, string orgUnitId)
        {
            ChrometPolicyResolve chrometPolicyResolve = new ChrometPolicyResolve(accountKeyFile, customerID);
            string result = chrometPolicyResolve.BackupPolicies(orgUnitId);
            Program.Log(result, String.Format("policybackup_{0}.json", orgUnitId));
        }

        /// <summary>
        /// Get full projection of enrolled browser data.
        /// </summary>
        /// <param name="accountKeyFile">service account key file</param>
        /// <param name="customerID">Customer ID. You can find by navigating to your Google Admin Console instance > Account > Account Settings.</param>
        /// <param name="adminUserToImpersonate">If you configured domain wide delegation (DwD), then you will have to provide admin/delegated admin account name.</param>
        /// <param name="orgUnitPath">The full path of the organizational unit or its unique ID.</param>
        private static void GetAllEnrolledBrowsers(string accountKeyFile, string customerID, string adminUserToImpersonate, string orgUnitPath)
        {
            ChromeBrowser chromeBrowser = new ChromeBrowser(accountKeyFile, customerID, adminUserToImpersonate);
            string result = chromeBrowser.GetAllEnrolledBrowsers(orgUnitPath);
            Program.Log(result, "all-enrolled-browser-data.json");
        }

       

        public static void Log(string logMessage, string logfile)
        {
            //string fullPathToLogFile = Directory.GetCurrentDirectory() + @"\Error_log\" +  logfile;
            using (StreamWriter streamWriter = File.AppendText(logfile))
            {
                streamWriter.WriteLine(logMessage);
            }
        }

        /// <summary>
        /// Import data from file.
        /// </summary>
        /// <param name="filePath">full path to data file.</param>
        /// <returns>List of items</returns>
        private static List<string> ImportData(string filePath)
        {
            if (!File.Exists(filePath))
                throw new FileNotFoundException(String.Format("Unable to find {0}", filePath));

            string[] separators = {","};
            string content = File.ReadAllText(filePath);
            string[] lines = content.Split(separators, StringSplitOptions.RemoveEmptyEntries);
            string[] linesTrimmed = lines.Select(line => line.Trim()).ToArray();

            if (linesTrimmed.Length < 1)
                throw new ApplicationException("Input file does not have data to process.");
            //max entries allowed for processing.
            int max = 400;

            if (linesTrimmed.Length > max)
                throw new ApplicationException(String.Format("{0} contains more than {1} entries. Please limit the entries to {1} or less.", filePath, max));

            return new List<string>(linesTrimmed);
        }


    }
}
