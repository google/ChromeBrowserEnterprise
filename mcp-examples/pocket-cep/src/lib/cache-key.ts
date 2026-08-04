/**
 * @file Shared cache-key builder for per-caller and per-tenant in-process caches.
 *
 * Several server-side caches (MCP tool catalog, MCP prompt catalog,
 * Admin Reports activity) isolate entries by caller identity and tenant so that
 * user_oauth sessions and service_account sessions don't share cached data
 * across different Google Workspace customers (domains) or users.
 *
 * service_account callers partition by `|sa|c:<customerId>`. Each
 * user_oauth caller gets a per-token entry keyed by a truncated
 * SHA-256, optionally partitioned by `customerId` if available.
 */

import { createHash } from "node:crypto";

/**
 * Builds a cache key of the form `${serverUrl}|sa|c:${customerId}` (service_account) or
 * `${serverUrl}|u:${hash}|c:${customerId}` (user_oauth). The hash length is
 * enough to make collisions astronomically unlikely while keeping keys
 * short in logs and heap dumps.
 */
export function buildCallerCacheKey(
  serverUrl: string,
  accessToken: string | undefined,
  customerId?: string,
): string {
  const customerPart = customerId ? `|c:${customerId}` : "";
  if (!accessToken) return `${serverUrl}|sa${customerPart}`;
  const hash = createHash("sha256").update(accessToken).digest("hex").slice(0, 16);
  return `${serverUrl}|u:${hash}${customerPart}`;
}
