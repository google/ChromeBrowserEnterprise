/**
 * @file Integration test for GET /api/auth/health.
 *
 * Probes ADC credentials on demand. Used by the auth-banner "Check
 * again" button to clear the banner after the user runs gcloud auth login.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetSession, mockGetADCToken } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetADCToken: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: mockGetSession } }),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/lib/adc", () => ({
  getADCToken: mockGetADCToken,
}));

import { GET } from "@/app/api/auth/health/route";
import { AuthError } from "@/lib/auth-errors";

describe("GET /api/auth/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ user: { id: "u1" } });
  });

  it("returns 200 { ok: true } when ADC succeeds", async () => {
    mockGetADCToken.mockResolvedValue("ya29.abc");

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 401 with AuthErrorPayload when ADC throws AuthError", async () => {
    mockGetADCToken.mockRejectedValue(
      new AuthError({
        code: "invalid_rapt",
        source: "adc",
        message: "Google requires you to re-authenticate.",
        remedy: "Run `gcloud auth login` and retry.",
        command: "gcloud auth login",
      }),
    );

    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("invalid_rapt");
  });

  it("returns 401 when no session exists", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await GET();
    expect(res.status).toBe(401);
  });
});
