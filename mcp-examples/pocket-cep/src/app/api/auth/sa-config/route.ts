/**
 * @file API endpoints for configuring Service Account mode tenant credentials.
 *
 * Provides GET, POST, and DELETE handlers to inspect, save, and clear the
 * active Google Workspace Customer ID (`customerId`) and optional Domain-Wide
 * Delegation user (`impersonatedUser`) stored in HTTP-only cookies.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  COOKIE_SA_CUSTOMER_ID,
  COOKIE_SA_IMPERSONATED_USER,
  getServiceAccountConfig,
} from "@/lib/sa-session";
import { getEnv } from "@/lib/env";
import {
  clearServiceAccountTokenCache,
  DwdScopeVerificationError,
  mintServiceAccountTokenOrThrow,
} from "@/lib/access-token";

/**
 * Returns the currently configured Service Account tenant credentials.
 */
export async function GET() {
  const env = getEnv();
  if (env.AUTH_MODE !== "service_account") {
    return NextResponse.json({ error: "Not in service_account mode" }, { status: 400 });
  }

  const config = await getServiceAccountConfig();
  if (!config) {
    return NextResponse.json({ configured: false });
  }

  return NextResponse.json({
    configured: true,
    customerId: config.customerId,
    impersonatedUser: config.impersonatedUser,
  });
}

/**
 * Saves the selected Customer ID and optional Impersonated User to HTTP-only cookies.
 */
export async function POST(request: NextRequest) {
  const env = getEnv();
  if (env.AUTH_MODE !== "service_account") {
    return NextResponse.json({ error: "Not in service_account mode" }, { status: 400 });
  }

  let body: { customerId?: string; impersonatedUser?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const customerId = body.customerId?.trim();
  if (!customerId) {
    return NextResponse.json({ error: "customerId is required" }, { status: 400 });
  }

  const impersonatedUser = body.impersonatedUser?.trim() || "";

  clearServiceAccountTokenCache();

  if (impersonatedUser) {
    try {
      await mintServiceAccountTokenOrThrow(impersonatedUser);
    } catch (error) {
      if (error instanceof DwdScopeVerificationError) {
        return NextResponse.json(
          {
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
      const msg = error instanceof Error ? error.message : String(error);
      return NextResponse.json(
        {
          error:
            `Failed to verify Domain-Wide Delegation token for ${impersonatedUser}: ${msg}. ` +
            "Please ensure your Service Account key file is valid and all required DWD scopes are authorized in Google Workspace Admin Console.",
        },
        { status: 400 },
      );
    }
  }

  const response = NextResponse.json({ success: true, customerId, impersonatedUser });

  const isProduction = process.env.NODE_ENV === "production";
  const cookieOptions = {
    path: "/",
    maxAge: 86400 * 30, // 30 days
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProduction,
  };

  response.cookies.set(COOKIE_SA_CUSTOMER_ID, customerId, cookieOptions);

  if (impersonatedUser) {
    response.cookies.set(COOKIE_SA_IMPERSONATED_USER, impersonatedUser, cookieOptions);
  } else {
    response.cookies.delete(COOKIE_SA_IMPERSONATED_USER);
  }

  return response;
}

/**
 * Clears the stored Service Account tenant credentials.
 */
export async function DELETE() {
  clearServiceAccountTokenCache();
  const response = NextResponse.json({ success: true });
  response.cookies.delete(COOKIE_SA_CUSTOMER_ID);
  response.cookies.delete(COOKIE_SA_IMPERSONATED_USER);
  return response;
}
