/**
 * @file Server-side user search via Google Admin SDK Directory API.
 *
 * GET /api/users?q=alice → searches users by email/name
 * GET /api/users         → returns first 20 users
 *
 * Cached in-process per (caller identity × normalized query) for 60 s.
 * Most users repeat the same prefix many times within a session, so this
 * cuts down on Directory API calls without surfacing stale data for long.
 *
 * Auth failures return HTTP 401 with an AuthErrorPayload so the client
 * can render an actionable remedy instead of silently showing an empty
 * dropdown.
 */

import { type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { getGoogleAccessToken } from "@/lib/access-token";
import { searchUsers, buildAdminQuery, type DirectoryUser } from "@/lib/admin-sdk";
import { buildCallerCacheKey } from "@/lib/cache-key";
import { requireSession } from "@/lib/session";
import { conditionalJson } from "@/lib/http-cache";
import { getOrFetch, CACHE_TAGS } from "@/lib/server-cache";
import { respondWithApiError, unauthenticatedResponse } from "@/lib/api-response";

export type { DirectoryUser };

const USERS_TTL_MS = 60_000;

/**
 * Searches the org's user directory. The optional `q` query parameter
 * is passed to the Admin SDK as a server-side filter.
 */
export async function GET(request: NextRequest) {
  if (!(await requireSession())) return unauthenticatedResponse();

  const query = request.nextUrl.searchParams.get("q") ?? "";
  const config = getEnv();
  const accessToken = await getGoogleAccessToken();
  const adminQuery = buildAdminQuery(query);
  const callerKey = buildCallerCacheKey(config.MCP_SERVER_URL, accessToken);

  try {
    const users = await getOrFetch({
      key: `users:${callerKey}:${query.trim().toLowerCase()}`,
      ttlMs: USERS_TTL_MS,
      tags: [CACHE_TAGS.USERS],
      fetcher: () => searchUsers(adminQuery, accessToken),
    });
    return conditionalJson(request, { users }, { maxAge: 30, swr: 120 });
  } catch (error) {
    return respondWithApiError(error);
  }
}
