/**
 * @file Mode-aware route protection (Next.js 16 proxy).
 *
 * Next.js 16 renamed the `middleware.ts` convention to `proxy.ts` and
 * the exported `middleware` function to `proxy`. Placing this file at
 * `src/proxy.ts` (matching the `src` layout used elsewhere) is all
 * Next.js needs — no explicit import is required.
 *
 * service_account mode: no login needed. Sessionless requests are
 * redirected to /api/auth/auto-session which mints a cookie
 * automatically, then redirects to /dashboard. The landing page
 * at "/" is never shown.
 *
 * user_oauth mode: requires Google OAuth sign-in. Unauthenticated
 * users hitting /dashboard are redirected to "/" (landing page).
 * Authenticated users hitting "/" are redirected to /dashboard.
 *
 * The session check uses `getSessionCookie` (a cookie-name lookup)
 * rather than a full `getSession` API call. This keeps the proxy
 * fast since it runs on every matched request. The trade-off is that
 * an expired or invalid cookie will pass the proxy but fail at the
 * API layer, which returns 401 and the frontend handles it.
 *
 * The `config.matcher` limits this to "/" and "/dashboard/*" so API
 * routes, static assets, and _next/ paths are never intercepted.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { getEnv, isEnvValidationError } from "@/lib/env";
import { renderEnvErrorHtml, renderMcpUnreachableHtml } from "@/lib/env-error-page";
import { probeMcpServer } from "@/lib/doctor-checks";

/**
 * Cached "ok" results for the MCP reachability check. The dashboard
 * proxy runs on every page load — re-probing localhost on each
 * request would add an unnecessary fetch to the hot path. Failures
 * are intentionally NOT cached so recovery is fast: as soon as the
 * server comes back, the next request unblocks.
 */
let mcpHealthCache: { ok: boolean; checkedAt: number } | null = null;
const MCP_CACHE_TTL_OK_MS = 30_000;

/**
 * Returns true if the MCP server responds at all (any HTTP status —
 * even 405 means the server is up). Caches successful results for
 * 30 seconds to avoid a probe per request; failures re-probe every
 * time so the dashboard unblocks the moment MCP comes back.
 */
async function isMcpReachable(url: string): Promise<boolean> {
  const now = Date.now();
  if (mcpHealthCache?.ok && now - mcpHealthCache.checkedAt < MCP_CACHE_TTL_OK_MS) {
    return true;
  }
  const result = await probeMcpServer(url);
  mcpHealthCache = { ok: result.ok, checkedAt: now };
  return result.ok;
}

/**
 * Route-protection proxy. Redirects users based on auth mode and
 * session state, then gates dashboard requests on MCP reachability.
 *
 * Two setup-blocker failures short-circuit with a styled HTML page
 * (rather than the raw Next.js dev overlay):
 *   1. `EnvValidationError` from `getEnv()` — missing required env.
 *   2. MCP server unreachable — the dashboard is functionally broken
 *      without it, so we treat it as critical, same shape as the env
 *      page.
 *
 * The MCP gate runs after auth redirects so unauthenticated users
 * still land on `/`, not the MCP error page.
 */
export async function proxy(request: NextRequest) {
  let env: ReturnType<typeof getEnv>;
  try {
    env = getEnv();
  } catch (error) {
    if (isEnvValidationError(error)) {
      return new NextResponse(renderEnvErrorHtml(error.issues), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    throw error;
  }

  const sessionCookie = getSessionCookie(request);
  const { pathname } = request.nextUrl;

  // Auth-mode redirects. Each branch either returns a redirect or
  // falls through to the MCP gate below.
  if (env.AUTH_MODE === "service_account") {
    if (!sessionCookie) {
      return NextResponse.redirect(new URL("/api/auth/auto-session", request.url));
    }
    if (pathname === "/") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    // service_account + session + /dashboard → fall through
  } else {
    if (sessionCookie && pathname === "/") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    if (!sessionCookie && pathname.startsWith("/dashboard")) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    // user_oauth + session + /dashboard, or unauthenticated `/` → fall through
  }

  // MCP gate: dashboard requests only. The landing page doesn't talk
  // to MCP, so don't block it on MCP health.
  if (pathname.startsWith("/dashboard")) {
    const mcpOk = await isMcpReachable(env.MCP_SERVER_URL);
    if (!mcpOk) {
      return new NextResponse(renderMcpUnreachableHtml(env.MCP_SERVER_URL), {
        status: 503,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  }

  return NextResponse.next();
}

/**
 * Next.js proxy matcher. Only intercepts the landing page and
 * dashboard routes -- API routes and static files are excluded so they
 * are not slowed down by the proxy.
 */
export const config = {
  matcher: ["/", "/dashboard/:path*"],
};
