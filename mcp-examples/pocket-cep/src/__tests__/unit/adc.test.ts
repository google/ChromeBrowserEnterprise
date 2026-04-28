/**
 * @file Unit tests for the ADC token helper.
 *
 * Mocks google-auth-library so we can force refresh-token failures and
 * verify that `getADCToken()` throws AuthError with the right code
 * instead of the previous silent-null behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mockGetAccessToken = vi.fn();
const mockGetClient = vi.fn();

vi.mock("google-auth-library", () => ({
  GoogleAuth: vi.fn(function GoogleAuth() {
    return { getClient: mockGetClient };
  }),
}));

import { getADCToken } from "@/lib/adc";
import { AuthError, isAuthError } from "@/lib/auth-errors";

describe("getADCToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetClient.mockResolvedValue({ getAccessToken: mockGetAccessToken });
  });

  it("returns the token string on success", async () => {
    mockGetAccessToken.mockResolvedValue({ token: "ya29.abc" });
    const token = await getADCToken();
    expect(token).toBe("ya29.abc");
  });

  it("throws AuthError(invalid_rapt) when refresh reports invalid_rapt", async () => {
    mockGetAccessToken.mockRejectedValue({
      message: "invalid_grant",
      response: {
        data: {
          error: "invalid_grant",
          error_subtype: "invalid_rapt",
          error_uri: "https://support.google.com/a/answer/9368756",
        },
      },
    });

    await expect(getADCToken()).rejects.toSatisfy((err: unknown) => {
      return isAuthError(err) && (err as AuthError).code === "invalid_rapt";
    });
  });

  it("throws AuthError(no_adc) when ADC is not configured", async () => {
    mockGetClient.mockRejectedValue(
      new Error("Could not load the default credentials. Browse to ..."),
    );

    await expect(getADCToken()).rejects.toSatisfy((err: unknown) => {
      return isAuthError(err) && (err as AuthError).code === "no_adc";
    });
  });

  it("rethrows non-auth errors untouched", async () => {
    const boom = new TypeError("unrelated failure");
    mockGetAccessToken.mockRejectedValue(boom);

    await expect(getADCToken()).rejects.toBe(boom);
  });

  it("throws AuthError(unknown_auth) when the token is empty", async () => {
    mockGetAccessToken.mockResolvedValue({ token: null });

    await expect(getADCToken()).rejects.toSatisfy((err: unknown) => {
      return isAuthError(err) && (err as AuthError).code === "unknown_auth";
    });
  });

  it("re-throws an already-classified AuthError as the same instance", async () => {
    const original = new AuthError({
      code: "invalid_grant",
      source: "adc",
      message: "Token has been expired or revoked.",
      remedy: "Run `gcloud auth application-default login` to re-authenticate.",
      command: "gcloud auth application-default login",
    });
    mockGetAccessToken.mockRejectedValue(original);

    await expect(getADCToken()).rejects.toBe(original);
  });
});

/**
 * Covers the in-module cache introduced to avoid reading the ADC
 * credentials JSON on every Google API call. Uses a real temp HOME so
 * the dynamic fs/os/path imports inside getQuotaProject see a
 * deterministic filesystem — avoids the fragility of mocking Node
 * built-ins across dynamic imports.
 */
describe("getQuotaProject", () => {
  let tmpHome: string;
  let origHome: string | undefined;
  let origQuotaEnv: string | undefined;

  function writeCreds(body: unknown) {
    const dir = join(tmpHome, ".config", "gcloud");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "application_default_credentials.json"), JSON.stringify(body));
  }

  beforeEach(() => {
    origHome = process.env.HOME;
    origQuotaEnv = process.env.GOOGLE_CLOUD_QUOTA_PROJECT;
    delete process.env.GOOGLE_CLOUD_QUOTA_PROJECT;
    tmpHome = mkdtempSync(join(tmpdir(), "adc-test-"));
    process.env.HOME = tmpHome;
    vi.resetModules();
  });

  afterEach(() => {
    if (origHome !== undefined) process.env.HOME = origHome;
    else delete process.env.HOME;
    if (origQuotaEnv !== undefined) process.env.GOOGLE_CLOUD_QUOTA_PROJECT = origQuotaEnv;
    else delete process.env.GOOGLE_CLOUD_QUOTA_PROJECT;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("returns GOOGLE_CLOUD_QUOTA_PROJECT without reading disk", async () => {
    process.env.GOOGLE_CLOUD_QUOTA_PROJECT = "env-project";
    const { getQuotaProject } = await import("@/lib/adc");
    expect(await getQuotaProject()).toBe("env-project");
  });

  it("reads quota_project_id from the ADC credentials file", async () => {
    writeCreds({ quota_project_id: "disk-project" });
    const { getQuotaProject } = await import("@/lib/adc");
    expect(await getQuotaProject()).toBe("disk-project");
  });

  it("returns null when the creds file is missing", async () => {
    const { getQuotaProject } = await import("@/lib/adc");
    expect(await getQuotaProject()).toBeNull();
  });

  it("returns null when the file lacks quota_project_id", async () => {
    writeCreds({ access_token: "xyz" });
    const { getQuotaProject } = await import("@/lib/adc");
    expect(await getQuotaProject()).toBeNull();
  });

  it("memoizes the successful result (file deleted mid-session still returns cache)", async () => {
    writeCreds({ quota_project_id: "cached" });
    const { getQuotaProject } = await import("@/lib/adc");
    expect(await getQuotaProject()).toBe("cached");

    rmSync(join(tmpHome, ".config"), { recursive: true, force: true });
    expect(await getQuotaProject()).toBe("cached");
    expect(await getQuotaProject()).toBe("cached");
  });

  it("caches a null miss so the disk isn't re-read on every call", async () => {
    const { getQuotaProject } = await import("@/lib/adc");
    expect(await getQuotaProject()).toBeNull();

    writeCreds({ quota_project_id: "too-late" });
    expect(await getQuotaProject()).toBeNull();
  });

  it("env var takes precedence over the cached disk value", async () => {
    writeCreds({ quota_project_id: "from-disk" });
    const { getQuotaProject } = await import("@/lib/adc");
    expect(await getQuotaProject()).toBe("from-disk");

    process.env.GOOGLE_CLOUD_QUOTA_PROJECT = "env-wins";
    expect(await getQuotaProject()).toBe("env-wins");
  });
});
