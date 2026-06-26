/**
 * @file Deterministic aggregation and formatting utilities for Chrome audit activity cards.
 */

/**
 * Key-value diagnostic parameter record attached to Chrome audit reports.
 */
export type ChromeEventParameter = {
  name?: string;
  value?: string;
};

/**
 * Chrome audit event record structure as retrieved from the CEP reporting service.
 */
export type ChromeAuditEvent = {
  id?: {
    time?: string;
    uniqueQualifier?: string;
  };
  actor?: {
    email?: string;
    profileId?: string;
  };
  eventName?: string;
  parameters?: ChromeEventParameter[];
};

/**
 * Extracts a clean domain hostname or string identifier from a raw URL.
 */
function getCleanTarget(rawUrl?: string) {
  if (!rawUrl) return "a restricted address";
  if (rawUrl.includes("chrome://")) {
    return rawUrl.slice(rawUrl.indexOf("chrome://"));
  }
  try {
    const normalized = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
    const parsed = new URL(normalized);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    const fallback = rawUrl.split("/")[0];
    return fallback || "a restricted address";
  }
}

/**
 * Retrieves the string value of a specific parameter from an audit event.
 */
function getParameterValue(parameters: ChromeEventParameter[] | undefined, keyName: string) {
  if (!parameters) return undefined;
  for (const param of parameters) {
    if (param.name === keyName && param.value) {
      return param.value;
    }
  }
  return undefined;
}

/**
 * Formats an incident tally into a bounded label string.
 */
function formatCount(count: number) {
  return count > 10 ? "10+ incidents" : `${count} ${count === 1 ? "incident" : "incidents"}`;
}

/**
 * Formats unique user count into an appropriate subject noun phrase.
 */
function formatSubject(userCount: number, selectedUser?: string) {
  if (selectedUser) return `User "${selectedUser}"`;
  if (userCount <= 1) return "A user";
  return `${userCount} users`;
}

/**
 * Formats the enforcement outcome sentence for a takeaway bullet point.
 */
function formatOutcome(blockedCount: number, warnedCount: number, totalCount: number) {
  const isAllBlocked = blockedCount === totalCount;
  const isAllWarned = warnedCount === totalCount;

  if (isAllBlocked) {
    if (totalCount === 2) return "Both attempts were blocked.";
    if (totalCount === 1) return "This attempt was blocked.";
    return `All ${totalCount > 10 ? "10+" : totalCount} attempts were blocked.`;
  }

  if (isAllWarned) {
    if (totalCount === 2) return "Both attempts triggered warnings.";
    if (totalCount === 1) return "This attempt triggered a warning.";
    return `All ${totalCount > 10 ? "10+" : totalCount} attempts triggered warnings.`;
  }

  if (blockedCount === 0 && warnedCount === 0) {
    return "";
  }

  if (blockedCount > 0 && warnedCount > 0) {
    const bStr =
      blockedCount === 1 ? "1 attempt was blocked" : `${blockedCount} attempts were blocked`;
    const wStr = warnedCount === 1 ? "1 triggered a warning" : `${warnedCount} triggered warnings`;
    return `${bStr} and ${wStr}.`;
  }
  if (blockedCount > 0) {
    return blockedCount === 1
      ? "One attempt was blocked."
      : `${blockedCount} attempts were blocked.`;
  }
  if (warnedCount > 0) {
    return warnedCount === 1
      ? "One attempt triggered a warning."
      : `${warnedCount} attempts triggered warnings.`;
  }

  return "";
}

/**
 * Formats target navigation or interaction phrase based on target variance and enforcement outcome.
 */
