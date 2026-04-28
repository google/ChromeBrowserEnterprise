/**
 * @file Active-flavor indicator + model picker for the top bar.
 *
 * The auth mode is static information — showing it as a bulky pill
 * alongside the interactive model picker created pill-soup with no
 * hierarchy. This component now renders the auth mode as a quiet
 * status indicator (small dot + muted label) that hover-reveals a
 * tooltip explaining what the flavor means, then a thin divider,
 * then the model picker as the clear primary control on the right.
 */

import { useState } from "react";
import { useMode, type ModeInfo } from "./mode-provider";
import { ModelSelector } from "./model-selector";

type FlavorCopy = {
  label: string;
  tooltip: string;
  dotClass: string;
};

function authFlavor(mode: ModeInfo["authMode"]): FlavorCopy {
  if (mode === "service_account") {
    return {
      label: "Service account",
      tooltip:
        "ADC authenticates server-side. No user sign-in; every request uses the same Google credentials.",
      dotClass: "bg-success",
    };
  }
  return {
    label: "User OAuth",
    tooltip:
      "Signed-in user's Google token is forwarded to the MCP server. Each caller acts as themselves.",
    dotClass: "bg-primary",
  };
}

/**
 * Composes the auth-mode indicator, a divider, and the model picker.
 * Intentionally grouped in one component so the three elements keep a
 * consistent gap and divider height as the bar evolves.
 */
export function ModeBadges() {
  const mode = useMode();
  const flavor = authFlavor(mode.authMode);

  return (
    <div className="flex items-center gap-3 max-sm:hidden" aria-label="Active flavor">
      <FlavorIndicator flavor={flavor} />
      <span className="bg-on-surface/10 h-4 w-px shrink-0" aria-hidden="true" />
      <ModelSelector />
    </div>
  );
}

function FlavorIndicator({ flavor }: { flavor: FlavorCopy }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative max-md:hidden">
      <button
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        aria-describedby={`flavor-tooltip-${flavor.label}`}
        className="text-on-surface-muted hover:text-on-surface inline-flex items-center gap-2 text-xs"
      >
        <span
          className="relative inline-flex size-2.5 shrink-0 items-center justify-center"
          aria-hidden="true"
        >
          <span className={`${flavor.dotClass} absolute inset-0 rounded-full opacity-25`} />
          <span className={`${flavor.dotClass} size-1.5 rounded-full`} />
        </span>
        <span className="font-medium">{flavor.label}</span>
      </button>
      {show && (
        <span
          id={`flavor-tooltip-${flavor.label}`}
          role="tooltip"
          className="bg-on-surface text-surface ring-on-surface/10 pointer-events-none absolute top-full left-1/2 z-30 mt-1.5 w-64 -translate-x-1/2 rounded-[var(--radius-xs)] px-2 py-1.5 text-[0.6875rem] leading-4 shadow-[var(--shadow-elevation-2)] ring-1"
        >
          {flavor.tooltip}
        </span>
      )}
    </span>
  );
}
