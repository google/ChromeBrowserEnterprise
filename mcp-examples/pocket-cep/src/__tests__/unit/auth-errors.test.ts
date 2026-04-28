/**
 * @file Tests for typed auth-error classification.
 *
 * Verifies that every shape of Google auth failure we've observed in the
 * wild — OAuth JSON bodies, gaxios errors, plain string messages, MCP
 * tool-error strings — collapses to a single AuthError with the right code
 * and remedy. Non-auth errors must return null so callers can rethrow.
 */

import { describe, it, expect } from "vitest";
import { toAuthError, isAuthError, AuthError } from "@/lib/auth-errors";

describe("toAuthError", () => {
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
    expect(result?.command).toBe("gcloud auth login");
    expect(result?.docsUrl).toBe("https://support.google.com/a/answer/9368756");
  });

  it("classifies a plain invalid_grant JSON body without subtype", () => {
    const err = {
      error: "invalid_grant",
      error_description: "Bad Request",
    };
    const result = toAuthError(err, "adc");
    expect(result?.code).toBe("invalid_grant");
    expect(result?.command).toBe("gcloud auth login");
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

  it("classifies a 'no ADC' / 'Could not load default credentials' error", () => {
    const err = new Error(
      "Could not load the default credentials. Browse to https://developers.google.com/accounts/docs/application-default-credentials",
    );
    const result = toAuthError(err, "adc");
    expect(result?.code).toBe("no_adc");
    expect(result?.command).toBe("gcloud auth application-default login");
  });

  it("returns null for unrelated errors", () => {
    expect(toAuthError(new TypeError("bad"), "adc")).toBeNull();
    expect(toAuthError("network blip", "mcp-tool")).toBeNull();
    expect(toAuthError(null, "adc")).toBeNull();
    expect(toAuthError(undefined, "adc")).toBeNull();
    expect(toAuthError({ foo: "bar" }, "adc")).toBeNull();
  });

  it("AuthError serializes to the wire payload via toPayload()", () => {
    const err = toAuthError({ error: "invalid_grant", error_subtype: "invalid_rapt" }, "adc")!;
    const payload = err.toPayload();
    expect(payload).toEqual({
      code: "invalid_rapt",
      source: "adc",
      message: expect.any(String),
      remedy: expect.any(String),
      command: "gcloud auth login",
      docsUrl: undefined,
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
