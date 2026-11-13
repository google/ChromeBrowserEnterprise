/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ==============================================================================
 * CHROME EGRESS RISK ANALYSIS (CERA)
 * Module: DataAggregators.gs
 * Description: Telemetry state schema, multi-vector hit recording & aggregators
 * ==============================================================================
 */

/**
 * Creates an empty vector aggregator for a monitored threat vector
 */
function createVectorAggregator(key, name, color) {
  return {
    key: key,
    name: name,
    color: color,
    totalBytes: 0,
    totalEvents: 0,
    users: {},
    timeline: {},
    actors: {},
    actions: {
      upload: { bytes: 0, count: 0, types: {}, ous: {}, domains: {}, cats: {} },
      download: { bytes: 0, count: 0, types: {}, ous: {}, domains: {}, cats: {} },
      print: { bytes: 0, count: 0, types: {}, ous: {}, domains: {}, cats: {} },
      // Paste events of log sources that report them. Chrome reports a paste into a page as WEB_CONTENT_UPLOAD,
      // counted as upload; a clipboard copy (CLIPBOARD_COPY) is not outbound and goes to state.copies.
      paste: { bytes: 0, count: 0, types: {}, ous: {}, domains: {}, cats: {} }
    },
    // Outbound-only volume for this vector: actions in CeraConfig.EGRESS_ACTIONS but print, which is in no vector
    // (upload incl. web content upload, paste). Downloads are excluded. users: who sent data out, with their
    // outbound bytes and actions, so user counts on a slide use the same basis as its volumes. bytes and count are
    // what was attempted; left / stopped / outcomes split them by policy outcome (ceraRecordOutcome_);
    // sensitiveLeft: sensitive outbound actions that left. kinds (once an outbound action is recorded): the same
    // actions as file uploads, pastes into a page and prints (ceraRecordOutboundKind_).
    egress: Object.assign({ bytes: 0, count: 0, users: {}, sensitiveLeft: 0 }, ceraOutcomeTally_()),
    // Counted events that Chrome reported as "Content unscanned" (flag survives deduplication)
    unscanned: { bytes: 0, count: 0 },
    ous: {},
    domains: {},
    types: {},
    // Outbound actions by file family (ceraFileFamily_: pdf, spreadsheet, presentation, document, archive, image,
    // video, audio, text, code, executable, extension, other): family -> { bytes, count }
    families: {},
    cats: {},
    sensitivity: {
      sensitiveCount: 0,
      nonSensitiveCount: 0,
      detectors: { CREDIT_CARD_NUMBER: 0, PHONE_NUMBER: 0, EMAIL_ADDRESS: 0, OTHER: 0 }
    }
  };
}

/**
 * Creates pristine telemetry state object with mutex threat vectors and anomaly buckets
 */
