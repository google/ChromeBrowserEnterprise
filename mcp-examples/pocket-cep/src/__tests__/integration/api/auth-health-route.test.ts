/**
 * @file Integration test for GET /api/auth/health.
 *
 * Probes Google credentials on demand. Used by the auth-banner "Check
 * again" button to clear the banner after the user signs in again.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetSession, mockGetGoogleAccessToken, mockGetEnv } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetGoogleAccessToken: vi.fn(),
  mockGetEnv: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  getEnv: mockGetEnv,
}));

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: mockGetSession } }),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    getAll: () => [],
    delete: vi.fn(),
  }),
}));

vi.mock("@/lib/access-token", () => ({
  getGoogleAccessToken: mockGetGoogleAccessToken,
}));

import { GET } from "@/app/api/auth/health/route";
import { AuthError } from "@/lib/auth-errors";

describe("GET /api/auth/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ user: { id: "u1" } });
    mockGetEnv.mockReturnValue({
      AUTH_MODE: "service_account",
      BETTER_AUTH_SECRET: "mock-secret",
    });
  });

  it("returns 200 { ok: true } when token acquisition succeeds", async () => {
    mockGetGoogleAccessToken.mockResolvedValue("mock-oauth-token");

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 401 with AuthErrorPayload when token acquisition fails", async () => {
    mockGetGoogleAccessToken.mockResolvedValue(undefined);

    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("no_credentials");
    expect(body.error.source).toBe("admin-sdk");
  });

  it("returns 401 when no session exists", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await GET();
    expect(res.status).toBe(401);
  });

  describe("user_oauth mode", () => {
    beforeEach(() => {
      mockGetEnv.mockReturnValue({
        AUTH_MODE: "user_oauth",
        BETTER_AUTH_SECRET: "mock-secret",
        GOOGLE_CLIENT_ID: "123-abc.apps.googleusercontent.com",
        GOOGLE_CLIENT_SECRET: "secret",
      });
    });

    it("returns 200 when both session and Google token are valid", async () => {
      mockGetGoogleAccessToken.mockResolvedValue("mock-oauth-token");
      const res = await GET();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });

    it("returns 401 unauthenticated when Google token is expired/missing", async () => {
      mockGetGoogleAccessToken.mockResolvedValue(undefined);
      const res = await GET();
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("unauthenticated");
    });
  });
});
