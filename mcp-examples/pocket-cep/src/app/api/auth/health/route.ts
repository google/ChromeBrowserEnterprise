/**
 * @file Health probe for Google credentials.
 *
 * GET /api/auth/health
 *   200 { ok: true }                — Credentials are valid
 *   401 { ok: false, error: AuthErrorPayload } — re-auth required
 *
 * Used by the auth-banner "Check again" button to verify the user has
 * signed in again. No side effects, no cache — each call
 * exchanges the refresh token fresh.
 */

import { NextResponse } from "next/server";
import { getGoogleAccessToken } from "@/lib/access-token";
import { AuthError, isAuthError } from "@/lib/auth-errors";
import { requireSession } from "@/lib/session";
import { getErrorMessage } from "@/lib/errors";

/**
 * Probes Google credentials by requesting a fresh access token. Returns 200
 * if Google issues one and 401 with the structured payload if it refuses.
 */
export async function GET() {
  if (!(await requireSession())) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  try {
    const token = await getGoogleAccessToken();
    if (!token) {
      throw new AuthError({
        code: "no_credentials",
        source: "admin-sdk",
        message: "No Google access token available.",
        remedy: "Configure your credentials or sign in.",
      });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ ok: false, error: error.toPayload() }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
