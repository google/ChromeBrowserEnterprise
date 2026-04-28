/**
 * @file Pure helpers shared between the setup CLI and its tests.
 *
 * Kept here (not in `setup.ts`) because `setup.ts` invokes its own
 * `main()` at import time — pulling those side effects into a unit
 * test would be hostile. Anything testable lives in this file.
 */

/**
 * The flat KEY=value shape used to round-trip `.env.local` through
 * the setup CLI. Defined here so both `setup.ts` and the helpers
 * agree on the contract.
 */
export type EnvMap = Record<string, string>;

/**
 * The setup CLI's inferred default for Step 2 (LLM provider). The
 * optional `reason` is shown to the user as a transparency note when
 * the choice was inferred from API keys rather than an explicit
 * `LLM_PROVIDER` value, so they aren't surprised by the pre-selected
 * answer.
 */
export type LlmProviderInference = {
  value: "claude" | "gemini";
  reason?: string;
};

/**
 * Picks a default LLM provider from an existing `.env.local` map.
 * Priority:
 *   1. Explicit `LLM_PROVIDER=claude|gemini` wins.
 *   2. Otherwise, if exactly one of the API keys is set, default to
 *      that provider — most users who paste a single key intend to
 *      use the matching provider.
 *   3. Otherwise, fall back to claude (the historical default).
 */
export function inferLlmProvider(env: EnvMap): LlmProviderInference {
  if (env.LLM_PROVIDER === "gemini") return { value: "gemini" };
  if (env.LLM_PROVIDER === "claude") return { value: "claude" };

  const hasClaude = Boolean(env.ANTHROPIC_API_KEY?.trim());
  const hasGemini = Boolean(env.GOOGLE_AI_API_KEY?.trim());

  if (hasGemini && !hasClaude) {
    return {
      value: "gemini",
      reason: "Found GOOGLE_AI_API_KEY in .env.local — defaulting to Gemini.",
    };
  }
  if (hasClaude && !hasGemini) {
    return {
      value: "claude",
      reason: "Found ANTHROPIC_API_KEY in .env.local — defaulting to Claude.",
    };
  }
  return { value: "claude" };
}
