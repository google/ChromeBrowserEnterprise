import { describe, it, expect, vi, beforeEach } from "vitest";
import { getServiceAccountConfig, COOKIE_SA_SESSION } from "@/lib/sa-session";
import { signJwt } from "@/lib/jwt";

const SECRET = "mock-secret";

let mockSessionCookieValue: string | undefined = undefined;

const mockCookieGet = (name: string): { value?: string } | undefined => {
  if (name === COOKIE_SA_SESSION) {
    return mockSessionCookieValue ? { value: mockSessionCookieValue } : undefined;
  }
  return undefined;
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    has: (name: string) => !!mockCookieGet(name),
    get: (name: string) => mockCookieGet(name),
  })),
}));

const mockGetEnv = vi.fn(() => ({
  AUTH_MODE: "service_account" as const,
  BETTER_AUTH_SECRET: SECRET,
  BETTER_AUTH_URL: "http://localhost:3000",
  MCP_SERVER_URL: "http://localhost:4000/mcp",
  LLM_MODEL: "",
  CEP_CUSTOMER_ID: process.env.CEP_CUSTOMER_ID || "",
  CEP_IMPERSONATE_SUBJECT: process.env.CEP_IMPERSONATE_SUBJECT || "",
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => mockGetEnv(),
}));

describe("getServiceAccountConfig", () => {
  beforeEach(() => {
    mockSessionCookieValue = undefined;
    delete process.env.CEP_CUSTOMER_ID;
    delete process.env.CEP_IMPERSONATE_SUBJECT;
  });

  it("resolves customerId and impersonatedUser from valid JWT session cookie", async () => {
    mockSessionCookieValue = signJwt(
      { customerId: "C01234567", impersonatedUser: "admin@example.com" },
      SECRET,
    );

    const config = await getServiceAccountConfig();
    expect(config).toEqual({
      customerId: "C01234567",
      impersonatedUser: "admin@example.com",
    });
  });

  it("does not fall back to CEP_IMPERSONATE_SUBJECT when valid session cookie exists but has no impersonation (Direct Mode)", async () => {
    process.env.CEP_IMPERSONATE_SUBJECT = "zombie-admin@example.com";
    mockSessionCookieValue = signJwt({ customerId: "C01234567" }, SECRET);

    const config = await getServiceAccountConfig();
    expect(config).toEqual({
      customerId: "C01234567",
      impersonatedUser: undefined,
    });
  });

  it("falls back to CEP_IMPERSONATE_SUBJECT when session cookie is missing but CEP_CUSTOMER_ID is set", async () => {
    process.env.CEP_CUSTOMER_ID = "C09876543";
    process.env.CEP_IMPERSONATE_SUBJECT = "env-admin@example.com";
    mockSessionCookieValue = undefined;

    const config = await getServiceAccountConfig();
    expect(config).toEqual({
      customerId: "C09876543",
      impersonatedUser: "env-admin@example.com",
    });
  });

  it("returns null when customerId is empty even if CEP_IMPERSONATE_SUBJECT is set", async () => {
    process.env.CEP_IMPERSONATE_SUBJECT = "env-admin@example.com";
    mockSessionCookieValue = undefined;

    const config = await getServiceAccountConfig();
    expect(config).toBeNull();
  });

  it("falls back to env variables when the session cookie signature is invalid (tampered)", async () => {
    process.env.CEP_CUSTOMER_ID = "C09876543";
    process.env.CEP_IMPERSONATE_SUBJECT = "env-admin@example.com";

    // Sign with a different secret
    mockSessionCookieValue = signJwt(
      { customerId: "C01234567", impersonatedUser: "attacker@example.com" },
      "attacker-secret-key",
    );

    const config = await getServiceAccountConfig();
    // Signature validation should fail and fall back to the env configurations
    expect(config).toEqual({
      customerId: "C09876543",
      impersonatedUser: "env-admin@example.com",
    });
  });

  it("falls back to env variables when the session cookie is expired", async () => {
    process.env.CEP_CUSTOMER_ID = "C09876543";
    process.env.CEP_IMPERSONATE_SUBJECT = "env-admin@example.com";

    const expiredExp = Math.floor(Date.now() / 1000) - 10;
    mockSessionCookieValue = signJwt(
      { customerId: "C01234567", impersonatedUser: "admin@example.com", exp: expiredExp },
      SECRET,
    );

    const config = await getServiceAccountConfig();
    expect(config).toEqual({
      customerId: "C09876543",
      impersonatedUser: "env-admin@example.com",
    });
  });
});
