/**
 * @file Environment diagnostic script for Pocket CEP.
 *
 * Run with: npm run doctor (or: npx tsx src/lib/doctor.ts)
 *
 * The doctor is flavor-aware: it tells you which of the four
 * mode × provider combinations is active (service_account|user_oauth
 * × claude|gemini), what that means in practice, and which runtime
 * probes matter for the active flavor.
 *
 * Output is grouped into phases so a failure is easy to locate:
 *   - Static (files + schema + placeholder secrets)
 *   - Google credentials (ADC — service_account only)
 *   - LLM provider (Anthropic or Google AI key)
 *   - MCP server (reachable + tool/prompt inventory)
 *
 * Renders with `@clack/prompts` for visual consistency with the
 * setup CLI — same connected-bar idiom, same step markers, same
 * spinner during the auto-start of the managed MCP server.
 *
 * Independent probes fan out in parallel so the whole run is bounded
 * by the single slowest external call. Library log lines tagged with
 * `LOG_TAGS` are muted while probes run so they don't interleave with
 * the doctor's own output.
 *
 * Exit code 0 = all checks passed, 1 = at least one failed.
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { spawn, type ChildProcess } from "node:child_process";
import * as p from "@clack/prompts";
import { serverSchema, type ServerEnv } from "./env";
import { getErrorMessage } from "./errors";
import { isAuthError } from "./auth-errors";
import {
  DEFAULT_MCP_URL,
  LOG_TAGS,
  MCP_NPX_ARGS,
  MCP_NPX_COMMAND,
  MCP_NPX_PACKAGE,
} from "./constants";
import { getDefaultModelId } from "./models";
import {
  probeMcpServer,
  probeAnthropicKey,
  probeGeminiKey,
  probeAdcToken,
  type CheckResult,
} from "./doctor-checks";

/**
 * Structured check result the doctor emits to clack. `pass`/`fail`/`skip`
 * map to `p.log.success` / `p.log.error` / `p.log.info`; warnings get
 * `p.log.warn`. `details` are printed as continuation lines under the
 * title.
 */
type Status = "pass" | "fail" | "warn" | "skip";

type CheckLine = {
  status: Status;
  title: string;
  details?: string[];
};

/**
 * Distinguishes the auto-start failure modes so the doctor's output
 * can name what actually went wrong: spawn never started (e.g. npx
 * missing), child started then exited (most often the upstream MCP's
 * stdin-EOF shutdown), or the polling budget elapsed while the child
 * kept running (typical when a slow registry hangs `npx`).
 */
type AutoStartFailure =
  | { kind: "spawn_error"; error: Error }
  | { kind: "child_exited"; code: number | null; output: string }
  | { kind: "timeout"; output: string };

/**
 * 30s is enough for a fast registry round-trip + first-time install;
 * longer than that on `npx --prefer-online` usually means a slow or
 * blocking corporate proxy, which is better surfaced to the user as a
 * timeout-with-suggestion than a 60s wait.
 */
const AUTO_START_TIMEOUT_MS = 30_000;
const AUTO_START_HINT_AFTER_MS = 10_000;

/**
 * Strips CSI/SGR ANSI sequences (colours, cursor moves) from npm/npx
 * output before measuring or displaying it. Top-level so the regex
 * isn't recompiled on every chunk.
 */
