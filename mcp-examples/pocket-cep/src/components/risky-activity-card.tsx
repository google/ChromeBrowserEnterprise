/**
 * @file Risky activity summarization card for the dashboard empty state.
 *
 * Automatically fetches a concise deterministic summarization of risky user activity
 * and security insights when the dashboard loads, with client-side SWR caching.
 */

"use client";

import { useCallback } from "react";
import useSWR from "swr";
import { ArrowUpRight, ShieldAlert } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { Skeleton } from "./ui/skeleton";
import { authAwareFetch } from "@/lib/auth-aware-fetch";

const MARKDOWN_PLUGINS = [remarkGfm, remarkBreaks];

/**
 * Props for the RiskyActivityCard component.
 */
export type RiskyActivityCardProps = {
  /** Currently selected user email, or empty string for org-wide view. */
  selectedUser: string;
  /** Callback to dispatch a follow-up investigation message into chat. */
  onAskFollowUp: (promptText: string) => void;
};

/**
 * MD3 card displaying an auto-fetched risky activity summarization on load.
 */
export function RiskyActivityCard({ selectedUser, onAskFollowUp }: RiskyActivityCardProps) {
  const fetcher = useCallback(async ([url, user]: [string, string]) => {
    const response = await authAwareFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedUser: user }),
    });

    if (!response.ok) {
      throw new Error("Failed to fetch insight summarization");
    }

    const data = (await response.json()) as { summary?: string };
    return data.summary ?? "No risky activity detected.";
  }, []);

  const swrKey = ["/api/insights/risky-activity", selectedUser] as const;

  const {
    data: summary,
    isLoading,
    isValidating,
    error,
  } = useSWR(swrKey, fetcher, {
    revalidateOnFocus: false,
    errorRetryCount: 1,
  });

  const isWorking = isLoading || isValidating;

  const handleAction = () => {
    const targetPrefix = selectedUser
      ? `The Audited Activity Report for user "${selectedUser}" is`
      : "Our organization's Audited Activity Report is";
    const reportBlock = summary ? `:\n\n${summary}\n\n` : " ";
    onAskFollowUp(
      `${targetPrefix}${reportBlock}Can you investigate this in the Chrome activity logs?`,
    );
  };

  return (
    <section
      aria-label="Recent audited activity"
      className="surface-raised border-on-surface/10 flex flex-col gap-2.5 rounded-[var(--radius-md)] border p-3.5"
    >
      <header className="flex items-center gap-2">
        <span className="bg-warning/15 text-warning grid size-7 shrink-0 place-items-center rounded-[var(--radius-xs)]">
          <ShieldAlert className="size-4" aria-hidden="true" />
        </span>
        <h3 className="text-on-surface text-sm font-medium">
          {selectedUser ? `Recent audited activity (${selectedUser})` : "Recent audited activity"}
        </h3>
      </header>

      <div className="flex flex-col gap-1.5 py-1">
        {isWorking ? (
          <div className="flex flex-col gap-2 py-1" data-testid="risky-activity-skeleton">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        ) : error ? (
          <p className="text-error text-sm">
            Unable to generate summarization. Please verify MCP credentials and system
            configuration.
          </p>
        ) : (
          <div className="prose-chat text-sm leading-5">
            <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS}>{summary}</ReactMarkdown>
          </div>
        )}
      </div>

      <footer className="border-on-surface/10 flex justify-end border-t pt-2">
        <button
          type="button"
          onClick={handleAction}
          disabled={isWorking || !!error}
          className="state-layer text-primary hover:text-primary-dark flex items-center gap-1.5 rounded-[var(--radius-xs)] px-2 py-1 text-xs font-medium disabled:opacity-40"
        >
          <span>Investigate in chat</span>
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </button>
      </footer>
    </section>
  );
}
