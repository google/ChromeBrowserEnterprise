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
 */
export async function requireSession() {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  
  let isStaleAnonymous = false;
  try {
    const config = getEnv();
    isStaleAnonymous = Boolean(
      session &&
        config.AUTH_MODE === "user_oauth" &&
        session.user.email?.endsWith(`@${SA_EMAIL_DOMAIN}`),
    );
  } catch {
    // If env cannot be loaded, fallback to safe false
  }

  if (!session || isStaleAnonymous) {
    const cookieStore = await cookies();
    // Better Auth session cookie names contain "session_token"
    const sessionCookies = cookieStore.getAll().filter((c) => c.name.includes("session_token"));
    if (sessionCookies.length > 0) {
      console.warn(
        `requireSession: ${
          isStaleAnonymous ? "Stale anonymous session in OAuth mode" : "Invalid session"
        }. Clearing stale cookies:`,
        sessionCookies.map((c) => c.name),
      );
      for (const cookie of sessionCookies) {
        cookieStore.delete(cookie.name);
      }
    }
    return null;
  }

  return session;
}
