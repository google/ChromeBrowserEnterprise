/**
 * @file Server-side helper to resolve and instantiate Vercel AI SDK language models.
 */

import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { ServerEnv } from "./env";
import {
  getDefaultModelFor,
  getModelById,
  type ModelEnvKey,
  type ModelOption,
  type ModelProvider,
} from "./models";

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

/**
 * Looks up a model option by its client-supplied ID. Falls back to the
 * server-configured default when the ID is missing or unrecognised.
 */
export function resolveModelOption(
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
 */
export function buildModel(
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
