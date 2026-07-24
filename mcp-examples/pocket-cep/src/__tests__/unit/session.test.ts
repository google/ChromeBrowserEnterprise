import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetSession, mockCookies } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockCookies: {
    getAll: vi.fn(() => [] as { name: string; value: string }[]),
    delete: vi.fn(),
  },
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
  getEnv: () => ({
    AUTH_MODE: "service_account",
    BETTER_AUTH_SECRET: "mock-secret",
  }),
}));

import { requireSession } from "@/lib/session";

describe("requireSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns session when getSession succeeds", async () => {
    const mockSession = { user: { id: "u1" } };
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
});
