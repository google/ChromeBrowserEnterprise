/**
 * @file Conditional-GET helpers: ETag + Cache-Control for read endpoints.
 *
 * Centralises the small amount of HTTP-cache plumbing so route handlers
 * can opt in with a single call:
 *
 * ```ts
 * return conditionalJson(request, payload, { maxAge: 60, swr: 540 });
 * ```
 *
 * Two important contracts:
 *
 * 1. **Only successful responses are cacheable.** Auth-failure (401)
 *    responses must never carry these headers, otherwise a stale 401
 *    could persist client-side after the credential is fixed. Callers
 *    only invoke this helper on the success path.
 * 2. **Always `Cache-Control: private`.** Every response is scoped to
 *    the signed-in user (or service account); shared/CDN caching
 *    would leak data between callers.
 */

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Cacheability options for {@link conditionalJson}.
 */
export type ConditionalJsonOptions = {
  /** Browser fresh-cache lifetime in seconds. */
  maxAge: number;
  /** Stale-while-revalidate window in seconds, served while a refresh runs. */
  swr: number;
};

/**
 * Builds a strong ETag for any JSON-serialisable payload. SHA-1 is
 * used because it's fast and the entropy is more than enough — we
 * only need collision resistance against accidental matches, not
 * cryptographic strength.
 */
export function payloadETag(payload: unknown): string {
  const hash = createHash("sha1").update(JSON.stringify(payload)).digest("hex");
  return `"${hash}"`;
}

/**
 * Returns either a 304 (when the client's `If-None-Match` matches)
 * or a 200 carrying `ETag` + `Cache-Control: private, max-age, swr`.
 *
 * Use this helper only on the success branch of a route — error
 * responses must remain uncacheable.
 */
export function conditionalJson(
  request: Request,
  payload: unknown,
  options: ConditionalJsonOptions,
): NextResponse {
  const etag = payloadETag(payload);
  const cacheControl = `private, max-age=${options.maxAge}, stale-while-revalidate=${options.swr}`;

  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: etag,
        "Cache-Control": cacheControl,
      },
    });
  }

  return NextResponse.json(payload, {
    headers: {
      ETag: etag,
      "Cache-Control": cacheControl,
    },
  });
}
