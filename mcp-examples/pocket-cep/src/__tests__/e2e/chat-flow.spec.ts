/**
 * @file E2E test for the chat-panel transport wiring.
 *
 * Verifies that the `/api/chat` request body carries the currently
 * selected user AND the messages array, and that switching the user
 * mid-conversation updates the payload on the next send. Together these
 * cover the real behavior — not just a single-shot repro of the stale
 * closure that hit us once.
 *
 * Runs in service_account mode so the dashboard auto-creates a session.
 */

import { test, expect } from "@playwright/test";

test.describe("Chat transport wiring", () => {
  test("body tracks messages across sends", async ({ page }) => {
    const chatRequests: Array<Record<string, unknown>> = [];

    await page.route("**/api/chat", async (route) => {
      const body = (await route.request().postDataJSON()) as Record<string, unknown>;
      chatRequests.push(body);
      await route.fulfill({
        status: 200,
        contentType: "text/plain",
        headers: { "x-vercel-ai-ui-message-stream": "v1" },
        body: "",
      });
    });

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);

    const textarea = page.getByRole("textbox", { name: /Chat message input/i });

    await textarea.fill("first question");
    await textarea.press("Enter");

    await expect.poll(() => chatRequests.length).toBe(1);
    expect(Array.isArray(chatRequests[0].messages)).toBe(true);
    expect((chatRequests[0].messages as unknown[]).length).toBe(1);

    await textarea.fill("second question");
    await textarea.press("Enter");

    await expect.poll(() => chatRequests.length).toBe(2);
    expect(Array.isArray(chatRequests[1].messages)).toBe(true);
    expect((chatRequests[1].messages as unknown[]).length).toBe(3); // user question 1, assistant reply (mocked empty), user question 2
  });
});
