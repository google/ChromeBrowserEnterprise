/**
 * @file Client-side mode context for the active flavor.
 *
 * The root layout is a Server Component and reads `getEnv()` to know which
 * AUTH_MODE × LLM_PROVIDER combination is running. It passes those values
 * down to this client-only provider so any nested UI (e.g. the mode
 * badges in the app bar) can render them without an extra API fetch.
 *
 * We intentionally expose only non-secret fields. Model names and mode
 * labels are safe to send to the browser; API keys and OAuth secrets
 * stay on the server.
 */

"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";

/**
 * Public-safe snapshot of the Pocket CEP flavor. Shared between the
 * root layout (Server Component) and any Client Component that needs
 * to know which mode/provider is running.
 *
 * `availableProviders` reports whether each provider's API key is
 * populated server-side (boolean — never the key itself). The model
 * selector uses this to mark models as "ready" vs. "bring your own
 * key", and to rank ready ones first.
 */
export type ModeInfo = {
  authMode: "service_account" | "user_oauth";
  llmProvider: "claude" | "gemini";
  llmModel: string;
  availableProviders: {
    anthropic: boolean;
    openai: boolean;
    google: boolean;
  };
};

const ModeContext = createContext<ModeInfo | null>(null);

/**
 * Client provider that caches the flavor in context. Mounted once in
 * the root layout with server-computed props, then read anywhere in
 * the tree via `useMode()`.
 */
export function ModeProvider({ value, children }: { value: ModeInfo; children: ReactNode }) {
  return <ModeContext.Provider value={value}>{children}</ModeContext.Provider>;
}

/**
 * Hook for reading the active flavor. Throws if used outside the
 * provider so missing wiring is caught at render time rather than as
 * a stale default silently shown in production.
 */
export function useMode(): ModeInfo {
  const ctx = useContext(ModeContext);
  if (!ctx) throw new Error("useMode must be used within ModeProvider");
  return ctx;
}