function formatTargetActivity(
  key: string,
  sampleTarget: string,
  targetCount: number,
  blockedCount: number,
): string {
  const isLongOrMissing = !sampleTarget || sampleTarget.length > 35;
  const isAttempt = blockedCount > 0;

  if (key.startsWith("AUDITED_")) {
    if (targetCount <= 1) {
      if (isLongOrMissing) {
        if (key === "AUDITED_NAVIGATION") return "visited a monitored address";
        if (key === "AUDITED_DLP") return "accessed monitored workspace services";
        if (key === "AUDITED_DOWNLOAD") return "downloaded monitored files";
        if (key === "AUDITED_EXTENSION") return "installed a browser extension";
        return "performed monitored activity";
      }
      if (key === "AUDITED_NAVIGATION") return `visited monitored address ${sampleTarget}`;
      if (key === "AUDITED_DLP") return `accessed workspace service ${sampleTarget}`;
      if (key === "AUDITED_DOWNLOAD") return `downloaded file ${sampleTarget}`;
      if (key === "AUDITED_EXTENSION") return `installed extension ${sampleTarget}`;
      return `performed activity involving ${sampleTarget}`;
    }
    if (isLongOrMissing) {
      if (key === "AUDITED_NAVIGATION") return "visited monitored addresses";
      if (key === "AUDITED_DLP") return "accessed monitored workspace services";
      if (key === "AUDITED_DOWNLOAD") return "downloaded monitored files";
      if (key === "AUDITED_EXTENSION") return "installed browser extensions";
      return "performed monitored activities";
    }
    if (key === "AUDITED_NAVIGATION") return `visited monitored addresses like ${sampleTarget}`;
    if (key === "AUDITED_DLP") return `accessed workspace services like ${sampleTarget}`;
    if (key === "AUDITED_DOWNLOAD") return `downloaded files like ${sampleTarget}`;
    if (key === "AUDITED_EXTENSION") return `installed extensions like ${sampleTarget}`;
    return `performed activities involving ${sampleTarget}`;
  }

  if (targetCount <= 1) {
    if (isLongOrMissing) {
      if (key === "DOWNLOAD")
        return isAttempt
          ? "attempted to download an unverified file"
          : "downloaded an unverified file";
      if (key === "DLP")
        return isAttempt
          ? "attempted to paste sensitive data into an unapproved app"
          : "pasted sensitive data into an unapproved app";
      if (key === "EXTENSION")
        return isAttempt
          ? "attempted to install a browser extension"
          : "installed a browser extension";
      if (key === "LOGIN")
        return isAttempt
          ? "attempted to log in from an unfamiliar location"
          : "logged in from an unfamiliar location";
      if (key === "OVERRIDE")
        return isAttempt
          ? "attempted to log temporary security overrides for a restricted address"
          : "logged temporary security overrides for a restricted address";
      if (key === "MALWARE")
        return isAttempt ? "attempted to visit an unsafe website" : "visited an unsafe website";
      if (key === "NAVIGATION")
        return isAttempt
          ? "attempted to visit a restricted website"
          : "visited a restricted website";
      return isAttempt ? "attempted to visit a restricted website" : "visited a restricted website";
    }

    if (key === "DOWNLOAD")
      return isAttempt ? `attempted to download ${sampleTarget}` : `downloaded ${sampleTarget}`;
    if (key === "DLP")
      return isAttempt
        ? `attempted to paste sensitive data into ${sampleTarget}`
        : `pasted sensitive data into ${sampleTarget}`;
    if (key === "EXTENSION")
      return isAttempt
        ? `attempted to install extension ${sampleTarget}`
        : `installed extension ${sampleTarget}`;
    if (key === "LOGIN")
      return isAttempt
        ? `attempted to log in from ${sampleTarget}`
        : `logged in from ${sampleTarget}`;
    if (key === "OVERRIDE")
      return isAttempt
        ? `attempted to log temporary security overrides for ${sampleTarget}`
        : `logged temporary security overrides for ${sampleTarget}`;
    return isAttempt ? `attempted to visit ${sampleTarget}` : `visited ${sampleTarget}`;
  }

  if (isLongOrMissing) {
    if (key === "DOWNLOAD")
      return isAttempt ? "attempted to download unverified files" : "downloaded unverified files";
    if (key === "DLP")
      return isAttempt
        ? "attempted to paste sensitive data into unapproved apps"
        : "pasted sensitive data into unapproved apps";
    if (key === "EXTENSION")
      return isAttempt ? "attempted to install browser extensions" : "installed browser extensions";
    if (key === "LOGIN")
      return isAttempt
        ? "attempted to log in from unfamiliar locations"
        : "logged in from unfamiliar locations";
    if (key === "OVERRIDE")
      return isAttempt
        ? "attempted to log temporary security overrides for restricted addresses"
        : "logged temporary security overrides for restricted addresses";
    if (key === "MALWARE")
      return isAttempt ? "attempted to visit unsafe websites" : "visited unsafe websites";
    if (key === "NAVIGATION")
      return isAttempt ? "attempted to visit restricted addresses" : "visited restricted addresses";
    return isAttempt ? "attempted to visit restricted websites" : "visited restricted websites";
  }

  if (key === "DOWNLOAD")
    return isAttempt
      ? `attempted to download unverified files like ${sampleTarget}`
      : `downloaded unverified files like ${sampleTarget}`;
  if (key === "DLP")
    return isAttempt
      ? `attempted to paste sensitive data into apps like ${sampleTarget}`
      : `pasted sensitive data into apps like ${sampleTarget}`;
  if (key === "EXTENSION")
    return isAttempt
      ? `attempted to install extensions like ${sampleTarget}`
      : `installed extensions like ${sampleTarget}`;
  if (key === "LOGIN")
    return isAttempt
      ? `attempted to log in from unfamiliar locations like ${sampleTarget}`
      : `logged in from unfamiliar locations like ${sampleTarget}`;
  if (key === "OVERRIDE")
    return isAttempt
      ? `attempted to log temporary security overrides for addresses like ${sampleTarget}`
      : `logged temporary security overrides for addresses like ${sampleTarget}`;
  if (key === "MALWARE")
    return isAttempt
      ? `attempted to visit unsafe sites like ${sampleTarget}`
      : `visited unsafe sites like ${sampleTarget}`;
  if (key === "NAVIGATION")
    return isAttempt
      ? `attempted to visit restricted addresses like ${sampleTarget}`
      : `visited restricted addresses like ${sampleTarget}`;
  return isAttempt
    ? `attempted to visit restricted sites like ${sampleTarget}`
    : `visited restricted sites like ${sampleTarget}`;
}

