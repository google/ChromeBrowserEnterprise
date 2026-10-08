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
  const size = Number(bytes) || 0;
  if (!holder.outcomes) Object.assign(holder, ceraOutcomeTally_());
  const o = holder.outcomes[cls] || (holder.outcomes[cls] = { bytes: 0, count: 0 });
  o.bytes += size;
  o.count++;
  const side = holder[ceraOutcomeStopped_(cls) ? 'stopped' : 'left'];
  side.bytes += size;
  side.count++;
  if (userIdent) {
    const u = side.users[userIdent] || (side.users[userIdent] = { bytes: 0, count: 0 });
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
  if (cls === 'other' && (o.other[result] || Object.keys(o.other).length < 20)) o.other[result] = (o.other[result] || 0) + 1;
}

/**
 * Updates a multi-action sub-map (upload, download, print)
 */
function updateSubMap(map, key, action, sizeBytes) {
  if (!map[key]) {
    map[key] = {
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
    };
  }
  map[key].count++;
  map[key].totalBytes += sizeBytes;
  if (action === 'upload') {
    map[key].uploadBytes += sizeBytes;
    map[key].uploadCount = (map[key].uploadCount || 0) + 1;
  } else if (action === 'download') {
    map[key].downloadBytes += sizeBytes;
    map[key].downloadCount = (map[key].downloadCount || 0) + 1;
  } else if (action === 'print') {
    map[key].printBytes += sizeBytes;
    map[key].printCount = (map[key].printCount || 0) + 1;
  } else if (action === 'paste') {
    map[key].pasteBytes = (map[key].pasteBytes || 0) + sizeBytes;
    map[key].pasteCount = (map[key].pasteCount || 0) + 1;
  }
  if (isEgressAction(action)) {
    map[key].egressBytes = (map[key].egressBytes || 0) + sizeBytes;
    map[key].egressCount = (map[key].egressCount || 0) + 1;
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
  const k = entry.kinds[kind] || (entry.kinds[kind] = { count: 0, bytes: 0, leftCount: 0, leftBytes: 0, sensitive: 0, sensitiveLeft: 0 });
  const size = Number(sizeBytes) || 0;
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
  if (!state.egress) state.egress = { bytes: 0, count: 0, ous: {}, users: {} };
  const e = state.egress;
  e.bytes += sizeBytes;
  e.count++;
  ceraRecordOutcome_(e, outcome, sizeBytes, userIdent);
  if (!e.ous[ou]) e.ous[ou] = { bytes: 0, count: 0, leftBytes: 0, leftCount: 0 };
  e.ous[ou].bytes += sizeBytes;
  e.ous[ou].count++;
  if (!ceraOutcomeStopped_(outcome || 'notReported')) {
    e.ous[ou].leftBytes = (e.ous[ou].leftBytes || 0) + sizeBytes;
    e.ous[ou].leftCount = (e.ous[ou].leftCount || 0) + 1;
  }
  if (userIdent) {
    if (!e.users[userIdent]) e.users[userIdent] = { bytes: 0, count: 0, ou: ou };
    ceraKeepLatestOu_(e.users[userIdent], ou, atMs);
    e.users[userIdent].bytes += sizeBytes;
    e.users[userIdent].count++;
  }
  if (eventDateStr && state.outliers) {
    if (!state.outliers.dailyEgress) state.outliers.dailyEgress = {};
    if (!state.outliers.dailyEgress[eventDateStr]) state.outliers.dailyEgress[eventDateStr] = { bytes: 0, count: 0 };
    state.outliers.dailyEgress[eventDateStr].bytes += sizeBytes;
    state.outliers.dailyEgress[eventDateStr].count++;
  }
}

/**
 * Updates a simple frequency & volume map
 */
function updateSimpleMap(map, key, sizeBytes) {
  if (!map[key]) {
    map[key] = { name: key, count: 0, bytes: 0 };
  }
  map[key].count++;
  map[key].bytes += sizeBytes;
}

/**
 * Records one user action into a threat vector aggregator. atMs (the action's time) decides the unit an actor is
 * listed under (ceraKeepLatestOu_). An outbound action is split by its policy outcome in the vector, its action type
 * (leftCount / leftBytes) and its destination (ceraRecordDestinationOutcome_).
 */
function recordVectorHit(v, action, sizeBytes, contentType, domain, category, ou, userIdent, isSensitive, detectorCategory, eventDateStr, isUnscanned, atMs, outcome) {
  v.totalEvents++;
  v.totalBytes += sizeBytes;
  if (userIdent) v.users[userIdent] = true;
  const isEgress = isEgressAction(action);
  const left = !ceraOutcomeStopped_(outcome || 'notReported');
  if (isEgress) {
    if (!v.egress) v.egress = { bytes: 0, count: 0, users: {} };
    if (!v.egress.users) v.egress.users = {};
    v.egress.bytes += sizeBytes;
    v.egress.count++;
    if (userIdent) {
      const eu = v.egress.users[userIdent] || (v.egress.users[userIdent] = { bytes: 0, count: 0 });
      eu.bytes += sizeBytes;
      eu.count++;
    }
    ceraRecordOutcome_(v.egress, outcome, sizeBytes, userIdent);
    if (isSensitive && left) v.egress.sensitiveLeft = (v.egress.sensitiveLeft || 0) + 1;
  }
  if (isUnscanned) markVectorUnscanned(v, sizeBytes);

  const actObj = v.actions[action];
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
  if (isEgress) ceraRecordDestinationOutcome_(v.domains[domain], outcome, sizeBytes, isSensitive);
  updateSubMap(v.types, contentType, action, sizeBytes);
  updateSimpleMap(v.cats, category, sizeBytes);

  // Directional timeline tracking per vector
  if (eventDateStr && v.timeline) {
    if (!v.timeline[eventDateStr]) {
      v.timeline[eventDateStr] = {
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
      };
    }
    const t = v.timeline[eventDateStr];
    t.totalBytes += sizeBytes;
    t.totalEvents++;
    t.totalCount++;
    if (action === 'upload') { t.uploadBytes += sizeBytes; t.uploadCount++; }
    else if (action === 'download') { t.downloadBytes += sizeBytes; t.downloadCount++; }
    else if (action === 'print') { t.printBytes += sizeBytes; t.printCount++; }
    else if (action === 'paste') { t.pasteBytes += sizeBytes; t.pasteCount++; }
    if (isEgress) { t.egressBytes += sizeBytes; t.egressCount++; }
    t.types[contentType] = (t.types[contentType] || 0) + sizeBytes;
  }

  // User actor attribution per vector
  if (userIdent && v.actors) {
    if (!v.actors[userIdent]) {
      v.actors[userIdent] = {
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
      };
    }
    const a = v.actors[userIdent];
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
      if (!a.timeline[eventDateStr]) {
        a.timeline[eventDateStr] = {
          date: eventDateStr,
          uploadBytes: 0,
          downloadBytes: 0,
          printBytes: 0,
          totalBytes: 0,
          uploadCount: 0,
          downloadCount: 0,
          printCount: 0,
          totalEvents: 0
        };
      }
      const at = a.timeline[eventDateStr];
      at.totalBytes += sizeBytes;
      at.totalEvents++;
      if (action === 'upload') { at.uploadBytes += sizeBytes; at.uploadCount++; }
      else if (action === 'download') { at.downloadBytes += sizeBytes; at.downloadCount++; }
      else if (action === 'print') { at.printBytes += sizeBytes; at.printCount++; }
    }
  }

  if (isSensitive) {
    v.sensitivity.sensitiveCount++;
    v.sensitivity.detectors[detectorCategory] = (v.sensitivity.detectors[detectorCategory] || 0) + 1;
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
  const cls = outcome || 'notReported';
  if (!entry.egressOutcomes) entry.egressOutcomes = {};
  const o = entry.egressOutcomes[cls] || (entry.egressOutcomes[cls] = { bytes: 0, count: 0 });
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
  radar.ous[ou] = (radar.ous[ou] || 0) + 1;
  radar.domains[domain] = (radar.domains[domain] || 0) + 1;
  if (userIdent) radar.users[userIdent] = true;

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
  const sig = radar.signals[signalType];
  if (sig) {
    if (!sig.results) sig.results = {};
    const rk = outcome || 'NOT_REPORTED';
    sig.results[rk] = (sig.results[rk] || 0) + 1;
  }

  // 1. Signal-specific granular sub-mapping
  if (signalType === 'unsafeSiteVisit') {
    const s = radar.signals.unsafeSiteVisit;
    s.total++;
    s[outcomeKey]++;

    s.reasons[reason] = (s.reasons[reason] || 0) + 1;
    if (!s.domains[domain]) s.domains[domain] = { total: 0, warned: 0, bypassed: 0, blocked: 0, cancelled: 0, detected: 0, other: 0, unreported: 0 };
    s.domains[domain].total++;
    s.domains[domain][outcomeKey]++;

    s.ous[ou] = (s.ous[ou] || 0) + 1;
    if (userIdent) s.users[userIdent] = true;

    if (rawUrl && s.sampleUrls && s.sampleUrls.length < 50) {
      s.sampleUrls.push({ url: rawUrl, domain: domain, reason: reason, action: resultAction, ou: ou, user: userIdent, date: eventDateStr });
    }
  } else if (signalType === 'passwordReuse') {
    const s = radar.signals.passwordReuse;
    s.total++;
    // Events per destination. A password change is no reuse event (state.passwordChanges counts it), so there is no
    // changed or allowed split to keep here
    if (!s.domains[domain]) s.domains[domain] = { total: 0 };
    s.domains[domain].total++;

    const isMeta = domain.includes('facebook.com') || domain.includes('messenger.com');
    if (isMeta) s.metaHits = (s.metaHits || 0) + 1;

    s.ous[ou] = (s.ous[ou] || 0) + 1;
    if (userIdent) s.users[userIdent] = true;

    if (rawUrl && s.sampleUrls && s.sampleUrls.length < 50) {
      s.sampleUrls.push({ url: rawUrl, domain: domain, reason: reason, action: resultAction, ou: ou, user: userIdent, date: eventDateStr });
    }
  } else if (signalType === 'malwareTransfer') {
    const s = radar.signals.malwareTransfer;
    s.total++;
    s[outcomeKey]++;

    s.reasons[reason] = (s.reasons[reason] || 0) + 1;
    s.domains[domain] = (s.domains[domain] || 0) + 1;
    s.ous[ou] = (s.ous[ou] || 0) + 1;
    if (userIdent) s.users[userIdent] = true;

    if (fileName) {
      if (!s.files[fileName]) s.files[fileName] = { total: 0, warned: 0, bypassed: 0, blocked: 0, domain: domain, reason: reason };
      s.files[fileName].total++;
      if (isBypass) s.files[fileName].bypassed++;
      else if (isWarned) s.files[fileName].warned++;
      else if (isBlocked) s.files[fileName].blocked++;
    }

    if (rawUrl && s.sampleUrls && s.sampleUrls.length < 50) {
      s.sampleUrls.push({ url: rawUrl, fileName: fileName, domain: domain, reason: reason, action: resultAction, ou: ou, user: userIdent, date: eventDateStr });
    }
  }

  // 2. Timeline Aggregation (YYYY-MM-DD)
  if (eventDateStr) {
    if (!radar.timeline[eventDateStr]) {
      radar.timeline[eventDateStr] = {
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
      };
    }
    const t = radar.timeline[eventDateStr];
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
    if (!radar.actors[userIdent]) {
      radar.actors[userIdent] = {
        user: userIdent,
        ou: ou,
        unsafe: 0,
        password: 0,
        malware: 0,
        total: 0,
        totalEvents: 0,
        bypassed: 0,
        timeline: {}
      };
    }
    const a = radar.actors[userIdent];
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
      if (!a.timeline[eventDateStr]) {
        a.timeline[eventDateStr] = {
          date: eventDateStr,
          unsafe: 0,
          password: 0,
          malware: 0,
          total: 0,
          bypassed: 0,
          warned: 0
        };
      }
      const at = a.timeline[eventDateStr];
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
  if (userIdent) c.users[userIdent] = (c.users[userIdent] || 0) + 1;
  c.sources[host] = (c.sources[host] || 0) + 1;
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
  sp.hosts[h] = (sp.hosts[h] || 0) + 1;
  if (outcome === 'unmasked') {
    if (!sp.unmaskHosts) sp.unmaskHosts = {};
    sp.unmaskHosts[h] = (sp.unmaskHosts[h] || 0) + 1;
  }
  sp.hostClasses[hostClass] = (sp.hostClasses[hostClass] || 0) + 1;
  sp.ous[ou] = (sp.ous[ou] || 0) + 1;
  if (userIdent) sp.users[userIdent] = (sp.users[userIdent] || 0) + 1;
  if (dayKey) sp.daily[dayKey] = (sp.daily[dayKey] || 0) + 1;
  String(detectorText || '').split(',').map(d => d.trim()).filter(Boolean).forEach(d => {
    sp.detectors[d] = (sp.detectors[d] || 0) + 1;
  });
}
