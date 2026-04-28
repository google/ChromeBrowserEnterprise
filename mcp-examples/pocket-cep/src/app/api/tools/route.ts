/**
 * @file API route to list available MCP tools.
 *
 * Returns the full list of tools from the MCP server, including their
 * names, descriptions, and input schemas. Used by the educational tools
 * catalog and to show what the agent can do.
 *
 * GET /api/tools -> { tools: McpToolDefinition[] }
 *
 * This endpoint makes a real MCP `tools/list` call to the upstream
 * server, so the results always reflect the server's current
 * capabilities. The response includes JSON Schema `inputSchema` for
 * each tool, which the frontend could use to render dynamic forms or
 * validation hints.
 *
 * Returns 502 if the MCP server is unreachable, giving the frontend a
 * clear signal to show a connection-error state rather than an empty
 * tool list.
 */

import { NextResponse } from "next/server";
import { listMcpTools } from "@/lib/mcp-client";
import { getGoogleAccessToken } from "@/lib/access-token";
import { getEnv } from "@/lib/env";
import { buildCallerCacheKey } from "@/lib/cache-key";
import { requireSession } from "@/lib/session";
import { LOG_TAGS } from "@/lib/constants";
import { getErrorMessage } from "@/lib/errors";
import { getOrFetch, CACHE_TAGS } from "@/lib/server-cache";
import { respondWithApiError, unauthenticatedResponse } from "@/lib/api-response";

/**
 * Tool schemas are stable for the duration of a dev session — the MCP
 * server only reloads them when the developer restarts it. Five minutes
 * matches the existing prompts-catalog cache.
 */
const TOOLS_TTL_MS = 5 * 60 * 1000;

/**
 * Lists all MCP tools available on the Chrome Enterprise Premium server.
 * Requires an authenticated session; returns 401 otherwise.
 */
export async function GET() {
  if (!(await requireSession())) return unauthenticatedResponse();

  const config = getEnv();
  const accessToken = await getGoogleAccessToken();
  const callerKey = buildCallerCacheKey(config.MCP_SERVER_URL, accessToken);

  try {
    const tools = await getOrFetch({
      key: `tools:${callerKey}`,
      ttlMs: TOOLS_TTL_MS,
      tags: [CACHE_TAGS.TOOLS],
      fetcher: () => listMcpTools(config.MCP_SERVER_URL, accessToken),
    });
    return NextResponse.json({ tools });
  } catch (error) {
    console.error(LOG_TAGS.MCP, "Failed to list tools:", getErrorMessage(error));
    return respondWithApiError(error, { fallbackStatus: 502 });
  }
}
