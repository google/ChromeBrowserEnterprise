/**
 * @file Sidebar list of the most-active users in the last 7 days.
 *
 * Reads the same activity map the UserSelector uses. Clicking an entry
 * selects that user in the chat.
 *
 * Loading state: shows a labeled spinner ("Loading activity…") so it's
 * obvious something is in flight. A small skeleton set sits below the
 * label to preserve layout. Skeleton row count is derived from the
 * current props (not from localStorage) so server/client first render
 * agree — no hydration trap.
 *
 * Each row carries an accessible tooltip explaining what the numeric
 * count means (Chrome audit-log events in the last 7 days).
 */

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";
import type { UserActivity } from "@/app/api/users/activity/route";

type ActivityRosterProps = {
  activity: Record<string, UserActivity>;
  selectedUser: string;
  isLoading?: boolean;
  onPick: (email: string) => void;
};

/**
 * Maximum number of rows shown in the rail. Capped so very large orgs
 * don't blow out the rail height; users investigate top-N anyway.
 */
const MAX_ROSTER_ROWS = 6;

export function ActivityRoster({ activity, selectedUser, isLoading, onPick }: ActivityRosterProps) {
  const ranked = Object.entries(activity)
    .sort((a, b) => b[1].eventCount - a[1].eventCount)
    .slice(0, MAX_ROSTER_ROWS);

  if (isLoading) {
    const skeletonCount = ranked.length > 0 ? ranked.length : MAX_ROSTER_ROWS;
    return (
      <div className="flex flex-col gap-2" role="status" aria-live="polite">
        <div className="text-on-surface-variant flex items-center gap-2 px-2 text-xs">
          <Loader2 className="text-primary size-3.5 animate-spin" aria-hidden="true" />
          <span>Loading Chrome audit events…</span>
        </div>
        <div className="flex flex-col gap-0.5" aria-hidden="true">
          {Array.from({ length: skeletonCount }).map((_, i) => (
            <div key={i} className="flex h-8 w-full items-center gap-2 px-2 py-1.5">
              <Skeleton className="size-1.5 shrink-0 rounded-full" />
              <Skeleton className="h-3 flex-1" />
              <Skeleton className="h-3 w-6 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (ranked.length === 0) {
    return (
      <p className="text-on-surface-muted text-sm text-pretty">
        No Chrome audit events recorded in the last 7 days.
      </p>
    );
  }

  const maxCount = ranked[0][1].eventCount;

  return (
    <ul role="list" className="flex flex-col gap-0.5">
      {ranked.map(([email, entry]) => {
        const isSelected = email === selectedUser;
        const widthPct = Math.max(4, (entry.eventCount / maxCount) * 100);
        const plural = entry.eventCount === 1 ? "event" : "events";
        return (
          <li key={email}>
            <button
              type="button"
              onClick={() => onPick(email)}
              title={`${entry.eventCount} Chrome audit ${plural} from ${email} in the last 7 days`}
              aria-label={`Investigate ${email} — ${entry.eventCount} Chrome audit ${plural} in the last 7 days`}
              className={cn(
                "state-layer group relative flex w-full items-center gap-2 rounded-[var(--radius-xs)] px-2 py-1.5 text-left",
                isSelected && "bg-primary-light",
              )}
            >
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  isSelected ? "bg-primary" : "bg-primary/50",
                )}
                aria-hidden="true"
              />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate font-mono text-xs",
                  isSelected ? "text-primary font-medium" : "text-on-surface",
                )}
              >
                {email}
              </span>
              <span
                className="text-on-surface-muted font-mono text-xs tabular-nums"
                aria-hidden="true"
              >
                {entry.eventCount}
              </span>

              <span
                className="bg-primary/25 pointer-events-none absolute bottom-0 left-0 h-px w-(--activity-bar)"
                aria-hidden="true"
                style={{ "--activity-bar": `${widthPct}%` } as React.CSSProperties}
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
