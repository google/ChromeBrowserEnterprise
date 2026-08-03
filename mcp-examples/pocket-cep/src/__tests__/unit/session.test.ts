import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetSession, mockCookies, mockGetGoogleAccessToken, mockGetEnv } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockCookies: {
    getAll: vi.fn(() => [] as { name: string; value: string }[]),
    delete: vi.fn(),
  },
  mockGetGoogleAccessToken: vi.fn(),
  mockGetEnv: vi.fn(() => ({
    AUTH_MODE: "service_account" as "service_account" | "user_oauth",
    BETTER_AUTH_SECRET: "mock-secret",
  })),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => mockCookies,
}));

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({
    api: {
      getSession: mockGetSession,
    },
  }),
}));

vi.mock("@/lib/env", () => ({
  getEnv: mockGetEnv,
}));

vi.mock("@/lib/access-token", () => ({
  getGoogleAccessToken: mockGetGoogleAccessToken,
}));

import { requireSession } from "@/lib/session";

describe("requireSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEnv.mockReturnValue({
      AUTH_MODE: "service_account",
      BETTER_AUTH_SECRET: "mock-secret",
    });
  });

  it("returns session when getSession succeeds", async () => {
    const mockSession = { user: { id: "u1", email: "user@example.com" } };
    mockGetSession.mockResolvedValue(mockSession);

    const session = await requireSession();
    expect(session).toBe(mockSession);
    expect(mockCookies.delete).not.toHaveBeenCalled();
  });

  it("clears stale cookies and returns null when getSession returns null", async () => {
    mockGetSession.mockResolvedValue(null);
    mockCookies.getAll.mockReturnValue([
      { name: "better-auth.session_token", value: "stale-val" },
      { name: "other-cookie", value: "val" },
    ]);

    const session = await requireSession();
    expect(session).toBeNull();
    expect(mockCookies.delete).toHaveBeenCalledWith("better-auth.session_token");
    expect(mockCookies.delete).not.toHaveBeenCalledWith("other-cookie");
  });

  it("does not delete anything if no session cookies are present and getSession returns null", async () => {
    mockGetSession.mockResolvedValue(null);
    mockCookies.getAll.mockReturnValue([{ name: "other-cookie", value: "val" }]);

    const session = await requireSession();
    expect(session).toBeNull();
    expect(mockCookies.delete).not.toHaveBeenCalled();
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

    it("returns session when session is valid and Google token is valid", async () => {
      const mockSession = { user: { id: "u1", email: "admin@company.com" } };
      mockGetSession.mockResolvedValue(mockSession);
      mockGetGoogleAccessToken.mockResolvedValue("valid-google-token");

      const session = await requireSession();
      expect(session).toBe(mockSession);
      expect(mockCookies.delete).not.toHaveBeenCalled();
    });

    it("invalidates session and deletes cookies when session is anonymous (service-account.local)", async () => {
      const mockSession = { user: { id: "u1", email: "anon-123@service-account.local" } };
      mockGetSession.mockResolvedValue(mockSession);
      mockCookies.getAll.mockReturnValue([
        { name: "better-auth.session_token", value: "anon-cookie-val" },
      ]);

      const session = await requireSession();
      expect(session).toBeNull();
      expect(mockCookies.delete).toHaveBeenCalledWith("better-auth.session_token");
    });

    it("clears cookies and returns null when session is valid but Google token is expired/missing", async () => {
      const mockSession = { user: { id: "u1", email: "admin@company.com" } };
      mockGetSession.mockResolvedValue(mockSession);
      mockGetGoogleAccessToken.mockResolvedValue(undefined); // expired
      mockCookies.getAll.mockReturnValue([
        { name: "better-auth.session_token", value: "stale-val" },
      ]);

      const session = await requireSession();
      expect(session).toBeNull();
      expect(mockCookies.delete).toHaveBeenCalledWith("better-auth.session_token");
    });
  });
});
