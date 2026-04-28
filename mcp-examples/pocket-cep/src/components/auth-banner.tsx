/**
 * @file Sticky global banner for Google authentication errors.
 *
 * Appears whenever any surface reports an AuthErrorPayload (API 401s via
 * authAwareFetch, streamed tool errors via chat-message). Offers a
 * copy-to-clipboard for the remedy command and a "Check again" button
 * that probes /api/auth/health; on 200 the banner clears, on 401 it
 * refreshes with the latest payload.
 *
 * Sticky by design: the only way to dismiss is a successful health
 * check. This keeps the state honest — silent auto-clear could hide a
 * flapping or partially-restored session.
 */

"use client";

import { useState } from "react";
import { ShieldAlert, Copy, Check, RefreshCw } from "lucide-react";
import { useAuthHealth } from "@/components/auth-health-provider";
import { isAuthErrorPayload } from "@/lib/auth-errors";

/**
 * Renders the banner only when the context holds an error. Keeping the
 * conditional inside the component (rather than the caller) means the
 * root layout can mount it unconditionally.
 */
export function AuthBanner() {
  const { error, report, clear } = useAuthHealth();
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);

  if (!error) return null;

  async function handleCheckAgain() {
    setChecking(true);
    try {
      const res = await fetch("/api/auth/health");
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: unknown;
      };
      if (res.ok && body.ok) {
        clear();
        return;
      }
      if (isAuthErrorPayload(body.error)) {
        report(body.error);
      }
    } finally {
      setChecking(false);
    }
  }

  async function handleCopy() {
    if (!error?.command) return;
    await navigator.clipboard.writeText(error.command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      className="bg-warning-light text-warning ring-warning/30 flex shrink-0 flex-col gap-2 px-4 py-2 text-sm ring-1 sm:flex-row sm:items-center"
    >
      <ShieldAlert className="size-4 shrink-0" aria-hidden="true" />
      <div className="flex-1">
        <p className="font-medium text-pretty">{error.remedy}</p>
        <p className="text-on-surface-variant text-pretty">{error.message}</p>
      </div>

      {error.command && (
        <button
          type="button"
          onClick={handleCopy}
          className="state-layer ring-warning/30 inline-flex items-center gap-1.5 rounded-[var(--radius-xs)] bg-white/50 px-2 py-1 font-mono text-xs ring-1"
          aria-label={`Copy command: ${error.command}`}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          <span>{error.command}</span>
        </button>
      )}

      <button
        type="button"
        onClick={handleCheckAgain}
        disabled={checking}
        className="state-layer ring-warning/30 inline-flex items-center gap-1.5 rounded-[var(--radius-xs)] px-2 py-1 text-xs font-medium ring-1 disabled:opacity-50"
      >
        <RefreshCw className={checking ? "size-3 animate-spin" : "size-3"} aria-hidden="true" />
        {checking ? "Checking…" : "Check again"}
      </button>

      {error.docsUrl && (
        <a
          href={error.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs underline opacity-80 hover:opacity-100"
        >
          Details
        </a>
      )}
    </div>
  );
}
