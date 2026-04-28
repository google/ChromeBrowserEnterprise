/**
 * @file Mints an anonymous BetterAuth session for service_account mode.
 *
 * The middleware (src/proxy.ts) redirects sessionless SA-mode requests
 * here. We POST to BetterAuth's anonymous sign-in endpoint, forward all
 * Set-Cookie headers, and redirect to the dashboard.
 *
 * This creates a "fake" user with a generated email at the
 * `@service-account.local` domain. The AppBar component detects this
 * domain to show "Service Account" instead of the generated email.
 *
 * The flow is: browser -> middleware (no cookie?) -> GET /auto-session
 * -> POST /api/auth/sign-in/anonymous -> Set-Cookie -> 302 /dashboard
 *
 * Returns 404 in user_oauth mode so this endpoint cannot be abused to
 * bypass real authentication.
 */

import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";

/**
 * Creates an anonymous session and redirects to the dashboard.
 * Only active in service_account mode; returns 404 otherwise.
 */
export async function GET() {
  const config = getEnv();

  if (config.AUTH_MODE !== "service_account") {
    return new Response("Not found", { status: 404 });
  }

  /**
   * Use BETTER_AUTH_URL as the redirect base (not request.url) so a
   * spoofed Host header can't turn this into an open redirect.
   */
  const base = config.BETTER_AUTH_URL;

  let response: Response;
  try {
    response = await fetch(`${base}/api/auth/sign-in/anonymous`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return NextResponse.redirect(new URL("/?error=session_unavailable", base));
  }

  if (!response.ok) {
    return NextResponse.redirect(new URL("/?error=session_failed", base));
  }

  const cookies = response.headers.getSetCookie();
  const headers = new Headers({ Location: new URL("/dashboard", base).toString() });
  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }

  return new Response(null, { status: 302, headers });
}
