/**
 * @file Unit tests for Chrome audit log activity summarization.
 */

import { describe, expect, it } from "vitest";
import { summarizeChromeActivity } from "@/lib/activity-summarizer";

describe("summarizeChromeActivity", () => {
  it("returns reassuring message when no events are provided", () => {
    const res = summarizeChromeActivity({ items: [] });
    expect(res).toContain("No Risky Activity");
    expect(res).toContain("0 incidents");
  });

  it("summarizes malware events matching multi-sentence structure", () => {
    const events = {
      items: [
        {
          eventName: "UNSAFE_SITE_VISIT",
          actor: { email: "dylan@google.com" },
          parameters: [
            { name: "URL", value: "https://sub.gleapis.com/v1/dl" },
            { name: "ACTION", value: "BLOCK" },
          ],
        },
      ],
    };

    const summary = summarizeChromeActivity(events);
    expect(summary).toContain("- **Malware & Unsafe Sites (1 incident):**");
    expect(summary).toContain("A user attempted to visit sub.gleapis.com");
    expect(summary).toContain('restricted by Safe Browsing policy "SafeBrowsingProtectionLevel"');
    expect(summary).toContain("This attempt was blocked.");
  });

  it("handles user scope subject properly", () => {
    const events = {
      items: [
        {
          eventName: "DLP_RULE_VIOLATION",
          actor: { email: "dylan@google.com" },
          parameters: [
            { name: "RULE_NAME", value: "SSN Protection" },
            { name: "ACTION", value: "BLOCK" },
          ],
        },
      ],
    };

    const summary = summarizeChromeActivity(events, "dylan@google.com");
    expect(summary).toContain(
      'User "dylan@google.com" attempted to paste sensitive data into an unapproved app',
    );
    expect(summary).toContain('blocked by DLP policy "SSN Protection"');
  });

  it("bounds counts greater than or equal to 1000 with 1,000+", () => {
    const items = Array.from({ length: 1005 }, (_, i) => ({
      eventName: "URL_FILTERING_POLICY_WARNING",
      actor: { email: `user${i % 15}@google.com` },
      parameters: [{ name: "URL", value: "http://chrome://flags" }],
    }));

    const summary = summarizeChromeActivity({ items });
    expect(summary).toContain("- **Restricted URL Navigation (1,000+ incidents):**");
    expect(summary).toContain("15 users attempted to visit chrome://flags");
    expect(summary).toContain("All 1,000+ attempts were blocked.");
  });

  it("appends overflow summary in point 3 when more than 2 buckets are active", () => {
    const items = [
      { eventName: "UNSAFE_SITE_VISIT", actor: { email: "a@g.com" } },
      { eventName: "DANGEROUS_DOWNLOAD", actor: { email: "b@g.com" } },
      { eventName: "DLP_RULE_VIOLATION", actor: { email: "c@g.com" } },
      { eventName: "URL_FILTERING_POLICY_WARNING", actor: { email: "d@g.com" } },
    ];

    const summary = summarizeChromeActivity({ items });
    expect(summary).toContain("- **Malware & Unsafe Sites");
    expect(summary).toContain("- **Unsafe Downloads");
    expect(summary).not.toContain("- **DLP Rule Violations");
    expect(summary).toContain(
      "- **Additional Activity:** 2 other incidents occurred across other categories.",
    );
  });

  it("unpacks MCP content block array [{ type: 'text', text: '...' }] correctly", () => {
    const mcpContent = [
      {
        type: "text",
        text: JSON.stringify({
          items: [
            {
              eventName: "UNSAFE_SITE_VISIT",
              actor: { email: "dylan@google.com" },
              parameters: [{ name: "URL", value: "https://bad.com" }],
            },
          ],
        }),
      },
    ];

    const summary = summarizeChromeActivity(mcpContent);
    expect(summary).toContain("- **Malware & Unsafe Sites (1 incident):**");
    expect(summary).toContain("bad.com");
  });

  it("extracts events from { activities: [...] } object property", () => {
    const data = {
      activities: [
        {
          eventName: "UNSAFE_SITE_VISIT",
          actor: { email: "dylan@google.com" },
          parameters: [{ name: "URL", value: "https://bad.com" }],
        },
      ],
    };

    const summary = summarizeChromeActivity(data);
    expect(summary).toContain("- **Malware & Unsafe Sites (1 incident):**");
    expect(summary).toContain("bad.com");
  });

  it("handles dynamic fallback event names and extracts concrete example site", () => {
    const data = {
      activities: [
        {
          eventName: "PASSWORD_REUSE_WARNING",
          actor: { email: "dylan@google.com" },
          parameters: [
            { name: "URL", value: "https://login.bank.com/auth" },
            { name: "ACTION", value: "BLOCK" },
          ],
        },
      ],
    };

    const summary = summarizeChromeActivity(data);
    expect(summary).toContain("- **Password Reuse (1 incident):**");
    expect(summary).toContain("login.bank.com");
    expect(summary).toContain("This attempt was blocked.");
  });

  it("handles completely unknown custom event names with dynamic Title Case", () => {
    const data = {
      activities: [
        {
          eventName: "CUSTOM_DETECT_EVENT",
          actor: { email: "dylan@google.com" },
          parameters: [{ name: "URL", value: "http://phishing.org/login" }],
        },
      ],
    };

    const summary = summarizeChromeActivity(data);
    expect(summary).toContain("- **Custom Detect Event (1 incident):**");
    expect(summary).toContain("phishing.org");
  });

  it("flattens nested Admin SDK activity.events array structure", () => {
    const data = {
      activities: [
        {
          id: { time: "2026-06-25T01:00:00Z" },
          actor: { email: "dylan@google.com" },
          events: [
            {
              name: "URL_FILTERING_POLICY_WARNING",
              type: "CHROME_ACTIVITY",
              parameters: [
                { name: "URL", value: "https://restricted.internal/admin" },
                { name: "ACTION", value: "BLOCK" },
              ],
            },
          ],
        },
      ],
    };

    const summary = summarizeChromeActivity(data);
    expect(summary).toContain("- **Restricted URL Navigation (1 incident):**");
    expect(summary).toContain("restricted.internal");
    expect(summary).toContain(
      'restricted by corporate URL blocklist policy "URLAllowlist / URLBlocklist"',
    );
  });

  it("formats browser extension events with single vs plural concrete name or generic fallback when missing", () => {
    const singleExt = {
      activities: [
        {
          eventName: "EXTENSION_INSTALL",
          actor: { email: "dylan@google.com" },
          parameters: [
            { name: "EXTENSION_NAME", value: "Grammarly" },
            { name: "ACTION", value: "BLOCK" },
          ],
        },
      ],
    };
    expect(summarizeChromeActivity(singleExt)).toContain(
      'attempted to install extension "Grammarly"',
    );

    const pluralExt = {
      activities: [
        {
          eventName: "EXTENSION_INSTALL",
          actor: { email: "dylan@google.com" },
          parameters: [
            { name: "EXTENSION_NAME", value: "Grammarly" },
            { name: "ACTION", value: "BLOCK" },
          ],
        },
        {
          eventName: "EXTENSION_INSTALL",
          actor: { email: "alex@google.com" },
          parameters: [
            { name: "EXTENSION_NAME", value: "PDF Helper" },
            { name: "ACTION", value: "BLOCK" },
          ],
        },
      ],
    };
    expect(summarizeChromeActivity(pluralExt)).toContain(
      'attempted to install extensions like "Grammarly", which are restricted',
    );

    const missingExt = {
      activities: [
        {
          eventName: "EXTENSION_INSTALL",
          actor: { email: "dylan@google.com" },
          parameters: [{ name: "ACTION", value: "BLOCK" }],
        },
      ],
    };
    expect(summarizeChromeActivity(missingExt)).toContain(
      "attempted to install a browser extension",
    );
  });

  it("applies the assessment phrasing matrix across warned, audited, and mixed enforcement actions", () => {
    // Case 2: 100% Warned -> completed verb ("installed") + "flagged by"
    const warnedExt = {
      activities: [
        {
          eventName: "EXTENSION_INSTALL",
          actor: { email: "dylan@google.com" },
          parameters: [
            { name: "EXTENSION_NAME", value: "Grammarly" },
            { name: "ACTION", value: "WARN" },
            { name: "POLICY_NAME", value: "InstallWarnlist" },
          ],
        },
      ],
    };
    const warnedSummary = summarizeChromeActivity(warnedExt);
    expect(warnedSummary).toContain('installed extension "Grammarly"');
    expect(warnedSummary).toContain('flagged by browser extension policy "InstallWarnlist"');
    expect(warnedSummary).toContain("This attempt triggered a warning.");

    // Case 3: 100% Audited / Logged -> completed verb + "monitored by" without outcome sentence
    const auditedExt = {
      activities: [
        {
          eventName: "EXTENSION_INSTALL",
          actor: { email: "dylan@google.com" },
          parameters: [
            { name: "EXTENSION_NAME", value: "Grammarly" },
            { name: "ACTION", value: "ALLOW" },
            { name: "POLICY_NAME", value: "ExtensionLogger" },
          ],
        },
      ],
    };
    const auditedSummary = summarizeChromeActivity(auditedExt);
    expect(auditedSummary).toContain('installed extension "Grammarly"');
    expect(auditedSummary).toContain('monitored by browser extension policy "ExtensionLogger".');
    expect(auditedSummary).not.toContain("attempt was");

    // Case 4: Mixed Actions (Blocked + Warned) -> attempted verb + "governed by"
    const mixedExt = {
      activities: [
        {
          eventName: "EXTENSION_INSTALL",
          actor: { email: "dylan@google.com" },
          parameters: [
            { name: "EXTENSION_NAME", value: "Grammarly" },
            { name: "ACTION", value: "BLOCK" },
            { name: "POLICY_NAME", value: "InstallPolicy" },
          ],
        },
        {
          eventName: "EXTENSION_INSTALL",
          actor: { email: "alex@google.com" },
          parameters: [
            { name: "EXTENSION_NAME", value: "Grammarly" },
            { name: "ACTION", value: "WARN" },
            { name: "POLICY_NAME", value: "InstallPolicy" },
          ],
        },
      ],
    };
    const mixedSummary = summarizeChromeActivity(mixedExt);
    expect(mixedSummary).toContain('attempted to install extension "Grammarly"');
    expect(mixedSummary).toContain('governed by browser extension policy "InstallPolicy"');
    expect(mixedSummary).toContain("1 attempt was blocked and 1 triggered a warning.");

    // Case 5: Mixed Actions (Warned + Logged) -> accounts for logged attempts so numbers add up to totalCount
    const warnedAndLogged = {
      activities: [
        {
          eventName: "UNSAFE_SITE_VISIT",
          actor: { email: "dylan@google.com" },
          parameters: [
            { name: "URL", value: "https://gleapis.com" },
            { name: "ACTION", value: "WARN" },
            { name: "POLICY_NAME", value: "SafeBrowsingProtectionLevel" },
          ],
        },
        {
          eventName: "UNSAFE_SITE_VISIT",
          actor: { email: "alex@google.com" },
          parameters: [
            { name: "URL", value: "https://gleapis.com" },
            { name: "ACTION", value: "ALLOW" },
            { name: "POLICY_NAME", value: "SafeBrowsingProtectionLevel" },
          ],
        },
      ],
    };
    const wlSummary = summarizeChromeActivity(warnedAndLogged);
    expect(wlSummary).toContain("visited gleapis.com");
    expect(wlSummary).toContain('flagged by Safe Browsing policy "SafeBrowsingProtectionLevel"');
    expect(wlSummary).toContain("This attempt triggered a warning.");
  });
});