const ANSI_ESCAPE_RE = /\u001b\[[0-9;]*[A-Za-z]/g;

/**
 * Formats one captured line of npx output for display under the
 * doctor spinner. Truncates to the current terminal width so clack's
 * in-place redraw doesn't wrap (a wrapped spinner line redraws on a
 * fresh row each tick instead of overwriting itself).
 */
function formatActivityLine(line: string): string {
  const cols = process.stdout.columns ?? 80;
  // Reserve a few columns for the clack glyph, padding, and the
  // `npx: ` prefix below.
  const prefix = "npx: ";
  const room = Math.max(20, cols - prefix.length - 8);
  const trimmed = line.length > room ? line.slice(0, Math.max(0, room - 1)) + "…" : line;
  return prefix + trimmed;
}

/**
 * Starts the upstream MCP server temporarily and waits for it to
 * become reachable. Honours `MCP_SERVER_CMD` so contributors with a
 * working alternative (local cmcp checkout, registry override, etc.)
 * can avoid the npx path. Used by the MCP probe when the URL is the
 * managed default and the user almost certainly hasn't started the
 * server themselves.
 *
 * Returns the live probe result + the child handle on success, or a
 * structured {@link AutoStartFailure} so the failure path can pick
 * an accurate fix hint.
 */
async function tryStartManagedMcpServer(
  url: string,
): Promise<
  { ok: true; child: ChildProcess; result: CheckResult } | { ok: false; failure: AutoStartFailure }
> {
  const cmdOverride = process.env.MCP_SERVER_CMD?.trim();
  const description = cmdOverride ?? MCP_NPX_COMMAND;

  // Long message printed once before the spinner — clack's spinner
  // redraws in place, and a message that overflows the terminal width
  // breaks the redraw (each frame shows up on a new line). Keep
  // spinner messages short; carry the discoverable hint in a one-time
  // log line above it.
  p.log.info(`MCP server not running. Auto-starting:\n${description}`);

  const spinner = p.spinner();
  spinner.start("Probing reachability…");

  // `stdio: ["pipe", "pipe", "pipe"]` — keep an open writable pipe on
  // the child's stdin (the upstream MCP server treats stdin EOF as a
  // shutdown signal even in HTTP mode) and capture stdout/stderr so
  // doctor can show the upstream error if the child exits early.
  const env = { ...process.env, PORT: "4000", GCP_STDIO: "false", LOG_LEVEL: "error" };
  const child = cmdOverride
    ? spawn(cmdOverride, { env, stdio: ["pipe", "pipe", "pipe"], shell: true })
    : spawn("npx", [...MCP_NPX_ARGS, MCP_NPX_PACKAGE], {
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });

  const MAX_BUFFER = 4096;
  let captured = "";
  let latestLine = "";
  const append = (chunk: Buffer | string) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
    captured += text;
    if (captured.length > MAX_BUFFER) captured = captured.slice(-MAX_BUFFER);

    // Track the most recent non-blank line so the polling loop can
    // mirror it under the spinner. ANSI colour codes are stripped so
    // the truncation math stays in display-character units.
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.replace(ANSI_ESCAPE_RE, "").trim())
      .filter(Boolean);
    if (lines.length > 0) latestLine = lines[lines.length - 1];
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);

  let spawnError: Error | null = null;
  child.once("error", (err) => {
    spawnError = err instanceof Error ? err : new Error(String(err));
  });

  const startedAt = Date.now();
  const deadline = startedAt + AUTO_START_TIMEOUT_MS;
  let hintShown = false;
  let firstIteration = true;

  while (Date.now() < deadline) {
    if (spawnError !== null) {
      spinner.stop("npx couldn't start");
      if (!child.killed) child.kill("SIGTERM");
      return { ok: false, failure: { kind: "spawn_error", error: spawnError } };
    }
    if (child.exitCode !== null) {
      spinner.stop(`MCP child exited early (code ${child.exitCode ?? "null"})`);
      return {
        ok: false,
        failure: { kind: "child_exited", code: child.exitCode, output: captured.trim() },
      };
    }

    // Prefer mirroring whatever npx just printed — a moving line is
    // far more reassuring than a static "Probing…" while a slow
    // registry churns. Fall back to the override hint only when
    // there's been no output at all by the threshold.
    if (latestLine) {
      spinner.message(formatActivityLine(latestLine));
    } else if (!hintShown && Date.now() - startedAt > AUTO_START_HINT_AFTER_MS) {
      // Short message — clack's spinner redraws in place and long
      // messages that wrap break the redraw. The discoverable
      // override hint was already printed above the spinner.
      spinner.message("Still trying… (set MCP_SERVER_CMD in .env.local to skip)");
      hintShown = true;
    }

    if (!firstIteration) {
      await new Promise((r) => setTimeout(r, 500));
    }
    firstIteration = false;

    const probe = await probeMcpServer(url);
    if (probe.ok) {
      spinner.stop(`MCP server reachable (started by doctor)`);
      return { ok: true, child, result: probe };
    }
  }

  spinner.stop(`Auto-start timed out after ${AUTO_START_TIMEOUT_MS / 1000}s`);
  if (!child.killed) child.kill("SIGTERM");
  return { ok: false, failure: { kind: "timeout", output: captured.trim() } };
}

