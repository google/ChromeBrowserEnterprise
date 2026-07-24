/**
 * @file Global auth-health context.
 *
 * Listens on the window for `auth-error` events dispatched by
 * authAwareFetch (JSON routes) and chat-message (streamed tool errors),
 * and exposes the current AuthErrorPayload plus a `clear()` helper to
 * consumers. The banner reads from here and calls clear() when the
 * /api/auth/health probe comes back green.
 *
 * This is the only place that owns the "currently showing an auth
 * error" state — everything else is stateless dispatch.
 */

"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { AuthErrorPayload } from "@/lib/auth-errors";
import { AUTH_ERROR_EVENT } from "@/lib/auth-aware-fetch";
import { useMode } from "./mode-provider";

/**
 * Value exposed by the AuthHealthContext. `clear()` drops the current
 * error (called on successful health probe); `report()` is available for
 * direct callers (mostly tests or non-fetch flows).
 */
type AuthHealthValue = {
  error: AuthErrorPayload | null;
  report: (payload: AuthErrorPayload) => void;
  clear: () => void;
};

const AuthHealthContext = createContext<AuthHealthValue | null>(null);

/**
 * Mounts in the root layout. Subscribes to window `auth-error` events
 * while mounted so any component in the tree (including ones that use
 * plain fetch through authAwareFetch) can light up the banner.
 */
export function AuthHealthProvider({ children }: { children: ReactNode }) {
  const [error, setError] = useState<AuthErrorPayload | null>(null);
  const mode = useMode();

  const report = useCallback((payload: AuthErrorPayload) => {
    setError(payload);
  }, []);

  const clear = useCallback(() => {
    setError(null);
  }, []);

  useEffect(() => {
    function handler(event: Event) {
      const detail = (event as CustomEvent<AuthErrorPayload>).detail;
      if (detail && detail.code === "unauthenticated" && mode.authMode === "service_account") {
        console.warn(
          "AuthHealthProvider: Stale session detected in Service Account mode. " +
            "Attempting background silent refresh...",
        );
        fetch("/api/auth/auto-session", {
          headers: { Accept: "application/json" },
        })
          .then((res) => {
            if (res.ok) {
              console.log("AuthHealthProvider: Silent session refresh succeeded.");
              clear();
            } else {
              console.error(
                `AuthHealthProvider: Silent refresh failed with status ${res.status}. ` +
                  "Fallback to hard redirect.",
              );
              window.location.href = "/api/auth/auto-session";
            }
          })
          .catch((err) => {
            console.error("AuthHealthProvider: Silent refresh network error:", err);
            window.location.href = "/api/auth/auto-session";
          });
      } else if (detail && typeof detail.code === "string") {
        setError(detail);
      }
    }
    window.addEventListener(AUTH_ERROR_EVENT, handler);
    return () => window.removeEventListener(AUTH_ERROR_EVENT, handler);
  }, [clear, mode.authMode]);

  return (
    <AuthHealthContext.Provider value={{ error, report, clear }}>
      {children}
    </AuthHealthContext.Provider>
  );
}

/**
 * Hook for reading auth-health state. Throws if used outside the
 * provider so wiring mistakes fail loudly at first render.
 */
export function useAuthHealth(): AuthHealthValue {
  const ctx = useContext(AuthHealthContext);
  if (!ctx) throw new Error("useAuthHealth must be used within AuthHealthProvider");
  return ctx;
}
