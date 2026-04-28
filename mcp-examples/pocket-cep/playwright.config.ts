/**
 * @file Playwright configuration for Pocket CEP E2E tests.
 *
 * Targets the local dev server on port 3001. Playwright will start the
 * server automatically if it's not already running.
 *
 * Run with: npm run test:e2e
 */

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "src/__tests__/e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:3000",
  },
  webServer: {
    command: "npm run dev",
    port: 3000,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
