/**
 * @file SSR-safe `localStorage` helpers.
 *
 * Wraps every `window.localStorage` access so the same two no-ops
 * (`typeof window === "undefined"`, `try/catch` around
 * QuotaExceeded / privacy-mode errors) aren't copy-pasted in every
 * component. All functions are safe to call during SSR — they just
 * return the fallback or do nothing.
 *
 * ## Hydration-safety rule
 *
 * Do **not** pass `readStorage(...)` as the initial state of a
 * `useState` hook, e.g.:
 *
 * ```
 * // ❌ Hydration mismatch: server returns fallback, client returns
 * //    whatever's in localStorage, so the first client render
 * //    renders different HTML than the server.
 * const [x, setX] = useState(() => readStorage(KEY, "default"));
 * ```
 *
 * Use {@link usePersistedString} instead — it renders the fallback
 * for the first paint (matching SSR) and reconciles from storage in
 * a `useEffect`, so server and client agree on the initial markup
 * and React can safely hydrate before the stored value flashes in.
 */

"use client";

import { useEffect, useState } from "react";

/**
 * Reads a string value for `key`. Returns `fallback` when the value
 * is absent, during SSR, or if storage is disabled.
 */
export function readStorage(key: string, fallback: string): string;
export function readStorage(key: string, fallback: null): string | null;
export function readStorage(key: string, fallback: string | null): string | null {
  if (typeof window === "undefined") return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

/**
 * Writes a string (or removes the entry when passed `null` or the
 * empty string). Silently drops the write during SSR or when storage
 * is unavailable — the preference just won't persist this session.
 */
export function writeStorage(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null || value === "") {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // Quota exceeded or storage disabled — nothing to do.
  }
}

/**
 * Persisted string state hook. First render returns `fallback` on both
 * server and client so SSR markup matches — the stored value is read
 * inside a mount effect and, if different from the fallback, applied
 * via a post-hydration `setState`. Setters write through to storage.
 *
 * Use this in place of `useState(() => readStorage(...))`, which would
 * cause a hydration mismatch.
 */
export function usePersistedString(
  key: string,
  fallback: string,
): [string, (next: string) => void] {
  const [value, setValue] = useState<string>(fallback);

  useEffect(() => {
    const stored = readStorage(key, null);
    if (stored !== null && stored !== fallback) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setValue(stored);
    }
  }, [key, fallback]);

  const update = (next: string) => {
    setValue(next);
    writeStorage(key, next);
  };

  return [value, update];
}
