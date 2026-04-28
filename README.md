# Chrome Browser Enterprise

This repository provides a collection of resources, scripts, and automation templates to help IT administrators manage Google Chrome at scale. Whether you are automating browser enrollment, managing policies via API, or deploying configurations across a global fleet, you will find the tools here.

---

## 🚀 Getting Started with APIs

To begin automating your Chrome Enterprise workflows, you must first configure your Google Cloud environment and enable the necessary APIs.

* **API Configuration Guide:** Follow the [Chrome Enterprise API Setup Guide](./docs/API_Get_Started.md) for step-by-step instructions on setting up your Google Cloud Project, creating service accounts, and obtaining the credentials required for the tools in this repository.

---

## 📂 Repository Structure

The repository is organized by technology stack and operating system to help you find the right tool for your environment:

* **[Python](./Python):** Contains Python-based scripts and samples for interacting with the Chrome Browser Cloud Management (CBCM) and Admin SDK APIs. Use these for custom reporting, bulk device management, and organizational unit (OU) automation.
* **[Terraform](./Terraform):** Provides HCL (HashiCorp Configuration Language) templates to manage your Google Cloud infrastructure. This includes automating the creation of projects, service accounts, and IAM roles specific to your Chrome Enterprise management environment.
* **[Custom Configuration](./Custom%20Configurations):** A collection of configuration files for fine-tuning Chrome behavior. This is ideal for administrators needing advanced policy templates not found in standard management consoles.
* **[Windows](./Windows):** OS-specific resources for Windows environments, including PowerShell and Batch scripts. Notable tools include scripts for enrolling or unenrolling devices from Chrome Enterprise Core (CEC).
* **[MCP Examples](./mcp-examples):** Reference applications that integrate with the [Chrome Enterprise Premium MCP server](https://github.com/google/chrome-enterprise-premium-mcp). Use these as starting points for building admin tools, AI assistants, or custom dashboards on top of Chrome Enterprise APIs.

---

## 🛠 Postman Collection

For developers and admins who want to test APIs without writing code, we maintain a comprehensive Postman workspace.

**[Access the Postman Collection](https://www.postman.com/google-chrome-enterprise-apis/google-chrome-enterprise-public/overview?sideView=agentMode)**

### What is included:
The collection contains pre-configured requests for the following APIs:

* **Chrome Enterprsie Core API:** Manage enrolled browsers and device tokens.
* **Chrome Policy API:** Programmatically view and set browser policies.
* **Chrome Management (Apps & Reports) APIs:** Audit installed extensions and generate usage reports.
* **Directory API:** Manage users and Organizational Units.
* **VersionHistory API:** Track the latest stable and beta releases of Chrome.

---

## 🤝 Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## 📄 License
See [LICENSE](LICENSE) for details.
