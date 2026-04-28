/**
 * @file BetterAuth API catch-all route for Next.js App Router.
 *
 * This route handles all authentication requests: sign-in, sign-out,
 * callback processing, session checks, and token endpoints. BetterAuth
 * routes them internally based on the URL path.
 *
 * The [...all] catch-all pattern means any request to /api/auth/* lands here.
 * Key sub-routes handled by BetterAuth include:
 *   - /api/auth/sign-in/social    -- initiates Google OAuth flow
 *   - /api/auth/callback/google   -- receives the OAuth redirect
 *   - /api/auth/get-session       -- returns the current session (used by useSession)
 *   - /api/auth/sign-in/anonymous -- creates a session without OAuth (SA mode)
 *   - /api/auth/sign-out          -- clears the session cookie
 *
 * BetterAuth stores sessions in an in-memory SQLite database by default
 * (no external DB required for development). The session token is set as
 * an HTTP-only cookie, so client JS never handles raw tokens.
 *
 * Extension point: to add a new social provider (e.g. Microsoft), configure
 * it in src/lib/auth.ts and BetterAuth will automatically handle the new
 * callback route here.
 */

import { getAuth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

/**
 * Delegates all /api/auth/* requests to BetterAuth. The `toNextJsHandler`
 * adapter converts BetterAuth's generic handler into Next.js App Router
 * GET/POST exports.
 */
export const { GET, POST } = toNextJsHandler(getAuth());
