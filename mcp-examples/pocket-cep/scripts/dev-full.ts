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
import { loadEnvConfig } from "@next/env";
import { MCP_NPX_COMMAND } from "../src/lib/constants";

// Load environment variables using Next.js official loader (correct precedence)
loadEnvConfig(process.cwd());

console.log("\x1b[36m%s\x1b[0m", "┌  Pocket CEP — Developer Server Bootstrap");
console.log("\x1b[36m%s\x1b[0m", `│  AUTH_MODE     ${process.env.AUTH_MODE}`);
console.log("\x1b[36m%s\x1b[0m", `│  LLM_PROVIDER  ${process.env.LLM_PROVIDER || "default"}`);
console.log("\x1b[36m%s\x1b[0m", `│  MCP_SERVER    ${process.env.MCP_SERVER_URL || "http://localhost:4000/mcp"}`);
console.log("\x1b[36m%s\x1b[0m", "└───────────────────────────────────────────────────");


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
