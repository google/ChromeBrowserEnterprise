/**
 * @file E2E tests that prove each scroll container actually scrolls.
 *
 * Guards against flex-col ancestors losing `min-h-0`, which makes a
 * scroll container grow to fit its content and leaves nothing to scroll.
 */

import { test, expect } from "@playwright/test";

async function mockUsers(page: import("@playwright/test").Page) {
  await page.route("**/api/users?q=**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ users: [] }),
    }),
  );
}

async function mockActivity(page: import("@playwright/test").Page, count: number) {
  const activity: Record<string, { eventCount: number }> = {};
  for (let i = 0; i < count; i++) {
    activity[`user-${i.toString().padStart(3, "0")}@example.com`] = {
      eventCount: 100 - i,
    };
  }
  await page.route("**/api/users/activity**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ activity }),
    }),
  );
}

test("chat panel scrolls when content overflows", async ({ page }) => {
  await mockUsers(page);
  await mockActivity(page, 0);

  await page.route("**/api/chat", async (route) => {
    const deltas = Array.from(
      { length: 120 },
      (_, i) =>
        `data: {"type":"text-delta","id":"t","delta":"Paragraph ${i + 1} — filler content to force overflow in the chat container.\\n\\n"}\n\n`,
    );
    const body = [
      'data: {"type":"start"}\n\n',
      'data: {"type":"start-step"}\n\n',
      'data: {"type":"text-start","id":"t"}\n\n',
      ...deltas,
      'data: {"type":"text-end","id":"t"}\n\n',
      'data: {"type":"finish-step"}\n\n',
      'data: {"type":"finish"}\n\n',
      "data: [DONE]\n\n",
    ].join("");
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: { "x-vercel-ai-ui-message-stream": "v1" },
      body,
    });
  });

  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto("/dashboard");
  await page.waitForURL(/\/dashboard/);

  const textarea = page.getByRole("textbox", { name: /Chat message input/i });
  await textarea.fill("Tell me a long story");
  await textarea.press("Enter");

  await expect(page.getByText(/Paragraph 120/)).toBeVisible({ timeout: 15_000 });

  const metrics = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>("[data-testid=chat-scroll]");
    if (!el) return null;
    return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
  });

  expect(metrics).not.toBeNull();
  expect(metrics!.scrollHeight).toBeGreaterThan(metrics!.clientHeight);
});

test("sidebar scrolls when the activity roster overflows", async ({ page }) => {
  await mockUsers(page);
  /**
   * A large activity map forces the activity roster to overflow the
   * sidebar viewport. The sidebar's inner wrapper should scroll, not
   * push the whole page.
   */
  await mockActivity(page, 80);

  await page.setViewportSize({ width: 1280, height: 380 });
  await page.goto("/dashboard");
  await page.waitForURL(/\/dashboard/);

  await expect(page.getByRole("heading", { name: "Recent activity" })).toBeVisible();
  await expect(page.getByText("user-000@example.com")).toBeVisible({ timeout: 10_000 });

  const metrics = await page.evaluate(() => {
    const aside = document.querySelector<HTMLElement>("aside");
    const scroller = aside?.querySelector<HTMLElement>("div[class*='overflow-y-auto']");
    if (!scroller) return null;
    return { scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight };
  });

  expect(metrics).not.toBeNull();
  expect(metrics!.scrollHeight).toBeGreaterThan(metrics!.clientHeight);
});
