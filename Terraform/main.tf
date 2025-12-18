terraform {
  # 1. Connect to your Terraform Cloud Workspace
  # Note: Users must change the organization and workspace name to match their own TFC setup.
  cloud {
    organization = "YOUR_TFC_ORG_NAME"
    workspaces {
      name = "ChromePolicy"
    }
  }

  required_providers {
    googleworkspace = {
      source  = "hashicorp/googleworkspace"
      version = "~> 0.7.0"
    }
  }
}

provider "googleworkspace" {
  customer_id = var.customer_id
}

# Resource 1: Root Organizational Unit Policies
resource "googleworkspace_chrome_policy" "chrome_root_policy" {
  org_unit_id = var.root_org_unit_id

  policies {
    schema_name = "chrome.users.ChromeBrowserDmtokenDeletionEnabled"
    schema_values = {
      chromeBrowserDmtokenDeletionEnabled = jsonencode(true)
    }
  }
}

# Resource 2: Specific Managed Chrome Organizational Unit Policies
resource "googleworkspace_chrome_policy" "managed_chrome_policy" {
  org_unit_id = var.managed_chrome_org_unit_id

  # Policy: Android Management
  policies {
    schema_name = "chrome.users.MobileManagement"
    schema_values = {
      enableMobileChromePolicies = jsonencode(true)
    }
  }

  # Policy: iOS Management
  policies {
    schema_name = "chrome.users.ChromeOnIos"
    schema_values = {
      enableIosChromePolicies = jsonencode(true)
    }
  }

  # Policy: Browser Reporting
  policies {
    schema_name = "chrome.users.CloudReporting"
    schema_values = {
      cloudReportingEnabled = jsonencode(true)
    }
  }

  # Policy: Profile Reporting
  policies {
    schema_name = "chrome.users.CloudProfileReportingEnabled"
    schema_values = {
      cloudProfileReportingEnabled = jsonencode(true)
    }
  }

  # Policy: Upload Frequency (V2 Schema - Nested Object)
  policies {
    schema_name = "chrome.users.CloudReportingUploadFrequencyV2"
    schema_values = {
      cloudReportingUploadFrequency = jsonencode({
        duration = 3
      })
    }
  }

  # Policy: Safe Browsing Enforcement
  policies {
    schema_name = "chrome.users.DisableSafeBrowsingProceedAnyway"
    schema_values = {
      disableSafeBrowsingProceedAnyway = jsonencode(true)
    }
  }
}
