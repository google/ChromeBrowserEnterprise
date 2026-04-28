/**
 * @file RSC error boundary for `/dashboard`.
 *
 * Catches transient infra failures (e.g. environment validation, MCP
 * server missing on first boot) so the page renders a polite retry
 * affordance instead of Next's default 500 stack. Auth failures don't
 * land here — `getActivitySafe` swallows them server-side and the
 * client banner takes over via the next user-driven fetch.
 */

"use client";

import { useEffect } from "react";
import { LOG_TAGS } from "@/lib/constants";

type DashboardErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function DashboardError({ error, reset }: DashboardErrorProps) {
  useEffect(() => {
    console.error(LOG_TAGS.USERS, "Dashboard RSC error:", error.message, error.digest);
  }, [error]);

  return (
    <main className="bg-surface-dim flex min-h-dvh flex-col items-center justify-center gap-4 px-4">
      <div className="bg-surface ring-on-surface/10 flex w-full max-w-md flex-col items-center gap-3 rounded-[var(--radius-md)] px-6 py-8 text-center shadow-[var(--shadow-elevation-1)] ring-1">
        <h1 className="text-on-surface text-lg font-medium">Dashboard didn&apos;t load</h1>
        <p className="text-on-surface-variant text-sm">
          Something went wrong while preparing this page. Try again, or restart the MCP server if
          it&apos;s offline.
        </p>
        {error.digest && (
          <code className="bg-surface-container text-on-surface-variant rounded-[var(--radius-xs)] px-2 py-1 font-mono text-xs">
            {error.digest}
          </code>
        )}
        <button
          type="button"
          onClick={reset}
          className="state-layer bg-primary text-on-primary mt-2 rounded-[var(--radius-sm)] px-4 py-2 text-sm font-medium"
        >
          Retry
        </button>
      </div>
    </main>
  );
}
