/**
 * @file Service Account tenant configuration session helpers.
 *
 * In service_account mode, Pocket CEP stores the administrator's selected
 * Google Workspace Customer ID (`customerId`) and optional Domain-Wide Delegation
 * Impersonated User (`impersonatedUser`) inside a cryptographically signed
 * HTTP-only JWT cookie.
 *
 * These helpers read configuration on the server side so the token minter
 * (`src/lib/access-token.ts`) and MCP tool caller (`src/lib/mcp-tools.ts`) can
 * automatically inject credentials and tenant parameters on every request.
 */

import { cookies } from "next/headers";
import { getEnv } from "@/lib/env";
import { verifyJwt } from "./jwt";

export const COOKIE_SA_SESSION = "cep_sa_session";
export const COOKIE_SA_CUSTOMER_ID = "cep_sa_customer_id"; // Deprecated but kept for transition cleanup
export const COOKIE_SA_IMPERSONATED_USER = "cep_sa_impersonated_user"; // Deprecated but kept for transition cleanup

export interface ServiceAccountConfig {
  customerId: string;
  impersonatedUser?: string;
}

/**
 * Retrieves the configured Service Account tenant credentials from the signed session JWT.
 * Must be called inside a Next.js server request context (Route Handler or Server Action).
 *
 * @returns The ServiceAccountConfig object, or null if customerId has not been set.
 */
export async function getServiceAccountConfig(): Promise<ServiceAccountConfig | null> {
  const cookieStore = await cookies();
  const env = getEnv();

  let customerId = env.CEP_CUSTOMER_ID?.trim() || "";
  let impersonatedUser = env.CEP_IMPERSONATE_SUBJECT?.trim() || undefined;
  let hasSessionCookie = false;

  const sessionCookie = cookieStore.get(COOKIE_SA_SESSION)?.value;
  if (sessionCookie) {
    const payload = verifyJwt(sessionCookie, env.BETTER_AUTH_SECRET);
    if (payload) {
      hasSessionCookie = true;
      if (typeof payload.customerId === "string") {
        customerId = payload.customerId.trim();
      }
      if (typeof payload.impersonatedUser === "string" && payload.impersonatedUser.trim()) {
        impersonatedUser = payload.impersonatedUser.trim();
      } else {
        impersonatedUser = undefined;
      }
    }
  }

  // Fallback to environment variables if no valid session cookie is present
  if (!hasSessionCookie) {
    customerId = env.CEP_CUSTOMER_ID?.trim() || "";
    impersonatedUser = env.CEP_IMPERSONATE_SUBJECT?.trim() || undefined;
  }

  if (!customerId) {
    return null;
  }

  return {
    customerId,
    impersonatedUser,
  };
}

/**
 * Resolves the active customer ID for tool calls and prompt instructions.
 * First checks session cookies, falling back to CEP_CUSTOMER_ID env variable.
 */
export async function getActiveCustomerId(): Promise<string | undefined> {
  const config = await getServiceAccountConfig();
  if (config?.customerId) {
    return config.customerId;
  }
  return getEnv().CEP_CUSTOMER_ID;
}
