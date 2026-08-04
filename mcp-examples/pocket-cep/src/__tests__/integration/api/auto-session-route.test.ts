import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockGetEnv } = vi.hoisted(() => ({
  mockGetEnv: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  getEnv: mockGetEnv,
}));

import { GET } from "@/app/api/auth/auto-session/route";

describe("GET /api/auth/auto-session", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEnv.mockReturnValue({
      AUTH_MODE: "service_account",
      BETTER_AUTH_SECRET: "mock-secret",
      BETTER_AUTH_URL: "http://localhost:3000",
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns 404 when AUTH_MODE is not service_account", async () => {
    mockGetEnv.mockReturnValue({
      AUTH_MODE: "user_oauth",
    });

    const req = new Request("http://localhost:3000/api/auth/auto-session");
    const res = await GET(req);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });

  it("redirects to /dashboard and sets cookies on successful anonymous sign-in", async () => {
    const mockFetchResponse = {
      ok: true,
      headers: {
        getSetCookie: () => ["session_token=valid-token; Path=/"],
      },
    };
    global.fetch = vi.fn().mockResolvedValue(mockFetchResponse);

    const req = new Request("http://localhost:3000/api/auth/auto-session");
    const res = await GET(req);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost:3000/dashboard");
    expect(res.headers.getSetCookie()).toEqual(["session_token=valid-token; Path=/"]);
  });

  it("returns 503 HTML page when fetch to anonymous sign-in fails", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network connection lost"));

    const req = new Request("http://localhost:3000/api/auth/auto-session");
    const res = await GET(req);

    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const body = await res.text();
    expect(body).toContain("Service Account Session Failed");
    expect(body).toContain("Fetch failed: Network connection lost");
  });

  it("returns error HTML page when anonymous sign-in returns non-200", async () => {
    const mockFetchResponse = {
      ok: false,
      status: 500,
      text: async () => "Internal Database Error",
      headers: {
        getSetCookie: () => [],
      },
    };
    global.fetch = vi.fn().mockResolvedValue(mockFetchResponse);

    const req = new Request("http://localhost:3000/api/auth/auto-session");
    const res = await GET(req);

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const body = await res.text();
    expect(body).toContain("Service Account Session Failed");
    expect(body).toContain("API returned 500: Internal Database Error");
  });
});
