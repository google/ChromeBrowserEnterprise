import { describe, it, expect, vi } from "vitest";
import {
  getServiceAccountConfig,
  COOKIE_SA_CUSTOMER_ID,
  COOKIE_SA_IMPERSONATED_USER,
} from "@/lib/sa-session";

let mockCookieHas = (name: string): boolean =>
  name === COOKIE_SA_CUSTOMER_ID || name === COOKIE_SA_IMPERSONATED_USER;
let mockCookieGet = (name: string): { value?: string } | undefined => {
  if (name === COOKIE_SA_CUSTOMER_ID) return { value: "C01234567" };
  if (name === COOKIE_SA_IMPERSONATED_USER) return { value: "admin@example.com" };
  return undefined;
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    has: (name: string) => mockCookieHas(name),
    get: (name: string) => mockCookieGet(name),
  })),
}));

describe("getServiceAccountConfig", () => {
  it("resolves customerId and impersonatedUser from cookies", async () => {
    mockCookieHas = (name: string): boolean =>
      name === COOKIE_SA_CUSTOMER_ID || name === COOKIE_SA_IMPERSONATED_USER;
    mockCookieGet = (name) => {
      if (name === COOKIE_SA_CUSTOMER_ID) return { value: "C01234567" };
      if (name === COOKIE_SA_IMPERSONATED_USER) return { value: "admin@example.com" };
      return undefined;
    };

    const config = await getServiceAccountConfig();
    expect(config).toEqual({
      customerId: "C01234567",
      impersonatedUser: "admin@example.com",
    });
  });

  it("does not fall back to CEP_IMPERSONATE_SUBJECT when COOKIE_SA_CUSTOMER_ID exists (Option 2 Direct Mode)", async () => {
    process.env.CEP_IMPERSONATE_SUBJECT = "zombie-admin@example.com";
    mockCookieHas = (name: string): boolean => name === COOKIE_SA_CUSTOMER_ID;
    mockCookieGet = (name) => {
      if (name === COOKIE_SA_CUSTOMER_ID) return { value: "C01234567" };
      if (name === COOKIE_SA_IMPERSONATED_USER) return undefined;
      return undefined;
    };

    const config = await getServiceAccountConfig();
    expect(config).toEqual({
      customerId: "C01234567",
      impersonatedUser: undefined,
    });
    delete process.env.CEP_IMPERSONATE_SUBJECT;
  });

  it("falls back to CEP_IMPERSONATE_SUBJECT when no customer session cookie has been saved yet but CEP_CUSTOMER_ID is set", async () => {
    process.env.CEP_CUSTOMER_ID = "C09876543";
    process.env.CEP_IMPERSONATE_SUBJECT = "env-admin@example.com";
    mockCookieHas = (_name: string): boolean => false;
    mockCookieGet = () => undefined;

    const config = await getServiceAccountConfig();
    expect(config).toEqual({
      customerId: "C09876543",
      impersonatedUser: "env-admin@example.com",
    });
    delete process.env.CEP_CUSTOMER_ID;
    delete process.env.CEP_IMPERSONATE_SUBJECT;
  });

  it("returns null when customerId is empty even if CEP_IMPERSONATE_SUBJECT is set", async () => {
    delete process.env.CEP_CUSTOMER_ID;
    process.env.CEP_IMPERSONATE_SUBJECT = "env-admin@example.com";
    mockCookieHas = (_name: string): boolean => false;
    mockCookieGet = () => undefined;

    const config = await getServiceAccountConfig();
    expect(config).toBeNull();
    delete process.env.CEP_IMPERSONATE_SUBJECT;
  });
});
