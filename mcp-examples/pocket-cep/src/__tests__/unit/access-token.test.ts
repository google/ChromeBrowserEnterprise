/**
 * @file Unit tests for the Google OAuth access token and Service Account token helpers.
 *
 * Verifies the two auth modes: service_account (returns undefined, no API
 * call made) and user_oauth (retrieves token from BetterAuth). Also tests
 * Service Account JWT token minting, cache hits, and error diagnostics.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the dependencies before importing the module under test.
const { mockGetAccessToken, mockLoadSaKey, mockAuthorize, mockJwtConstructor } = vi.hoisted(() => ({
  mockGetAccessToken: vi.fn(),
  mockLoadSaKey: vi.fn(),
  mockAuthorize: vi.fn(),
  mockJwtConstructor: vi.fn(),
}));

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

vi.mock("next/headers", () => ({
  headers: () => new Headers(),
}));

vi.mock("@/lib/sa-identity", () => ({
  loadServiceAccountKey: mockLoadSaKey,
}));

vi.mock("google-auth-library", () => ({
  JWT: class {
    constructor(cfg: unknown) {
      mockJwtConstructor(cfg);
    }
    authorize() {
      return mockAuthorize();
    }
    getAccessToken() {
      return mockAuthorize();
    }
  },
}));

import {
  getGoogleAccessToken,
  mintServiceAccountTokenOrThrow,
  clearServiceAccountTokenCache,
  getServiceAccountAccessToken,
} from "@/lib/access-token";
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

    const token = await getGoogleAccessToken();
    expect(token).toBeUndefined();
  });

  it("returns undefined when the response lacks an accessToken field", async () => {
    vi.mocked(getEnv).mockReturnValue({
      AUTH_MODE: "user_oauth",
    } as ReturnType<typeof getEnv>);

    mockGetAccessToken.mockResolvedValue({ somethingElse: "unexpected" });

    const token = await getGoogleAccessToken();
    expect(token).toBeUndefined();
  });
});

describe("mintServiceAccountTokenOrThrow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearServiceAccountTokenCache();
  });

  it("throws when loadServiceAccountKey returns null", async () => {
    mockLoadSaKey.mockResolvedValue(null);
    await expect(mintServiceAccountTokenOrThrow()).rejects.toThrow(
      "Service Account credentials not found or invalid",
    );
  });

  it("throws when client_email is not a string or empty", async () => {
    mockLoadSaKey.mockResolvedValue({
      key: { client_email: "" },
      source: "test",
      errors: ["Key missing email"],
    });
    await expect(mintServiceAccountTokenOrThrow()).rejects.toThrow(
      "Service Account credentials not found or invalid (Key missing email)",
    );
  });

  it("throws when private_key is missing", async () => {
    mockLoadSaKey.mockResolvedValue({
      key: { client_email: "svc@example.com" },
      source: "test.json",
      errors: [],
    });
    await expect(mintServiceAccountTokenOrThrow()).rejects.toThrow(
      "Service Account key loaded from test.json is missing private_key.",
    );
  });

  it("mints token and caches it on subsequent calls with same subject", async () => {
    mockLoadSaKey.mockResolvedValue({
      key: { client_email: "svc@example.com", private_key: "fake-key" },
      source: "test.json",
      errors: [],
    });
    mockAuthorize.mockResolvedValue({ token: "jwt-token-abc" });

    const token1 = await mintServiceAccountTokenOrThrow("admin@example.com");
    expect(token1).toBe("jwt-token-abc");
    expect(mockJwtConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "svc@example.com",
        subject: "admin@example.com",
      }),
    );

    // Second call should return cached token without re-authorizing
    mockAuthorize.mockClear();
    const token2 = await mintServiceAccountTokenOrThrow("admin@example.com");
    expect(token2).toBe("jwt-token-abc");
    expect(mockAuthorize).not.toHaveBeenCalled();
  });

  it("getServiceAccountAccessToken returns undefined gracefully on mint failure", async () => {
    mockLoadSaKey.mockResolvedValue(null);
    const token = await getServiceAccountAccessToken("admin@example.com");
    expect(token).toBeUndefined();
  });
});
