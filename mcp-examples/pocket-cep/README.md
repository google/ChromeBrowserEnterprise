# Pocket CEP

An educational companion app for the [Chrome Enterprise Premium MCP server](https://github.com/google/chrome-enterprise-premium-mcp). Pocket CEP demonstrates how to build a web application that connects to an MCP server using OAuth, calls tools **and** server-authored prompts, and integrates an AI-powered chat agent that investigates Chrome Enterprise user issues.

<img width="1920" height="1280" alt="Pocket CEP main page" src="https://github.com/user-attachments/assets/f572f557-3788-4d46-9f33-d38b599a385f" />

Built with Next.js 16, the Vercel AI SDK v6, BetterAuth, Tailwind CSS 4, and the [CEP MCP Server](https://github.com/google/chrome-enterprise-premium-mcp/).

---

## Table of Contents

- [What It Does](#what-it-does)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Environment Diagnostics](#environment-diagnostics)
- [Auth Modes](#auth-modes)
- [Starting the MCP Server](#starting-the-mcp-server)
- [Configuration](#configuration)
- [Deployment Options](#deployment-options)
- [How It Works](#how-it-works)
- [Project Structure & Scripts](#project-structure--scripts)
- [Testing](#testing)
- [License](#license)

---

## What It Does

Pocket CEP gives Google Workspace administrators a chat interface to investigate Chrome Enterprise user problems. Select a user from a dropdown (populated from real Chrome activity logs), ask a question, and watch the AI agent call MCP tools to find answers.

The app is deliberately educational. An **MCP Inspector** panel shows every JSON-RPC request and response exchanged with the MCP server, so developers can see how the Model Context Protocol works on the wire.

### Features

- **User investigation** — search the Google Workspace directory (Admin SDK REST). Pocket CEP pulls users with recent Chrome audit activity to the top of the list, and the "Recent activity" sidebar lists the most-active users from the last 10 days.
- **Server-authored prompts** — MCP `prompts/list` and `prompts/get` drive the suggested-action cards. Clicking a prompt expands it server-side and sends its authored text (including any formatting contract) to the model.
- **Dual LLM support** — Claude (Anthropic) or Gemini (Google) via the Vercel AI SDK v6's `@ai-sdk/anthropic` and `@ai-sdk/google` providers.
- **Two auth modes** — Service Account (DWD or ADC) for automated server execution, or forward the signed-in user's Google OAuth token for per-user attribution.
- **MCP Inspector** — a collapsible drawer showing every MCP tool call's input, state, and output, synthesized from the streamed `ToolUIPart` events the AI SDK produces.
- **Environment diagnostics** — `npm run doctor` validates env, probes ADC + the LLM provider, and reaches the MCP server.

---

## Prerequisites

- **Node.js** 18 or later
- **Google Cloud project** with the [required Workspace and Chrome APIs enabled](https://github.com/google/chrome-enterprise-premium-mcp/blob/main/docs/auth-bring-your-own-oauth-client.md#enable-required-apis) and OAuth 2.0 credentials or a Service Account configured
- **LLM API key** for either Anthropic (Claude) or Google AI (Gemini)
- **Google Cloud CLI** (`gcloud`) for `service_account` mode ADC setup

---

## Quick Start

```bash
# 1. Install dependencies (postinstall prints a setup hint if needed)
npm install

# 2. Configure interactively — walks through auth mode, API keys,
#    gcloud ADC, and the MCP URL with live validation at each step
npm run setup

# 3. (Optional) Verify your configuration before starting
npm run doctor

# 4. Start Pocket CEP + the MCP server together (two named log streams)
npm run dev:full
```

Prefer manual setup? Copy `.env.local.example` to `.env.local`, fill in your secrets, and set `AUTH_MODE` (`service_account` or `user_oauth`). See [Configuration](#configuration) for details.

### Service Account Setup Options

Service-account mode (`AUTH_MODE=service_account`, default) supports two authentication options:

- **Option A (Domain-Wide Delegation JSON Key — Recommended)**: Upload your Service Account JSON key and set your Impersonated Admin User email on the [`/sa-setup`](http://localhost:3000/sa-setup) page (or set `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json` in `.env.local`). For the 4-step Google Workspace Admin Console setup and OAuth scope allowlist, see the [MCP Server DWD Guide](https://github.com/google/chrome-enterprise-premium-mcp/blob/main/docs/configuration.md#service-account--domain-wide-delegation-dwd).
- **Option B (gcloud ADC)**: Run `gcloud auth application-default login` with admin scopes:

```bash
gcloud auth application-default login --scopes="https://www.googleapis.com/auth/chrome.management.policy,https://www.googleapis.com/auth/chrome.management.reports.readonly,https://www.googleapis.com/auth/chrome.management.profiles.readonly,https://www.googleapis.com/auth/admin.reports.audit.readonly,https://www.googleapis.com/auth/admin.reports.usage.readonly,https://www.googleapis.com/auth/admin.directory.user.readonly,https://www.googleapis.com/auth/admin.directory.orgunit.readonly,https://www.googleapis.com/auth/admin.directory.customer.readonly,https://www.googleapis.com/auth/cloud-identity.policies,https://www.googleapis.com/auth/apps.licensing,https://www.googleapis.com/auth/cloud-platform"
```

Then pin a quota project:

```bash
gcloud auth application-default set-quota-project YOUR_PROJECT_ID
```

Open http://localhost:3000 and sign in with Google.

---

## Environment Diagnostics (Optional)

Run `npm run doctor` at any time to catch configuration issues early. Output is rendered with `@clack/prompts`:

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
◇  Google credentials — ADC / Service Account mode
│  ✓ Google access token acquired
│
◇  LLM provider — claude via Vercel AI SDK
│  ✓ Anthropic key accepted
│
◇  MCP server — JSON-RPC 2.0 over HTTP @ http://localhost:4000/mcp
│  ✓ MCP server reachable
│  ✓ MCP tools/list returned 27 tools
│  ✓ MCP prompts/list returned 4 prompts
│
└  10/10 checks passed — start the app with `npm run dev:full`.
```

---

## Auth Modes

Pocket CEP supports two authentication modes that control how it communicates with the MCP server.

### `service_account` (default)

```
.env: AUTH_MODE=service_account
```

**How it works:** Pocket CEP automatically creates an anonymous session for UI access (no Google Sign-In is required to use the web app). The server calls Google APIs using either a Google Cloud Service Account with Domain-Wide Delegation (DWD) or Application Default Credentials (ADC).

**Best for:**
- Local development, workshops, and automated server deployments
- Environments where a central Service Account key or ADC is configured
- Quick setup when per-user OAuth consent is not viable

**Requirements:**
- **Option A (DWD Key)**: Upload your Service Account JSON key and set your Impersonated User email on the [`/sa-setup`](http://localhost:3000/sa-setup) page (or set `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json` in `.env.local`). Ensure the Service Account's Client ID is authorized in Google Workspace Admin Console (`admin.google.com/ac/owl/domainwidedelegation`).
- **Option B (gcloud ADC)**: Run `gcloud auth application-default login` with admin scopes.

### `user_oauth`

```
.env: AUTH_MODE=user_oauth
```

**How it works:** The user signs into Pocket CEP with the full set of Google Admin scopes. Their personal OAuth access token is forwarded as a `Bearer` header to the MCP server, which uses it for every Google API call.

**Best for:**
- Production-like deployments where actions should be attributed to the signed-in user
- Environments where ADC/DWD isn't configured on the server
- Multi-tenant setups where different users have different permissions
- When you need per-user audit trails in Google Admin logs

**Requirements:**
- **Custom OAuth Client**: A custom Google Cloud **OAuth client ID ("Web application" type)**. Unlike the MCP CLI, Pocket CEP does not ship with a bundled Google-managed OAuth client. You must create your own and configure the redirect URI `http://localhost:3000/api/auth/callback/google` (see [Configuration](#configuration)).
- The signed-in user must be a Google Workspace administrator

---

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

Key environment flags:
- **`GCP_STDIO=false`** — required. Flips the upstream server from stdio mode to HTTP mode.
- **`PORT=4000`** — the HTTP port bound by the upstream server.
- **`$MCP_SERVER_CMD`** — override by setting `MCP_SERVER_CMD` in `.env.local`:
  ```
  MCP_SERVER_CMD=node ../cmcp/mcp-server.js
  ```

### Manual start (two terminals)

```bash
# Terminal 1: MCP server
GCP_STDIO=false PORT=4000 npx -y --prefer-online --registry=https://registry.npmjs.org/ @google/chrome-enterprise-premium-mcp

# Terminal 2: Pocket CEP
npm run dev
```

---

## Configuration

Pocket CEP splits configuration across two files:

- `.env` (committed) — non-secret defaults like `AUTH_MODE` and `LLM_PROVIDER`.
- `.env.local` (gitignored) — your secrets and any per-developer overrides.

Copy `.env.local.example` to `.env.local` and fill in your secrets.

| Variable | Default | Description |
|----------|---------|-------------|
| `BETTER_AUTH_SECRET` | *(required)* | Session signing secret. `openssl rand -base64 32`. |
| `BETTER_AUTH_URL` | `http://localhost:3000` | Canonical URL where Pocket CEP is running. |
| `AUTH_MODE` | `service_account` | `service_account` (DWD/ADC on server) or `user_oauth` (forward user token). |
| `GOOGLE_CLIENT_ID` | — | Required in `user_oauth` mode. |
| `GOOGLE_CLIENT_SECRET` | — | Required in `user_oauth` mode. |
| `LLM_PROVIDER` | `claude` | `claude` or `gemini`. |
| `LLM_MODEL` | *(auto)* | Override model ID (defaults to Sonnet 3.5 / Gemini 2.5 Flash). |
| `ANTHROPIC_API_KEY` | — | Required when `LLM_PROVIDER=claude`. |
| `GOOGLE_AI_API_KEY` | — | Required when `LLM_PROVIDER=gemini`. |
| `MCP_SERVER_URL` | `http://localhost:4000/mcp` | CEP MCP server HTTP endpoint. |
| `MCP_SERVER_CMD` | *(unset)* | Override the MCP server start command. |

---

## Deployment Options

### Local Development

Both services run on your machine.

```
[Browser :3000] --> [Pocket CEP :3000] --> [MCP Server :4000] --> [Google APIs]
                                       --> [Anthropic/Gemini API]
```

### Cloud Run / Docker

Both services run as containers. Pocket CEP connects to the MCP server via its internal URL.

```bash
# Build Pocket CEP
npm run build

# Point MCP_SERVER_URL at the MCP server's internal URL
MCP_SERVER_URL=https://cep-mcp-server-xyz.run.app/mcp npm run start
```

---

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

---

## Project Structure & Scripts

### Key Directories

```
pocket-cep/
  .env                          # Committed defaults + documentation
  .env.local                    # Secrets + per-developer overrides (gitignored)
  AGENTS.md                     # Coding standards + MD3 design system
  src/
    app/                        # Next.js App Router (dashboard, sa-setup, api routes)
    components/                 # Hand-rolled MD3 UI components & inspector
    lib/                        # Auth errors, MCP client, access tokens, Zod env
```

### Scripts

| Command | What it does |
|---------|-------------|
| `npm run setup` | Interactive `.env.local` builder with live validation. |
| `npm run dev` | Start `next dev` on port 3000 (Pocket CEP only). |
| `npm run dev:full` | Start Pocket CEP + MCP server in parallel. |
| `npm run doctor` | Probe env, ADC/DWD, LLM provider, and MCP server. |
| `npm run check` | Run typecheck, lint, unit, and integration tests. |

---

## Testing

```bash
npm run test:unit        # Vitest unit tests
npm run test:integration # Vitest API route integration tests
npm run test:e2e          # Playwright end-to-end browser tests
```

---

## License

This project is an educational companion and is not an officially supported Google product.
