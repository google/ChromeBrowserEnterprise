/**
 * @file Integration tests for the route-protection proxy middleware.
 *
 * Focuses on the env-failure path (serves the setup-required HTML
 * page instead of the raw dev overlay) and the happy-path redirect
 * branches that already existed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetEnv, mockGetSessionCookie } = vi.hoisted(() => ({
  mockGetEnv: vi.fn(),
  mockGetSessionCookie: vi.fn(),
}));

vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return {
    ...actual,
    getEnv: mockGetEnv,
  };
});

vi.mock("better-auth/cookies", () => ({
  getSessionCookie: mockGetSessionCookie,
}));

import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { EnvValidationError } from "@/lib/env";

function makeRequest(url = "http://localhost:3000/"): NextRequest {
  return new NextRequest(new URL(url));
}

describe("proxy — env validation failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 500 with text/html when EnvValidationError is thrown", async () => {
    mockGetEnv.mockImplementation(() => {
      throw new EnvValidationError([{ path: "BETTER_AUTH_SECRET", message: "required" }]);
    });

    const res = await proxy(makeRequest());

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
  });

  it("HTML body lists every failing var and calls out `npm run setup`", async () => {
    mockGetEnv.mockImplementation(() => {
      throw new EnvValidationError([
        { path: "BETTER_AUTH_SECRET", message: "required" },
        { path: "ANTHROPIC_API_KEY", message: "expected string" },
      ]);
    });

    const res = await proxy(makeRequest());
    const body = await res.text();

    expect(body).toContain("BETTER_AUTH_SECRET");
    expect(body).toContain("ANTHROPIC_API_KEY");
    expect(body).toContain("npm run setup");
    expect(body).toContain(".env.local.example");
  });

  it("recognises the error across module boundaries via the name guard", async () => {
    // Simulate an EnvValidationError-shaped object where instanceof
    // would fail (e.g. crossing a turbopack bundle boundary).
    const crossRealm = Object.assign(new Error("env failure"), {
      name: "EnvValidationError",
      issues: [{ path: "X", message: "y" }],
    });
    mockGetEnv.mockImplementation(() => {
      throw crossRealm;
    });

    const res = await proxy(makeRequest());
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
  });

  it("rethrows non-env errors untouched (preserves the dev overlay for real bugs)", async () => {
    const bug = new TypeError("something else broke");
    mockGetEnv.mockImplementation(() => {
      throw bug;
    });

    await expect(proxy(makeRequest())).rejects.toBe(bug);
  });
});

describe("proxy — normal auth routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("service_account + no session → redirects to /api/auth/auto-session", async () => {
    mockGetEnv.mockReturnValue({ AUTH_MODE: "service_account" });
    mockGetSessionCookie.mockReturnValue(null);

    const res = await proxy(makeRequest("http://localhost:3000/"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/api/auth/auto-session");
  });

  it("service_account + session + root → redirects to /dashboard", async () => {
    mockGetEnv.mockReturnValue({ AUTH_MODE: "service_account" });
    mockGetSessionCookie.mockReturnValue("signed-cookie");

    const res = await proxy(makeRequest("http://localhost:3000/"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
  });

  it("user_oauth + session + root → redirects to /dashboard", async () => {
    mockGetEnv.mockReturnValue({ AUTH_MODE: "user_oauth" });
    mockGetSessionCookie.mockReturnValue("signed-cookie");

    const res = await proxy(makeRequest("http://localhost:3000/"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
  });

  it("user_oauth + no session + /dashboard → redirects to /", async () => {
    mockGetEnv.mockReturnValue({ AUTH_MODE: "user_oauth" });
    mockGetSessionCookie.mockReturnValue(null);

    const res = await proxy(makeRequest("http://localhost:3000/dashboard"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(/\/$/);
  });

  it("user_oauth + no session + / → allows (no redirect)", async () => {
    mockGetEnv.mockReturnValue({ AUTH_MODE: "user_oauth" });
    mockGetSessionCookie.mockReturnValue(null);

    const res = await proxy(makeRequest("http://localhost:3000/"));
    // NextResponse.next() sets an internal header; status stays 200.
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("proxy — MCP reachability gate", () => {
  // Each test gets a fresh proxy module so the in-memory MCP health
  // cache (module-level mutable state) doesn't pollute across cases.
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns 503 + HTML when MCP is unreachable for /dashboard", async () => {
    vi.doMock("@/lib/env", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/env")>();
      return { ...actual, getEnv: mockGetEnv };
    });
    vi.doMock("better-auth/cookies", () => ({ getSessionCookie: mockGetSessionCookie }));
    vi.doMock("@/lib/doctor-checks", () => ({
      probeMcpServer: vi.fn().mockResolvedValue({ ok: false, message: "fetch failed" }),
    }));
    mockGetEnv.mockReturnValue({
      AUTH_MODE: "service_account",
      MCP_SERVER_URL: "http://localhost:4000/mcp",
    });
    mockGetSessionCookie.mockReturnValue("signed-cookie");

    const { proxy: proxyImpl } = await import("@/proxy");
    const { NextRequest: Req } = await import("next/server");
    const res = await proxyImpl(new Req(new URL("http://localhost:3000/dashboard")));

    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const body = await res.text();
    expect(body).toContain("MCP server unreachable");
    expect(body).toContain("http://localhost:4000/mcp");
    expect(body).toContain("npm run dev:full");
  });

  it("falls through to next() when MCP is reachable for /dashboard", async () => {
    vi.doMock("@/lib/env", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/env")>();
      return { ...actual, getEnv: mockGetEnv };
    });
    vi.doMock("better-auth/cookies", () => ({ getSessionCookie: mockGetSessionCookie }));
    vi.doMock("@/lib/doctor-checks", () => ({
      probeMcpServer: vi.fn().mockResolvedValue({ ok: true, message: "ok" }),
    }));
    mockGetEnv.mockReturnValue({
      AUTH_MODE: "service_account",
      MCP_SERVER_URL: "http://localhost:4000/mcp",
    });
    mockGetSessionCookie.mockReturnValue("signed-cookie");

    const { proxy: proxyImpl } = await import("@/proxy");
    const { NextRequest: Req } = await import("next/server");
    const res = await proxyImpl(new Req(new URL("http://localhost:3000/dashboard")));

    // NextResponse.next() lets the request continue: no 503 short-circuit,
    // no redirect, no HTML body content-type set on the response.
    expect(res.status).not.toBe(503);
    expect(res.headers.get("location")).toBeNull();
  });

  it("does not probe MCP for non-dashboard paths (landing page is unaffected)", async () => {
    const probe = vi.fn().mockResolvedValue({ ok: false, message: "fetch failed" });
    vi.doMock("@/lib/env", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/env")>();
      return { ...actual, getEnv: mockGetEnv };
    });
    vi.doMock("better-auth/cookies", () => ({ getSessionCookie: mockGetSessionCookie }));
    vi.doMock("@/lib/doctor-checks", () => ({ probeMcpServer: probe }));
    mockGetEnv.mockReturnValue({
      AUTH_MODE: "user_oauth",
      MCP_SERVER_URL: "http://localhost:4000/mcp",
    });
    mockGetSessionCookie.mockReturnValue(null);

    const { proxy: proxyImpl } = await import("@/proxy");
    const { NextRequest: Req } = await import("next/server");
    await proxyImpl(new Req(new URL("http://localhost:3000/")));

    expect(probe).not.toHaveBeenCalled();
  });

  it("caches the ok probe result (subsequent /dashboard requests skip the call)", async () => {
    const probe = vi.fn().mockResolvedValue({ ok: true, message: "ok" });
    vi.doMock("@/lib/env", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/env")>();
      return { ...actual, getEnv: mockGetEnv };
    });
    vi.doMock("better-auth/cookies", () => ({ getSessionCookie: mockGetSessionCookie }));
    vi.doMock("@/lib/doctor-checks", () => ({ probeMcpServer: probe }));
    mockGetEnv.mockReturnValue({
      AUTH_MODE: "service_account",
      MCP_SERVER_URL: "http://localhost:4000/mcp",
    });
    mockGetSessionCookie.mockReturnValue("signed-cookie");

    const { proxy: proxyImpl } = await import("@/proxy");
    const { NextRequest: Req } = await import("next/server");
    await proxyImpl(new Req(new URL("http://localhost:3000/dashboard")));
    await proxyImpl(new Req(new URL("http://localhost:3000/dashboard/extra")));

    expect(probe).toHaveBeenCalledTimes(1);
  });
});
