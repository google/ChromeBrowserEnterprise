/**
 * @file Interactive dashboard shell — client side application container.
 *
 * Integrates the AI chat assistant alongside execution diagnostic monitors
 * and prompt registries. Automatically tracks and updates tool invocation states.
 */

"use client";

import { useState, useCallback } from "react";
import { AppBar } from "@/components/app-bar";
import { ChatPanel } from "@/components/chat-panel";
import { InspectorList } from "@/components/inspector-panel";
import { cn } from "@/lib/cn";
import type { InvocationPart } from "@/lib/tool-part";
import { SIDEBAR_COLLAPSED_KEY } from "@/lib/constants";
import { usePersistedString } from "@/lib/storage";
import { BookOpen, ChevronLeft, ChevronRight, Eraser, Wrench } from "lucide-react";
import { RegistryPanel } from "@/components/registry-panel";
import type { Prompt } from "@/components/registry-panel";

/**
 * Identifiers for the two views inside the left rail. We track this
 * as state on the dashboard so other surfaces (e.g. a future "open
 * inspector on tool call" affordance) can flip the active tab.
 */
type SidebarTab = "inspector" | "registry";

export function DashboardClient() {
  return <DashboardShell />;
}

function DashboardShell() {
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("inspector");
  const [toolInvocations, setToolInvocations] = useState<InvocationPart[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState<Prompt | null>(null);

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
          <div
            role="tablist"
            aria-label="Sidebar views"
            className="border-on-surface/10 flex shrink-0 gap-1 border-b px-2 py-2"
          >
            <SidebarTabButton
              id="tab-inspector"
              panelId="panel-inspector"
              isActive={sidebarTab === "inspector"}
              onSelect={() => setSidebarTab("inspector")}
              icon={Wrench}
              label="MCP Inspector"
              count={toolInvocations.length}
            />
            <SidebarTabButton
              id="tab-registry"
              panelId="panel-registry"
              isActive={sidebarTab === "registry"}
              onSelect={() => setSidebarTab("registry")}
              icon={BookOpen}
              label="MCP Server Registry"
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {sidebarTab === "inspector" && (
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

            {sidebarTab === "registry" && (
              <section id="panel-registry" role="tabpanel" aria-labelledby="tab-registry">
                <RegistryPanel
                  onExecutePrompt={(prompt) => setPendingPrompt(prompt)}
                  isBusy={false}
                />
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
          <ChatPanel
            pendingPrompt={pendingPrompt}
            onPromptExecuted={() => setPendingPrompt(null)}
            onToolInvocation={handleToolInvocation}
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
      title={label}
      aria-label={label}
      className={cn(
        "state-layer relative flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-xs)] py-2 text-xs font-medium",
        isActive
          ? "bg-primary-light text-primary"
          : "text-on-surface-variant hover:text-on-surface hover:bg-on-surface/5",
      )}
    >
      <Icon className="animate-fade-in size-4" aria-hidden="true" />
      {typeof count === "number" && count > 0 && (
        <span
          className={cn(
            "absolute -top-0.5 -right-0.5 scale-90 rounded-full px-1.5 py-0.5 text-[0.625rem] leading-none font-bold",
            isActive ? "bg-primary text-on-primary" : "bg-error text-on-error animate-pulse",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
