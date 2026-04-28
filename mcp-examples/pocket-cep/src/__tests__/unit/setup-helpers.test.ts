/**
 * @file Tests for the pure helpers that drive the setup CLI's
 * inferred defaults.
 */

import { describe, it, expect } from "vitest";
import { inferLlmProvider } from "../../../scripts/setup-helpers";

describe("inferLlmProvider", () => {
  it("respects an explicit LLM_PROVIDER=gemini", () => {
    expect(
      inferLlmProvider({
        LLM_PROVIDER: "gemini",
        ANTHROPIC_API_KEY: "sk-ant-set",
      }),
    ).toEqual({ value: "gemini" });
  });

  it("respects an explicit LLM_PROVIDER=claude", () => {
    expect(
      inferLlmProvider({
        LLM_PROVIDER: "claude",
        GOOGLE_AI_API_KEY: "set",
      }),
    ).toEqual({ value: "claude" });
  });

  it("infers gemini when only GOOGLE_AI_API_KEY is set", () => {
    const result = inferLlmProvider({ GOOGLE_AI_API_KEY: "set" });
    expect(result.value).toBe("gemini");
    expect(result.reason).toContain("GOOGLE_AI_API_KEY");
  });

  it("infers claude when only ANTHROPIC_API_KEY is set", () => {
    const result = inferLlmProvider({ ANTHROPIC_API_KEY: "sk-ant-x" });
    expect(result.value).toBe("claude");
    expect(result.reason).toContain("ANTHROPIC_API_KEY");
  });

  it("falls back to claude when both keys are present (no signal)", () => {
    const result = inferLlmProvider({
      ANTHROPIC_API_KEY: "sk-ant-x",
      GOOGLE_AI_API_KEY: "y",
    });
    expect(result).toEqual({ value: "claude" });
  });

  it("falls back to claude when no keys are set", () => {
    expect(inferLlmProvider({})).toEqual({ value: "claude" });
  });

  it("treats whitespace-only key values as unset", () => {
    const result = inferLlmProvider({
      ANTHROPIC_API_KEY: "   ",
      GOOGLE_AI_API_KEY: "real-value",
    });
    expect(result.value).toBe("gemini");
    expect(result.reason).toContain("GOOGLE_AI_API_KEY");
  });

  it("ignores unknown LLM_PROVIDER values and falls through to key inference", () => {
    const result = inferLlmProvider({
      LLM_PROVIDER: "magic",
      GOOGLE_AI_API_KEY: "set",
    });
    expect(result.value).toBe("gemini");
    expect(result.reason).toContain("GOOGLE_AI_API_KEY");
  });

  it("returns no `reason` when the choice is explicit", () => {
    const result = inferLlmProvider({ LLM_PROVIDER: "gemini" });
    expect(result.reason).toBeUndefined();
  });

  it("returns no `reason` when falling back to the historical default", () => {
    const result = inferLlmProvider({});
    expect(result.reason).toBeUndefined();
  });
});
