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

import { type NextRequest } from "next/server";
import { getAuth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

/**
 * Delegates all /api/auth/* requests to BetterAuth.
 */
export async function GET(request: NextRequest) {
  const auth = await getAuth();
  return toNextJsHandler(auth).GET(request);
}

export async function POST(request: NextRequest) {
  const auth = await getAuth();
  const res = await toNextJsHandler(auth).POST(request);

  if (request.nextUrl.pathname.includes("/sign-in/social")) {
    try {
      const clone = res.clone();
      const data = await clone.json().catch(() => null);
      const targetUrl = data?.url || clone.headers.get("location");
      if (targetUrl && typeof targetUrl === "string") {
        const u = new URL(targetUrl);
        const redirectUri = u.searchParams.get("redirect_uri");
        console.log(
          `[auth] Initiating Google OAuth flow. Exact redirect_uri sent to Google: "${redirectUri}"`,
        );
      }
    } catch (err) {
      console.warn("[auth] Failed to log redirect_uri:", err);
    }
  }

  return res;
}
