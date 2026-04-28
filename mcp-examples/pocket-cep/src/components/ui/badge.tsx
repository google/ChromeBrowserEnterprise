/**
 * @file Small status indicator.
 *
 * Renders a compact pill with text, used for event counts,
 * status labels, and category indicators.
 */

import { cn } from "@/lib/cn";

type BadgeProps = React.ComponentProps<"span"> & {
  variant?: "default" | "primary" | "muted";
};

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0.5 text-[0.625rem] font-medium tabular-nums",
        variant === "default" && "bg-surface-container text-on-surface-variant",
        variant === "primary" && "bg-primary-light text-primary",
        variant === "muted" && "bg-surface-variant text-on-surface-muted",
        className,
      )}
      {...props}
    />
  );
}
