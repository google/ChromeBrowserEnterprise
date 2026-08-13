/**
 * @file Security & Compliance Summary card for the dashboard empty state.
 *
 * Fetches structured security metrics (active threats and DLP rule triggers)
 * and displays them in a scannable dashboard card. Provides quick-action
 * buttons to investigate specific rules or threats in the chat.
 */

"use client";

import { useCallback, useMemo } from "react";
import useSWR from "swr";
import {
  AlertTriangle,
  ArrowUpRight,
  Download,
  Key,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Skeleton } from "./ui/skeleton";
import { authAwareFetch } from "@/lib/auth-aware-fetch";

/**
 * Tally metrics for a single DLP policy rule.
 */
export type DlpRuleMetric = {
  name: string;
  totalCount: number;
  blockedCount: number;
  warnedCount: number;
};

/**
 * Aggregated security and compliance metrics parsed from activity logs.
 */
export type SecurityMetrics = {
  malwareCount: number;
  passwordReuseCount: number;
  unsafeDownloadCount: number;
  dlpRules: DlpRuleMetric[];
};

type ApiResponse = {
  summary?: string;
  metrics?: SecurityMetrics;
};

/**
 * Props for the SecuritySummaryCard component.
 */
export type SecuritySummaryCardProps = {
  /** Currently selected user email, or empty string for org-wide view. */
  selectedUser: string;
  /** Callback to dispatch an investigation query into the chat. */
  onAskFollowUp: (promptText: string) => void;
};

const MAX_DLP_RULES_TO_SHOW = 5;

/**
 * Renders a structured dashboard card summarizing active threats and DLP violations.
 */
