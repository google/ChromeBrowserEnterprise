variable "customer_id" {
  type        = string
  description = "The Google Workspace Customer ID (starts with C...). Found in Admin Console > Account > Account Settings."
}

variable "root_org_unit_id" {
  type        = string
  description = "The ID of the Root Organizational Unit (found in Admin Console URL as id:xxx)."
}

variable "managed_chrome_org_unit_id" {
  type        = string
  description = "The ID of the Target Organizational Unit for Managed Chrome policies."
}
