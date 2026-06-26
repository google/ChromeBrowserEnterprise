/**
 * @file Main chat panel using the Vercel AI SDK v6 `useChat` hook.
 *
 * Scroll behavior: auto-follow the bottom during streaming only when
 * the user is within ~120px of the bottom. If they've scrolled up, we
 * leave the viewport alone and show a "Jump to latest" pill.
 */

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { ChatMessage } from "./chat-message";
import { ChatInput } from "./chat-input";
import { RiskyActivityCard } from "./risky-activity-card";
import {
  ArrowDown,
  ArrowUpRight,
  FileSearch,
  Loader2,
  Scale,
  Stethoscope,
  Terminal,
} from "lucide-react";
import type { InvocationPart } from "@/lib/tool-part";
import type { Prompt } from "@modelcontextprotocol/sdk/types.js";
import { getModelById } from "@/lib/models";
import { buildByokHeader, getStoredModelId } from "@/lib/model-preferences";

type ChatPanelProps = {
  selectedUser: string;
  onToolInvocation?: (invocation: InvocationPart) => void;
  onClearSelectedUser?: () => void;
};

/**
 * Maps a prompt name to an icon. The MCP prompt API doesn't carry
 * iconography, so we infer from the name. Anything else falls through
 * to a generic terminal glyph.
 */
function iconForPrompt(name: string): React.ComponentType<{ className?: string }> {
  const n = name.toLowerCase();
  if (n.includes("health")) return Stethoscope;
  if (n.includes("license") || n.includes("subscription") || n.includes("optimize")) return Scale;
  if (n.includes("activity") || n.includes("audit") || n.includes("expert")) return FileSearch;
  return Terminal;
}

// Prefer the server-supplied title; fall back to the bare name with
// any `namespace:` prefix stripped.
function titleForPrompt(p: Prompt): string {
  if (p.title) return p.title;
  const bare = p.name.includes(":") ? p.name.split(":").slice(1).join(":") : p.name;
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

export function ChatPanel({ selectedUser, onToolInvocation, onClearSelectedUser }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [promptExpanding, setPromptExpanding] = useState<string | null>(null);

  /**
   * Prompt catalog. SWR's built-in retry handles the dev-time race where
   * `npm run dev:full` boots the Next app a beat before the MCP server,
   * so the first fetch can come back 503. The provider's `errorRetryCount`
   * already covers the previous hand-rolled backoff loop.
   */
  const { data: promptsData } = useSWR<{ prompts?: Prompt[] }>("/api/prompts", {
    revalidateOnFocus: false,
  });
  const prompts = useMemo(() => promptsData?.prompts ?? [], [promptsData]);

  const selectedUserRef = useRef(selectedUser);
  useEffect(() => {
    selectedUserRef.current = selectedUser;
  }, [selectedUser]);

  /**
   * Serializes the current model selection + (optional) BYOK key each
   * time a message is sent. Read from the storage facade on the fly so
   * the user can flip models mid-session without rebuilding the transport.
   */
  const resolveBody = useCallback(() => {
    return { selectedUser: selectedUserRef.current, modelId: getStoredModelId() ?? undefined };
  }, []);

  const resolveHeaders = useCallback((): Record<string, string> => {
    const modelId = getStoredModelId();
    const option = modelId ? getModelById(modelId) : undefined;
    return option ? buildByokHeader(option.provider) : {};
  }, []);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: resolveBody,
        headers: resolveHeaders,
      }),
    [resolveBody, resolveHeaders],
  );

  const { messages, sendMessage, status, stop, error } = useChat({ transport });

  const isStreaming = status === "streaming" || status === "submitted";
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);

  useEffect(() => {
    if (!isPinnedToBottom) return;
    const raf = requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
    return () => cancelAnimationFrame(raf);
  }, [messages, isPinnedToBottom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const nextPinned = distanceFromBottom < 120;
      setIsPinnedToBottom((prev) => (prev === nextPinned ? prev : nextPinned));
    };
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    setIsPinnedToBottom(true);
  }, []);

  const lastFiredStateRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!onToolInvocation) return;
    for (const msg of messages) {
      if (msg.role !== "assistant" || !msg.parts) continue;
      for (const part of msg.parts) {
        if (!isToolUIPart(part)) continue;
        const id = part.toolCallId;
        if (!id) continue;
        if (lastFiredStateRef.current.get(id) === part.state) continue;
        lastFiredStateRef.current.set(id, part.state);
        onToolInvocation(part);
      }
    }
  }, [messages, onToolInvocation]);

  const handleSend = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      sendMessage({ text });
      setInput("");
      setIsPinnedToBottom(true);
    },
    [sendMessage],
  );

  const handlePopulateInput = useCallback((text: string) => {
    setInput(text);
  }, []);

  const handleSubmit = () => {
    handleSend(input);
  };

  /**
   * Expands a server-authored prompt and sends it as a user turn. The
   * full expanded body goes to the model (so the formatting contract
   * reaches it), but we tag the message with metadata so the UI can
   * render it as a compact chip — the raw prompt is a wall of rules
   * the user doesn't need to look at.
   */
  const runPrompt = useCallback(
    async (prompt: Prompt) => {
      if (promptExpanding || isStreaming) return;
      setPromptExpanding(prompt.name);
      try {
        const res = await fetch("/api/prompts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: prompt.name }),
        });
        const body: { text?: string; error?: string } = await res.json();
        if (!res.ok || !body.text) throw new Error(body.error ?? "Prompt expansion failed");
        await sendMessage({
          text: body.text,
          metadata: { promptName: prompt.name, promptTitle: titleForPrompt(prompt) },
        });
        setInput("");
        setIsPinnedToBottom(true);
      } catch {
        /* silent — the LLM call will show any real error */
      } finally {
        setPromptExpanding(null);
      }
    },
    [promptExpanding, isStreaming, sendMessage],
  );

  const isEmpty = messages.length === 0;
  /**
   * Show the typing indicator for the entire streaming window, not
   * only until the first text delta lands. If the model calls a
   * second tool after writing some text, the typing dots still make
   * it obvious the agent is still working.
   */
  const showTyping = isStreaming;

  const suggestablePrompts = useMemo(
    () => prompts.filter((p) => !p.arguments?.some((a) => a.required)).slice(0, 6),
    [prompts],
  );

  return (
    <div className="bg-surface-dim flex min-h-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={scrollRef} data-testid="chat-scroll" className="flex-1 overflow-y-auto px-6 py-8">
          {isEmpty ? (
            <EmptyState
              selectedUser={selectedUser}
              prompts={suggestablePrompts}
              expandingName={promptExpanding}
              onRun={runPrompt}
              onAskFollowUp={handlePopulateInput}
            />
          ) : (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
              {messages.map((msg) => (
                <ChatMessage key={msg.id} message={msg} />
              ))}
              {showTyping && <TypingIndicator />}
            </div>
          )}

          {error && (
            <div className="bg-error-light text-error ring-error/20 mx-auto mt-4 max-w-3xl rounded-[var(--radius-sm)] px-3 py-2 text-sm ring-1">
              {error.message}
            </div>
          )}

          <div ref={bottomRef} aria-hidden="true" />
        </div>

        {!isPinnedToBottom && !isEmpty && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="bg-surface text-on-surface-variant ring-on-surface/15 hover:bg-surface-container fade-in absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium shadow-[var(--shadow-elevation-2)] ring-1"
          >
            <ArrowDown className="size-3.5" />
            <span>Jump to latest</span>
          </button>
        )}
      </div>

      <ChatInput
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        isStreaming={isStreaming}
        onStop={stop}
        selectedUser={selectedUser}
        onClearSelectedUser={onClearSelectedUser}
      />
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="fade-in flex items-center gap-2 pl-10">
      <div className="bg-surface ring-on-surface/10 flex items-center gap-1 rounded-[var(--radius-md)] px-3 py-2.5 ring-1">
        <span className="typing-dot typing-dot-1 bg-on-surface-muted size-1.5 rounded-full" />
        <span className="typing-dot typing-dot-2 bg-on-surface-muted size-1.5 rounded-full" />
        <span className="typing-dot typing-dot-3 bg-on-surface-muted size-1.5 rounded-full" />
      </div>
    </div>
  );
}

