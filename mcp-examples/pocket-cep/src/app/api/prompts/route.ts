/**
 * @file Proxies the MCP server's prompt endpoints.
 *
 * GET  /api/prompts  → `prompts/list` (cached 5 min per caller identity)
 * POST /api/prompts  → body { name, args? }, returns { text }. We call
 *                      the MCP server's `prompts/get` and concatenate
 *                      its user-role text so the caller can send it as
 *                      a single user turn.
 */

import { NextResponse } from "next/server";
import type { PromptMessage } from "@modelcontextprotocol/sdk/types.js";
import { getGoogleAccessToken } from "@/lib/access-token";
import { getEnv } from "@/lib/env";
import { getMcpPrompt, listMcpPrompts } from "@/lib/mcp-client";
import { buildCallerCacheKey } from "@/lib/cache-key";
import { requireSession } from "@/lib/session";
import { LOG_TAGS } from "@/lib/constants";
import { getErrorMessage } from "@/lib/errors";
import { getOrFetch, CACHE_TAGS } from "@/lib/server-cache";
import { respondWithApiError, unauthenticatedResponse } from "@/lib/api-response";

const CATALOG_TTL_MS = 5 * 60 * 1000;

export async function GET() {
  if (!(await requireSession())) return unauthenticatedResponse();

  const config = getEnv();
  const accessToken = await getGoogleAccessToken();
  const callerKey = buildCallerCacheKey(config.MCP_SERVER_URL, accessToken);

  try {
    const prompts = await getOrFetch({
      key: `prompts:${callerKey}`,
      ttlMs: CATALOG_TTL_MS,
      tags: [CACHE_TAGS.PROMPTS],
      fetcher: () => listMcpPrompts(config.MCP_SERVER_URL, accessToken),
    });
    return NextResponse.json({ prompts });
  } catch (error) {
    /**
     * Return 503 (not the shared helper's default) so the client knows
     * to retry — during `npm run dev:full` the Next app boots ahead of
     * the MCP server and the first call can ECONNREFUSED briefly. We
     * still return an empty `prompts` array so the UI's shape stays
     * stable when SWR returns the payload.
     */
    console.log(LOG_TAGS.MCP, "listMcpPrompts failed:", getErrorMessage(error));
    return NextResponse.json({ prompts: [], error: getErrorMessage(error) }, { status: 503 });
  }
}

/**
 * Expands a prompt by name. The response is the concatenated text of
 * the server's user-role messages — we punt on assistant-role messages
 * for now because Pocket CEP always injects prompts as a single user
 * turn. Multi-turn expansion can be added later if a prompt needs it.
 */
export async function POST(request: Request) {
  if (!(await requireSession())) return unauthenticatedResponse();

  const config = getEnv();
  const accessToken = await getGoogleAccessToken();

  let body: { name?: string; args?: Record<string, string> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body?.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  try {
    const messages: PromptMessage[] = await getMcpPrompt(
      config.MCP_SERVER_URL,
      body.name,
      body.args,
      accessToken,
    );

    // Concatenate user-role text only. Non-text content and
    // assistant/system roles are ignored; add threaded handling when
    // a server prompt needs it.
    const text = messages
      .filter((m) => m.role === "user" && m.content.type === "text")
      .map((m) => (m.content.type === "text" ? m.content.text : ""))
      .join("\n\n");

    return NextResponse.json({ text });
  } catch (error) {
    return respondWithApiError(error, { fallbackStatus: 502 });
  }
}
