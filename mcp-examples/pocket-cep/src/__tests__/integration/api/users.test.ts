/**
 * @file Tests for the Admin SDK query translation.
 */

import { describe, it, expect } from "vitest";
import { buildAdminQuery } from "@/lib/admin-sdk";

describe("buildAdminQuery", () => {
  it("converts email prefix into Admin SDK email: query", () => {
    expect(buildAdminQuery("alice@")).toBe("email:alice@*");
    expect(buildAdminQuery("alice@example.com")).toBe("email:alice@example.com*");
  });

  it("passes plain text as-is for name search", () => {
    expect(buildAdminQuery("Tim")).toBe("Tim");
    expect(buildAdminQuery("feeley")).toBe("feeley");
  });

  it("returns empty for empty query", () => {
    expect(buildAdminQuery("")).toBe("");
  });
});