function EmptyState({
  selectedUser,
  prompts,
  expandingName,
  onRun,
  onAskFollowUp,
}: {
  selectedUser: string;
  prompts: Prompt[];
  expandingName: string | null;
  onRun: (prompt: Prompt) => void;
  onAskFollowUp: (text: string) => void;
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 pt-2">
      <RiskyActivityCard selectedUser={selectedUser} onAskFollowUp={onAskFollowUp} />

      {prompts.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <h3 className="section-label">Server prompts</h3>
            <span className="text-on-surface-muted font-mono text-[0.6875rem]">
              from MCP · prompts/list
            </span>
          </div>
          <ul role="list" className="grid gap-2 sm:grid-cols-2">
            {prompts.map((prompt, i) => {
              const Icon = iconForPrompt(prompt.name);
              const busy = expandingName === prompt.name;
              return (
                <li key={prompt.name}>
                  <button
                    type="button"
                    onClick={() => onRun(prompt)}
                    disabled={busy || expandingName !== null}
                    className={`surface-raised group slide-up stagger-${i + 1} flex w-full flex-col gap-1 rounded-[var(--radius-sm)] p-2.5 text-left cursor-pointer disabled:cursor-wait disabled:opacity-60`}
                  >
                    <div className="flex items-center gap-2 w-full">
                      <span className="bg-primary-light text-primary grid size-6 shrink-0 place-items-center rounded-[var(--radius-xs)]">
                        <Icon className="size-3.5" />
                      </span>
                      <span className="text-on-surface flex-1 text-xs font-medium truncate">
                        {titleForPrompt(prompt)}
                      </span>
                      {busy ? (
                        <Loader2 className="text-on-surface-muted spin-slow size-3.5 shrink-0" />
                      ) : (
                        <ArrowUpRight className="text-on-surface-muted size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                      )}
                    </div>
                    {prompt.description && (
                      <p className="text-on-surface-variant pl-8 text-[0.75rem] leading-4 line-clamp-2">
                        {prompt.description}
                      </p>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
