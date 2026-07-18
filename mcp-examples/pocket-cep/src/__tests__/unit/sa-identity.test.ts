import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getServiceAccountEmail } from "@/lib/sa-identity";

describe("getServiceAccountEmail", () => {
  const originalKeyJson = process.env.CEP_SERVICE_ACCOUNT_KEY_JSON;
  const originalCredPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  beforeEach(() => {
    delete process.env.CEP_SERVICE_ACCOUNT_KEY_JSON;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  });

  afterEach(() => {
    if (originalKeyJson !== undefined) process.env.CEP_SERVICE_ACCOUNT_KEY_JSON = originalKeyJson;
    else delete process.env.CEP_SERVICE_ACCOUNT_KEY_JSON;

    if (originalCredPath !== undefined)
      process.env.GOOGLE_APPLICATION_CREDENTIALS = originalCredPath;
    else delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  });

  it("returns client_email from CEP_SERVICE_ACCOUNT_KEY_JSON when valid JSON string is provided", async () => {
    process.env.CEP_SERVICE_ACCOUNT_KEY_JSON = JSON.stringify({
      client_email: "test-sa@project.iam.gserviceaccount.com",
    });
    const email = await getServiceAccountEmail();
    expect(email).toBe("test-sa@project.iam.gserviceaccount.com");
  });

  it("returns null when no service account credentials are set", async () => {
    const email = await getServiceAccountEmail();
    expect(email).toBeNull();
  });
});
