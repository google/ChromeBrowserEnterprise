/**
 * @file Client-side fetch wrapper that recognizes 401 AuthErrorPayload
 * responses and dispatches a window event so the global banner can react.
 *
 * Kept deliberately tiny and framework-free: it doesn't import React or
 * use hooks, so it can be called from anywhere — components, event
 * handlers, or plain helpers — without context propagation.
 *
 * The chat-message component dispatches the same event when it detects
 * an auth payload in a tool part's errorText, so the banner lights up
 * whether the auth error hit a JSON endpoint or streamed through the AI
 * SDK's tool channel.
 */

import { isAuthErrorPayload, type AuthErrorPayload } from "./auth-errors";

/**
 * Name of the window-scoped custom event carrying an AuthErrorPayload.
 * Listeners should be attached in AuthHealthProvider.
 */
export const AUTH_ERROR_EVENT = "auth-error";

/**
 * Dispatches the auth-error event. Exposed so non-fetch callers (e.g. the
 * chat-message component when it sees an auth-shaped errorText) can light
 * up the banner using the same code path.
 */
export function reportAuthErrorGlobally(payload: AuthErrorPayload): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<AuthErrorPayload>(AUTH_ERROR_EVENT, { detail: payload }));
}

/**
 * Thin wrapper around fetch. On 401 responses whose JSON body matches
 * `{ error: AuthErrorPayload }`, dispatches the auth event and returns
 * the original response so callers can still inspect it. On all other
 * responses it behaves like plain fetch.
 */
export async function authAwareFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status !== 401) return response;

  const cloned = response.clone();
  try {
    const body = (await cloned.json()) as { error?: unknown };
    if (isAuthErrorPayload(body.error)) {
      reportAuthErrorGlobally(body.error);
    }
  } catch {
    // Not JSON; not our shape. Silently pass through.
  }

  return response;
}
