/**
 * @file Wrapper for `npm run dev:full`.
 *
 * Replaces the inline shell script that previously lived in
 * package.json. The wrapper:
 *
 *   1. Loads `.env` and `.env.local` into `process.env` (the same
 *      precedence Next.js uses at runtime), so `MCP_SERVER_CMD`
 *      written by `npm run setup` to `.env.local` survives all the
 *      way to the spawned MCP child.
 *   2. Resolves the MCP server command — `MCP_SERVER_CMD` if set,
 *      otherwise the canonical npx package name.
 *   3. Hands `next dev` and the MCP command to `concurrently` for
 *      parallel execution with named log streams. The MCP command
 *      is piped from `tail -f /dev/null` so its stdin never sees
 *      EOF (the upstream MCP server treats stdin EOF as a shutdown
 *      signal even in HTTP mode).
 *
 * Plain JS-style imports — no module-side state — so it can be
 * launched with `tsx` without any tsconfig massaging.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { MCP_NPX_COMMAND } from "../src/lib/constants";

/**
 * Loads `.env` then `.env.local` into `process.env`, leaving
 * shell-exported variables untouched (they take precedence). Mirrors
 * Next.js's load order so the dev script and the running app see
 * the same configuration.
 */
function loadEnvFiles(): void {
  for (const filename of [".env", ".env.local"]) {
    const filepath = resolve(process.cwd(), filename);
    if (!existsSync(filepath)) continue;
    const content = readFileSync(filepath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

loadEnvFiles();

// Default to the canonical npx command — see `MCP_NPX_COMMAND` for
// the flag rationale. `MCP_SERVER_CMD` from `.env.local` (or the
// shell) wins for contributors with a local checkout or a custom
// command.
const mcpCmd = process.env.MCP_SERVER_CMD?.trim() || MCP_NPX_COMMAND;

const concurrentlyArgs = [
  "concurrently",
  "--kill-others-on-fail",
  "-n",
  "app,mcp",
  "-c",
  "blue,green",
  "next dev",
  `tail -f /dev/null | GCP_STDIO=false PORT=4000 LOG_LEVEL=warn ${mcpCmd}`,
];

const child = spawn("npx", concurrentlyArgs, { stdio: "inherit" });

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
