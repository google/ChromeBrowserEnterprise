# 🛡️ Google Apps Script Examples — Chrome Browser Enterprise

> **Disclaimer:** The tools and scripts in this directory are **not officially supported Google products**. They are open-source reference utilities provided by the authors and contributors on an **"AS IS"** basis under the [Apache License 2.0](../LICENSE), without warranties, Service Level Agreements (SLAs), or technical support commitments of any kind.

---

## 📂 Available Applications

### [**CERA — Chrome Egress Risk Analysis (`./cera/`)**](./cera/README.md)

**CERA (Chrome Egress Risk Analysis)** is a self-hosted Google Apps Script add-on, bound to a Google Sheets spreadsheet, that reads a 7-day sample of Chrome Enterprise security log events and automatically generates an **executive Google Slides briefing deck** and a **multi-tab Google Sheets analytical workbook**.

* **100% In-Tenant Execution:** Runs entirely inside your organization's Google Workspace environment with zero external servers or telemetry.
* **Action-Based Accuracy:** Folds multiple raw Chrome log rows into unique user actions across four outbound channels (**Personal Accounts**, **Shadow AI**, **Unmanaged Apps**, and **Web Messaging**), plus **Printing** and the **Security Signals Radar** (Safe Browsing, password reuse, flagged downloads, and browser launches).
* **Two 7-Day Ingestion Paths:** Analyze a **Manual Export** from the Google Admin console (with automatic header & value normalization across English, Japanese, Korean, Simplified Chinese, and Indonesian) or run **Direct Ingestion via the Admin SDK Reports API** with automated Chrome Policy Pre-Check, pre-flight volume estimation, and partial-log analysis (**Stop & Analyze Extracted Logs Now**).
* **Five Languages:** English (`en`), Indonesian (`id`), Japanese (`ja`), Korean (`ko`), and Simplified Chinese (`zh-CN`).

👉 **Get Started:**
* [**Full Deployment Guide & Documentation (`./cera/README.md`)**](./cera/README.md)
* [**Disclaimer, Terms of Use & Tenant Privacy Policy (`./cera/DISCLAIMER.md`)**](./cera/DISCLAIMER.md)
* [**Source Code (`./cera/`)**](./cera/)
