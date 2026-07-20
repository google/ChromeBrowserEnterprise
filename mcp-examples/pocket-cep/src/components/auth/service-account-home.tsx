"use client";

/**
 * @file Service Account mode landing & setup screen (`AUTH_MODE="service_account"`).
 *
 * Displays the active machine identity (`client_email`, `client_id`, `project_id`),
 * comprehensive actionable checklists for assigning GCP IAM roles and Google Workspace
 * Domain-Wide Delegation permissions (with one-click Copy and deep UI console links),
 * and form controls to connect to the target Customer ID (`customerId`).
 */

import { useState, useEffect } from "react";
import {
  Shield,
  Key,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Copy,
  Check,
  CheckCircle2,
} from "lucide-react";
import type { ServiceAccountIdentity } from "@/lib/sa-identity";

interface ServiceAccountHomeProps {
  clientEmail?: string | null;
  identity?: ServiceAccountIdentity | null;
  initialCustomerId?: string;
  initialImpersonatedUser?: string;
  isConfigured?: boolean;
}

interface DwdDiagnostics {
  subject: string;
  clientId: string;
  authorizedScopes: string[];
  missingScopes: string[];
}

export function ServiceAccountHome({
  clientEmail,
  identity,
  initialCustomerId = "",
  initialImpersonatedUser = "",
  isConfigured = false,
}: ServiceAccountHomeProps) {
  const [step, setStep] = useState<"config" | "verify">("config");
  const [customerId, setCustomerId] = useState(initialCustomerId);
  const [impersonatedUser, setImpersonatedUser] = useState(initialImpersonatedUser);
  const [authMode, setAuthMode] = useState<"direct" | "dwd">(
    initialImpersonatedUser ? "dwd" : "direct",
  );
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dwdDiagnostics, setDwdDiagnostics] = useState<DwdDiagnostics | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const displayEmail =
    identity?.clientEmail || clientEmail || "Service Account Credentials Configured";

  useEffect(() => {
    if (
      step === "verify" &&
      initialCustomerId &&
      !verified &&
      !verifying &&
      !error &&
      !dwdDiagnostics
    ) {
      runVerification();
    }
  }, [step]);

  async function handleCopy(field: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Ignore clipboard failure on unsecure origin
    }
  }

  async function runVerification() {
    setVerifying(true);
    setError(null);
    setDwdDiagnostics(null);
    try {
      const res = await fetch("/api/auth/sa-verify");
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.verified) {
        if (data.dwdDiagnostics) {
          setDwdDiagnostics(data.dwdDiagnostics);
        }
        throw new Error(data.error || "Permission verification check failed.");
      }
      setVerified(true);
    } catch (err) {
      setVerified(false);
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Permission verification probe failed or could not reach server.",
      );
    } finally {
      setVerifying(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId.trim()) {
      setError("Please enter a valid Customer ID (e.g. C01234567)");
      return;
    }
    if (authMode === "dwd" && !impersonatedUser.trim()) {
      setError("Please enter the Workspace user email to impersonate for Domain-Wide Delegation.");
      return;
    }

    setLoading(true);
    setError(null);
    setDwdDiagnostics(null);
    setVerified(false);

    try {
      const res = await fetch("/api/auth/sa-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customerId.trim(),
          impersonatedUser: authMode === "dwd" ? impersonatedUser.trim() : "",
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.dwdDiagnostics) {
          setDwdDiagnostics(data.dwdDiagnostics);
        }
        setError(data.error || "Failed to save Service Account configuration");
        setStep("verify");
        setLoading(false);
        return;
      }

      setStep("verify");
      setLoading(false);
      runVerification();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
      setLoading(false);
    }
  }

  return (
    <div className="bg-surface-dim min-h-screen w-full overflow-y-auto px-4 py-10">
      <main className="bg-surface ring-on-surface/10 mx-auto flex w-full max-w-[560px] flex-col gap-6 rounded-[var(--radius-md)] p-8 shadow-[var(--shadow-elevation-1)] ring-1">
        {/* Header */}
        <div className="flex flex-col items-center gap-2 text-center">
          {step === "config" && isConfigured && (
            <div className="flex w-full justify-start">
              <a
                href="/dashboard"
                className="hover:bg-surface-raised text-on-surface-variant hover:text-on-surface inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
              >
                <ArrowLeft className="size-3.5" />
                Back to Dashboard
              </a>
            </div>
          )}
          {step === "verify" && (
            <div className="flex w-full justify-start">
              <button
                type="button"
                onClick={() => setStep("config")}
                className="hover:bg-surface-raised text-on-surface-variant hover:text-on-surface inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
              >
                <ArrowLeft className="size-3.5" />
                Back to Edit Credentials
              </button>
            </div>
          )}
          <div className="bg-primary/10 flex size-12 items-center justify-center rounded-full">
            <Shield className="text-primary size-6" aria-hidden="true" />
          </div>
          <h1 className="text-on-surface text-xl font-semibold">
            {step === "config"
              ? "Service Account Authentication"
              : "Step 2: Verification & Diagnostics"}
          </h1>
          <p className="text-on-surface-variant text-sm">
            {step === "config"
              ? "Configure target tenant credentials and select your authentication regime."
              : "Live verification of Service Account permissions against target Google Workspace & GCP tenant."}
          </p>
        </div>

        {/* Universal Machine Identity Display Card (Step 1 & 2) */}
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
        </div>

        {/* STEP 1: CONFIGURATION FORM */}
        {step === "config" && (
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

            <div className="flex flex-col gap-2 pt-1">
              <label className="text-on-surface text-sm font-medium">
                Authentication Mode <span className="text-error">*</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode("direct");
                    setError(null);
                    setDwdDiagnostics(null);
                  }}
                  className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-all ${
                    authMode === "direct"
                      ? "border-primary bg-primary/5 ring-primary ring-1"
                      : "border-on-surface/15 hover:bg-surface-raised bg-surface"
                  }`}
                >
                  <span className="text-on-surface text-xs font-semibold">
                    Direct Role Assignment
                  </span>
                  <span className="text-on-surface-muted text-[0.6875rem]">
                    No user impersonation
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setAuthMode("dwd");
                    setError(null);
                    setDwdDiagnostics(null);
                  }}
                  className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-all ${
                    authMode === "dwd"
                      ? "border-primary bg-primary/5 ring-primary ring-1"
                      : "border-on-surface/15 hover:bg-surface-raised bg-surface"
                  }`}
                >
                  <span className="text-on-surface text-xs font-semibold">
                    Domain-Wide Delegation
                  </span>
                  <span className="text-on-surface-muted text-[0.6875rem]">
                    Impersonate admin user
                  </span>
                </button>
              </div>

              {authMode === "direct" ? (
                <div className="bg-surface-dim ring-on-surface/10 mt-1 flex flex-col gap-1 rounded-md p-3.5 text-xs ring-1">
                  <p className="text-on-surface-variant leading-relaxed">
                    The Service Account authenticates directly as its own machine identity (
                    <code className="text-on-surface font-mono">{displayEmail}</code>).
                    <br />
                    <br />
                    To assign direct machine roles or custom IAM permissions for this identity,
                    visit the{" "}
                    <a
                      href="https://console.cloud.google.com/iam-admin/iam"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary font-medium underline hover:opacity-80"
                    >
                      Google Cloud IAM Console
                    </a>
                    .
                    <br />
                    <br />
                    <span className="text-error font-medium">Warning:</span> Cloud Identity DLP
                    rules/detectors and Workspace Licensing checks do not work in this mode and
                    require Domain-Wide Delegation instead.
                  </p>
                </div>
              ) : (
                <div className="bg-surface-dim ring-on-surface/10 mt-1 flex flex-col gap-3 rounded-md p-3.5 text-xs ring-1">
                  <p className="text-on-surface-variant leading-relaxed">
                    The Service Account acts on behalf of (impersonates) the Google Workspace admin
                    account entered below.
                  </p>
                  <div className="flex flex-col gap-1.5 pt-1">
                    <label
                      htmlFor="impersonatedUser"
                      className="text-on-surface text-xs font-medium"
                    >
                      Impersonated Admin Email <span className="text-error">*</span>
                    </label>
                    <input
                      id="impersonatedUser"
                      type="email"
                      required={authMode === "dwd"}
                      placeholder="e.g. admin@company.com"
                      value={impersonatedUser}
                      onChange={(e) => setImpersonatedUser(e.target.value)}
                      className="bg-surface ring-on-surface/20 focus:ring-primary text-on-surface placeholder:text-on-surface-muted rounded-md px-3 py-2 text-sm ring-1 transition-all outline-none focus:ring-2"
                    />
                  </div>
                </div>
              )}
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
                  Saving & Verifying Credentials...
                </>
              ) : (
                <>
                  {isConfigured ? "Update & Verify Credentials" : "Verify Credentials & Scopes"}
                  <ArrowRight className="size-4" />
                </>
              )}
            </button>
          </form>
        )}

        {/* STEP 2: VERIFICATION & DIAGNOSTICS */}
        {step === "verify" && (
          <div className="flex flex-col gap-5">
            {verifying ? (
              <div className="bg-surface-dim ring-on-surface/10 flex flex-col items-center justify-center gap-3 rounded-lg p-8 text-center ring-1">
                <Loader2 className="text-primary size-8 animate-spin" />
                <p className="text-on-surface text-sm font-medium">
                  Verifying Service Account token and OAuth scope authorization...
                </p>
                <p className="text-on-surface-muted text-xs">
                  Validating credentials for Customer ID{" "}
                  <strong className="text-on-surface font-mono">{customerId}</strong>
                </p>
              </div>
            ) : verified ? (
              <div className="bg-success/10 border-success/30 flex flex-col gap-4 rounded-lg border p-5">
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="text-success size-5 shrink-0" />
                  <h3 className="text-on-surface text-sm font-semibold">
                    Service Account Credentials & Scopes Verified
                  </h3>
                </div>
                <p className="text-on-surface-variant text-xs leading-relaxed">
                  Your machine identity{" "}
                  <strong className="text-on-surface font-mono">{displayEmail}</strong> successfully
                  minted an access token for Customer ID{" "}
                  <strong className="text-on-surface font-mono">{customerId}</strong> in{" "}
                  <strong>
                    {authMode === "dwd"
                      ? `Domain-Wide Delegation mode (impersonating ${impersonatedUser}) with required OAuth scopes authorized`
                      : "Direct Role Assignment mode"}
                  </strong>
                  . API role permissions will be checked dynamically when individual tools are run.
                </p>
                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setStep("config")}
                    className="border-on-surface/20 hover:bg-surface-raised text-on-surface flex w-1/3 items-center justify-center rounded-md border py-2.5 text-sm font-medium transition-colors"
                  >
                    Edit Credentials
                  </button>
                  <a
                    href="/dashboard"
                    className="bg-primary text-on-primary hover:bg-primary/90 flex w-2/3 items-center justify-center gap-2 rounded-md py-2.5 text-sm font-medium transition-colors"
                  >
                    Launch Dashboard
                    <ArrowRight className="size-4" />
                  </a>
                </div>
              </div>
            ) : dwdDiagnostics ? (
              <div className="bg-error/10 border-error/30 text-on-surface flex flex-col gap-4 rounded-lg border p-5 text-xs">
                <p className="text-error text-sm font-semibold">
                  ⚠️ Domain-Wide Delegation Required / Scope Mismatch
                </p>
                <p className="text-on-surface-variant leading-relaxed">
                  To use Domain-Wide Delegation for{" "}
                  <strong className="text-on-surface">{dwdDiagnostics.subject}</strong>, you must
                  authorize this Service Account in your Admin Console allowlist.
                </p>

                <div className="bg-surface ring-on-surface/10 flex flex-col gap-2 rounded-md p-3 ring-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-on-surface-muted text-[0.6875rem] font-semibold tracking-wider uppercase">
                      1. Copy Numeric Client ID
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy("diagClientId", dwdDiagnostics.clientId)}
                      className="hover:bg-surface-raised text-on-surface-variant hover:text-on-surface flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.6875rem] font-medium transition-colors"
                    >
                      {copiedField === "diagClientId" ? (
                        <>
                          <Check className="text-success size-3" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="size-3" />
                          Copy Client ID
                        </>
                      )}
                    </button>
                  </div>
                  <code className="text-on-surface font-mono text-xs select-all">
                    {dwdDiagnostics.clientId}
                  </code>
                </div>

                <div className="bg-surface ring-on-surface/10 flex flex-col gap-2 rounded-md p-3 ring-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-on-surface-muted text-[0.6875rem] font-semibold tracking-wider uppercase">
                      2. Copy Missing OAuth Scopes ({dwdDiagnostics.missingScopes.length})
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        handleCopy("all-missing", dwdDiagnostics.missingScopes.join(","))
                      }
                      className="hover:bg-surface-raised text-on-surface-variant hover:text-on-surface flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.6875rem] font-medium transition-colors"
                    >
                      {copiedField === "all-missing" ? (
                        <>
                          <Check className="text-success size-3" />
                          Copied All
                        </>
                      ) : (
                        <>
                          <Copy className="size-3" />
                          Copy All
                        </>
                      )}
                    </button>
                  </div>
                  <div className="flex max-h-36 flex-col gap-1.5 overflow-y-auto font-mono text-[0.6875rem]">
                    {dwdDiagnostics.missingScopes.map((s) => (
                      <div
                        key={s}
                        className="border-on-surface/5 flex items-center justify-between gap-2 border-b pb-1 last:border-0 last:pb-0"
                      >
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
                </div>

                <p className="text-on-surface-muted text-xs leading-relaxed">
                  3. Paste the Client ID and comma-separated scopes above into{" "}
                  <a
                    href="https://admin.google.com/ac/owl/domainwidedelegation"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary font-medium underline hover:opacity-80"
                  >
                    Google Workspace Domain-Wide Delegation
                  </a>{" "}
                  and click Authorize. Once saved, click Re-Verify Credentials below.
                </p>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setStep("config")}
                    className="border-on-surface/20 hover:bg-surface-raised text-on-surface flex w-1/3 items-center justify-center rounded-md border py-2.5 text-sm font-medium transition-colors"
                  >
                    Edit Credentials
                  </button>
                  <button
                    type="button"
                    onClick={runVerification}
                    className="bg-primary text-on-primary hover:bg-primary/90 flex w-2/3 items-center justify-center gap-2 rounded-md py-2.5 text-sm font-medium transition-colors"
                  >
                    ↻ Re-Verify Credentials
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-error/10 border-error/30 text-on-surface flex flex-col gap-4 rounded-lg border p-5 text-xs">
                <p className="text-error text-sm font-semibold">
                  ⚠️ Credential or Scope Verification Failed
                </p>
                <p className="text-on-surface-variant leading-relaxed">
                  We encountered an error while verifying token minting and OAuth scopes for
                  Customer ID <strong className="text-on-surface font-mono">{customerId}</strong>:
                </p>
                {error && (
                  <div className="bg-surface ring-on-surface/10 text-error rounded-md p-3 font-mono text-[0.6875rem] leading-relaxed break-words ring-1">
                    {error}
                  </div>
                )}
                <p className="text-on-surface-muted text-xs leading-relaxed">
                  Ensure Service Account{" "}
                  <strong className="text-on-surface font-mono">{displayEmail}</strong> is active
                  and your private key credentials are valid.
                </p>
                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setStep("config")}
                    className="border-on-surface/20 hover:bg-surface-raised text-on-surface flex w-1/3 items-center justify-center rounded-md border py-2.5 text-sm font-medium transition-colors"
                  >
                    Edit Credentials
                  </button>
                  <button
                    type="button"
                    onClick={runVerification}
                    className="bg-primary text-on-primary hover:bg-primary/90 flex w-2/3 items-center justify-center gap-2 rounded-md py-2.5 text-sm font-medium transition-colors"
                  >
                    ↻ Re-Verify Credentials
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
