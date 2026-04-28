/**
 * @file Diagnostic probe helpers used by `doctor.ts`.
 *
 * Each probe uses the lightest possible API call to verify credentials
 * without burning tokens or triggering rate limits.
 */

import { getErrorMessage } from "./errors";

/**
 * Result of a single diagnostic check. Used by the doctor scripts to
 * accumulate pass/fail counts and display colored output.
 */
export type CheckResult = { ok: boolean; message: string };

/** ANSI color codes for terminal output. */
export const PASS = "\x1b[32m✓\x1b[0m";
export const FAIL = "\x1b[31m✗\x1b[0m";
export const WARN = "\x1b[33m!\x1b[0m";
export const SKIP = "\x1b[90m○\x1b[0m";

/**
 * Model used for the Anthropic API key probe. Haiku is the cheapest
 * model — and with max_tokens: 1, the probe costs essentially nothing
 * even if the key is valid and the request succeeds.
 */
const ANTHROPIC_PROBE_MODEL = "claude-haiku-4-5-20251001";

/**
 * Checks whether the MCP server is reachable at the given URL.
 *
 * The MCP endpoint only accepts POST (JSON-RPC), so a GET returns 405.
 * Both 200 and 405 confirm the server is up — anything else (or a
 * network error) means it's unreachable.
 */
export async function probeMcpServer(serverUrl: string): Promise<CheckResult> {
  try {
    const response = await fetch(serverUrl, { method: "GET" });
    const reachable = response.status === 405 || response.status === 200;
    return {
      ok: reachable,
      message: reachable
        ? `MCP server reachable at ${serverUrl} (status: ${response.status})`
        : `MCP server returned unexpected status ${response.status} at ${serverUrl}`,
    };
  } catch (error) {
    return {
      ok: false,
      message: `MCP server not reachable at ${serverUrl} — ${getErrorMessage(error)}`,
    };
  }
}

/**
 * Probes an Anthropic API key by sending a minimal messages request.
 *
 * Any non-auth status (200, 400, 422, 429) means the key itself is valid.
 * Only 401/403 means the key is rejected. This approach avoids needing
 * a dedicated key-validation endpoint that doesn't exist in the API.
 */
export async function probeAnthropicKey(apiKey: string): Promise<CheckResult> {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_PROBE_MODEL,
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    const valid = response.status !== 401 && response.status !== 403;
    return {
      ok: valid,
      message: valid
        ? `Anthropic API key accepted (status: ${response.status})`
        : `Anthropic API key rejected (status: ${response.status})`,
    };
  } catch (error) {
    return { ok: false, message: `Anthropic API probe failed — ${getErrorMessage(error)}` };
  }
}

/**
 * Probes a Google AI API key by listing available models.
 *
 * The models endpoint is read-only and free, making it ideal for
 * key validation without side effects or token costs.
 */
export async function probeGeminiKey(apiKey: string): Promise<CheckResult> {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
    );

    const valid = response.status === 200;
    return {
      ok: valid,
      message: valid
        ? "Google AI API key accepted"
        : `Google AI API key rejected (status: ${response.status})`,
    };
  } catch (error) {
    return { ok: false, message: `Google AI API probe failed — ${getErrorMessage(error)}` };
  }
}

/**
 * Probes Google ADC by requesting an access token. Catches AuthError
 * and returns its remedy so the doctor can tell the user exactly what
 * to run — no more "ADC looks fine until the chat call fails".
 */
export async function probeAdcToken(): Promise<CheckResult> {
  try {
    const { getADCToken } = await import("./adc");
    await getADCToken();
    return { ok: true, message: "Google ADC token acquired" };
  } catch (error) {
    const { isAuthError } = await import("./auth-errors");
    if (isAuthError(error)) {
      const cmd = error.command ? ` (run: ${error.command})` : "";
      return {
        ok: false,
        message: `Google ADC unavailable — ${error.remedy}${cmd}`,
      };
    }
    return {
      ok: false,
      message: `Google ADC probe failed — ${getErrorMessage(error)}`,
    };
  }
}