function createInitialState() {
  return {
    totalEvents: 0,
    totalBytes: 0,
    minDate: null,
    maxDate: null,
    // First and last calendar day (yyyy-MM-dd) of the rows read, by the rule of every day key: the offset a time was
    // written with, otherwise the report time zone (ceraLocalDayKey)
    firstDayKey: '',
    lastDayKey: '',
    // Data-protection outcomes the logs carry (Event Result column of the rows ceraIsDataProtectionRow_ accepts,
    // ceraNoteEventResult_). mode: 'enforced' once any such row shows a policy enforcing (CeraConfig.OUTCOME_ENFORCED),
    // 'audit' when they report results but only detections, 'not_reported' when none carries a result; reported and
    // enforced say the same as booleans. other: results of no known class (value -> rows), disclosed in the workbook.
    outcomes: { mode: 'not_reported', reported: false, enforced: false, other: {} },
    globalOUs: {},
    globalTypes: {},
    globalDomains: {},
    globalCategories: {},
    unspecifiedTabDomains: {},
    globalUsers: {},
    // Actions of the 4 DLP vectors by type; print: every print job, on a line of its own (a print is in no vector)
    globalActions: {
      upload: { count: 0, bytes: 0 },
      download: { count: 0, bytes: 0 },
      print: { count: 0, bytes: 0 },
      paste: { count: 0, bytes: 0 }
    },
    // Outbound-only (egress) totals across the 4 DLP vectors: uploads (FILE_UPLOAD and WEB_CONTENT_UPLOAD) and
    // pastes. A print job (PAGE_PRINT) sends nothing to the site of the page, so it is in no vector: printStats and
    // globalActions.print count it. Downloads are inbound and clipboard copies are not outbound, so neither is
    // included. ous: ou -> { bytes, count, leftBytes, leftCount };
    // users: user -> { bytes, count, ou }. bytes and count are what was attempted; left / stopped / outcomes split
    // them by policy outcome (ceraRecordOutcome_); sensitiveLeft: sensitive outbound actions that left.
    egress: Object.assign({ bytes: 0, count: 0, ous: {}, users: {}, sensitiveLeft: 0 }, ceraOutcomeTally_()),
    // Clipboard copies (CLIPBOARD_COPY): content copied from a page, which sends it nowhere, so copies are kept out
    // of the vectors and the egress totals. users: user -> copies; sources: host copied from -> copies;
    // sensitive: copies Chrome reported as sensitive data; left / stopped / outcomes: by policy outcome.
    copies: Object.assign({ count: 0, users: {}, sources: {}, sensitive: 0 }, ceraOutcomeTally_()),
    // Password changes ("Password changed": a user changed a password): neither password reuse nor a transfer, so
    // counted apart. users: user -> changes.
    passwordChanges: { count: 0, users: {} },
    // Browser launches with command-line switches, folded and classed once every row was read (ceraFlushLaunches_ in
    // BrowserLaunches.gs); null while the logs hold none
    browserLaunches: null,
    // Sensitive data matched on a page with no file or upload (Chrome reports trigger UNSPECIFIED and size 0):
    // data displayed or typed in the browser. Not a transfer, so it stays outside the 4 vectors.
    // hostClasses: internal | ai | search | email | other. outcomes: detections by policy outcome (masked, or
    // unmasked: the user revealed masked data); unmaskHosts: host -> unmask events.
    sensitiveOnPage: Object.assign({ count: 0, users: {}, ous: {}, hosts: {}, hostClasses: {}, detectors: {}, daily: {}, unmaskHosts: {} }, ceraOutcomeTally_()),
    // Transfers to private or local destinations (RFC 1918 IPs, *.local, local files): internal, not SaaS
    internalTransfers: { count: 0, bytes: 0, egressCount: 0, egressBytes: 0, hosts: {} },
    // Transfers whose destination was not recorded (blank URL, blob:null, chrome-extension:// and other
    // browser-internal URLs): not an unmanaged app, so they are counted here and disclosed in the reports
    unknownDestinations: { count: 0, bytes: 0, egressCount: 0, egressBytes: 0 },
    // Transfers to sanctioned corporate domains, Google Workspace (corporate sign-in) and authorized GenAI tools
    sanctionedTransfers: { count: 0, bytes: 0, egressCount: 0, egressBytes: 0 },
    // Counted events flagged "Content unscanned" across the 4 DLP vectors
    unscanned: { bytes: 0, count: 0 },
    // Ingestion coverage. sheetsRead: partitions with data that were aggregated; sheetsAttempted:
    // partitions opened before the time limit; rowsRead: data rows read; rowsDropped: rows read
    // but not counted anywhere because they are blank or have no transfer direction;
    // actions: user actions aggregated (ActionAssembler.gs: the transfer rows Chrome wrote for one
    // upload, paste, print or download count once); rowsMerged: transfer rows folded into an action
    // that an earlier row of the same action had started;
    // truncated: true when the runtime watchdog stopped before reading every partition.
    coverage: {
      sheetsRead: 0,
      sheetsAttempted: 0,
      sheetsTotal: 0,
      rowsRead: 0,
      rowsDropped: 0,
      actions: 0,
      rowsMerged: 0,
      truncated: false
    },
    // Print jobs; left / stopped / outcomes split them by policy outcome, for every job and for the sensitive ones
    // (sensitivity.leftOrigins: site -> sensitive jobs that printed; sensitivity.detectorNames, once a sensitive job
    // names one: detector name as the log reports it -> sensitive jobs)
    printStats: Object.assign({
      totalEvents: 0,
      totalBytes: 0,
      originDomains: {},
      ous: {},
      types: {},
      users: {},
      sensitivity: Object.assign({
        sensitiveCount: 0,
        nonSensitiveCount: 0,
        detectors: { CREDIT_CARD_NUMBER: 0, PHONE_NUMBER: 0, EMAIL_ADDRESS: 0, OTHER: 0 },
        leftOrigins: {}
      }, ceraOutcomeTally_())
    }, ceraOutcomeTally_()),
    // Security Signals Radar (Password Reuse, Malware Transfer, and Unsafe Site Visit once one is recorded): counted per
    // event, a warning and the bypass logged after it being one event (ceraAggregateRadarEvent_)
    securityRadar: {
      passwordReuse: { total: 0, ous: {}, users: {}, domains: {}, internalDomains: {}, externalDomains: {} },
      malwareTransfer: { total: 0, ous: {}, users: {}, domains: {}, files: {} }
    },
    // GenAI Adoption Benchmarking (Internal AI vs. Shadow AI), outbound transfers only. A sanctioned tool used
    // from a personal account is neither sanctioned AI nor an unsanctioned tool: it has a bucket of its own.
    // leftCount / leftBytes: the transfers of a bucket that no policy stopped.
    genAiBenchmark: {
      sanctioned: { name: 'Internal AI', bytes: 0, count: 0, users: {}, ous: {}, leftCount: 0, leftBytes: 0 },
      shadow: { name: 'Shadow AI', bytes: 0, count: 0, users: {}, ous: {}, leftCount: 0, leftBytes: 0 },
      personalSanctioned: { name: 'Sanctioned tool, personal account', bytes: 0, count: 0, users: {}, ous: {}, leftCount: 0, leftBytes: 0 }
    },
    // Behavioral Anomaly Tracking
    outliers: {
      dailyVolume: {},       // dateStr -> { bytes, count } (all directions, incl. downloads)
      // dateStr -> { bytes, count }: outbound-only (upload, paste) volume per day (ceraLocalDayKey),
      // same keys as dailyVolume. Use this for egress / exfiltration claims.
      dailyEgress: {},
      actorEndpoints: {},    // userIdent -> { totalBytes, domains: { domain -> bytes } }
      ouActors: {}           // ou -> { totalBytes, users: { userIdent -> bytes } }
    },
    // 5 Threat Vectors (4 DLP Vectors + Vector 5: Security Signals Radar)
    vectors: {
      personal: createVectorAggregator('personal', 'Personal Accounts', '#1D4ED8'),
      shadowAi: createVectorAggregator('shadowAi', 'Shadow AI', '#DC2626'),
      unmanaged: createVectorAggregator('unmanaged', 'Unmanaged Apps', '#D97706'),
      messaging: createVectorAggregator('messaging', 'Web Messaging', '#059669'),
      securityRadar: createSecurityRadarAggregator()
    }
  };
}

/**
 * Safe own-property dictionary helpers so untrusted log strings ('__proto__', 'constructor',
 * 'toString', 'valueOf', 'hasOwnProperty') never pollute Object.prototype or collide with inherited methods,
 * even after JSON checkpoint serialization and restoration.
 */
function ceraOwn_(map, key) {
  return !!(map && Object.prototype.hasOwnProperty.call(map, key));
}

function ceraOwnGet_(map, key) {
  return (map && Object.prototype.hasOwnProperty.call(map, key)) ? map[key] : undefined;
}

function ceraOwnSet_(map, key, val) {
  if (!map) return val;
  if (key === '__proto__' && Object.getPrototypeOf(map) !== null) {
    Object.defineProperty(map, '__proto__', { value: val, writable: true, enumerable: true, configurable: true });
  } else {
    map[key] = val;
  }
  return val;
}

function ceraOwnEnsure_(map, key, initFn) {
  return ceraOwn_(map, key) ? map[key] : ceraOwnSet_(map, key, initFn());
}

function ceraOwnInc_(map, key, delta) {
  const cur = ceraOwn_(map, key) ? (Number(map[key]) || 0) : 0;
  return ceraOwnSet_(map, key, cur + (Number(delta) || 0));
}

