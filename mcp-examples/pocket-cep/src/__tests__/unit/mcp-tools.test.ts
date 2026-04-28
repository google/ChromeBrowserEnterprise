/**
 * @file Unit tests for getMcpToolsForAiSdk's execute wrapper.
 *
 * Verifies that MCP tool calls returning isError:true with an auth-shaped
 * message get re-thrown as AuthError (so the AI SDK surfaces them as
 * output-error) while non-auth errors return their content normally.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockListMcpTools, mockCallMcpTool } = vi.hoisted(() => ({
  mockListMcpTools: vi.fn(),
  mockCallMcpTool: vi.fn(),
}));

vi.mock("@/lib/mcp-client", () => ({
  listMcpTools: mockListMcpTools,
  callMcpTool: mockCallMcpTool,
}));

import { getMcpToolsForAiSdk, invalidateToolCatalog } from "@/lib/mcp-tools";
import { isAuthError, AuthError } from "@/lib/auth-errors";

describe("getMcpToolsForAiSdk tool execute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateToolCatalog();
    mockListMcpTools.mockResolvedValue([
      {
        name: "get_chrome_activity_log",
        description: "d",
        inputSchema: { type: "object", properties: {} },
      },
    ]);
  });

  async function runExecute(result: unknown): Promise<{ thrown: unknown; output: unknown }> {
    mockCallMcpTool.mockResolvedValue(result);
    const tools = await getMcpToolsForAiSdk("http://localhost:4000/mcp", `t-${Math.random()}`);
    const tool = tools["get_chrome_activity_log"] as unknown as {
      execute: (args: Record<string, unknown>) => Promise<unknown>;
    };
    try {
      const output = await tool.execute({});
      return { thrown: null, output };
    } catch (err) {
      return { thrown: err, output: null };
    }
  }

  it("throws AuthError(invalid_rapt) when the tool returns an isError result mentioning invalid_rapt", async () => {
    const { thrown } = await runExecute({
      isError: true,
      content: [
        {
          type: "text",
          text: "API Error: invalid_grant - reauth related error (invalid_rapt)",
        },
      ],
    });
    expect(isAuthError(thrown)).toBe(true);
    expect((thrown as AuthError).code).toBe("invalid_rapt");
    expect((thrown as AuthError).source).toBe("mcp-tool");
  });

  it("throws AuthError(invalid_grant) for a plain invalid_grant tool error", async () => {
    const { thrown } = await runExecute({
      isError: true,
      content: [{ type: "text", text: "API Error: invalid_grant - token expired" }],
    });
    expect(isAuthError(thrown)).toBe(true);
    expect((thrown as AuthError).code).toBe("invalid_grant");
  });

  it("returns content normally for isError:false results", async () => {
    const { thrown, output } = await runExecute({
      isError: false,
      content: [{ type: "text", text: "ok" }],
    });
    expect(thrown).toBeNull();
    expect(output).toEqual([{ type: "text", text: "ok" }]);
  });

  it("returns content for non-auth tool errors (caller renders error text unchanged)", async () => {
    const { thrown, output } = await runExecute({
      isError: true,
      content: [{ type: "text", text: "Rate limited. Try again in 30s." }],
    });
    expect(thrown).toBeNull();
    expect(output).toEqual([{ type: "text", text: "Rate limited. Try again in 30s." }]);
  });
});
