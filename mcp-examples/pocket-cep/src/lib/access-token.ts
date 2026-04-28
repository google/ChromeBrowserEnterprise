/**
 * @file Helper to retrieve the Google OAuth access token from BetterAuth.
 *
 * Extracts the token-retrieval logic that's shared across API routes.
 * In user_oauth mode, we need the user's Google token to forward to the
 * MCP server. In service_account mode, we return undefined (the MCP
 * server uses its own ADC instead).
 *
 * This is the bridge between BetterAuth (which stores the token after
 * OAuth) and the MCP client (which sends it as a Bearer header). The
 * token flows: Google OAuth -> BetterAuth session -> here -> mcp-client.ts
 * -> CEP MCP server -> Google APIs.
 */

import { headers } from "next/headers";
import { getAuth } from "./auth";
import { getEnv } from "./env";
import { LOG_TAGS } from "./constants";

/**
 * Retrieves the Google OAuth access token for the current user, or
 * undefined if running in service_account mode.
 *
 * Returns undefined (rather than throwing) on failure so callers can
 * decide how to handle missing tokens — the chat API route will still
 * work in SA mode, but user_oauth callers may want to prompt re-login.
 *
 * Must be called from a Next.js request context (route handler or server
 * action) because it reads cookies via `headers()`.
 */
export async function getGoogleAccessToken(): Promise<string | undefined> {
  const config = getEnv();

  if (config.AUTH_MODE !== "user_oauth") {
    return undefined;
  }

  try {
    const auth = getAuth();
    /**
     * BetterAuth's getAccessToken reads the session cookie (via headers()),
     * looks up the stored Google OAuth token, and returns it. The
     * `providerId: "google"` tells BetterAuth which social provider's
     * token we want.
     */
    const tokenResult = await auth.api.getAccessToken({
      body: { providerId: "google" },
      headers: await headers(),
    });

    /**
     * Runtime type guard instead of a cast — BetterAuth's return type
     * varies across versions, so defensive checking is safer than
     * trusting the TS types.
     */
    if (
      tokenResult &&
      typeof tokenResult === "object" &&
      "accessToken" in tokenResult &&
      typeof tokenResult.accessToken === "string"
    ) {
      return tokenResult.accessToken;
    }

    console.warn(LOG_TAGS.AUTH, "Token result missing accessToken field");
    return undefined;
  } catch (error) {
    console.error(LOG_TAGS.AUTH, "Failed to get Google access token:", error);
    return undefined;
  }
}
