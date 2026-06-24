/**
 * @file Helper to retrieve the Google OAuth access token from BetterAuth.
 *
 * Extracts the token-retrieval logic that's shared across API routes.
 * In user_oauth mode, we need the user's Google token to forward to the
 * MCP server. In service_account mode, we return undefined (the MCP
 * server uses its own ADC instead).
 *
 * This is the bridge between BetterAuth (which stores the token after
 * OAuth) and the MCP client (which sends it as a Bearer header). The
 * token flows: Google OAuth -> BetterAuth session -> here -> mcp-client.ts
 * -> CEP MCP server -> Google APIs.
 */

import { headers } from "next/headers";
import { JWT } from "google-auth-library";
import { getAuth } from "./auth";
import { getEnv } from "./env";
import { LOG_TAGS } from "./constants";
import { getServiceAccountConfig } from "./sa-session";
import { loadServiceAccountKey } from "./sa-identity";
import { AuthError } from "./auth-errors";

export const DWD_SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.customer.readonly",
  "https://www.googleapis.com/auth/admin.directory.orgunit.readonly",
  "https://www.googleapis.com/auth/admin.reports.audit.readonly",
  "https://www.googleapis.com/auth/chrome.management.policy",
  "https://www.googleapis.com/auth/chrome.management.reports.readonly",
  "https://www.googleapis.com/auth/chrome.management.profiles.readonly",
  "https://www.googleapis.com/auth/chrome.management.securityinsights",
  "https://www.googleapis.com/auth/cloud-identity.policies",
  "https://www.googleapis.com/auth/apps.licensing",
];

export const MACHINE_SCOPES = [
  ...DWD_SCOPES,
  "https://www.googleapis.com/auth/service.management",
  "https://www.googleapis.com/auth/cloud-platform",
];

export const SA_SCOPES = MACHINE_SCOPES;

export class DwdScopeVerificationError extends AuthError {
  public readonly subject: string;
  public readonly clientId: string;
  public readonly authorizedScopes: string[];
  public readonly missingScopes: string[];

  constructor(
    subject: string,
    clientId: string,
    authorizedScopes: string[],
    missingScopes: string[],
    originalMessage?: string,
  ) {
    const msg =
      missingScopes.length > 0
        ? `Domain-Wide Delegation scope check failed for ${subject}. Out of ${authorizedScopes.length + missingScopes.length} required DWD scopes, ${missingScopes.length} are missing in Google Workspace Admin Console.`
        : originalMessage || `Domain-Wide Delegation token verification failed for ${subject}.`;
    super({
      code: "dwd_scope_mismatch",
      source: "admin-sdk",
      message: msg,
      remedy:
        "Authorize this Service Account and required OAuth scopes in your Google Workspace Admin Console (admin.google.com/ac/owl/domainwidedelegation).",
      docsUrl: "https://admin.google.com/ac/owl/domainwidedelegation",
      dwdDiagnostics: {
        subject,
        clientId,
        authorizedScopes,
        missingScopes,
      },
    });
    this.name = "DwdScopeVerificationError";
    this.subject = subject;
    this.clientId = clientId;
    this.authorizedScopes = authorizedScopes;
    this.missingScopes = missingScopes;
  }
}

async function diagnoseDwdScopeFailures(
  clientEmail: string,
  privateKey: string,
  subject: string,
  scopesToCheck: string[],
): Promise<{ authorized: string[]; missing: string[] }> {
  const results = await Promise.allSettled(
    scopesToCheck.map(async (scope) => {
      const singleJwt = new JWT({
        email: clientEmail,
        key: privateKey,
        scopes: [scope],
        subject,
      });
      await singleJwt.getAccessToken();
      return scope;
    }),
  );

  const authorized: string[] = [];
  const missing: string[] = [];

  results.forEach((res, idx) => {
    if (res.status === "fulfilled") {
      authorized.push(scopesToCheck[idx]);
    } else {
      const errMsg = res.reason instanceof Error ? res.reason.message : String(res.reason);
      const isScopeError =
        /unauthorized_client|client not authorized|access_denied|invalid_grant: (?:Invalid email|User not authorized|Client is unauthorized)/i.test(
          errMsg,
        ) &&
        !/invalid_grant: (?:Invalid JWT Signature|Account disabled|Invalid PKCS#8|Private key)/i.test(
          errMsg,
        );

      if (isScopeError) {
        missing.push(scopesToCheck[idx]);
      }
    }
  });

  return { authorized, missing };
}

type CachedSaToken = {
  token: string;
  expiresAt: number;
  subject?: string;
};

let saTokenCache: CachedSaToken | null = null;
const SAFETY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes safety buffer

export function clearServiceAccountTokenCache(): void {
  saTokenCache = null;
}

/**
 * Mints and caches a Service Account JWT token, throwing an actionable error
 * if credentials or Domain-Wide Delegation are invalid.
 */
