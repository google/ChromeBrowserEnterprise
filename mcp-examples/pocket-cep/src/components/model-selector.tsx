/**
 * @file Top-bar model selector.
 *
 * Rendered as a small pill in the app bar that opens a grouped menu
 * of {@link MODEL_OPTIONS}. Models whose provider API key is
 * populated server-side (per `ModeInfo.availableProviders`) or
 * client-side via BYOK appear under a "Ready" group; the rest live
 * under "Needs a key" with an inline "Add key" affordance. Keys
 * never leave the browser except as a per-request
 * `X-Pocket-Cep-Byok` header.
 *
 * ## Hydration safety
 *
 * The currently-selected ID is held via {@link useSelectedModelId},
 * which uses the SSR-stable fallback (`mode.llmModel`) for the first
 * render and reconciles with `localStorage` in a mount effect. Reading
 * `localStorage` directly in `useState`'s initialiser would diverge
 * between server (no `window`) and client (populated) — see
 * `src/lib/storage.ts` for details.
 */

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, KeyRound, Plus, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { useMode } from "./mode-provider";
import { MODEL_OPTIONS, getModelById, type ModelOption, type ModelProvider } from "@/lib/models";
import { getStoredByok, setStoredByok, useSelectedModelId } from "@/lib/model-preferences";

const PROVIDER_LABELS: Record<ModelProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
};

const PROVIDER_KEY_URLS: Record<ModelProvider, string> = {
  anthropic: "https://console.anthropic.com/",
  openai: "https://platform.openai.com/api-keys",
  google: "https://aistudio.google.com/apikey",
};

type ModelAvailability = {
  /** Server has the env key populated. */
  env: boolean;
  /** User has pasted a key into BYOK for this provider. */
  byok: boolean;
};