/**
 * Formats policy or security rule explanation based on rule variance and enforcement action.
 */
function formatPolicyEnforcement(
  key: string,
  sampleRule: string,
  ruleCount: number,
  blockedCount: number,
  warnedCount: number,
  totalCount: number,
): string {
  const hasValidRule = sampleRule && sampleRule.length <= 40;
  const isAllBlocked = blockedCount === totalCount && totalCount > 0;
  const isAllWarned = warnedCount === totalCount && totalCount > 0;
  const isAllAudited = blockedCount === 0 && warnedCount === 0 && totalCount > 0;

  let verbPrefix: string;
  if (isAllBlocked) {
    verbPrefix = key === "DLP" ? "blocked by" : "restricted by";
  } else if (isAllWarned) {
    verbPrefix = "flagged by";
  } else if (isAllAudited) {
    verbPrefix = "monitored by";
  } else {
    verbPrefix = "governed by";
  }

  if (key.startsWith("AUDITED_")) {
    const policyNoun = key === "AUDITED_EXTENSION" ? "browser extension" : "corporate audit";
    if (ruleCount > 1) {
      return hasValidRule
        ? `${verbPrefix} ${policyNoun} policies like "${sampleRule}"`
        : `${verbPrefix} ${policyNoun} policies`;
    }
    return hasValidRule
      ? `${verbPrefix} ${policyNoun} policy "${sampleRule}"`
      : `${verbPrefix} ${policyNoun} logging`;
  }

  if (ruleCount > 1) {
    if (hasValidRule) {
      if (key === "DLP") return `${verbPrefix} DLP policies like "${sampleRule}"`;
      if (key === "NAVIGATION")
        return `${verbPrefix} corporate URL blocklist policies like "${sampleRule}"`;
      if (key === "EXTENSION")
        return `${verbPrefix} browser extension policies like "${sampleRule}"`;
      if (key === "MALWARE" || key === "PASSWORD")
        return `${verbPrefix} Safe Browsing policies like "${sampleRule}"`;
      return `${verbPrefix} security policies like "${sampleRule}"`;
    }
    if (key === "DLP") return `${verbPrefix} corporate DLP policies`;
    if (key === "NAVIGATION") return `${verbPrefix} corporate URL blocklist policies`;
    if (key === "EXTENSION") return `${verbPrefix} browser extension policies`;
    if (key === "MALWARE" || key === "PASSWORD") return `${verbPrefix} Safe Browsing policies`;
    return `${verbPrefix} corporate security policies`;
  }

  if (hasValidRule) {
    if (key === "DLP") return `${verbPrefix} DLP policy "${sampleRule}"`;
    if (key === "NAVIGATION") return `${verbPrefix} corporate URL blocklist policy "${sampleRule}"`;
    if (key === "EXTENSION") return `${verbPrefix} browser extension policy "${sampleRule}"`;
    if (key === "MALWARE" || key === "PASSWORD")
      return `${verbPrefix} Safe Browsing policy "${sampleRule}"`;
    return `${verbPrefix} policy "${sampleRule}"`;
  }

  if (key === "DLP") return `${verbPrefix} corporate DLP policy`;
  if (key === "NAVIGATION") return `${verbPrefix} corporate URL blocklist policy`;
  if (key === "EXTENSION") return `${verbPrefix} browser extension policy`;
  if (key === "MALWARE" || key === "PASSWORD") return `${verbPrefix} Safe Browsing`;
  if (key === "DOWNLOAD") return `${verbPrefix} Enterprise Threat Protection`;
  if (key === "LOGIN") return `${verbPrefix} identity monitoring`;
  if (key === "OVERRIDE") return `${verbPrefix} admin configuration`;
  return `${verbPrefix} reporting policy`;
}