/**
 * Minimal .env parser — handles `KEY=VALUE`, blank lines, and `#`
 * comments. No quoting, no multiline, no variable expansion. We keep
 * it trivial so doctor's diagnostics aren't confounded by parser
 * quirks.
 */
function parseEnvFile(filePath: string): Record<string, string> {
  const content = readFileSync(filePath, "utf-8");
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    env[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1).trim();
  }
  return env;
}

/**
 * Loads env files the same way Next.js does: .env first, then
 * .env.local overrides. Starts from process.env so any
 * shell-exported vars are included too.
 */
function loadEnvFiles(): Record<string, string> {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  );
  for (const filename of [".env", ".env.local"]) {
    const filepath = resolve(process.cwd(), filename);
    if (!existsSync(filepath)) continue;
    Object.assign(env, parseEnvFile(filepath));
  }
  return env;
}

/**
 * Silences structured library logs (`[auth]`, `[mcp]`, `[users]`, …)
 * so they don't interleave with the doctor's clack output. Anything
 * without a known prefix is still printed so a library crash remains
 * visible. Returns a restore function.
 */
function muteLibraryLogs(): () => void {
  const knownPrefixes = Object.values(LOG_TAGS);
  const isTagged = (first: unknown) =>
    typeof first === "string" && knownPrefixes.some((tag) => first.startsWith(tag));

  const originalLog = console.log;
  const originalInfo = console.info;
  const originalError = console.error;
  const originalWarn = console.warn;

  const make = (original: typeof console.log) => {
    return (...args: unknown[]) => {
      if (args.length > 0 && isTagged(args[0])) return;
      original(...args);
    };
  };

  console.log = make(originalLog);
  console.info = make(originalInfo);
  console.error = make(originalError);
  console.warn = make(originalWarn);

  return () => {
    console.log = originalLog;
    console.info = originalInfo;
    console.error = originalError;
    console.warn = originalWarn;
  };
}

/**
 * Renders a {@link CheckLine} via the right clack log helper. Details
 * are appended as continuation text — clack's log methods accept
 * multi-line strings and indent them under the title automatically.
 */
function printCheckLine(line: CheckLine) {
  const body = line.details && line.details.length > 0 ? `\n${line.details.join("\n")}` : "";
  const message = line.title + body;
  switch (line.status) {
    case "pass":
      p.log.success(message);
      return;
    case "fail":
      p.log.error(message);
      return;
    case "warn":
      p.log.warn(message);
      return;
    case "skip":
      p.log.info(message);
      return;
  }
}

/**
 * Prints a phase header + each check beneath it. Replaces the prior
 * `printSection` (raw ANSI). Each phase is one `p.log.step` followed
 * by N status lines.
 */
function printPhase(title: string, subtitle: string, lines: CheckLine[]) {
  p.log.step(`${title} — ${subtitle}`);
  for (const line of lines) printCheckLine(line);
}

/**
 * Human-readable explanation of the active flavor. Two blurbs so new
 * engineers can see — just from doctor output — which of the four
 * mode × provider combinations the app will boot with.
 */
function activeFlavorNote(data: ServerEnv): string {
  // Each blurb stays under ~60 chars so the boxed `p.note()` doesn't
  // wrap and break the right border. Longer rationale lives in
  // README's Auth Modes / LLM Providers sections.
  const authBlurb =
    data.AUTH_MODE === "service_account"
      ? "Shared identity, server-side ADC, no user sign-in."
      : "Per-user sign-in, OAuth token forwarded to MCP.";
  const providerBlurb =
    data.LLM_PROVIDER === "claude" ? "Claude via @ai-sdk/anthropic." : "Gemini via @ai-sdk/google.";
  const resolvedModel = data.LLM_MODEL || getDefaultModelId(data.LLM_PROVIDER);
  const modelSuffix = data.LLM_MODEL ? "(override)" : "(default)";

  return (
    `AUTH_MODE     ${data.AUTH_MODE}\n` +
    `              ${authBlurb}\n` +
    `LLM_PROVIDER  ${data.LLM_PROVIDER}\n` +
    `              ${providerBlurb}\n` +
    `LLM_MODEL     ${resolvedModel} ${modelSuffix}`
  );
}

