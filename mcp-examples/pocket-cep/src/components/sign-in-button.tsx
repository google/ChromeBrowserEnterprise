/**
 * @file Google-branded sign-in button.
 *
 * Follows Google's Identity Services button guidelines:
 * white background, Google logo, specific padding/sizing.
 *
 * Uses BetterAuth's `signIn.social` method which redirects the browser
 * to Google's OAuth consent screen. After the user consents, Google
 * redirects back to /api/auth/callback/google (handled by the catch-all
 * route), which exchanges the code for tokens and sets the session
 * cookie. The `callbackURL` parameter tells BetterAuth where to
 * redirect the user after the entire flow completes.
 *
 * This component is only rendered on the landing page (user_oauth mode).
 * In service_account mode, the user never sees it because the middleware
 * auto-redirects to the dashboard.
 */

"use client";

import { authClient } from "@/lib/auth-client";

/**
 * Google-branded OAuth sign-in button. Initiates the full OAuth 2.0
 * authorization code flow via BetterAuth's social sign-in method.
 */
export function SignInButton() {
  const handleSignIn = async () => {
    await authClient.signIn.social({
      provider: "google",
      callbackURL: "/dashboard",
    });
  };

  return (
    <button
      type="button"
      onClick={handleSignIn}
      className="state-layer bg-surface text-on-surface focus-visible:outline-primary ring-on-surface/10 flex h-10 items-center gap-3 rounded-[var(--radius-xs)] pr-4 pl-3 font-medium shadow-[var(--shadow-elevation-1)] ring-1 focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <svg viewBox="0 0 24 24" className="size-[18px] shrink-0" aria-hidden="true">
        <path
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
          fill="#4285F4"
        />
        <path
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          fill="#34A853"
        />
        <path
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          fill="#FBBC05"
        />
        <path
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          fill="#EA4335"
        />
      </svg>
      Sign in with Google
    </button>
  );
}