function ceraSafeBytes_(val) {
  const n = Number(val);
  return (isFinite(n) && n > 0) ? n : 0;
}

/**
 * Empty policy-outcome split: left and stopped ({ bytes, count, users: user -> { bytes, count } }) and outcomes
 * (outcome class -> { bytes, count }). Merged into the aggregates that split by outcome.
 */
function ceraOutcomeTally_() {
  return { left: { bytes: 0, count: 0, users: {} }, stopped: { bytes: 0, count: 0, users: {} }, outcomes: {} };
}

/**
 * Adds one action to the policy-outcome split of an aggregate (ceraOutcomeTally_): its outcome class (notReported
 * when none), and left or stopped (ceraOutcomeStopped_). Without reported outcomes everything is left, so left
 * equals what was attempted.
 */
function ceraRecordOutcome_(holder, outcome, bytes, userIdent) {
  const cls = outcome || 'notReported';
  const size = ceraSafeBytes_(bytes);
  if (!holder.outcomes) Object.assign(holder, ceraOutcomeTally_());
  const o = ceraOwnEnsure_(holder.outcomes, cls, () => ({ bytes: 0, count: 0 }));
  o.bytes += size;
  o.count++;
  const side = holder[ceraOutcomeStopped_(cls) ? 'stopped' : 'left'];
  side.bytes += size;
  side.count++;
  if (userIdent) {
    const u = ceraOwnEnsure_(side.users, userIdent, () => ({ bytes: 0, count: 0 }));
    u.bytes += size;
    u.count++;
  }
}

/**
 * Notes the Event Result of one data-protection row (ceraIsDataProtectionRow_) in state.outcomes: the mode follows the
 * results actually seen. A value of no known class is counted under its own name (at most 20 names).
 */
function ceraNoteEventResult_(state, result) {
  if (!result) return;
  if (!state.outcomes) state.outcomes = { mode: 'not_reported', reported: false, enforced: false, other: {} };
  const o = state.outcomes;
  const cls = ceraOutcomeClass_(result);
  o.reported = true;
  if (CeraConfig.OUTCOME_ENFORCED.indexOf(cls) !== -1) o.enforced = true;
  o.mode = o.enforced ? 'enforced' : 'audit';
  if (cls === 'other' && (ceraOwn_(o.other, result) || Object.keys(o.other).length < 20)) ceraOwnInc_(o.other, result, 1);
}

/**
 * Updates a multi-action sub-map (upload, download, print)
 */
function updateSubMap(map, key, action, sizeBytes) {
  sizeBytes = ceraSafeBytes_(sizeBytes);
  const entry = ceraOwnEnsure_(map, key, () => ({
    name: key,
    totalBytes: 0,
    count: 0,
    uploadBytes: 0,
    downloadBytes: 0,
    printBytes: 0,
    uploadCount: 0,
    downloadCount: 0,
    printCount: 0,
    pasteBytes: 0,
    pasteCount: 0,
    // Outbound-only share of this entry (upload, paste, print; downloads excluded)
    egressBytes: 0,
    egressCount: 0
  }));
  entry.count++;
  entry.totalBytes += sizeBytes;
  if (action === 'upload') {
    entry.uploadBytes += sizeBytes;
    entry.uploadCount = (entry.uploadCount || 0) + 1;
  } else if (action === 'download') {
    entry.downloadBytes += sizeBytes;
    entry.downloadCount = (entry.downloadCount || 0) + 1;
  } else if (action === 'print') {
    entry.printBytes += sizeBytes;
    entry.printCount = (entry.printCount || 0) + 1;
  } else if (action === 'paste') {
    entry.pasteBytes = (entry.pasteBytes || 0) + sizeBytes;
    entry.pasteCount = (entry.pasteCount || 0) + 1;
  }
  if (isEgressAction(action)) {
    entry.egressBytes = (entry.egressBytes || 0) + sizeBytes;
    entry.egressCount = (entry.egressCount || 0) + 1;
  }
}

/**
 * Outbound (egress) definition: data leaving the browser toward a destination.
 * upload (FILE_UPLOAD, WEB_CONTENT_UPLOAD), paste and print (PAGE_PRINT).
 * Downloads (FILE_DOWNLOAD) are inbound and never egress; clipboard copies are not transfers.
 */
function isEgressAction(action) {
  const list = (typeof CeraConfig !== 'undefined' && CeraConfig.EGRESS_ACTIONS) || ['upload', 'paste', 'print'];
  return list.indexOf(action) !== -1;
}

/**
 * What kind of outbound action a user action is: 'fileUpload', 'paste' (content pasted into a page, which Chrome
 * logs as WEB_CONTENT_UPLOAD, an upload, and other log sources as a paste event) or 'print'; '' when it is not
 * outbound. action: the direction ingestion gave it (ceraNormalizeRow_); triggerType: its Trigger Type.
 */
function ceraOutboundKind_(action, triggerType) {
  if (action === 'print') return 'print';
  if (action === 'paste') return 'paste';
  if (action !== 'upload') return '';
  return /web[\s_-]*content/i.test(String(triggerType || '')) ? 'paste' : 'fileUpload';
}

/**
 * Adds one outbound action to the split by kind of an aggregate: entry.kinds, kind (ceraOutboundKind_) ->
 * { count, bytes, leftCount, leftBytes, sensitive, sensitiveLeft }, left meaning no policy stopped it and sensitive
 * that it matched a detector. The aggregate's own totals are not touched: the split only says which of its outbound
 * actions were file uploads, pastes into a page and prints.
 */
function ceraRecordOutboundKind_(entry, kind, sizeBytes, left, sensitive) {
  if (!entry || !kind) return;
  if (!entry.kinds) entry.kinds = {};
  const k = ceraOwnEnsure_(entry.kinds, kind, () => ({ count: 0, bytes: 0, leftCount: 0, leftBytes: 0, sensitive: 0, sensitiveLeft: 0 }));
  const size = ceraSafeBytes_(sizeBytes);
  k.count++;
  k.bytes += size;
  if (left) {
    k.leftCount++;
    k.leftBytes += size;
  }
  if (sensitive) {
    k.sensitive++;
    if (left) k.sensitiveLeft++;
  }
}

