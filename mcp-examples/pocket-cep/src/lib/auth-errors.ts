/**
 * @file Typed auth-error classification for ADC / Admin SDK / MCP tool failures.
 *
 * One `toAuthError()` classifier for every surface. It turns whatever Google
 * happens to throw (OAuth JSON, gaxios error, plain string, or an MCP
 * tool-error message) into a single `AuthError` with a user-facing remedy.
 * Callers that don't want to hard-code error strings can rely on this type
 * and stop duplicating substring checks across the codebase.
 */

/**
 * Discriminated auth-error codes. `unknown_auth` is a deliberate escape
 * hatch — we'd rather show a generic "re-authenticate" nudge than miss
 * a classification entirely.
 */
export type AuthErrorCode =
  | "invalid_rapt"
  | "invalid_grant"
  | "no_adc"
  | "unauthenticated"
  | "unknown_auth";

/**
 * Wire shape every surface consumes: API 401 bodies, banner state, and
 * chat tool-error cards all serialize to this.
 */
export interface AuthErrorPayload {
  code: AuthErrorCode;
  source: "adc" | "mcp-tool" | "admin-sdk";
  message: string;
  remedy: string;
  command?: string;
  docsUrl?: string;
}

/**
 * Error class that carries an `AuthErrorPayload`. Throwing this from a
 * server call is how we signal "auth failed, here is the remedy" without
 * every caller re-matching strings.
 */
export class AuthError extends Error implements AuthErrorPayload {
  readonly code: AuthErrorCode;
  readonly source: AuthErrorPayload["source"];
  readonly remedy: string;
  readonly command?: string;
  readonly docsUrl?: string;

  /**
   * Human-readable summary. Stored separately because `this.message` is
   * overridden to the JSON-serialized payload so the AI SDK's
   * output-error state carries the structured data through to the chat UI.
   */
  readonly displayMessage: string;

  /**
   * Sets `this.message` to the JSON-serialized payload so the AI SDK's
   * output-error state carries the full structured data through to the UI.
   * The human-readable summary is available on `displayMessage` instead.
   */
  constructor(payload: AuthErrorPayload) {
    super(JSON.stringify(payload));
    this.name = "AuthError";
    this.displayMessage = payload.message;
    this.code = payload.code;
    this.source = payload.source;
    this.remedy = payload.remedy;
    this.command = payload.command;
    this.docsUrl = payload.docsUrl;
  }

  /**
   * Serializes the error back to the plain `AuthErrorPayload` shape for
   * transport across API boundaries and into UI state.
   */
  toPayload(): AuthErrorPayload {
    return {
      code: this.code,
      source: this.source,
      message: this.displayMessage,
      remedy: this.remedy,
      command: this.command,
      docsUrl: this.docsUrl,
    };
  }
}

/**
 * Type guard. Survives structured-clone and cross-realm issues by also
 * accepting `name === "AuthError"` shapes — useful when the error has
 * been re-thrown across async boundaries.
 */
export function isAuthError(err: unknown): err is AuthError {
  return (
    err instanceof AuthError ||
    (typeof err === "object" && err !== null && (err as { name?: string }).name === "AuthError")
  );
}

/**
 * Runtime guard for the `AuthErrorPayload` wire shape. Used by the
 * client fetch wrapper, the banner, and tool-error cards to validate
 * values that have crossed a JSON boundary (where compile-time types
 * are erased). Kept alongside `AuthError` so every consumer reaches for
 * the same canonical check.
 */
export function isAuthErrorPayload(value: unknown): value is AuthErrorPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<AuthErrorPayload>;
  return (
    typeof v.code === "string" &&
    typeof v.source === "string" &&
    typeof v.remedy === "string" &&
    typeof v.message === "string"
  );
}

type GoogleOAuthBody = {
  error?: string;
  error_description?: string;
  error_uri?: string;
  error_subtype?: string;
};

function asOAuthBody(value: unknown): GoogleOAuthBody | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as GoogleOAuthBody;
  if (typeof candidate.error !== "string") return null;
  return candidate;
}

function extractOAuthBody(err: unknown): GoogleOAuthBody | null {
  const direct = asOAuthBody(err);
  if (direct) return direct;

  if (err && typeof err === "object") {
    const nested = (err as { response?: { data?: unknown } }).response?.data;
    const fromResponse = asOAuthBody(nested);
    if (fromResponse) return fromResponse;
  }

  return null;
}

function extractMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "";
}

function buildPayload(
  code: AuthErrorCode,
  source: AuthErrorPayload["source"],
  docsUrl?: string,
): AuthErrorPayload {
  switch (code) {
    case "invalid_rapt":
      return {
        code,
        source,
        message: "Google requires you to re-authenticate.",
        remedy: "Run `gcloud auth login` and retry.",
        command: "gcloud auth login",
        docsUrl,
      };
    case "invalid_grant":
      return {
        code,
        source,
        message: "Your Google credentials are no longer valid.",
        remedy: "Run `gcloud auth login` to refresh them.",
        command: "gcloud auth login",
        docsUrl,
      };
    case "no_adc":
      return {
        code,
        source,
        message: "Google Application Default Credentials aren't configured.",
        remedy: "Run `gcloud auth application-default login` to set them up.",
        command: "gcloud auth application-default login",
        docsUrl,
      };
    case "unauthenticated":
      return {
        code,
        source,
        message: "Google rejected the request (UNAUTHENTICATED).",
        remedy: "Run `gcloud auth login` and confirm your account has access.",
        command: "gcloud auth login",
        docsUrl,
      };
    case "unknown_auth":
      return {
        code,
        source,
        message: "Pocket CEP couldn't authenticate the request to Google.",
        remedy: "Run `gcloud auth login` and retry.",
        command: "gcloud auth login",
        docsUrl,
      };
  }
}

/**
 * Classifies an arbitrary error as an `AuthError` when possible. Returns
 * null if the error isn't auth-related so callers can rethrow untouched.
 *
 * Recognised inputs:
 *   - Google OAuth JSON body (direct or nested under `response.data`)
 *   - `Error` / string messages containing `invalid_rapt`, `invalid_grant`,
 *     `UNAUTHENTICATED`, or the "Could not load the default credentials" phrase
 *   - MCP tool-error strings like "API Error: invalid_grant - ..."
 */
export function toAuthError(err: unknown, source: AuthErrorPayload["source"]): AuthError | null {
  const body = extractOAuthBody(err);
  if (body) {
    const docsUrl = body.error_uri;
    if (body.error_subtype === "invalid_rapt") {
      return new AuthError(buildPayload("invalid_rapt", source, docsUrl));
    }
    if (body.error === "invalid_grant") {
      return new AuthError(buildPayload("invalid_grant", source, docsUrl));
    }
    if (body.error === "unauthorized_client" || body.error === "access_denied") {
      return new AuthError(buildPayload("unauthenticated", source, docsUrl));
    }
  }

  const message = extractMessage(err);
  if (!message) return null;

  if (/invalid_rapt/i.test(message)) {
    return new AuthError(buildPayload("invalid_rapt", source));
  }
  if (/invalid_grant/i.test(message)) {
    return new AuthError(buildPayload("invalid_grant", source));
  }
  if (
    /Could not load the default credentials|application[- ]default[- ]credentials/i.test(message)
  ) {
    return new AuthError(buildPayload("no_adc", source));
  }
  if (/UNAUTHENTICATED|unauthorized/i.test(message)) {
    return new AuthError(buildPayload("unauthenticated", source));
  }

  return null;
}
