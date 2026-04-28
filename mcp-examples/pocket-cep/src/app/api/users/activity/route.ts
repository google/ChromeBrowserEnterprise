/**
 * @file Returns a map of emails → recent Chrome activity stats.
 *
 * Thin wrapper around `getCachedActivity` from `src/lib/activity-data.ts`.
 * The same helper is called from the dashboard's RSC prefetch, so the
 * server-rendered HTML and any later client-side `useSWR` revalidate
 * land in the same `getOrFetch` cache slot — first-paint and warm
 * navigation pay one upstream call, not two.
 *
 * Auth failures return HTTP 401 with an AuthErrorPayload so the banner
 * and user-selector can show the remedy instead of silently showing
 * empty activity.
 */

import { NextResponse, type NextRequest } from "next/server";
import { isAuthError } from "@/lib/auth-errors";
import { requireSession } from "@/lib/session";
import { LOG_TAGS } from "@/lib/constants";
import { getErrorMessage } from "@/lib/errors";
import { conditionalJson } from "@/lib/http-cache";
import { getCachedActivity, parseActivityDays, type UserActivity } from "@/lib/activity-data";
import { respondWithApiError, unauthenticatedResponse } from "@/lib/api-response";

export type { UserActivity };

export async function GET(request: NextRequest) {
  if (!(await requireSession())) return unauthenticatedResponse();

  const days = parseActivityDays(request.nextUrl.searchParams.get("days"));

  try {
    const grouped = await getCachedActivity(days);
    return conditionalJson(request, { activity: grouped }, { maxAge: 60, swr: 540 });
  } catch (error) {
    // Auth errors get the structured payload; non-auth failures (quota,
    // transient 5xx) fall through to an empty map so the selector can
    // keep rendering without activity badges.
    if (isAuthError(error)) return respondWithApiError(error);
    console.log(LOG_TAGS.USERS, "Activity fetch failed:", getErrorMessage(error));
    return NextResponse.json({ activity: {} });
  }
}
