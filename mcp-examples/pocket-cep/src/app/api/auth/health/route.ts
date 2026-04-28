/**
 * @file Health probe for Google ADC credentials.
 *
 * GET /api/auth/health
 *   200 { ok: true }                — ADC is valid
 *   401 { ok: false, error: AuthErrorPayload } — re-auth required
 *
 * Used by the auth-banner "Check again" button to verify the user has
 * re-run `gcloud auth login`. No side effects, no cache — each call
 * exchanges the refresh token fresh.
 */

import { NextResponse } from "next/server";
import { getADCToken } from "@/lib/adc";
import { isAuthError } from "@/lib/auth-errors";
import { requireSession } from "@/lib/session";
import { getErrorMessage } from "@/lib/errors";

/**
 * Probes ADC by requesting a fresh access token. Returns 200 if Google
 * issues one and 401 with the structured payload if it refuses.
 */
export async function GET() {
  if (!(await requireSession())) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  try {
    await getADCToken();
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ ok: false, error: error.toPayload() }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
