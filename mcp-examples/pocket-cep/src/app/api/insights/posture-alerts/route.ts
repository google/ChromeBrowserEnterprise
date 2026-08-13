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
      url: "https://admin.google.com/ac/billing/subscriptions",
      label: "See in UI",
    };
  }
  if (component === "userLicense") {
    return {
      url: "https://admin.google.com/ac/users",
      label: "See in UI",
    };
  }
  if (component === "dlpRules") {
    return {
      url: "https://admin.google.com/ac/dp/rules",
      label: "See in UI",
    };
  }
  if (component === "sebExtension") {
    return {
      url: "https://admin.google.com/ac/chrome/apps/user",
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
        ? `https://admin.google.com/ac/chrome/settings/user/details/${detailPath}`
        : "https://admin.google.com/ac/chrome/settings/user",
      label: "See in UI",
    };
  }
  return undefined;
}

type McpDiagnoseResponse = {
  issues?: McpIssue[];
};

function getSuggestedQuery(issue: McpIssue, selectedUser: string): string {
  const scope = selectedUser ? `for user "${selectedUser}"` : "across the organization";

  if (issue.component === "subscription") {
    if (issue.message.includes("0 users")) {
      return `The dashboard says: Chrome Enterprise Premium subscription is active, but 0 users have licenses assigned ${scope}.\n\nCan you tell me how to assign licenses to users?`;
    }
    return `The dashboard says: Only a limited number of CEP licenses are assigned ${scope}.\n\nCan you tell me how to check license assignments?`;
  }

  if (issue.component === "securityInsights") {
    return `The dashboard says: Chrome Security Insights is disabled ${scope}.\n\nCan you tell me how to enable Security Insights?`;
  }

  if (issue.component.startsWith("connector.")) {
    const connectorName = issue.component.replace("connector.", "");
    return `The dashboard says: The ${connectorName} security connector is not configured or disabled.\n\nCan you tell me how to configure the ${connectorName} connector?`;
  }

  if (issue.component === "dlpRules") {
    if (issue.message.includes("No DLP rules")) {
      return `The dashboard says: No DLP rules are configured ${scope}.\n\nCan you tell me how to deploy the default DLP rules?`;
    }
    if (issue.message.includes("inactive")) {
      return `The dashboard says: Some or all DLP rules are inactive ${scope}.\n\nCan you tell me how to activate these DLP rules?`;
    }
    return `The dashboard says: All active DLP rules are in audit-only mode.\n\nCan you tell me how to configure blocking rules?`;
  }

  if (issue.component === "sebExtension") {
    return `The dashboard says: Secure Enterprise Browser (SEB) extension is not force-installed.\n\nCan you tell me how to force-install the SEB extension?`;
  }

  // Fallback
  return `The dashboard says: A security posture issue was detected (${issue.message}).\n\nCan you tell me more about this issue and how to resolve it?`;
}

export async function POST(request: Request) {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { selectedUser?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const selectedUser = body.selectedUser ?? "";
  const config = getEnv();
  const [accessToken, customerId] = await Promise.all([
    getGoogleAccessToken(),
    getActiveCustomerId(),
  ]);

  try {
    const cacheKey = `insights:posture-alerts:${selectedUser}`;
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
            suggestedQuery: getSuggestedQuery(issue, selectedUser),
            remediation,
          });
        }

        // 2. If a specific user is selected, check their CEP license status
        if (selectedUser) {
          const licenseResult = await callMcpTool(
            config.MCP_SERVER_URL,
            "check_user_cep_license",
            { userId: selectedUser },
            accessToken,
          );

          if (!licenseResult.isError) {
            const licenseData = (licenseResult.structuredContent ?? licenseResult.content) as {
              isLicensed?: boolean;
            };
            if (licenseData.isLicensed === false) {
              alerts.push({
                id: `userLicense:${selectedUser}`,
                severity: "high",
                component: "userLicense",
                message: `User "${selectedUser}" is not assigned a Chrome Enterprise Premium license. CEP features are not enforced for this user.`,
                suggestedQuery: `The dashboard says: User "${selectedUser}" is not assigned a CEP license.\n\nCan you tell me how to assign a license to this user?`,
                remediation: getRemediation("userLicense"),
              });
            }
          }
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
