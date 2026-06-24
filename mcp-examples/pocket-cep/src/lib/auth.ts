/**
 * @file BetterAuth server configuration.
 *
 * Two auth modes:
 *   - service_account: anonymous plugin auto-creates sessions with a fixed
 *     identity. No Google sign-in required. MCP server uses its own ADC.
 *   - user_oauth: Google OAuth with full admin scopes. The user's token
 *     is forwarded to the MCP server as a Bearer header.
 *
 * BetterAuth runs in stateless mode here (no database configured), so all
 * session data is encoded in a signed cookie. The BETTER_AUTH_SECRET is the
 * signing key — changing it invalidates every active session.
 */

import { betterAuth } from "better-auth";
import { anonymous } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { getEnv } from "./env";
import { SA_EMAIL_DOMAIN } from "./constants";

import { callMcpTool } from "./mcp-client";

/**
 * Fallback Google Workspace admin scopes if MCP dynamic discovery fails.
 */
const FALLBACK_ADMIN_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "profile",
  "https://www.googleapis.com/auth/chrome.management.policy",
  "https://www.googleapis.com/auth/chrome.management.reports.readonly",
  "https://www.googleapis.com/auth/chrome.management.profiles.readonly",
  "https://www.googleapis.com/auth/admin.reports.audit.readonly",
  "https://www.googleapis.com/auth/admin.directory.user.readonly",
  "https://www.googleapis.com/auth/admin.directory.orgunit.readonly",
  "https://www.googleapis.com/auth/admin.directory.customer.readonly",
  "https://www.googleapis.com/auth/apps.licensing",
  "https://www.googleapis.com/auth/cloud-identity.policies",
  "https://www.googleapis.com/auth/service.management",
];

/**
 * Dynamically retrieves requested OAuth scopes by calling the MCP server's
 * `cep_auth` tool in `manual` mode and parsing the generated consent URL.
 */
async function resolveAdminScopes(mcpUrl: string): Promise<string[]> {
  try {
    const res = await callMcpTool(mcpUrl, "cep_auth", { authMethod: "manual" });
    const text = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
    const match = text.match(/https:\/\/accounts\.google\.com[^\s"']+/);
    if (match) {
      const url = new URL(match[0]);
      const scopeParam = url.searchParams.get("scope");
      if (scopeParam) {
        const dynamicScopes = decodeURIComponent(scopeParam).split(/[\s+]/).filter(Boolean);
        if (dynamicScopes.length > 0) {
          return Array.from(
            new Set([
              "openid",
              "https://www.googleapis.com/auth/userinfo.email",
              "profile",
              "https://www.googleapis.com/auth/admin.directory.user.readonly",
              ...dynamicScopes,
            ]),
          );
        }
      }
    }
  } catch (err) {
    console.warn("[auth] Could not fetch dynamic scopes from MCP cep_auth tool, using fallback scopes:", err);
  }
  return FALLBACK_ADMIN_SCOPES;
}

/**
 * Builds the BetterAuth instance based on the current AUTH_MODE and scopes.
 */
function createAuth(scopes: string[]) {
  const config = getEnv();
  const isSA = config.AUTH_MODE === "service_account";

  return betterAuth({
    secret: config.BETTER_AUTH_SECRET,
    baseURL: config.BETTER_AUTH_URL,

    /**
     * In service_account mode, no social providers are registered —
     * sessions are created by the anonymous plugin instead.
     */
    socialProviders: isSA
      ? {}
      : {
          google: {
            clientId: config.GOOGLE_CLIENT_ID,
            clientSecret: config.GOOGLE_CLIENT_SECRET,
            scope: scopes,
          },
        },

    /**
     * nextCookies() integrates with Next.js headers() so BetterAuth
     * can read/write cookies in server components and route handlers.
     * The anonymous plugin (SA mode only) generates a fake identity
     * using SA_EMAIL_DOMAIN so the UI has a session to work with.
     */
    plugins: [...(isSA ? [anonymous({ emailDomainName: SA_EMAIL_DOMAIN })] : []), nextCookies()],
  });
}

/** Singleton — BetterAuth is configured once per process lifetime. */
let _authPromise: Promise<ReturnType<typeof createAuth>> | null = null;

/**
 * Returns the lazily-initialized async BetterAuth instance.
 */
export async function getAuth() {
  if (!_authPromise) {
    _authPromise = (async () => {
      const config = getEnv();
      const isSA = config.AUTH_MODE === "service_account";
      const scopes = isSA ? [] : await resolveAdminScopes(config.MCP_SERVER_URL);
      return createAuth(scopes);
    })();
  }
  return _authPromise;
}