/**
 * Keeps on a per-user record the unit of the user's latest action (atMs), so a user who changed units is listed under
 * the current one whatever order the rows came in; the unit name that sorts first wins a tie. Without a time, the
 * record only takes a unit when it has none.
 */
function ceraKeepLatestOu_(entry, ou, atMs) {
  if (atMs === null || atMs === undefined) {
    if (!entry.ou || entry.ou === 'Unassigned OU') entry.ou = ou;
    return;
  }
  const at = entry.ouAt;
  if (at === null || at === undefined || atMs > at || (atMs === at && String(ou) < String(entry.ou))) {
    entry.ou = ou;
    entry.ouAt = atMs;
  }
}

/**
 * Records an outbound action into the global egress aggregates
 * (state.egress totals, per OU, per user, and outliers.dailyEgress per day), and by its policy outcome.
 */
function recordEgressHit(state, action, sizeBytes, ou, userIdent, eventDateStr, atMs, outcome) {
  if (!isEgressAction(action)) return;
  sizeBytes = ceraSafeBytes_(sizeBytes);
  if (!state.egress) state.egress = { bytes: 0, count: 0, ous: {}, users: {} };
  const e = state.egress;
  e.bytes += sizeBytes;
  e.count++;
  ceraRecordOutcome_(e, outcome, sizeBytes, userIdent);
  const ouEntry = ceraOwnEnsure_(e.ous, ou, () => ({ bytes: 0, count: 0, leftBytes: 0, leftCount: 0 }));
  ouEntry.bytes += sizeBytes;
  ouEntry.count++;
  if (!ceraOutcomeStopped_(outcome || 'notReported')) {
    ouEntry.leftBytes = (ouEntry.leftBytes || 0) + sizeBytes;
    ouEntry.leftCount = (ouEntry.leftCount || 0) + 1;
  }
  if (userIdent) {
    const uEntry = ceraOwnEnsure_(e.users, userIdent, () => ({ bytes: 0, count: 0, ou: ou }));
    ceraKeepLatestOu_(uEntry, ou, atMs);
    uEntry.bytes += sizeBytes;
    uEntry.count++;
  }
  if (eventDateStr && state.outliers) {
    if (!state.outliers.dailyEgress) state.outliers.dailyEgress = {};
    const dayEntry = ceraOwnEnsure_(state.outliers.dailyEgress, eventDateStr, () => ({ bytes: 0, count: 0 }));
    dayEntry.bytes += sizeBytes;
    dayEntry.count++;
  }
}

/**
 * Updates a simple frequency & volume map
 */
function updateSimpleMap(map, key, sizeBytes) {
  sizeBytes = ceraSafeBytes_(sizeBytes);
  const entry = ceraOwnEnsure_(map, key, () => ({ name: key, count: 0, bytes: 0 }));
  entry.count++;
  entry.bytes += sizeBytes;
}

/**
 * Records one user action into a threat vector aggregator. atMs (the action's time) decides the unit an actor is
 * listed under (ceraKeepLatestOu_). An outbound action is split by its policy outcome in the vector, its action type
 * (leftCount / leftBytes) and its destination (ceraRecordDestinationOutcome_).
 */
function recordVectorHit(v, action, sizeBytes, contentType, domain, category, ou, userIdent, isSensitive, detectorCategory, eventDateStr, isUnscanned, atMs, outcome) {
  sizeBytes = ceraSafeBytes_(sizeBytes);
  v.totalEvents++;
  v.totalBytes += sizeBytes;
  if (userIdent) ceraOwnSet_(v.users, userIdent, true);
  const isEgress = isEgressAction(action);
  const left = !ceraOutcomeStopped_(outcome || 'notReported');
  if (isEgress) {
    if (!v.egress) v.egress = { bytes: 0, count: 0, users: {} };
    if (!v.egress.users) v.egress.users = {};
    v.egress.bytes += sizeBytes;
    v.egress.count++;
    if (userIdent) {
      const eu = ceraOwnEnsure_(v.egress.users, userIdent, () => ({ bytes: 0, count: 0 }));
      eu.bytes += sizeBytes;
      eu.count++;
    }
    ceraRecordOutcome_(v.egress, outcome, sizeBytes, userIdent);
    if (isSensitive && left) v.egress.sensitiveLeft = (v.egress.sensitiveLeft || 0) + 1;
  }
  if (isUnscanned) markVectorUnscanned(v, sizeBytes);

  const actObj = ceraOwnGet_(v.actions, action);
  if (actObj) {
    actObj.count++;
    actObj.bytes += sizeBytes;
    if (isEgress && left) {
      actObj.leftCount = (actObj.leftCount || 0) + 1;
      actObj.leftBytes = (actObj.leftBytes || 0) + sizeBytes;
    }
    updateSimpleMap(actObj.types, contentType, sizeBytes);
    updateSimpleMap(actObj.ous, ou, sizeBytes);
    updateSimpleMap(actObj.domains, domain, sizeBytes);
    updateSimpleMap(actObj.cats, category, sizeBytes);
  }

  updateSubMap(v.ous, ou, action, sizeBytes);
  updateSubMap(v.domains, domain, action, sizeBytes);
  if (isEgress) ceraRecordDestinationOutcome_(ceraOwnGet_(v.domains, domain), outcome, sizeBytes, isSensitive);
  updateSubMap(v.types, contentType, action, sizeBytes);
  updateSimpleMap(v.cats, category, sizeBytes);

  // Directional timeline tracking per vector
  if (eventDateStr && v.timeline) {
    const t = ceraOwnEnsure_(v.timeline, eventDateStr, () => ({
      date: eventDateStr,
      uploadBytes: 0,
      downloadBytes: 0,
      printBytes: 0,
      totalBytes: 0,
      uploadCount: 0,
      downloadCount: 0,
      printCount: 0,
      totalEvents: 0,
      totalCount: 0,
      pasteBytes: 0,
      pasteCount: 0,
      egressBytes: 0,
      egressCount: 0,
      types: {}
    }));
    t.totalBytes += sizeBytes;
    t.totalEvents++;
    t.totalCount++;
    if (action === 'upload') { t.uploadBytes += sizeBytes; t.uploadCount++; }
    else if (action === 'download') { t.downloadBytes += sizeBytes; t.downloadCount++; }
    else if (action === 'print') { t.printBytes += sizeBytes; t.printCount++; }
    else if (action === 'paste') { t.pasteBytes += sizeBytes; t.pasteCount++; }
    if (isEgress) { t.egressBytes += sizeBytes; t.egressCount++; }
    ceraOwnInc_(t.types, contentType, sizeBytes);
  }

  // User actor attribution per vector
  if (userIdent && v.actors) {
    const a = ceraOwnEnsure_(v.actors, userIdent, () => ({
      user: userIdent,
      ou: ou || 'Unassigned OU',
      uploadBytes: 0,
      downloadBytes: 0,
      printBytes: 0,
      totalBytes: 0,
      uploadCount: 0,
      downloadCount: 0,
      printCount: 0,
      totalEvents: 0,
      pasteBytes: 0,
      pasteCount: 0,
      egressBytes: 0,
      egressCount: 0
    }));
    ceraKeepLatestOu_(a, ou || 'Unassigned OU', atMs);
    a.totalBytes += sizeBytes;
    a.totalEvents++;
    if (action === 'upload') { a.uploadBytes += sizeBytes; a.uploadCount++; }
    else if (action === 'download') { a.downloadBytes += sizeBytes; a.downloadCount++; }
    else if (action === 'print') { a.printBytes += sizeBytes; a.printCount++; }
    else if (action === 'paste') { a.pasteBytes += sizeBytes; a.pasteCount++; }
    if (isEgress) { a.egressBytes += sizeBytes; a.egressCount++; }

    // Track actor daily timeline
    if (!a.timeline) a.timeline = {};
    if (eventDateStr) {
      const at = ceraOwnEnsure_(a.timeline, eventDateStr, () => ({
        date: eventDateStr,
        uploadBytes: 0,
        downloadBytes: 0,
        printBytes: 0,
        pasteBytes: 0,
        totalBytes: 0,
        uploadCount: 0,
        downloadCount: 0,
        printCount: 0,
        pasteCount: 0,
        totalEvents: 0
      }));
      at.totalBytes += sizeBytes;
      at.totalEvents++;
      if (action === 'upload') { at.uploadBytes += sizeBytes; at.uploadCount++; }
      else if (action === 'download') { at.downloadBytes += sizeBytes; at.downloadCount++; }
      else if (action === 'print') { at.printBytes += sizeBytes; at.printCount++; }
      else if (action === 'paste') { at.pasteBytes = (at.pasteBytes || 0) + sizeBytes; at.pasteCount = (at.pasteCount || 0) + 1; }
    }
  }

  if (isSensitive) {
    v.sensitivity.sensitiveCount++;
    ceraOwnInc_(v.sensitivity.detectors, detectorCategory || 'OTHER', 1);
  } else {
    v.sensitivity.nonSensitiveCount++;
  }
}

