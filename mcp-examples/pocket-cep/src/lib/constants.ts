/**
 * @file App-wide constants for Pocket CEP.
 *
 * Centralizes magic strings and configuration values so they can be
 * referenced consistently across server code, client components, and
 * diagnostic scripts.
 */

/**
 * Email domain for anonymous sessions in service_account mode.
 * BetterAuth's anonymous plugin generates emails like `anon-xyz@{domain}`.
 * The UI checks for this domain to display "Service Account" instead
 * of the generated email address.
 */
export const SA_EMAIL_DOMAIN = "service-account.local";

/**
 * DOM id for the header's user-search input. Referenced from the app
 * bar (focus button), dashboard (`/` keyboard shortcut), and the
 * selector itself. Centralising the string keeps the three callers in
 * lockstep when the markup moves.
 */
export const USER_SEARCH_INPUT_ID = "user-search";

/**
 * localStorage key for the sidebar's collapsed state. Persists across
 * reloads so the layout matches the user's last preference.
 */
export const SIDEBAR_COLLAPSED_KEY = "cep_sidebar_collapsed";

/**
 * Structured log prefixes for each subsystem. These make it easy to
 * filter server logs by component (e.g. `grep "\[mcp\]"`).
 */
export const LOG_TAGS = {
  MCP: "[mcp]",
  CHAT: "[chat]",
  AUTH: "[auth]",
  USERS: "[users]",
  ENV: "[env]",
} as const;

/**
 * Prevents runaway tool-calling loops where the LLM keeps requesting
 * tools without producing a final answer. 10 iterations allows complex
 * multi-step investigations while bounding cost and latency.
 */
export const MAX_AGENT_ITERATIONS = 10;

/**
 * Default MCP server URL used when the user chose the managed flow
 * (Pocket CEP launches the server itself via `npm run dev:full`).
 * Mirrored as the Zod default in `env.ts`; exported here so the setup
 * CLI and doctor can recognise the managed-vs-custom split.
 */
export const DEFAULT_MCP_URL = "http://localhost:4000/mcp";

/**
 * The npx package name `npm run dev:full` uses to launch the upstream
 * MCP server. The doctor reuses this when auto-starting the server
 * for a managed-flow probe so a single source of truth exists.
 *
 * No version specifier — npx resolves to the registry's `latest`
 * dist-tag on each invocation. Combined with the `--prefer-online`
 * flag the spawn sites pass, that means each run picks up the
 * registry's current `latest` even if a stale version sits in the
 * local npx cache.
 */
export const MCP_NPX_PACKAGE = "@google/chrome-enterprise-premium-mcp";

/**
 * Flags both `npm run dev:full` and `npm run doctor` pass to `npx`
 * when launching the managed MCP server. Centralised so the two call
 * sites can't drift, and so the README can reference a single
 * canonical command.
 *
 * - `-y` — auto-confirm the install prompt the first time npx fetches
 *   the package. Without it, a fresh checkout hangs at "Ok to proceed?"
 *   waiting on stdin that the spawned child never receives.
 * - `--prefer-online` — make npx revalidate against the registry on
 *   every run instead of reusing a cached copy. Combined with the
 *   unpinned package name above, that means each run picks up the
 *   registry's current `latest`.
 * - `--registry=https://registry.npmjs.org/` — pin the public npm
 *   registry. Some corporate machines default to an Artifact Registry
 *   mirror that 404s on `/advisories/bulk`, which makes npm spend
 *   minutes retrying audit calls and dumping `silly audit` log lines
 *   before giving up. Pinning the public registry sidesteps that.
 */
export const MCP_NPX_ARGS = [
  "-y",
  "--prefer-online",
  "--registry=https://registry.npmjs.org/",
] as const;

/**
 * Convenience: the full `npx ...` shell command Pocket CEP uses to
 * launch the managed MCP server. Used by `dev-full.ts` and by
 * user-facing copy that needs to print the literal command.
 */
export const MCP_NPX_COMMAND = `npx ${MCP_NPX_ARGS.join(" ")} ${MCP_NPX_PACKAGE}`;

/**
 * Builds the system prompt injected into every LLM conversation. The
 * selectedUserEmail is interpolated so the LLM knows which user the
 * admin is investigating and can scope its MCP tool calls accordingly.
 */
export function buildSystemPrompt(selectedUserEmail: string): string {
  const userContext = selectedUserEmail
    ? `\nThe admin is investigating user "${selectedUserEmail}". When calling MCP tools,
always scope to this user:
- get_chrome_activity_log: use userKey="${selectedUserEmail}"
- check_user_cep_license: use userId="${selectedUserEmail}"
- Other tools: filter or focus on this user where applicable\n`
    : "";

  return `You are a Chrome Enterprise Premium admin assistant.
${userContext}
You have access to MCP tools from the Chrome Enterprise Premium server. Use them to:
- Check the user's recent Chrome activity (login events, policy violations, downloads)
- Verify their CEP license status
- Inspect DLP rules that may affect them
- Diagnose the environment health

Tool-use rules:
- get_chrome_activity_log: do NOT set \`eventName\`. The Admin Reports API only
  accepts a small, undocumented set of event names and invented values
  return a 400 error. Fetch unfiltered activity and group/summarize in
  your response instead. For DLP-related questions specifically, the
  Chrome audit log returns policy-violation events as part of the full
  stream, so unfiltered fetches include them.
- For DLP rule configuration (not events), call list_dlp_rules.
- If a tool returns isError: true, report the error in plain language
  rather than retrying with a guessed argument.

Provide clear, educational explanations of:
- What each Chrome Enterprise feature does
- What the tool results mean in plain language
- What actions the admin might take to resolve issues

Be concise but thorough. When you find something noteworthy, explain WHY it matters.`;
}
