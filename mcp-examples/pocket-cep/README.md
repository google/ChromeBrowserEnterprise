# Pocket CEP

An educational companion app for the [Chrome Enterprise Premium MCP server](https://github.com/google/chrome-enterprise-premium-mcp). Pocket CEP demonstrates how to build a web application that connects to an MCP server using OAuth, calls tools **and** server-authored prompts, and integrates an AI-powered chat agent that investigates Chrome Enterprise user issues.

Built with Next.js 16, the Vercel AI SDK v6, BetterAuth, Tailwind CSS 4, and the official MCP SDK.

## What It Does

Pocket CEP gives Google Workspace administrators a chat interface to investigate Chrome Enterprise user problems. Select a user from a dropdown (populated from real Chrome activity logs), ask a question, and watch the AI agent call MCP tools to find answers.

The app is deliberately educational. An **MCP Inspector** panel shows every JSON-RPC request and response exchanged with the MCP server, so developers can see how the Model Context Protocol works on the wire.

### Features

- **User investigation** — search the Google Workspace directory (Admin SDK REST). Pocket CEP pulls users with recent Chrome audit activity to the top of the list, and the "Recent activity" sidebar lists the most-active users from the last 10 days.
- **Server-authored prompts** — MCP `prompts/list` and `prompts/get` drive the suggested-action cards. Clicking a prompt expands it server-side and sends its authored text (including any formatting contract) to the model.
- **Dual LLM support** — Claude (Anthropic) or Gemini (Google) via the Vercel AI SDK v6's `@ai-sdk/anthropic` and `@ai-sdk/google` providers.
- **Two auth modes** — ADC for simple demos, or forward the signed-in user's Google OAuth token for per-user attribution.
- **MCP Inspector** — a collapsible drawer showing every MCP tool call's input, state, and output, synthesized from the streamed `ToolUIPart` events the AI SDK produces.
- **Environment diagnostics** — `npm run doctor` validates env, probes ADC + the LLM provider, and reaches the MCP server. If the URL is the managed default and the server isn't running, doctor temporarily starts it (the same npx package `npm run dev:full` uses), runs `tools/list` + `prompts/list` against the live server, and kills it on exit.

## Prerequisites

- **Node.js** 18 or later
- **Google Cloud project** with OAuth 2.0 credentials configured
- **LLM API key** for either Anthropic (Claude) or Google AI (Gemini)
- **Google Cloud CLI** (`gcloud`) for `service_account` mode ADC setup

## Quick Start

```bash
# 1. Install dependencies (postinstall prints a setup hint if needed)
npm install

# 2. Configure interactively — walks through auth mode, API keys,
#    gcloud ADC, and the MCP URL with live validation at each step
npm run setup

# 3. Start Pocket CEP + the MCP server together (two named log streams)
npm run dev:full
```

Prefer to configure by hand? Pocket CEP splits configuration across
two files:

- `.env` (committed) — non-secret defaults like `AUTH_MODE` and
  `LLM_PROVIDER`, with inline documentation for every option.
- `.env.local` (gitignored) — your secrets and any per-developer
  overrides; wins over `.env` for any key you set.

Copy `.env.local.example` to `.env.local`, fill in the secrets at the
top, uncomment any overrides you need, then run `npm run doctor` to
verify. See [Configuration](#configuration) for the full breakdown.

Service-account mode also needs ADC — paste this single-line command
(do not break it across lines):

```bash
gcloud auth application-default login --scopes="https://www.googleapis.com/auth/chrome.management.policy,https://www.googleapis.com/auth/chrome.management.reports.readonly,https://www.googleapis.com/auth/chrome.management.profiles.readonly,https://www.googleapis.com/auth/admin.reports.audit.readonly,https://www.googleapis.com/auth/admin.reports.usage.readonly,https://www.googleapis.com/auth/admin.directory.user.readonly,https://www.googleapis.com/auth/admin.directory.orgunit.readonly,https://www.googleapis.com/auth/admin.directory.customer.readonly,https://www.googleapis.com/auth/cloud-identity.policies,https://www.googleapis.com/auth/apps.licensing,https://www.googleapis.com/auth/cloud-platform"
```

Then pin a quota project:

```bash
gcloud auth application-default set-quota-project YOUR_PROJECT_ID
```

Scopes can't be added to existing ADC credentials. If you get
"insufficient scopes" errors, delete
`~/.config/gcloud/application_default_credentials.json` and re-run the
login command above.

If the dev server starts but env vars are missing, the landing page shows
a setup-required screen pointing back at `npm run setup`.

Open http://localhost:3000 and sign in with Google.

Point `dev:full` at a local MCP checkout, or work around a registry that doesn't carry the npm package, by setting `MCP_SERVER_CMD` once in `.env.local` (both `npm run dev:full` and `npm run doctor` read it):

```
MCP_SERVER_CMD=node ../cmcp/mcp-server.js
```

If MCP isn't reachable, `/dashboard` shows a setup-required page (the same treatment as missing env vars) instead of partially loading.

## Configuration

Two files:

| File | Committed? | Purpose |
|------|-----------|---------|
| `.env` | Yes | Non-secret defaults (auth mode, MCP URL, etc.) with documentation |
| `.env.local` | No (gitignored) | Your secrets and any overrides of the committed defaults |

`cp .env.local.example .env.local` — the example file documents every knob
(secrets at the top, Google OAuth, and `# commented-out` overrides for
`AUTH_MODE` / `LLM_PROVIDER` / `LLM_MODEL` / `MCP_SERVER_URL` / `BETTER_AUTH_URL`
at the bottom). Uncomment only what you need to change.

| Variable | Default | Description |
|----------|---------|-------------|
| `BETTER_AUTH_SECRET` | *(required)* | Session signing secret. `openssl rand -base64 32`. |
| `BETTER_AUTH_URL` | `http://localhost:3000` | Canonical URL where Pocket CEP is running. |
| `AUTH_MODE` | `service_account` | `service_account` (ADC on server) or `user_oauth` (forward user token). See [Auth Modes](#auth-modes). |
| `GOOGLE_CLIENT_ID` | — | Required in `user_oauth` mode. |
| `GOOGLE_CLIENT_SECRET` | — | Required in `user_oauth` mode. |
| `LLM_PROVIDER` | `claude` | `claude` or `gemini`. |
| `LLM_MODEL` | *(auto)* | Override. Defaults come from `src/lib/models.ts` (currently `claude-sonnet-4-6` / `gemini-3-flash-preview`). |
| `ANTHROPIC_API_KEY` | — | Required when `LLM_PROVIDER=claude`. |
| `GOOGLE_AI_API_KEY` | — | Required when `LLM_PROVIDER=gemini`. |
| `MCP_SERVER_URL` | `http://localhost:4000/mcp` | CEP MCP server HTTP endpoint. |
| `MCP_SERVER_CMD` | *(unset)* | Override the MCP server start command. Read by `npm run dev:full` and `npm run doctor` from `.env.local` or the shell. Default: `npx -y --prefer-online --registry=https://registry.npmjs.org/ @google/chrome-enterprise-premium-mcp` — `-y` skips the first-run install prompt, `--prefer-online` revalidates so each run picks up the registry's `latest`, and `--registry=...` pins the public npm registry (corporate Artifact Registry mirrors 404 on `/advisories/bulk`, which produces minutes of `silly audit` retries). Not parsed by the app at runtime. |

Pocket CEP validates app-side variables at startup with Zod. Missing or malformed values throw a startup error that names the field and the fix.

## Auth Modes

Pocket CEP supports two authentication modes that control how it communicates with the MCP server.

### `service_account` (default)

```
.env: AUTH_MODE=service_account
```

**How it works:** The user signs into Pocket CEP with basic Google OAuth (just `openid`, `email`, `profile` scopes) for UI access. The MCP server uses its own Application Default Credentials (ADC) to call Google APIs. ADC comes from running `gcloud auth application-default login` as a Workspace admin.

**Best for:**
- Local development and demos
- Environments where you've already run `gcloud auth application-default login`
- Quick setup when you don't need per-user audit trails
- Workshops where attendees don't have Workspace admin access

**Requirements:**
- Run `gcloud auth application-default login` with the admin scopes (see [Quick Start](#quick-start))
- Set a quota project: `gcloud auth application-default set-quota-project YOUR_PROJECT_ID`

**Note:** A service account JSON key alone won't work — the upstream MCP server's `GoogleAuth` call doesn't pass a `subject` for domain-wide delegation. ADC from `gcloud auth application-default login` (where a human admin authenticates) is the supported path.

### `user_oauth`

```
.env: AUTH_MODE=user_oauth
```

**How it works:** The user signs into Pocket CEP with the full set of Google Admin scopes. Their personal OAuth access token is forwarded as a `Bearer` header to the MCP server, which uses it for every Google API call.

**Best for:**
- Production-like deployments where actions should be attributed to the signed-in user
- Environments where ADC isn't configured on the server
- Multi-tenant setups where different users have different permissions
- When you need per-user audit trails in Google Admin logs

**Requirements:**
- The signed-in user must be a Google Workspace administrator
- The MCP server should be started with `OAUTH_ENABLED=true`

## LLM Providers

### Claude (Anthropic)

```
LLM_PROVIDER=claude
ANTHROPIC_API_KEY=sk-ant-…
```

Routed through the Vercel AI SDK's `@ai-sdk/anthropic` provider. Default model: `claude-sonnet-4-6`.

### Gemini (Google)

```
LLM_PROVIDER=gemini
GOOGLE_AI_API_KEY=…
```

Routed through `@ai-sdk/google`. Default model: `gemini-2.5-flash`.

Both providers stream through the same `streamText` call, so the UI code is identical. Override the specific model with `LLM_MODEL`.

## Starting the MCP Server

Pocket CEP needs the Chrome Enterprise Premium MCP server running in HTTP mode on `http://localhost:4000/mcp`.

### Together with the app (recommended)

```bash
npm run dev:full
```

`dev:full` is a tsx wrapper (`scripts/dev-full.ts`) that loads `.env`/`.env.local`, then runs `concurrently` with two streams prefixed `[app]` and `[mcp]`. The first stream is `next dev`. The second is the MCP server, started with three env vars and a stdin keep-alive trick:

```
tail -f /dev/null | GCP_STDIO=false PORT=4000 LOG_LEVEL=warn $MCP_SERVER_CMD
```

Each piece serves a specific purpose:

- **`GCP_STDIO=false`** — required. The upstream `@google/chrome-enterprise-premium-mcp` server defaults to **stdio mode** (the MCP protocol over stdin/stdout, intended for hosts like Claude Desktop). Pocket CEP talks to it over HTTP, so we flip it to HTTP mode by setting `GCP_STDIO=false`. Forgetting this leaves the server reading JSON-RPC frames from stdin and ignoring the port.
- **`PORT=4000`** — the port the upstream binds when running in HTTP mode. Matches `MCP_SERVER_URL`'s default of `http://localhost:4000/mcp`.
- **`LOG_LEVEL=warn`** — quiets the upstream server's info logs so they don't drown out Next's logs in the same terminal. The MCP server still emits warnings and errors at this level.
- **`tail -f /dev/null |`** — pipes a never-closing stream into the MCP child's stdin. Without this, the child sees stdin EOF immediately and exits — the upstream server treats stdin EOF as a shutdown signal even in HTTP mode.
- **`$MCP_SERVER_CMD`** — the start command. Defaults to `npx -y --prefer-online --registry=https://registry.npmjs.org/ @google/chrome-enterprise-premium-mcp`. Three flags carry their weight: `-y` auto-confirms the first-run install prompt (otherwise the spawned child hangs waiting on stdin); `--prefer-online` makes npx revalidate against the registry on every run, so each launch picks up the registry's current `latest` even if a stale version sits in the local npx cache; `--registry=https://registry.npmjs.org/` pins the public npm registry, which sidesteps corporate Artifact Registry mirrors that 404 on `/advisories/bulk` and dump minutes of `silly audit` retries. Override the whole command by setting `MCP_SERVER_CMD` in `.env.local` (preferred — persists across sessions) or in your shell:

```
# .env.local (no quoting; values are read literally)
MCP_SERVER_CMD=npx @google/chrome-enterprise-premium-mcp@0.4.0
# or, to run a local checkout:
MCP_SERVER_CMD=node ../cmcp/mcp-server.js
```

### Manual start (two terminals)

If you prefer to manage the MCP server yourself:

```bash
# Terminal 1: MCP server
GCP_STDIO=false PORT=4000 npx -y --prefer-online --registry=https://registry.npmjs.org/ @google/chrome-enterprise-premium-mcp

# Terminal 2: Pocket CEP
npm run dev
```

For `user_oauth` mode, add `OAUTH_ENABLED=true` to the MCP server.

### Default ports

| Service | Port | Controlled by |
|---------|------|---------------|
| Pocket CEP (Next.js) | 3000 | `PORT` or `next dev --port` |
| MCP Server | 4000 | Shell `PORT` (inherited via `dev:full` or exported manually) |

## Deployment Options

### Local Development

The simplest setup. Both services run on your machine.

```
[Browser :3000] --> [Pocket CEP :3000] --> [MCP Server :4000] --> [Google APIs]
                                       --> [Anthropic/Gemini API]
```

```bash
npm run dev:full
```

### Cloud Run / Docker

Both services run as containers. Pocket CEP connects to the MCP server via its internal URL.

```bash
# Build Pocket CEP
npm run build

# Point MCP_SERVER_URL at the MCP server's internal URL
MCP_SERVER_URL=https://cep-mcp-server-xyz.run.app/mcp npm run start
```

Key considerations:
- Set `BETTER_AUTH_URL` to the public URL of your Pocket CEP deployment
- Update the Google OAuth redirect URI to match
- Use `user_oauth` mode if the MCP server doesn't have its own ADC
- Use `service_account` mode if the machine has ADC configured

### Shared Demo / Workshop

For workshops where multiple attendees use the same instance:

1. Set up ADC on the host with a Workspace admin account
2. Deploy Pocket CEP with `AUTH_MODE=service_account`
3. Run the MCP server alongside it (separate process; same machine so it inherits ADC)
4. Each attendee signs in with their Google account (basic scopes only); all MCP calls use the shared ADC credentials

## Project Structure

```
pocket-cep/
  .env                          # Committed defaults + documentation
  .env.local                    # Secrets + per-developer overrides (gitignored)
  .env.local.example            # Template for .env.local
  AGENTS.md                     # Coding standards + design system
  CLAUDE.md -> AGENTS.md        # Symlink for Claude Code
  GEMINI.md -> AGENTS.md        # Symlink for Gemini

  scripts/
    setup.ts                    # Interactive `.env.local` builder (clack)
    setup-helpers.ts            # Pure helpers (LLM-provider inference)
    dev-full.ts                 # Loads .env*, runs concurrently for dev:full
    postinstall.js              # Print-only hint to run `npm run setup`

  src/
    app/
      layout.tsx                # Root layout — Roboto + Roboto Mono via next/font
      page.tsx                  # Landing page with Google sign-in
      globals.css               # Tailwind v4 + MD3 tokens + prose styles
      dashboard/
        page.tsx                # Server-rendered shell (RSC pre-fetch)
        dashboard-client.tsx    # Interactive shell: rail + main + chat
        loading.tsx             # Suspense fallback
        error.tsx               # Per-route error boundary
      api/
        auth/[...all]/route.ts            # BetterAuth catch-all
        auth/auto-session/route.ts        # Mints anonymous session in SA mode
        auth/health/route.ts              # ADC health probe (banner re-check)
        users/route.ts                    # Admin SDK directory search
        users/activity/route.ts           # Recent Chrome audit-log activity
        chat/route.ts                     # streamText response (Vercel AI SDK)
        tools/route.ts                    # MCP tool catalog
        prompts/route.ts                  # MCP prompts (list + expand)

    components/
      app-bar.tsx               # Top wordmark + session chip + gradient strip
      auth-banner.tsx           # Sticky banner when ADC needs re-auth
      auth-health-provider.tsx  # Context + window-event listener for auth state
      sign-in-button.tsx        # Google sign-in (user_oauth mode)
      mode-provider.tsx         # Active flavor (auth-mode + LLM provider) context
      mode-badges.tsx           # Top-bar flavor pill + model picker host
      model-selector.tsx        # Top-bar model dropdown + BYOK editor
      swr-provider.tsx          # SWR config (auth-aware fetcher, dedup)
      user-selector.tsx         # Directory combobox + activity-weighted ranking
      activity-roster.tsx       # Sidebar "Chrome audit events" list
      inspector-panel.tsx       # MCP tool-invocation drawer
      chat-panel.tsx            # Chat host — useChat, scroll, empty state
      chat-message.tsx          # Message bubble + tool-part cards + prompt chip
      chat-input.tsx            # Auto-growing textarea + Enter/Stop controls
      json-tree.tsx             # Recursive JSON viewer for tool outputs
      ui/skeleton.tsx           # Loading skeleton
      ui/badge.tsx              # Generic badge

    lib/
      env.ts                    # Zod env schema + EnvValidationError
      env-error-page.ts         # Setup-required HTML (env + MCP variants)
      errors.ts                 # Shared error message extraction
      auth.ts                   # BetterAuth server config (stateless)
      auth-client.ts            # BetterAuth browser client
      auth-errors.ts            # Typed AuthError + classifier
      auth-aware-fetch.ts       # fetch wrapper dispatching auth-error events
      access-token.ts           # OAuth token retrieval (user_oauth mode)
      adc.ts                    # ADC token + cached quota-project helpers
      admin-sdk.ts              # Directory API REST wrapper
      activity-data.ts          # Admin Reports API activity fetcher
      api-response.ts           # Shared API error-response helpers
      cache-key.ts              # Per-caller cache-key builder
      cn.ts                     # clsx + tailwind-merge helper
      constants.ts              # System prompt, log tags, MCP defaults
      doctor.ts                 # Diagnostic script (probes + auto-spawn MCP)
      doctor-checks.ts          # Shared probe helpers
      google-scopes.ts          # Canonical OAuth scope list + gcloud cmd builder
      http-cache.ts             # ETag + cache-control helpers
      mcp-client.ts             # StreamableHTTP wrapper (tools + prompts)
      mcp-tools.ts              # AI SDK tool adapter + caller catalog cache
      models.ts                 # Model option catalog + BYOK provider mapping
      model-preferences.ts      # localStorage facade for selected model + BYOK
      server-cache.ts           # Process-local caches (TTL + tags)
      session.ts                # Session guard + helpers
      storage.ts                # SSR-safe localStorage hook
      tool-part.ts              # Tool-UI-part type + label

    proxy.ts                    # Route protection + env/MCP setup-blocker pages

    __tests__/
      unit/                     # env, env-error-page, adc, google-scopes,
                                # setup-helpers, postinstall, mcp-*, etc.
      integration/              # api routes + proxy
      e2e/                      # Playwright: landing, chat flow, scroll
```

## Scripts

| Command | What it does |
|---------|-------------|
| `npm run setup` | Interactive `.env.local` builder — guided prompts for auth mode, API keys, ADC, and MCP. Validates each value live. |
| `npm run dev` | Start `next dev` on port 3000 (Pocket CEP only — no MCP server). |
| `npm run dev:full` | Start `next dev` + the MCP server in parallel (`[app]` and `[mcp]` log streams). Honours `MCP_SERVER_CMD` from `.env.local`. |
| `npm run doctor` | Probe env, ADC, the LLM provider, and MCP. Auto-starts the MCP server temporarily if the URL is the managed default and it isn't running. |
| `npm run build` | Production build |
| `npm run start` | Serve production build on port 3000 |
| `npm run check` | Typecheck + lint + unit tests + integration tests |
| `npm run lint` | ESLint with auto-fix (includes Prettier formatting) |
| `npm run typecheck` | TypeScript type checking |
| `npm run test` | Run all Vitest tests |
| `npm run test:unit` | Run unit tests only |
| `npm run test:integration` | Run integration tests only |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:e2e` | Run Playwright E2E tests |

## Testing

### Unit Tests (Vitest)

Test pure logic without external dependencies.

```bash
npm run test:unit
```

Covers: Zod env validation, MCP client wrapper (mocked SDK), access token retrieval.

### Integration Tests (Vitest)

```bash
npm run test:integration
```

Covers: Admin SDK directory query translation.

### E2E Tests (Playwright)

Test the real app in a browser. Playwright auto-starts the dev server.

```bash
npm run test:e2e
```

Covers: landing page rendering, chat transport wiring (selected user propagates across sends), scroll behavior (chat container and sidebar roster).

## Environment Diagnostics

Run `npm run doctor` before starting the app to catch configuration issues early. Output is rendered with `@clack/prompts` (same idiom as `npm run setup`) — an active-flavor box up top, then four phases, each marked by a step glyph:

```
┌  Pocket CEP — Environment Check
│
◇  Active flavor ────────────────────────╮
│  AUTH_MODE     service_account         │
│                Shared identity, ...    │
│  LLM_PROVIDER  claude                  │
│                Claude via @ai-sdk/...  │
│  LLM_MODEL     claude-sonnet-4-6 (default)
├────────────────────────────────────────╯
│
◇  Static — files + env schema
│  ✓ .env file found
│  ✓ .env.local file found
│  ✓ Environment variables valid (Zod schema passed)
│  ✓ BETTER_AUTH_SECRET is set to a real value
│
◇  Google credentials — ADC, service_account mode
│  ✓ Google ADC token acquired
│
◇  LLM provider — claude via Vercel AI SDK
│  ✓ Anthropic key accepted
│
◇  MCP server — JSON-RPC 2.0 over HTTP @ http://localhost:4000/mcp
│  ✓ MCP server reachable
│  ✓ MCP tools/list returned 23 tools
│  ✓ MCP prompts/list returned 3 prompts
│
└  10/10 checks passed — start the app with `npm run dev:full`.
```

When `MCP_SERVER_URL` is the managed default and the probe fails, doctor auto-spawns the npx package with a real spinner, polls for up to 30 seconds, and kills the child on exit. After 10 seconds the spinner switches to a "still trying — set `MCP_SERVER_CMD` in `.env.local` to skip" hint so a slow registry doesn't leave you wondering. Pointing `MCP_SERVER_URL` at a custom server skips the auto-spawn entirely — doctor just probes and reports.

## When your Google session expires

The app uses Google Application Default Credentials (ADC). If you see an amber "Re-authenticate with Google" banner at the top of the page, or `npm run doctor` reports `Google ADC unavailable`, your local gcloud session has expired (or was never set up). Run:

```bash
gcloud auth login
```

— or `gcloud auth application-default login` if ADC was never configured. Then click **Check again** in the banner. It clears when Google accepts the refreshed credentials.

The banner is sticky on purpose. It only dismisses after a successful probe, so you always know whether auth is healthy.

## How It Works

### Architecture

```
Browser                     Pocket CEP (Next.js :3000)              External

[Google Sign-In] --------> /api/auth            (BetterAuth) -----> Google OAuth
                            session in signed cookie

[User selector]  --------> /api/users           (Admin SDK) -------> Google Directory
                 --------> /api/users/activity  (MCP tool) --------> MCP Server :4000
                            `get_chrome_activity_log` → {email → eventCount}

[Suggestion cards] ------> /api/prompts         (MCP prompts) -----> MCP Server :4000
                            GET  → `prompts/list`
                            POST → `prompts/get` (server expands)

[Chat UI] ---------------> /api/chat                               -> Anthropic or
  useChat() → sendMessage   streamText({ tools, stopWhen })           Google AI
                            tool execute() ---------------------->   MCP Server :4000
                            UIMessage stream <----------------------

[MCP Inspector] <--------- ToolUIPart events from the same stream
```

### Streaming with the Vercel AI SDK

`src/app/api/chat/route.ts` is a thin route handler:

```ts
const result = streamText({
  model,                                   // anthropic(id) or google(id)
  system: buildSystemPrompt(selectedUser),
  messages: await convertToModelMessages(messages),
  tools,                                   // MCP tools as dynamicTool()s
  stopWhen: stepCountIs(MAX_AGENT_ITERATIONS),
});
return result.toUIMessageStreamResponse();
```

Tools come from `src/lib/mcp-tools.ts`, which wraps each MCP tool as `dynamicTool({ inputSchema: jsonSchema(t.inputSchema), execute })`. The AI SDK's multi-step loop handles tool-call threading.

The MCP tool catalog is cached in-process (5 min TTL, keyed by a SHA-256 hash of the access token so `user_oauth` callers don't share catalogs).

### Server-authored prompts

MCP servers expose **prompts** in addition to tools — structured conversation starters that carry formatting contracts (tables, severity tiers, tone rules). Pocket CEP renders them as suggestion cards:

1. `GET /api/prompts` → MCP `prompts/list` → render one card per prompt (with the server-assigned `cep:*` name as a badge).
2. Clicking a card → `POST /api/prompts` → MCP `prompts/get` → server returns the expanded message body.
3. Pocket CEP sends that body as a user turn via `useChat().sendMessage({ text, metadata })`. The `metadata` tag collapses the message to a "⚡ Ran cep:health" chip in the UI; the model receives the full prompt body.

### MCP communication

Pocket CEP uses the official `@modelcontextprotocol/sdk` over HTTP. `StreamableHTTPClientTransport` sends JSON-RPC 2.0 to `POST /mcp`. Each call opens a fresh connection (the upstream server is stateless). In `user_oauth` mode, Pocket CEP injects the signed-in user's Google access token as a `Bearer` header.

## Design System

The UI is Material Design 3 in feel — a Google Workspace admin console, not a generic SaaS dashboard. Tokens (colors, radii, shadows, typography) live entirely in `src/app/globals.css` via Tailwind v4's `@theme inline`; there is no `tailwind.config.ts`. The shadcn footprint is deliberately small (only `Badge` and `Skeleton`); most components are hand-rolled to keep domain specifics (combobox suppression attributes, the MCP inspector, the BYOK model picker).

See [`AGENTS.md` → Design System](./AGENTS.md#design-system) for the canonical rules: typography scale, token taxonomy, utility inventory, and the Roboto-not-Inter decision.

## License

This project is an educational companion and is not an officially supported Google product.
