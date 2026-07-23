/**
 * @file Single source of truth for the Google API OAuth scopes Pocket
 * CEP and its upstream MCP server need.
 *
 * The list combines:
 *   - the Chrome Enterprise Premium MCP server's published scopes
 *     (see `cmcp/README.md`), so admin-tool calls work end-to-end;
 *   - Pocket CEP's own Admin SDK reads (user search and activity
 *     usage reports) which the MCP server doesn't request.
 */

/**
 * Canonical OAuth scopes required for Pocket CEP + the CEP MCP
 * server. Order is meaningful only for comparison with the cmcp README's
 * grouping for easy diffing.
 */
export const GOOGLE_API_SCOPES = [
  "https://www.googleapis.com/auth/chrome.management.policy",
  "https://www.googleapis.com/auth/chrome.management.reports.readonly",
  "https://www.googleapis.com/auth/chrome.management.profiles.readonly",
  "https://www.googleapis.com/auth/admin.reports.audit.readonly",
  "https://www.googleapis.com/auth/admin.reports.usage.readonly",
  "https://www.googleapis.com/auth/admin.directory.user.readonly",
  "https://www.googleapis.com/auth/admin.directory.orgunit.readonly",
  "https://www.googleapis.com/auth/admin.directory.customer.readonly",
  "https://www.googleapis.com/auth/cloud-identity.policies",
  "https://www.googleapis.com/auth/apps.licensing",
  "https://www.googleapis.com/auth/cloud-platform",
] as const;
