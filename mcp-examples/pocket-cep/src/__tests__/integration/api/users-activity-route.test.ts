/**
 * @file Integration test for GET /api/users/activity.
 *
 * Verifies the activity route (a) returns the grouped activity map on
 * success and (b) returns 401 with an AuthErrorPayload on auth failure
 * — whether the AuthError comes from getADCToken() or from a mid-request
 * 401 body classified by toAuthError.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockGetSession,
  mockGetADCToken,
  mockGetQuotaProject,
  mockGetGoogleAccessToken,
  mockGetEnv,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetADCToken: vi.fn(),
  mockGetQuotaProject: vi.fn(),
  mockGetGoogleAccessToken: vi.fn(),
  mockGetEnv: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: mockGetSession } }),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/lib/access-token", () => ({
  getGoogleAccessToken: mockGetGoogleAccessToken,
}));

vi.mock("@/lib/env", () => ({
  getEnv: mockGetEnv,
}));

// Keep the real `buildGoogleApiHeaders` so the route's header construction
// runs end-to-end; only mock the credential accessors.
vi.mock("@/lib/adc", async () => {
  const actual = await vi.importActual<typeof import("@/lib/adc")>("@/lib/adc");
  return {
    ...actual,
    getADCToken: mockGetADCToken,
    getQuotaProject: mockGetQuotaProject,
  };
});

import { GET } from "@/app/api/users/activity/route";
import { AuthError } from "@/lib/auth-errors";
import { clearCache } from "@/lib/server-cache";
import { NextRequest } from "next/server";

/**
 * Builds a NextRequest for the activity route. We need the real
 * `NextRequest` (not a plain `Request`) because the route reads
 * `request.nextUrl.searchParams.get("days")`.
 */
function makeRequest(headers: Record<string, string> = {}, days?: number): NextRequest {
  const url = new URL("http://localhost/api/users/activity");
  if (days !== undefined) url.searchParams.set("days", String(days));
  return new NextRequest(url, { headers });
}

describe("GET /api/users/activity", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    clearCache();
    mockGetSession.mockResolvedValue({ user: { id: "u1" } });
    mockGetEnv.mockReturnValue({ MCP_SERVER_URL: "http://localhost:4000/mcp" });
    mockGetQuotaProject.mockResolvedValue(null);
    mockGetGoogleAccessToken.mockResolvedValue(`token-${Math.random()}`);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns grouped activity on success", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{ actor: { email: "a@x.test" }, id: { time: "2026-04-16T00:00:00Z" } }],
      }),
    } as Response);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activity["a@x.test"].eventCount).toBe(1);
  });

  it("returns 401 with AuthErrorPayload when getADCToken throws AuthError", async () => {
    // Force the ADC fallback path by returning no user token.
    mockGetGoogleAccessToken.mockResolvedValue(undefined);
    mockGetADCToken.mockRejectedValue(
      new AuthError({
        code: "invalid_rapt",
        source: "adc",
        message: "Google requires you to re-authenticate.",
        remedy: "Run `gcloud auth login` and retry.",
        command: "gcloud auth login",
      }),
    );

    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_rapt");
    expect(body.error.source).toBe("adc");
  });

  it("returns 401 when the Admin Reports call responds with a 401 invalid_grant body", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () =>
        JSON.stringify({
          error: { code: 401, status: "UNAUTHENTICATED", message: "invalid_grant" },
        }),
    } as Response);

    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBeDefined();
    expect(body.error.source).toBe("admin-sdk");
  });

  it("returns 200 with empty activity when the fetch fails with a non-auth error", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "Service Unavailable",
    } as Response);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activity).toEqual({});
  });
});
