# Splunk Alert Action Quick Setup
### Option 1 (Splunk Cloud and Splunk Enterprise)
1. Zip (For Splunk Enterprise) or Tar(For Splunk Cloud and Enterprise) the `cbcm` folder.
2. Log in to Splunk Cloud/Enterprise and navigate to `Apps > Manage Apps`.
3. Click `Install app from file`.
4. For Splunk Enterprise click `Choose File` and select the zip/tar file that you want created in Step 1. For Splunk Cloud click the `Upload App` button and select the tar file that you created in Step 1. (You will have to sign in to your Splunk.com account)
5. Click on `Upload`.

### Option 2 (For Splunk Enterprise Only)
1. Open the `$SPLUNK_HOME/etc/apps/` directory 
2. Copy the `cbcm` directory into it. 
3. Restart the Splunk Enterprise instance.


# Splunk Alert Action Detailed Setup For Splunk Enterprise

> While following the below steps please create the directories if they do not exist.

> Please review Splunk guidance [here](https://dev.splunk.com/enterprise/docs/devtools/customalertactions/configappcaa/)

## Manual Setup For Splunk Enterprise
1. Open the `$SPLUNK_HOME/etc/apps/appname/appserver/static/` directory and place an image for the app icon within the directory. This should be a png file with size 48x48 pixel. In our example the appname is `cbcm` hence the directory path will be `$SPLUNK_HOME/etc/apps/cbcm/`. We have named the file as [app_icon.png](./cbcm/appserver/static/app_icon.png) in our example. Any custom name can be used to name the png file.

2. Open the `$SPLUNK_HOME/etc/apps/cbcm/default/` directory and create a file called [alert_actions.conf](./cbcm/default/alert_actions.conf).

    > Please note we have mentioned the root as `[cbcm]` in our case. This root value has to correspond to the name of the python script and html files.

3. In the `$SPLUNK_HOME/etc/apps/cbcm/default/` directory create a file called [app.conf](./cbcm/default/app.conf).

4. Open the `$SPLUNK_HOME/etc/apps/cbcm/default/data/ui/alerts` directory and create a file called [cbcm.html](./cbcm/default/data/ui/alerts/cbcm.html). The filename of the html file corresponds to the root element of the `alert_actions.conf` file as stated above.

    > Please note that the names of the various input elements in the html file (for e.g. `action.cbcm.param.custid`) have to correspond to the values specified in the `savedsearches.conf`.spec file.

5. Open the `$SPLUNK_HOME/etc/apps/cbcm/bin` directory and create a file called [cbcm.py](./cbcm/bin/cbcm.py).The filename of the python file corresponds to the root element of the `alert_actions.conf` file.

6. Open the `$SPLUNK_HOME/etc/apps/cbcm/bin` directory and create a file called [import_declare_test.py](./cbcm/bin/import_declare_test.py). This file helps import your libraries in the `lib` directory.

7. In the `$SPLUNK_HOME/etc/apps/cbcm/lib/` directory manually copy the python dependencies. The lib directory should look something like [this](./cbcm/lib/) once all dependencies have been copied.


8. Open the `$SPLUNK_HOME/etc/apps/cbcm/README/` directory and create a file called [savedsearches.conf.spec](./cbcm/README/savedsearches.conf.spec). The line items correspond to the html input elements of `cbcm.html`.

9. Open the `$SPLUNK_HOME/etc/apps/cbcm/metadata/` directory and add the [default.meta](./cbcm/metadata/default.meta) file.

10. Restart the Splunk Enterprise instance.