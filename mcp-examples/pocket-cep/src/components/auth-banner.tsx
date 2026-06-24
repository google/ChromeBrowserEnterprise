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
import Link from "next/link";
import { isAuthErrorPayload } from "@/lib/auth-errors";
import { authClient } from "@/lib/auth-client";

function renderRemedyText(remedy: string) {
  const markdownMatch = remedy.match(/\[([^\]]+)\]\(([^)]+)\)/);
  if (markdownMatch) {
    const [full, label, url] = markdownMatch;
    const parts = remedy.split(full);
    return (
      <>
        {parts[0]}
        <Link
          href={url}
          className="text-warning hover:text-primary font-semibold underline underline-offset-2 transition-colors"
        >
          {label}
        </Link>
        {parts[1]}
      </>
    );
  }

  const target = remedy.includes("Service Account Setup")
    ? "Service Account Setup"
    : remedy.includes("/sa-setup")
      ? "/sa-setup"
      : null;
  if (!target) return remedy;
  const parts = remedy.split(target);
  return (
    <>
      {parts[0]}
      <Link
        href="/sa-setup"
        className="text-warning hover:text-primary font-semibold underline underline-offset-2 transition-colors"
      >
        {target}
      </Link>
      {parts[1]}
    </>
  );
}

/**
 * Renders the banner only when the context holds an error. Keeping the
 * conditional inside the component (rather than the caller) means the
 * root layout can mount it unconditionally.
 */
export function AuthBanner() {
  const { error, report, clear } = useAuthHealth();
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [signingIn, setSigningIn] = useState(false);

  if (!error) return null;

  async function handleSignIn() {
    setSigningIn(true);
    try {
      await authClient.signIn.social({
        provider: "google",
        callbackURL: window.location.pathname || "/dashboard",
      });
    } catch (err) {
      console.error("Sign-in redirect failed:", err);
      setSigningIn(false);
    }
  }

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
        <p className="font-medium text-pretty">{renderRemedyText(error.remedy)}</p>
        <p className="text-on-surface-variant text-pretty">{error.message}</p>
      </div>

      {!error.command ? (
        <button
          type="button"
          onClick={handleSignIn}
          disabled={signingIn}
          className="state-layer ring-warning/30 bg-surface text-on-surface inline-flex items-center gap-2 rounded-[var(--radius-xs)] px-2.5 py-1 text-xs font-medium shadow-sm ring-1 disabled:opacity-50"
        >
          <svg viewBox="0 0 24 24" className="size-3.5 shrink-0" aria-hidden="true">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          <span>{signingIn ? "Redirecting…" : "Sign in with Google"}</span>
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={handleCopy}
            className="state-layer ring-warning/30 inline-flex items-center gap-1.5 rounded-[var(--radius-xs)] bg-white/50 px-2 py-1 font-mono text-xs ring-1"
            aria-label={`Copy command: ${error.command}`}
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            <span>{error.command}</span>
          </button>

          <button
            type="button"
            onClick={handleCheckAgain}
            disabled={checking}
            className="state-layer ring-warning/30 inline-flex items-center gap-1.5 rounded-[var(--radius-xs)] px-2 py-1 text-xs font-medium ring-1 disabled:opacity-50"
          >
            <RefreshCw className={checking ? "size-3 animate-spin" : "size-3"} aria-hidden="true" />
            {checking ? "Checking…" : "Check again"}
          </button>
        </>
      )}

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
