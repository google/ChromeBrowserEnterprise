/**
 * @file Lightweight recursive JSON tree viewer.
 *
 * Renders any JSON-compatible value as a nested disclosure tree:
 *
 * - Primitives (`string`, `number`, `boolean`, `null`) inline with
 *   type-appropriate color.
 * - Arrays and objects as collapsible nodes with a summary chip
 *   ("3 items" / "5 keys") so the user can scan structure without
 *   expanding everything.
 * - Each level has a left rule so depth stays readable.
 *
 * Written in-house rather than pulling in `react-json-view` or similar
 * because the dependency would be ~5× the size of this file and we
 * want the educational POC to own its rendering.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

type JsonTreeProps = {
  /** Any JSON-serialisable value. */
  value: unknown;
  /** Whether the root node starts expanded. Defaults to `true`. */
  defaultOpen?: boolean;
};

/**
 * Entry point component. Top-level key is implicit; the root node
 * renders without a label.
 */
export function JsonTree({ value, defaultOpen = true }: JsonTreeProps) {
  return (
    <div className="font-mono text-[0.6875rem] leading-5">
      <Node value={value} depth={0} defaultOpen={defaultOpen} />
    </div>
  );
}

type NodeProps = {
  label?: string | number;
  value: unknown;
  depth: number;
  defaultOpen?: boolean;
  isLast?: boolean;
};

function Node({ label, value, depth, defaultOpen = false }: NodeProps) {
  if (isPrimitive(value)) {
    return (
      <div className="flex items-start gap-1.5">
        {label !== undefined && <KeyLabel label={label} />}
        <PrimitiveValue value={value} />
      </div>
    );
  }

  if (Array.isArray(value)) {
    return (
      <Collapsible
        label={label}
        summary={`${value.length} item${value.length === 1 ? "" : "s"}`}
        brackets={["[", "]"]}
        defaultOpen={defaultOpen && depth === 0}
        empty={value.length === 0}
      >
        {value.map((item, i) => (
          <Node key={i} label={i} value={item} depth={depth + 1} />
        ))}
      </Collapsible>
    );
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    return (
      <Collapsible
        label={label}
        summary={`${entries.length} key${entries.length === 1 ? "" : "s"}`}
        brackets={["{", "}"]}
        defaultOpen={defaultOpen && depth === 0}
        empty={entries.length === 0}
      >
        {entries.map(([k, v]) => (
          <Node key={k} label={k} value={v} depth={depth + 1} />
        ))}
      </Collapsible>
    );
  }

  // Fallback (undefined, functions, symbols) — shouldn't occur in JSON.
  return (
    <div className="flex items-start gap-1.5">
      {label !== undefined && <KeyLabel label={label} />}
      <span className="text-on-surface-muted">{String(value)}</span>
    </div>
  );
}

type CollapsibleProps = {
  label?: string | number;
  summary: string;
  brackets: [string, string];
  defaultOpen: boolean;
  empty: boolean;
  children: React.ReactNode;
};

function Collapsible({ label, summary, brackets, defaultOpen, empty, children }: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);

  if (empty) {
    return (
      <div className="flex items-start gap-1.5">
        {label !== undefined && <KeyLabel label={label} />}
        <span className="text-on-surface-muted">
          {brackets[0]}
          {brackets[1]}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="hover:bg-surface-dim -mx-1 flex items-start gap-1 rounded-[var(--radius-xs)] px-1 py-0.5 text-left"
      >
        {open ? (
          <ChevronDown
            className="text-on-surface-muted mt-0.5 size-3 shrink-0"
            aria-hidden="true"
          />
        ) : (
          <ChevronRight
            className="text-on-surface-muted mt-0.5 size-3 shrink-0"
            aria-hidden="true"
          />
        )}
        {label !== undefined && <KeyLabel label={label} />}
        <span className="text-on-surface-muted">
          {brackets[0]}
          {!open && <span className="text-on-surface-muted/70 ml-1 italic">{summary}</span>}
          {!open && brackets[1]}
        </span>
      </button>
      {open && (
        <div className="border-on-surface/10 ml-1.5 flex flex-col gap-0.5 border-l py-0.5 pl-3">
          {children}
        </div>
      )}
      {open && <div className="text-on-surface-muted pl-4 leading-3">{brackets[1]}</div>}
    </div>
  );
}

function KeyLabel({ label }: { label: string | number }) {
  return (
    <span
      className={cn(
        "shrink-0",
        typeof label === "number" ? "text-on-surface-muted" : "text-on-surface",
      )}
    >
      {typeof label === "number" ? label : `"${label}"`}
      <span className="text-on-surface-muted">:</span>
    </span>
  );
}

function PrimitiveValue({ value }: { value: unknown }) {
  if (value === null) {
    return <span className="text-on-surface-muted italic">null</span>;
  }
  if (typeof value === "boolean") {
    return <span className="text-primary">{String(value)}</span>;
  }
  if (typeof value === "number") {
    return <span className="text-primary tabular-nums">{value}</span>;
  }
  if (typeof value === "string") {
    return <span className="text-on-surface break-all">&quot;{value}&quot;</span>;
  }
  return <span className="text-on-surface-muted">{String(value)}</span>;
}

function isPrimitive(v: unknown): v is string | number | boolean | null {
  return v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    !!v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype
  );
}