/**
 * Normalizes unknown tool response content into a typed Chrome audit event array.
 */
function extractEventsArray(eventsData: unknown): ChromeAuditEvent[] {
  if (!eventsData) return [];

  if (Array.isArray(eventsData)) {
    const first = eventsData[0];
    if (
      first &&
      typeof first === "object" &&
      "text" in first &&
      typeof (first as Record<string, unknown>).text === "string"
    ) {
      try {
        const parsed = JSON.parse((first as Record<string, string>).text);
        return extractEventsArray(parsed);
      } catch {
        /* ignore JSON parse failure and fall through to array processing */
      }
    }

    const flattened: ChromeAuditEvent[] = [];
    for (const item of eventsData) {
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        if (Array.isArray(record.events)) {
          const idVal = record.id as ChromeAuditEvent["id"];
          const actorVal = record.actor as ChromeAuditEvent["actor"];
          for (const ev of record.events) {
            if (ev && typeof ev === "object") {
              const evObj = ev as Record<string, unknown>;
              flattened.push({
                id: idVal,
                actor: actorVal,
                eventName:
                  typeof evObj.name === "string"
                    ? evObj.name
                    : typeof evObj.eventName === "string"
                      ? evObj.eventName
                      : undefined,
                parameters: Array.isArray(evObj.parameters)
                  ? (evObj.parameters as ChromeEventParameter[])
                  : undefined,
              });
            }
          }
          continue;
        }
      }
      flattened.push(item as ChromeAuditEvent);
    }
    return flattened;
  }

  if (typeof eventsData === "object" && eventsData !== null) {
    const obj = eventsData as Record<string, unknown>;
    if (Array.isArray(obj.activities)) {
      return extractEventsArray(obj.activities);
    }
    if (Array.isArray(obj.items)) {
      return extractEventsArray(obj.items);
    }
    if (Array.isArray(obj.events)) {
      return extractEventsArray(obj.events);
    }
  }

  if (typeof eventsData === "string") {
    try {
      const parsed = JSON.parse(eventsData);
      return extractEventsArray(parsed);
    } catch {
      return [];
    }
  }

  return [];
}

/**
 * Internal bucket tracker aggregating incident statistics for a security category.
 */
type CategoryBucket = {
  label: string;
  key: string;
  totalCount: number;
  uniqueUsers: Set<string>;
  uniqueTargets: Set<string>;
  uniqueRules: Set<string>;
  blockedCount: number;
  warnedCount: number;
  detectedOnlyCount: number;
  sampleTarget: string;
  sampleRule: string;
  sampleScore: number;
  priority: number;
};

