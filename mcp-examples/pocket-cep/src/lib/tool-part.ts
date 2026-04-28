/**
 * @file Shared types and helpers for AI SDK v6 tool-part rendering.
 *
 * In v6, tool parts arrive flat — either `type: 'tool-{name}'` (static,
 * schema known at build time) or `type: 'dynamic-tool'` (runtime tools
 * from the MCP server, which is what we use). Either way, `toolCallId`,
 * `state`, `input`, and `output` are top-level — there is no
 * `toolInvocation` wrapper like there was in v4.
 */

import type { ToolUIPart, DynamicToolUIPart } from "ai";

/**
 * The union of AI SDK v6 tool-part shapes we render — covers both the
 * static schema case and the MCP dynamic-tool case.
 */
export type InvocationPart = ToolUIPart | DynamicToolUIPart;

/**
 * Collapses the AI SDK's v6 state machine into a three-way display label.
 * Any pre-output state (input-streaming, input-available, approval-*)
 * counts as "running" from the user's perspective.
 */
export function toolPartLabel(state: InvocationPart["state"]): "DONE" | "ERROR" | "RUNNING" {
  if (state === "output-available") return "DONE";
  if (state === "output-error") return "ERROR";
  return "RUNNING";
}
