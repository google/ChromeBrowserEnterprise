/**
 * @file Wraps the app in an SWRConfig with a shared auth-aware fetcher.
 *
 * Why this lives in its own file: `SWRConfig` is a Client Component (it
 * uses React context). Keeping the provider isolated lets the root layout
 * stay close to the App Router idiom — server-rendered metadata, with
 * client-only context wrappers as small leaf modules.
 *
 * **Auth contract**: the fetcher uses `authAwareFetch`, which dispatches
 * a window event for any 401 carrying an AuthErrorPayload. The
 * AuthHealthProvider listens for that event and lights up the global
 * banner. Routes that 304 (via the conditional-GET helper) flow through
 * the browser HTTP cache transparently — SWR sees the cached body and
 * hands it to consumers as if it were fresh.
 *
 * ## Why no localStorage cache provider
 *
 * An earlier revision wired SWR's `provider` to a localStorage-backed
 * `Map`. It caused hydration mismatches: the SSR pass had an empty
 * cache (no `window`), but the client's first render hydrated from
 * localStorage and saw populated data — so any `useSWR` consumer
 * whose UI branched on `isLoading` (e.g. the search-input spinner)
 * rendered different markup on the two passes.
 *
 * The persistence story without it:
 *
 * - **Per-tab navigation**: SWR's in-memory cache covers it.
 * - **Hard reload**: the browser HTTP cache returns 304s (we send
 *   `Cache-Control: private, max-age, stale-while-revalidate` from
 *   `src/lib/http-cache.ts`), and SWR re-uses the cached body.
 * - **First paint of `/dashboard`**: the RSC pre-fetches activity
 *   server-side and seeds SWR via `fallback` (see `dashboard-client.tsx`).
 *
 * That covers the common cases without the SSR/hydration trap.
 */

"use client";

import { SWRConfig } from "swr";
import type { ReactNode } from "react";
import { authAwareFetch } from "@/lib/auth-aware-fetch";
import { isAuthErrorPayload } from "@/lib/auth-errors";

/**
 * Default fetcher passed to every `useSWR` call. Routes return JSON; we
 * throw on non-2xx so SWR exposes an `error` to consumers. Auth
 * payloads are still surfaced via the global banner because
 * `authAwareFetch` dispatches the window event before we throw.
 */
async function defaultFetcher<T>(url: string): Promise<T> {
  const res = await authAwareFetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: unknown };
    if (isAuthErrorPayload(body.error)) {
      const err = new Error(body.error.message) as Error & { authPayload: typeof body.error };
      err.authPayload = body.error;
      throw err;
    }
    throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/**
 * App-wide SWR provider. Sets sensible defaults:
 *
 * - `dedupingInterval: 30s` — bounds the revalidate-on-focus rate.
 * - `revalidateOnFocus: true` — picks up server changes when the user
 *   returns to the tab.
 * - `errorRetryCount: 3` — tolerates dev-time MCP startup races.
 */
export function SwrProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: defaultFetcher,
        dedupingInterval: 30_000,
        revalidateOnFocus: true,
        errorRetryCount: 3,
      }}
    >
      {children}
    </SWRConfig>
  );
}
