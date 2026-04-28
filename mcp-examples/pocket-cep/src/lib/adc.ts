/**
 * @file Google Application Default Credentials helpers.
 *
 * Owns every call to `google-auth-library` so the rest of the app can
 * depend on a typed AuthError contract instead of OAuth error shapes.
 * Extracted out of `admin-sdk.ts` so the health probe and doctor can
 * reuse it without pulling in directory-search code.
 */

import { LOG_TAGS } from "./constants";
import { AuthError, isAuthError, toAuthError } from "./auth-errors";
import { GOOGLE_API_SCOPES } from "./google-scopes";

/**
 * Fetches an access token from Application Default Credentials.
 *
 * Throws `AuthError` on any auth-related failure (invalid_rapt,
 * invalid_grant, missing ADC, UNAUTHENTICATED). Non-auth failures are
 * rethrown untouched so upstream code can report them verbatim.
 */
export async function getADCToken(): Promise<string> {
  try {
    const { GoogleAuth } = await import("google-auth-library");
    const auth = new GoogleAuth({
      scopes: [...GOOGLE_API_SCOPES],
    });
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();

    if (!tokenResponse?.token) {
      throw new AuthError({
        code: "unknown_auth",
        source: "adc",
        message: "ADC returned no access token.",
        remedy: "Run `gcloud auth application-default login` to configure credentials.",
        command: "gcloud auth application-default login",
      });
    }

    return tokenResponse.token;
  } catch (error) {
    if (isAuthError(error)) throw error;
    const classified = toAuthError(error, "adc");
    if (classified) {
      console.error(
        LOG_TAGS.AUTH,
        `ADC token fetch failed: ${classified.code} — ${classified.remedy}`,
      );
      throw classified;
    }
    throw error;
  }
}

/**
 * Builds the headers every Google REST call needs: Authorization plus,
 * when the token came from ADC (not a user OAuth session), the
 * `x-goog-user-project` header pinning quota+billing to the caller's
 * project. User OAuth tokens carry their own project context, so we
 * skip the quota header for them.
 */
export async function buildGoogleApiHeaders(
  token: string,
  isAdcToken: boolean,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (isAdcToken) {
    const quotaProject = await getQuotaProject();
    if (quotaProject) headers["x-goog-user-project"] = quotaProject;
  }
  return headers;
}

/**
 * Reads the quota_project_id from the ADC credentials file. Falls back
 * to GOOGLE_CLOUD_QUOTA_PROJECT. Returns null if neither is set — that
 * is a soft failure, not an auth failure.
 *
 * The ADC file is cached after the first read. Its path is fixed and
 * the content is only rewritten by `gcloud auth application-default
 * login`; if that happens the dev restarts the server anyway, so we
 * don't bother invalidating.
 */
let cachedQuotaProject: string | null | undefined;

export async function getQuotaProject(): Promise<string | null> {
  if (process.env.GOOGLE_CLOUD_QUOTA_PROJECT) {
    return process.env.GOOGLE_CLOUD_QUOTA_PROJECT;
  }
  if (cachedQuotaProject !== undefined) {
    return cachedQuotaProject;
  }

  try {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const { homedir } = await import("os");
    const credPath = join(homedir(), ".config", "gcloud", "application_default_credentials.json");
    const raw: unknown = JSON.parse(readFileSync(credPath, "utf-8"));
    if (raw && typeof raw === "object" && "quota_project_id" in raw) {
      const value = (raw as { quota_project_id?: unknown }).quota_project_id;
      cachedQuotaProject = typeof value === "string" ? value : null;
      return cachedQuotaProject;
    }
    cachedQuotaProject = null;
    return null;
  } catch {
    cachedQuotaProject = null;
    return null;
  }
}
