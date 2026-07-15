/**
 * @file Verification endpoint for Service Account credentials and tenant permissions.
 *
 * GET /api/auth/sa-verify
 *   Examines current cookie state (`customerId`, `impersonatedUser`) and verifies
 *   token minting and Domain-Wide Delegation OAuth scope authorization
 *   (`getGoogleAccessToken`). API role assignments (`count_browser_versions`, etc.)
 *   are checked at tool call time when individual tools are executed in the chat.
 */

import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { getServiceAccountConfig } from "@/lib/sa-session";
import { getGoogleAccessToken, DwdScopeVerificationError } from "@/lib/access-token";
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

  try {
    await getGoogleAccessToken();
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
        error: getErrorMessage(error) || "Failed to mint Service Account access token.",
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    verified: true,
    customerId: config.customerId,
    impersonatedUser: config.impersonatedUser || "",
  });
}
