/**
 * @file API route for auto-generating risky activity summarization cards.
 *
 * POST /api/insights/risky-activity
 * Body: { selectedUser?: string }
 * Response: { summary: string }
 *
 * Caches generated summaries in-memory per user to avoid redundant MCP tool
 * calls on repeated dashboard loads.
 */

import { NextResponse } from "next/server";
import { getGoogleAccessToken } from "@/lib/access-token";
import { getEnv } from "@/lib/env";
import { callMcpTool } from "@/lib/mcp-client";
import { requireSession } from "@/lib/session";
import { isAuthError, toAuthError } from "@/lib/auth-errors";
import { CACHE_TAGS, getOrFetch } from "@/lib/server-cache";
import { summarizeChromeActivity } from "@/lib/deterministic-insights";

const INSIGHT_TTL_MS = 5 * 60 * 1000;

/**
 * Generates or retrieves a cached risky activity summarization for the dashboard.
 */
export async function POST(request: Request) {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { selectedUser?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const selectedUser = body.selectedUser ?? "";
  const config = getEnv();
  const accessToken = await getGoogleAccessToken();

  try {
    const cacheKey = `insights:risky-activity:${selectedUser}`;
    const summary = await getOrFetch({
      key: cacheKey,
      ttlMs: INSIGHT_TTL_MS,
      tags: [CACHE_TAGS.INSIGHTS],
      fetcher: async () => {
        const userKeyArg = selectedUser || "all";
        const startTimeIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const toolResult = await callMcpTool(
          config.MCP_SERVER_URL,
          "get_chrome_activity_log",
          { userKey: userKeyArg, startTime: startTimeIso, maxResults: 1000 },
          accessToken,
        );

        const trText =
          typeof toolResult.content === "string"
            ? toolResult.content
            : JSON.stringify(toolResult.content);
        const authErr = toAuthError(trText, "mcp-tool") ?? toAuthError(toolResult, "mcp-tool");
        if (authErr) throw authErr;

        if (toolResult.isError) {
          throw new Error("MCP tool execution failed");
        }

        return summarizeChromeActivity(
          toolResult.structuredContent ?? toolResult.content,
          selectedUser || undefined,
        );
      },
    });

    return NextResponse.json({ summary });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: error.toPayload() }, { status: 401 });
    }
    return NextResponse.json(
      {
        error:
          "Risky activity summarization is unavailable due to insufficient account permissions or missing detectors.",
      },
      { status: 503 },
    );
  }
}
