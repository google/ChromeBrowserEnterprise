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

import { headers } from "next/headers";
import { getAuth } from "./auth";

/**
 * Resolves the current BetterAuth session or null. Reads cookies from
 * the incoming request via Next.js `headers()`, so callers must be
 * inside a request context (route handler or server action).
 */
export async function requireSession() {
  const auth = getAuth();
  return auth.api.getSession({ headers: await headers() });
}
