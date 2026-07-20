/**
 * @file Extracts the Google Cloud Service Account machine identity email (`client_email`).
 *
 * Reads either the `CEP_SERVICE_ACCOUNT_KEY_JSON` environment string or the
 * `GOOGLE_APPLICATION_CREDENTIALS` JSON file on disk. Used by the Service Account
 * Home Screen (`/`) to display the active machine identity to administrators.
 */

import fs from "fs/promises";
import os from "os";
import path from "path";

export interface ServiceAccountIdentity {
  clientEmail: string;
  clientId?: string;
  projectId?: string;
}

export interface ServiceAccountKeyData {
  client_email?: string;
  private_key?: string;
  client_id?: string;
  project_id?: string;
  [key: string]: unknown;
}

export interface LoadedServiceAccountKey {
  key: ServiceAccountKeyData;
  source: string;
  errors: string[];
}

/**
 * Loads and parses the Service Account key from environment variables or disk,
 * expanding tilde (`~`) syntax in file paths and tracking diagnostic errors.
 */
export async function loadServiceAccountKey(): Promise<LoadedServiceAccountKey | null> {
  const errors: string[] = [];
  const rawJson = process.env.CEP_SERVICE_ACCOUNT_KEY_JSON;

  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      return { key: parsed, source: "CEP_SERVICE_ACCOUNT_KEY_JSON", errors };
    } catch (err) {
      errors.push(
        `CEP_SERVICE_ACCOUNT_KEY_JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath) {
    const resolvedPath = credPath.startsWith("~/")
      ? path.join(os.homedir(), credPath.slice(2))
      : credPath;
    try {
      const content = await fs.readFile(resolvedPath, "utf-8");
      const parsed = JSON.parse(content);
      return { key: parsed, source: resolvedPath, errors };
    } catch (err) {
      errors.push(
        `GOOGLE_APPLICATION_CREDENTIALS (${resolvedPath}) read/parse failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else if (!rawJson) {
    errors.push(
      "Neither GOOGLE_APPLICATION_CREDENTIALS nor CEP_SERVICE_ACCOUNT_KEY_JSON is set in the environment",
    );
  }

  return errors.length > 0 ? { key: {}, source: "none", errors } : null;
}

/**
 * Retrieves the complete identity (`client_email`, `client_id`, `project_id`)
 * belonging to the active Service Account key.
 */
export async function getServiceAccountIdentity(): Promise<ServiceAccountIdentity | null> {
  const loaded = await loadServiceAccountKey();
  if (
    !loaded ||
    typeof loaded.key.client_email !== "string" ||
    loaded.key.client_email.length === 0
  ) {
    return null;
  }

  return {
    clientEmail: loaded.key.client_email,
    clientId: typeof loaded.key.client_id === "string" ? loaded.key.client_id : undefined,
    projectId: typeof loaded.key.project_id === "string" ? loaded.key.project_id : undefined,
  };
}

/**
 * Retrieves the client_email belonging to the active Service Account key.
 */
export async function getServiceAccountEmail(): Promise<string | null> {
  const identity = await getServiceAccountIdentity();
  return identity?.clientEmail || null;
}
