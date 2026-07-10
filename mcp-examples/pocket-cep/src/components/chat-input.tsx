/**
 * @file Chat input with an auto-growing textarea.
 *
 * Enter sends; Shift+Enter inserts a newline. While the agent is
 * streaming, the send button becomes a stop button.
 *
 * When a user is selected, a scope chip sits inside the input frame
 * showing `Asking about <email>` so the context is visible right where
 * the next message will be sent from.
 */

import { useEffect, useLayoutEffect, useRef } from "react";
import { ArrowUp, AtSign, CornerDownLeft, Square, X } from "lucide-react";

type ChatInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isStreaming: boolean;
  onStop: () => void;
  selectedUser: string;
  onClearSelectedUser?: () => void;
};

const MIN_ROWS = 1;
const MAX_HEIGHT_PX = 200;

export function ChatInput({
  value,
  onChange,
  onSubmit,
  isStreaming,
  onStop,
  selectedUser,
  onClearSelectedUser,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value]);

  useEffect(() => {
    if (!isStreaming) textareaRef.current?.focus();
  }, [isStreaming]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!isStreaming && value.trim()) {
        onSubmit();
      }
    }
  };

  const placeholder = selectedUser
    ? `Ask about ${selectedUser}…`
    : "Ask anything about Chrome Enterprise…";

  return (
    <div className="bg-surface-dim border-on-surface/10 shrink-0 border-t px-4 pt-3 pb-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="surface-raised relative mx-auto flex max-w-3xl flex-col rounded-[var(--radius-md)] focus-within:border-[var(--color-primary)] focus-within:shadow-[0_0_0_3px_rgb(26_115_232_/_0.15),var(--shadow-elevation-1)]"
      >
        {selectedUser && (
          <div className="fade-in border-on-surface/10 flex items-center gap-1.5 border-b px-3 py-1.5">
            <AtSign className="text-primary size-3" />
            <span className="text-on-surface-variant text-[0.6875rem]">Asking about</span>
            <span className="text-primary font-mono text-[0.75rem] font-medium">
              {selectedUser}
            </span>
            {onClearSelectedUser && (
              <button
                type="button"
                onClick={onClearSelectedUser}
                aria-label="Clear selected user"
                className="state-layer text-on-surface-muted hover:text-on-surface ml-auto rounded-full p-0.5"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        )}

        <div className="flex items-end gap-2 px-3.5 py-2.5">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={MIN_ROWS}
            placeholder={placeholder}
            aria-label="Chat message input"
            className="text-on-surface placeholder:text-on-surface-muted max-h-[200px] flex-1 resize-none bg-transparent py-1 text-[0.9375rem] leading-6 focus:outline-none"
          />

          <div className="text-on-surface-muted flex shrink-0 items-center gap-2 pb-1 max-sm:hidden">
            <span className="flex items-center gap-1 text-[0.6875rem]">
              <kbd className="bg-surface-dim ring-on-surface/10 rounded-[3px] px-1 py-0.5 font-mono text-[0.625rem] ring-1">
                <CornerDownLeft className="inline size-2.5" />
              </kbd>
              send
            </span>
          </div>

          {isStreaming ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              className="bg-on-surface text-surface hover:bg-ink focus-visible:outline-primary flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] shadow-[var(--shadow-elevation-1)] focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <Square className="size-3 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!value.trim()}
              aria-label="Send message"
              className="bg-primary text-on-primary hover:bg-primary-hover focus-visible:outline-primary flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] shadow-[var(--shadow-elevation-1)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-30 disabled:shadow-none"
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
