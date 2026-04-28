/**
 * @file Zod-validated environment variables for Pocket CEP.
 *
 * The two independent axes — AUTH_MODE and LLM_PROVIDER — form a 2x2
 * matrix of valid configurations. Each branch of the discriminated
 * union enforces the credentials its mode actually needs (Google OAuth
 * client ID/secret in user_oauth mode). LLM provider keys are optional
 * here; the chat route prefers a BYOK header and only falls back to
 * the env key.
 */

import { z } from "zod";
import { DEFAULT_MCP_URL } from "./constants";

/**
 * Regex-validated Google OAuth client ID. The strict format check catches
 * common copy-paste mistakes (e.g. trailing whitespace, wrapped in quotes)
 * before they show up as cryptic OAuth errors at runtime.
 */
const googleClientId = z
  .string()
  .min(1, "GOOGLE_CLIENT_ID is required in user_oauth mode.")
  .regex(
    /^\d+-\w+\.apps\.googleusercontent\.com$/,
    "GOOGLE_CLIENT_ID must match {numbers}-{hash}.apps.googleusercontent.com",
  );

const googleClientSecret = z
  .string()
  .min(1, "GOOGLE_CLIENT_SECRET is required in user_oauth mode.");

/**
 * Fields shared by both auth modes. Extracted so the two discriminated
 * union branches don't duplicate these definitions.
 */
const baseFields = {
  BETTER_AUTH_SECRET: z
    .string()
    .min(1, "BETTER_AUTH_SECRET is required. Run: openssl rand -base64 32"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  MCP_SERVER_URL: z.string().url().default(DEFAULT_MCP_URL),
  LLM_MODEL: z.string().default(""),
};

/**
 * In service_account mode, Google OAuth credentials are optional — the MCP
 * server authenticates with its own ADC (Application Default Credentials).
 */
const serviceAccountAuth = z.object({
  ...baseFields,
  AUTH_MODE: z.literal("service_account"),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
});

/**
 * In user_oauth mode, the user signs in with Google and the app forwards
 * their access token to the MCP server as a Bearer header. Both client ID
 * and secret are required for the OAuth consent flow.
 */
const userOAuthAuth = z.object({
  ...baseFields,
  AUTH_MODE: z.literal("user_oauth"),
  GOOGLE_CLIENT_ID: googleClientId,
  GOOGLE_CLIENT_SECRET: googleClientSecret,
});

const authSchema = z.discriminatedUnion("AUTH_MODE", [serviceAccountAuth, userOAuthAuth]);

const claudeProvider = z.object({
  LLM_PROVIDER: z.literal("claude"),
  ANTHROPIC_API_KEY: z.string().default(""),
  GOOGLE_AI_API_KEY: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),
});

const geminiProvider = z.object({
  LLM_PROVIDER: z.literal("gemini"),
  ANTHROPIC_API_KEY: z.string().default(""),
  GOOGLE_AI_API_KEY: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),
});

const llmSchema = z.discriminatedUnion("LLM_PROVIDER", [claudeProvider, geminiProvider]);

/**
 * Zod's discriminatedUnion requires the discriminant field to exist in the
 * input. Since .env files omit optional keys, we use preprocess to inject
 * defaults before the union attempts to match on the discriminant.
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Combined server schema: auth axis AND llm axis. The `.and()` intersection
 * merges both discriminated unions into a single flat type, so `getEnv()`
 * returns one object with all fields from both axes.
 */
/**
 * When `LLM_PROVIDER` is unset, pick the provider the developer
 * actually has a key for. Without this, a user who set only
 * `GOOGLE_AI_API_KEY` would still default to Claude and hit a
 * "missing key" error on first chat.
 */
function inferLlmProvider(raw: Record<string, unknown>): "claude" | "gemini" {
  const explicit = typeof raw.LLM_PROVIDER === "string" ? raw.LLM_PROVIDER : "";
  if (explicit) return explicit as "claude" | "gemini";
  const hasGemini = typeof raw.GOOGLE_AI_API_KEY === "string" && raw.GOOGLE_AI_API_KEY.trim() !== "";
  const hasClaude = typeof raw.ANTHROPIC_API_KEY === "string" && raw.ANTHROPIC_API_KEY.trim() !== "";
  if (hasGemini && !hasClaude) return "gemini";
  return "claude";
}

export const serverSchema = z.preprocess((raw) => {
  if (!isRecord(raw)) return raw;
  return {
    ...raw,
    AUTH_MODE: raw.AUTH_MODE || "service_account",
    LLM_PROVIDER: inferLlmProvider(raw),
  };
}, authSchema.and(llmSchema));

export type ServerEnv = z.infer<typeof serverSchema>;

/**
 * Structured issue surfaced by {@link EnvValidationError}. `path` is the
 * env var name (e.g. `"ANTHROPIC_API_KEY"`); `message` is the reason.
 */
export type EnvValidationIssue = {
  path: string;
  message: string;
};

/**
 * Thrown by {@link getEnv} when env validation fails. Carries the
 * structured list of issues so callers (the middleware, tests) can
 * render them however they want. Extends `Error` so existing
 * `instanceof Error` checks still work; the formatted multi-line
 * message is preserved for anyone logging `.message`.
 */
export class EnvValidationError extends Error {
  readonly issues: ReadonlyArray<EnvValidationIssue>;

  constructor(issues: ReadonlyArray<EnvValidationIssue>) {
    const formatted = issues.map((i) => `  - ${i.path}: ${i.message}`).join("\n");
    super(
      `\n\n[env] Environment validation failed:\n${formatted}\n\n` +
        "Run `npm run setup` to configure interactively, or see .env.local.example.\n",
    );
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

/**
 * Narrow type guard so `catch` blocks can branch without relying on
 * `instanceof` (which is lossy across module boundaries in some
 * bundlers).
 */
export function isEnvValidationError(err: unknown): err is EnvValidationError {
  return err instanceof Error && err.name === "EnvValidationError";
}

/** Module-level cache — env is validated once per process, not per request. */
let _env: ServerEnv | null = null;

/**
 * Returns the validated server environment, parsing on first call.
 * Throws {@link EnvValidationError} listing every invalid field at
 * once so you can fix all issues in a single pass.
 */
export function getEnv(): ServerEnv {
  if (_env) return _env;

  const result = serverSchema.safeParse(process.env);

  if (!result.success) {
    const issues: EnvValidationIssue[] = result.error.issues.map((issue) => ({
      path: issue.path.join(".") || "(root)",
      message: issue.message,
    }));
    throw new EnvValidationError(issues);
  }

  _env = result.data;
  return _env;
}

/**
 * Lazy proxy that defers environment parsing until a property is actually
 * accessed. This allows importing `env` at module scope without triggering
 * validation during Next.js compilation (where process.env isn't fully
 * populated yet).
 */
export const env = new Proxy({} as ServerEnv, {
  get(_target, prop: string) {
    return getEnv()[prop as keyof ServerEnv];
  },
});
