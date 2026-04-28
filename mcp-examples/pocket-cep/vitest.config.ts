/**
 * @file Vitest configuration for Pocket CEP.
 *
 * Sets up path aliases to match Next.js's @/* imports, uses the Node
 * environment (not jsdom) since we're testing server-side logic, and
 * enables global test functions (describe, it, expect) without imports.
 */

import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
    exclude: ["src/__tests__/e2e/**"],
  },
});