/**
 * Turns a CheckResult into the display shape. Failures get a "fix"
 * detail and a "why" detail; successes show the shortest useful fact
 * about what was actually exercised.
 */
function staticCheck(ok: boolean, title: string, detail?: string): CheckLine {
  return { status: ok ? "pass" : "fail", title, details: detail ? [detail] : undefined };
}

function probeLine(result: CheckResult, why: string, fixHint?: string): CheckLine {
  if (result.ok) {
    return { status: "pass", title: result.message, details: why ? [why] : undefined };
  }
  return {
    status: "fail",
    title: result.message,
    details: [fixHint ?? "Fix the above and retry `npm run doctor`.", why].filter(Boolean),
  };
}

/**
 * Maps an auto-start failure to a user-facing fix hint that names
 * what actually went wrong, so "auto-start failed" doesn't always
 * mean "we waited and gave up" when the real problem was the child
 * exiting in the first second.
 */
function autoStartFailureFix(failure: AutoStartFailure): string {
  switch (failure.kind) {
    case "spawn_error":
      return `Doctor couldn't run \`npx\` (${failure.error.message}). Run \`npm run dev:full\` manually.`;
    case "child_exited":
      return `Doctor's \`npx\` child exited early (code ${failure.code ?? "null"}). Run \`npm run dev:full\` manually to see the upstream error.`;
    case "timeout":
      return `Auto-start didn't become reachable in ${AUTO_START_TIMEOUT_MS / 1000}s. Set \`MCP_SERVER_CMD\` in .env.local to a working command (e.g. a local checkout) or run \`npm run dev:full\` manually.`;
  }
}

function describeMcpFailure(method: string, reason: unknown): CheckLine {
  const message = isAuthError(reason) ? reason.displayMessage : getErrorMessage(reason);
  return {
    status: "fail",
    title: `MCP ${method} failed — ${message}`,
    details:
      isAuthError(reason) && reason.command
        ? [`Fix: ${reason.command}`, `Why: ${reason.remedy}`]
        : [`Why: the MCP server replied to ${method} with an error.`],
  };
}

function countPasses(lines: CheckLine[]) {
  return lines.filter((l) => l.status === "pass").length;
}

function countFailures(lines: CheckLine[]) {
  return lines.filter((l) => l.status === "fail").length;
}

/**
 * Main diagnostic flow. Probes fan out in parallel; their results are
 * collected into phase buffers and printed via clack at the end so
 * the output stays readable even under interleaved async.
 */
