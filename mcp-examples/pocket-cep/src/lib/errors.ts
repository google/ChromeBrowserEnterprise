/**
 * @file Shared error utilities.
 *
 * TypeScript's catch blocks type errors as `unknown`. This helper
 * provides a safe, consistent way to extract a human-readable message
 * from any caught value — avoiding the `error instanceof Error ? ...`
 * pattern repeated across every try/catch in the codebase.
 */

/**
 * Extracts a human-readable message from an unknown caught value.
 * Returns the fallback string if the value isn't an Error instance.
 *
 * Prefer this over inline `instanceof` checks — it keeps error handling
 * consistent and makes it easy to add structured logging or error
 * classification later (single point of change).
 */
export function getErrorMessage(error: unknown, fallback = "Unknown error"): string {
  if (error instanceof Error) {
    let causeText = "";
    if (error.cause) {
      causeText = ` (cause: ${error.cause instanceof Error ? error.cause.message : String(error.cause)})`;
    }
    return `${error.message}${causeText}`;
  }
  return fallback;
}
