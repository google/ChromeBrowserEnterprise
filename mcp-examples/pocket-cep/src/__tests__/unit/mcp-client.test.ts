/**
 * @file Unit tests for the MCP client wrapper.
 *
 * Mocks the MCP SDK's Client and StreamableHTTPClientTransport to verify
 * that our wrapper correctly: sends tool calls, injects Bearer tokens,
 * captures raw protocol data for the inspector, and cleans up connections.
 *
 * The MCP client is the bridge between Pocket CEP and the Chrome Enterprise
 * Premium server. These tests ensure that bridge works without needing a
 * running server.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockGetActiveCustomerId } = vi.hoisted(() => ({
  mockGetActiveCustomerId: vi.fn(),
}));

vi.mock("@/lib/sa-session", () => ({
  getActiveCustomerId: mockGetActiveCustomerId,
}));

const mockCallTool = vi.fn();
const mockListTools = vi.fn();
const mockGetPrompt = vi.fn();
const mockConnect = vi.fn();
const mockClientClose = vi.fn();
const mockTransportClose = vi.fn();

// Mock the MCP SDK before importing our module.
// Use regular functions (not arrows) so they work with `new`.
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn(function Client() {
    return {
      connect: mockConnect,
      callTool: mockCallTool,
      listTools: mockListTools,
      getPrompt: mockGetPrompt,
      close: mockClientClose,
    };
  }),
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: vi.fn(function Transport() {
    return { close: mockTransportClose };
  }),
}));

// Import after mocks are set up.
import { callMcpTool, listMcpTools, getMcpPrompt } from "@/lib/mcp-client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

describe("callMcpTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallTool.mockResolvedValue({
      content: [{ type: "text", text: "Tool result" }],
      isError: false,
    });
  });

  it("calls the correct tool with the provided arguments", async () => {
    await callMcpTool("http://localhost:3000/mcp", "get_customer_id", { key: "value" });

    expect(mockCallTool).toHaveBeenCalledWith({
      name: "get_customer_id",
      arguments: { key: "value" },
    });
  });

  it("includes Bearer token in transport headers when accessToken is provided", async () => {
    await callMcpTool("http://localhost:3000/mcp", "get_customer_id", {}, "my-google-token");

    // The transport constructor should have been called with headers.
    const transportCall = vi.mocked(StreamableHTTPClientTransport).mock.calls[0];
    const options = transportCall[1] as { requestInit: { headers: Record<string, string> } };
    expect(options.requestInit.headers["Authorization"]).toBe("Bearer my-google-token");
  });

  it("omits Authorization header when no accessToken is provided", async () => {
    await callMcpTool("http://localhost:3000/mcp", "get_customer_id", {});

    const transportCall = vi.mocked(StreamableHTTPClientTransport).mock.calls[0];
    const options = transportCall[1] as { requestInit: { headers: Record<string, string> } };
    expect(options.requestInit.headers["Authorization"]).toBeUndefined();
  });

  it("captures rawRequest and rawResponse for the inspector panel", async () => {
    const result = await callMcpTool("http://localhost:3000/mcp", "list_dlp_rules", {
      filter: "active",
    });

    expect(result.rawRequest).toEqual({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "list_dlp_rules", arguments: { filter: "active" } },
    });

    expect(result.rawResponse.jsonrpc).toBe("2.0");
    expect(result.rawResponse.result).toBeDefined();
  });

  it("closes the client even when the tool call fails", async () => {
    mockCallTool.mockRejectedValue(new Error("Network error"));

    await expect(callMcpTool("http://localhost:3000/mcp", "broken_tool", {})).rejects.toThrow(
      "Network error",
    );

    expect(mockClientClose).toHaveBeenCalled();
  });

  describe("service_account mode gating", () => {
    const originalAuthMode = process.env.AUTH_MODE;

    beforeEach(() => {
      process.env.AUTH_MODE = "service_account";
      mockGetActiveCustomerId.mockResolvedValue("C0111111");
    });

    afterEach(() => {
      process.env.AUTH_MODE = originalAuthMode;
    });

    it("overwrites the customerId tool argument with the session customerId", async () => {
      await callMcpTool("http://localhost:3000/mcp", "list_dlp_rules", {
        customerId: "ATTACKER-TENANT-ID",
        filter: "active",
      });

      expect(mockCallTool).toHaveBeenCalledWith({
        name: "list_dlp_rules",
        arguments: {
          customerId: "C0111111",
          filter: "active",
        },
      });
    });

    it("injects the customerId if it is missing", async () => {
      await callMcpTool("http://localhost:3000/mcp", "list_dlp_rules", {
        filter: "active",
      });

      expect(mockCallTool).toHaveBeenCalledWith({
        name: "list_dlp_rules",
        arguments: {
          customerId: "C0111111",
          filter: "active",
        },
      });
    });

    it("deletes user-supplied customerId if session has no active customerId", async () => {
      mockGetActiveCustomerId.mockResolvedValue(undefined);

      await callMcpTool("http://localhost:3000/mcp", "list_dlp_rules", {
        customerId: "ATTACKER-TENANT-ID",
        filter: "active",
      });

      expect(mockCallTool).toHaveBeenCalledWith({
        name: "list_dlp_rules",
        arguments: {
          filter: "active",
        },
      });
    });

    it("throws if getActiveCustomerId throws an error", async () => {
      mockGetActiveCustomerId.mockRejectedValue(new Error("Decryption failed"));

      await expect(
        callMcpTool("http://localhost:3000/mcp", "list_dlp_rules", {
          customerId: "ATTACKER-TENANT-ID",
        }),
      ).rejects.toThrow("Failed to resolve active customer ID for scope gating: Decryption failed");
    });
  });
});

describe("listMcpTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListTools.mockResolvedValue({
      tools: [
        {
          name: "get_chrome_activity_log",
          description: "Gets activity logs",
          inputSchema: { type: "object", properties: { userKey: { type: "string" } } },
        },
        {
          name: "diagnose_environment",
          description: "Health check",
        },
      ],
    });
  });

  it("returns normalized tool definitions", async () => {
    const tools = await listMcpTools("http://localhost:3000/mcp");

    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe("get_chrome_activity_log");
    expect(tools[0].description).toBe("Gets activity logs");
  });

  it("provides a default inputSchema when the server omits it", async () => {
    const tools = await listMcpTools("http://localhost:3000/mcp");

    // The second tool had no inputSchema — should get a default.
    expect(tools[1].inputSchema).toEqual({ type: "object", properties: {} });
  });
});

describe("getMcpPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPrompt.mockResolvedValue({
      messages: [{ role: "user", content: { type: "text", text: "Prompt expanded text" } }],
    });
  });

  it("calls the correct prompt with arguments", async () => {
    const res = await getMcpPrompt("http://localhost:3000/mcp", "cep:health", { foo: "bar" });
    expect(mockGetPrompt).toHaveBeenCalledWith({
      name: "cep:health",
      arguments: { foo: "bar" },
    });
    expect(res).toHaveLength(1);
    expect(res[0].content.type).toBe("text");
    expect((res[0].content as { text: string }).text).toBe("Prompt expanded text");
  });

  describe("service_account mode gating", () => {
    const originalAuthMode = process.env.AUTH_MODE;

    beforeEach(() => {
      process.env.AUTH_MODE = "service_account";
      mockGetActiveCustomerId.mockResolvedValue("C0111111");
    });

    afterEach(() => {
      process.env.AUTH_MODE = originalAuthMode;
    });

    it("overwrites the customerId prompt argument with the session customerId", async () => {
      await getMcpPrompt("http://localhost:3000/mcp", "cep:health", {
        customerId: "ATTACKER-TENANT-ID",
        foo: "bar",
      });

      expect(mockGetPrompt).toHaveBeenCalledWith({
        name: "cep:health",
        arguments: {
          customerId: "C0111111",
          foo: "bar",
        },
      });
    });

    it("injects the customerId if it is missing", async () => {
      await getMcpPrompt("http://localhost:3000/mcp", "cep:health", {
        foo: "bar",
      });

      expect(mockGetPrompt).toHaveBeenCalledWith({
        name: "cep:health",
        arguments: {
          customerId: "C0111111",
          foo: "bar",
        },
      });
    });

    it("handles undefined args gracefully", async () => {
      await getMcpPrompt("http://localhost:3000/mcp", "cep:health", undefined);

      expect(mockGetPrompt).toHaveBeenCalledWith({
        name: "cep:health",
        arguments: {
          customerId: "C0111111",
        },
      });
    });

    it("deletes user-supplied customerId if session has no active customerId", async () => {
      mockGetActiveCustomerId.mockResolvedValue(undefined);

      await getMcpPrompt("http://localhost:3000/mcp", "cep:health", {
        customerId: "ATTACKER-TENANT-ID",
        foo: "bar",
      });

      expect(mockGetPrompt).toHaveBeenCalledWith({
        name: "cep:health",
        arguments: {
          foo: "bar",
        },
      });
    });

    it("throws if getActiveCustomerId throws an error", async () => {
      mockGetActiveCustomerId.mockRejectedValue(new Error("Decryption failed"));

      await expect(
        getMcpPrompt("http://localhost:3000/mcp", "cep:health", {
          customerId: "ATTACKER-TENANT-ID",
        }),
      ).rejects.toThrow("Failed to resolve active customer ID for scope gating: Decryption failed");
    });
  });
});
