/**
 * @file MCP client wrapper for the CEP MCP server over HTTP.
 *
 * Uses `StreamableHTTPClientTransport` from the official MCP SDK to
 * send JSON-RPC 2.0 requests to `POST /mcp`. Each function opens a
 * fresh connection, runs its operation, and closes it — matching the
 * upstream server's stateless mode (`sessionIdGenerator: undefined`).
 *
 * In `user_oauth` mode, the user's Google access token is injected as
 * a Bearer header so the MCP server forwards it to Google APIs.
 *
 * Extension point: to add retry or connection pooling, wrap `callMcpTool`.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Prompt, PromptMessage } from "@modelcontextprotocol/sdk/types.js";
import { LOG_TAGS } from "./constants";
import { getErrorMessage } from "./errors";

export type { Prompt, PromptMessage };

/**
 * Result from an MCP tool call, containing both the structured content
 * and the raw JSON-RPC request/response for the inspector panel.
 *
 * The raw fields are reconstructed approximations of the JSON-RPC wire
 * format — the SDK doesn't expose the literal bytes. They're accurate
 * enough for the educational inspector panel.
 */
export type McpToolResult = {
  content: unknown;
  /**
   * Machine-readable structured payload when the MCP server emits one
   * (MCP spec's `structuredContent`, used by cmcp's `formatToolResponse`
   * helper). Forwarded for the inspector / UI to render typed data
   * without re-parsing the text-fence JSON.
   */
  structuredContent?: unknown;
  isError: boolean;
  /** The raw JSON-RPC request we sent (for educational display). */
  rawRequest: Record<string, unknown>;
  /** The raw JSON-RPC response we received (for educational display). */
  rawResponse: Record<string, unknown>;
};

/**
 * An MCP tool definition as returned by the server's listTools endpoint.
 * The inputSchema is a JSON Schema object describing the tool's parameters.
 */
export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

/**
 * Creates a connected MCP client pointed at the given server URL.
 * Injects the Bearer token if provided (user_oauth mode).
 *
 * The connect/close-per-call pattern is intentional: the upstream CEP MCP
 * server is configured stateless (no session ID), so there's no benefit
 * to keeping connections open and it avoids stale-connection bugs.
 */
async function connect(
  serverUrl: string,
  accessToken?: string,
): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const headers: Record<string, string> = {};

  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }

  const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
    requestInit: { headers },
  });

  const client = new Client({ name: "pocket-cep", version: "1.0.0" });

  try {
    await client.connect(transport);
  } catch (error) {
    await transport.close().catch(() => {});
    const msg = getErrorMessage(error);

    /**
     * Translate low-level network errors into actionable messages.
     * ECONNREFUSED is the most common first-run issue — the developer
     * forgot to start the MCP server alongside the Next.js dev server.
     */
    if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED")) {
      throw new Error(
        `Cannot connect to MCP server at ${serverUrl}. ` +
          "Is it running? Start it with: npm run dev:full " +
          "(or: GCP_STDIO=false PORT=4000 npx -y --prefer-online --registry=https://registry.npmjs.org/ @google/chrome-enterprise-premium-mcp)",
      );
    }

    throw new Error(`MCP connection failed: ${msg}`);
  }

  return { client, transport };
}

/**
 * Calls a single MCP tool on the remote server and returns the result
 * along with raw protocol data for the inspector panel.
 *
 * Creates a fresh connection per call (stateless). This matches how the
 * upstream server handles requests — no session persistence.
 */
export async function callMcpTool(
  serverUrl: string,
  toolName: string,
  args: Record<string, unknown>,
  accessToken?: string,
): Promise<McpToolResult> {
  /**
   * We construct the raw request object before calling the SDK so we can
   * return it for the inspector panel. This mirrors what the SDK sends
   * on the wire (JSON-RPC 2.0 tools/call method).
   */
  const rawRequest = {
    jsonrpc: "2.0",
    method: "tools/call",
    params: { name: toolName, arguments: args },
  };

  console.log(LOG_TAGS.MCP, `Calling tool: ${toolName}`, JSON.stringify(args));

  const { client } = await connect(serverUrl, accessToken);

  try {
    const result = await client.callTool({ name: toolName, arguments: args });

    const rawResponse = {
      jsonrpc: "2.0",
      result: {
        content: result.content,
        structuredContent: result.structuredContent,
        isError: result.isError ?? false,
      },
    };

    console.log(LOG_TAGS.MCP, `Tool ${toolName} completed. isError: ${result.isError ?? false}`);

    return {
      content: result.content,
      structuredContent: result.structuredContent,
      isError: Boolean(result.isError),
      rawRequest,
      rawResponse,
    };
  } finally {
    await client.close();
  }
}

/**
 * Lists all tools available on the MCP server, used to populate the
 * LLM's tool definitions. Callers are expected to cache the result
 * (see `getCachedToolCatalog` in `mcp-tools.ts`).
 */
export async function listMcpTools(
  serverUrl: string,
  accessToken?: string,
): Promise<McpToolDefinition[]> {
  console.log(LOG_TAGS.MCP, "Listing available tools...");

  const { client } = await connect(serverUrl, accessToken);

  try {
    const result = await client.listTools();

    console.log(LOG_TAGS.MCP, `Found ${result.tools.length} tools`);

    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {
        type: "object",
        properties: {},
      },
    }));
  } finally {
    await client.close();
  }
}

/**
 * Lists prompts the MCP server exposes (e.g. `cep:health`). Prompts are
 * server-authored conversation starters; using them means the host
 * inherits the server's tone, structure, and formatting contracts.
 */
export async function listMcpPrompts(serverUrl: string, accessToken?: string): Promise<Prompt[]> {
  console.log(LOG_TAGS.MCP, "Listing available prompts...");

  const { client } = await connect(serverUrl, accessToken);

  try {
    const result = await client.listPrompts();
    console.log(LOG_TAGS.MCP, `Found ${result.prompts.length} prompts`);
    return result.prompts;
  } finally {
    await client.close();
  }
}

/**
 * Expands a server prompt into concrete messages. Arguments are passed
 * through as-is; the server performs any substitution and returns the
 * final `PromptMessage[]` for the host to splice into the chat.
 */
export async function getMcpPrompt(
  serverUrl: string,
  name: string,
  args: Record<string, string> | undefined,
  accessToken?: string,
): Promise<PromptMessage[]> {
  console.log(LOG_TAGS.MCP, `Expanding prompt: ${name}`);

  const { client } = await connect(serverUrl, accessToken);

  try {
    const result = await client.getPrompt({ name, arguments: args });
    return result.messages;
  } finally {
    await client.close();
  }
}
