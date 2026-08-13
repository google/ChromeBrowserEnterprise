/**
 * @file Integration tests for MCP Registry endpoints (/api/tools and /api/prompts).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockRequireSession,
  mockGetGoogleAccessToken,
  mockGetEnv,
  mockListMcpTools,
  mockListMcpPrompts,
  mockGetMcpPrompt,
} = vi.hoisted(() => ({
  mockRequireSession: vi.fn(),
  mockGetGoogleAccessToken: vi.fn(),
  mockGetEnv: vi.fn(),
  mockListMcpTools: vi.fn(),
  mockListMcpPrompts: vi.fn(),
  mockGetMcpPrompt: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireSession: mockRequireSession,
}));

vi.mock("@/lib/access-token", () => ({
  getGoogleAccessToken: mockGetGoogleAccessToken,
}));

vi.mock("@/lib/env", () => ({
  getEnv: mockGetEnv,
}));

vi.mock("@/lib/mcp-client", () => ({
  listMcpTools: mockListMcpTools,
  listMcpPrompts: mockListMcpPrompts,
  getMcpPrompt: mockGetMcpPrompt,
}));

import { GET as getTools } from "@/app/api/tools/route";
import { GET as getPrompts, POST as postPrompts } from "@/app/api/prompts/route";
import { clearCache } from "@/lib/server-cache";

describe("MCP Registry Endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCache();
    mockRequireSession.mockResolvedValue(true);
    mockGetGoogleAccessToken.mockResolvedValue("mock-token");
    mockGetEnv.mockReturnValue({ MCP_SERVER_URL: "http://localhost:4000/mcp" });
  });

  describe("GET /api/tools", () => {
    it("returns 401 when unauthenticated", async () => {
      mockRequireSession.mockResolvedValue(false);
      const res = await getTools();
      expect(res.status).toBe(401);
    });

    it("returns list of tools on success", async () => {
      const mockTools = [
        {
          name: "test_tool",
          description: "A test tool",
          inputSchema: { type: "object", properties: {} },
        },
      ];
      mockListMcpTools.mockResolvedValue(mockTools);

      const res = await getTools();
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toEqual({ tools: mockTools });
      expect(mockListMcpTools).toHaveBeenCalledWith("http://localhost:4000/mcp", "mock-token");
    });
  });

  describe("GET /api/prompts", () => {
    it("returns 401 when unauthenticated", async () => {
      mockRequireSession.mockResolvedValue(false);
      const res = await getPrompts();
      expect(res.status).toBe(401);
    });

    it("returns list of prompts on success", async () => {
      const mockPrompts = [
        {
          name: "test_prompt",
          description: "A test prompt",
          arguments: [],
        },
      ];
      mockListMcpPrompts.mockResolvedValue(mockPrompts);

      const res = await getPrompts();
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toEqual({ prompts: mockPrompts });
      expect(mockListMcpPrompts).toHaveBeenCalledWith("http://localhost:4000/mcp", "mock-token");
    });
  });

  describe("POST /api/prompts", () => {
    it("returns 401 when unauthenticated", async () => {
      mockRequireSession.mockResolvedValue(false);
      const req = new Request("http://localhost/api/prompts", {
        method: "POST",
        body: JSON.stringify({ name: "test_prompt" }),
      });
      const res = await postPrompts(req);
      expect(res.status).toBe(401);
    });

    it("returns bad request when name is missing", async () => {
      const req = new Request("http://localhost/api/prompts", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const res = await postPrompts(req);
      expect(res.status).toBe(400);
    });

    it("expands prompt messages on success", async () => {
      const mockExpandedMessages = [
        {
          role: "user",
          content: { type: "text", text: "Expanded prompt text content" },
        },
      ];
      mockGetMcpPrompt.mockResolvedValue(mockExpandedMessages);

      const req = new Request("http://localhost/api/prompts", {
        method: "POST",
        body: JSON.stringify({ name: "test_prompt", args: { param: "value" } }),
      });
      const res = await postPrompts(req);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toEqual({ text: "Expanded prompt text content" });
      expect(mockGetMcpPrompt).toHaveBeenCalledWith(
        "http://localhost:4000/mcp",
        "test_prompt",
        { param: "value" },
        "mock-token",
      );
    });
  });
});
