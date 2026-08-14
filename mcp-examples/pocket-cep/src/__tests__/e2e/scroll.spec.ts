/**
 * @file E2E tests that prove each scroll container actually scrolls.
 *
 * Guards against flex-col ancestors losing `min-h-0`, which makes a
 * scroll container grow to fit its content and leaves nothing to scroll.
 */

import { test, expect } from "@playwright/test";

test("chat panel scrolls when content overflows", async ({ page }) => {
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
