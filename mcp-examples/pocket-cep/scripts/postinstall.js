#!/usr/bin/env node
/**
 * @file Prints a one-line hint after `npm install` when the project
 * hasn't been configured yet.
 *
 * Intentionally print-only: running an interactive prompt from
 * `postinstall` is hostile in CI, Docker builds, and anywhere
 * npm runs under a wrapper. The hint is silent when:
 *   - `.env.local` already exists (already configured)
 *   - stdout isn't a TTY (CI, piped output, Docker build)
 *   - `CI` is set (belt-and-braces with the TTY check)
 *
 * Plain JS (not TS) so we don't depend on `tsx` being resolved
 * before the postinstall phase completes. Exports its predicate and
 * message builder so tests can exercise the branches without a pty.
 */

"use strict";

const fs = require("node:fs");

/**
 * Pure predicate: should the hint be printed? Decoupled from the
 * environment so tests can drive every branch without a TTY.
 */
function shouldPrintHint({ envLocalExists, isTTY, isCI }) {
  if (envLocalExists) return false;
  if (!isTTY) return false;
  if (isCI) return false;
  return true;
}

/**
 * Builds the ANSI-colored hint string. Returned so callers can choose
 * whether to write it, swallow it, or assert against it in tests.
 */
function buildHint() {
  const bold = "\x1b[1m";
  const cyan = "\x1b[36m";
  const dim = "\x1b[2m";
  const reset = "\x1b[0m";
  return (
    `\n${bold}Pocket CEP${reset} ${dim}— no .env.local detected.${reset}\n` +
    `Run ${cyan}npm run setup${reset} to configure interactively.\n\n`
  );
}

if (require.main === module) {
  const shouldPrint = shouldPrintHint({
    envLocalExists: fs.existsSync(".env.local"),
    isTTY: Boolean(process.stdout.isTTY),
    isCI: Boolean(process.env.CI),
  });
  if (shouldPrint) process.stdout.write(buildHint());
}

module.exports = { shouldPrintHint, buildHint };
