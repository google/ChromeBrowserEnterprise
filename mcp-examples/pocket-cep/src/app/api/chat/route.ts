/**
 * @file Streaming chat API route using the Vercel AI SDK.
 *
 * POST /api/chat
 * Body: { messages: UIMessage[], selectedUser: string, modelId?: string }
 * Headers: x-pocket-cep-byok: "<provider>:<api-key>"  (optional BYOK)
 * Response: UI message stream (consumed by useChat on the frontend)
 *
 * The client picks a model from the top-bar selector; this route
 * looks up the chosen `modelId`, instantiates the matching Vercel AI
 * SDK provider (Anthropic / OpenAI / Google), and streams. If the
 * server env doesn't carry the provider's key, the client may
 * forward a user-supplied key via the BYOK header. That key is used
 * only to construct this single SDK call and is never logged or
 * persisted.
 */

import { NextRequest } from "next/server";
import { streamText, convertToModelMessages, stepCountIs } from "ai";
import type { LanguageModel, UIMessage } from "ai";
import { getGoogleAccessToken } from "@/lib/access-token";
import { getEnv } from "@/lib/env";
import { getMcpToolsForAiSdk } from "@/lib/mcp-tools";
import { requireSession } from "@/lib/session";
import { getActiveCustomerId } from "@/lib/sa-session";
import { buildSystemPrompt, LOG_TAGS, MAX_AGENT_ITERATIONS } from "@/lib/constants";
import { BYOK_HEADER, parseByokHeader } from "@/lib/model-preferences";
import { respondWithApiError, unauthenticatedResponse } from "@/lib/api-response";
import { buildModel, resolveModelOption } from "@/lib/build-model";

export async function POST(request: Request) {
  if (!(await requireSession())) {
    return unauthenticatedResponse();
  }

  const body = await request.json();
  const messages: UIMessage[] = Array.isArray(body.messages) ? body.messages : [];
  const selectedUser: string = typeof body.selectedUser === "string" ? body.selectedUser : "";
  const modelId: string | undefined = typeof body.modelId === "string" ? body.modelId : undefined;

  const config = getEnv();
  const [accessToken, customerId] = await Promise.all([
    getGoogleAccessToken(),
    getActiveCustomerId(),
  ]);

  console.log(
    LOG_TAGS.CHAT,
    `Chat for ${selectedUser || "(no user)"}, ${messages.length} messages`,
  );

  let tools;
  try {
    tools = await getMcpToolsForAiSdk(config.MCP_SERVER_URL, accessToken, customerId);
  } catch (error) {
    return respondWithApiError(error, { fallbackStatus: 502 });
  }

  const modelOption = resolveModelOption(modelId, config.LLM_PROVIDER);
  const byok = parseByokHeader(request.headers.get(BYOK_HEADER), modelOption.provider);
  let model: LanguageModel;
  try {
    model = buildModel(modelOption, byok, config);
  } catch (error) {
    return respondWithApiError(error, { fallbackStatus: 400 });
  }

  const result = streamText({
    model,
    system: buildSystemPrompt(selectedUser, customerId),
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(MAX_AGENT_ITERATIONS),
  });

  return result.toUIMessageStreamResponse();
}