/**
 * Policy outcome of an outbound action on its destination entry (a vector's domains map, updateSubMap):
 * egressOutcomes: outcome class -> { bytes, count }; egressLeftBytes / egressLeftCount: what no policy stopped;
 * egressSensitiveLeft: sensitive actions that left. So a slide can say "143 of 175 blocked" for one destination.
 */
function ceraRecordDestinationOutcome_(entry, outcome, sizeBytes, isSensitive) {
  if (!entry) return;
  sizeBytes = ceraSafeBytes_(sizeBytes);
  const cls = outcome || 'notReported';
  if (!entry.egressOutcomes) entry.egressOutcomes = {};
  const o = ceraOwnEnsure_(entry.egressOutcomes, cls, () => ({ bytes: 0, count: 0 }));
  o.bytes += sizeBytes;
  o.count++;
  if (ceraOutcomeStopped_(cls)) return;
  entry.egressLeftBytes = (entry.egressLeftBytes || 0) + sizeBytes;
  entry.egressLeftCount = (entry.egressLeftCount || 0) + 1;
  if (isSensitive) entry.egressSensitiveLeft = (entry.egressSensitiveLeft || 0) + 1;
}

/**
 * Flags an already counted event of vector v as "Content unscanned".
 */
function markVectorUnscanned(v, sizeBytes) {
  if (!v) return;
  sizeBytes = ceraSafeBytes_(sizeBytes);
  if (!v.unscanned) v.unscanned = { bytes: 0, count: 0 };
  v.unscanned.bytes += sizeBytes;
  v.unscanned.count++;
}

/**
 * Creates dedicated aggregator for Threat Vector 5: Security Radar
 * (Unsafe Site Visits, Password Reuse, Malware Interceptions)
 */
function createSecurityRadarAggregator() {
  return {
    key: 'securityRadar',
    name: 'Security Radar',
    color: '#4338CA', // Deep Indigo / Violet Alert
    totalIncidents: 0,
    totalEvents: 0,   // Alias for compatibility
    totalBytes: 0,    // Keep 0 for non-payload
    // Outcomes from the Event Result column (ceraOutcomeClass_): BYPASSED, WARNED (shown and heeded), BLOCKED,
    // CANCELLED_BY_USER, ALLOWED / DETECTED / REPORTED (detectedCount), results of no known class (otherCount), and
    // events whose log reported no result (unreportedCount)
    bypassCount: 0,
    warnedCount: 0,
    blockedCount: 0,
    cancelledCount: 0,
    detectedCount: 0,
    otherCount: 0,
    unreportedCount: 0,
    users: {},
    ous: {},
    domains: {},
    types: {},
    actions: {
      upload: { bytes: 0, count: 0 },
      download: { bytes: 0, count: 0 },
      print: { bytes: 0, count: 0 }
    },
    signals: {
      unsafeSiteVisit: {
        total: 0,
        warned: 0,
        bypassed: 0,
        blocked: 0,
        cancelled: 0,
        detected: 0,
        other: 0,
        unreported: 0,
        reasons: {},
        domains: {},
        ous: {},
        users: {},
        sampleUrls: []
      },
      passwordReuse: {
        total: 0,
        internalDomains: {},
        externalDomains: {},
        domains: {},
        ous: {},
        users: {},
        sampleUrls: [],
        metaHits: 0,
        internalHits: 0
      },
      malwareTransfer: {
        total: 0,
        warned: 0,
        bypassed: 0,
        blocked: 0,
        cancelled: 0,
        detected: 0,
        other: 0,
        unreported: 0,
        files: {},
        domains: {},
        ous: {},
        users: {},
        sampleUrls: [],
        reasons: {}
      }
    },
    timeline: {}, // dateStr => { date, unsafe, password, malware, total, bypassed, warned, blocked, unreported }
    actors: {},   // userIdent => { user, ou, unsafe, password, malware, total, bypassed, timeline }
    incidentLogs: [] // Detailed incident records (capped at top 150)
  };
}

