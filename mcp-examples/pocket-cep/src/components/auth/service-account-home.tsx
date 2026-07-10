"use client";

/**
 * @file Service Account mode landing & setup screen (`AUTH_MODE="service_account"`).
 *
 * Displays the active machine identity (`client_email`, `client_id`, `project_id`),
 * comprehensive actionable checklists for assigning GCP IAM roles and Google Workspace
 * Domain-Wide Delegation permissions (with one-click Copy and deep UI console links),
 * and form controls to connect to the target Customer ID (`customerId`).
 */

import { useState } from "react";
import {
  Shield,
  Key,
  ExternalLink,
  ArrowRight,
  Loader2,
  Copy,
  Check,
  CheckCircle2,
  Lock,
} from "lucide-react";
import type { ServiceAccountIdentity } from "@/lib/sa-identity";

interface ServiceAccountHomeProps {
  clientEmail?: string | null;
  identity?: ServiceAccountIdentity | null;
  initialCustomerId?: string;
  initialImpersonatedUser?: string;
}

const DWD_POLICY_SCOPE = [
  "https://www.googleapis.com/auth/admin.directory.customer.readonly",
  "https://www.googleapis.com/auth/admin.directory.orgunit.readonly",
  "https://www.googleapis.com/auth/admin.reports.audit.readonly",
  "https://www.googleapis.com/auth/chrome.management.policy",
  "https://www.googleapis.com/auth/chrome.management.reports.readonly",
  "https://www.googleapis.com/auth/chrome.management.profiles.readonly",
  "https://www.googleapis.com/auth/chrome.management.securityinsights",
  "https://www.googleapis.com/auth/cloud-identity.policies",
].join(",");

