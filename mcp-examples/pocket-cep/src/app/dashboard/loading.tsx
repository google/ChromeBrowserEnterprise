/**
 * @file Streaming fallback for `/dashboard`.
 *
 * Next renders this instantly while the page's RSC fetch resolves —
 * the user sees a clear "Loading Pocket CEP…" message at first byte
 * instead of a silent grey screen. Kept intentionally markup-only;
 * nothing here calls any data hooks.
 */

import { Loader2 } from "lucide-react";

export default function DashboardLoading() {
  return (
    <main
      role="status"
      aria-live="polite"
      aria-label="Loading Pocket CEP"
      className="bg-surface-dim flex min-h-dvh flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center"
    >
      <div className="bg-surface ring-on-surface/10 relative flex size-14 items-center justify-center rounded-full shadow-[var(--shadow-elevation-1)] ring-1">
        <Loader2 className="text-primary size-7 animate-spin" aria-hidden="true" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-on-surface text-lg font-medium tracking-tight">Loading Pocket CEP</p>
        <p className="text-on-surface-variant text-sm">
          Fetching your Chrome Enterprise Premium environment…
        </p>
      </div>
    </main>
  );
}