/**
 * Severity multipliers for each activity category.
 */
const CATEGORY_WEIGHTS: Record<string, number> = {
  MALWARE: 10,
  PASSWORD: 10,
  DOWNLOAD: 5,
  DLP: 5,
  NAVIGATION: 2,
  EXTENSION: 1.5,
  LOGIN: 1,
  OTHER: 1,
  AUDITED_NAVIGATION: 0.2,
  AUDITED_DLP: 0.2,
  AUDITED_DOWNLOAD: 0.2,
  AUDITED_EXTENSION: 0.2,
};

/**
 * Multipliers for enforcement actions based on organizational risk.
 * Unblocked events (warnings or allowed actions) represent active exposure.
 */
const ACTION_MULTIPLIERS = {
  BLOCKED: 1.0,
  WARNED: 2.0,
  AUDITED: 0.5,
} as const;

/**
 * Computes the risk score for a category bucket.
 * Risk factor sums weighted blocked vs unblocked volume multiplied by threat category severity.
 */
function computeBucketRiskScore(bucket: CategoryBucket): number {
  const actionVolume =
    bucket.blockedCount * ACTION_MULTIPLIERS.BLOCKED +
    bucket.warnedCount * ACTION_MULTIPLIERS.WARNED +
    bucket.detectedOnlyCount * ACTION_MULTIPLIERS.AUDITED;
  const categoryWeight =
    CATEGORY_WEIGHTS[bucket.key] ?? (bucket.key.startsWith("AUDITED_") ? 0.1 : 1);
  return actionVolume * categoryWeight;
}

/**
 * Formats an unknown event name string into Title Case label.
 */