/**
 * True only when `host` is an exact or registrable-subdomain match for facebook.com or messenger.com
 * (prevents suffix-spoofing such as evilfacebook.com or facebook.com.attacker.example).
 */
function ceraIsMetaDomain_(host) {
  const h = String(host || '').trim().toLowerCase().replace(/:\d+$/, '');
  if (!h) return false;
  if (typeof domainMatches === 'function') {
    return domainMatches(h, 'facebook.com') || domainMatches(h, 'messenger.com');
  }
  return h === 'facebook.com' || h.endsWith('.facebook.com') || h === 'messenger.com' || h.endsWith('.messenger.com');
}

/**
 * Records one security event into Threat Vector 5: Security Radar with granular forensics. resultAction is the event's
 * outcome: BYPASSED for a warning the user clicked through, otherwise the result of the event's first row.
 */
function recordSecurityRadarHit(radar, signalType, eventDateStr, ou, userIdent, domain, resultAction, reason, fileName, rawUrl) {
  if (!radar) return;
  ou = ou || 'Unassigned OU';
  domain = domain || 'Unknown Endpoint';
  reason = reason || 'SECURITY_POLICY_TRIGGER';
  fileName = fileName || '';
  rawUrl = rawUrl || '';

  radar.totalIncidents++;
  radar.totalEvents++;
  ceraOwnInc_(radar.ous, ou, 1);
  ceraOwnInc_(radar.domains, domain, 1);
  if (userIdent) ceraOwnSet_(radar.users, userIdent, true);

  // One outcome per event (ceraOutcomeClass_): bypassed, warned (shown and heeded), blocked, cancelled, not reported,
  // detected (ALLOWED, DETECTED, REPORTED), or other (a result of no known class). A blocked visit is never counted
  // as a heeded warning.
  const outcome = normalizeEventResult(resultAction);
  resultAction = outcome;
  const cls = ceraOutcomeClass_(outcome);
  const isBypass = cls === 'bypassed';
  const isWarned = cls === 'warned';
  const isBlocked = cls === 'blocked';
  const isUnreported = cls === 'notReported';
  const outcomeKey = { bypassed: 'bypassed', warned: 'warned', blocked: 'blocked', cancelled: 'cancelled', notReported: 'unreported', detected: 'detected' }[cls] || 'other';
  if (isBypass) radar.bypassCount++;
  else if (isWarned) radar.warnedCount++;
  else if (isBlocked) radar.blockedCount++;
  else if (isUnreported) radar.unreportedCount++;
  else if (outcomeKey === 'detected') radar.detectedCount++;
  else if (outcomeKey === 'cancelled') radar.cancelledCount = (radar.cancelledCount || 0) + 1;
  else radar.otherCount = (radar.otherCount || 0) + 1;
  // Events per normalized result of each signal (WARNED, ALLOWED, ...; NOT_REPORTED without one)
  const sig = ceraOwnGet_(radar.signals, signalType);
  if (sig) {
    if (!sig.results) sig.results = {};
    const rk = outcome || 'NOT_REPORTED';
    ceraOwnInc_(sig.results, rk, 1);
  }

  // 1. Signal-specific granular sub-mapping
  if (signalType === 'unsafeSiteVisit') {
    const s = radar.signals.unsafeSiteVisit;
    s.total++;
    s[outcomeKey]++;

    ceraOwnInc_(s.reasons, reason, 1);
    const sd = ceraOwnEnsure_(s.domains, domain, () => ({ total: 0, warned: 0, bypassed: 0, blocked: 0, cancelled: 0, detected: 0, other: 0, unreported: 0 }));
    sd.total++;
    sd[outcomeKey]++;

    ceraOwnInc_(s.ous, ou, 1);
    if (userIdent) ceraOwnSet_(s.users, userIdent, true);

    if (rawUrl && s.sampleUrls && s.sampleUrls.length < 50) {
      s.sampleUrls.push({ url: rawUrl, domain: domain, reason: reason, action: resultAction, ou: ou, user: userIdent, date: eventDateStr });
    }
  } else if (signalType === 'passwordReuse') {
    const s = radar.signals.passwordReuse;
    s.total++;
    // Events per destination. A password change is no reuse event (state.passwordChanges counts it), so there is no
    // changed or allowed split to keep here
    const pd = ceraOwnEnsure_(s.domains, domain, () => ({ total: 0 }));
    pd.total++;

    if (ceraIsMetaDomain_(domain)) s.metaHits = (s.metaHits || 0) + 1;

    ceraOwnInc_(s.ous, ou, 1);
    if (userIdent) ceraOwnSet_(s.users, userIdent, true);

    if (rawUrl && s.sampleUrls && s.sampleUrls.length < 50) {
      s.sampleUrls.push({ url: rawUrl, domain: domain, reason: reason, action: resultAction, ou: ou, user: userIdent, date: eventDateStr });
    }
  } else if (signalType === 'malwareTransfer') {
    const s = radar.signals.malwareTransfer;
    s.total++;
    s[outcomeKey]++;

    ceraOwnInc_(s.reasons, reason, 1);
    ceraOwnInc_(s.domains, domain, 1);
    ceraOwnInc_(s.ous, ou, 1);
    if (userIdent) ceraOwnSet_(s.users, userIdent, true);

    if (fileName) {
      const mf = ceraOwnEnsure_(s.files, fileName, () => ({ total: 0, warned: 0, bypassed: 0, blocked: 0, domain: domain, reason: reason }));
      mf.total++;
      if (isBypass) mf.bypassed++;
      else if (isWarned) mf.warned++;
      else if (isBlocked) mf.blocked++;
    }

    if (rawUrl && s.sampleUrls && s.sampleUrls.length < 50) {
      s.sampleUrls.push({ url: rawUrl, fileName: fileName, domain: domain, reason: reason, action: resultAction, ou: ou, user: userIdent, date: eventDateStr });
    }
  }

  // 2. Timeline Aggregation (YYYY-MM-DD)
  if (eventDateStr) {
    const t = ceraOwnEnsure_(radar.timeline, eventDateStr, () => ({
      date: eventDateStr,
      unsafe: 0,
      password: 0,
      malware: 0,
      total: 0,
      totalEvents: 0,
      bypassed: 0,
      warned: 0,
      blocked: 0,
      unreported: 0
    }));
    t.total++;
    t.totalEvents++;
    if (signalType === 'unsafeSiteVisit') t.unsafe++;
    else if (signalType === 'passwordReuse') t.password++;
    else if (signalType === 'malwareTransfer') t.malware++;
    if (isBypass) t.bypassed++;
    if (isWarned) t.warned++;
    if (isBlocked) t.blocked++;
    if (isUnreported) t.unreported++;
  }

  // 3. Actor Attribution & Daily Actor Timeline
  if (userIdent) {
    const a = ceraOwnEnsure_(radar.actors, userIdent, () => ({
      user: userIdent,
      ou: ou,
      unsafe: 0,
      password: 0,
      malware: 0,
      total: 0,
      totalEvents: 0,
      bypassed: 0,
      timeline: {}
    }));
    if (!a.ou || a.ou === 'Unassigned OU') a.ou = ou;
    a.total++;
    a.totalEvents++;
    if (signalType === 'unsafeSiteVisit') a.unsafe++;
    else if (signalType === 'passwordReuse') a.password++;
    else if (signalType === 'malwareTransfer') a.malware++;
    if (isBypass) a.bypassed++;

    // Track actor daily timeline
    if (!a.timeline) a.timeline = {};
    if (eventDateStr) {
      const at = ceraOwnEnsure_(a.timeline, eventDateStr, () => ({
        date: eventDateStr,
        unsafe: 0,
        password: 0,
        malware: 0,
        total: 0,
        bypassed: 0,
        warned: 0
      }));
      at.total++;
      if (signalType === 'unsafeSiteVisit') at.unsafe++;
      else if (signalType === 'passwordReuse') at.password++;
      else if (signalType === 'malwareTransfer') at.malware++;
      if (isBypass) at.bypassed++;
      if (isWarned) at.warned++;
    }
  }

  // 4. Bounded Forensic Incident Log (Capped at 150 entries for GAS memory safety)
  if (radar.incidentLogs.length < 150) {
    radar.incidentLogs.push({
      date: eventDateStr,
      signal: signalType,
      domain: domain,
      ou: ou,
      user: userIdent,
      action: resultAction,
      reason: reason,
      file: fileName,
      url: rawUrl
    });
  }
}

