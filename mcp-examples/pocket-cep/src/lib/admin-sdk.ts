/**
 * @file Direct Google Admin SDK Directory API client for user search.
 */

import { getErrorMessage } from "./errors";
import { LOG_TAGS } from "./constants";
import { buildGoogleApiHeaders } from "./access-token";
import { AuthError, isAuthError, toAuthError } from "./auth-errors";
import { getActiveCustomerId } from "./sa-session";
import { getEnv } from "./env";

/**
 * Converts a user-typed search string into Admin SDK query syntax.
 * Email-like queries use the email: prefix; plain text searches by name.
 */
export function buildAdminQuery(query: string): string {
  if (!query) return "";
  return query.includes("@") ? `email:${query}*` : query;
}

/** A user from the Google Workspace directory. */
export type DirectoryUser = {
  email: string;
  name: string;
  photoUrl?: string;
  orgUnitPath?: string;
  isAdmin?: boolean;
  suspended?: boolean;
};

/**
 * Searches the Google Workspace user directory via the Admin SDK REST API.
 */
export async function searchUsers(
  query: string,
  accessToken?: string,
  maxResults = 20,
): Promise<DirectoryUser[]> {
  if (getEnv().AUTH_MODE === "user_oauth" && !accessToken) {
    throw new AuthError({
      code: "unauthenticated",
      source: "admin-sdk",
      message: "Your Google OAuth session is missing or expired.",
      remedy: "Sign out and sign back in with Google to refresh your credentials.",
    });
  }

  const customerId = await getActiveCustomerId();
  const params = new URLSearchParams({
    customer: customerId || "my_customer",
    maxResults: String(maxResults),
    orderBy: "email",
    projection: "basic",
  });

  if (query) {
    params.set("query", query);
  }

  const url = `https://admin.googleapis.com/admin/directory/v1/users?${params}`;
  const token = accessToken;
  if (!token) {
    throw new AuthError({
      code: "no_credentials",
      source: "admin-sdk",
      message: "No Google access token available.",
      remedy: "Configure your credentials or sign in.",
    });
  }

  try {
    const headers = await buildGoogleApiHeaders(token);

    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      /**
       * Mid-request auth failures (token revoked between ADC and this
       * call, or the OAuth user's scopes were rescinded) land here. The
       * Directory API returns a Google error JSON that toAuthError can
       * classify — route it through the same AuthError contract so the
       * banner still lights up.
       */
      const authErr = toAuthError(body, "admin-sdk");
      if (authErr) throw authErr;
      console.error(LOG_TAGS.USERS, `Admin SDK users.list failed (${response.status}):`, body);
      return [];
    }

    const data = (await response.json()) as {
      users?: Array<{
        primaryEmail?: string;
        name?: { fullName?: string };
        thumbnailPhotoUrl?: string;
        orgUnitPath?: string;
        isAdmin?: boolean;
        suspended?: boolean;
      }>;
    };

    return (data.users ?? []).map((u) => ({
      email: u.primaryEmail ?? "",
      name: u.name?.fullName ?? "",
      photoUrl: u.thumbnailPhotoUrl,
      orgUnitPath: u.orgUnitPath,
      isAdmin: u.isAdmin,
      suspended: u.suspended,
    }));
  } catch (error) {
    if (isAuthError(error)) throw error;
    console.error(LOG_TAGS.USERS, "Admin SDK search failed:", getErrorMessage(error));
    return [];
  }
}
