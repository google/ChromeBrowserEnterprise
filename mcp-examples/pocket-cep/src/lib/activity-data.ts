/**
 * @file Server-side helpers for the recent-Chrome-activity feature.
 *
 * Extracted from the activity route so both the route handler and the
 * dashboard's RSC prefetch can share the same fetch logic + cache
 * entries. The cache key is `activity:<callerKey>:<days>`, matching the
 * route handler exactly so a server-rendered prefetch fills the same
 * `getOrFetch` slot the API would.
 */

import { getEnv } from "./env";
import { getGoogleAccessToken } from "./access-token";
import { getADCToken, buildGoogleApiHeaders } from "./adc";
import { isAuthError, toAuthError } from "./auth-errors";
import { buildCallerCacheKey } from "./cache-key";
import { LOG_TAGS } from "./constants";
import { getErrorMessage } from "./errors";
import { getOrFetch, CACHE_TAGS } from "./server-cache";

/**
 * Per-user activity summary: event count and most recent event timestamp.
 */
export type UserActivity = {
  eventCount: number;
  lastEventAt?: string;
};

/**
 * Map keyed by lowercase user email.
 */
export type ActivityMap = Record<string, UserActivity>;

const ACTIVITY_TTL_MS = 10 * 60 * 1000;

/**
 * Default and maximum days of history. Defaults match the route handler
 * so the RSC and the API path don't disagree on cache keys.
 */
export const DEFAULT_ACTIVITY_DAYS = 7;
export const MAX_ACTIVITY_DAYS = 30;

const ACTIVITY_MAX_EVENTS = 250;
const ACTIVITY_PAGE_SIZE = 250;

/**
 * Returns the cached activity map for the current caller. Resolves the
 * Google access token (user OAuth or ADC fallback) and builds the same
 * `getOrFetch` key the API route uses, so a single warm cache serves
 * both code paths.
 *
 * Throws `AuthError` on credential failure so the caller (route or RSC)
 * can decide how to show it. Non-auth failures resolve to an empty
 * map — activity badges are optional.
 */
export async function getCachedActivity(
  days: number = DEFAULT_ACTIVITY_DAYS,
): Promise<ActivityMap> {
  const config = getEnv();
  const accessToken = await getGoogleAccessToken();
  const tokenToUse = accessToken ?? (await getADCToken());
  const callerKey = buildCallerCacheKey(config.MCP_SERVER_URL, tokenToUse);

  return getOrFetch({
    key: `activity:${callerKey}:${days}`,
    ttlMs: ACTIVITY_TTL_MS,
    tags: [CACHE_TAGS.ACTIVITY],
    fetcher: () => fetchActivity(tokenToUse, !accessToken, days),
  });
}

/**
 * Variant of {@link getCachedActivity} that swallows auth errors and
 * returns an empty map. Use from RSC entry points where an auth failure
 * shouldn't 500 the page — the client banner picks it up via the next
 * client-side fetch and lights up.
 */
export async function getActivitySafe(days: number = DEFAULT_ACTIVITY_DAYS): Promise<ActivityMap> {
  try {
    return await getCachedActivity(days);
  } catch (error) {
    if (isAuthError(error)) {
      console.log(LOG_TAGS.USERS, "RSC activity prefetch saw AuthError; deferring to client.");
      return {};
    }
    console.log(LOG_TAGS.USERS, "RSC activity prefetch failed:", getErrorMessage(error));
    return {};
  }
}

/**
 * Pulls and groups Chrome audit events for the given caller, scoped to
 * `days` of history. Pagination stops at {@link ACTIVITY_MAX_EVENTS}.
 */
async function fetchActivity(
  tokenToUse: string,
  useADCQuotaProject: boolean,
  days: number,
): Promise<ActivityMap> {
  const requestHeaders = await buildGoogleApiHeaders(tokenToUse, useADCQuotaProject);

  const baseUrl = new URL(
    "https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/chrome",
  );
  baseUrl.searchParams.set("customerId", "my_customer");
  baseUrl.searchParams.set("startTime", new Date(Date.now() - days * 86_400_000).toISOString());

  const activities: RawActivity[] = [];
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
      const authErr = toAuthError(body, "admin-sdk");
      if (authErr) throw authErr;
      console.log(LOG_TAGS.USERS, "Activity fetch failed with status:", response.status, body);
      break;
    }

    const data = (await response.json()) as {
      items?: RawActivity[];
      nextPageToken?: string;
    };
    if (data.items?.length) activities.push(...data.items);
    pageToken = data.nextPageToken;
  } while (pageToken && activities.length < ACTIVITY_MAX_EVENTS);

  return groupByUser(activities);
}

type RawActivity = {
  actor?: { email?: string; profileId?: string };
  id?: { time?: string };
};

function groupByUser(activities: RawActivity[]): ActivityMap {
  const map: ActivityMap = {};
  for (const event of activities) {
    const email = event?.actor?.email?.toLowerCase();
    if (!email) continue;
    const entry = map[email] ?? { eventCount: 0 };
    entry.eventCount += 1;
    const time = event?.id?.time;
    if (time && (!entry.lastEventAt || time > entry.lastEventAt)) {
      entry.lastEventAt = time;
    }
    map[email] = entry;
  }
  return map;
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
