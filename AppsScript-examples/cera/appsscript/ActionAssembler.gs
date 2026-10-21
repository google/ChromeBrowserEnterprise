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
 * Module: ActionAssembler.gs
 * Description: Folds the log rows Chrome writes for one user action into one action before anything is counted
 * ==============================================================================
 *
 * Chrome logs one action as several rows: a sensitive file upload as a Content transfer and two Sensitive data
 * transfer rows (one with the detector names, one without) within ~40 ms; a sensitive paste as two Sensitive data
 * transfer rows; a download as a Content transfer, a second Content transfer carrying the verdict up to a few seconds
 * later and sometimes a Sensitive data transfer row; a file it could not scan as a Content transfer and a Content
 * unscanned row; a dangerous download as a Malware transfer and a Content transfer.
 *
 * Rows of one action share a key: user | trigger type | URL, plus the size for uploads and pastes (several files can be
 * uploaded to one page within seconds, each with its own size). A row joins the action of its key when it is within
 * CeraConfig.ACTION_WINDOW_MS of the action's first row and its signature (event name, and whether it names detectors)
 * is not in the action yet. Otherwise it starts a new action, so the same file uploaded again seconds later stays a
 * second action. Sizes differ between the rows of one action in two cases, so the size is not part of their key:
 * - a print: only the row naming the detectors carries the page size, the others report 0;
 * - a download: the verdict rows report about 1 KB more than the transfer row (within
 *   CeraConfig.ACTION_SIZE_TOLERANCE_BYTES; a larger difference is another file).
 * A clipboard copy writes one row per clipboard format (text, HTML, image) within milliseconds, all with the same
 * signature: its rows join while each is within CeraConfig.ACTION_COPY_GAP_MS of the previous one.
 * A warning the user bypassed is logged as a WARNED row, then a row with the same signature reporting BYPASSED seconds
 * or minutes later: the BYPASSED row joins the warned action within CeraConfig.OUTCOME_BYPASS_WINDOW_MS.
 *
 * Rows come in any order: cloud partitions by day slice, then event stream, newest first; console exports newest
 * first; a 50,000-row partition can end in the middle of a day. Rows therefore wait per key and are clustered in time
 * order only once no row still to come can join them, so the actions never depend on the order of the rows.
 */

// Sort order of rows with the same time: these fields decide, in this order, so clustering is deterministic
var CERA_ACTION_TIEBREAK = ['sig', 'detector', 'reason', 'contentType', 'account', 'rawTabUrl', 'rawCategory', 'result',
  'contentName', 'ou'];

// File families by Content Name extension (ceraFileFamily_)
var CERA_FILE_FAMILY_EXTENSIONS = {
  pdf: ['pdf'],
  spreadsheet: ['xlsx', 'xls', 'xlsm', 'xlsb', 'csv', 'tsv', 'ods', 'numbers'],
  presentation: ['pptx', 'ppt', 'pptm', 'odp', 'key'],
  document: ['docx', 'doc', 'docm', 'odt', 'rtf', 'pages'],
  archive: ['zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz'],
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'tif', 'tiff', 'bmp', 'svg', 'heic', 'heif'],
  video: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'wmv', 'mpeg', 'mpg'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'],
  text: ['txt', 'md', 'log'],
  code: ['js', 'ts', 'py', 'java', 'c', 'h', 'cpp', 'cs', 'go', 'rb', 'php', 'sh', 'ps1', 'sql', 'json', 'xml', 'yaml',
    'yml', 'html', 'htm', 'css', 'ipynb'],
  executable: ['exe', 'msi', 'dmg', 'pkg', 'deb', 'rpm', 'apk', 'bat', 'cmd', 'jar', 'app'],
  extension: ['crx', 'xpi']
};

/**
 * Assembly state of a run, kept on the analysis state as a non-enumerable property so it never reaches rendered or
 * returned output. keys: assembly key -> { rows, minT, maxT } of the rows still waiting; pendingRows: their number;
 * at: time of the last row read; emit(action): aggregates one finalized action. Pending rows carry over from one
 * partition to the next. radar: signal | user | URL -> the Security Radar rows of that key (ceraAddRadarRow_), paired
 * into events once every row was read; emitRadar(event) aggregates one event.
 */
function ceraActionAssembly_(state, emit, emitRadar) {
  if (!state._actionAssembly) {
    Object.defineProperty(state, '_actionAssembly', {
      value: {
        keys: new Map(),
        pendingRows: 0,
        peakPending: 0,
        at: null,
        minT: Infinity,
        maxT: -Infinity,
        sheetMaxT: -Infinity,
        droppedOver25h: false,
        jumpedUpOver1h: false,
        census: null,
        sinceSweep: 0,
        sweepEvery: 1000,
        emit: emit,
        radar: new Map(),
        radarPendingRows: 0,
        emitRadar: emitRadar
      },
      enumerable: false,
      writable: true
    });
  }
  return state._actionAssembly;
}

/**
 * Merges overlapping [minT, maxT] intervals into sorted disjoint intervals for O(1) completeness checks.
 */
function ceraMergeIntervals_(intervals) {
  if (!Array.isArray(intervals) || !intervals.length) return [];
  const valid = intervals
    .filter(iv => iv && typeof iv[0] === 'number' && typeof iv[1] === 'number' && !isNaN(iv[0]) && !isNaN(iv[1]))
    .map(iv => (iv[0] <= iv[1] ? [iv[0], iv[1]] : [iv[1], iv[0]]))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (!valid.length) return [];
  const merged = [valid[0]];
  for (let i = 1; i < valid.length; i++) {
    const last = merged[merged.length - 1];
    if (valid[i][0] <= last[1] + 1) {
      if (valid[i][1] > last[1]) last[1] = valid[i][1];
    } else {
      merged.push(valid[i]);
    }
  }
  return merged;
}

