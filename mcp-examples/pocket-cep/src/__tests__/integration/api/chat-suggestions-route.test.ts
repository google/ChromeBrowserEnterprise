/**
 * @file Integration tests for POST /api/chat/suggestions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockRequireSession,
  mockGenerateObject,
  mockConvertToModelMessages,
  mockBuildModel,
  mockResolveModelOption,
} = vi.hoisted(() => ({
  mockRequireSession: vi.fn(),
  mockGenerateObject: vi.fn(),
  mockConvertToModelMessages: vi.fn(),
  mockBuildModel: vi.fn(),
  mockResolveModelOption: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireSession: mockRequireSession,
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateObject: mockGenerateObject,
    convertToModelMessages: mockConvertToModelMessages,
  };
});

vi.mock("@/lib/build-model", () => ({
  buildModel: mockBuildModel,
  resolveModelOption: mockResolveModelOption,
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ LLM_PROVIDER: "google" }),
}));

import { POST } from "@/app/api/chat/suggestions/route";

describe("POST /api/chat/suggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSession.mockResolvedValue(true);
    mockResolveModelOption.mockReturnValue({ provider: "google", id: "gemini-2.5-pro" });
    mockBuildModel.mockReturnValue({});
    mockConvertToModelMessages.mockResolvedValue([{ role: "user", content: "Show logs" }]);
  });

  it("returns 401 when unauthenticated", async () => {
    mockRequireSession.mockResolvedValue(false);
    const req = new Request("http://localhost/api/chat/suggestions", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns empty array when messages is empty", async () => {
    const req = new Request("http://localhost/api/chat/suggestions", {
      method: "POST",
      body: JSON.stringify({ messages: [] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ questions: [] });
  });

  it("returns generated questions on success", async () => {
    mockGenerateObject.mockResolvedValue({
      object: { questions: ["Q1?", "Q2?", "Q3?"] },
    });
    const req = new Request("http://localhost/api/chat/suggestions", {
      method: "POST",
      body: JSON.stringify({ messages: [{ id: "1", role: "user", content: "Show logs" }] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ questions: ["Q1?", "Q2?", "Q3?"] });
  });
});
