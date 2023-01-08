# Creating and managing projects
## Creating a project
To create a project, you must have the resourcemanager.projects.create permission. This permission is included in roles like the Project Creator role (roles/resourcemanager.projectCreator). 

To create a new project, do the following:

1. Go to the **[Manage resources](https://console.cloud.google.com/cloud-resource-manager)** page in the Google Cloud console.
2. On the **Select organization** drop-down list at the top of the page, select the organization resource in which you want to create a project.
3. Click **Create** Project
4. In the New Project window that appears, enter a project name. A project name can contain only letters, numbers, single quotes, hyphens, spaces, or exclamation points, and must be between 4 and 30 characters.
5. Enter the parent organization or folder resource in the **Location** box. That resource will be the hierarchical parent of the new project. If No organization is the only option, you will need to reach out to your company Cloud admin.
6. When you're finished entering new project details, click **Create**.

## Get an existing project
You can get an existing project using the Google Cloud console. If you are not a project owner, you must have the permissions included in the Browser role (roles/browser).

To view a project using the Google Cloud console, do the following:
1. Go to the **[Dashboard page](https://console.cloud.google.com/home?_ga=2.56387567.536968724.1673197321-1348019484.1672850961)** in the Google Cloud console.
2. Click the Select from drop-down list at the top of the page. In the Select from window that appears, select your project.

## Shutting down (deleting) projects
You can shut down projects using the Google Cloud console. [Refer to this article](https://cloud.google.com/resource-manager/docs/creating-managing-projects) for additional information.

## Restoring a project
Project owners can restore a deleted project within the 30-day recovery period that starts when the project is shut down. [Refer to this article](https://cloud.google.com/resource-manager/docs/creating-managing-projects#restoring_a_project) for additional information.
