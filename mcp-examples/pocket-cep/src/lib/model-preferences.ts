/**
 * @file Client-side + server-side plumbing for the top-bar model picker.
 *
 * Centralises three related concerns so the rest of the app doesn't
 * have to know the raw storage keys or wire format:
 *
 * 1. **Persisted selection** — the user's chosen model ID, kept in
 *    `localStorage` (SSR-safe via {@link usePersistedString}).
 * 2. **BYOK key storage** — user-supplied API keys per provider,
 *    stored only in `localStorage`; never round-tripped except as a
 *    single per-request header.
 * 3. **BYOK header (de)serialisation** — the `x-pocket-cep-byok`
 *    header format (`<provider>:<key>`) and parsing helpers used by
 *    the chat route.
 *
 * This module is both server- and client-safe. The storage helpers
 * return fallbacks during SSR; the header helpers are pure string
 * manipulation and run anywhere.
 */

import {
  BYOK_HEADER,
  BYOK_STORAGE_PREFIX,
  MODEL_SELECTION_KEY,
  type ModelProvider,
} from "./models";
import { readStorage, usePersistedString, writeStorage } from "./storage";

/**
 * Hydration-safe React hook for the currently-selected model ID.
 * First render returns `fallbackId`; the effect in
 * {@link usePersistedString} reconciles with localStorage on mount.
 */
export function useSelectedModelId(fallbackId: string): [string, (id: string) => void] {
  return usePersistedString(MODEL_SELECTION_KEY, fallbackId);
}

/**
 * Reads the stored BYOK key for a provider. Returns `""` when absent,
 * during SSR, or when storage is unavailable. Safe to call from chat
 * send handlers on demand (so model swaps don't need to rebuild the
 * transport).
 */
export function getStoredByok(provider: ModelProvider): string {
  return readStorage(BYOK_STORAGE_PREFIX + provider, "");
}

/**
 * Persists a BYOK key (or clears it with `""` / `null`).
 */
export function setStoredByok(provider: ModelProvider, value: string | null): void {
  writeStorage(BYOK_STORAGE_PREFIX + provider, value);
}

/**
 * Returns the stored model ID synchronously (for non-React callers
 * like the chat transport's `body` resolver). Falls back to `null`
 * when none is stored.
 */
export function getStoredModelId(): string | null {
  return readStorage(MODEL_SELECTION_KEY, null);
}

/**
 * Builds the `x-pocket-cep-byok` header value for the provider of
 * the currently-selected model, or `null` if no BYOK key is stored.
 * Format: `<provider>:<key>`.
 */
export function buildByokHeader(provider: ModelProvider): Record<string, string> {
  const key = getStoredByok(provider);
  if (!key) return {};
  return { [BYOK_HEADER]: `${provider}:${key}` };
}

/**
 * Parses the `x-pocket-cep-byok` header value into a raw key, but
 * only when the header's provider prefix matches the expected one.
 * Any parse failure resolves to `undefined` so the route falls
 * through to the server env key.
 */
export function parseByokHeader(raw: string | null, expected: ModelProvider): string | undefined {
  if (!raw) return undefined;
  const separator = raw.indexOf(":");
  if (separator <= 0 || separator >= raw.length - 1) return undefined;
  const provider = raw.slice(0, separator);
  const key = raw.slice(separator + 1).trim();
  if (provider !== expected || !key) return undefined;
  return key;
}

/**
 * Re-export so the chat route's header reader uses the canonical
 * name without reaching into `./models` directly.
 */
export { BYOK_HEADER };
