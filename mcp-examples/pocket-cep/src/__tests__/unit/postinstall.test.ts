/**
 * @file Unit tests for the postinstall hint script.
 *
 * Covers both the pure predicate (every branch of the silent-vs-print
 * decision) and a subprocess smoke-test that the entry-point stays
 * silent under CI conditions.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SCRIPT_PATH = resolve(__dirname, "../../../scripts/postinstall.js");
const { shouldPrintHint, buildHint } = require(SCRIPT_PATH) as {
  shouldPrintHint: (args: { envLocalExists: boolean; isTTY: boolean; isCI: boolean }) => boolean;
  buildHint: () => string;
};

describe("shouldPrintHint", () => {
  it("prints when no .env.local, in a TTY, outside CI", () => {
    expect(shouldPrintHint({ envLocalExists: false, isTTY: true, isCI: false })).toBe(true);
  });

  it("is silent when .env.local already exists", () => {
    expect(shouldPrintHint({ envLocalExists: true, isTTY: true, isCI: false })).toBe(false);
  });

  it("is silent when stdout is not a TTY", () => {
    expect(shouldPrintHint({ envLocalExists: false, isTTY: false, isCI: false })).toBe(false);
  });

  it("is silent in CI even when the other conditions would print", () => {
    expect(shouldPrintHint({ envLocalExists: false, isTTY: true, isCI: true })).toBe(false);
  });

  it("is silent when every negative condition is true", () => {
    expect(shouldPrintHint({ envLocalExists: true, isTTY: false, isCI: true })).toBe(false);
  });
});

describe("buildHint", () => {
  it("mentions `npm run setup` (the primary CTA)", () => {
    expect(buildHint()).toContain("npm run setup");
  });

  it("mentions .env.local (the missing artifact)", () => {
    expect(buildHint()).toContain(".env.local");
  });

  it("wraps in ANSI reset sequences so it doesn't bleed color into the next line", () => {
    const hint = buildHint();
    const resetCount = (hint.match(/\x1b\[0m/g) ?? []).length;
    // Four colored spans (bold "Pocket CEP", dim "— no .env.local", cyan "npm run setup", dim ""),
    // each closed with \x1b[0m.
    expect(resetCount).toBeGreaterThanOrEqual(3);
  });
});

describe("postinstall script as a subprocess", () => {
  /**
   * Subprocess has stdio: 'pipe' so isTTY is false. This exercises the
   * silent-exit-on-non-TTY branch end-to-end, which is the
   * CI-equivalent path npm actually takes.
   */
  it("exits cleanly with no output when stdio is piped (non-TTY)", () => {
    const result = spawnSync("node", [SCRIPT_PATH], {
      stdio: "pipe",
      env: { ...process.env, CI: "" },
    });
    expect(result.status).toBe(0);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toBe("");
  });

  it("exits cleanly with no output when CI is set", () => {
    const result = spawnSync("node", [SCRIPT_PATH], {
      stdio: "pipe",
      env: { ...process.env, CI: "1" },
    });
    expect(result.status).toBe(0);
    expect(result.stdout.toString()).toBe("");
  });
});
