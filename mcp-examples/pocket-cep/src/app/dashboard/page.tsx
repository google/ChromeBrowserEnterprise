/**
 * @file Dashboard route — Server Component shell.
 */

import { DashboardClient } from "./dashboard-client";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  return <DashboardClient />;
}
