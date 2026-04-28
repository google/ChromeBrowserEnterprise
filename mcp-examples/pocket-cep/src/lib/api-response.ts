/**
 * @file Shared helpers for API route error responses.
 *
 * Every route handler has the same auth-error branch:
 *
 * ```
 * catch (error) {
 *   if (isAuthError(error)) {
 *     return NextResponse.json({ error: error.toPayload() }, { status: 401 });
 *   }
 *   return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
 * }
 * ```
 *
 * {@link respondWithApiError} collapses that into one call while
 * preserving the auth-contract wire shape (`{ error: AuthErrorPayload }`
 * on 401) so the client's `authAwareFetch` + AuthHealthProvider keep
 * working unchanged.
 */

import { NextResponse } from "next/server";
import { isAuthError } from "./auth-errors";
import { getErrorMessage } from "./errors";

/**
 * Returns 401 with the structured AuthErrorPayload when `error` is an
 * `AuthError`; otherwise returns the given `fallbackStatus` (default
 * 500) with a plain-text message. Callers pass the caught error and
 * optionally a domain-specific fallback status (e.g. 502 for upstream
 * MCP failures, 400 for bad-request cases).
 */
export function respondWithApiError(
  error: unknown,
  { fallbackStatus = 500 }: { fallbackStatus?: number } = {},
): NextResponse {
  if (isAuthError(error)) {
    return NextResponse.json({ error: error.toPayload() }, { status: 401 });
  }
  return NextResponse.json({ error: getErrorMessage(error) }, { status: fallbackStatus });
}

/**
 * Shorthand for the "session missing" 401 at the top of every
 * protected route.
 */
export function unauthenticatedResponse(): NextResponse {
  return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
}