export async function mintServiceAccountTokenOrThrow(impersonatedUser?: string): Promise<string> {
  const subject = impersonatedUser || undefined;

  if (
    saTokenCache &&
    saTokenCache.subject === subject &&
    Date.now() < saTokenCache.expiresAt - SAFETY_BUFFER_MS
  ) {
    return saTokenCache.token;
  }

  const loaded = await loadServiceAccountKey();
  if (
    !loaded ||
    typeof loaded.key.client_email !== "string" ||
    loaded.key.client_email.length === 0
  ) {
    const reason = loaded?.errors?.length ? ` (${loaded.errors.join("; ")})` : "";
    throw new Error(`Service Account credentials not found or invalid${reason}`);
  }

  const { client_email: clientEmail, private_key: privateKey } = loaded.key;
  if (typeof privateKey !== "string" || privateKey.length === 0) {
    throw new Error(`Service Account key loaded from ${loaded.source} is missing private_key.`);
  }

  const scopes = subject ? DWD_SCOPES : MACHINE_SCOPES;
  const jwtClient = new JWT({
    email: clientEmail,
    key: privateKey,
    scopes,
    subject,
  });

  let res;
  try {
    res = await jwtClient.getAccessToken();
  } catch (error) {
    if (subject) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const isScopeOrAuthorizationError =
        /unauthorized_client|client not authorized|access_denied|invalid_grant: (?:Invalid email|User not authorized|Client is unauthorized)/i.test(
          errMsg,
        ) &&
        !/invalid_grant: (?:Invalid JWT Signature|Account disabled|Invalid PKCS#8|Private key)/i.test(
          errMsg,
        );

      if (isScopeOrAuthorizationError) {
        const diag = await diagnoseDwdScopeFailures(clientEmail, privateKey, subject, DWD_SCOPES);
        if (diag.missing.length > 0) {
          throw new DwdScopeVerificationError(
            subject,
            loaded.key.client_id || clientEmail,
            diag.authorized,
            diag.missing,
            errMsg,
          );
        }
      }
    }
    throw error;
  }
  if (!res.token) {
    throw new Error("Google OAuth returned an empty access token");
  }

  let expiresAt = Date.now() + 3600 * 1000;
  if (res.res?.data && typeof res.res.data === "object" && "expires_in" in res.res.data) {
    const expiresInSec = Number(res.res.data.expires_in);
    if (!isNaN(expiresInSec) && expiresInSec > 0) {
      expiresAt = Date.now() + expiresInSec * 1000;
    }
  }

  saTokenCache = {
    token: res.token,
    expiresAt,
    subject,
  };

  return res.token;
}

/**
 * Mints and caches a Google access token using the active Service Account
 * credentials, returning undefined if credential retrieval fails.
 */
export async function getServiceAccountAccessToken(
  impersonatedUser?: string,
): Promise<string | undefined> {
  try {
    return await mintServiceAccountTokenOrThrow(impersonatedUser);
  } catch (error) {
    console.error(LOG_TAGS.AUTH, "Failed to mint Service Account access token:", error);
    return undefined;
  }
}

/**
 * Retrieves the Google access token for the current request.
 * - In service_account mode: mints/returns Service Account JWT token.
 * - In user_oauth mode: retrieves human OAuth token from BetterAuth session.
 */
export async function getGoogleAccessToken(options?: {
  subject?: string;
}): Promise<string | undefined> {
  const config = getEnv();

  if (config.AUTH_MODE === "service_account") {
    let subject = options?.subject;
    if (subject === undefined) {
      try {
        const saConfig = await getServiceAccountConfig();
        subject = saConfig?.impersonatedUser || config.CEP_IMPERSONATE_SUBJECT;
      } catch {
        subject = config.CEP_IMPERSONATE_SUBJECT;
      }
    }
    return getServiceAccountAccessToken(subject);
  }

  try {
    const auth = await getAuth();
    /**
     * BetterAuth's getAccessToken reads the session cookie (via headers()),
     * looks up the stored Google OAuth token, and returns it. The
     * `providerId: "google"` tells BetterAuth which social provider's
     * token we want.
     */
    const tokenResult = await auth.api.getAccessToken({
      body: { providerId: "google" },
      headers: await headers(),
    });

    if (
      tokenResult &&
      typeof tokenResult === "object" &&
      "accessToken" in tokenResult &&
      typeof tokenResult.accessToken === "string"
    ) {
      return tokenResult.accessToken;
    }

    console.warn(LOG_TAGS.AUTH, "Token result missing accessToken field");
    return undefined;
  } catch (error) {
    console.error(LOG_TAGS.AUTH, "Failed to get Google access token:", error);
    return undefined;
  }
}

/**
 * Constructs authorization headers for Google API HTTP requests.
 */
export async function buildGoogleApiHeaders(token: string): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${token}`,
  };
}
