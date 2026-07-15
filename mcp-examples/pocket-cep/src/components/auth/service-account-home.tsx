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

interface DwdDiagnostics {
  subject: string;
  clientId: string;
  authorizedScopes: string[];
  missingScopes: string[];
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
  "https://www.googleapis.com/auth/apps.licensing",
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
  const [dwdDiagnostics, setDwdDiagnostics] = useState<DwdDiagnostics | null>(null);
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
    setDwdDiagnostics(null);

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
        if (data.dwdDiagnostics) {
          setDwdDiagnostics(data.dwdDiagnostics);
        }
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

        {/* Connect Form */}
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
              Leave blank for direct machine authentication (Option 2), or enter a Workspace user
              email for Domain-Wide Delegation (Option 1).
            </p>
          </div>

          {dwdDiagnostics ? (
            <div className="bg-error/10 border-error/30 text-on-surface flex flex-col gap-3 rounded-lg border p-4 text-xs">
              <div className="flex items-center justify-between gap-2">
                <p className="text-error font-semibold">Domain-Wide Delegation Scope Mismatch</p>
                <button
                  type="button"
                  onClick={() => handleCopy("all-missing", dwdDiagnostics.missingScopes.join(","))}
                  className="bg-error/20 text-error hover:bg-error/30 flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors"
                >
                  {copiedField === "all-missing" ? (
                    <>
                      <Check className="size-3" />
                      Copied All Missing
                    </>
                  ) : (
                    <>
                      <Copy className="size-3" />
                      Copy Missing ({dwdDiagnostics.missingScopes.length})
                    </>
                  )}
                </button>
              </div>
              <p className="text-on-surface-variant">
                We tested Domain-Wide Delegation for{" "}
                <strong className="text-on-surface">{dwdDiagnostics.subject}</strong>. Out of{" "}
                {dwdDiagnostics.authorizedScopes.length + dwdDiagnostics.missingScopes.length}{" "}
                required DWD scopes,{" "}
                <span className="text-error font-semibold">
                  {dwdDiagnostics.missingScopes.length} are currently missing
                </span>{" "}
                in your Admin Console allowlist:
              </p>
              <div className="bg-surface ring-on-surface/10 flex flex-col gap-1.5 rounded p-2.5 font-mono text-[0.6875rem] ring-1">
                {dwdDiagnostics.missingScopes.map((s) => (
                  <div key={s} className="flex items-center justify-between gap-2">
                    <span className="text-error truncate">{s}</span>
                    <button
                      type="button"
                      onClick={() => handleCopy(s, s)}
                      className="hover:bg-surface-raised text-on-surface-muted hover:text-on-surface flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[0.625rem] transition-colors"
                    >
                      {copiedField === s ? (
                        <Check className="text-success size-3" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
              {dwdDiagnostics.authorizedScopes.length > 0 && (
                <p className="text-success text-[0.6875rem] font-medium">
                  ✓ {dwdDiagnostics.authorizedScopes.length} scopes successfully verified as
                  authorized.
                </p>
              )}
              <p className="text-on-surface-muted text-[0.6875rem]">
                Add the missing scopes above comma-separated to Client ID{" "}
                <code className="text-on-surface font-mono">{dwdDiagnostics.clientId}</code> in{" "}
                <a
                  href="https://admin.google.com/ac/owl/domainwidedelegation"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline hover:opacity-80"
                >
                  Domain-Wide Delegation Settings
                </a>
                .
              </p>
            </div>
          ) : (
            error && (
              <div className="bg-error/10 text-error rounded-md p-2.5 text-xs font-medium">
                {error}
              </div>
            )
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

        {/* Two Ways to Authenticate Explanation Card */}
        <div className="bg-surface-dim ring-on-surface/10 flex flex-col gap-4 rounded-lg p-5 text-xs ring-1">
          <div className="flex items-center gap-2">
            <Shield className="text-primary size-4" />
            <h2 className="text-on-surface text-sm font-semibold">
              How Service Account Authentication Works
            </h2>
          </div>

          <div className="flex flex-col gap-3">
            <div className="border-on-surface/10 flex flex-col gap-1 border-l-2 pl-3">
              <span className="text-on-surface font-semibold">
                Option 1: Domain-Wide Delegation (With Impersonated User)
              </span>
              <p className="text-on-surface-variant leading-relaxed">
                Enter a Workspace admin/user email above. The Service Account will impersonate that
                user to access user-scoped directory &amp; policy tools (such as{" "}
                <strong className="text-on-surface">Cloud Identity DLP rules</strong> and{" "}
                <strong className="text-on-surface">Workspace Licensing</strong>). If any required
                DWD scopes are missing from your Admin Console allowlist, our diagnostic probe above
                will give you exact copy-paste buttons right when you connect.
              </p>
            </div>

            <div className="border-on-surface/10 flex flex-col gap-1 border-l-2 pl-3">
              <span className="text-on-surface font-semibold">
                Option 2: Direct Role Assignment (No Impersonated User)
              </span>
              <p className="text-on-surface-variant leading-relaxed">
                Leave the Impersonated User Email blank above. The Service Account authenticates as
                its own machine identity (
                <code className="text-on-surface font-mono">{displayEmail}</code>). This works
                cleanly out of the box for{" "}
                <strong className="text-on-surface">Chrome Management APIs</strong> (
                <code className="font-mono">security_insights</code>,{" "}
                <code className="font-mono">count_browser_versions</code>,{" "}
                <code className="font-mono">list_customer_profiles</code>) and{" "}
                <strong className="text-on-surface">Directory Org Units</strong> when directly
                assigned the required privileges in{" "}
                <a
                  href="https://admin.google.com/ac/roles"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline hover:opacity-80"
                >
                  Workspace Admin Roles Console
                </a>
                . Note: A single tool does not require one specific named role; any role or
                combination of roles granting those privileges will work (including multiple roles,
                a <strong>Custom Role</strong>, or pre-built roles such as{" "}
                <strong>Super Admin</strong> or <strong>Delegated Admin</strong>). If a tool lacks
                required privileges during execution, the agent will dynamically display the exact
                privilege hierarchy and a direct link to assign it.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
