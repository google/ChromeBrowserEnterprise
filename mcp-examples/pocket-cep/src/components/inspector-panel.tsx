/**
 * @file MCP Inspector view of tool invocations from the AI SDK.
 *
 * Exposes `InspectorList`, a self-contained scrollable list of tool
 * calls and their state. The dashboard mounts it inside the sidebar's
 * "Inspector" tab so we don't need a third top-level column.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { getToolName } from "ai";
import { cn } from "@/lib/cn";
import { toolPartLabel, type InvocationPart } from "@/lib/tool-part";

type InspectorListProps = {
  invocations: InvocationPart[];
};

/**
 * Renders the list of MCP tool invocations, or a friendly empty
 * message. Layout-agnostic: callers control width and surrounding
 * chrome (headers, tabs, footers).
 */
export function InspectorList({ invocations }: InspectorListProps) {
  if (invocations.length === 0) {
    return (
      <p className="text-on-surface-muted px-2 py-3 text-center text-[0.6875rem] text-pretty">
        Tool invocations will appear here as the agent calls MCP tools.
      </p>
    );
  }

  return (
    <ol role="list" className="flex flex-col gap-1.5">
      {invocations.map((inv, i) => (
        <li key={inv.toolCallId ?? i}>
          <InvocationCard invocation={inv} index={i} />
        </li>
      ))}
    </ol>
  );
}

function InvocationCard({ invocation, index }: { invocation: InvocationPart; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const label = toolPartLabel(invocation.state);
  const badgeClass =
    label === "ERROR"
      ? "bg-error/20 text-error"
      : label === "DONE"
        ? "bg-success/20 text-green-700"
        : "bg-primary/20 text-primary";

  return (
    <article className="bg-surface-dim ring-on-surface/10 rounded-[var(--radius-sm)] ring-1">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="state-layer flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-left"
      >
        {expanded ? (
          <ChevronDown className="text-on-surface-muted size-3" aria-hidden="true" />
        ) : (
          <ChevronRight className="text-on-surface-muted size-3" aria-hidden="true" />
        )}
        <span className="text-on-surface flex-1 truncate font-mono text-[0.6875rem]">
          {getToolName(invocation)}
        </span>
        <span
          className={cn(
            "inline-flex items-center rounded-[var(--radius-xs)] px-1.5 py-0.5 text-[0.625rem] font-semibold tracking-wide uppercase",
            badgeClass,
          )}
        >
          {label}
        </span>
        <span className="text-on-surface-muted font-mono text-[0.625rem] tabular-nums">
          #{index + 1}
        </span>
      </button>

      {expanded && (
        <div className="border-on-surface/10 border-t p-2">
          <pre className="bg-surface-container text-on-surface-variant overflow-x-auto rounded-[var(--radius-xs)] p-2 font-mono text-[0.625rem] leading-4">
            {JSON.stringify(
              {
                toolCallId: invocation.toolCallId,
                state: invocation.state,
                input: invocation.input,
                output: "output" in invocation ? invocation.output : undefined,
                errorText: "errorText" in invocation ? invocation.errorText : undefined,
              },
              null,
              2,
            )}
          </pre>
        </div>
      )}
    </article>
  );
}