/**
 * Records one clipboard copy (see state.copies) under the host of the page it was copied from, with its policy outcome.
 */
function recordClipboardCopy(state, sourceHost, userIdent, isSensitive, outcome, sizeBytes) {
  if (!state.copies) state.copies = Object.assign({ count: 0, users: {}, sources: {}, sensitive: 0 }, ceraOutcomeTally_());
  const c = state.copies;
  const host = sourceHost || (CeraConfig.UNKNOWN_DESTINATION || 'Unknown destination');
  c.count++;
  if (userIdent) ceraOwnInc_(c.users, userIdent, 1);
  ceraOwnInc_(c.sources, host, 1);
  if (isSensitive) c.sensitive++;
  ceraRecordOutcome_(c, outcome, sizeBytes, '');
}

/**
 * Records a sensitive-data match on a page that involved no file or upload (see state.sensitiveOnPage), with its policy
 * outcome: masked, or unmasked when the user revealed the masked data.
 */
function recordSensitiveOnPage(state, host, detectorText, ou, userIdent, dayKey, corpDomains, outcome) {
  const sp = state.sensitiveOnPage;
  ceraRecordOutcome_(sp, outcome, 0, '');
  const h = host || (CeraConfig.UNKNOWN_DESTINATION || 'Unknown destination');
  let hostClass = 'other';
  if (isInternalHost(h) || (corpDomains || []).some(cd => cd && domainMatches(h, cd))) hostClass = 'internal';
  else if (matchGenAiHost(h)) hostClass = 'ai';
  else if (['google.com', 'bing.com', 'duckduckgo.com', 'yahoo.com'].some(d => domainMatches(h, d)) && !domainMatches(h, 'mail.google.com')) hostClass = 'search';
  else if (['mail.google.com', 'outlook.office.com', 'outlook.office365.com', 'outlook.live.com'].some(d => domainMatches(h, d))) hostClass = 'email';

  sp.count++;
  ceraOwnInc_(sp.hosts, h, 1);
  if (outcome === 'unmasked') {
    if (!sp.unmaskHosts) sp.unmaskHosts = {};
    ceraOwnInc_(sp.unmaskHosts, h, 1);
  }
  ceraOwnInc_(sp.hostClasses, hostClass, 1);
  ceraOwnInc_(sp.ous, ou, 1);
  if (userIdent) ceraOwnInc_(sp.users, userIdent, 1);
  if (dayKey) ceraOwnInc_(sp.daily, dayKey, 1);
  String(detectorText || '').split(',').map(d => d.trim()).filter(Boolean).forEach(d => {
    ceraOwnInc_(sp.detectors, d, 1);
  });
}

/**
 * True when an Organizational Unit value is missing or represents an unreported/unassigned placeholder.
 */
function ceraIsUnreportedOu_(ou) {
  if (!ou) return true;
  const s = String(ou).trim();
  if (!s || s === 'Unassigned OU' || s === 'OU not reported' || s === 'N/A') return true;
  if (typeof CERA_I18N_MESSAGES !== 'undefined') {
    const keys = Object.keys(CERA_I18N_MESSAGES);
    for (let i = 0; i < keys.length; i++) {
      const msg = CERA_I18N_MESSAGES[keys[i]]['report.ou.notReported'];
      if (msg && s === msg) return true;
    }
  }
  if (typeof ceraT === 'function') {
    try {
      if (s === ceraT('report.ou.notReported', null, 'en')) return true;
    } catch (e) {}
  }
  return false;
}

