/**
 * @file Tests for the canonical Google API scope list and the
 * `gcloud auth application-default login` formatter that consumes it.
 */

import { describe, it, expect } from "vitest";
import { GOOGLE_API_SCOPES } from "@/lib/google-scopes";

describe("GOOGLE_API_SCOPES", () => {
  it("includes every scope the CEP MCP server documents", () => {
    // Match cmcp/README.md so contract drift between the two repos
    // surfaces as a test failure instead of a silent permission gap.
    const cmcpScopes = [
      "https://www.googleapis.com/auth/chrome.management.policy",
      "https://www.googleapis.com/auth/chrome.management.reports.readonly",
      "https://www.googleapis.com/auth/chrome.management.profiles.readonly",
      "https://www.googleapis.com/auth/admin.reports.audit.readonly",
      "https://www.googleapis.com/auth/admin.directory.orgunit.readonly",
      "https://www.googleapis.com/auth/admin.directory.customer.readonly",
      "https://www.googleapis.com/auth/cloud-identity.policies",
      "https://www.googleapis.com/auth/apps.licensing",
      "https://www.googleapis.com/auth/cloud-platform",
    ];
    for (const scope of cmcpScopes) {
      expect(GOOGLE_API_SCOPES).toContain(scope);
    }
  });

  it("includes Pocket CEP's Admin SDK reads (user search + activity)", () => {
    expect(GOOGLE_API_SCOPES).toContain(
      "https://www.googleapis.com/auth/admin.directory.user.readonly",
    );
    expect(GOOGLE_API_SCOPES).toContain(
      "https://www.googleapis.com/auth/admin.reports.usage.readonly",
    );
  });

  it("contains no duplicates", () => {
    const unique = new Set(GOOGLE_API_SCOPES);
    expect(unique.size).toBe(GOOGLE_API_SCOPES.length);
  });

  it("only lists googleapis.com auth URLs", () => {
    for (const scope of GOOGLE_API_SCOPES) {
      expect(scope).toMatch(/^https:\/\/www\.googleapis\.com\/auth\//);
    }
  });
});
