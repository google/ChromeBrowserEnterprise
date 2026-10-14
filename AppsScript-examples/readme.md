# 🛡️ Google Apps Script Examples — Chrome Browser Enterprise

> **Disclaimer:** The tools and scripts in this directory are **not officially supported Google products**. They are open-source reference utilities provided by the authors and contributors on an **"AS IS"** basis under the [Apache License 2.0](../LICENSE), without warranties, Service Level Agreements (SLAs), or technical support commitments of any kind.

---

## 📂 Available Applications

### [**CERA — Chrome Egress Risk Analysis (`./cera/` — `v2.0.11`)**](./cera/README.md)

**CERA (Chrome Egress Risk Analysis)** is a self-hosted Google Apps Script utility, bound to a Google Sheets spreadsheet, that reads a 7-day sample of Chrome Enterprise security log events and automatically generates an **executive Google Slides briefing deck** and a **multi-tab Google Sheets analytical workbook**.

* **1-Click Template Copy & One-Time Generation Lifecycle (`https://goo.gle/cera`):** Open [**`https://goo.gle/cera`**](https://goo.gle/cera) and click **Make a copy** (or deploy from source via `clasp push`). Each copied spreadsheet includes the **`CERA 2.0` Quick-Start Guide** landing tab and is designed for a **single, one-time report generation**—whenever you want to generate another report, return to [**`https://goo.gle/cera`**](https://goo.gle/cera) and make a fresh copy to guarantee a clean workbook state and the latest verified release.
* **100% In-Tenant Execution & Zero External Telemetry:** Runs entirely inside your organization's Google Workspace environment with zero external servers or telemetry, governed by [**`./cera/DISCLAIMER.md`**](./cera/DISCLAIMER.md) (`Apache 2.0`).
* **Action-Based Accuracy:** Folds multiple raw Chrome log rows into unique user actions across four outbound channels (**Personal Accounts**, **Shadow AI**, **Unmanaged Apps**, and **Web Messaging**), plus **Printing** and the **Security Signals Radar** (Safe Browsing, password reuse, flagged downloads, and browser launches).
* **Two 7-Day Ingestion Paths (`https://goo.gle/cera-logs` & Admin SDK):** Analyze a 7-day **Manual Export** from [**`https://goo.gle/cera-logs`**](https://goo.gle/cera-logs) (with automatic header & value normalization across English, Bahasa Indonesia, Japanese, Korean, and Simplified Chinese) or run **Direct Ingestion via the Admin SDK Reports API** (`50,000`-row partitions) with pre-flight volume estimation, **`⚡ Stop & Analyze Extracted Logs Now`**, and local zero-PII diagnostic logging (`logs/cera-diagnostic-log.txt`). Administrators first get a **Step 0 check** of the 3 Chrome reporting policies CERA needs.
* **Five Built-In Languages (`en`, `id`, `ja`, `ko`, `zh-CN`):** English (`en`), Bahasa Indonesia (`id`), 日本語 (`ja`), 한국어 (`ko`), and 简体中文 (`zh-CN`).

👉 **Get Started:**
* [**1-Click Google Sheets Template Copy (`goo.gle/cera`)**](https://goo.gle/cera)
* [**Chrome Log Events Admin Console Shortcut (`goo.gle/cera-logs`)**](https://goo.gle/cera-logs)
* [**Full Deployment Guide & Documentation (`./cera/README.md`)**](./cera/README.md)
* [**Disclaimer, Terms of Use & Tenant Privacy Policy (`./cera/DISCLAIMER.md`)**](./cera/DISCLAIMER.md)
* [**Apps Script Source Code (`./cera/appsscript/`)**](./cera/appsscript/)
* [**Report a Problem / Submit Product Feedback (`goo.gle/cera-feedback`)**](https://goo.gle/cera-feedback)
