/**
 * @file API route for auditing security posture and generating setup alerts.
 *
 * POST /api/insights/posture-alerts
 * Body: { selectedUser?: string }
 * Response: { alerts: PostureAlert[] }
 *
 * Runs environment health check and compiles licensing/configuration warnings.
 * Caches results in-memory to prevent rate-limiting on dashboard load.
 */

import { NextResponse } from "next/server";
import { getGoogleAccessToken } from "@/lib/access-token";
import { getEnv } from "@/lib/env";
import { callMcpTool } from "@/lib/mcp-client";
import { requireSession } from "@/lib/session";
import { getActiveCustomerId } from "@/lib/sa-session";
import { isAuthError, toAuthError } from "@/lib/auth-errors";
import { CACHE_TAGS, getOrFetch } from "@/lib/server-cache";
import { DASHBOARD_QUERY_PREFIX, ADMIN_CONSOLE_URLS } from "@/lib/constants";
import { buildCallerCacheKey } from "@/lib/cache-key";

const POSTURE_TTL_MS = 5 * 60 * 1000; // Cache posture report for 5 minutes

export type PostureAlert = {
  id: string;
  severity: "critical" | "high" | "medium" | "warning";
  component: string;
  message: string;
  suggestedQuery: string;
  remediation?: {
    url: string;
    label: string;
  };
};

type McpIssue = {
  severity: "critical" | "high" | "medium" | "warning";
  component: string;
  message: string;
  remediation?: {
    command?: string;
    url?: string;
    actionLabel?: string;
  };
};

/**
 * Strips raw action URLs and setup instructions from the diagnostics message
 * to keep the dashboard UI card dense and readable, avoiding duplicate link rendering.
 *
 * Handles patterns like:
 * - "Create rules at: https://admin.google.com/..." -> "."
 * - "Update settings manually at: https://..." -> "."
 */
function cleanIssueMessage(message: string): string {
  const cleaned = message
    .replace(
      /\.?\s*(Update settings manually at|Create rules at|Manage rules at|Configure it manually at|Activate DLP rules at)\s*:?\s*https?:\/\/\S+/gi,
      ".",
    )
    .trim();

  const formatted = cleaned.replace(/analysis: Delay/g, "analysis - delay");

  return formatted.replace(
    /Users are unprotected during content analysis/g,
    "Files are not blocked while scanning is in progress",
  );
}

function getRemediation(component: string): { url: string; label: string } | undefined {
  if (component === "subscription") {
    return {
      url: ADMIN_CONSOLE_URLS.SUBSCRIPTIONS,
      label: "See in UI",
    };
  }
  if (component === "dlpRules") {
    return {
      url: ADMIN_CONSOLE_URLS.DLP_RULES,
      label: "See in UI",
    };
  }
  if (component === "sebExtension") {
    return {
      url: ADMIN_CONSOLE_URLS.CHROME_APPS,
      label: "See in UI",
    };
  }
  if (component.startsWith("connector.")) {
    const connectorKey = component.replace("connector.", "");
    let detailPath = "";
    if (connectorKey === "uploadAnalysis") detailPath = "file_attached";
    else if (connectorKey === "downloadAnalysis") detailPath = "file_downloaded";
    else if (connectorKey === "pasteAnalysis") detailPath = "bulk_text_entry";
    else if (connectorKey === "printAnalysis") detailPath = "print";
    else if (connectorKey === "realtimeUrlCheck") detailPath = "realtime_url_navigation";
    else if (connectorKey === "securityEventReporting") detailPath = "security_event";

    return {
      url: detailPath
        ? `${ADMIN_CONSOLE_URLS.CHROME_SETTINGS}/details/${detailPath}`
        : ADMIN_CONSOLE_URLS.CHROME_SETTINGS,
      label: "See in UI",
    };
  }
  return undefined;
}

type McpDiagnoseResponse = {
  issues?: McpIssue[];
};

function getSuggestedQuery(message: string): string {
  return `${DASHBOARD_QUERY_PREFIX} "${message}"\n\nCan you tell me about this?`;
}

export async function POST(_request: Request) {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const config = getEnv();
  const [accessToken, customerId] = await Promise.all([
    getGoogleAccessToken(),
    getActiveCustomerId(),
  ]);

  try {
    const callerKey = buildCallerCacheKey(config.MCP_SERVER_URL, accessToken, customerId);
    const cacheKey = `insights:posture-alerts:${callerKey}`;
    const result = await getOrFetch({
      key: cacheKey,
      ttlMs: POSTURE_TTL_MS,
      tags: [CACHE_TAGS.INSIGHTS],
      fetcher: async () => {
        const alerts: PostureAlert[] = [];

        // 1. Check org-wide environment diagnostic issues
        const diagResult = await callMcpTool(
          config.MCP_SERVER_URL,
          "diagnose_environment",
          { customerId },
          accessToken,
        );

        const trText =
          typeof diagResult.content === "string"
            ? diagResult.content
            : JSON.stringify(diagResult.content);
        const authErr = toAuthError(trText, "mcp-tool") ?? toAuthError(diagResult, "mcp-tool");
        if (authErr) throw authErr;

        if (diagResult.isError) {
          throw new Error("diagnose_environment failed");
        }

        const diagData = (diagResult.structuredContent ?? {}) as McpDiagnoseResponse;
        const issues = diagData.issues ?? [];

        for (const issue of issues) {
          const cleanMessage = cleanIssueMessage(issue.message);
          const remediation = issue.remediation?.url
            ? {
                url: issue.remediation.url,
                label: "See in UI",
              }
            : getRemediation(issue.component);

          let severity = issue.severity;
          if (issue.component === "dlpRules" && issue.message.toLowerCase().includes("inactive")) {
            severity = "warning";
          }

          alerts.push({
            id: `${issue.component}:${cleanMessage.slice(0, 30).replace(/\s+/g, "_")}`,
            severity,
            component: issue.component,
            message: cleanMessage,
            suggestedQuery: getSuggestedQuery(cleanMessage),
            remediation,
          });
        }

        return { alerts };
      },
    });

    return NextResponse.json({ alerts: result.alerts });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: error.toPayload() }, { status: 401 });
    }
    return NextResponse.json(
      {
        error: "Environment diagnostic analysis is temporarily unavailable.",
      },
      { status: 503 },
    );
  }
}
