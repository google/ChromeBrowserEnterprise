/**
 * @file Converts MCP tool definitions into AI SDK tool objects.
 *
 * MCP tools are discovered at runtime, so their input types aren't
 * known at build time. We wrap each one with the AI SDK's `dynamicTool`
 * and pass the server's JSON Schema through `jsonSchema()`.
 *
 * The catalog is cached in-process with a short TTL so every chat
 * request doesn't pay a listTools round trip. Cache keys include a
 * hash of the access token; `user_oauth` callers don't share catalogs
 * in case the CEP server's tool visibility diverges by scope.
 */

import { dynamicTool, jsonSchema, type ToolSet } from "ai";
import type { JSONSchema7 } from "@ai-sdk/provider";
import {
  callMcpTool,
  listMcpTools,
  type McpToolDefinition,
  type McpToolResult,
} from "./mcp-client";
import { toAuthError } from "./auth-errors";
import { buildCallerCacheKey } from "./cache-key";
import { LOG_TAGS } from "./constants";
import { getServiceAccountConfig } from "./sa-session";

const TOOL_CATALOG_TTL_MS = 5 * 60 * 1000;

const toolCatalogCache = new Map<string, { tools: McpToolDefinition[]; expiresAt: number }>();

/**
 * Returns the MCP tool catalog, refreshing from the server at most once
 * per TTL window per caller identity.
 */
async function getCachedToolCatalog(
  serverUrl: string,
  accessToken: string | undefined,
): Promise<McpToolDefinition[]> {
  const key = buildCallerCacheKey(serverUrl, accessToken);
  const now = Date.now();
  const cached = toolCatalogCache.get(key);
  if (cached && cached.expiresAt > now) return cached.tools;
  const tools = await listMcpTools(serverUrl, accessToken);
  toolCatalogCache.set(key, { tools, expiresAt: now + TOOL_CATALOG_TTL_MS });
  return tools;
}

/**
 * Drops cached catalogs. With no argument, clears everything. With a
 * serverUrl, drops every per-caller entry for that server (useful when
 * the upstream MCP server restarted with different tool code).
 */
export function invalidateToolCatalog(serverUrl?: string): void {
  if (!serverUrl) {
    toolCatalogCache.clear();
    return;
  }
  const prefix = `${serverUrl}|`;
  for (const key of toolCatalogCache.keys()) {
    if (key.startsWith(prefix)) toolCatalogCache.delete(key);
  }
}

/**
 * Fetches all tools from the MCP server (cached) and wraps each as an AI
 * SDK dynamic tool. The real JSON Schema from the MCP server is forwarded
 * so the model can generate well-formed arguments.
 */
export async function getMcpToolsForAiSdk(
  serverUrl: string,
  accessToken?: string,
  customerId?: string,
): Promise<ToolSet> {
  const mcpTools = await getCachedToolCatalog(serverUrl, accessToken);
  const tools: ToolSet = {};

  for (const t of mcpTools) {
    tools[t.name] = dynamicTool({
      description: t.description,
      inputSchema: jsonSchema(t.inputSchema as JSONSchema7),
      execute: async (args) => {
        console.log(LOG_TAGS.MCP, `Tool: ${t.name}`);
        const callArgs: Record<string, unknown> = { ...(args as Record<string, unknown>) };
        if (customerId && (!callArgs.customerId || callArgs.customerId === "my_customer")) {
          callArgs.customerId = customerId;
        }

        let result = await callMcpTool(serverUrl, t.name, callArgs, accessToken);
        result = shrinkToolResult(result);

        /**
         * Auth-shaped tool errors get promoted to thrown AuthError so the
         * AI SDK reports them as `state: 'output-error'` with the
         * structured payload. Non-auth errors pass through as content so
         * the model can narrate them to the user.
         */
        if (result.isError) {
          const text = extractErrorText(result.content);
          const saConfig = await getServiceAccountConfig();
          const authErr = toAuthError(text, "mcp-tool", {
            impersonatedUser: saConfig?.impersonatedUser,
          });
          if (authErr) throw authErr;
        }

        /**
         * When the MCP server emits `structuredContent` (per the MCP spec),
         * we pass through both the content blocks and the typed payload.
         * The inspector panel renders `output` as a raw dump so having
         * `structuredContent` here makes it visible; the chat tool card
         * prefers the typed object for its JSON tree view and avoids
         * re-rendering the equivalent JSON fence baked into `content`.
         */
        if (result.structuredContent !== undefined) {
          return { content: result.content, structuredContent: result.structuredContent };
        }
        return result.content;
      },
    });
  }

  return tools;
}

