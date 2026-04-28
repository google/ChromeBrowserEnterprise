/**
 * @file Interactive dashboard shell — the only client island under
 * `/dashboard`. The wrapping `page.tsx` is a Server Component; it
 * resolves the activity map server-side and passes it down through
 * an SWR `fallback` so the first paint already has data.
 *
 * Tool invocations are upserted by `toolCallId` so state transitions
 * (input-streaming → input-available → output-available) replace the
 * existing entry in place rather than appending duplicate rows.
 */

"use client";

import { useState, useCallback, useEffect } from "react";
import useSWR, { SWRConfig } from "swr";
import { AppBar } from "@/components/app-bar";
import { UserSelector } from "@/components/user-selector";
import { ChatPanel } from "@/components/chat-panel";
import { InspectorList } from "@/components/inspector-panel";
import { ActivityRoster } from "@/components/activity-roster";
import { cn } from "@/lib/cn";
import type { InvocationPart } from "@/lib/tool-part";
import type { ActivityMap } from "@/lib/activity-data";
import { SIDEBAR_COLLAPSED_KEY, USER_SEARCH_INPUT_ID } from "@/lib/constants";
import { usePersistedString } from "@/lib/storage";
import { Activity, ChevronLeft, ChevronRight, Eraser, Wrench } from "lucide-react";

/**
 * Response shape returned by `GET /api/users/activity`.
 */
type ActivityResponse = { activity?: ActivityMap };

/**
 * Identifiers for the two views inside the left rail. We track this
 * as state on the dashboard so other surfaces (e.g. a future "open
 * inspector on tool call" affordance) can flip the active tab.
 */
type SidebarTab = "activity" | "inspector";

/**
 * Props provided by the RSC wrapper.
 */
type DashboardClientProps = {
  /** Activity fetched server-side; pre-seeds the SWR cache for first paint. */
  initialActivity: ActivityMap;
};

/**
 * Outer wrapper that injects the server-fetched activity into SWR's
 * cache as a fallback. The inner `<DashboardShell />` then reads from
 * SWR exactly as if the data had been fetched client-side; SWR
 * revalidates in the background once the user is idle.
 */
export function DashboardClient({ initialActivity }: DashboardClientProps) {
  return (
    <SWRConfig value={{ fallback: { "/api/users/activity": { activity: initialActivity } } }}>
      <DashboardShell />
    </SWRConfig>
  );
}