function formatEventNameAsLabel(evtName: string): string {
  if (!evtName) return "General Security Events";
  return evtName
    .toLowerCase()
    .split(/[__\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Resolves category metadata and priority ranking from a raw event name.
 */
function resolveBucketKey(
  evtName: string,
  isAudited = false,
): {
  key: string;
  label: string;
  sampleTarget: string;
  priority: number;
} {
  const upper = evtName.toUpperCase();
  if (isAudited) {
    if (
      upper.includes("URL_FILTER") ||
      upper.includes("NAVIGATION") ||
      upper.includes("POLICY_WARNING")
    ) {
      return {
        key: "AUDITED_NAVIGATION",
        label: "Audited URL Navigation",
        sampleTarget: "accounts.google.com",
        priority: 6,
      };
    }
    if (upper.includes("DLP") || upper.includes("DATA_LOSS")) {
      return {
        key: "AUDITED_DLP",
        label: "Audited Workspace Traffic",
        sampleTarget: "Google Workspace service",
        priority: 6,
      };
    }
    if (upper.includes("DOWNLOAD") || upper.includes("TRANSFER")) {
      return {
        key: "AUDITED_DOWNLOAD",
        label: "Monitored Downloads",
        sampleTarget: "monitored file",
        priority: 6,
      };
    }
    if (upper.includes("EXTENSION")) {
      return {
        key: "AUDITED_EXTENSION",
        label: "Audited Extension Install",
        sampleTarget: '"PDF Helper"',
        priority: 6,
      };
    }
    const dynamicLabel = `Audited ${formatEventNameAsLabel(evtName)}`;
    return {
      key: `AUDITED_${formatEventNameAsLabel(evtName).toUpperCase()}`,
      label: dynamicLabel,
      sampleTarget: "monitored target",
      priority: 6,
    };
  }

  if (upper.includes("MALWARE") || upper.includes("UNSAFE_SITE")) {
    return {
      key: "MALWARE",
      label: "Malware & Unsafe Sites",
      sampleTarget: "gleapis.com",
      priority: 1,
    };
  }
  if (upper.includes("PASSWORD") || upper.includes("CREDENTIAL")) {
    return {
      key: "PASSWORD",
      label: "Password Reuse",
      sampleTarget: "untrusted site",
      priority: 1,
    };
  }
  if (upper.includes("DOWNLOAD") || upper.includes("TRANSFER")) {
    return {
      key: "DOWNLOAD",
      label: "Unsafe Downloads",
      sampleTarget: "installer.exe",
      priority: 1,
    };
  }
  if (upper.includes("DLP") || upper.includes("DATA_LOSS")) {
    return {
      key: "DLP",
      label: "DLP Rule Violations",
      sampleTarget: "Slack",
      priority: 2,
    };
  }
  if (
    upper.includes("URL_FILTER") ||
    upper.includes("NAVIGATION") ||
    upper.includes("POLICY_WARNING")
  ) {
    return {
      key: "NAVIGATION",
      label: "Restricted URL Navigation",
      sampleTarget: "chrome://flags",
      priority: 3,
    };
  }
  if (upper.includes("EXTENSION")) {
    return {
      key: "EXTENSION",
      label: "Browser Extensions",
      sampleTarget: '"PDF Helper"',
      priority: 3,
    };
  }
  if (upper.includes("LOGIN") || upper.includes("AUTH")) {
    return {
      key: "LOGIN",
      label: "Suspicious Logins",
      sampleTarget: "unfamiliar IP address",
      priority: 4,
    };
  }
  if (upper.includes("OVERRIDE")) {
    return {
      key: "OVERRIDE",
      label: "Policy Overrides",
      sampleTarget: "restricted site",
      priority: 4,
    };
  }

  const dynamicLabel = formatEventNameAsLabel(evtName);
  return {
    key: dynamicLabel.toUpperCase(),
    label: dynamicLabel,
    sampleTarget: "restricted address",
    priority: 5,
  };
}

/**
 * Extracts a concrete target (URL domain, filename, extension) from event parameters.
 */
function extractConcreteTarget(params?: ChromeEventParameter[]): string | undefined {
  if (!params) return undefined;
  const urlVal =
    getParameterValue(params, "URL") ??
    getParameterValue(params, "SITE") ??
    getParameterValue(params, "TARGET");
  if (urlVal) return getCleanTarget(urlVal);

  const fileVal = getParameterValue(params, "FILE_NAME") ?? getParameterValue(params, "FILE_PATH");
  if (fileVal) return fileVal.split("/").pop() ?? undefined;

  const extVal =
    getParameterValue(params, "EXTENSION_NAME") ??
    getParameterValue(params, "EXTENSION") ??
    getParameterValue(params, "APP_NAME") ??
    getParameterValue(params, "NAME") ??
    getParameterValue(params, "TITLE");
  if (extVal) return `"${extVal}"`;

  return undefined;
}

/**
 * Extracts numeric timestamp in milliseconds from a Chrome audit event.
 */
function getEventTimestamp(ev: ChromeAuditEvent): number {
  if (ev.id?.time) {
    const parsed = Date.parse(ev.id.time);
    if (!Number.isNaN(parsed)) return parsed;
  }
  const tsParam = getParameterValue(ev.parameters, "TIMESTAMP");
  if (tsParam) {
    const num = Number(tsParam);
    if (!Number.isNaN(num)) {
      return num > 1e11 ? num : num * 1000;
    }
  }
  return 0;
}

/**
 * Deduplicates bursty Chrome audit events occurring within a 60-second session window.
 */
function clusterAuditEvents(events: ChromeAuditEvent[]): ChromeAuditEvent[] {
  const sorted = [...events].sort((a, b) => getEventTimestamp(a) - getEventTimestamp(b));
  const clustered: ChromeAuditEvent[] = [];
  const activeSessions = new Map<
    string,
    { lastTime: number; event: ChromeAuditEvent; hasBlock: boolean; hasWarn: boolean }
  >();

  for (const ev of sorted) {
    const email = ev.actor?.email ?? "unknown@user";
    const evtName = ev.eventName ?? "";
    const target = extractConcreteTarget(ev.parameters) ?? "";
    const time = getEventTimestamp(ev);

    const key = `${email}|${evtName}|${target}`;
    const existing = activeSessions.get(key);

    const actionVal =
      getParameterValue(ev.parameters, "ACTION") ??
      getParameterValue(ev.parameters, "EVENT_RESULT");
    const upperAction = actionVal?.toUpperCase() ?? "";
    const isBlock = actionVal ? upperAction.includes("BLOCK") : true;
    const isWarn = !isBlock && (upperAction.includes("WARN") || upperAction.includes("ALERT"));

    if (
      existing &&
      time > 0 &&
      existing.lastTime > 0 &&
      Math.abs(time - existing.lastTime) <= 60000
    ) {
      existing.lastTime = Math.max(existing.lastTime, time);
      existing.hasBlock = existing.hasBlock || isBlock;
      existing.hasWarn = existing.hasWarn || isWarn;

      if (existing.hasBlock && existing.event.parameters) {
        const actionParam = existing.event.parameters.find(
          (p) => p.name === "ACTION" || p.name === "EVENT_RESULT",
        );
        if (actionParam) actionParam.value = "BLOCK";
        else existing.event.parameters.push({ name: "ACTION", value: "BLOCK" });
      } else if (existing.hasWarn && !existing.hasBlock && existing.event.parameters) {
        const actionParam = existing.event.parameters.find(
          (p) => p.name === "ACTION" || p.name === "EVENT_RESULT",
        );
        if (actionParam) actionParam.value = "WARN";
        else existing.event.parameters.push({ name: "ACTION", value: "WARN" });
      }
    } else {
      activeSessions.set(key, { lastTime: time, event: ev, hasBlock: isBlock, hasWarn: isWarn });
      clustered.push(ev);
    }
  }

  return clustered;
}

/**
 * Summarizes raw Chrome audit log records into a scannable Markdown bullet list
 * matching the exact multi-sentence structure and counting bounds of the LLM card.
 */
export function summarizeChromeActivity(eventsData: unknown, selectedUser?: string) {
  const rawEvents = extractEventsArray(eventsData);
  const events = clusterAuditEvents(rawEvents);

  if (events.length === 0) {
    const scopeStr = selectedUser ? `for user "${selectedUser}"` : "across the organization";
    return `- **No Risky Activity (0 incidents):** No high-severity security events or policy violations were logged ${scopeStr} during this period.`;
  }

  const buckets = new Map<string, CategoryBucket>();

  for (const ev of events) {
    const email = ev.actor?.email ?? selectedUser ?? "unknown@user";
    const evtName = ev.eventName ?? "";
    const params = ev.parameters;

    const actionVal =
      getParameterValue(params, "ACTION") ?? getParameterValue(params, "EVENT_RESULT");
    const upperAction = actionVal?.toUpperCase() ?? "";
    const isBlocked = actionVal ? upperAction.includes("BLOCK") : true;
    const isWarned = !isBlocked && (upperAction.includes("WARN") || upperAction.includes("ALERT"));
    const isAudited = !isBlocked && !isWarned;

    const meta = resolveBucketKey(evtName, isAudited);
    let bucket = buckets.get(meta.key);
    if (!bucket) {
      bucket = {
        label: meta.label,
        key: meta.key,
        totalCount: 0,
        uniqueUsers: new Set<string>(),
        uniqueTargets: new Set<string>(),
        uniqueRules: new Set<string>(),
        blockedCount: 0,
        warnedCount: 0,
        detectedOnlyCount: 0,
        sampleTarget: "",
        sampleRule: "",
        sampleScore: -1,
        priority: meta.priority,
      };
      buckets.set(meta.key, bucket);
    }
    const current = bucket;

    current.totalCount += 1;
    current.uniqueUsers.add(email);

    if (isBlocked) current.blockedCount += 1;
    else if (isWarned) current.warnedCount += 1;
    else current.detectedOnlyCount += 1;

    let ruleVal =
      getParameterValue(params, "RULE_NAME") ??
      getParameterValue(params, "TRIGGER") ??
      getParameterValue(params, "POLICY_NAME") ??
      getParameterValue(params, "RULE") ??
      getParameterValue(params, "POLICY") ??
      getParameterValue(params, "REASON") ??
      getParameterValue(params, "DETECTOR_NAME");
    if (!ruleVal) {
      if (meta.key === "NAVIGATION") ruleVal = "URLAllowlist / URLBlocklist";
      else if (meta.key === "AUDITED_NAVIGATION") ruleVal = "Chrome URL Monitoring";
      else if (meta.key === "EXTENSION") ruleVal = "ExtensionInstallBlocklist";
      else if (meta.key === "AUDITED_EXTENSION") ruleVal = "ExtensionLogger";
      else if (meta.key === "MALWARE" || meta.key === "PASSWORD")
        ruleVal = "SafeBrowsingProtectionLevel";
      else if (meta.key === "DOWNLOAD") ruleVal = "DownloadRestrictions";
      else if (meta.key === "AUDITED_DOWNLOAD") ruleVal = "Chrome Download Monitoring";
      else if (meta.key === "DLP") ruleVal = "Sensitive Data Protection";
      else if (meta.key === "AUDITED_DLP") ruleVal = "Chrome Traffic Auditing";
      else if (meta.key === "LOGIN") ruleVal = "Identity Threat Protection";
      else if (meta.key === "OVERRIDE") ruleVal = "SecurityOverrideAllowlist";
      else ruleVal = "ChromeReportingPolicy";
    }

    const concreteTarget = extractConcreteTarget(params);
    if (concreteTarget) {
      current.uniqueTargets.add(concreteTarget);
    }
    current.uniqueRules.add(ruleVal);

    const actionScore = isBlocked ? 6 : isWarned ? 3 : 0;
    const targetScore = concreteTarget && concreteTarget.length <= 35 ? 10 : 0;
    const ruleScore = ruleVal && ruleVal.length <= 40 ? 10 : 0;
    const pairScore = actionScore + targetScore + ruleScore;

    if (pairScore > current.sampleScore) {
      current.sampleScore = pairScore;
      current.sampleTarget = concreteTarget ?? current.sampleTarget;
      current.sampleRule = ruleVal ?? current.sampleRule;
    }
  }

  const activeBuckets = Array.from(buckets.values()).sort((a, b) => {
    const aEnforced = a.blockedCount + a.warnedCount > 0 ? 1 : 0;
    const bEnforced = b.blockedCount + b.warnedCount > 0 ? 1 : 0;
    if (aEnforced !== bEnforced) return bEnforced - aEnforced;
    return computeBucketRiskScore(b) - computeBucketRiskScore(a) || b.totalCount - a.totalCount;
  });

  if (activeBuckets.length === 0) {
    return `- **No Risky Activity (0 incidents):** No high-severity security events or policy violations were logged during this period.`;
  }

  const bullets: string[] = [];
  const topBuckets = activeBuckets.slice(0, 2);

  for (const b of topBuckets) {
    const userStr = formatSubject(b.uniqueUsers.size, selectedUser);
    const countStr = formatCount(b.totalCount);
    const activityStr = formatTargetActivity(
      b.key,
      b.sampleTarget,
      b.uniqueTargets.size,
      b.blockedCount,
    );
    const policyStr = formatPolicyEnforcement(
      b.key,
      b.sampleRule,
      b.uniqueRules.size,
      b.blockedCount,
      b.warnedCount,
      b.totalCount,
    );
    const outcomeStr = formatOutcome(b.blockedCount, b.warnedCount, b.totalCount);
    const whichVerb = b.uniqueTargets.size > 1 ? "which are" : "which is";
    const outcomeSuffix = outcomeStr ? ` ${outcomeStr}` : "";

    bullets.push(
      `- **${b.label} (${countStr}):** ${userStr} ${activityStr}, ${whichVerb} ${policyStr}.${outcomeSuffix}`,
    );
  }

  const overflowBuckets = activeBuckets.slice(2);
  if (overflowBuckets.length > 0) {
    const overflowTotal = overflowBuckets.reduce((acc, curr) => acc + curr.totalCount, 0);
    const countLabel = overflowTotal > 10 ? "10+" : `${overflowTotal}`;
    const incidentNoun =
      overflowTotal === 1
        ? "incident occurred across other categories"
        : "incidents occurred across other categories";
    bullets.push(
      `- **Additional Activity (${formatCount(overflowTotal)}):** ${countLabel} other ${incidentNoun}.`,
    );
  }

  return bullets.join("\n");
}
