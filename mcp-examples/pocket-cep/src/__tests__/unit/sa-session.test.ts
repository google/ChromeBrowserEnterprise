import { describe, it, expect, vi } from "vitest";
import {
  getServiceAccountConfig,
  COOKIE_SA_CUSTOMER_ID,
  COOKIE_SA_IMPERSONATED_USER,
} from "@/lib/sa-session";

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      if (name === COOKIE_SA_CUSTOMER_ID) return { value: "C01234567" };
      if (name === COOKIE_SA_IMPERSONATED_USER) return { value: "admin@example.com" };
      return undefined;
    },
  })),
}));

describe("getServiceAccountConfig", () => {
  it("resolves customerId and impersonatedUser from cookies", async () => {
    const config = await getServiceAccountConfig();
    expect(config).toEqual({
      customerId: "C01234567",
      impersonatedUser: "admin@example.com",
    });
  });
});