/**
 * Pulls the first `type: "text"` block out of an MCP tool result's
 * content array. The MCP server returns errors as text blocks, so this
 * is the only shape we need to classify against.
 */
function extractErrorText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const texts: string[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      "type" in block &&
      block.type === "text" &&
      "text" in block &&
      typeof block.text === "string"
    ) {
      texts.push(block.text);
    }
  }
  return texts.join("\n");
}

/**
 * Returns a formatted summary of available MCP tools and their parameter fields
 * for injection into reference prompts (e.g. follow-up suggestion brainstorming).
 */
export async function getMcpToolsSummary(serverUrl: string, accessToken?: string): Promise<string> {
  const mcpTools = await getCachedToolCatalog(serverUrl, accessToken);
  return mcpTools
    .map((t) => {
      const schema = t.inputSchema as
        | { properties?: Record<string, { description?: string; type?: string }> }
        | undefined;
      const props = schema?.properties;
      const paramsDesc =
        props && Object.keys(props).length > 0
          ? Object.entries(props)
              .map(([k, v]) => `${k} (${v.type || "string"}): ${v.description || ""}`)
              .join("; ")
          : "no parameters";
      return `- ${t.name}: ${t.description || "No description"} [Params: ${paramsDesc}]`;
    })
    .join("\n");
}

/**
 * Recursively traverses a JSON-compatible structure and prunes large sub-structures
 * (primarily arrays) to ensure the total serialized size remains under the specified budget.
 * Small fields and metadata are preserved intact, preventing loss of context.
 */
function pruneJson(data: unknown, maxBytes: number): unknown {
  const jsonStr = JSON.stringify(data);
  if (!jsonStr || jsonStr.length <= maxBytes) {
    return data;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return data;
    if (maxBytes < 256) {
      return ["[truncated]"];
    }
    const avgItemSize = jsonStr.length / data.length;
    const targetLength = Math.max(1, Math.floor(maxBytes / avgItemSize));

    if (targetLength >= data.length) {
      // Individual items are too large to fit in budget, prune the first item recursively.
      return [pruneJson(data[0], maxBytes)];
    }

    const sliced = data.slice(0, targetLength);
    const itemBudget = maxBytes / targetLength;
    return sliced.map((item) => pruneJson(item, itemBudget));
  }

  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) return data;

    const sizes = keys.map((key) => {
      const valStr = JSON.stringify(obj[key]);
      return { key, size: valStr ? valStr.length : 0 };
    });

    const SMALL_FIELD_THRESHOLD = 5 * 1024; // 5 KB
    const smallFields = sizes.filter((s) => s.size < SMALL_FIELD_THRESHOLD);
    const largeFields = sizes.filter((s) => s.size >= SMALL_FIELD_THRESHOLD);

    if (largeFields.length === 0) {
      // If all fields are small but sum exceeds budget, truncate the properties of the object
      const copy: Record<string, unknown> = {};
      let currentSize = 2; // "{}"
      for (const s of sizes) {
        if (currentSize + s.size > maxBytes) {
          copy.truncated = true;
          break;
        }
        copy[s.key] = obj[s.key];
        currentSize += s.size + s.key.length + 4;
      }
      return copy;
    }

    const smallFieldsSize = smallFields.reduce((sum, s) => sum + s.size, 0);
    const remainingBudget = Math.max(1024, maxBytes - smallFieldsSize);
    const budgetPerLargeField = remainingBudget / largeFields.length;

    const copy: Record<string, unknown> = {};
    for (const key of keys) {
      const val = obj[key];
      const isLarge = largeFields.some((lf) => lf.key === key);
      if (isLarge) {
        if (budgetPerLargeField < 256) {
          copy[key] = "[truncated]";
        } else {
          copy[key] = pruneJson(val, budgetPerLargeField);
        }
      } else {
        copy[key] = val;
      }
    }
    return copy;
  }

  return data;
}