/**
 * True when [a, b] intersects any interval in sorted disjoint intervals.
 */
function ceraIntersectsInterval_(a, b, intervals) {
  if (!Array.isArray(intervals) || !intervals.length) return false;
  for (let i = 0; i < intervals.length; i++) {
    const iv = intervals[i];
    if (iv[1] < a) continue;
    if (iv[0] > b) return false;
    return true;
  }
  return false;
}

/**
 * Builds a lightweight stream-run time census across partition rows so ceraSweepActions_ only finalizes a segment
 * once no unread run overlaps [seg.start - W_MS, seg.end + W_MS].
 */
function ceraBuildPartitionCensus_(partitions, dateOrder) {
  const runs = [];
  const list = Array.isArray(partitions) ? partitions : [];
  for (let p = 0; p < list.length; p++) {
    const rows = list[p];
    if (!Array.isArray(rows) || rows.length <= 1) continue;
    const col = typeof resolveColumnIndices === 'function' ? resolveColumnIndices(rows[0]) : { date: 0 };
    const dateIdx = col && col.date !== undefined ? col.date : 0;
    if (dateIdx === -1) continue;
    let runMin = Infinity;
    let runMax = -Infinity;
    let prevT = null;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r[dateIdx]) continue;
      const t = typeof parseTimestampToMs_ === 'function'
        ? parseTimestampToMs_(r[dateIdx], dateOrder)
        : new Date(r[dateIdx]).getTime();
      if (isNaN(t)) continue;
      if (prevT !== null && Math.abs(t - prevT) > 3600000 && runMin <= runMax) {
        runs.push({ partitionIndex: p, minT: runMin, maxT: runMax });
        runMin = Infinity;
        runMax = -Infinity;
      }
      if (t < runMin) runMin = t;
      if (t > runMax) runMax = t;
      prevT = t;
    }
    if (runMin <= runMax) {
      runs.push({ partitionIndex: p, minT: runMin, maxT: runMax });
    }
  }
  return {
    runs: runs,
    completedPartitions: 0,
    unread: ceraMergeIntervals_(runs.map(r => [r.minT, r.maxT]))
  };
}

/**
 * Attaches or updates the partition census on state._actionAssembly.
 */
function ceraSetActionCensus_(state, census) {
  if (!state || !state._actionAssembly) return;
  state._actionAssembly.census = census || null;
}

/**
 * Marks all census runs up to completedPartitions (exclusive) as read and sweeps newly completed action segments.
 */
function ceraAdvanceActionCensus_(state, completedPartitions) {
  const asm = state && state._actionAssembly;
  if (!asm || !asm.census || !Array.isArray(asm.census.runs)) return;
  asm.census.completedPartitions = completedPartitions;
  const remaining = [];
  for (let i = 0; i < asm.census.runs.length; i++) {
    const r = asm.census.runs[i];
    if (r.partitionIndex >= completedPartitions) remaining.push([r.minT, r.maxT]);
  }
  asm.census.unread = ceraMergeIntervals_(remaining);
  ceraSweepActions_(state, false);
}

/**
 * Adds one Security Radar row to the rows of its event: signal ('unsafe', 'malware' or 'password'), user, URL, time,
 * normalized result, and what the event records (unit, destination, reason, file name, day); reasonGiven tells whether
 * the row's own Event Reason says why it was logged (ceraReasonGiven_). Rows are grouped into events once every row
 * was read (ceraFlushRadarRows_), so the events never depend on the order of the rows.
 */
function ceraAddRadarRow_(state, signal, row) {
  const asm = state._actionAssembly;
  if (!asm) return;
  const key = signal + '|' + (row.user || '') + '|' + (row.url || '');
  let list = asm.radar.get(key);
  if (!list) asm.radar.set(key, list = []);
  list.push(Object.assign({ signal: signal }, row));
  asm.radarPendingRows = (asm.radarPendingRows || 0) + 1;
  if (asm.radarPendingRows > 20000) {
    ceraSweepRadarRows_(state, false);
  }
}

// Sort order of radar rows with the same time: these fields decide, in this order, so pairing is deterministic
var CERA_RADAR_TIEBREAK = ['result', 'reason', 'fileName', 'ou', 'domain', 'day'];
// Results that mark a Security Radar event: a row within CeraConfig.RADAR_EVENT_WINDOW_MS of one is part of its event
var CERA_RADAR_EVENT_RESULTS = ['WARNED', 'BLOCKED', 'BYPASSED'];
// Signals whose rows are folded into the event they belong to: Safe Browsing visits and flagged downloads. A password
// reuse row is an event of its own (a bypass still joins its warning).
var CERA_RADAR_FOLDED_SIGNALS = ['unsafe', 'malware'];

/**
 * Folds, sorts, and emits a list of [key, rows] Security Radar entries in chronological order.
 */