/**
 * Accumulates active day counts on an actor before pruning its daily map, deduplicating a boundary day
 * that already appeared in the previous prune pass.
 */
function ceraAccumulatePrunedDays_(act, dayMap) {
  if (!act || !dayMap || typeof dayMap !== 'object') return;
  const keys = Object.keys(dayMap).sort();
  if (!keys.length) return;
  let added = keys.length;
  if (act._lastPrunedDay && keys.indexOf(act._lastPrunedDay) !== -1) {
    added = Math.max(0, added - 1);
  }
  act._activeDays = (Number(act._activeDays) || 0) + added;
  act._lastPrunedDay = keys[keys.length - 1];
}

/**
 * Returns total distinct active days for an actor across pruned passes (_activeDays) and any live map (mapProp).
 */
function ceraActorActiveDays_(act, mapProp) {
  if (!act) return 0;
  const liveMap = act[mapProp];
  const liveKeys = (liveMap && typeof liveMap === 'object') ? Object.keys(liveMap) : [];
  const pruned = Number(act._activeDays) || 0;
  if (!pruned) return liveKeys.length;
  if (!liveKeys.length) return pruned;
  const overlap = (act._lastPrunedDay && liveKeys.indexOf(act._lastPrunedDay) !== -1) ? 1 : 0;
  return pruned + liveKeys.length - overlap;
}

/**
 * Prunes per-actor daily timeline maps for tail actors outside the top-N rankings so multi-month
 * (90-180 day) runs keep V8 heap usage and checkpoint JSON size strictly bounded.
 * computeTop5ActorTimelines only reads .timeline for the Top 5 actors per vector, and ceraSlide3Cards
 * only reads .days for top funnel/scatter candidates (including preferRealOu named-OU candidates).
 */
function ceraPruneStateForScale_(state, opts) {
  if (!state) return;
  const keepTopActors = (opts && opts.keepTopActors) || 50;
  const keepNamedOuActors = (opts && opts.keepNamedOuActors !== undefined)
    ? opts.keepNamedOuActors
    : Math.min(25, Math.max(1, Math.floor(keepTopActors / 2)));
  const vectorKeys = ['personal', 'shadowAi', 'unmanaged', 'messaging', 'securityRadar'];
  for (let vIdx = 0; vIdx < vectorKeys.length; vIdx++) {
    const vk = vectorKeys[vIdx];
    const v = state.vectors && state.vectors[vk];
    if (!v || !v.actors) continue;
    const keys = Object.keys(v.actors);
    if (keys.length <= keepTopActors) continue;
    const isRadar = vk === 'securityRadar';
    keys.sort((ka, kb) => {
      const a = v.actors[ka] || {};
      const b = v.actors[kb] || {};
      if (isRadar) {
        return (b.total || b.totalEvents || 0) - (a.total || a.totalEvents || 0);
      }
      return (b.totalBytes || 0) - (a.totalBytes || 0) || (b.totalEvents || 0) - (a.totalEvents || 0);
    });
    let namedOuSeen = 0;
    for (let i = 0; i < keys.length; i++) {
      const act = v.actors[keys[i]];
      if (!act) continue;
      const hasNamedOu = !ceraIsUnreportedOu_(act.ou);
      if (hasNamedOu) namedOuSeen++;
      if (i < keepTopActors || (hasNamedOu && namedOuSeen <= keepNamedOuActors)) continue;
      if (act.timeline) {
        ceraAccumulatePrunedDays_(act, act.timeline);
        delete act.timeline;
      }
    }
  }

  const endpoints = state.outliers && state.outliers.actorEndpoints;
  if (endpoints) {
    const keepTopOutlierActors = (opts && opts.keepTopOutlierActors) || 100;
    const keepNamedOutlierActors = (opts && opts.keepNamedOutlierActors !== undefined)
      ? opts.keepNamedOutlierActors
      : Math.min(50, Math.max(1, Math.floor(keepTopOutlierActors / 2)));
    const epKeys = Object.keys(endpoints);
    if (epKeys.length > keepTopOutlierActors) {
      const keepSet = new Set();
      const byVol = epKeys.slice().sort((ka, kb) => {
        const a = endpoints[ka] || {};
        const b = endpoints[kb] || {};
        return (b.totalBytes || 0) - (a.totalBytes || 0) || (b.totalCount || 0) - (a.totalCount || 0);
      });
      let namedVolSeen = 0;
      for (let i = 0; i < byVol.length; i++) {
        const u = byVol[i];
        const act = endpoints[u] || {};
        const hasNamedOu = !ceraIsUnreportedOu_(act.ou);
        if (hasNamedOu) namedVolSeen++;
        if (i < keepTopOutlierActors || (hasNamedOu && namedVolSeen <= keepNamedOutlierActors)) {
          keepSet.add(u);
        }
      }

      const byScatter = epKeys.slice().sort((ka, kb) => {
        const a = endpoints[ka] || {};
        const b = endpoints[kb] || {};
        const da = Object.keys(a.domains || {}).length;
        const db = Object.keys(b.domains || {}).length;
        return db - da || (b.totalBytes || 0) - (a.totalBytes || 0);
      });
      let namedScatterSeen = 0;
      for (let i = 0; i < byScatter.length; i++) {
        const u = byScatter[i];
        const act = endpoints[u] || {};
        const hasNamedOu = !ceraIsUnreportedOu_(act.ou);
        if (hasNamedOu) namedScatterSeen++;
        if (i < keepTopOutlierActors || (hasNamedOu && namedScatterSeen <= keepNamedOutlierActors)) {
          keepSet.add(u);
        }
      }

      for (let i = 0; i < epKeys.length; i++) {
        const u = epKeys[i];
        if (keepSet.has(u)) continue;
        const act = endpoints[u];
        if (act && act.days) {
          ceraAccumulatePrunedDays_(act, act.days);
          delete act.days;
        }
      }
    }
  }
}