function DashboardShell() {
  const [selectedUser, setSelectedUser] = useState("");
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("activity");
  const [toolInvocations, setToolInvocations] = useState<InvocationPart[]>([]);

  /**
   * SWR handles deduping, focus revalidation, and persistent localStorage
   * cache (configured by `SwrProvider`). The fallback above means the
   * very first render already has data — `isLoading` is `false`, the
   * roster paints with content, and a background revalidate keeps it
   * fresh. The route already sends ETag + Cache-Control, so revalidation
   * usually returns 304.
   */
  const { data: activityData, isLoading: isActivityLoading } =
    useSWR<ActivityResponse>("/api/users/activity");
  const activity = activityData?.activity ?? {};

  /**
   * Sidebar collapse state, encoded as "1"/"0" strings so it fits the
   * SSR-safe {@link usePersistedString} hook. SSR default is "0" and
   * the hook reconciles with the stored value after mount — see
   * `src/lib/storage.ts` for why lazy-initialising from localStorage
   * in `useState` would hydration-mismatch.
   */
  const [collapsedFlag, setCollapsedFlag] = usePersistedString(SIDEBAR_COLLAPSED_KEY, "0");
  const isSidebarCollapsed = collapsedFlag === "1";
  const toggleSidebar = useCallback(() => {
    setCollapsedFlag(collapsedFlag === "1" ? "0" : "1");
  }, [collapsedFlag, setCollapsedFlag]);

  const handleToolInvocation = useCallback((part: InvocationPart) => {
    const id = part.toolCallId;
    if (!id) return;
    setToolInvocations((prev) => {
      const idx = prev.findIndex((p) => p.toolCallId === id);
      if (idx === -1) return [...prev, part];
      if (prev[idx] === part) return prev;
      const next = prev.slice();
      next[idx] = part;
      return next;
    });
  }, []);

  /**
   * `/` focuses the user search from anywhere on the page, as long as
   * the user isn't already typing into some other field.
   */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }
      const search = document.getElementById(USER_SEARCH_INPUT_ID);
      if (search instanceof HTMLInputElement) {
        e.preventDefault();
        search.focus();
        search.select();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="isolate flex min-h-0 flex-1 flex-col">
      <AppBar />

      <div className="relative mx-auto flex w-full max-w-[1680px] flex-1 overflow-hidden">
        <aside
          id="dashboard-sidebar"
          aria-label="Investigation rail"
          hidden={isSidebarCollapsed}
          className="bg-surface border-on-surface/10 @container flex min-h-0 w-72 shrink-0 flex-col border-r max-md:hidden lg:w-80"
        >
          <section
            aria-label="User search"
            className="border-on-surface/10 border-b px-4 pt-4 pb-4"
          >
            <UserSelector
              selectedUser={selectedUser}
              onUserChange={setSelectedUser}
              activity={activity}
            />
          </section>

          <div
            role="tablist"
            aria-label="Sidebar views"
            className="border-on-surface/10 flex shrink-0 gap-1 border-b px-2 py-2"
          >
            <SidebarTabButton
              id="tab-activity"
              panelId="panel-activity"
              isActive={sidebarTab === "activity"}
              onSelect={() => setSidebarTab("activity")}
              icon={Activity}
              label="Activity"
            />
            <SidebarTabButton
              id="tab-inspector"
              panelId="panel-inspector"
              isActive={sidebarTab === "inspector"}
              onSelect={() => setSidebarTab("inspector")}
              icon={Wrench}
              label="MCP Inspector"
              count={toolInvocations.length}
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {sidebarTab === "activity" ? (
              <section
                id="panel-activity"
                role="tabpanel"
                aria-labelledby="tab-activity"
                className="flex flex-col gap-2 px-4 py-4"
              >
                <header className="flex items-baseline justify-between gap-2">
                  <h2 id="recent-activity-heading" className="text-on-surface text-sm font-medium">
                    Chrome audit events
                  </h2>
                  <span
                    className="text-on-surface-muted text-xs tabular-nums"
                    title="Counts are Chrome audit log events per user over the last 7 days"
                  >
                    last 7 days
                  </span>
                </header>
                <p className="text-on-surface-muted text-[0.6875rem] leading-4 text-pretty">
                  Top users by audit-log activity. Click a row to scope the chat to that user.
                </p>
                <ActivityRoster
                  activity={activity}
                  selectedUser={selectedUser}
                  isLoading={isActivityLoading}
                  onPick={setSelectedUser}
                />
              </section>
            ) : (
              <section
                id="panel-inspector"
                role="tabpanel"
                aria-labelledby="tab-inspector"
                className="flex flex-col gap-2 px-3 py-3"
              >
                <header className="flex items-baseline justify-between px-1">
                  <h2 className="text-on-surface text-sm font-medium">MCP Inspector</h2>
                  <span className="text-on-surface-muted text-xs tabular-nums">
                    {toolInvocations.length} call{toolInvocations.length === 1 ? "" : "s"}
                  </span>
                </header>
                <InspectorList invocations={toolInvocations} />
              </section>
            )}
          </div>

          {sidebarTab === "inspector" && (
            <footer className="border-on-surface/10 border-t px-2 py-2">
              <button
                type="button"
                onClick={() => setToolInvocations([])}
                disabled={toolInvocations.length === 0}
                className="state-layer text-on-surface-variant flex w-full items-center gap-2 rounded-[var(--radius-xs)] px-2 py-1.5 text-sm disabled:opacity-40"
              >
                <Eraser className="size-4" aria-hidden="true" />
                <span>Clear invocations</span>
              </button>
            </footer>
          )}
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="bg-surface border-on-surface/10 border-b p-2 md:hidden">
            <UserSelector
              selectedUser={selectedUser}
              onUserChange={setSelectedUser}
              activity={activity}
            />
          </div>

          <ChatPanel
            selectedUser={selectedUser}
            onToolInvocation={handleToolInvocation}
            onClearSelectedUser={() => setSelectedUser("")}
          />
        </main>

        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!isSidebarCollapsed}
          aria-controls="dashboard-sidebar"
          className={cn(
            "bg-surface text-on-surface-muted hover:text-on-surface hover:bg-surface-container ring-on-surface/15 absolute top-1/2 z-20 hidden size-6 -translate-y-1/2 items-center justify-center rounded-full shadow-[var(--shadow-elevation-1)] ring-1 transition-transform md:inline-flex",
            isSidebarCollapsed ? "left-2" : "left-72 -translate-x-1/2 lg:left-80",
          )}
        >
          {isSidebarCollapsed ? (
            <ChevronRight className="size-3.5" aria-hidden="true" />
          ) : (
            <ChevronLeft className="size-3.5" aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * Single tab in the sidebar tablist. Encapsulates ARIA wiring and the
 * optional count badge so the tablist markup stays scannable.
 */
type SidebarTabButtonProps = {
  id: string;
  panelId: string;
  isActive: boolean;
  onSelect: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count?: number;
};

function SidebarTabButton({
  id,
  panelId,
  isActive,
  onSelect,
  icon: Icon,
  label,
  count,
}: SidebarTabButtonProps) {
  return (
    <button
      type="button"
      id={id}
      role="tab"
      aria-selected={isActive}
      aria-controls={panelId}
      tabIndex={isActive ? 0 : -1}
      onClick={onSelect}
      className={cn(
        "state-layer flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-xs)] px-2 py-1.5 text-xs font-medium",
        isActive
          ? "bg-primary-light text-primary"
          : "text-on-surface-variant hover:text-on-surface",
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      <span>{label}</span>
      {typeof count === "number" && count > 0 && (
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[0.625rem] tabular-nums",
            isActive ? "bg-primary text-on-primary" : "bg-surface-dim text-on-surface-variant",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
