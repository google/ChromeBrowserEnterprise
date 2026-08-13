/**
 * @file Panel to list registered MCP Tools and Prompts.
 *
 * Displays tool definitions, input schemas, and prompts catalog retrieved
 * from the MCP server. Helps the developer understand the active context
 * injected into the LLM and run prompts directly from the sidebar.
 */

"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";
import { ArrowUpRight, ChevronDown, ChevronRight, Terminal, Wrench } from "lucide-react";
import { Skeleton } from "./ui/skeleton";
import { authAwareFetch } from "@/lib/auth-aware-fetch";

export type PromptArgument = {
  name: string;
  description?: string;
  required?: boolean;
};

export type Prompt = {
  name: string;
  description?: string;
  arguments?: PromptArgument[];
  title?: string;
};

export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
};

type RegistryPanelProps = {
  /** Callback to trigger execution of a selected prompt. */
  onExecutePrompt: (prompt: Prompt) => void;
  /** Whether the parent is currently streaming/busy. */
  isBusy: boolean;
};

type ToolsResponse = { tools?: McpTool[] };
type PromptsResponse = { prompts?: Prompt[]; error?: string };

export function RegistryPanel({ onExecutePrompt, isBusy }: RegistryPanelProps) {
  const { data: toolsData, isLoading: isToolsLoading } = useSWR<ToolsResponse>(
    "/api/tools",
    async (url: string) => {
      const res = await authAwareFetch(url);
      if (!res.ok) throw new Error("Failed to fetch tools");
      return res.json();
    },
    { revalidateOnFocus: false },
  );

  const { data: promptsData, isLoading: isPromptsLoading } = useSWR<PromptsResponse>(
    "/api/prompts",
    async (url: string) => {
      const res = await authAwareFetch(url);
      if (!res.ok) throw new Error("Failed to fetch prompts");
      return res.json();
    },
    { revalidateOnFocus: false, errorRetryCount: 1 },
  );

  const tools = toolsData?.tools ?? [];
  const prompts = promptsData?.prompts ?? [];

  if (isToolsLoading || isPromptsLoading) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 px-4 py-4">
      <header className="border-on-surface/5 flex flex-col gap-1 border-b pb-2">
        <h1 className="text-on-surface text-sm font-semibold">MCP Server Registry</h1>
        <p className="text-on-surface-variant text-[0.6875rem] leading-4 text-pretty">
          Connected capabilities, tools, and prompts registered by the MCP server.
        </p>
      </header>

      {/* Prompts Section */}
      <section aria-label="Available Prompts" className="flex flex-col gap-3">
        <header className="border-on-surface/10 flex items-baseline justify-between border-b pb-1.5">
          <h2 className="text-on-surface text-sm font-medium">MCP Prompts</h2>
          <span className="text-on-surface-muted font-mono text-[0.6875rem]">prompts/list</span>
        </header>

        {prompts.length === 0 ? (
          <p className="text-on-surface-muted text-xs">No prompts registered on the server.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {prompts.map((prompt) => (
              <li key={prompt.name}>
                <PromptItem prompt={prompt} onRun={onExecutePrompt} isBusy={isBusy} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Tools Section */}
      <section aria-label="Available Tools" className="flex flex-col gap-3">
        <header className="border-on-surface/10 flex items-baseline justify-between border-b pb-1.5">
          <h2 className="text-on-surface text-sm font-medium">MCP Tools</h2>
          <span className="text-on-surface-muted font-mono text-[0.6875rem]">tools/list</span>
        </header>

        {tools.length === 0 ? (
          <p className="text-on-surface-muted text-xs">No tools registered on the server.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {tools.map((tool) => (
              <li key={tool.name}>
                <ToolItem tool={tool} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PromptItem({
  prompt,
  onRun,
  isBusy,
}: {
  prompt: Prompt;
  onRun: (prompt: Prompt) => void;
  isBusy: boolean;
}) {
  const title = prompt.title || prompt.name.replace(/^[^:]+:/, "");
  const cleanTitle = title.charAt(0).toUpperCase() + title.slice(1);
  const hasRequiredArgs = prompt.arguments?.some((a) => a.required) ?? false;

  return (
    <div className="bg-on-surface/[0.02] border-on-surface/5 flex flex-col gap-1 rounded-[var(--radius-sm)] border p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Terminal className="text-primary size-3.5 shrink-0" />
          <span className="text-on-surface truncate text-xs font-semibold">{cleanTitle}</span>
        </div>

        {!hasRequiredArgs && (
          <button
            type="button"
            onClick={() => onRun(prompt)}
            disabled={isBusy}
            title="Execute prompt in chat"
            className="state-layer text-primary hover:bg-primary/5 flex size-5 cursor-pointer items-center justify-center rounded-full transition-colors disabled:opacity-40"
          >
            <ArrowUpRight className="size-3.5" />
          </button>
        )}
      </div>

      {prompt.description && (
        <p className="text-on-surface-variant text-[0.75rem] leading-4">{prompt.description}</p>
      )}

      {prompt.arguments && prompt.arguments.length > 0 && (
        <div className="border-on-surface/5 mt-1.5 flex flex-col gap-1 border-t pt-1.5">
          <span className="text-on-surface-muted text-[0.625rem] font-bold tracking-wider uppercase">
            Arguments
          </span>
          <div className="flex flex-col gap-1">
            {prompt.arguments.map((arg) => (
              <div key={arg.name} className="flex flex-col text-[0.6875rem] leading-3.5">
                <span className="text-on-surface font-mono font-medium">
                  {arg.name}
                  {arg.required && <span className="text-error ml-0.5 font-bold">*</span>}
                </span>
                {arg.description && (
                  <span className="text-on-surface-muted">{arg.description}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ToolItem({ tool }: { tool: McpTool }) {
  const [expanded, setExpanded] = useState(false);

  const toggleExpand = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const hasSchema = !!tool.inputSchema?.properties;

  return (
    <div className="bg-on-surface/[0.02] border-on-surface/5 flex flex-col rounded-[var(--radius-sm)] border p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Wrench className="text-primary size-3.5 shrink-0" />
          <span className="text-on-surface truncate font-mono text-xs font-semibold">
            {tool.name}
          </span>
        </div>

        {hasSchema && (
          <button
            type="button"
            onClick={toggleExpand}
            title={expanded ? "Hide input schema" : "Show input schema"}
            className="state-layer text-on-surface-variant hover:bg-on-surface/5 flex size-5 cursor-pointer items-center justify-center rounded-full transition-colors"
          >
            {expanded ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </button>
        )}
      </div>

      {tool.description && (
        <p className="text-on-surface-variant mt-1 text-[0.75rem] leading-4">{tool.description}</p>
      )}

      {expanded && tool.inputSchema?.properties && (
        <div className="border-on-surface/5 mt-2 border-t pt-2">
          <span className="text-on-surface-muted block pb-1.5 text-[0.625rem] font-bold tracking-wider uppercase">
            Input Parameters
          </span>
          <ul className="flex flex-col gap-2">
            {Object.entries(tool.inputSchema.properties).map(([key, prop]) => {
              const isRequired = tool.inputSchema?.required?.includes(key);
              const propVal = prop as { type?: string; description?: string };
              const propType = propVal.type || "any";
              const propDesc = propVal.description;

              return (
                <li
                  key={key}
                  className="border-on-surface/5 flex flex-col gap-0.5 border-l-2 pl-2.5 leading-normal"
                >
                  <div className="flex items-baseline gap-1.5 font-mono text-[0.6875rem]">
                    <span className="text-on-surface font-semibold">{key}</span>
                    <span
                      className={`text-[0.625rem] tracking-wider uppercase ${
                        isRequired
                          ? "text-on-surface-variant/50 font-bold"
                          : "text-on-surface-variant/30 font-medium"
                      }`}
                    >
                      ({propType} · {isRequired ? "required" : "optional"})
                    </span>
                  </div>
                  {propDesc && (
                    <span className="text-on-surface-variant text-[0.6875rem] leading-3.5 text-pretty">
                      {propDesc}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