export function ServiceAccountHome({
  clientEmail,
  identity,
  initialCustomerId = "",
  initialImpersonatedUser = "",
}: ServiceAccountHomeProps) {
  const [customerId, setCustomerId] = useState(initialCustomerId);
  const [impersonatedUser, setImpersonatedUser] = useState(initialImpersonatedUser);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"connect" | "permissions">("connect");

  const displayEmail =
    identity?.clientEmail || clientEmail || "Service Account Credentials Configured";

  async function handleCopy(field: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Ignore clipboard failure on unsecure origin
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId.trim()) {
      setError("Please enter a valid Customer ID (e.g. C01234567)");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/sa-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customerId.trim(),
          impersonatedUser: impersonatedUser.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save Service Account configuration");
      }

      window.location.href = "/dashboard";
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
      setLoading(false);
    }
  }

  const iamConsoleUrl = identity?.projectId
    ? `https://console.cloud.google.com/iam-admin/iam?project=${identity.projectId}`
    : "https://console.cloud.google.com/iam-admin/iam";

  const dwdConsoleUrl = "https://admin.google.com/ac/owl/domainwidedelegation";

  return (
    <div className="bg-surface-dim flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-10">
      <main className="bg-surface ring-on-surface/10 my-auto flex w-full max-w-[560px] flex-col gap-6 rounded-[var(--radius-md)] p-8 shadow-[var(--shadow-elevation-1)] ring-1">
        {/* Header */}
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="bg-primary/10 flex size-12 items-center justify-center rounded-full">
            <Shield className="text-primary size-6" aria-hidden="true" />
          </div>
          <h1 className="text-on-surface text-xl font-semibold">Service Account Authentication</h1>
          <p className="text-on-surface-variant text-sm">
            Configure target tenant credentials and verify machine identity permissions.
          </p>
        </div>

        {/* Machine Identity Display Card */}
        <div className="bg-surface-dim ring-on-surface/10 flex flex-col gap-3 rounded-lg p-4 ring-1">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <Key className="text-on-surface-variant size-4 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-on-surface-muted text-[0.6875rem] font-semibold tracking-wider uppercase">
                  Active Service Account Email
                </p>
                <p className="text-on-surface truncate text-sm font-medium">{displayEmail}</p>
              </div>
            </div>
            {displayEmail !== "Service Account Credentials Configured" && (
              <button
                type="button"
                onClick={() => handleCopy("email", displayEmail)}
                className="hover:bg-surface-raised text-on-surface-variant hover:text-on-surface flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors"
                title="Copy Service Account Email"
              >
                {copiedField === "email" ? (
                  <>
                    <Check className="text-success size-3.5" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="size-3.5" />
                    Copy
                  </>
                )}
              </button>
            )}
          </div>

          {identity?.clientId && (
            <div className="border-on-surface/10 flex items-center justify-between gap-3 border-t pt-2.5">
              <div className="min-w-0">
                <p className="text-on-surface-muted text-[0.6875rem] font-semibold tracking-wider uppercase">
                  Unique Numeric Client ID (For Domain-Wide Delegation)
                </p>
                <p className="text-on-surface font-mono text-xs">{identity.clientId}</p>
              </div>
              <button
                type="button"
                onClick={() => handleCopy("clientId", identity.clientId!)}
                className="hover:bg-surface-raised text-on-surface-variant hover:text-on-surface flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors"
                title="Copy Numeric Client ID"
              >
                {copiedField === "clientId" ? (
                  <>
                    <Check className="text-success size-3.5" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="size-3.5" />
                    Copy
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Tab Navigation */}
        <div className="border-on-surface/10 flex border-b">
          <button
            type="button"
            onClick={() => setActiveTab("connect")}
            className={`flex-1 border-b-2 pb-2.5 text-sm font-medium transition-colors ${
              activeTab === "connect"
                ? "border-primary text-primary"
                : "text-on-surface-variant hover:text-on-surface border-transparent"
            }`}
          >
            Launch Connection
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("permissions")}
            className={`flex-1 border-b-2 pb-2.5 text-sm font-medium transition-colors ${
              activeTab === "permissions"
                ? "border-primary text-primary"
                : "text-on-surface-variant hover:text-on-surface border-transparent"
            }`}
          >
            Required Permissions Checklist
          </button>
        </div>

        {/* Tab Content 1: Connect Form */}
        {activeTab === "connect" && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="customerId" className="text-on-surface text-sm font-medium">
                Customer ID <span className="text-error">*</span>
              </label>
              <input
                id="customerId"
                type="text"
                required
                placeholder="e.g. C01234567"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="bg-surface ring-on-surface/20 focus:ring-primary text-on-surface placeholder:text-on-surface-muted rounded-md px-3 py-2 text-sm ring-1 transition-all outline-none focus:ring-2"
              />
              <p className="text-on-surface-muted text-xs">
                Your organization&apos;s Google Workspace Customer ID (found in Admin Console under
                Account Settings).
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="impersonatedUser" className="text-on-surface text-sm font-medium">
                Impersonated User Email{" "}
                <span className="text-on-surface-muted font-normal">(Optional)</span>
              </label>
              <input
                id="impersonatedUser"
                type="email"
                placeholder="e.g. admin@example.com"
                value={impersonatedUser}
                onChange={(e) => setImpersonatedUser(e.target.value)}
                className="bg-surface ring-on-surface/20 focus:ring-primary text-on-surface placeholder:text-on-surface-muted rounded-md px-3 py-2 text-sm ring-1 transition-all outline-none focus:ring-2"
              />
              <p className="text-on-surface-muted text-xs">
                Optional Google Workspace admin email for Domain-Wide Delegation (required when
                executing Cloud Identity DLP tools).
              </p>
            </div>

            {error && (
              <div className="bg-error/10 text-error rounded-md p-2.5 text-xs font-medium">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="bg-primary text-on-primary hover:bg-primary/90 flex w-full items-center justify-center gap-2 rounded-md py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  Connect &amp; Launch Dashboard
                  <ArrowRight className="size-4" />
                </>
              )}
            </button>
          </form>
        )}

        {/* Tab Content 2: Permissions Guide & UI Links */}
        {activeTab === "permissions" && (
          <div className="flex flex-col gap-5 text-sm">
            {/* Standard Admin Roles Card */}
            <div className="bg-surface-dim ring-on-surface/10 flex flex-col gap-3 rounded-lg p-4 ring-1">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="text-primary size-4" />
                <h2 className="text-on-surface font-medium">
                  1. Chrome Management Admin Privileges
                </h2>
              </div>
              <p className="text-on-surface-variant text-xs leading-relaxed">
                Chrome Management &amp; Telemetry APIs inspect activity logs, count browser
                versions, and check security insights. In Google Workspace Admin Console, assign
                Admin Roles directly to your Service Account email:
              </p>

              <div className="bg-surface rounded p-2.5 text-xs">
                <p className="text-on-surface-muted mb-1 font-medium">
                  Service Account Email to Assign Admin Roles:
                </p>
                <div className="flex items-center justify-between gap-2">
                  <code className="text-on-surface truncate font-mono text-[0.6875rem]">
                    {displayEmail}
                  </code>
                  <button
                    type="button"
                    onClick={() => handleCopy("adminRolePrincipal", displayEmail)}
                    className="hover:bg-surface-raised text-on-surface-variant hover:text-on-surface shrink-0 rounded px-2 py-0.5 text-[0.6875rem] font-medium transition-colors"
                  >
                    {copiedField === "adminRolePrincipal" ? "Copied" : "Copy Principal Email"}
                  </button>
                </div>
              </div>

              <p className="text-on-surface-muted text-xs font-medium">
                Required Workspace Admin Console Role Privileges:
              </p>
              <ul className="text-on-surface-muted flex list-disc flex-col gap-1.5 pl-5 text-xs">
                <li>
                  <span className="text-on-surface font-medium">
                    Services &gt; Chrome Management &gt; Manage ChromeOS Devices
                  </span>{" "}
                  (Read-only)
                </li>
                <li>
                  <span className="text-on-surface font-medium">
                    Services &gt; Chrome Management &gt; Settings &gt; Managed Browsers
                  </span>
                </li>
                <li>
                  <span className="text-on-surface font-medium">
                    Services &gt; Chrome Enterprise Security Insights
                  </span>
                </li>
              </ul>
              <div className="pt-1">
                <a
                  href="https://admin.google.com/ac/roles"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-surface ring-on-surface/15 hover:ring-primary text-on-surface hover:text-primary inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ring-1 transition-all"
                >
                  Open Workspace Admin Roles Console
                  <ExternalLink className="size-3" />
                </a>
              </div>
            </div>

            {/* DWD Card */}
            <div className="bg-surface-dim ring-on-surface/10 flex flex-col gap-3 rounded-lg p-4 ring-1">
              <div className="flex items-center gap-2">
                <Lock className="text-primary size-4" />
                <h2 className="text-on-surface font-medium">
                  2. Domain-Wide Delegation (All 8 Required Scopes)
                </h2>
              </div>
              <p className="text-on-surface-variant text-xs leading-relaxed">
                Domain-Wide Delegation (<code>admin.google.com/ac/owl/domainwidedelegation</code>)
                authorizes your Service Account Client ID for all 8 Pocket CEP tool suites (Cloud
                Identity DLP Rules, Chrome Activity Logs, Org Units, Customer ID, Security Insights,
                Profiles). Authorize this complete scope list:
              </p>

              {identity?.clientId && (
                <div className="bg-surface rounded p-2.5 text-xs">
                  <p className="text-on-surface-muted mb-1 font-medium">
                    Client ID to Authorize in Admin Console:
                  </p>
                  <div className="flex items-center justify-between gap-2">
                    <code className="text-on-surface truncate font-mono text-[0.6875rem]">
                      {identity.clientId}
                    </code>
                    <button
                      type="button"
                      onClick={() => handleCopy("dwdClientId", identity.clientId!)}
                      className="hover:bg-surface-raised text-on-surface-variant hover:text-on-surface shrink-0 rounded px-2 py-0.5 text-[0.6875rem] font-medium transition-colors"
                    >
                      {copiedField === "dwdClientId" ? "Copied" : "Copy Client ID"}
                    </button>
                  </div>
                </div>
              )}

              <div className="bg-surface rounded p-2.5 text-xs">
                <p className="text-on-surface-muted mb-1 font-medium">
                  Complete 8-Scope String for Admin Console:
                </p>
                <div className="flex items-center justify-between gap-2">
                  <code className="text-on-surface truncate font-mono text-[0.6875rem]">
                    {DWD_POLICY_SCOPE}
                  </code>
                  <button
                    type="button"
                    onClick={() => handleCopy("scope", DWD_POLICY_SCOPE)}
                    className="hover:bg-surface-raised text-on-surface-variant hover:text-on-surface shrink-0 rounded px-2.5 py-1 text-[0.6875rem] font-medium transition-colors"
                  >
                    {copiedField === "scope" ? "Copied!" : "Copy All 8 Scopes"}
                  </button>
                </div>
              </div>

              <div className="pt-1">
                <a
                  href={dwdConsoleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-surface ring-on-surface/15 hover:ring-primary text-on-surface hover:text-primary inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ring-1 transition-all"
                >
                  Open Workspace Domain-Wide Delegation Console
                  <ExternalLink className="size-3" />
                </a>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
