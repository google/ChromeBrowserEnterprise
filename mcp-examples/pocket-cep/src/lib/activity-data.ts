/**
 * @file Server-side helpers for the recent-Chrome-activity feature.
 *
 * Extracted from the activity route so both the route handler and the
 * dashboard's RSC prefetch can share the same fetch logic + cache
 * entries. The cache key is `activity:<callerKey>:<days>`, matching the
 * route handler exactly so a server-rendered prefetch fills the same
 * `getOrFetch` slot the API would.
 */

import { buildGoogleApiHeaders } from "./access-token";
import { toAuthError } from "./auth-errors";
import { LOG_TAGS } from "./constants";
import type { ChromeAuditEvent } from "./activity-summarizer";

/**
 * Default and maximum days of history. Defaults match the route handler
 * so the RSC and the API path don't disagree on cache keys.
 */
export const DEFAULT_ACTIVITY_DAYS = 7;
export const MAX_ACTIVITY_DAYS = 30;

const ACTIVITY_MAX_EVENTS = 250;
const ACTIVITY_PAGE_SIZE = 250;

/**
 * Pulls and groups Chrome audit events for the given caller, scoped to
 * `days` of history. Pagination stops at {@link ACTIVITY_MAX_EVENTS}.
 */
/**
 * Fetches raw, paginated Chrome audit events for the given customer.
 */
export async function fetchRawActivity(
  tokenToUse: string,
  days: number,
  customerId?: string,
  impersonatedUser?: string,
): Promise<ChromeAuditEvent[]> {
  const requestHeaders = await buildGoogleApiHeaders(tokenToUse);

  const baseUrl = new URL(
    "https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/chrome",
  );
  baseUrl.searchParams.set("customerId", customerId || "my_customer");
  baseUrl.searchParams.set("startTime", new Date(Date.now() - days * 86_400_000).toISOString());

  const activities: ChromeAuditEvent[] = [];
  let pageToken: string | undefined;

  do {
    const remaining = ACTIVITY_MAX_EVENTS - activities.length;
    const maxResults = Math.min(remaining, ACTIVITY_PAGE_SIZE);

    const url = new URL(baseUrl.toString());
    url.searchParams.set("maxResults", String(maxResults));
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const response = await fetch(url.toString(), {
      headers: requestHeaders,
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const authErr = toAuthError(body, "admin-sdk", { impersonatedUser });
      if (authErr) throw authErr;
      console.log(LOG_TAGS.USERS, "Activity fetch failed with status:", response.status, body);
      break;
    }

    const data = (await response.json()) as {
      items?: ChromeAuditEvent[];
      nextPageToken?: string;
    };
    if (data.items?.length) activities.push(...data.items);
    pageToken = data.nextPageToken;
  } while (pageToken && activities.length < ACTIVITY_MAX_EVENTS);

  return activities;
}

/**
 * Clamps a `?days` query string into the supported range. Falls back
 * to {@link DEFAULT_ACTIVITY_DAYS} when missing or unparseable.
 */
export function parseActivityDays(raw: string | null): number {
  if (!raw) return DEFAULT_ACTIVITY_DAYS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_ACTIVITY_DAYS;
  return Math.min(parsed, MAX_ACTIVITY_DAYS);
}