export function SecuritySummaryCard({ selectedUser, onAskFollowUp }: SecuritySummaryCardProps) {
  const fetcher = useCallback(async ([url, user]: [string, string]): Promise<ApiResponse> => {
    const response = await authAwareFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedUser: user }),
    });

    if (!response.ok) {
      throw new Error("Failed to fetch security summary");
    }

    return response.json();
  }, []);

  const swrKey = ["/api/insights/risky-activity", selectedUser] as const;

  const { data, isLoading, isValidating, error } = useSWR(swrKey, fetcher, {
    revalidateOnFocus: false,
    errorRetryCount: 1,
  });

  const metrics = data?.metrics;
  const isWorking = isLoading || isValidating;

  const hasThreats = useMemo(() => {
    if (!metrics) return false;
    return (
      metrics.malwareCount > 0 || metrics.passwordReuseCount > 0 || metrics.unsafeDownloadCount > 0
    );
  }, [metrics]);

  const hasDlp = useMemo(() => {
    return metrics && metrics.dlpRules.length > 0;
  }, [metrics]);

  const handleInvestigateThreats = () => {
    const scope = selectedUser ? `for user "${selectedUser}"` : "across the organization";
    const activeThreats: string[] = [];
    if (malwareCount > 0) activeThreats.push(`Malware blocks: ${malwareCount}`);
    if (passwordReuseCount > 0) activeThreats.push(`Password reuse leaks: ${passwordReuseCount}`);
    if (unsafeDownloadCount > 0) activeThreats.push(`Unsafe downloads: ${unsafeDownloadCount}`);

    onAskFollowUp(
      `The dashboard says: Active security threats detected ${scope} (${activeThreats.join(", ")}).\n\nCan you tell me more about this?`,
    );
  };

  const handleInvestigateRule = (ruleName: string) => {
    const scope = selectedUser ? `for user "${selectedUser}"` : "across the organization";
    const rule = dlpRules.find((r) => r.name === ruleName);
    const countDesc = rule ? ` (${rule.totalCount} triggers)` : "";
    onAskFollowUp(
      `The dashboard says: DLP Rule "${ruleName}" was triggered ${scope}${countDesc}.\n\nCan you tell me more about this?`,
    );
  };

  const handleAskStatusOverview = () => {
    const scope = selectedUser ? `for user "${selectedUser}"` : "across the organization";
    const isClean = !hasThreats && !hasDlp;
    if (isClean) {
      onAskFollowUp(
        `The dashboard says: No security blocks, warning alerts, or active malware threats were recorded ${scope} in the last 7 days.\n\nCan you tell me more about this?`,
      );
    } else {
      const threatLines: string[] = [];
      if (malwareCount > 0) threatLines.push(`Malware blocks: ${malwareCount}`);
      if (passwordReuseCount > 0) threatLines.push(`Password reuse leaks: ${passwordReuseCount}`);
      if (unsafeDownloadCount > 0) threatLines.push(`Unsafe downloads: ${unsafeDownloadCount}`);

      const dlpLines = dlpRules.map((r) => `${r.name} (${r.totalCount} triggers)`);

      const summaryLines = [...threatLines, ...dlpLines];
      const details = summaryLines.length > 0 ? `\n- ${summaryLines.join("\n- ")}` : "";

      onAskFollowUp(
        `The dashboard says: Security & Compliance Status ${scope} in the last 7 days shows active threat alerts or DLP rule triggers:${details}\n\nCan you tell me more about this?`,
      );
    }
  };

  if (isWorking) {
    return (
      <div
        className="surface-raised border-on-surface/10 flex flex-col gap-4 rounded-[var(--radius-md)] border p-4"
        data-testid="summary-card-skeleton"
      >
        <div className="flex items-center gap-2">
          <Skeleton className="size-6 rounded-full" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </div>
    );
  }

  if (error || !metrics) {
    return (
      <div className="surface-raised border-on-surface/10 rounded-[var(--radius-md)] border p-4">
        <p className="text-error text-sm">
          Unable to load security summary. Please verify credentials.
        </p>
      </div>
    );
  }

  const { malwareCount, passwordReuseCount, unsafeDownloadCount, dlpRules } = metrics;
  const totalDlpTriggers = dlpRules.reduce((acc, r) => acc + r.totalCount, 0);

  const isCleanState = !hasThreats && !hasDlp;

  const displayedRules = dlpRules.slice(0, MAX_DLP_RULES_TO_SHOW);
  const hiddenRulesCount = dlpRules.length - MAX_DLP_RULES_TO_SHOW;

  return (
    <section
      aria-label="Security status summary"
      className="surface-raised border-on-surface/10 flex flex-col gap-4 rounded-[var(--radius-md)] border p-4"
    >
      <header className="flex items-center justify-between">
        <h3 className="text-on-surface text-sm font-medium">Security & Compliance Status (7d)</h3>
        <button
          type="button"
          onClick={handleAskStatusOverview}
          className="state-layer text-on-surface-variant/60 hover:text-primary flex items-center gap-1 rounded-[var(--radius-xs)] px-1.5 py-0.5 text-[0.6875rem] font-medium transition-colors"
          title="Ask agent to analyze this card's data"
        >
          <Sparkles className="size-3" />
          <span>Ask Agent</span>
        </button>
      </header>

      {isCleanState ? (
        <div className="flex flex-col gap-3 py-4 text-center">
          <div className="bg-on-surface/5 text-on-surface-variant mx-auto grid size-12 place-items-center rounded-full">
            <Shield className="size-6" aria-hidden="true" />
          </div>
          <h4 className="text-on-surface text-sm font-medium">No Security Blocks or Warnings</h4>
          <p className="text-on-surface-variant mx-auto max-w-sm text-xs leading-4 text-pretty">
            No security blocks, warning alerts, or active malware threats were recorded{" "}
            {selectedUser ? `for ${selectedUser}` : "across the organization"} in the last 7 days.
          </p>
        </div>
      ) : (
        <>
          {/* Threats Section */}
          <div className="flex flex-col gap-2">
            <h4 className="text-on-surface-variant text-[0.6875rem] font-bold tracking-wider uppercase">
              Active Threats
            </h4>
            {hasThreats ? (
              <div className="bg-error/5 ring-error/10 flex flex-col gap-2.5 rounded-[var(--radius-sm)] p-3 ring-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-on-surface-variant flex items-center gap-1.5">
                    <ShieldAlert className="text-error size-4" />
                    Malware blocks:
                  </span>
                  <span className="text-error font-semibold tabular-nums">{malwareCount}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-on-surface-variant flex items-center gap-1.5">
                    <Key className="text-error size-4" />
                    Password reuse leaks:
                  </span>
                  <span className="text-error font-semibold tabular-nums">
                    {passwordReuseCount}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-on-surface-variant flex items-center gap-1.5">
                    <Download className="text-error size-4" />
                    Unsafe downloads:
                  </span>
                  <span className="text-error font-semibold tabular-nums">
                    {unsafeDownloadCount}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleInvestigateThreats}
                  className="state-layer text-error border-error/25 hover:bg-error/5 mt-1 flex items-center justify-center gap-1 rounded-[var(--radius-xs)] border py-1 text-[0.6875rem] font-semibold"
                >
                  <span>Investigate Threats in Chat</span>
                  <ArrowUpRight className="size-3" />
                </button>
              </div>
            ) : (
              <div className="bg-success/5 ring-success/10 flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2.5 ring-1">
                <ShieldCheck className="text-success size-4" />
                <span className="text-on-surface-variant text-xs">No active threats detected.</span>
              </div>
            )}
          </div>

          {/* DLP Policy Section */}
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <h4 className="text-on-surface-variant text-[0.6875rem] font-bold tracking-wider uppercase">
                DLP Policy Triggers ({totalDlpTriggers})
              </h4>
            </div>

            {hasDlp ? (
              <div className="border-on-surface/10 flex flex-col divide-y rounded-[var(--radius-sm)] border">
                {displayedRules.map((rule) => (
                  <div
                    key={rule.name}
                    className="hover:bg-surface-container/30 flex items-center justify-between px-3 py-2 transition-colors"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="text-on-surface truncate text-xs font-medium">
                        {rule.name}
                      </span>
                      <div className="mt-0.5 flex items-center gap-2">
                        {rule.blockedCount > 0 && (
                          <span className="text-error text-[0.625rem] font-semibold">
                            {rule.blockedCount} blocked
                          </span>
                        )}
                        {rule.warnedCount > 0 && (
                          <span className="text-warning text-[0.625rem] font-semibold">
                            {rule.warnedCount} warned
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleInvestigateRule(rule.name)}
                      title={`Investigate ${rule.name}`}
                      className="state-layer text-primary hover:bg-primary-light grid size-7 place-items-center rounded-full"
                    >
                      <ArrowUpRight className="size-3.5" />
                    </button>
                  </div>
                ))}
                {hiddenRulesCount > 0 && (
                  <div className="bg-surface-dim text-on-surface-muted px-3 py-1.5 text-center text-[0.6875rem]">
                    + {hiddenRulesCount} other policy rule{hiddenRulesCount === 1 ? "" : "s"}{" "}
                    triggered. Ask agent for details.
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-surface-dim ring-on-surface/5 flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2.5 ring-1">
                <AlertTriangle className="text-on-surface-muted size-4" />
                <span className="text-on-surface-muted text-xs">No DLP rules triggered.</span>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
