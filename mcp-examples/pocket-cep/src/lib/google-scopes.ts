/**
 * @file Single source of truth for the Google API OAuth scopes Pocket
 * CEP and its upstream MCP server need.
 *
 * The list combines:
 *   - the Chrome Enterprise Premium MCP server's published scopes
 *     (see `cmcp/README.md`), so admin-tool calls work end-to-end;
 *   - Pocket CEP's own Admin SDK reads (user search and activity
 *     usage reports) which the MCP server doesn't request.
 *
 * Used by `src/lib/adc.ts` (service_account mode) and the setup CLI
 * (`scripts/setup.ts`) to print a single, paste-friendly
 * `gcloud auth application-default login` command. Keeping one list
 * means a new scope only needs to be added in one place to flow to
 * every surface that prints or consumes it.
 */

/**
 * Canonical OAuth scopes required for Pocket CEP + the CEP MCP
 * server. Order is meaningful only for the printed command (it
 * matches the cmcp README's grouping for easy diffing).
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

/**
 * Returns the single-line, paste-friendly
 * `gcloud auth application-default login --scopes="..."` command
 * with every scope comma-separated. Intentionally one line — when
 * the printed form spans wrapping rules the user can still copy it
 * with a single click-and-drag.
 */
export function formatGcloudLoginCommand(): string {
  const scopes = GOOGLE_API_SCOPES.join(",");
  return `gcloud auth application-default login --scopes="${scopes}"`;
}
