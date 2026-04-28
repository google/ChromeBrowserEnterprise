/**
 * @file Direct Google Admin SDK Directory API client for user search.
 */

import { getErrorMessage } from "./errors";
import { LOG_TAGS } from "./constants";
import { getADCToken, buildGoogleApiHeaders } from "./adc";
import { isAuthError, toAuthError } from "./auth-errors";

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
 *
 * Throws `AuthError` on credential failure so API routes can return a
 * structured 401. Non-auth failures return an empty array (existing
 * behavior) — they're logged but treated as "no results".
 *
 * Supports Admin SDK query syntax:
 *   - "email:alice*" for email prefix
 *   - Plain text for general name/email search
 *   - Empty string returns the first page of all users
 */
export async function searchUsers(
  query: string,
  accessToken?: string,
  maxResults = 20,
): Promise<DirectoryUser[]> {
  const params = new URLSearchParams({
    customer: "my_customer",
    maxResults: String(maxResults),
    orderBy: "email",
    projection: "basic",
  });

  if (query) {
    params.set("query", query);
  }

  const url = `https://admin.googleapis.com/admin/directory/v1/users?${params}`;
  const token = accessToken ?? (await getADCToken());

  try {
    const headers = await buildGoogleApiHeaders(token, !accessToken);

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
