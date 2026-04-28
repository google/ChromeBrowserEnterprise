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

/**
 * Google Workspace admin scopes requested during the OAuth consent flow.
 * These are broad because the MCP server needs them to call various
 * Chrome Enterprise and Admin SDK APIs on behalf of the signed-in admin.
 * The scopes here must match what the Google Cloud OAuth consent screen
 * has been configured to allow.
 */
const ADMIN_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/admin.reports.audit.readonly",
  "https://www.googleapis.com/auth/chrome.management.reports.readonly",
  "https://www.googleapis.com/auth/chrome.management.profiles.readonly",
  "https://www.googleapis.com/auth/admin.directory.orgunit.readonly",
  "https://www.googleapis.com/auth/admin.directory.customer.readonly",
  "https://www.googleapis.com/auth/cloud-identity.policies",
  "https://www.googleapis.com/auth/apps.licensing",
  "https://www.googleapis.com/auth/cloud-platform",
];

/**
 * Builds the BetterAuth instance based on the current AUTH_MODE.
 * Kept as a factory function so env is read lazily (not at import time).
 */
function createAuth() {
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
            scope: ADMIN_SCOPES,
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
let _auth: ReturnType<typeof createAuth> | null = null;

/**
 * Returns the lazily-initialized BetterAuth instance. Called by API route
 * handlers (for auth endpoints) and by access-token.ts (to retrieve the
 * Google OAuth token in user_oauth mode).
 */
export function getAuth() {
  if (!_auth) {
    _auth = createAuth();
  }
  return _auth;
}
