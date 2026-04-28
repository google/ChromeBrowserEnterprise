/**
 * @file Shared cache-key builder for per-caller in-process caches.
 *
 * Several server-side caches (MCP tool catalog, MCP prompt catalog,
 * Admin Reports activity) isolate entries by caller identity so that
 * user_oauth sessions don't share cached data with one another or with
 * service_account (ADC) flows.
 *
 * service_account callers share a single `|sa` entry (no token). Each
 * user_oauth caller gets a per-token entry keyed by a truncated
 * SHA-256 — the raw access token never lands in the Map.
 */

import { createHash } from "node:crypto";

/**
 * Builds a cache key of the form `${serverUrl}|sa` (service_account) or
 * `${serverUrl}|u:<16-char-hash>` (user_oauth). The hash length is
 * enough to make collisions astronomically unlikely while keeping keys
 * short in logs and heap dumps.
 */
export function buildCallerCacheKey(serverUrl: string, accessToken: string | undefined): string {
  if (!accessToken) return `${serverUrl}|sa`;
  const hash = createHash("sha256").update(accessToken).digest("hex").slice(0, 16);
  return `${serverUrl}|u:${hash}`;
}
