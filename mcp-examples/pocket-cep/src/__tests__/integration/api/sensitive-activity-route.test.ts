/**
 * @file Integration tests for GET /api/insights/sensitive-activity.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockRequireSession,
  mockGetGoogleAccessToken,
  mockGetEnv,
  mockGetActiveCustomerId,
  mockFetchRawActivity,
} = vi.hoisted(() => ({
  mockRequireSession: vi.fn(),
  mockGetGoogleAccessToken: vi.fn(),
  mockGetEnv: vi.fn(),
  mockGetActiveCustomerId: vi.fn(),
  mockFetchRawActivity: vi.fn(),
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
  getServiceAccountConfig: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/activity-data", () => ({
  fetchRawActivity: mockFetchRawActivity,
  parseActivityDays: (raw: string | null) => (raw ? Number.parseInt(raw, 10) : 7),
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/insights/sensitive-activity/route";
import { clearCache } from "@/lib/server-cache";
import type { ChromeAuditEvent } from "@/lib/activity-summarizer";

function makeRequest(queryString = ""): NextRequest {
  return new NextRequest(`http://localhost/api/insights/sensitive-activity${queryString}`);
}

describe("GET /api/insights/sensitive-activity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCache();
    mockRequireSession.mockResolvedValue(true);
    mockGetGoogleAccessToken.mockResolvedValue("mock-token");
    mockGetActiveCustomerId.mockResolvedValue("C012345");
    mockGetEnv.mockReturnValue({
      MCP_SERVER_URL: "http://localhost:4000/mcp",
      AUTH_MODE: "user_oauth",
    });
  });

  it("returns 401 when unauthenticated", async () => {
    mockRequireSession.mockResolvedValue(false);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns empty points with zero counts when no events exist", async () => {
    mockFetchRawActivity.mockResolvedValue([]);

    const res = await GET(makeRequest("?days=3"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.chartData).toHaveLength(3);
    // All days should have zero counts
    for (const point of body.chartData) {
      expect(point.dlpCount).toBe(0);
      expect(point.threatCount).toBe(0);
    }
  });

  it("correctly groups and tallies sensitive events by date", async () => {
    const today = new Date();
    const yesterday = new Date(Date.now() - 86_400_000);

    const mockEvents: ChromeAuditEvent[] = [
      // SSN DLP Rule Violation (blocked) -> DLP
      {
        id: { time: today.toISOString() },
        actor: { email: "dylan@google.com" },
        eventName: "DLP_RULE_VIOLATION",
        parameters: [
          { name: "RULE_NAME", value: "SSN Protection" },
          { name: "ACTION", value: "BLOCK" },
        ],
      },
      // Malware Block -> Threat
      {
        id: { time: today.toISOString() },
        actor: { email: "dylan@google.com" },
        eventName: "UNSAFE_SITE_VISIT",
        parameters: [
          { name: "URL", value: "https://badsite.com" },
          { name: "ACTION", value: "BLOCK" },
        ],
      },
      // SSN DLP Rule Warning yesterday -> DLP
      {
        id: { time: yesterday.toISOString() },
        actor: { email: "dylan@google.com" },
        eventName: "DLP_RULE_VIOLATION",
        parameters: [
          { name: "RULE_NAME", value: "SSN Protection" },
          { name: "ACTION", value: "WARN" },
        ],
      },
      // Audited download yesterday -> Threat (AUDITED_DOWNLOAD)
      {
        id: { time: yesterday.toISOString() },
        actor: { email: "dylan@google.com" },
        eventName: "DANGEROUS_DOWNLOAD",
        parameters: [
          { name: "URL", value: "https://dangerous.com/file.zip" },
          { name: "ACTION", value: "ALLOW" },
        ],
      },
    ];

    mockFetchRawActivity.mockResolvedValue(mockEvents);

    const res = await GET(makeRequest("?days=2"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.chartData).toHaveLength(2);

    // Yesterday point (index 0)
    const yesterdayPoint = body.chartData[0];
    expect(yesterdayPoint.dlpCount).toBe(1);
    expect(yesterdayPoint.threatCount).toBe(1);

    // Today point (index 1)
    const todayPoint = body.chartData[1];
    expect(todayPoint.dlpCount).toBe(1);
    expect(todayPoint.threatCount).toBe(1);
  });

  it("filters by selectedUser when provided", async () => {
    const today = new Date();
    const mockEvents: ChromeAuditEvent[] = [
      {
        id: { time: today.toISOString() },
        actor: { email: "dylan@google.com" },
        eventName: "DLP_RULE_VIOLATION",
        parameters: [{ name: "RULE_NAME", value: "SSN Protection" }],
      },
      {
        id: { time: today.toISOString() },
        actor: { email: "other@google.com" },
        eventName: "DLP_RULE_VIOLATION",
        parameters: [{ name: "RULE_NAME", value: "SSN Protection" }],
      },
    ];

    mockFetchRawActivity.mockResolvedValue(mockEvents);

    const res = await GET(makeRequest("?days=1&selectedUser=dylan@google.com"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.chartData).toHaveLength(1);
    expect(body.chartData[0].dlpCount).toBe(1); // other@google.com is ignored!
  });

  it("counts events with custom event names but DLP parameters as DLP triggers", async () => {
    const today = new Date();
    const mockEvents: ChromeAuditEvent[] = [
      {
        id: { time: today.toISOString() },
        actor: { email: "dylan@google.com" },
        eventName: "PAGE_CONTENT_UPLOAD",
        parameters: [
          { name: "RULE_NAME", value: "Sensitive Data block" },
          { name: "ACTION", value: "BLOCK" },
        ],
      },
    ];

    mockFetchRawActivity.mockResolvedValue(mockEvents);

    const res = await GET(makeRequest("?days=1"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.chartData).toHaveLength(1);
    expect(body.chartData[0].dlpCount).toBe(1);
    expect(body.chartData[0].threatCount).toBe(0);
  });

  it("counts URL filtering interstitial events and rule reasons as DLP triggers", async () => {
    const today = new Date();
    const mockEvents: ChromeAuditEvent[] = [
      {
        id: { time: today.toISOString() },
        actor: { email: "satyam@cepdemoenv.apollo-df.dev" },
        eventName: "URL_FILTERING_INTERSTITIAL",
        parameters: [
          { name: "EVENT_RESULT", value: "DETECTED" },
          { name: "TRIGGERED_RULES_REASON", value: "Audit Workspace Traffic Rule" },
        ],
      },
    ];

    mockFetchRawActivity.mockResolvedValue(mockEvents);

    const res = await GET(makeRequest("?days=1"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.chartData).toHaveLength(1);
    expect(body.chartData[0].dlpCount).toBe(1);
    expect(body.chartData[0].threatCount).toBe(0);
  });

  it("counts unscanned file transfer events as security threats", async () => {
    const today = new Date();
    const mockEvents: ChromeAuditEvent[] = [
      {
        id: { time: today.toISOString() },
        actor: { email: "dylan@google.com" },
        eventName: "UNSCANNED_FILE",
        parameters: [
          { name: "REASON", value: "ENCRYPTED" },
          { name: "EVENT_RESULT", value: "ALLOWED" },
        ],
      },
    ];

    mockFetchRawActivity.mockResolvedValue(mockEvents);

    const res = await GET(makeRequest("?days=1"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.chartData).toHaveLength(1);
    expect(body.chartData[0].dlpCount).toBe(0);
    expect(body.chartData[0].threatCount).toBe(1);
  });
});
