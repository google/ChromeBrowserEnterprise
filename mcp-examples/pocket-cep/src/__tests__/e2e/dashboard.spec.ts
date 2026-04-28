/**
 * @file E2E tests for MCP server connectivity.
 * These require the MCP server to be running on port 4000.
 */

import { test, expect } from "@playwright/test";

test.describe("MCP server connectivity", () => {
  test("responds to tool list requests with valid data", async ({ request }) => {
    const response = await request.fetch("http://localhost:4000/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });

    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain("tools");
  });
});
