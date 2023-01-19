# Service account
A Service account is a credential used for server-to-server interactions, such as a faceless app that runs as a process to access some data or perform some operation.

## Create a service account
1. In the Google Cloud console, go to Menu > **IAM & Admin > Service Accounts**.
2. Click **Create service account**.
3. Fill in the service account details, then click **Create and continue**. Note: By default, Google creates a unique service account ID. If you want to change the ID, modify the ID in the service account ID field.
4. You do not have to assign roles (skip it).
5. Click **Continue**.
6. You do not have to grant users access to this service account (skip it).
7. Click **Done**.

## Create credentials for a service account
You need to obtain credentials in the form of a public/private key pair. Your code uses these credentials to authorize service account actions within your app.
To obtain credentials for your service account:
1. In the Google Cloud console, go to Menu > **IAM & Admin > Service Accounts**.
2. Select your service account.
3. Click **Keys > Add key > Create new key**.
4. Select **JSON**, then click **Create**. Your new public/private key pair is generated and downloaded to your machine as a new file. This file is the only copy of this key. For information about how to store your key securely, see [Managing service account keys](https://cloud.google.com/iam/docs/best-practices-for-managing-service-account-keys).
5. Click **Close**.

## Grant access to a service account
To call APIs, your service account needs to be granted special privileges in the Google Admin Console by a super administrator account.

### Create the Chrome Browser custom role
1. In the Google Admin console, go to Menu > **Account > Admin roles**.
2. Click **Create new role**.
3. Fill in the Role info details, then click **Continue**.
4. In **Select Privileges**, enable these Admin console privileges. 

**Organizational Units**. 

Note: This will automatically enable Admin API privileges for Organization Units, and you want to leave that in the enabled state.
- [x] Read
- [x] Create
- [x] Update
- [x] Delete

**Services > Chrome Management**
- [x] Manage User Settings
- [x] Managed Browsers
- [x] View Reports

5. Click **Create Role**

### Assign service account to the Chrome Browser custom role
1. Select the Chrome Browser custom role.
2. Click on **Assign role** in the **Admins** card.
3. Click on **Assign service accounts**.
4. Find your service account's "**client_email**" and copy the value to your clipboard. This data is found in the Credential JSON file you downloaded from earlier steps.
5. Paste the client email into the Add service account and click **Add**.
6. Click **Assign Role**.
