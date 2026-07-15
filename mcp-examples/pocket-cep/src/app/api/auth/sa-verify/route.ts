/**
 * @file Verification endpoint for Service Account credentials and tenant permissions.
 *
 * GET /api/auth/sa-verify
 *   Examines current cookie state (`customerId`, `impersonatedUser`), verifies
 *   token minting (`getGoogleAccessToken`), and executes a diagnostic probe
 *   (`diagnose_environment`) against the upstream MCP server to verify that
 *   the Service Account has the required GCP / Google Workspace permissions.
 */

import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { getServiceAccountConfig } from "@/lib/sa-session";
import { getGoogleAccessToken, DwdScopeVerificationError } from "@/lib/access-token";
import { callMcpTool } from "@/lib/mcp-client";
import { getErrorMessage } from "@/lib/errors";

export async function GET() {
  const env = getEnv();
  if (env.AUTH_MODE !== "service_account") {
    return NextResponse.json({ error: "Not in service_account mode" }, { status: 400 });
  }

  const config = await getServiceAccountConfig();
  if (!config?.customerId) {
    return NextResponse.json(
      { verified: false, error: "No Customer ID configured yet." },
      { status: 400 },
    );
  }

  let accessToken: string | undefined;
  try {
    accessToken = await getGoogleAccessToken();
  } catch (error) {
    if (error instanceof DwdScopeVerificationError) {
      return NextResponse.json(
        {
          verified: false,
          error: error.message,
          dwdDiagnostics: {
            subject: error.subject,
            clientId: error.clientId,
            authorizedScopes: error.authorizedScopes,
            missingScopes: error.missingScopes,
          },
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        verified: false,
        error: getErrorMessage(error),
      },
      { status: 400 },
    );
  }

  try {
    const result = await callMcpTool(
      env.MCP_SERVER_URL,
      "diagnose_environment",
      { customerId: config.customerId },
      accessToken,
    );

    if (result && typeof result === "object" && "isError" in result && result.isError) {
      const textObj = Array.isArray(result.content)
        ? result.content.find((c: { type?: string; text?: string }) => c?.type === "text")
        : null;
      const errorText = textObj?.text || "Verification probe returned an error.";
      return NextResponse.json({ verified: false, error: errorText }, { status: 400 });
    }

    return NextResponse.json({
      verified: true,
      customerId: config.customerId,
      impersonatedUser: config.impersonatedUser || "",
    });
  } catch (error) {
    return NextResponse.json(
      {
        verified: false,
        error: getErrorMessage(error) || "Failed to reach MCP server for verification probe.",
      },
      { status: 500 },
    );
  }
}
