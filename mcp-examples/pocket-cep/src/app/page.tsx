/**
 * @file Landing page for Pocket CEP.
 *
 * Shows a compact sign-in card following Google's sign-in page patterns:
 * centered card, logo, title, description, and the branded sign-in button.
 *
 * This page is only visible in user_oauth mode. In service_account mode,
 * the middleware (src/proxy.ts) redirects "/" straight to /dashboard and
 * auto-creates a session, so users never see this page.
 *
 * The page is a React Server Component (no "use client") because it has
 * no interactive state -- the only interactive element (SignInButton) is
 * a separate client component imported below.
 */

import { redirect } from "next/navigation";
import { Shield } from "lucide-react";
import { SignInButton } from "@/components/sign-in-button";
import { getEnv } from "@/lib/env";

/**
 * Static landing page:
 * - In service_account mode, redirects to /sa-setup to configure target Customer ID and checklists.
 * - In user_oauth mode, displays standard Google-style centered sign-in card.
 */
export default async function LandingPage() {
  const env = getEnv();
  if (env.AUTH_MODE === "service_account") {
    redirect("/sa-setup");
  }

  return (
    <div className="bg-surface-dim flex flex-1 items-center justify-center px-4">
      <main className="bg-surface ring-on-surface/10 flex w-full max-w-[440px] flex-col items-center gap-6 rounded-[var(--radius-md)] px-8 py-10 shadow-[var(--shadow-elevation-1)] ring-1">
        <div className="flex flex-col items-center gap-1 text-center">
          <div className="bg-primary/10 text-primary mb-1 flex size-12 items-center justify-center rounded-full">
            <Shield className="size-6" aria-hidden="true" />
          </div>
          <h1 className="text-on-surface text-xl font-semibold tracking-tight">Pocket CEP</h1>
          <p className="text-on-surface-variant text-xs font-medium tracking-wider uppercase">
            Chrome Enterprise Premium
          </p>
        </div>

        <div className="text-on-surface-variant flex w-full flex-col gap-3 text-sm">
          <p className="text-center font-normal text-pretty">
            Your AI-powered administrative command center. Sign in to get started:
          </p>
          <ul className="text-on-surface/85 flex flex-col gap-2 rounded-lg bg-black/5 p-3.5 text-xs dark:bg-white/5">
            <li className="flex items-center gap-2.5">
              <span className="bg-primary flex size-1.5 shrink-0 rounded-full" />
              <span>
                <strong>Investigate</strong> user audit activity logs & telemetry
              </span>
            </li>
            <li className="flex items-center gap-2.5">
              <span className="bg-primary flex size-1.5 shrink-0 rounded-full" />
              <span>
                <strong>Learn</strong> about new Chrome security features
              </span>
            </li>
            <li className="flex items-center gap-2.5">
              <span className="bg-primary flex size-1.5 shrink-0 rounded-full" />
              <span>
                <strong>Manage</strong> your existing security controls & DLP rules
              </span>
            </li>
          </ul>
        </div>

        <SignInButton />

        <p className="text-on-surface-muted text-center text-xs text-pretty">
          Sign in with your Google Workspace admin account to authenticate against the MCP server.
        </p>
      </main>

      {/** Subtle footer anchors the page and communicates the underlying technology. */}
      <footer className="absolute bottom-4">
        <p className="text-on-surface-muted text-[0.6875rem]">Powered by Model Context Protocol</p>
      </footer>
    </div>
  );
}
