/**
 * @file E2E tests for the landing page and route protection.
 */

import { test, expect } from "@playwright/test";

test.describe("Landing page", () => {
  test("renders with title and sign-in button", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Pocket CEP/);

    const signInButton = page.getByRole("button", { name: /Sign in with Google/i });
    await expect(signInButton).toBeVisible();
    await expect(signInButton).toBeEnabled();
  });

  test("sign-in button initiates OAuth redirect", async ({ page }) => {
    await page.goto("/");

    const matchesAuthRequest = (urlString: string) => {
      try {
        const u = new URL(urlString);
        return u.pathname.startsWith("/api/auth/") || u.hostname === "accounts.google.com";
      } catch {
        return false;
      }
    };

    const [request] = await Promise.all([
      page.waitForRequest((req) => matchesAuthRequest(req.url())),
      page.getByRole("button", { name: /Sign in with Google/i }).click(),
    ]);

    expect(matchesAuthRequest(request.url())).toBe(true);
  });
});

test.describe("Route protection", () => {
  test("unauthenticated /dashboard access redirects to /", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL("/");
  });

  test("unauthenticated nested dashboard paths also redirect", async ({ page }) => {
    await page.goto("/dashboard/some-nested-path");
    await expect(page).toHaveURL("/");
  });

  test("API routes return 401 without a session", async ({ request }) => {
    const usersResponse = await request.get("/api/users");
    expect(usersResponse.status()).toBe(401);

    const toolsResponse = await request.get("/api/tools");
    expect(toolsResponse.status()).toBe(401);

    const chatResponse = await request.post("/api/chat", {
      data: { message: "test", selectedUser: "test@test.com" },
    });
    expect(chatResponse.status()).toBe(401);
  });
});