function ceraEmitRadarKeys_(asm, keyEntries) {
  if (!asm || !keyEntries || !keyEntries.length) return;
  const pairMs = CeraConfig.OUTCOME_BYPASS_WINDOW_MS || 600000;
  const events = [];
  keyEntries.forEach(entry => {
    const key = entry[0];
    const rows = entry[1];
    rows.sort(ceraCompareRadarRows_);
    let current = null;
    ceraFoldRadarRows_(rows).forEach(group => {
      const bypass = group.find(r => r.result === 'BYPASSED' && r.t !== null);
      const shown = group.some(r => r.result === 'WARNED' || r.result === 'BLOCKED');
      if (current && bypass && !shown && current.warnAt !== null && bypass.t - current.warnAt <= pairMs) {
        group.forEach(r => current.rows.push(r));
        return;
      }
      const warning = group.find(r => r.t !== null && (r.result === 'WARNED' || r.result === 'BYPASSED'));
      current = { signal: group[0].signal, key: key, t: group[0].t, rows: group, warnAt: warning ? warning.t : null };
      events.push(current);
    });
  });
  events.sort((a, b) => ((a.t === null ? Infinity : a.t) - (b.t === null ? Infinity : b.t)) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const order = CeraConfig.OUTCOME_PRECEDENCE;
  const rank = r => order.indexOf(ceraOutcomeClass_(r.result));
  events.forEach(ev => {
    ev.rows.sort(ceraCompareRadarRows_);
    ev.result = ev.rows.reduce((best, r) => (rank(r) < rank(best) ? r : best)).result;
    ev.reason = (ev.rows.find(r => r.reasonGiven) || ev.rows[0]).reason;
    if (asm.emitRadar) asm.emitRadar(ev);
  });
}

/**
 * Sweeps completed Security Radar keys when pending radar rows exceed 20,000 or at non-overlapping sheet boundaries.
 */
function ceraSweepRadarRows_(state, flush, nextFileRange) {
  if (flush) {
    ceraFlushRadarRows_(state);
    return;
  }
  const asm = state && state._actionAssembly;
  if (!asm || !asm.radar || !asm.radar.size) return;
  const hasNextRange = !!(nextFileRange && isFinite(nextFileRange.minT) && isFinite(nextFileRange.maxT) && !nextFileRange.overlapsAny);
  const overCap = (asm.radarPendingRows || 0) > 20000 && asm.at !== null;
  if (!hasNextRange && !overCap) return;

  const pairMs = (CeraConfig.OUTCOME_BYPASS_WINDOW_MS || 600000) * 2;
  const ready = [];
  asm.radar.forEach((rows, key) => {
    let kMin = Infinity;
    let kMax = -Infinity;
    for (let i = 0; i < rows.length; i++) {
      const t = rows[i].t;
      if (t !== null && typeof t === 'number' && !isNaN(t)) {
        if (t < kMin) kMin = t;
        if (t > kMax) kMax = t;
      }
    }
    if (!isFinite(kMin)) return;
    const evict = hasNextRange
      ? (kMax + pairMs < nextFileRange.minT || kMin - pairMs > nextFileRange.maxT)
      : (overCap && (kMax < asm.at - pairMs || kMin > asm.at + pairMs));
    if (evict) {
      ready.push([key, rows]);
    }
  });
  if (!ready.length) return;
  ready.forEach(entry => {
    asm.radar.delete(entry[0]);
    asm.radarPendingRows = Math.max(0, (asm.radarPendingRows || 0) - entry[1].length);
  });
  ceraEmitRadarKeys_(asm, ready);
}

/**
 * Pairs the Security Radar rows of each key (signal | user | URL) into events and hands each event to the aggregation
 * once, all events in time order. The rows of a key are sorted by time, then:
 *   1. one visit or flagged download can be logged as several rows, e.g. a DETECTED row with no reason 40-90 ms
 *      before the WARNED row: a row within CeraConfig.RADAR_EVENT_WINDOW_MS of a WARNED, BLOCKED or BYPASSED row is
 *      part of its event (ceraFoldRadarRows_);
 *   2. a bypass is logged as a WARNED row, then a BYPASSED row once the user proceeds, seconds or minutes later: an
 *      event of BYPASSED rows with no WARNED or BLOCKED row joins the warning before it when within
 *      CeraConfig.OUTCOME_BYPASS_WINDOW_MS of it (a second BYPASSED row of the same warning joins as well).
 * An event is { signal, key, t, rows, result, reason }: result is the result of its strongest row by
 * CeraConfig.OUTCOME_PRECEDENCE (BYPASSED for a bypassed warning), reason the first reason of its rows that says why
 * it was logged (reasonGiven: not blank, not EVENT_REASON_UNSPECIFIED), otherwise the reason of its first row.
 */
function ceraFlushRadarRows_(state) {
  const asm = state._actionAssembly;
  if (!asm || !asm.radar || !asm.radar.size) return;
  const entries = Array.from(asm.radar.entries());
  asm.radar = new Map();
  asm.radarPendingRows = 0;
  ceraEmitRadarKeys_(asm, entries);
}

/**
 * Splits the sorted rows of one radar key into the rows of each event (step 1 of ceraFlushRadarRows_): WARNED, BLOCKED
 * and BYPASSED rows within CeraConfig.RADAR_EVENT_WINDOW_MS of the previous one are one event; any other row joins the
 * nearest of them within that window (the later one when both are as near: a detection is logged just before its
 * warning), or is a group of its own. Rows of a signal outside CERA_RADAR_FOLDED_SIGNALS, and rows without a time,
 * are a group each. Returns the groups in time order, each sorted (ceraCompareRadarRows_).
 */
function ceraFoldRadarRows_(rows) {
  const windowMs = CeraConfig.RADAR_EVENT_WINDOW_MS || 2000;
  const fold = rows.length > 1 && CERA_RADAR_FOLDED_SIGNALS.indexOf(rows[0].signal) !== -1;
  const marks = r => fold && r.t !== null && CERA_RADAR_EVENT_RESULTS.indexOf(r.result) !== -1;
  const groups = [];
  const groupOf = new Map();
  const anchors = rows.filter(marks);
  anchors.forEach((r, i) => {
    const prev = i > 0 ? anchors[i - 1] : null;
    const group = prev && r.t - prev.t <= windowMs ? groupOf.get(prev) : null;
    if (group) group.push(r);
    else groups.push([r]);
    groupOf.set(r, group || groups[groups.length - 1]);
  });
  let next = 0;
  rows.forEach(r => {
    if (marks(r)) return;
    let near = null;
    if (fold && r.t !== null) {
      while (next < anchors.length && anchors[next].t < r.t) next++;
      const after = next < anchors.length ? anchors[next] : null;
      const before = next > 0 ? anchors[next - 1] : null;
      const dAfter = after ? after.t - r.t : Infinity;
      const dBefore = before ? r.t - before.t : Infinity;
      if (Math.min(dAfter, dBefore) <= windowMs) near = dAfter <= dBefore ? after : before;
    }
    if (near) groupOf.get(near).push(r);
    else groups.push([r]);
  });
  groups.forEach(g => g.sort(ceraCompareRadarRows_));
  return groups.sort((a, b) => ceraCompareRadarRows_(a[0], b[0]));
}

/** Time order of radar rows (rows without a time last), then CERA_RADAR_TIEBREAK for rows with the same time. */
function ceraCompareRadarRows_(a, b) {
  if (a.t !== b.t) return (a.t === null ? Infinity : a.t) - (b.t === null ? Infinity : b.t);
  for (let i = 0; i < CERA_RADAR_TIEBREAK.length; i++) {
    const x = String(a[CERA_RADAR_TIEBREAK[i]] || '');
    const y = String(b[CERA_RADAR_TIEBREAK[i]] || '');
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** True when an Event Reason says why a row was logged: not blank and not unspecified (EVENT_REASON_UNSPECIFIED). */
function ceraReasonGiven_(reason) {
  const s = String(reason || '').trim();
  return !!s && !/UNSPECIFIED/i.test(s);
}

/**
 * Records the time of the row being read and updates stream monotonicity watermarks.
 */
function ceraActionClock_(state, ms) {
  const asm = state._actionAssembly;
  if (!asm || typeof ms !== 'number' || isNaN(ms)) return;
  if (typeof asm.sheetMaxT !== 'number') asm.sheetMaxT = asm.maxT;
  if (asm.at !== null) {
    if (ms > asm.at + 3600000) asm.jumpedUpOver1h = true;
    if (asm.sheetMaxT > -Infinity && asm.sheetMaxT - ms > 25 * 3600000) asm.droppedOver25h = true;
  }
  asm.at = ms;
  if (ms < asm.minT) asm.minT = ms;
  if (ms > asm.maxT) asm.maxT = ms;
  if (ms > asm.sheetMaxT) asm.sheetMaxT = ms;
}

/**
 * Notifies the action assembler that a new source sheet is starting (rowCursor === 0).
 * Sweeps completed segments from the finished sheet, evicts segments disjoint from a non-overlapping
 * sheet range, and resets per-sheet clock monotonicity so multi-sheet manual exports continue sweeping.
 */
function ceraNotifySheetStart_(state, fileRange) {
  const asm = state && state._actionAssembly;
  if (!asm) return;
  const W_MS = (CeraConfig.OUTCOME_BYPASS_WINDOW_MS || 600000) + (CeraConfig.ACTION_WINDOW_MS || 10000) + 60000;
  if (asm.keys && asm.keys.size > 0) {
    ceraSweepActions_(state, false);
    if (!asm.census) {
      const nonOverlapping = !fileRange || !fileRange.overlapsAny;
      const hasNextRange = !!(fileRange && isFinite(fileRange.minT) && isFinite(fileRange.maxT) && !fileRange.overlapsAny);
      if ((nonOverlapping && !asm.jumpedUpOver1h && asm.at !== null) || hasNextRange) {
        const at = asm.at;
        asm.keys.forEach((entry, key) => {
          const keep = [];
          ceraActionSegments_(entry.rows).forEach(seg => {
            const doneByPrevSheet = nonOverlapping && !asm.jumpedUpOver1h && at !== null && seg.start > at + W_MS;
            const doneByNextRange = hasNextRange && (seg.end + W_MS < fileRange.minT || seg.start - W_MS > fileRange.maxT);
            if (doneByPrevSheet || doneByNextRange) {
              ceraFinalizeActionRows_(state, asm, seg.rows);
            } else {
              keep.push(seg);
            }
          });
          ceraKeepActionSegments_(asm, key, keep);
        });
      }
    }
  }
  ceraSweepRadarRows_(state, false, fileRange);
  if (typeof ceraPruneStateForScale_ === 'function') {
    ceraPruneStateForScale_(state, { keepTopActors: 50 });
  }
  const keepScrambledFlags = !!(asm.jumpedUpOver1h && asm.droppedOver25h && fileRange && fileRange.overlapsAny);
  asm.at = null;
  asm.sheetMaxT = -Infinity;
  if (!keepScrambledFlags) {
    asm.jumpedUpOver1h = false;
    asm.droppedOver25h = false;
  }
}

/**
 * Adds a normalized transfer row (ceraNormalizeRow_) to the rows waiting for their action. A row without a time
 * cannot be matched with other rows and is an action of its own.
 */
function ceraAddActionRow_(state, rec) {
  const asm = state._actionAssembly;
  if (rec.t === null) {
    ceraFinalizeActionRows_(state, asm, [rec]);
    return;
  }
  ceraActionClock_(state, rec.t);
  const trigger = String(rec.triggerType || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const sized = rec.direction === 'upload' || rec.direction === 'paste';
  const key = rec.userIdent + '|' + trigger + '|' + rec.rawUrl + (sized ? '|' + rec.sizeBytes : '');
  let entry = asm.keys.get(key);
  if (!entry) {
    entry = { rows: [], minT: rec.t, maxT: rec.t };
    asm.keys.set(key, entry);
  }
  entry.rows.push(rec);
  if (rec.t < entry.minT) entry.minT = rec.t;
  if (rec.t > entry.maxT) entry.maxT = rec.t;
  asm.pendingRows++;
  if (asm.pendingRows > asm.peakPending) asm.peakPending = asm.pendingRows;
  // A sweep visits every waiting key, so the next one comes after as many rows as were left waiting (at least 1,000)
  asm.sinceSweep++;
  const cap = CeraConfig.ACTION_PENDING_MAX || 50000;
  if (asm.sinceSweep >= asm.sweepEvery || asm.pendingRows > cap) {
    ceraSweepActions_(state, false);
    asm.sweepEvery = Math.max(1000, asm.pendingRows);
  }
}

/**
 * Finalizes every action still waiting for rows, then pairs the Security Radar rows into events (a dangerous download's
 * rows reach them through its action), and folds the browser launch events into launches (BrowserLaunches.gs). Called
 * once all partitions were read; safe to call again.
 */
function ceraFlushActions_(state) {
  if (!state) return;
  ceraFlushLaunches_(state);
  if (!state._actionAssembly) return;
  ceraSweepActions_(state, true);
  ceraFlushRadarRows_(state);
}

/**
 * Finalizes the waiting rows no row still to come can join (Q5-C completeness rule).
 * - When a partition census is present (asm.census), a segment is complete iff [seg.start - W_MS, seg.end + W_MS]
 *   does not intersect any unread stream run.
 * - Without a pre-pass census:
 *   - In monotonic descending Export Order (!asm.jumpedUpOver1h), segments with seg.start > at + hold (or > at + W_MS
 *     when pendingRows > cap) are finalized.
 *   - In chronological day-slice Writer Order (!asm.droppedOver25h), segments from completed earlier day slices
 *     (seg.end < asm.maxT - (25h + W_MS)) are finalized without evicting active in-slice rows.
 *   - Distance-based cap eviction runs when pendingRows exceeds CeraConfig.ACTION_PENDING_MAX (50,000) or capOverride.
 */
function ceraSweepActions_(state, flush, capOverride) {
  const asm = state._actionAssembly;
  if (!asm) return;
  const hold = CeraConfig.ACTION_HOLD_MS || 2 * 86400000;
  const W_MS = (CeraConfig.OUTCOME_BYPASS_WINDOW_MS || 600000) + (CeraConfig.ACTION_WINDOW_MS || 10000) + 60000;
  const DAY_SLICE_HOLD_MS = 25 * 3600000 + W_MS;
  const cap = capOverride !== undefined ? capOverride : (CeraConfig.ACTION_PENDING_MAX || 50000);
  const explicitSmallCap = capOverride !== undefined || (CeraConfig.ACTION_PENDING_MAX && CeraConfig.ACTION_PENDING_MAX < 50000);
  const emergencyCeiling = CeraConfig.ACTION_PENDING_MAX || cap;
  const at = asm.at;
  asm.sinceSweep = 0;

  if (flush) {
    asm.keys.forEach((entry, key) => {
      ceraActionSegments_(entry.rows).forEach(seg => ceraFinalizeActionRows_(state, asm, seg.rows));
      ceraKeepActionSegments_(asm, key, []);
    });
    return;
  }

  if (asm.census && Array.isArray(asm.census.unread)) {
    const unread = asm.census.unread;
    asm.keys.forEach((entry, key) => {
      if (ceraIntersectsInterval_(entry.minT - W_MS, entry.maxT + W_MS, unread) && entry.rows.length === 1) return;
      const keep = [];
      ceraActionSegments_(entry.rows).forEach(seg => {
        if (!ceraIntersectsInterval_(seg.start - W_MS, seg.end + W_MS, unread)) {
          ceraFinalizeActionRows_(state, asm, seg.rows);
        } else {
          keep.push(seg);
        }
      });
      ceraKeepActionSegments_(asm, key, keep);
    });
  } else if (!asm.jumpedUpOver1h && at !== null) {
    // Monotonic descending stream (Admin Console export order)
    const horizon = asm.pendingRows > cap ? W_MS : hold;
    asm.keys.forEach((entry, key) => {
      if (entry.maxT <= at + horizon) return;
      const keep = [];
      ceraActionSegments_(entry.rows).forEach(seg => {
        if (seg.start > at + horizon) ceraFinalizeActionRows_(state, asm, seg.rows);
        else keep.push(seg);
      });
      ceraKeepActionSegments_(asm, key, keep);
    });
  } else if (!asm.droppedOver25h && asm.maxT > -Infinity) {
    // Cloud partition writer order (chronological 24h day slices, multi-stream within each day slice)
    const cutoff = asm.maxT - DAY_SLICE_HOLD_MS;
    asm.keys.forEach((entry, key) => {
      if (entry.minT >= cutoff) return;
      const keep = [];
      ceraActionSegments_(entry.rows).forEach(seg => {
        if (seg.end < cutoff) ceraFinalizeActionRows_(state, asm, seg.rows);
        else keep.push(seg);
      });
      ceraKeepActionSegments_(asm, key, keep);
    });
  }

  const effectiveCap = explicitSmallCap ? cap : emergencyCeiling;
  if (asm.pendingRows <= effectiveCap) return;

  const byKey = new Map();
  const all = [];
  asm.keys.forEach((entry, key) => {
    const list = ceraActionSegments_(entry.rows).map(seg => ({ key: key, seg: seg, dist: Math.max(seg.start - at, at - seg.end, 0) }));
    byKey.set(key, list);
    list.forEach(x => all.push(x));
  });
  all.sort((a, b) => b.dist - a.dist || a.seg.start - b.seg.start || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const target = capOverride !== undefined ? cap : Math.floor(effectiveCap * 0.9);
  let left = asm.pendingRows;
  const touched = new Set();
  for (let i = 0; i < all.length && left > target; i++) {
    all[i].done = true;
    left -= all[i].seg.rows.length;
    touched.add(all[i].key);
    ceraFinalizeActionRows_(state, asm, all[i].seg.rows);
  }
  touched.forEach(key => ceraKeepActionSegments_(asm, key, byKey.get(key).filter(x => !x.done).map(x => x.seg)));
}

/**
 * Sorts the rows of a key (ceraCompareActionRows_) and splits them where two rows are more than
 * CeraConfig.ACTION_WINDOW_MS apart, except before a BYPASSED row that follows a WARNED row of the segment
 * (ceraBypassFollows_). Returns [{ rows, start, end }] in time order.
 */
function ceraActionSegments_(rows) {
  if (rows.length === 1) return [{ rows: rows, start: rows[0].t, end: rows[0].t }];
  if (!rows.length) return [];
  const windowMs = CeraConfig.ACTION_WINDOW_MS || 10000;
  rows.sort(ceraCompareActionRows_);
  const out = [];
  const close = (from, to) => {
    const seg = rows.slice(from, to);
    out.push({ rows: seg, start: seg[0].t, end: seg[seg.length - 1].t });
  };
  let from = 0;
  let warnAt = null;
  for (let i = 0; i < rows.length; i++) {
    if (i > from && rows[i].t - rows[i - 1].t > windowMs && !ceraBypassFollows_(rows[i], warnAt)) {
      close(from, i);
      from = i;
      warnAt = null;
    }
    if (rows[i].result === 'WARNED') warnAt = rows[i].t;
  }
  if (rows.length) close(from, rows.length);
  return out;
}

/**
 * True when a row is the bypass of a warning: a BYPASSED row within CeraConfig.OUTCOME_BYPASS_WINDOW_MS after the
 * WARNED row logged at warnAt for the same key. Chrome logs a bypassed warning as a WARNED row, then a BYPASSED row
 * once the user proceeds, seconds or minutes later.
 */
function ceraBypassFollows_(r, warnAt) {
  return r.result === 'BYPASSED' && warnAt !== null && warnAt !== undefined && r.t !== null &&
    r.t >= warnAt && r.t - warnAt <= (CeraConfig.OUTCOME_BYPASS_WINDOW_MS || 600000);
}

/**
 * Replaces the waiting rows of a key with the segments that are still waiting.
 */
function ceraKeepActionSegments_(asm, key, segments) {
  const entry = asm.keys.get(key);
  const before = entry ? entry.rows.length : 0;
  if (!segments.length) {
    asm.keys.delete(key);
    asm.pendingRows -= before;
    return;
  }
  const rows = [];
  segments.forEach(seg => seg.rows.forEach(r => rows.push(r)));
  asm.keys.set(key, { rows: rows, minT: segments[0].start, maxT: segments[segments.length - 1].end });
  asm.pendingRows -= before - rows.length;
}

/**
 * Time order of rows, then CERA_ACTION_TIEBREAK for rows with the same time.
 */
function ceraCompareActionRows_(a, b) {
  if (a.t !== b.t) return a.t - b.t;
  for (let i = 0; i < CERA_ACTION_TIEBREAK.length; i++) {
    const x = String(a[CERA_ACTION_TIEBREAK[i]] || '');
    const y = String(b[CERA_ACTION_TIEBREAK[i]] || '');
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Clusters rows of one key (sorted, ceraActionSegments_) into actions and hands each action to the aggregation once.
 * A row joins the current action when it is within CeraConfig.ACTION_WINDOW_MS of the action's first row and its
 * signature is not in the action yet, or when it is the bypass of the action's warning; otherwise it starts the next
 * action. After a bypass the window starts again at the bypass, so the rows Chrome writes once the user proceeds join.
 */
function ceraFinalizeActionRows_(state, asm, rows) {
  if (rows.length === 1) {
    state.coverage.actions = (state.coverage.actions || 0) + 1;
    asm.emit(ceraMergeActionRows_(rows));
    if ((state.coverage.actions % 25000) === 0 && typeof ceraPruneStateForScale_ === 'function') {
      ceraPruneStateForScale_(state, { keepTopActors: 50 });
    }
    return;
  }
  const clusters = [];
  let current = null;
  rows.forEach(r => {
    if (current && r.t !== null && ceraRowJoinsAction_(current, r)) {
      current.rows.push(r);
      if (ceraBypassFollows_(r, current.warnAt)) current.t0 = r.t;
    } else {
      current = { t0: r.t, rows: [r], sigs: Object.create(null), size: 0, warnAt: null };
      clusters.push(current);
    }
    current.sigs[r.sig] = true;
    current.last = r.t;
    if (r.result === 'WARNED') current.warnAt = r.t;
    if (!current.size && r.sizeBytes) current.size = r.sizeBytes;
  });
  clusters.forEach(c => {
    state.coverage.actions = (state.coverage.actions || 0) + 1;
    state.coverage.rowsMerged = (state.coverage.rowsMerged || 0) + c.rows.length - 1;
    asm.emit(ceraMergeActionRows_(c.rows));
    if ((state.coverage.actions % 25000) === 0 && typeof ceraPruneStateForScale_ === 'function') {
      ceraPruneStateForScale_(state, { keepTopActors: 50 });
    }
  });
}

/**
 * Whether a row belongs to the action being built (same key, rows in time order): a copy while it follows the previous
 * row within CeraConfig.ACTION_COPY_GAP_MS; the bypass of the action's warning (ceraBypassFollows_); anything else
 * within CeraConfig.ACTION_WINDOW_MS of the action's first row with a signature the action does not have yet; a
 * download only when its size is within CeraConfig.ACTION_SIZE_TOLERANCE_BYTES of the action's (or one of them is 0).
 */
function ceraRowJoinsAction_(action, r) {
  if (r.direction === 'copy') return r.t - action.last <= (CeraConfig.ACTION_COPY_GAP_MS || 1000);
  const bypass = ceraBypassFollows_(r, action.warnAt);
  if (!bypass && (r.t - action.t0 > (CeraConfig.ACTION_WINDOW_MS || 10000) || action.sigs[r.sig])) return false;
  if (r.direction === 'download' && r.sizeBytes && action.size) {
    return Math.abs(r.sizeBytes - action.size) <= (CeraConfig.ACTION_SIZE_TOLERANCE_BYTES || 2048);
  }
  return true;
}

/**
 * Stable file family of a transfer: pdf, spreadsheet, presentation, document, archive, image, video, audio, text, code,
 * executable, extension or other. The extension of the Content Name decides first (CERA_FILE_FAMILY_EXTENSIONS);
 * without a known one the MIME type does. A paste or a printed page (text/plain, text/html) is text.
 */
function ceraFileFamily_(contentName, mime, outboundKind) {
  const name = String(contentName || '').trim().toLowerCase();
  const dot = name.lastIndexOf('.');
  if (dot > 0 && dot < name.length - 1) {
    const ext = name.slice(dot + 1);
    const families = Object.keys(CERA_FILE_FAMILY_EXTENSIONS);
    for (let i = 0; i < families.length; i++) {
      if (CERA_FILE_FAMILY_EXTENSIONS[families[i]].indexOf(ext) !== -1) return families[i];
    }
  }
  const m = String(mime || '').trim().toLowerCase().split(';')[0];
  if (!m) return outboundKind === 'paste' ? 'text' : 'other';
  if (m === 'application/pdf') return 'pdf';
  if (/x-chrome-extension|x-xpinstall/.test(m)) return 'extension';
  if (/spreadsheet|excel|^text\/csv$|^application\/csv$|tab-separated-values/.test(m)) return 'spreadsheet';
  if (/presentation|powerpoint/.test(m)) return 'presentation';
  if (/wordprocessing|msword|opendocument\.text|rtf$/.test(m)) return 'document';
  if (/zip|x-7z|[.-]rar|x-tar|gzip|x-bzip|x-xz/.test(m)) return 'archive';
  if (/^image\//.test(m)) return 'image';
  if (/^video\//.test(m)) return 'video';
  if (/^audio\//.test(m)) return 'audio';
  if (/x-msdownload|x-msdos-program|x-msi|x-ms-installer|x-apple-diskimage|newton-compatible-pkg|debian\.binary-package|x-rpm|x-executable|x-mach-binary|android\.package-archive|java-archive/.test(m)) return 'executable';
  if (/javascript|ecmascript|json|xml|x-python|x-sh|x-shellscript|x-java|x-csrc|x-c\+\+|x-php|typescript|x-ruby|x-sql/.test(m)) return 'code';
  if (/^text\//.test(m)) return 'text';
  return 'other';
}

/**
 * File name of a Content Name: its base name only, never a path. Chrome logs the full local path of many files
 * (C:\Users\<name>\Downloads\..., /home/chronos/u-<id>/MyFiles/..., /Users/<name>/...), and a folder can name the
 * user. A generic value that names no file (CeraConfig.GENERIC_CONTENT_NAMES, e.g. "Text data" for a paste) is ''.
 */
function ceraContentFileName_(contentName) {
  let name = String(contentName === null || contentName === undefined ? '' : contentName).trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(name)) name = name.replace(/[?#].*$/, '');
  const base = name.split(/[\\/]/).pop().trim();
  if (!base) return '';
  return (CeraConfig.GENERIC_CONTENT_NAMES || []).indexOf(base.toLowerCase()) !== -1 ? '' : base;
}

/**
 * Name of a malware payload: the base name of its Content Name (ceraContentFileName_); otherwise the last segment of
 * its URL path when that segment has a file extension (setup.exe); otherwise '' (a blob: download named by a random
 * id has no file name).
 */
function ceraMalwareFileName_(contentName, rawUrl) {
  const name = ceraContentFileName_(contentName);
  if (name) return name;
  const m = String(rawUrl || '').trim().replace(/^blob:/i, '').match(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*(\/[^?#]*)/i);
  if (!m) return '';
  let last = m[1].split('/').pop();
  try { last = decodeURIComponent(last); } catch (e) {}
  const ext = last.match(/^[^.].*\.([a-z0-9]{1,8})$/i);
  return ext && /[a-z]/i.test(ext[1]) ? last : '';
}

/**
 * Class of the Web App Account an action was made with: corporate (a corporate domain or a subdomain of one), consumer
 * (a personal mailbox, CeraConfig.CONSUMER_EMAIL_DOMAINS), partner (a domain the customer listed as a partner),
 * otherOrg (another organization; decided only when corporate domains are known), or '' (no account). Consumer and
 * otherOrg accounts are personal accounts; corporate and partner accounts are not.
 */
function ceraAccountClass_(account, corpDomains, partnerDomains) {
  const value = String(account || '').trim().toLowerCase();
  const domain = value.indexOf('@') !== -1 ? value.split('@').pop() : '';
  if (!domain) return '';
  const corp = (corpDomains || []).filter(Boolean);
  if (corp.some(cd => domainMatches(domain, cd))) return 'corporate';
  if ((CeraConfig.CONSUMER_EMAIL_DOMAINS || []).some(d => domainMatches(domain, d))) return 'consumer';
  if ((partnerDomains || []).some(pd => pd && domainMatches(domain, pd))) return 'partner';
  return corp.length > 0 ? 'otherOrg' : '';
}

/**
 * True when a row reports sensitive content: a Sensitive data transfer row, a CONTENT_MATCHED_SENSITIVE_DATA_TYPES
 * reason, or detector names.
 */
function ceraRowIsSensitive_(r) {
  return String(r.reason || '').toUpperCase().indexOf('CONTENT_MATCHED_SENSITIVE_DATA_TYPES') !== -1 ||
    String(r.eventName || '').indexOf('sensitive') !== -1 || String(r.detector || '').trim().length > 0;
}

/**
 * Size of an action: the smallest non-zero size of its rows (the transfer row of a download reports the file, its
 * verdict rows about 1 KB more; a print's size is on its detector row only). A copy takes the largest of its formats.
 */
function ceraActionSize_(rows) {
  if (rows[0].direction === 'copy') return rows.reduce((m, r) => Math.max(m, r.sizeBytes || 0), 0);
  return rows.reduce((m, r) => (r.sizeBytes && (!m || r.sizeBytes < m) ? r.sizeBytes : m), 0);
}

/**
 * One action from the rows of a cluster, in time order. The action keeps the key fields, time (with the offset it was
 * written with, tzOffsetMin) and unit of its first row (a unit the logs reported wins over an unreported one); it is
 * sensitive when any row is, and keeps the union of the detector names, the unscanned and malware flags, the set of
 * event results (blocked, bypassed and warned derived from it, and one outcome, ceraActionOutcome_), and the first
 * Content Name, Web App Account, Tab URL, URL category (a categorized one first) and content type (a specific one before
 * application/octet-stream) that is not empty.
 */
function ceraMergeActionRows_(rows) {
  const first = rows[0];
  const a = {
    t: first.t, user: first.userIdent, ou: first.ou, triggerType: first.triggerType, direction: first.direction,
    url: first.rawUrl, size: ceraActionSize_(rows), rows: rows.length, tzOffsetMin: first.tzOffsetMin,
    sensitive: false, detectors: [], unscanned: false, malware: false, malwareRows: [],
    results: [], blocked: false, bypassed: false, warned: false,
    contentName: '', account: '', tabUrl: '', category: '', contentType: ''
  };
  let ouReported = first.ouReported;
  let anyCategory = '';
  let anyType = '';
  rows.forEach(r => {
    if (ceraRowIsSensitive_(r)) a.sensitive = true;
    String(r.detector || '').split(',').forEach(d => {
      const name = d.trim();
      if (name && a.detectors.indexOf(name) === -1) a.detectors.push(name);
    });
    if (r.eventName.indexOf('unscanned') !== -1) a.unscanned = true;
    if (r.isMalware) {
      a.malware = true;
      a.malwareRows.push(r);
    }
    if (r.result && a.results.indexOf(r.result) === -1) a.results.push(r.result);
    if (!ouReported && r.ouReported) {
      a.ou = r.ou;
      ouReported = true;
    }
    if (!a.contentName && r.contentName) a.contentName = r.contentName;
    if (!a.account && r.account) a.account = r.account;
    if (!a.tabUrl && r.rawTabUrl) a.tabUrl = r.rawTabUrl;
    if (!a.category && r.rawCategory && !/^(uncategorized|unspecified|none)$/i.test(r.rawCategory)) a.category = r.rawCategory;
    if (!anyCategory && r.rawCategory) anyCategory = r.rawCategory;
    if (!a.contentType && r.contentType && !/octet-stream/i.test(r.contentType)) a.contentType = r.contentType;
    if (!anyType && r.contentType) anyType = r.contentType;
  });
  a.category = a.category || anyCategory || 'Uncategorized';
  a.contentType = a.contentType || anyType;
  a.blocked = a.results.indexOf('BLOCKED') !== -1;
  a.bypassed = a.results.indexOf('BYPASSED') !== -1;
  a.warned = a.results.indexOf('WARNED') !== -1;
  // One outcome from the results of all its rows (CeraConfig.OUTCOME_PRECEDENCE)
  a.outcome = ceraActionOutcome_(a.results);
  return a;
}
