/**
 * @file Shared session guard for Next.js API route handlers.
 *
 * Every protected route needs the same three-line boilerplate:
 *   const auth = getAuth();
 *   const session = await auth.api.getSession({ headers: await headers() });
 *   if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
 *
 * `requireSession()` collapses that into one call. Handlers branch on the
 * truthy/falsy return so we keep the `NextResponse` construction at the
 * call site (different routes may return different 401 shapes).
 */

import { headers, cookies } from "next/headers";
import { getAuth } from "./auth";
import { getEnv } from "./env";
import { SA_EMAIL_DOMAIN } from "./constants";
import { getGoogleAccessToken } from "./access-token";

/**
 * Resolves the current BetterAuth session or null. Reads cookies from
 * the incoming request via Next.js `headers()`, so callers must be
 * inside a request context (route handler or server action).
 *
 * If the session is invalid but session cookies are still present in the
 * browser (e.g. after key rotation or switching environments), they are
 * cleared automatically to prevent redirect loops.
 *
 * It also invalidates and clears anonymous sessions if the app has been
 * switched to `user_oauth` mode.
 *
 * In user_oauth mode, it also verifies that the Google access token is
 * still valid. If the Google token is expired (even if BetterAuth session
 * is technically still valid), it clears the session cookies to force
 * a fresh sign-in, preventing the user from being locked in the dashboard.
 */
export async function requireSession() {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  const config = getEnv();

  if (!session) {
    await clearSessionCookies();
    return null;
  }

  let isStaleAnonymous = false;
  if (config.AUTH_MODE === "user_oauth" && session.user.email?.endsWith(`@${SA_EMAIL_DOMAIN}`)) {
    isStaleAnonymous = true;
  }

  if (isStaleAnonymous) {
    console.warn("requireSession: Stale anonymous session in OAuth mode. Clearing session.");
    await clearSessionCookies();
    return null;
  }

  if (config.AUTH_MODE === "user_oauth") {
    const googleToken = await getGoogleAccessToken();
    if (!googleToken) {
      console.warn("requireSession: User OAuth token expired/missing. Clearing session.");
      await clearSessionCookies();
      return null;
    }
  }

  return session;
}

/**
 * Clears all BetterAuth session cookies from the browser.
 */
async function clearSessionCookies() {
  const cookieStore = await cookies();
  // Better Auth session cookie names contain "session_token"
  const sessionCookies = cookieStore.getAll().filter((c) => c.name.includes("session_token"));
  if (sessionCookies.length > 0) {
    console.warn(
      "requireSession: Clearing stale session cookies:",
      sessionCookies.map((c) => c.name),
    );
    for (const cookie of sessionCookies) {
      cookieStore.delete(cookie.name);
    }
  }
}