export function ModelSelector() {
  const mode = useMode();
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useSelectedModelId(mode.llmModel);
  /**
   * BYOK keys live in localStorage. Initial state is empty strings
   * (matches SSR); a mount effect backfills from storage. Pasted keys
   * write through immediately via `setStoredByok`.
   */
  const [byokKeys, setByokKeys] = useState<Record<ModelProvider, string>>({
    anthropic: "",
    openai: "",
    google: "",
  });
  const [keyEditorFor, setKeyEditorFor] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setByokKeys({
      anthropic: getStoredByok("anthropic"),
      openai: getStoredByok("openai"),
      google: getStoredByok("google"),
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    function handler(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setKeyEditorFor(null);
      }
    }
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [isOpen]);

  function availabilityFor(opt: ModelOption): ModelAvailability {
    return {
      env: mode.availableProviders[opt.provider],
      byok: Boolean(byokKeys[opt.provider]),
    };
  }

  function isReady(opt: ModelOption): boolean {
    const a = availabilityFor(opt);
    return a.env || a.byok;
  }

  const readyModels = MODEL_OPTIONS.filter((m) => isReady(m));
  const needsKeyModels = MODEL_OPTIONS.filter((m) => !isReady(m));

  function selectModel(opt: ModelOption) {
    if (!isReady(opt)) {
      setKeyEditorFor(opt.id);
      return;
    }
    setSelected(opt.id);
    setIsOpen(false);
    setKeyEditorFor(null);
  }

  function updateByok(provider: ModelProvider, value: string) {
    setStoredByok(provider, value);
    setByokKeys((prev) => ({ ...prev, [provider]: value }));
  }

  const selectedOption = getModelById(selected) ?? getModelById(mode.llmModel) ?? MODEL_OPTIONS[0];

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`Current model: ${selectedOption.label}. Click to change.`}
        className="state-layer text-on-surface ring-on-surface/10 hover:bg-surface-dim data-open:bg-surface-dim inline-flex h-8 items-center gap-2 rounded-[var(--radius-sm)] py-1.5 pr-2 pl-3 text-[0.8125rem] font-medium ring-1"
        data-open={isOpen ? "" : undefined}
      >
        <Sparkles className="text-primary size-3.5" aria-hidden="true" />
        <span className="max-w-[18ch] truncate">{selectedOption.label}</span>
        <ChevronDown
          className={`text-on-surface-muted size-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-label="Choose a model"
          className="bg-surface ring-on-surface/10 absolute top-full right-0 z-30 mt-1.5 w-[22rem] overflow-hidden rounded-[var(--radius-md)] shadow-[var(--shadow-elevation-2)] ring-1"
        >
          <div className="flex max-h-[28rem] flex-col overflow-y-auto p-1.5">
            {readyModels.length > 0 && (
              <ModelGroup label="Ready">
                {readyModels.map((opt) => (
                  <ReadyRow
                    key={opt.id}
                    option={opt}
                    isSelected={opt.id === selectedOption.id}
                    availability={availabilityFor(opt)}
                    onSelect={() => selectModel(opt)}
                    onEditKey={() => setKeyEditorFor(opt.id)}
                    isEditingKey={keyEditorFor === opt.id}
                    byokValue={byokKeys[opt.provider]}
                    onByokChange={(v) => updateByok(opt.provider, v)}
                    onCloseEditor={() => setKeyEditorFor(null)}
                  />
                ))}
              </ModelGroup>
            )}

            {needsKeyModels.length > 0 && (
              <ModelGroup label="Needs an API key">
                {needsKeyModels.map((opt) => (
                  <NeedsKeyRow
                    key={opt.id}
                    option={opt}
                    isEditing={keyEditorFor === opt.id}
                    byokValue={byokKeys[opt.provider]}
                    onOpenEditor={() => setKeyEditorFor(opt.id)}
                    onCloseEditor={() => setKeyEditorFor(null)}
                    onByokChange={(v) => updateByok(opt.provider, v)}
                  />
                ))}
              </ModelGroup>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Small group wrapper with an eyebrow label. Uses uppercase tracking
 * to distinguish section headers from row content without adding
 * visual weight.
 */
function ModelGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-0.5 py-1">
      <h3 className="text-on-surface-muted px-2 pt-1 pb-1.5 text-[0.6875rem] font-medium">
        {label}
      </h3>
      {children}
    </section>
  );
}

type ReadyRowProps = {
  option: ModelOption;
  isSelected: boolean;
  availability: ModelAvailability;
  onSelect: () => void;
  onEditKey: () => void;
  isEditingKey: boolean;
  byokValue: string;
  onByokChange: (value: string) => void;
  onCloseEditor: () => void;
};

/**
 * A row in the "Ready" section. The whole row selects the model. A
 * checkmark on the right indicates the current selection. For BYOK-
 * backed models (not server env), a small "Edit key" link appears on
 * hover so the user can update or revoke their stored key.
 */
function ReadyRow({
  option,
  isSelected,
  availability,
  onSelect,
  onEditKey,
  isEditingKey,
  byokValue,
  onByokChange,
  onCloseEditor,
}: ReadyRowProps) {
  return (
    <div className="flex flex-col">
      <button
        type="button"
        role="option"
        aria-selected={isSelected}
        onClick={onSelect}
        className={cn(
          "group flex w-full items-baseline gap-2 rounded-[var(--radius-xs)] px-2 py-1.5 text-left",
          isSelected ? "bg-primary-light" : "hover:bg-surface-dim",
        )}
      >
        <span
          className={cn(
            "shrink-0 text-[0.8125rem] font-medium",
            isSelected ? "text-primary" : "text-on-surface",
          )}
        >
          {option.label}
        </span>
        <span className="text-on-surface-muted min-w-0 flex-1 truncate text-[0.6875rem]">
          {option.description}
        </span>
        {isSelected ? (
          <Check className="text-primary size-3.5 shrink-0 self-center" aria-hidden="true" />
        ) : availability.byok && !availability.env ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onEditKey();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onEditKey();
              }
            }}
            className="text-on-surface-muted hover:text-primary shrink-0 text-[0.625rem] underline opacity-0 group-hover:opacity-100 focus:opacity-100"
          >
            Edit key
          </span>
        ) : null}
      </button>
      {isEditingKey && (
        <ByokEditor
          option={option}
          value={byokValue}
          onChange={onByokChange}
          onClose={onCloseEditor}
        />
      )}
    </div>
  );
}

type NeedsKeyRowProps = {
  option: ModelOption;
  isEditing: boolean;
  byokValue: string;
  onOpenEditor: () => void;
  onCloseEditor: () => void;
  onByokChange: (value: string) => void;
};

/**
 * A row in the "Needs an API key" section. Clicking the row (or the
 * "Add key" chip) opens the BYOK editor inline.
 */
function NeedsKeyRow({
  option,
  isEditing,
  byokValue,
  onOpenEditor,
  onCloseEditor,
  onByokChange,
}: NeedsKeyRowProps) {
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onOpenEditor}
        aria-expanded={isEditing}
        className={cn(
          "flex w-full items-baseline gap-2 rounded-[var(--radius-xs)] px-2 py-1.5 text-left",
          isEditing ? "bg-surface-dim" : "hover:bg-surface-dim",
        )}
      >
        <span className="text-on-surface-variant shrink-0 text-[0.8125rem] font-medium">
          {option.label}
        </span>
        <span className="text-on-surface-muted min-w-0 flex-1 truncate text-[0.6875rem]">
          {option.description}
        </span>
        {!isEditing && (
          <span className="text-on-surface-muted ring-on-surface/15 inline-flex shrink-0 items-center gap-1 self-center rounded-full px-2 py-0.5 text-[0.625rem] font-medium ring-1">
            <Plus className="size-2.5" aria-hidden="true" />
            Add key
          </span>
        )}
      </button>
      {isEditing && (
        <ByokEditor
          option={option}
          value={byokValue}
          onChange={onByokChange}
          onClose={onCloseEditor}
        />
      )}
    </div>
  );
}

type ByokEditorProps = {
  option: ModelOption;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
};

/**
 * Inline BYOK input. Appears directly under the row it's editing so
 * the visual relationship is obvious. The key lives in `localStorage`
 * only and is sent to the chat route as a single per-request header.
 */
function ByokEditor({ option, value, onChange, onClose }: ByokEditorProps) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function save() {
    onChange(draft.trim());
    onClose();
  }

  function clear() {
    onChange("");
    onClose();
  }

  return (
    <div className="bg-surface-dim/60 mx-1 mt-0.5 flex flex-col gap-2 rounded-[var(--radius-sm)] p-2.5">
      <label className="text-on-surface-variant flex items-center gap-1.5 text-[0.6875rem] font-medium">
        <KeyRound className="size-3" aria-hidden="true" />
        <span>
          {option.envKey}
          <span className="text-on-surface-muted font-normal"> · stays in your browser</span>
        </span>
      </label>
      <input
        ref={inputRef}
        type="password"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") onClose();
        }}
        autoComplete="off"
        spellCheck={false}
        placeholder={`Paste your ${PROVIDER_LABELS[option.provider]} key`}
        className="bg-surface text-on-surface ring-on-surface/10 focus:ring-primary rounded-[var(--radius-xs)] px-2 py-1.5 font-mono text-[0.6875rem] ring-1 focus:ring-2 focus:outline-none"
      />
      <div className="flex items-center justify-between gap-2">
        <a
          href={PROVIDER_KEY_URLS[option.provider]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-on-surface-muted hover:text-primary text-[0.625rem] underline"
        >
          Get a key ↗
        </a>
        <div className="flex items-center gap-1">
          {value && (
            <button
              type="button"
              onClick={clear}
              className="text-error/80 hover:text-error rounded-[var(--radius-xs)] px-2 py-1 text-[0.6875rem] font-medium"
            >
              Remove
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-on-surface-muted hover:text-on-surface rounded-[var(--radius-xs)] px-2 py-1 text-[0.6875rem]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!draft.trim() || draft.trim() === value}
            className="bg-primary text-on-primary rounded-[var(--radius-xs)] px-2.5 py-1 text-[0.6875rem] font-medium disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
