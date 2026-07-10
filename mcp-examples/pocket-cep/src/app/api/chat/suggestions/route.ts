/**
 * @file API route for generating suggested follow-up prompts after a chat turn.
 *
 * POST /api/chat/suggestions
 * Body: { messages: UIMessage[], selectedUser?: string, modelId?: string }
 * Headers: x-pocket-cep-byok: "<provider>:<api-key>" (optional BYOK)
 * Response: { questions: string[] }
 *
 * Re-uses the same model instance and historical dialogue prefix as the main
 * chat turn so Google's backend can serve prefix tokens from cache.
 */

import { NextResponse } from "next/server";
import { generateObject, convertToModelMessages } from "ai";
import type { LanguageModel, UIMessage } from "ai";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { requireSession } from "@/lib/session";
import { BYOK_HEADER, parseByokHeader } from "@/lib/model-preferences";
import { respondWithApiError, unauthenticatedResponse } from "@/lib/api-response";
import { buildModel, resolveModelOption } from "@/lib/build-model";
import { LOG_TAGS } from "@/lib/constants";
import { getGoogleAccessToken } from "@/lib/access-token";
import { getMcpToolsSummary } from "@/lib/mcp-tools";

/**
 * Zod validation schema ensuring exactly 3 concise follow-up prompts.
 */
const suggestionsSchema = z.object({
  questions: z
    .array(z.string().max(60))
    .length(3)
    .describe("Exactly 3 short follow-up prompts or actionable requests under 8 words each"),
});

/**
 * Filters out tool invocations and results so model object generation does not
 * reject historical function calls that lack schema definitions.
 */
function sanitizeMessagesForSuggestions(messages: UIMessage[]): UIMessage[] {
  return messages
    .map((msg) => {
      if (!msg.parts || !Array.isArray(msg.parts)) {
        return msg;
      }
      const textParts = msg.parts.filter((p) => p.type === "text");
      const textContent = textParts
        .map((p) => (p as { text?: string }).text ?? "")
        .join("\n")
        .trim();
      if (!textContent) {
        return null;
      }
      return {
        ...msg,
        content: textContent || msg.content || "",
        parts: textParts.length > 0 ? textParts : undefined,
      };
    })
    .filter((msg): msg is UIMessage => msg !== null);
}

/**
 * Generates 3 concise follow-up questions based on conversation history.
 */
export async function POST(request: Request) {
  if (!(await requireSession())) {
    return unauthenticatedResponse();
  }

  let body: { messages?: UIMessage[]; selectedUser?: string; modelId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ questions: [] });
  }

  const { messages, selectedUser = "", modelId } = body;
  if (!messages || messages.length === 0) {
    return NextResponse.json({ questions: [] });
  }

  const config = getEnv();
  const modelOption = resolveModelOption(modelId, config.LLM_PROVIDER);
  const byok = parseByokHeader(request.headers.get(BYOK_HEADER), modelOption.provider);

  let model: LanguageModel;
  try {
    model = buildModel(modelOption, byok, config);
  } catch (error) {
    return respondWithApiError(error, { fallbackStatus: 400 });
  }

  try {
    const cleanMessages = sanitizeMessagesForSuggestions(messages);
    if (cleanMessages.length === 0) {
      return NextResponse.json({ questions: [] });
    }
    const accessToken = await getGoogleAccessToken();
    let toolsSummary = "";
    try {
      toolsSummary = await getMcpToolsSummary(config.MCP_SERVER_URL, accessToken);
    } catch {
      /* silent fallback if tools cannot be fetched */
    }

    const modelMessages = await convertToModelMessages(cleanMessages);
    const result = await generateObject({
      model,
      schema: suggestionsSchema,
      system:
        `You are assisting a Chrome Enterprise Premium administrator${selectedUser ? ` investigating user "${selectedUser}"` : ""}.\n` +
        (toolsSummary ? `The main assistant has access to these exact live tools:\n${toolsSummary}\n\n` : "") +
        "Based on the preceding dialogue, formulate exactly 3 brief, actionable follow-up requests or questions (under 8 words each) that the administrator might submit next. Try to make suggestions natural extensions of the main text that maintain conversational flow and require little thought to understand (i.e. do not propose something subtly different than what the assistant just offered or discussed).\n\n" +
        "Alignment Guidance:\n" +
        "If the assistant's latest response offered specific next steps or options, mirror the exact vocabulary and terminology used by the assistant so the correspondence is instantly clear. If the assistant explicitly enumerated a numbered list (e.g. '1. ... 2. ... 3. ...'), prefix your suggested prompts with matching numbers. If the assistant did not use numbered points in its text, do not prefix your suggestions with numbers.",
      messages: modelMessages,
    });

    const cleanQuestions = result.object.questions.map((q) => q.trim());

    return NextResponse.json({ questions: cleanQuestions });
  } catch (error) {
    console.error(LOG_TAGS.CHAT, "Failed to generate follow-up suggestions:", error);
    return NextResponse.json({ questions: [] });
  }
}