/**
 * Post-processes any MCP tool output to prevent it from blowing up the LLM's context window.
 * If the output is too large, it recursively prunes large sub-structures (primarily arrays)
 * while preserving small fields intact. If it remains too large, it falls back to a hard string slice.
 */
function shrinkToolResult(result: McpToolResult): McpToolResult {
  if (!result || typeof result !== "object") return result;

  const cleanResult = { ...result };

  // 1. Estimate size
  let jsonString = "";
  const structuredContent = cleanResult.structuredContent;
  let useContentFallback = false;

  if (structuredContent !== undefined) {
    jsonString = JSON.stringify(structuredContent);
  } else if (Array.isArray(cleanResult.content) && cleanResult.content[1]) {
    const block = cleanResult.content[1];
    if (block && typeof block === "object" && "text" in block && typeof block.text === "string") {
      jsonString = block.text;
      useContentFallback = true;
    }
  }

  const MAX_JSON_SIZE_BYTES = 100 * 1024; // 100 KB safety limit (~25k tokens)
  if (jsonString.length < MAX_JSON_SIZE_BYTES) {
    return cleanResult;
  }

  console.warn(
    LOG_TAGS.MCP,
    `Tool result is too large (${jsonString.length} chars). Applying recursive pruning.`,
  );

  // 2. Apply recursive pruning
  let prunedData: unknown;
  if (useContentFallback) {
    try {
      const rawJson = JSON.parse(jsonString.replace(/```json|```/g, "").trim());
      prunedData = pruneJson(rawJson, MAX_JSON_SIZE_BYTES);
    } catch {
      // If parsing fails, fall back to string slice in step 3
    }
  } else {
    prunedData = pruneJson(structuredContent, MAX_JSON_SIZE_BYTES);
    cleanResult.structuredContent = prunedData;
  }

  // 3. Hard fallback if recursive pruning was bypassed or still too large
  const postPruneJson = JSON.stringify(
    structuredContent !== undefined ? cleanResult.structuredContent : prunedData,
  );

  let isTruncated = false;
  if (!postPruneJson || postPruneJson.length > MAX_JSON_SIZE_BYTES) {
    console.warn(
      LOG_TAGS.MCP,
      `Tool result remains too large after recursive pruning. Applying hard string slice fallback.`,
    );
    const fallbackData = {
      message: "Warning: Data payload was too large and was truncated in LLM context.",
      preview: (postPruneJson || jsonString).slice(0, MAX_JSON_SIZE_BYTES / 2) + "... [truncated]",
    };
    if (structuredContent !== undefined) {
      cleanResult.structuredContent = fallbackData;
    } else {
      prunedData = fallbackData;
    }
    isTruncated = true;
  } else {
    // If the json shrank, it means something was pruned!
    isTruncated = postPruneJson.length < jsonString.length;
  }

  // 4. Update content blocks if pruned
  if (isTruncated) {
    if (Array.isArray(cleanResult.content) && cleanResult.content.length > 0) {
      const firstBlock = cleanResult.content[0];
      if (
        firstBlock &&
        typeof firstBlock === "object" &&
        "type" in firstBlock &&
        firstBlock.type === "text" &&
        "text" in firstBlock &&
        typeof firstBlock.text === "string"
      ) {
        cleanResult.content[0] = {
          type: "text",
          text:
            firstBlock.text +
            `\n\n[Warning: The detailed JSON payload was truncated to fit in the context window. Use filters or narrow down queries to retrieve specific items if needed.]`,
        };
      }

      if (cleanResult.content.length >= 2) {
        const targetJson =
          structuredContent !== undefined ? cleanResult.structuredContent : prunedData;
        cleanResult.content[1] = {
          type: "text",
          text: "```json\n" + JSON.stringify(targetJson, null, 2) + "\n```",
        };
      }
    }
  }

  return cleanResult;
}
