/**
 * @file Integration tests for GET, POST, and DELETE /api/auth/sa-config.
 *
 * Verifies Service Account configuration retrieval, synchronous Domain-Wide Delegation
 * token validation before cookie storage, and credential clearing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockGetEnv, mockGetServiceAccountConfig, mockMintToken, mockClearTokenCache } = vi.hoisted(
  () => ({
    mockGetEnv: vi.fn(),
    mockGetServiceAccountConfig: vi.fn(),
    mockMintToken: vi.fn(),
    mockClearTokenCache: vi.fn(),
  }),
);

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
    mintServiceAccountTokenOrThrow: mockMintToken,
    clearServiceAccountTokenCache: mockClearTokenCache,
  };
});

import { GET, POST, DELETE } from "@/app/api/auth/sa-config/route";
import { COOKIE_SA_CUSTOMER_ID, COOKIE_SA_IMPERSONATED_USER } from "@/lib/sa-session";
import { DwdScopeVerificationError } from "@/lib/access-token";

describe("/api/auth/sa-config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEnv.mockReturnValue({ AUTH_MODE: "service_account" });
  });

  describe("GET", () => {
    it("returns 400 when not in service_account mode", async () => {
      mockGetEnv.mockReturnValue({ AUTH_MODE: "user_oauth" });
      const res = await GET();
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Not in service_account mode" });
    });

    it("returns { configured: false } when no config exists", async () => {
      mockGetServiceAccountConfig.mockResolvedValue(null);
      const res = await GET();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ configured: false });
    });

    it("returns configured credentials when set", async () => {
      mockGetServiceAccountConfig.mockResolvedValue({
        customerId: "C00woaabb",
        impersonatedUser: "admin@example.com",
      });
      const res = await GET();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        configured: true,
        customerId: "C00woaabb",
        impersonatedUser: "admin@example.com",
      });
    });
  });

  describe("POST", () => {
    it("returns 400 when not in service_account mode", async () => {
      mockGetEnv.mockReturnValue({ AUTH_MODE: "user_oauth" });
      const req = new NextRequest("http://localhost:3000/api/auth/sa-config", {
        method: "POST",
        body: JSON.stringify({ customerId: "C00woaabb" }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 when customerId is missing", async () => {
      const req = new NextRequest("http://localhost:3000/api/auth/sa-config", {
        method: "POST",
        body: JSON.stringify({ customerId: "   " }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 and blocks cookie saving when DWD token minting fails", async () => {
      mockMintToken.mockRejectedValue(new Error("unauthorized_client: client not authorized"));
      const req = new NextRequest("http://localhost:3000/api/auth/sa-config", {
        method: "POST",
        body: JSON.stringify({
          customerId: "C00woaabb",
          impersonatedUser: "admin@example.com",
        }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain(
        "Failed to verify Domain-Wide Delegation token for admin@example.com",
      );
      expect(mockClearTokenCache).toHaveBeenCalled();
    });

    it("returns dwdDiagnostics when DwdScopeVerificationError is thrown during verification", async () => {
      const diagErr = new DwdScopeVerificationError(
        "admin@example.com",
        "1092837465918273645",
        ["https://www.googleapis.com/auth/admin.directory.customer.readonly"],
        ["https://www.googleapis.com/auth/apps.licensing"],
      );
      mockMintToken.mockRejectedValue(diagErr);
      const req = new NextRequest("http://localhost:3000/api/auth/sa-config", {
        method: "POST",
        body: JSON.stringify({
          customerId: "C00woaabb",
          impersonatedUser: "admin@example.com",
        }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.dwdDiagnostics).toEqual({
        subject: "admin@example.com",
        clientId: "1092837465918273645",
        authorizedScopes: ["https://www.googleapis.com/auth/admin.directory.customer.readonly"],
        missingScopes: ["https://www.googleapis.com/auth/apps.licensing"],
      });
      expect(mockClearTokenCache).toHaveBeenCalled();
    });

    it("saves cookies and returns success when DWD validation passes", async () => {
      mockMintToken.mockResolvedValue("mock-dwd-jwt-access-token-123");
      const req = new NextRequest("http://localhost:3000/api/auth/sa-config", {
        method: "POST",
        body: JSON.stringify({
          customerId: "C00woaabb",
          impersonatedUser: "admin@example.com",
        }),
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        success: true,
        customerId: "C00woaabb",
        impersonatedUser: "admin@example.com",
      });
      expect(res.cookies.get(COOKIE_SA_CUSTOMER_ID)?.value).toBe("C00woaabb");
      expect(res.cookies.get(COOKIE_SA_IMPERSONATED_USER)?.value).toBe("admin@example.com");
    });

    it("returns 400 and blocks cookie saving when Option 2 (Direct Mode) token minting fails", async () => {
      mockMintToken.mockRejectedValue(new Error("Service Account key file could not be loaded"));
      const req = new NextRequest("http://localhost:3000/api/auth/sa-config", {
        method: "POST",
        body: JSON.stringify({
          customerId: "C00woaabb",
          impersonatedUser: "",
        }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain(
        "Failed to verify direct Service Account token: Service Account key file could not be loaded",
      );
      expect(mockClearTokenCache).toHaveBeenCalled();
    });

    it("saves customerId cookie and deletes impersonation cookie when Option 2 (Direct Mode) token minting passes", async () => {
      mockMintToken.mockResolvedValue("mock-direct-jwt-access-token-456");
      const req = new NextRequest("http://localhost:3000/api/auth/sa-config", {
        method: "POST",
        body: JSON.stringify({
          customerId: "C00woaabb",
          impersonatedUser: "",
        }),
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        success: true,
        customerId: "C00woaabb",
        impersonatedUser: "",
      });
      expect(res.cookies.get(COOKIE_SA_CUSTOMER_ID)?.value).toBe("C00woaabb");
      expect(res.cookies.get(COOKIE_SA_IMPERSONATED_USER)?.value).toBe("");
    });
  });

  describe("DELETE", () => {
    it("clears token cache and deletes session cookies", async () => {
      const res = await DELETE();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(mockClearTokenCache).toHaveBeenCalled();
      expect(res.cookies.get(COOKIE_SA_CUSTOMER_ID)?.value).toBe("");
      expect(res.cookies.get(COOKIE_SA_IMPERSONATED_USER)?.value).toBe("");
    });
  });
});
