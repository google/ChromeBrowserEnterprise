/**
 * @file Service Account connection and Domain-Wide Delegation setup page.
 *
 * This page is only accessible in service_account mode (`AUTH_MODE=service_account`).
 * It displays the machine identity (`client_email`, `client_id`, `project_id`)
 * and copyable scope checklists so administrators can authorize Domain-Wide
 * Delegation in Google Workspace Admin Console (`admin.google.com/ac/owl/domainwidedelegation`).
 *
 * If visited in user_oauth mode, the visitor is redirected to "/" (LandingPage).
 */

import { redirect } from "next/navigation";
import { ServiceAccountHome } from "@/components/auth/service-account-home";
import { getEnv } from "@/lib/env";
import { getServiceAccountIdentity } from "@/lib/sa-identity";
import { getServiceAccountConfig } from "@/lib/sa-session";

/**
 * Service Account configuration and checklist screen.
 */
export default async function SaSetupPage() {
  const env = getEnv();
  if (env.AUTH_MODE !== "service_account") {
    redirect("/");
  }

  const [identity, config] = await Promise.all([
    getServiceAccountIdentity(),
    getServiceAccountConfig(),
  ]);

  return (
    <ServiceAccountHome
      identity={identity}
      initialCustomerId={config?.customerId || ""}
      initialImpersonatedUser={config?.impersonatedUser || ""}
      isConfigured={!!config?.customerId}
    />
  );
}
