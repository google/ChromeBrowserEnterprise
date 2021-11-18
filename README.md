# cbe-rest-api

Use the [Chrome Browser Enterprise (CBE)](https://support.google.com/chrome/a/topic/9025410?hl=en&ref_topic=4386754) REST API to manage the Chrome browser in your orgnization. 

## Documentation
* [Getting Started](/docs/start.md)
* [Authentication](docs/auth.md)

## Postman
[Postman](https://www.postman.com/downloads/) allows you to create Workspaces, create API calls, validate APIs, convert to a different programming language, and share code.
- You can download or use the web based version.
- Create a new Workspace. You can name it what ever you like.
- Import the collections 
  - [App Details API.postman_collection](App%20Details%20API.postman_collection.json)
    - Here you can find sample request(s) to get detailed information about a specified app/extension and extension workflow requests.
  - [Chrome Browser Cloud Management API.postman_collection](Chrome%20Browser%20Cloud%20Management%20API.postman_collection.json) 
    - Here you can find sample requests to retrieve Chrome browser device data, update device data, move a browser between orgnization units (OUs), manage enrollement tokens, and delete a browser. 
  - [Chrome Management Reports API.postman_collection](Chrome%20Management%20Reports%20API.postman_collection.json)
    - Here you can find sample requests to get a report of installed Chrome versions, a report of devices that have an app installed, and a report of app install count.
  - [Chrome Policy API.postman_collection](Chrome%20Policy%20API.postman_collection.json)
    -  This is one of the most important APIs to view browser policies, change browser policies, policy inheritance, and manage extensions. You can find sample requests for various use cases in this collection.
  - [Directory API.postman_collection](Directory%20API.postman_collection.json)
    - This collection allows you to manage the organizational units (OU). Remember that OU hierarchy is limited to 35 levels of depth.

## Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License
See [LICENSE](LICENSE) for details.
