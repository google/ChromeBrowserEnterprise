/**
 * @file Tests for the setup-required HTML pages served by the proxy
 * when the dashboard can't render — env validation failures or an
 * unreachable MCP server.
 */

import { describe, it, expect } from "vitest";
import { renderEnvErrorHtml, renderMcpUnreachableHtml } from "@/lib/env-error-page";

const ONE_ISSUE = [{ path: "BETTER_AUTH_SECRET", message: "required" }];
const TWO_ISSUES = [
  { path: "BETTER_AUTH_SECRET", message: "required" },
  { path: "ANTHROPIC_API_KEY", message: "expected string, received undefined" },
];

describe("renderEnvErrorHtml", () => {
  it("produces a well-formed HTML document", () => {
    const html = renderEnvErrorHtml(ONE_ISSUE);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html.trim().endsWith("</html>")).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<title>Pocket CEP");
  });

  it("sets a viewport meta tag (mobile-safe)", () => {
    const html = renderEnvErrorHtml(ONE_ISSUE);
    expect(html).toContain('name="viewport"');
  });

  it("features `npm run setup` as the primary CTA", () => {
    const html = renderEnvErrorHtml(ONE_ISSUE);
    expect(html).toContain("npm run setup");
  });

  it("mentions .env.local.example as the hand-edit alternative", () => {
    const html = renderEnvErrorHtml(ONE_ISSUE);
    expect(html).toContain(".env.local.example");
  });

  it("renders one <li> per issue", () => {
    const html = renderEnvErrorHtml(TWO_ISSUES);
    const liCount = (html.match(/<li>/g) ?? []).length;
    expect(liCount).toBe(2);
    expect(html).toContain("BETTER_AUTH_SECRET");
    expect(html).toContain("ANTHROPIC_API_KEY");
    expect(html).toContain("expected string, received undefined");
  });

  it("still renders when there are zero issues (empty list)", () => {
    const html = renderEnvErrorHtml([]);
    expect(html).toContain("npm run setup");
    expect((html.match(/<li>/g) ?? []).length).toBe(0);
  });

  it("HTML-escapes malicious var names to prevent injection", () => {
    const html = renderEnvErrorHtml([{ path: "<script>alert(1)</script>", message: "ok" }]);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("HTML-escapes malicious messages to prevent injection", () => {
    const html = renderEnvErrorHtml([{ path: "X", message: '"><img src=x onerror=alert(1)>' }]);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
  });

  it("escapes ampersands to prevent entity confusion", () => {
    const html = renderEnvErrorHtml([{ path: "A&B", message: "C&D" }]);
    expect(html).toContain("A&amp;B");
    expect(html).toContain("C&amp;D");
  });

  it("sets the text/html content type implicitly via <!doctype html>", () => {
    // The proxy is responsible for the response header; this test
    // guards against the generator silently emitting anything else.
    const html = renderEnvErrorHtml(ONE_ISSUE);
    expect(html.slice(0, 15).toLowerCase()).toBe("<!doctype html>");
  });

  it("includes the MD3-aligned primary tint (#1a73e8)", () => {
    const html = renderEnvErrorHtml(ONE_ISSUE);
    expect(html).toContain("#1a73e8");
  });
});

describe("renderMcpUnreachableHtml", () => {
  const URL_DEFAULT = "http://localhost:4000/mcp";

  it("produces a well-formed HTML document with an MCP-specific title", () => {
    const html = renderMcpUnreachableHtml(URL_DEFAULT);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html.trim().endsWith("</html>")).toBe(true);
    expect(html).toContain("MCP server unreachable");
  });

  it("features `npm run dev:full` as the primary CTA", () => {
    const html = renderMcpUnreachableHtml(URL_DEFAULT);
    expect(html).toContain("npm run dev:full");
  });

  it("mentions `MCP_SERVER_CMD` and `.env.local` so the override is discoverable", () => {
    const html = renderMcpUnreachableHtml(URL_DEFAULT);
    expect(html).toContain("MCP_SERVER_CMD");
    expect(html).toContain(".env.local");
  });

  it("renders the failing URL inside a code element", () => {
    const html = renderMcpUnreachableHtml(URL_DEFAULT);
    expect(html).toContain(URL_DEFAULT);
    expect(html).toContain('<code class="code">');
  });

  it("HTML-escapes the URL to prevent injection via crafted MCP_SERVER_URL values", () => {
    const html = renderMcpUnreachableHtml('http://x"><script>alert(1)</script>/mcp');
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("shares the MD3 design language with the env-error page", () => {
    // Same primary tint asserts the two pages stay visually unified
    // — they're rendered by the same generic template.
    const envHtml = renderEnvErrorHtml([{ path: "X", message: "y" }]);
    const mcpHtml = renderMcpUnreachableHtml(URL_DEFAULT);
    expect(envHtml).toContain("#1a73e8");
    expect(mcpHtml).toContain("#1a73e8");
  });
});
