/**
 * @file Setup & Posture Alerts card for the dashboard.
 *
 * Runs diagnostic checks (licensing gaps, missing extensions, disabled connectors)
 * and displays them in a high-density, actionable warning panel.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import { AlertTriangle, ExternalLink, Info, Shield, ShieldAlert, Sparkles, X } from "lucide-react";
import { Skeleton } from "./ui/skeleton";
import { authAwareFetch } from "@/lib/auth-aware-fetch";

export type PostureAlert = {
  id: string;
  severity: "critical" | "high" | "medium" | "warning";
  component: string;
  message: string;
  suggestedQuery: string;
  remediation?: {
    url: string;
    label: string;
  };
};

type ApiResponse = {
  alerts?: PostureAlert[];
};

export type PostureAlertsCardProps = {
  /** Currently selected user email, or empty string for org-wide view. */
  selectedUser: string;
  /** Callback to dispatch an investigation query into the chat. */
  onAskFollowUp: (promptText: string) => void;
};

/**
 * Renders a list of active environment setup and posture alerts.
 */
export function PostureAlertsCard({ selectedUser, onAskFollowUp }: PostureAlertsCardProps) {
  const fetcher = useCallback(async ([url, user]: [string, string]): Promise<ApiResponse> => {
    const response = await authAwareFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedUser: user }),
    });

    if (!response.ok) {
      throw new Error("Failed to fetch posture alerts");
    }

    return response.json();
  }, []);

  const swrKey = ["/api/insights/posture-alerts", selectedUser] as const;

  const { data, isLoading, isValidating, error } = useSWR(swrKey, fetcher, {
    revalidateOnFocus: false,
    errorRetryCount: 1,
  });

  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const saved = localStorage.getItem("pocket-cep:dismissed-alerts");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setTimeout(() => {
            setDismissedIds(new Set(parsed));
          }, 0);
        }
      } catch (e) {
        console.error("Failed to parse dismissed alerts", e);
      }
    }
  }, []);

  const handleDismiss = useCallback((id: string) => {
    setDismissedIds((prev) => {
      const updated = new Set(prev);
      updated.add(id);
      localStorage.setItem("pocket-cep:dismissed-alerts", JSON.stringify(Array.from(updated)));
      return updated;
    });
  }, []);

  const handleResetDismissed = useCallback(() => {
    setDismissedIds(new Set());
    localStorage.removeItem("pocket-cep:dismissed-alerts");
  }, []);

  const rawAlerts = data?.alerts ?? [];
  const getAlertRank = (a: PostureAlert) => {
    if (a.severity === "critical") return 1;
    if (a.component === "dlpRules" && a.message.toLowerCase().includes("inactive")) return 4;
    if (a.severity === "high") return 2;
    if (a.severity === "medium") return 3;
    return 4;
  };

  const alerts = rawAlerts
    .filter((a) => !dismissedIds.has(a.id))
    .sort((a, b) => getAlertRank(a) - getAlertRank(b));
  const hasDismissed = rawAlerts.length > alerts.length;
  const isWorking = isLoading || isValidating;

  if (isWorking) {
    return (
      <div
        className="surface-raised border-on-surface/10 flex flex-col gap-4 rounded-[var(--radius-md)] border p-4"
        data-testid="posture-alerts-skeleton"
      >
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-16" />
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="surface-raised border-on-surface/10 rounded-[var(--radius-md)] border p-4">
        <p className="text-error text-sm">
          Unable to load posture diagnostics. Please check workspace configuration.
        </p>
      </div>
    );
  }

  const isClean = alerts.length === 0;

  return (
    <section
      aria-label="Setup and posture health alerts"
      className="surface-raised border-on-surface/10 flex flex-col gap-4 rounded-[var(--radius-md)] border p-4"
    >
      <header className="flex items-center justify-between">
        <h3 className="text-on-surface text-sm font-medium">Notifications</h3>
      </header>

      {isClean ? (
        <div className="flex flex-col gap-3 py-6 text-center">
          <div className="bg-on-surface/5 text-on-surface-variant mx-auto grid size-12 place-items-center rounded-full">
            <Shield className="size-6" aria-hidden="true" />
          </div>
          <h4 className="text-on-surface text-sm font-medium">No active notifications</h4>
          <p className="text-on-surface-variant mx-auto max-w-sm text-xs leading-4 text-pretty">
            No critical misconfigurations, missing extensions, or licensing gaps were detected in
            your environment.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {alerts.map((alert) => {
            const isCritical = alert.severity === "critical";
            const isWarning =
              (alert.severity === "high" || alert.severity === "medium") &&
              !(alert.component === "dlpRules" && alert.message.toLowerCase().includes("inactive"));

            const itemStyle = "bg-on-surface/[0.03] border-on-surface/5 text-on-surface";
            const hoverStyle = "hover:bg-on-surface/[0.06] transition-colors";

            let Icon = Info;
            let iconColor = "text-on-surface-variant/40";

            if (isCritical) {
              Icon = ShieldAlert;
              iconColor = "text-error";
            } else if (isWarning) {
              Icon = AlertTriangle;
              iconColor = "text-warning";
            }

            return (
              <div
                key={alert.id}
                className={`${itemStyle} ${hoverStyle} group relative flex min-h-[44px] items-center justify-between gap-3 rounded-[var(--radius-sm)] border py-2.5 pr-28 pl-3.5`}
              >
                <div className="flex min-w-0 items-start gap-2.5">
                  <Icon className={`${iconColor} mt-0.5 size-4 shrink-0`} />
                  <span className="text-on-surface animate-fade-in text-xs leading-4 font-medium">
                    {alert.message}
                  </span>
                </div>
                <div className="absolute top-1/2 right-2 flex shrink-0 -translate-y-1/2 items-center gap-1">
                  {alert.remediation && (
                    <a
                      href={alert.remediation.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.currentTarget.blur()}
                      title="See in UI"
                      className="state-layer text-on-surface-variant/50 hover:text-on-surface-variant/80 hover:bg-on-surface/5 grid size-7 place-items-center rounded-full opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus:opacity-100"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      onAskFollowUp(alert.suggestedQuery);
                      e.currentTarget.blur();
                    }}
                    title="Ask agent about this issue"
                    className="state-layer text-on-surface-variant/50 hover:text-on-surface-variant/80 hover:bg-on-surface/5 grid size-7 place-items-center rounded-full opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus:opacity-100"
                  >
                    <Sparkles className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDismiss(alert.id)}
                    title="Dismiss alert"
                    className="state-layer text-on-surface-variant/50 hover:text-on-surface-variant/80 hover:bg-on-surface/5 grid size-7 place-items-center rounded-full opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus:opacity-100"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hasDismissed && (
        <footer className="border-on-surface/5 flex justify-end border-t pt-2">
          <button
            type="button"
            onClick={handleResetDismissed}
            className="text-on-surface-variant/50 hover:text-primary text-[0.6875rem] font-medium transition-colors hover:underline"
          >
            Show dismissed alerts ({rawAlerts.length - alerts.length})
          </button>
        </footer>
      )}
    </section>
  );
}
