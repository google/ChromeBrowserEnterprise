/**
 * @file Dashboard route — Server Component shell.
 *
 * Pre-fetches the recent-activity map server-side using `getActivitySafe`
 * (which shares the same `getOrFetch` cache the API route uses) and
 * hands it to the interactive client island as an SWR fallback. The
 * roster paints with real data on first byte; SWR revalidates in the
 * background once the user is idle.
 *
 * Auth failures don't throw here — `getActivitySafe` swallows them and
 * returns an empty map. The client banner picks up the credential
 * error on the next user-driven fetch (e.g. the user-search call).
 */

import { DashboardClient } from "./dashboard-client";
import { getActivitySafe } from "@/lib/activity-data";

/**
 * Per-user data — never pre-render at build time. Without this, Next
 * tries to bake the page during `next build`, sees the AuthError that
 * `getActivitySafe` swallows, and ships an empty-activity HTML snapshot
 * to every visitor.
 */
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const initialActivity = await getActivitySafe();
  return <DashboardClient initialActivity={initialActivity} />;
}
