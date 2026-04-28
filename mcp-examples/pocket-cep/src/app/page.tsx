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

import { Shield } from "lucide-react";
import { SignInButton } from "@/components/sign-in-button";

/**
 * Static landing page with a Google-style centered sign-in card.
 * Deliberately simple: no data fetching, no session check. The
 * middleware handles redirect logic before this component renders.
 */
export default function LandingPage() {
  return (
    <div className="bg-surface-dim flex flex-1 items-center justify-center px-4">
      <main className="bg-surface ring-on-surface/10 flex w-full max-w-[400px] flex-col items-center gap-6 rounded-[var(--radius-md)] px-10 py-10 shadow-[var(--shadow-elevation-1)] ring-1">
        <div className="flex flex-col items-center gap-2">
          <Shield className="text-primary size-8" aria-hidden="true" />
          <h1 className="text-on-surface text-[1.375rem] font-medium text-balance">Pocket CEP</h1>
        </div>

        <p className="text-on-surface-variant text-center text-pretty">
          An educational companion for the Chrome Enterprise Premium MCP server. Investigate user
          activity and chat with an AI agent.
        </p>

        <SignInButton />

        <p className="text-on-surface-muted text-center text-sm text-pretty">
          Sign in with your Google Workspace account. Your credentials authenticate with the MCP
          server.
        </p>
      </main>

      {/** Subtle footer anchors the page and communicates the underlying technology. */}
      <footer className="absolute bottom-4">
        <p className="text-on-surface-muted text-[0.6875rem]">Powered by Model Context Protocol</p>
      </footer>
    </div>
  );
}
