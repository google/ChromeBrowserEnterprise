/**
 * @file Unit tests for buildCallerCacheKey.
 *
 * Verifies that cache keys are correctly generated and partitioned by
 * both caller identity (token hash or "sa") and tenant (customerId)
 * to prevent cross-tenant data leakage.
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { buildCallerCacheKey } from "@/lib/cache-key";

describe("buildCallerCacheKey", () => {
  const serverUrl = "http://localhost:4000/mcp";
  const token = "mock-oauth-token-123";
  const tokenHash = createHash("sha256").update(token).digest("hex").slice(0, 16);

  it("generates correct key for service_account mode without customerId", () => {
    const key = buildCallerCacheKey(serverUrl, undefined);
    expect(key).toBe(`${serverUrl}|sa`);
  });

  it("generates correct key for service_account mode with customerId", () => {
    const key = buildCallerCacheKey(serverUrl, undefined, "C0111111");
    expect(key).toBe(`${serverUrl}|sa|c:C0111111`);
  });

  it("generates correct key for user_oauth mode without customerId", () => {
    const key = buildCallerCacheKey(serverUrl, token);
    expect(key).toBe(`${serverUrl}|u:${tokenHash}`);
  });

  it("generates correct key for user_oauth mode with customerId", () => {
    const key = buildCallerCacheKey(serverUrl, token, "C0222222");
    expect(key).toBe(`${serverUrl}|u:${tokenHash}|c:C0222222`);
  });

  it("varies key when token changes", () => {
    const token2 = "another-token";
    const tokenHash2 = createHash("sha256").update(token2).digest("hex").slice(0, 16);

    const key1 = buildCallerCacheKey(serverUrl, token);
    const key2 = buildCallerCacheKey(serverUrl, token2);

    expect(key1).not.toBe(key2);
    expect(key2).toBe(`${serverUrl}|u:${tokenHash2}`);
  });

  it("varies key when customerId changes", () => {
    const key1 = buildCallerCacheKey(serverUrl, undefined, "C0111111");
    const key2 = buildCallerCacheKey(serverUrl, undefined, "C0222222");

    expect(key1).not.toBe(key2);
  });
});
