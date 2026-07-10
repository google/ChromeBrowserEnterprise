/**
 * @file Service Account tenant configuration session helpers.
 *
 * In service_account mode, Pocket CEP stores the administrator's selected
 * Google Workspace Customer ID (`customerId`) and optional Domain-Wide Delegation
 * Impersonated User (`impersonatedUser`) inside HTTP-only cookies.
 *
 * These helpers read configuration on the server side so the token minter
 * (`src/lib/access-token.ts`) and MCP tool caller (`src/lib/mcp-tools.ts`) can
 * automatically inject credentials and tenant parameters on every request.
 */

import { cookies } from "next/headers";

export const COOKIE_SA_CUSTOMER_ID = "cep_sa_customer_id";
export const COOKIE_SA_IMPERSONATED_USER = "cep_sa_impersonated_user";

export interface ServiceAccountConfig {
  customerId: string;
  impersonatedUser?: string;
}

/**
 * Retrieves the configured Service Account tenant credentials from cookies.
 * Must be called inside a Next.js server request context (Route Handler or Server Action).
 *
 * @returns The ServiceAccountConfig object, or null if customerId has not been set.
 */
export async function getServiceAccountConfig(): Promise<ServiceAccountConfig | null> {
  const cookieStore = await cookies();
  const customerId =
    cookieStore.get(COOKIE_SA_CUSTOMER_ID)?.value?.trim() || process.env.CEP_CUSTOMER_ID?.trim();

  const rawImpersonated = cookieStore.get(COOKIE_SA_IMPERSONATED_USER)?.value?.trim();
  const impersonatedUser =
    (rawImpersonated && rawImpersonated.length > 0 ? rawImpersonated : undefined) ||
    process.env.CEP_IMPERSONATE_SUBJECT?.trim();

  if (!customerId && !impersonatedUser) {
    return null;
  }

  return {
    customerId: customerId || "",
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
  return process.env.CEP_CUSTOMER_ID;
}
