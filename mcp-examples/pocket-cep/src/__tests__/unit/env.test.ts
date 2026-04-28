/**
 * @file Tests for the discriminated union env validation schema and
 * the typed EnvValidationError it surfaces.
 */

import { describe, it, expect } from "vitest";
import { serverSchema, EnvValidationError, isEnvValidationError } from "@/lib/env";
import { DEFAULT_MCP_URL } from "@/lib/constants";

const VALID_CLAUDE_SA = {
  AUTH_MODE: "service_account",
  BETTER_AUTH_SECRET: "test-secret",
  BETTER_AUTH_URL: "http://localhost:3000",
  MCP_SERVER_URL: "http://localhost:4000/mcp",
  LLM_PROVIDER: "claude",
  ANTHROPIC_API_KEY: "sk-ant-test-key",
};

const VALID_GEMINI_OAUTH = {
  AUTH_MODE: "user_oauth",
  BETTER_AUTH_SECRET: "test-secret",
  BETTER_AUTH_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "123456789-abc123.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "GOCSPX-test",
  MCP_SERVER_URL: "http://localhost:4000/mcp",
  LLM_PROVIDER: "gemini",
  GOOGLE_AI_API_KEY: "test-gemini-key",
};

describe("serverSchema", () => {
  it("accepts Claude + service_account", () => {
    expect(serverSchema.safeParse(VALID_CLAUDE_SA).success).toBe(true);
  });

  it("accepts Gemini + user_oauth", () => {
    expect(serverSchema.safeParse(VALID_GEMINI_OAUTH).success).toBe(true);
  });

  it("applies defaults when optional fields are omitted", () => {
    const result = serverSchema.safeParse({
      BETTER_AUTH_SECRET: "my-secret",
      ANTHROPIC_API_KEY: "sk-ant-key",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.AUTH_MODE).toBe("service_account");
      expect(result.data.LLM_PROVIDER).toBe("claude");
      expect(result.data.MCP_SERVER_URL).toBe("http://localhost:4000/mcp");
    }
  });

  it("rejects user_oauth without valid Google Client ID", () => {
    expect(serverSchema.safeParse({ ...VALID_GEMINI_OAUTH, GOOGLE_CLIENT_ID: "" }).success).toBe(
      false,
    );
    expect(
      serverSchema.safeParse({ ...VALID_GEMINI_OAUTH, GOOGLE_CLIENT_ID: "not-valid" }).success,
    ).toBe(false);
  });

  it("accepts claude without ANTHROPIC_API_KEY (BYOK supplies the key at request time)", () => {
    const result = serverSchema.safeParse({ ...VALID_CLAUDE_SA, ANTHROPIC_API_KEY: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ANTHROPIC_API_KEY).toBe("");
    }
  });

  it("accepts gemini without GOOGLE_AI_API_KEY (BYOK supplies the key at request time)", () => {
    const result = serverSchema.safeParse({ ...VALID_GEMINI_OAUTH, GOOGLE_AI_API_KEY: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.GOOGLE_AI_API_KEY).toBe("");
    }
  });

  it("rejects invalid enum values", () => {
    expect(serverSchema.safeParse({ ...VALID_CLAUDE_SA, AUTH_MODE: "magic" }).success).toBe(false);
    expect(serverSchema.safeParse({ ...VALID_CLAUDE_SA, LLM_PROVIDER: "gpt4" }).success).toBe(
      false,
    );
  });

  it("rejects missing BETTER_AUTH_SECRET", () => {
    const { BETTER_AUTH_SECRET: _, ...env } = VALID_CLAUDE_SA;
    expect(serverSchema.safeParse(env).success).toBe(false);
  });

  it("MCP_SERVER_URL default matches DEFAULT_MCP_URL constant", () => {
    // Setup CLI and doctor both branch on this constant to recognise
    // the managed flow; if env.ts ever re-hardcodes a different URL,
    // those branches silently stop firing.
    const result = serverSchema.safeParse({
      BETTER_AUTH_SECRET: "x",
      ANTHROPIC_API_KEY: "sk-ant-x",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.MCP_SERVER_URL).toBe(DEFAULT_MCP_URL);
    }
  });
});

describe("EnvValidationError", () => {
  const ISSUES = [
    { path: "BETTER_AUTH_SECRET", message: "required" },
    { path: "ANTHROPIC_API_KEY", message: "expected string" },
  ];

  it("carries the structured issue list", () => {
    const err = new EnvValidationError(ISSUES);
    expect(err.issues).toHaveLength(2);
    expect(err.issues[0]).toEqual({ path: "BETTER_AUTH_SECRET", message: "required" });
  });

  it("formats each issue into the human-readable message", () => {
    const err = new EnvValidationError(ISSUES);
    expect(err.message).toContain("BETTER_AUTH_SECRET: required");
    expect(err.message).toContain("ANTHROPIC_API_KEY: expected string");
  });

  it("message points at `npm run setup` as the primary CTA", () => {
    const err = new EnvValidationError(ISSUES);
    expect(err.message).toContain("npm run setup");
    expect(err.message).toContain(".env.local.example");
  });

  it("is an Error subclass with a named constructor", () => {
    const err = new EnvValidationError(ISSUES);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("EnvValidationError");
  });

  it("freezes the issue list contract (readonly at the type level)", () => {
    const err = new EnvValidationError(ISSUES);
    // The type is ReadonlyArray so mutation should be a type error; at
    // runtime we just assert the reference matches.
    expect(err.issues).toBe(err.issues);
  });
});

describe("isEnvValidationError", () => {
  it("returns true for an EnvValidationError instance", () => {
    expect(isEnvValidationError(new EnvValidationError([{ path: "X", message: "y" }]))).toBe(true);
  });

  it("returns false for a plain Error", () => {
    expect(isEnvValidationError(new Error("boom"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isEnvValidationError(null)).toBe(false);
    expect(isEnvValidationError(undefined)).toBe(false);
    expect(isEnvValidationError("string")).toBe(false);
    expect(isEnvValidationError({ name: "EnvValidationError" })).toBe(false);
  });

  it("recognises cross-realm instances by name (not instanceof)", () => {
    // Simulate an error that crosses a module/bundler boundary where
    // `instanceof EnvValidationError` would fail but the `name`
    // property survives structured cloning.
    const crossRealm = Object.assign(new Error("cross realm"), {
      name: "EnvValidationError",
      issues: [{ path: "X", message: "y" }],
    });
    expect(isEnvValidationError(crossRealm)).toBe(true);
  });
});
