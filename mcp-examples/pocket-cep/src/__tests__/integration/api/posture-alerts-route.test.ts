/**
 * @file Integration tests for POST /api/insights/posture-alerts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockRequireSession,
  mockGetGoogleAccessToken,
  mockGetEnv,
  mockCallMcpTool,
  mockGetActiveCustomerId,
} = vi.hoisted(() => ({
  mockRequireSession: vi.fn(),
  mockGetGoogleAccessToken: vi.fn(),
  mockGetEnv: vi.fn(),
  mockCallMcpTool: vi.fn(),
  mockGetActiveCustomerId: vi.fn(),
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

vi.mock("@/lib/sa-session", () => ({
  getActiveCustomerId: mockGetActiveCustomerId,
}));

vi.mock("@/lib/mcp-client", () => ({
  callMcpTool: mockCallMcpTool,
}));

import { POST } from "@/app/api/insights/posture-alerts/route";
import { clearCache } from "@/lib/server-cache";

function makeRequest(body: Record<string, unknown> = {}): Request {
  return new Request("http://localhost/api/insights/posture-alerts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/insights/posture-alerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCache();
    mockRequireSession.mockResolvedValue(true);
    mockGetGoogleAccessToken.mockResolvedValue("mock-token");
    mockGetActiveCustomerId.mockResolvedValue("C012345");
    mockGetEnv.mockReturnValue({ MCP_SERVER_URL: "http://localhost:4000/mcp" });
  });

  it("returns 401 when unauthenticated", async () => {
    mockRequireSession.mockResolvedValue(false);
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns posture alerts from environment diagnostics on success", async () => {
    mockCallMcpTool.mockImplementation(async (_url, toolName) => {
      if (toolName === "diagnose_environment") {
        return {
          isError: false,
          content: "Success",
          structuredContent: {
            issues: [
              {
                severity: "high",
                component: "dlpRules",
                message:
                  "No DLP rules configured. Create rules at: https://admin.google.com/ac/dp/rules",
                remediation: {
                  actionLabel: "Create DLP rules",
                  url: "https://admin.google.com/ac/dp/rules",
                },
              },
            ],
          },
        };
      }
      throw new Error(`Unexpected tool call: ${toolName}`);
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.alerts).toHaveLength(1);
    expect(body.alerts[0]).toEqual({
      id: "dlpRules:No_DLP_rules_configured.",
      severity: "high",
      component: "dlpRules",
      message: "No DLP rules configured.",
      suggestedQuery:
        'The PocketCEP dashboard shows: "No DLP rules configured."\n\nCan you tell me about this?',
      remediation: {
        url: "https://admin.google.com/ac/dp/rules",
        label: "See in UI",
      },
    });
  });

  it("returns 401 when diagnose_environment returns invalid_grant tool error", async () => {
    mockCallMcpTool.mockResolvedValue({
      isError: true,
      content: [{ type: "text", text: "API Error: invalid_grant - token expired" }],
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_grant");
    expect(body.error.source).toBe("mcp-tool");
  });
});
