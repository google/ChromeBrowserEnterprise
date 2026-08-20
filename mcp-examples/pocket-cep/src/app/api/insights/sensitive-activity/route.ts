/**
 * @file API route for fetching aggregated daily sensitive Chrome event metrics for dashboard charts.
 *
 * GET /api/insights/sensitive-activity
 * Query params: ?days=7&selectedUser=user@domain.com
 * Response: { chartData: ChartPoint[] }
 */

import { NextResponse, type NextRequest } from "next/server";
import { getGoogleAccessToken } from "@/lib/access-token";
import { getEnv } from "@/lib/env";
import { requireSession } from "@/lib/session";
import { getActiveCustomerId, getServiceAccountConfig } from "@/lib/sa-session";
import { isAuthError } from "@/lib/auth-errors";
import { CACHE_TAGS, getOrFetch } from "@/lib/server-cache";
import { fetchRawActivity, parseActivityDays } from "@/lib/activity-data";
import {
  resolveBucketKey,
  getParameterValue,
  extractEventsArray,
  type ChromeAuditEvent,
} from "@/lib/activity-summarizer";
import { buildCallerCacheKey } from "@/lib/cache-key";
import { respondWithApiError, unauthenticatedResponse } from "@/lib/api-response";

/**
 * Represents a single daily data point representing counts of sensitive activity events.
 */
export type ChartPoint = {
  date: string;
  dlpCount: number;
  threatCount: number;
};

/**
 * Handles GET requests to retrieve aggregated daily Chrome event metrics.
 * Integrates service account/token caching and filters by optional user scope.
 */
export async function GET(request: NextRequest) {
  if (!(await requireSession())) return unauthenticatedResponse();

  const { searchParams } = request.nextUrl;
  const days = parseActivityDays(searchParams.get("days"));
  const selectedUser = searchParams.get("selectedUser")?.trim().toLowerCase() ?? "";

  const config = getEnv();
  const accessToken = await getGoogleAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: "Access token missing" }, { status: 401 });
  }

  try {
    const customerId = await getActiveCustomerId();
    const saConfig =
      config.AUTH_MODE === "service_account" ? await getServiceAccountConfig() : null;
    const impersonatedUser = saConfig?.impersonatedUser;

    const callerKey = buildCallerCacheKey(config.MCP_SERVER_URL, accessToken, customerId);
    const cacheKey = `insights:sensitive-activity:${callerKey}:${days}:${selectedUser}`;

    const chartData = await getOrFetch<ChartPoint[]>({
      key: cacheKey,
      ttlMs: 5 * 60 * 1000,
      tags: [CACHE_TAGS.ACTIVITY],
      fetcher: async () => {
        const rawEvents = await fetchRawActivity(accessToken, days, customerId, impersonatedUser);
        const flattenedEvents = extractEventsArray(rawEvents);
        return processEventsToChartPoints(flattenedEvents, days, selectedUser);
      },
    });

    return NextResponse.json({ chartData });
  } catch (error) {
    if (isAuthError(error)) return respondWithApiError(error);
    console.error("Failed to generate sensitive activity chart data:", error);
    return NextResponse.json({ chartData: [] });
  }
}

function processEventsToChartPoints(
  events: ChromeAuditEvent[],
  days: number,
  selectedUser: string,
): ChartPoint[] {
  // 1. Generate map of date-string -> ChartPoint for the last N days (fill in zeros)
  const map = new Map<string, ChartPoint>();
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * 86_400_000);
    // Format: "Aug 14"
    const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const isoDate = getIsoDateString(d);
    map.set(isoDate, { date: label, dlpCount: 0, threatCount: 0 });
  }

  // 2. Loop and aggregate events
  for (const ev of events) {
    const timeStr = ev.id?.time;
    if (!timeStr) continue;

    const evUser = ev.actor?.email?.toLowerCase();
    if (selectedUser && evUser !== selectedUser) continue;

    const eventDate = new Date(timeStr);
    const isoDate = getIsoDateString(eventDate);
    const point = map.get(isoDate);
    if (!point) continue; // outside the chart history window

    // Determine type
    const params = ev.parameters;
    const actionVal =
      getParameterValue(params, "ACTION") ?? getParameterValue(params, "EVENT_RESULT");
    const upperAction = actionVal ? String(actionVal).toUpperCase() : "";
    const isBlocked = actionVal ? upperAction.includes("BLOCK") : true;
    const isWarned = !isBlocked && (upperAction.includes("WARN") || upperAction.includes("ALERT"));
    const isAudited = !isBlocked && !isWarned;

    const { key } = resolveBucketKey(ev.eventName ?? "", isAudited);

    const hasDlpParams = !!(
      getParameterValue(params, "RULE_NAME") ??
      getParameterValue(params, "POLICY_NAME") ??
      getParameterValue(params, "DETECTOR_NAME") ??
      getParameterValue(params, "TRIGGER") ??
      getParameterValue(params, "TRIGGERED_RULES_REASON")
    );

    if (
      key === "DLP" ||
      key === "AUDITED_DLP" ||
      key === "NAVIGATION" ||
      key === "AUDITED_NAVIGATION" ||
      hasDlpParams
    ) {
      point.dlpCount++;
    } else if (
      key === "MALWARE" ||
      key === "PASSWORD" ||
      key === "DOWNLOAD" ||
      key === "AUDITED_DOWNLOAD" ||
      key.includes("UNSCANNED")
    ) {
      point.threatCount++;
    }
  }

  // 3. Return sorted by date
  return Array.from(map.values());
}

/** Returns YYYY-MM-DD in local/server timezone for simple grouping */
function getIsoDateString(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
