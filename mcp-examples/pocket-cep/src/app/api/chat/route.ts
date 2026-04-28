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

import { NextResponse } from "next/server";
import { streamText, convertToModelMessages, stepCountIs } from "ai";
import type { LanguageModel, UIMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { getGoogleAccessToken } from "@/lib/access-token";
import { getEnv, type ServerEnv } from "@/lib/env";
import { getMcpToolsForAiSdk } from "@/lib/mcp-tools";
import { requireSession } from "@/lib/session";
import { buildSystemPrompt, LOG_TAGS, MAX_AGENT_ITERATIONS } from "@/lib/constants";
import {
  getDefaultModelFor,
  getModelById,
  type ModelEnvKey,
  type ModelOption,
  type ModelProvider,
} from "@/lib/models";
import { BYOK_HEADER, parseByokHeader } from "@/lib/model-preferences";
import { respondWithApiError, unauthenticatedResponse } from "@/lib/api-response";

/**
 * Per-provider SDK bindings. We always go through the `create` factory
 * with an explicit `apiKey` rather than the env-backed default — the
 * Vercel AI SDK's @ai-sdk/google reads `GOOGLE_GENERATIVE_AI_API_KEY`,
 * which doesn't match our `GOOGLE_AI_API_KEY` env name.
 */
const PROVIDER_SDK: Record<
  ModelProvider,
  {
    create: (opts: { apiKey: string }) => (id: string) => LanguageModel;
    envKey: ModelEnvKey;
  }
> = {
  anthropic: { create: createAnthropic, envKey: "ANTHROPIC_API_KEY" },
  openai: { create: createOpenAI, envKey: "OPENAI_API_KEY" },
  google: { create: createGoogleGenerativeAI, envKey: "GOOGLE_AI_API_KEY" },
};

export async function POST(request: Request) {
  if (!(await requireSession())) {
    return unauthenticatedResponse();
  }

  const body = await request.json();
  const {
    messages,
    selectedUser = "",
    modelId,
  }: { messages: UIMessage[]; selectedUser?: string; modelId?: string } = body;

  if (!messages) {
    return NextResponse.json({ error: "messages is required" }, { status: 400 });
  }

  const config = getEnv();
  const accessToken = await getGoogleAccessToken();

  console.log(
    LOG_TAGS.CHAT,
    `Chat for ${selectedUser || "(no user)"}, ${messages.length} messages`,
  );

  let tools;
  try {
    tools = await getMcpToolsForAiSdk(config.MCP_SERVER_URL, accessToken);
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
    system: buildSystemPrompt(selectedUser),
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(MAX_AGENT_ITERATIONS),
  });

  return result.toUIMessageStreamResponse();
}

/**
 * Looks up a model option by its client-supplied ID. Falls back to the
 * server-configured default when the ID is missing or unrecognised (a
 * stale localStorage value from a previous build, say).
 */
function resolveModelOption(
  modelId: string | undefined,
  fallbackProvider: "claude" | "gemini",
): ModelOption {
  if (modelId) {
    const match = getModelById(modelId);
    if (match) return match;
  }
  return getDefaultModelFor(fallbackProvider);
}

/**
 * Instantiates the Vercel AI SDK model for the selected provider,
 * preferring a caller-supplied BYOK key, then the server env key.
 * Throws if neither is available so the client can show a helpful
 * "missing key" message instead of the chat silently looping.
 */
function buildModel(
  option: ModelOption,
  byokKey: string | undefined,
  config: ServerEnv,
): LanguageModel {
  const sdk = PROVIDER_SDK[option.provider];
  const envKey = sdk.envKey;
  const apiKey = byokKey || (config[envKey] as string | undefined);
  if (!apiKey) {
    throw new Error(
      `${option.label} requires ${envKey}. Set it in .env.local or paste a key via the model picker.`,
    );
  }
  return sdk.create({ apiKey })(option.id);
}
