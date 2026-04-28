/**
 * @file Unit tests for the Google OAuth access token helper.
 *
 * Verifies the two auth modes: service_account (returns undefined, no API
 * call made) and user_oauth (retrieves token from BetterAuth). Also tests
 * graceful failure when token retrieval goes wrong.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the dependencies before importing the module under test.
const mockGetAccessToken = vi.fn();

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({
    api: {
      getAccessToken: mockGetAccessToken,
    },
  }),
}));

vi.mock("@/lib/env", () => ({
  getEnv: vi.fn(),
}));

// Mock next/headers since it's a server-only import.
vi.mock("next/headers", () => ({
  headers: () => new Headers(),
}));

import { getGoogleAccessToken } from "@/lib/access-token";
import { getEnv } from "@/lib/env";

describe("getGoogleAccessToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns undefined in service_account mode without calling BetterAuth", async () => {
    vi.mocked(getEnv).mockReturnValue({
      AUTH_MODE: "service_account",
    } as ReturnType<typeof getEnv>);

    const token = await getGoogleAccessToken();

    expect(token).toBeUndefined();
    // In service_account mode, we should never call the auth API.
    expect(mockGetAccessToken).not.toHaveBeenCalled();
  });

  it("returns the access token in user_oauth mode", async () => {
    vi.mocked(getEnv).mockReturnValue({
      AUTH_MODE: "user_oauth",
    } as ReturnType<typeof getEnv>);

    mockGetAccessToken.mockResolvedValue({
      accessToken: "google-access-token-123",
    });

    const token = await getGoogleAccessToken();
    expect(token).toBe("google-access-token-123");
  });

  it("returns undefined when BetterAuth throws an error", async () => {
    vi.mocked(getEnv).mockReturnValue({
      AUTH_MODE: "user_oauth",
    } as ReturnType<typeof getEnv>);

    mockGetAccessToken.mockRejectedValue(new Error("Token expired"));

    // Should not throw — returns undefined gracefully.
    const token = await getGoogleAccessToken();
    expect(token).toBeUndefined();
  });

  it("returns undefined when the response lacks an accessToken field", async () => {
    vi.mocked(getEnv).mockReturnValue({
      AUTH_MODE: "user_oauth",
    } as ReturnType<typeof getEnv>);

    // BetterAuth returned something, but not the expected shape.
    mockGetAccessToken.mockResolvedValue({ somethingElse: "unexpected" });

    const token = await getGoogleAccessToken();
    expect(token).toBeUndefined();
  });
});
