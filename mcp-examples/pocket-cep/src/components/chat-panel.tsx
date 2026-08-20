/**
 * @file Main chat panel using the Vercel AI SDK v6 `useChat` hook.
 *
 * Scroll behavior: auto-follow the bottom during streaming only when
 * the user is within ~120px of the bottom. If they've scrolled up, we
 * leave the viewport alone and show a "Jump to latest" pill.
 */

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart } from "ai";
import type { UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ChatMessage } from "./chat-message";
import { ChatInput } from "./chat-input";
import { PostureAlertsCard } from "./posture-alerts-card";
import { SensitiveActivityChartCard } from "./sensitive-activity-chart-card";
import { ArrowDown } from "lucide-react";
import type { InvocationPart } from "@/lib/tool-part";
import { getModelById } from "@/lib/models";
import { buildByokHeader, getStoredModelId } from "@/lib/model-preferences";
import { authAwareFetch } from "@/lib/auth-aware-fetch";
import type { Prompt } from "./registry-panel";

type ChatPanelProps = {
  pendingPrompt?: Prompt | null;
  onPromptExecuted?: () => void;
  onToolInvocation?: (invocation: InvocationPart) => void;
};

export function ChatPanel({ pendingPrompt, onPromptExecuted, onToolInvocation }: ChatPanelProps) {
  const [input, setInput] = useState("");

  /**
   * Serializes the current model selection + (optional) BYOK key each
   * time a message is sent. Read from the storage facade on the fly so
   * the user can flip models mid-session without rebuilding the transport.
   */
  const resolveBody = useCallback(() => {
    return { modelId: getStoredModelId() ?? undefined };
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
        fetch: authAwareFetch,
      }),
    [resolveBody, resolveHeaders],
  );

  const [latestSuggestions, setLatestSuggestions] = useState<{
    messageId: string;
    questions: string[];
  } | null>(null);
  const messagesRef = useRef<UIMessage[]>([]);

  const fetchSuggestions = useCallback(
    async (currentMessages: UIMessage[], assistantMsgId: string) => {
      try {
        const body = resolveBody();
        const headers = { ...resolveHeaders(), "Content-Type": "application/json" };
        const res = await authAwareFetch("/api/chat/suggestions", {
          method: "POST",
          headers,
          body: JSON.stringify({ ...body, messages: currentMessages }),
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.questions) && data.questions.length > 0) {
            setLatestSuggestions({ messageId: assistantMsgId, questions: data.questions });
          }
        }
      } catch {
        /* silent catch for background suggestions */
      }
    },
    [resolveBody, resolveHeaders],
  );

  const { messages, sendMessage, status, stop, error } = useChat({
    transport,
    onFinish: (event) => {
      const msg = "message" in event ? event.message : event;
      const msgs =
        "messages" in event && Array.isArray(event.messages) ? event.messages : undefined;
      if (msg && msg.role === "assistant") {
        const history = msgs ?? [...messagesRef.current, msg];
        void fetchSuggestions(history, msg.id);
      }
    },
  });

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const isStreaming = status === "streaming" || status === "submitted";
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<{ focus: () => void }>(null);
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

  const [promptError, setPromptError] = useState<string | null>(null);

  const handleSend = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      setLatestSuggestions(null);
      setPromptError(null);
      sendMessage({ text });
      setInput("");
      setIsPinnedToBottom(true);
    },
    [sendMessage],
  );

  const handlePopulateInput = useCallback((text: string) => {
    setInput(text);
    chatInputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    handleSend(input);
  };
  const runPrompt = useCallback(
    async (prompt: Prompt) => {
      if (isStreaming) return;
      setPromptError(null);
      try {
        const res = await authAwareFetch("/api/prompts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: prompt.name }),
        });
        const body: { text?: string; error?: string } = await res.json();
        if (!res.ok || !body.text) throw new Error(body.error ?? "Prompt expansion failed");
        setLatestSuggestions(null);
        await sendMessage({
          text: body.text,
          metadata: { promptName: prompt.name, promptTitle: prompt.title || prompt.name },
        });
        setInput("");
        setIsPinnedToBottom(true);
        chatInputRef.current?.focus();
      } catch (e) {
        console.error("Failed to run prompt:", e);
        setPromptError(e instanceof Error ? e.message : "Failed to run prompt");
      }
    },
    [isStreaming, sendMessage],
  );

  useEffect(() => {
    if (pendingPrompt) {
      const timer = setTimeout(() => {
        void runPrompt(pendingPrompt);
        onPromptExecuted?.();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [pendingPrompt, runPrompt, onPromptExecuted]);
  const isEmpty = messages.length === 0;
  /**
   * Show the typing indicator for the entire streaming window, not
   * only until the first text delta lands. If the model calls a
   * second tool after writing some text, the typing dots still make
   * it obvious the agent is still working.
   */
  const showTyping = isStreaming;

  return (
    <div className="bg-surface-dim flex min-h-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={scrollRef} data-testid="chat-scroll" className="flex-1 overflow-y-auto px-6 py-8">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
            <PostureAlertsCard onAskFollowUp={handlePopulateInput} />
            <SensitiveActivityChartCard onAskFollowUp={handlePopulateInput} />

            {!isEmpty && (
              <div className="flex flex-col gap-5">
                {messages.map((msg) => {
                  const showSuggestions =
                    latestSuggestions && latestSuggestions.messageId === msg.id && !isStreaming;
                  return (
                    <div key={msg.id} className="flex flex-col gap-2">
                      <ChatMessage message={msg} />
                      {showSuggestions && (
                        <div className="fade-in flex flex-wrap items-center gap-2 pl-4">
                          {latestSuggestions.questions.map((q, qIdx) => (
                            <button
                              key={qIdx}
                              type="button"
                              onClick={() => handleSend(q)}
                              className="surface-raised state-layer border-on-surface/10 text-on-surface hover:border-primary/40 hover:text-primary flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
                            >
                              <span>💡</span>
                              <span>{q}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {showTyping && <TypingIndicator />}
              </div>
            )}
          </div>

          {(error || promptError) && (
            <div className="bg-error-light text-error ring-error/20 mx-auto mt-4 max-w-3xl rounded-[var(--radius-sm)] px-3 py-2 text-sm ring-1">
              {error?.message ?? promptError}
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
        ref={chatInputRef}
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        isStreaming={isStreaming}
        onStop={stop}
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
