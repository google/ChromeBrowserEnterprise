/**
 * @file Integration tests for GET /api/auth/sa-verify.
 *
 * Verifies Service Account token minting and Domain-Wide Delegation OAuth scope
 * authorization without executing heavy API methods during setup verification.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetEnv, mockGetServiceAccountConfig, mockGetGoogleAccessToken } = vi.hoisted(() => ({
  mockGetEnv: vi.fn(),
  mockGetServiceAccountConfig: vi.fn(),
  mockGetGoogleAccessToken: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  getEnv: mockGetEnv,
}));

vi.mock("@/lib/sa-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sa-session")>();
  return {
    ...actual,
    getServiceAccountConfig: mockGetServiceAccountConfig,
  };
});

vi.mock("@/lib/access-token", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/access-token")>();
  return {
    ...actual,
    getGoogleAccessToken: mockGetGoogleAccessToken,
  };
});

import { GET } from "@/app/api/auth/sa-verify/route";
import { DwdScopeVerificationError } from "@/lib/access-token";

describe("GET /api/auth/sa-verify", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetEnv.mockReturnValue({
      AUTH_MODE: "service_account",
    });
  });

  it("returns 400 when not in service_account mode", async () => {
    mockGetEnv.mockReturnValue({
      AUTH_MODE: "bearer_token",
    });

    const res = await GET();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Not in service_account mode",
    });
  });

  it("returns 400 when no customerId is configured yet in session", async () => {
    mockGetServiceAccountConfig.mockResolvedValue({
      customerId: "",
      impersonatedUser: "",
    });

    const res = await GET();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      verified: false,
      error: "No Customer ID configured yet.",
    });
  });

  it("returns 400 with dwdDiagnostics when Domain-Wide Delegation scope verification throws DwdScopeVerificationError", async () => {
    mockGetServiceAccountConfig.mockResolvedValue({
      customerId: "C01234567",
      impersonatedUser: "admin@company.com",
    });
    const dwdError = new DwdScopeVerificationError(
      "admin@company.com",
      "107071162630077127986",
      ["https://www.googleapis.com/auth/chrome.management.policy"],
      ["https://www.googleapis.com/auth/admin.directory.customer.readonly"],
    );
    mockGetGoogleAccessToken.mockRejectedValue(dwdError);

    const res = await GET();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      verified: false,
      error: dwdError.message,
      dwdDiagnostics: {
        subject: "admin@company.com",
        clientId: "107071162630077127986",
        authorizedScopes: ["https://www.googleapis.com/auth/chrome.management.policy"],
        missingScopes: ["https://www.googleapis.com/auth/admin.directory.customer.readonly"],
      },
    });
  });

  it("returns 400 with getErrorMessage text when token minting fails for non-DWD auth reasons", async () => {
    mockGetServiceAccountConfig.mockResolvedValue({
      customerId: "C01234567",
      impersonatedUser: "",
    });
    mockGetGoogleAccessToken.mockRejectedValue(new Error("PEM private key parsing failed"));

    const res = await GET();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      verified: false,
      error: "PEM private key parsing failed",
    });
  });

  it("returns { verified: true, customerId, impersonatedUser } when token and scopes verify cleanly in Direct Mode", async () => {
    mockGetServiceAccountConfig.mockResolvedValue({
      customerId: "C01234567",
      impersonatedUser: "",
    });
    mockGetGoogleAccessToken.mockResolvedValue("mock_bearer_token_direct_sa");
    const res = await GET();

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ verified: true, customerId: "C01234567", impersonatedUser: "" });
    expect(mockGetGoogleAccessToken).toHaveBeenCalled();
  });

  it("returns { verified: true, customerId, impersonatedUser } when token and scopes verify cleanly in DWD Mode", async () => {
    mockGetServiceAccountConfig.mockResolvedValue({
      customerId: "C01234567",
      impersonatedUser: "admin@company.com",
    });
    mockGetGoogleAccessToken.mockResolvedValue("mock_bearer_token_impersonated");
    const res = await GET();

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({
      verified: true,
      customerId: "C01234567",
      impersonatedUser: "admin@company.com",
    });
    expect(mockGetGoogleAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "admin@company.com" }),
    );
  });
});
