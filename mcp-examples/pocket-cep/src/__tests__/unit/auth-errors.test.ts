/**
 * @file Tests for typed auth-error classification.
 *
 * Verifies that every shape of Google auth failure we've observed in the
 * wild — OAuth JSON bodies, gaxios errors, plain string messages, MCP
 * tool-error strings — collapses to a single AuthError with the right code
 * and remedy. Non-auth errors must return null so callers can rethrow.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { toAuthError, isAuthError, AuthError } from "@/lib/auth-errors";
import { getEnv } from "@/lib/env";

// Mock the env module to control AUTH_MODE in tests
vi.mock("@/lib/env", () => ({
  getEnv: vi.fn(),
}));

describe("toAuthError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("in service_account mode", () => {
    beforeEach(() => {
      vi.mocked(getEnv).mockReturnValue({
        AUTH_MODE: "service_account",
        BETTER_AUTH_SECRET: "secret",
        BETTER_AUTH_URL: "http://localhost:3000",
        MCP_SERVER_URL: "http://localhost:4000/mcp",
        LLM_MODEL: "",
        CEP_IMPERSONATE_SUBJECT: "admin@example.com",
        CEP_CUSTOMER_ID: "C012345",
        GOOGLE_CLIENT_ID: "",
        GOOGLE_CLIENT_SECRET: "",
        LLM_PROVIDER: "gemini",
        ANTHROPIC_API_KEY: "",
        GOOGLE_AI_API_KEY: "",
        OPENAI_API_KEY: "",
      });
    });

    it("classifies a Google OAuth invalid_rapt JSON body", () => {
      const err = {
        error: "invalid_grant",
        error_description: "reauth related error (invalid_rapt)",
        error_uri: "https://support.google.com/a/answer/9368756",
        error_subtype: "invalid_rapt",
      };
      const result = toAuthError(err, "adc");
      expect(result).toBeInstanceOf(AuthError);
      expect(result?.code).toBe("invalid_rapt");
      expect(result?.source).toBe("adc");
      expect(result?.command).toBeUndefined(); // No gcloud command in SA mode
      expect(result?.remedy).toContain("/sa-setup");
    });

    it("classifies a plain invalid_grant JSON body without subtype", () => {
      const err = {
        error: "invalid_grant",
        error_description: "Bad Request",
      };
      const result = toAuthError(err, "adc");
      expect(result?.code).toBe("invalid_grant");
      expect(result?.command).toBeUndefined();
      expect(result?.remedy).toContain("/sa-setup");
    });

    it("classifies a 'no ADC' / 'Could not load default credentials' error", () => {
      const err = new Error(
        "Could not load the default credentials. Browse to https://developers.google.com/accounts/docs/application-default-credentials",
      );
      const result = toAuthError(err, "adc");
      expect(result?.code).toBe("no_adc");
      expect(result?.command).toBeUndefined();
      expect(result?.remedy).toContain("/sa-setup");
    });
  });

  describe("in user_oauth mode", () => {
    beforeEach(() => {
      vi.mocked(getEnv).mockReturnValue({
        AUTH_MODE: "user_oauth",
        BETTER_AUTH_SECRET: "secret",
        BETTER_AUTH_URL: "http://localhost:3000",
        MCP_SERVER_URL: "http://localhost:4000/mcp",
        LLM_MODEL: "",
        CEP_IMPERSONATE_SUBJECT: "",
        CEP_CUSTOMER_ID: "",
        GOOGLE_CLIENT_ID: "123-abc.apps.googleusercontent.com",
        GOOGLE_CLIENT_SECRET: "secret",
        LLM_PROVIDER: "gemini",
        ANTHROPIC_API_KEY: "",
        GOOGLE_AI_API_KEY: "",
        OPENAI_API_KEY: "",
      });
    });

    it("classifies a Google OAuth invalid_rapt JSON body", () => {
      const err = {
        error: "invalid_grant",
        error_description: "reauth related error (invalid_rapt)",
        error_uri: "https://support.google.com/a/answer/9368756",
        error_subtype: "invalid_rapt",
      };
      const result = toAuthError(err, "adc");
      expect(result).toBeInstanceOf(AuthError);
      expect(result?.code).toBe("invalid_rapt");
      expect(result?.source).toBe("adc");
      expect(result?.command).toBeUndefined();
      expect(result?.remedy).toContain("Sign In button");
    });

    it("classifies a plain invalid_grant JSON body without subtype", () => {
      const err = {
        error: "invalid_grant",
        error_description: "Bad Request",
      };
      const result = toAuthError(err, "adc");
      expect(result?.code).toBe("invalid_grant");
      expect(result?.command).toBeUndefined();
      expect(result?.remedy).toContain("sign out and sign in again");
    });

    it("classifies a 'no ADC' / 'Could not load default credentials' error", () => {
      const err = new Error(
        "Could not load the default credentials. Browse to https://developers.google.com/accounts/docs/application-default-credentials",
      );
      const result = toAuthError(err, "adc");
      expect(result?.code).toBe("no_adc");
      expect(result?.command).toBeUndefined();
      expect(result?.remedy).toContain("Please sign in with your Google account");
    });
  });

  // Mode-independent classifications
  describe("mode-independent checks", () => {
    beforeEach(() => {
      vi.mocked(getEnv).mockReturnValue({
        AUTH_MODE: "service_account",
        BETTER_AUTH_SECRET: "secret",
        BETTER_AUTH_URL: "http://localhost:3000",
        MCP_SERVER_URL: "http://localhost:4000/mcp",
        LLM_MODEL: "",
        GOOGLE_CLIENT_ID: "",
        GOOGLE_CLIENT_SECRET: "",
        LLM_PROVIDER: "gemini",
        ANTHROPIC_API_KEY: "",
        GOOGLE_AI_API_KEY: "",
        OPENAI_API_KEY: "",
      });
    });

    it("classifies a gaxios-shaped error with nested response.data", () => {
      const err = {
        message: "invalid_grant",
        response: {
          data: {
            error: "invalid_grant",
            error_subtype: "invalid_rapt",
          },
        },
      };
      const result = toAuthError(err, "admin-sdk");
      expect(result?.code).toBe("invalid_rapt");
      expect(result?.source).toBe("admin-sdk");
    });

    it("classifies an MCP tool-error string mentioning invalid_rapt", () => {
      const raw = "API Error: invalid_grant - reauth related error (invalid_rapt)";
      const result = toAuthError(raw, "mcp-tool");
      expect(result?.code).toBe("invalid_rapt");
      expect(result?.source).toBe("mcp-tool");
    });

    it("classifies an MCP tool-error string with only invalid_grant", () => {
      const raw = "API Error: invalid_grant - token expired";
      const result = toAuthError(raw, "mcp-tool");
      expect(result?.code).toBe("invalid_grant");
    });

    it("classifies a generic UNAUTHENTICATED string as unauthenticated", () => {
      const err = new Error("Request had invalid authentication credentials. UNAUTHENTICATED");
      const result = toAuthError(err, "admin-sdk");
      expect(result?.code).toBe("unauthenticated");
    });

    it("classifies CEP MCP remediation and strict-mode error strings", () => {
      expect(
        toAuthError(
          "Authentication required. The inbound Bearer token has expired or is invalid.",
          "mcp-tool",
        )?.code,
      ).toBe("unauthenticated");
      expect(
        toAuthError(
          "Sign-in is needed before this tool can run. The cached OAuth token is missing.",
          "mcp-tool",
        )?.code,
      ).toBe("unauthenticated");
      expect(
        toAuthError(
          'Authentication failed: Server is configured in strict "bearer-only" mode, but no Authorization token was passed in the request.',
          "mcp-tool",
        )?.code,
      ).toBe("unauthenticated");
    });

    it("returns null for unrelated errors", () => {
      expect(toAuthError(new TypeError("bad"), "adc")).toBeNull();
      expect(toAuthError("network blip", "mcp-tool")).toBeNull();
      expect(toAuthError(null, "adc")).toBeNull();
      expect(toAuthError(undefined, "adc")).toBeNull();
      expect(toAuthError({ foo: "bar" }, "adc")).toBeNull();
    });
  });
});

describe("isAuthError", () => {
  it("narrows AuthError instances", () => {
    const err = new AuthError({
      code: "invalid_grant",
      source: "adc",
      message: "m",
      remedy: "r",
    });
    expect(isAuthError(err)).toBe(true);
    expect(isAuthError(new Error("plain"))).toBe(false);
    expect(isAuthError("string")).toBe(false);
    expect(isAuthError(null)).toBe(false);
  });

  it("recognises cross-realm objects with name 'AuthError'", () => {
    expect(isAuthError({ name: "AuthError", code: "invalid_grant" })).toBe(true);
    expect(isAuthError({ name: "OtherError" })).toBe(false);
  });
});