async function main() {
  p.intro("Pocket CEP — Environment Check");

  const envPath = resolve(process.cwd(), ".env");
  const envLocalPath = resolve(process.cwd(), ".env.local");
  const envLocalPresent = existsSync(envLocalPath);

  const staticLines: CheckLine[] = [
    staticCheck(existsSync(envPath), ".env file found", ".env holds non-secret defaults."),
    staticCheck(
      envLocalPresent,
      ".env.local file found",
      envLocalPresent
        ? ".env.local holds your secrets. Not committed (gitignored)."
        : "Run: cp .env.local.example .env.local — then add your BETTER_AUTH_SECRET and LLM key.",
    ),
  ];

  const env = loadEnvFiles();
  // Inject loaded values into process.env so downstream code (the
  // MCP auto-spawn, library calls, anything reading process.env
  // directly) sees `.env.local` settings the same way Next.js does
  // at runtime. Shell-exported vars take precedence — we only fill
  // the gaps.
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  const parseResult = serverSchema.safeParse(env);

  if (!parseResult.success) {
    staticLines.push({
      status: "fail",
      title: "Environment variables failed validation",
      details: parseResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
    printPhase("Static", "files + env schema", staticLines);
    finishWithSummary(countFailures(staticLines), countPasses(staticLines));
    return;
  }

  const data = parseResult.data;
  const isPlaceholder = data.BETTER_AUTH_SECRET === "please-change-me-to-a-real-secret";

  staticLines.push(
    staticCheck(true, "Environment variables valid (Zod schema passed)"),
    staticCheck(
      !isPlaceholder,
      isPlaceholder
        ? "BETTER_AUTH_SECRET is still the placeholder"
        : "BETTER_AUTH_SECRET is set to a real value",
      isPlaceholder
        ? "Generate a real secret with: openssl rand -base64 32"
        : "Rotating this invalidates every active session.",
    ),
  );

  p.note(activeFlavorNote(data), "Active flavor");

  let restoreConsole = muteLibraryLogs();

  const needsAdc = data.AUTH_MODE === "service_account";
  const adcPromise: Promise<CheckResult | null> = needsAdc
    ? probeAdcToken()
    : Promise.resolve(null);

  const providerKey =
    data.LLM_PROVIDER === "claude" ? data.ANTHROPIC_API_KEY : data.GOOGLE_AI_API_KEY;
  const providerPromise: Promise<CheckResult | null> = providerKey
    ? data.LLM_PROVIDER === "claude"
      ? probeAnthropicKey(data.ANTHROPIC_API_KEY)
      : probeGeminiKey(data.GOOGLE_AI_API_KEY)
    : Promise.resolve(null);

  const mcpPromise = probeMcpServer(data.MCP_SERVER_URL);

  const [adcResult, providerResult, initialMcpResult] = await Promise.all([
    adcPromise,
    providerPromise,
    mcpPromise,
  ]);

  // If the URL is the managed default and the probe failed, the user
  // is almost certainly on the managed flow and hasn't run dev:full
  // themselves. Auto-start the server so the probe is meaningful.
  let mcpResult = initialMcpResult;
  let mcpChild: ChildProcess | null = null;
  let autoStartFailure: AutoStartFailure | null = null;
  if (!initialMcpResult.ok && data.MCP_SERVER_URL === DEFAULT_MCP_URL) {
    restoreConsole();
    const outcome = await tryStartManagedMcpServer(data.MCP_SERVER_URL);
    if (outcome.ok) {
      mcpResult = outcome.result;
      mcpChild = outcome.child;
    } else {
      autoStartFailure = outcome.failure;
    }
    restoreConsole = muteLibraryLogs();
  }

  // Cover three exit paths so the temporary MCP child never orphans:
  //   - SIGINT (Ctrl-C) — user-initiated cancel
  //   - SIGTERM — supervisor signals us to stop
  //   - uncaughtException — main() throws before the explicit kill
  // The happy path still calls kill explicitly before finishWithSummary.
  const cleanupChild = () => {
    if (mcpChild && !mcpChild.killed) mcpChild.kill("SIGTERM");
  };
  process.once("SIGINT", () => {
    cleanupChild();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    cleanupChild();
    process.exit(143);
  });
  process.once("uncaughtException", (err) => {
    cleanupChild();
    p.log.error(`Doctor crashed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });

  const adcLines: CheckLine[] = [];
  if (adcResult) {
    adcLines.push(
      probeLine(
        adcResult,
        "Why: in service_account mode, the app uses your ADC token to call the Admin SDK and Admin Reports API.",
        "Fix: gcloud auth application-default login (and set a quota project)",
      ),
    );
  } else {
    adcLines.push({
      status: "skip",
      title: "ADC probe skipped (user_oauth mode)",
      details: [
        "User OAuth mode uses the signed-in user's token instead of ADC.",
        "Switch to service_account mode in .env.local if you want ADC exercised.",
      ],
    });
  }

  const providerLines: CheckLine[] = [
    providerResult
      ? probeLine(
          providerResult,
          data.LLM_PROVIDER === "claude"
            ? "Why: the chat route calls @ai-sdk/anthropic on every message."
            : "Why: the chat route calls @ai-sdk/google on every message.",
          data.LLM_PROVIDER === "claude"
            ? "Fix: set ANTHROPIC_API_KEY in .env.local (https://console.anthropic.com/)"
            : "Fix: set GOOGLE_AI_API_KEY in .env.local (https://aistudio.google.com/apikey)",
        )
      : {
          status: "warn",
          title: `${data.LLM_PROVIDER === "claude" ? "ANTHROPIC_API_KEY" : "GOOGLE_AI_API_KEY"} not set — BYOK-only mode`,
          details: [
            "The chat route will fail until a key is supplied via the top-bar model picker.",
            "Set the env var in .env.local to skip BYOK and probe the key here.",
          ],
        },
  ];

  const mcpWhy = mcpChild
    ? "Doctor started the MCP server temporarily for this probe; it exits with the doctor."
    : "Why: every chat turn opens a fresh MCP connection to call tools and fetch prompts.";
  const mcpFix = autoStartFailure
    ? autoStartFailureFix(autoStartFailure)
    : "Fix: npm run dev:full   (or start the MCP server separately on PORT=4000)";
  const mcpLine = probeLine(mcpResult, mcpWhy, mcpFix);

  // When the auto-start child captured stderr/stdout before exiting,
  // print its tail under the fix hint so the user sees the actual
  // upstream error rather than just doctor's reaction to it.
  if (
    mcpLine.status === "fail" &&
    autoStartFailure &&
    "output" in autoStartFailure &&
    autoStartFailure.output
  ) {
    const lines = autoStartFailure.output
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0)
      .slice(-10);
    if (lines.length > 0) {
      mcpLine.details = [
        ...(mcpLine.details ?? []),
        "Upstream output (last lines):",
        ...lines.map((l) => `    ${l}`),
      ];
    }
  }
  const mcpLines: CheckLine[] = [mcpLine];

  if (mcpResult.ok) {
    const { listMcpTools, listMcpPrompts } = await import("./mcp-client");
    const [toolsResult, promptsResult] = await Promise.allSettled([
      listMcpTools(data.MCP_SERVER_URL),
      listMcpPrompts(data.MCP_SERVER_URL),
    ]);

    mcpLines.push(
      toolsResult.status === "fulfilled"
        ? {
            status: "pass",
            title: `MCP tools/list returned ${toolsResult.value.length} tool${toolsResult.value.length === 1 ? "" : "s"}`,
            details: [
              "Each tool becomes a dynamicTool in the AI SDK. Model decides when to call them.",
            ],
          }
        : describeMcpFailure("tools/list", toolsResult.reason),
      promptsResult.status === "fulfilled"
        ? {
            status: "pass",
            title: `MCP prompts/list returned ${promptsResult.value.length} prompt${promptsResult.value.length === 1 ? "" : "s"}`,
            details: [
              "Server-authored conversation starters. Shown as cards on the empty chat panel.",
            ],
          }
        : describeMcpFailure("prompts/list", promptsResult.reason),
    );
  } else {
    mcpLines.push(
      { status: "skip", title: "MCP tools/list skipped (server not reachable)" },
      { status: "skip", title: "MCP prompts/list skipped (server not reachable)" },
    );
  }

  restoreConsole();

  printPhase("Static", "files + env schema", staticLines);
  printPhase(
    "Google credentials",
    needsAdc ? "ADC — service_account mode" : "User OAuth — ADC not used",
    adcLines,
  );
  printPhase("LLM provider", `${data.LLM_PROVIDER} via Vercel AI SDK`, providerLines);
  printPhase("MCP server", `JSON-RPC 2.0 over HTTP @ ${data.MCP_SERVER_URL}`, mcpLines);

  if (mcpChild && !mcpChild.killed) mcpChild.kill("SIGTERM");

  const allLines = [...staticLines, ...adcLines, ...providerLines, ...mcpLines];
  finishWithSummary(countFailures(allLines), countPasses(allLines));
}

function finishWithSummary(failures: number, passes: number) {
  const total = failures + passes;
  if (failures > 0) {
    p.outro(`${passes}/${total} checks passed — fix the ✗ lines above before running the app.`);
    process.exit(1);
  }
  p.outro(`${passes}/${total} checks passed — start the app with \`npm run dev:full\`.`);
  process.exit(0);
}

main().catch((error) => {
  p.log.error(`Doctor script crashed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
