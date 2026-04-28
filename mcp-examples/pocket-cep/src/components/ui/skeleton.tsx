/**
 * @file Animated loading placeholder.
 *
 * Renders a pulsing gray rectangle that indicates content is loading.
 * Use multiple Skeleton elements to approximate the shape of the
 * content that will eventually appear (e.g., 3 text lines for a
 * user list, 2 lines for a chat message).
 */

import { cn } from "@/lib/cn";

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("bg-surface-variant/50 animate-pulse rounded-[var(--radius-xs)]", className)}
      {...props}
    />
  );
}
