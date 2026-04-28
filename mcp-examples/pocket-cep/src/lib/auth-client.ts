/**
 * @file BetterAuth client for browser-side authentication.
 *
 * Includes the anonymous client plugin so SA mode can create sessions
 * without OAuth. In user_oauth mode, signIn.social() triggers Google OAuth.
 *
 * This module is marked "use client" because BetterAuth's React integration
 * uses hooks and browser APIs internally. It must not be imported from
 * server components or API routes — use auth.ts (the server instance) there.
 */

"use client";

import { createAuthClient } from "better-auth/react";
import { anonymousClient } from "better-auth/client/plugins";

/**
 * Browser-side auth client. Components call `authClient.useSession()` for
 * reactive session state and `authClient.signIn.social({ provider: "google" })`
 * to trigger the OAuth flow. The anonymousClient plugin adds
 * `authClient.signIn.anonymous()` for service_account mode.
 */
export const authClient = createAuthClient({
  plugins: [anonymousClient()],
});
