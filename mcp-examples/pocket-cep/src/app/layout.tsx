/**
 * @file Root layout for the Pocket CEP app.
 *
 * Uses Roboto as a freely-available stand-in for Google Sans Text —
 * the typeface Google Workspace admin consoles actually ship with —
 * and Roboto Mono for identifiers and raw data. CSS variables expose
 * them so utilities and prose styles can reference them.
 */

import type { Metadata } from "next";
import { Roboto, Roboto_Mono } from "next/font/google";
import { AuthHealthProvider } from "@/components/auth-health-provider";
import { AuthBanner } from "@/components/auth-banner";
import { ModeProvider } from "@/components/mode-provider";
import { SwrProvider } from "@/components/swr-provider";
import { getEnv } from "@/lib/env";
import { getDefaultModelId } from "@/lib/models";
import "./globals.css";

/**
 * Roboto exposes 100/300/400/500/700/900 — no 600. Any `font-semibold`
 * class silently falls back to 500 if we don't load 700 explicitly, so
 * we load 400 (body), 500 (medium), and 700 (semibold/bold) only.
 */
const roboto = Roboto({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

const robotoMono = Roboto_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pocket CEP",
  description:
    "Educational companion for the Chrome Enterprise Premium MCP server. " +
    "Investigate user activity and chat with an AI-powered admin assistant.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  /**
   * Read the validated env on the server and forward the non-secret
   * flavor fields to the client `ModeProvider`. Passing through layout
   * props avoids a round-trip API call just to show badges.
   */
  const env = getEnv();
  const mode = {
    authMode: env.AUTH_MODE,
    llmProvider: env.LLM_PROVIDER,
    llmModel: env.LLM_MODEL || getDefaultModelId(env.LLM_PROVIDER),
    availableProviders: {
      anthropic: Boolean(env.ANTHROPIC_API_KEY),
      openai: Boolean(env.OPENAI_API_KEY),
      google: Boolean(env.GOOGLE_AI_API_KEY),
    },
  };

  return (
    <html lang="en" className={`${roboto.variable} ${robotoMono.variable} h-full`}>
      <body className="flex h-dvh flex-col overflow-hidden antialiased">
        <ModeProvider value={mode}>
          <AuthHealthProvider>
            <SwrProvider>
              <AuthBanner />
              {children}
            </SwrProvider>
          </AuthHealthProvider>
        </ModeProvider>
      </body>
    </html>
  );
}
