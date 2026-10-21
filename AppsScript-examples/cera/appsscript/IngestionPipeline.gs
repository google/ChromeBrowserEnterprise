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
 * ==============================================================================
 * CHROME EGRESS RISK ANALYSIS (CERA)
 * Module: IngestionPipeline.gs
 * Description: Streaming telemetry ingestion, row normalization & per-action aggregation engine
 * ==============================================================================
 */

var CERA_BATCH_CACHE_CHUNK = 75000;
var CERA_BATCH_CACHE_TTL_SEC = 21600;
var CERA_BATCH_MAX_PENDING_ROWS = 50000;

function ceraAnalysisBatchCache_() {
  try {
    if (typeof CacheService !== 'undefined' && CacheService) {
      return CacheService.getUserCache() || CacheService.getScriptCache();
    }
  } catch (e) {}
  return null;
}

function ceraAnalysisJobPropKey_() {
  return (typeof CeraConfig !== 'undefined' && CeraConfig.ANALYSIS_CHECKPOINT_PROP_KEY)
    ? String(CeraConfig.ANALYSIS_CHECKPOINT_PROP_KEY)
    : 'CERA_ANALYSIS_JOB';
}

function ceraCreateDedupeStore_() {
  return {
    eventIds: new Set(),
    rowHashes: new Map(),
    fileRanges: {},
    _sheetOcc: new Map(),
    _sheetOccFileIdx: -1,
    totalSheets: 0
  };
}

function ceraDedupeStore_(state) {
  if (!state._dedupeStore) {
    Object.defineProperty(state, '_dedupeStore', {
      value: ceraCreateDedupeStore_(),
      enumerable: false,
      writable: true
    });
  }
  return state._dedupeStore;
}

function ceraSerializeDedupeStore_(dedupeStore, keepSheetOcc) {
  if (!dedupeStore) return null;
  return {
    eventIds: Array.from(dedupeStore.eventIds || []).slice(-100000),
    rowHashes: Array.from((dedupeStore.rowHashes || new Map()).entries()).slice(-50000),
    fileRanges: dedupeStore.fileRanges || {},
    _sheetOcc: keepSheetOcc && dedupeStore._sheetOcc ? Array.from(dedupeStore._sheetOcc.entries()).slice(-50000) : [],
    _sheetOccFileIdx: keepSheetOcc && typeof dedupeStore._sheetOccFileIdx === 'number' ? dedupeStore._sheetOccFileIdx : -1,
    totalSheets: Number(dedupeStore.totalSheets) || 0
  };
}

function ceraRestoreDedupeStore_(state, rawDedupe) {
  if (!rawDedupe || !state) return null;
  const store = ceraDedupeStore_(state);
  store.eventIds = new Set(rawDedupe.eventIds || []);
  store.rowHashes = new Map(rawDedupe.rowHashes || []);
  store.fileRanges = rawDedupe.fileRanges || {};
  store._sheetOcc = new Map(rawDedupe._sheetOcc || []);
  store._sheetOccFileIdx = typeof rawDedupe._sheetOccFileIdx === 'number' ? rawDedupe._sheetOccFileIdx : -1;
  store.totalSheets = Number(rawDedupe.totalSheets) || 0;
  return store;
}

function ceraCompactStateForRender_(state) {
  if (!state) return;
  if (typeof ceraPruneStateForScale_ === 'function') {
    ceraPruneStateForScale_(state, { keepTopActors: 50 });
  }
  state._dedupeStore = null;
  state._actionAssembly = null;
  state._launchRows = null;
  state._destCache = null;
  state._domainScopeCache = null;
  state._accountClassCache = null;
  state._ouLabels = null;
}

function ceraSaveAnalysisBatch_(token, checkpoint) {
  const cache = ceraAnalysisBatchCache_();
  const state = checkpoint.state;
  const phase = checkpoint.phase || 'ingest';
  const isRenderPhase = phase === 'render' || phase === 'render_slides';
  if (state && typeof ceraPruneStateForScale_ === 'function') {
    ceraPruneStateForScale_(state, { keepTopActors: 50 });
  }
  if (!isRenderPhase && state && state._actionAssembly && typeof ceraSweepActions_ === 'function') {
    // Q5-C: Sweep only provably complete action segments; never force-evict active day-slice rows down to 2,000
    ceraSweepActions_(state, false);
  }
  const asm = !isRenderPhase && state ? state._actionAssembly : null;
  const launchStore = !isRenderPhase && state ? state._launchRows : null;
  const dedupeStore = (!isRenderPhase && checkpoint.dedupeStore !== null && state) ? state._dedupeStore : null;
  const sheetsCount = checkpoint.sheetsProcessedCount !== undefined ? checkpoint.sheetsProcessedCount : (checkpoint.sheetsProcessed || 0);
  const payload = JSON.stringify({
    jobId: token,
    batchToken: token,
    generation: checkpoint.generation || 1,
    hostSpreadsheetId: checkpoint.hostSpreadsheetId || '',
    folderId: checkpoint.folderId || '',
    targetPresentationId: checkpoint.targetPresentationId || '',
    phase: phase,
    queue: checkpoint.queue,
    nextIndex: checkpoint.nextIndex,
    rowCursor: checkpoint.rowCursor || 0,
    sheetsProcessedCount: sheetsCount,
    unreadableSheets: checkpoint.unreadableSheets || [],
    errors: checkpoint.errors || [],
    state: state,
    hourSlots: (state && state._hourSlots) ? Object.keys(state._hourSlots).map(Number) : [],
    dateOrder: (state && state._dateOrder) || 'MDY',
    dedupe: dedupeStore ? ceraSerializeDedupeStore_(dedupeStore, (checkpoint.rowCursor || 0) > 0) : null,
    asm: asm ? {
      keys: Array.from(asm.keys.entries()),
      pendingRows: asm.pendingRows,
      peakPending: asm.peakPending,
      at: asm.at,
      sheetMaxT: (typeof asm.sheetMaxT === 'number' && isFinite(asm.sheetMaxT)) ? asm.sheetMaxT : null,
      minT: isFinite(asm.minT) ? asm.minT : null,
      maxT: isFinite(asm.maxT) ? asm.maxT : null,
      droppedOver25h: !!asm.droppedOver25h,
      jumpedUpOver1h: !!asm.jumpedUpOver1h,
      census: asm.census || null,
      sinceSweep: asm.sinceSweep,
      sweepEvery: asm.sweepEvery,
      radarPendingRows: asm.radarPendingRows || 0,
      radar: Array.from(asm.radar.entries())
    } : null,
    launches: launchStore && launchStore.events ? {
      keys: Array.from(launchStore.keys.entries()),
      names: launchStore.names,
      events: launchStore.events
    } : null
  });

  const chunks = typeof ceraSliceUtf8Chunks_ === 'function'
    ? ceraSliceUtf8Chunks_(payload, CERA_BATCH_CACHE_CHUNK)
    : [payload];
  const prefix = 'CERA_ANALYSIS_BATCH_' + token + '_';
  let wroteCache = false;
  if (cache) {
    try {
      for (let i = 0; i < chunks.length; i++) {
        cache.put(prefix + i, chunks[i], CERA_BATCH_CACHE_TTL_SEC);
      }
      cache.put(prefix + 'meta', JSON.stringify({ chunks: chunks.length, savedAt: Date.now() }), CERA_BATCH_CACHE_TTL_SEC);
      wroteCache = true;
    } catch (cErr) {}
  }

  // Durable fallback in ScriptProperties / DocumentProperties + Drive checkpoint file so CacheService eviction never loses state
  let checkpointFileId = '';
  try {
    if (checkpoint.folderId && typeof Drive !== 'undefined' && Drive.Files && typeof Drive.Files.create === 'function') {
      const cpName = 'cera-analysis-checkpoint-' + token + '.json';
      const existing = Drive.Files.list({
        q: `'${checkpoint.folderId}' in parents and name = '${cpName}' and trashed = false`,
        fields: 'files(id)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      });
      const blob = (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.newBlob === 'function')
        ? Utilities.newBlob(payload, 'application/json', cpName)
        : null;
      if (existing && existing.files && existing.files.length > 0) {
        checkpointFileId = existing.files[0].id;
        Drive.Files.update({ name: cpName, mimeType: 'application/json', _checkpointPayload: payload }, checkpointFileId, blob, { supportsAllDrives: true });
      } else {
        const created = Drive.Files.create({ name: cpName, mimeType: 'application/json', parents: [checkpoint.folderId], _checkpointPayload: payload }, blob, { supportsAllDrives: true });
        if (created && created.id) checkpointFileId = created.id;
      }
    }
  } catch (dErr) {}

  let wrotePropFallback = false;
  try {
    if (typeof PropertiesService !== 'undefined' && PropertiesService) {
      const scriptProps = PropertiesService.getScriptProperties && PropertiesService.getScriptProperties();
      if (scriptProps && payload.length < 400000) {
        const propChunks = typeof ceraSliceUtf8Chunks_ === 'function' ? ceraSliceUtf8Chunks_(payload, 8000) : [payload];
        for (let i = 0; i < propChunks.length; i++) {
          scriptProps.setProperty(prefix + 'P_' + i, propChunks[i]);
        }
        scriptProps.setProperty(prefix + 'P_meta', JSON.stringify({ chunks: propChunks.length, savedAt: Date.now() }));
        wrotePropFallback = true;
      }
      const docProps = PropertiesService.getDocumentProperties && PropertiesService.getDocumentProperties();
      if (docProps) {
        docProps.setProperty(ceraAnalysisJobPropKey_(), JSON.stringify({
          jobId: token,
          batchToken: token,
          hostSpreadsheetId: checkpoint.hostSpreadsheetId || '',
          folderId: checkpoint.folderId || '',
          checkpointFileId: checkpointFileId,
          generation: checkpoint.generation || 1,
          nextIndex: checkpoint.nextIndex || 0,
          rowCursor: checkpoint.rowCursor || 0,
          sheetsProcessed: sheetsCount,
          totalSheets: Array.isArray(checkpoint.queue) ? checkpoint.queue.length : 0,
          phase: phase,
          targetPresentationId: checkpoint.targetPresentationId || '',
          updatedAt: Date.now()
        }));
      }
    }
  } catch (pErr) {}

  if (!wroteCache && !checkpointFileId && !wrotePropFallback) {
    throw new Error('CacheService unavailable for batch continuation');
  }
}

function ceraLoadAnalysisBatch_(token, scope) {
  if (!token) return null;
  const cache = ceraAnalysisBatchCache_();
  const prefix = 'CERA_ANALYSIS_BATCH_' + token + '_';
  let rawJson = '';

  if (cache) {
    try {
      const metaRaw = cache.get(prefix + 'meta');
      if (metaRaw) {
        const meta = JSON.parse(metaRaw);
        const parts = [];
        let complete = true;
        for (let i = 0; i < (meta.chunks || 0); i++) {
          const part = cache.get(prefix + i);
          if (part === null || part === undefined) {
            complete = false;
            break;
          }
          parts.push(part);
        }
        if (complete && parts.length > 0) rawJson = parts.join('');
      }
    } catch (cErr) {}
  }

  // Fallback 1: Durable ScriptProperties chunks when CacheService entry was evicted
  if (!rawJson) {
    try {
      const scriptProps = (typeof PropertiesService !== 'undefined' && PropertiesService && PropertiesService.getScriptProperties)
        ? PropertiesService.getScriptProperties()
        : null;
      if (scriptProps) {
        const pMetaRaw = scriptProps.getProperty(prefix + 'P_meta');
        if (pMetaRaw) {
          const pMeta = JSON.parse(pMetaRaw);
          const pParts = [];
          let pComplete = true;
          for (let i = 0; i < (pMeta.chunks || 0); i++) {
            const pPart = scriptProps.getProperty(prefix + 'P_' + i);
            if (pPart === null || pPart === undefined) {
              pComplete = false;
              break;
            }
            pParts.push(pPart);
          }
          if (pComplete && pParts.length > 0) rawJson = pParts.join('');
        }
      }
    } catch (pErr) {}
  }

  // Fallback 2: Durable Drive checkpoint file
  if (!rawJson) {
    try {
      const docProps = (typeof PropertiesService !== 'undefined' && PropertiesService && PropertiesService.getDocumentProperties)
        ? PropertiesService.getDocumentProperties()
        : null;
      const rawJob = docProps ? docProps.getProperty(ceraAnalysisJobPropKey_()) : '';
      const jobMeta = rawJob ? JSON.parse(rawJob) : null;
      if (jobMeta && jobMeta.checkpointFileId && typeof Drive !== 'undefined' && Drive.Files && typeof Drive.Files.get === 'function') {
        const fileObj = Drive.Files.get(jobMeta.checkpointFileId, { alt: 'media', supportsAllDrives: true });
        if (typeof fileObj === 'string' && fileObj.trim().charAt(0) === '{') {
          rawJson = fileObj;
        } else if (fileObj && typeof fileObj._checkpointPayload === 'string') {
          rawJson = fileObj._checkpointPayload;
        }
      }
    } catch (dErr) {}
  }

  if (!rawJson) return null;
  const saved = JSON.parse(rawJson);
  const state = saved.state;
  if (state) {
    if (state.minDate) state.minDate = new Date(state.minDate);
    if (state.maxDate) state.maxDate = new Date(state.maxDate);
    if (Array.isArray(saved.hourSlots)) {
      const hs = Object.create(null);
      for (let i = 0; i < saved.hourSlots.length; i++) hs[saved.hourSlots[i]] = 1;
      Object.defineProperty(state, '_hourSlots', { value: hs, enumerable: false, writable: true });
    }
    if (saved.dateOrder) {
      Object.defineProperty(state, '_dateOrder', { value: saved.dateOrder, enumerable: false, writable: true });
    }
    if (saved.dedupe) {
      ceraRestoreDedupeStore_(state, saved.dedupe);
    }
    if (saved.asm) {
      const asm = ceraActionAssembly_(state, action => ceraAggregateAction_(action, scope, state), event => ceraAggregateRadarEvent_(event, state));
      asm.keys = new Map(saved.asm.keys || []);
      asm.pendingRows = saved.asm.pendingRows || 0;
      asm.peakPending = saved.asm.peakPending || 0;
      asm.at = saved.asm.at;
      asm.sheetMaxT = (typeof saved.asm.sheetMaxT === 'number' && !isNaN(saved.asm.sheetMaxT)) ? saved.asm.sheetMaxT : -Infinity;
      asm.minT = (typeof saved.asm.minT === 'number' && !isNaN(saved.asm.minT)) ? saved.asm.minT : Infinity;
      asm.maxT = (typeof saved.asm.maxT === 'number' && !isNaN(saved.asm.maxT)) ? saved.asm.maxT : -Infinity;
      asm.droppedOver25h = !!saved.asm.droppedOver25h;
      asm.jumpedUpOver1h = !!saved.asm.jumpedUpOver1h;
      asm.census = saved.asm.census || null;
      asm.sinceSweep = saved.asm.sinceSweep || 0;
      asm.sweepEvery = saved.asm.sweepEvery || 1000;
      asm.radarPendingRows = saved.asm.radarPendingRows || 0;
      asm.radar = new Map(saved.asm.radar || []);
    }
    if (saved.launches && saved.launches.events) {
      const names = saved.launches.names || [''];
      const keys = new Map((saved.launches.keys || []).map(pair => {
        const entry = pair[1];
        if (entry && Array.isArray(entry.rows)) {
          for (let i = 0; i < entry.rows.length; i += 3) {
            if (entry.rows[i] === null) entry.rows[i] = NaN;
          }
        }
        return [pair[0], entry];
      }));
      Object.defineProperty(state, '_launchRows', {
        value: { keys: keys, names: names, nameIds: new Map(names.map((n, i) => [n, i])), events: saved.launches.events },
        enumerable: false,
        writable: true
      });
    }
  }
  return saved;
}

function ceraClearAnalysisBatch_(token) {
  try {
    const cache = ceraAnalysisBatchCache_();
    const prefix = 'CERA_ANALYSIS_BATCH_' + token + '_';
    if (cache && token) {
      const metaRaw = cache.get(prefix + 'meta');
      if (metaRaw) {
        const meta = JSON.parse(metaRaw);
        for (let i = 0; i < (meta.chunks || 0); i++) cache.remove(prefix + i);
      }
      cache.remove(prefix + 'meta');
    }
    if (typeof PropertiesService !== 'undefined' && PropertiesService) {
      const scriptProps = PropertiesService.getScriptProperties && PropertiesService.getScriptProperties();
      if (scriptProps && token) {
        const pMetaRaw = scriptProps.getProperty(prefix + 'P_meta');
        if (pMetaRaw) {
          const pMeta = JSON.parse(pMetaRaw);
          for (let i = 0; i < (pMeta.chunks || 0); i++) scriptProps.deleteProperty(prefix + 'P_' + i);
        }
        scriptProps.deleteProperty(prefix + 'P_meta');
      }
      const docProps = PropertiesService.getDocumentProperties && PropertiesService.getDocumentProperties();
      if (docProps) {
        const rawJob = docProps.getProperty(ceraAnalysisJobPropKey_());
        if (rawJob) {
          const parsed = JSON.parse(rawJob);
          if (!token || parsed.batchToken === token) {
            if (parsed && parsed.checkpointFileId) {
              try {
                if (typeof Drive !== 'undefined' && Drive.Files) {
                  if (typeof Drive.Files.update === 'function') {
                    Drive.Files.update({ trashed: true }, parsed.checkpointFileId, null, { supportsAllDrives: true });
                  } else if (typeof Drive.Files.remove === 'function') {
                    Drive.Files.remove(parsed.checkpointFileId);
                  }
                }
              } catch (driveCleanErr) {}
            }
            docProps.deleteProperty(ceraAnalysisJobPropKey_());
          }
        }
      }
    }
  } catch (e) {}
}

/**
 * Sorts folder sheets chronologically by partition number (_part_NNN / part N / export N) or YYYY-MM-DD date
 * in the file name while preserving relative order for unnumbered sheets.
 */
function ceraSortPartitionQueue_(queue) {
  if (!Array.isArray(queue) || queue.length <= 1) return queue;
  const extractKey = (item, idx) => {
    const name = String((item && item.name) || '');
    const id = String((item && item.id) || '');
    const partMatch = name.match(/(?:_part_?|\bpart(?:ition)?[\s_-]*|\bexport[\s_-]*)(\d+)\b/i) ||
      id.match(/(?:_part_?)(\d+)\b/i);
    const partNum = partMatch ? Number(partMatch[1]) : null;
    const dateMatch = name.match(/\b(20\d{2})[-_]?(\d{2})[-_]?(\d{2})\b/);
    const dateKey = dateMatch ? (dateMatch[1] + dateMatch[2] + dateMatch[3]) : '';
    return { item: item, idx: idx, partNum: partNum, dateKey: dateKey };
  };
  const decorated = queue.map(extractKey);
  const anyNumbered = decorated.some(d => d.partNum !== null || d.dateKey !== '');
  if (!anyNumbered) return queue;
  decorated.sort((a, b) => {
    if (a.partNum !== null && b.partNum !== null && a.partNum !== b.partNum) return a.partNum - b.partNum;
    if (a.dateKey && b.dateKey && a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? -1 : 1;
    if (a.partNum !== null && b.partNum === null) return -1;
    if (a.partNum === null && b.partNum !== null) return 1;
    return a.idx - b.idx;
  });
  return decorated.map(d => d.item);
}

/**
 * True when an Event cell names a known out-of-scope ChromeOS device or Admin telemetry event (BP-11).
 * Out-of-scope events are skipped and counted in coverage.rowsOutOfScope before enum coverage checks so mixed
 * Admin Console exports with ChromeOS device rows succeed while unsupported locales still fail at the 99% gate.
 */
function ceraIsOutOfScopeChromeEvent_(rawVal) {
  if (rawVal === null || rawVal === undefined || rawVal === '') return false;
  const s = String(rawVal).trim();
  if (!s) return false;
  if (typeof CERA_CONSOLE_LABELS !== 'undefined' && CERA_CONSOLE_LABELS.events) {
    const k = typeof ceraNormConsoleKey_ === 'function' ? ceraNormConsoleKey_(s) : s.toLowerCase();
    const mapped = CERA_CONSOLE_LABELS.events[k];
    if (mapped && /^(Browser crash|Browser extension install|Extension request|URL filtering|Certificate|Login|Sync|Data access)$/i.test(mapped)) {
      return true;
    }
  }
  return /^(chrome\s*os\b|chromeos_|device[\s_]+(boot|shutdown|sleep|power|enrolled|unenrolled|status|report|sync|update)|crd[\s_]+session|kiosk[\s_]+|telemetry[\s_]+event|os[\s_]+update|screen[\s_]+(lock|unlock)|storage[\s_]+status|network[\s_]+state|audio[\s_]+device|usb[\s_]+device|peripheral[\s_]+(added|removed)|extension[\s_]+(installed|install|modified|removed|request|telemetry)|browser[\s_]+extension|web_protect_extension_install|browser[\s_]+(crash|error)|url[\s_]+(blocked|filtering|visited|warned)|certificate|client[\s_]+certificate|login\b|logout\b|profile[\s_]+signin|sync\b|data[\s_]+access|class[\s_]+tools)/i.test(s);
}

/**
 * Computes a compact 64-bit fingerprint (16 hex chars) from two independent 32-bit hashes across all cells
 * of a row (optionally skipping skipCol) without allocating intermediate row.map(...).join(...) strings.
 */
function ceraHashRow64_(row, skipCol) {
  let h1 = 0x811c9dc5;
  let h2 = 0xdeadbeef;
  const rawLen = row ? row.length : 0;
  let end = rawLen - 1;
  while (end >= 0) {
    if (end === skipCol) {
      end--;
      continue;
    }
    const v = row[end];
    if (v !== null && v !== undefined && v !== '' && (typeof v === 'string' ? v.trim() : String(v).trim()) !== '') {
      break;
    }
    end--;
  }
  let first = true;
  for (let i = 0; i <= end; i++) {
    if (i === skipCol) continue;
    if (!first) {
      h1 = Math.imul(h1 ^ 1, 0x01000193);
      h2 = Math.imul(h2 ^ 1, 0x5bd1e995);
    }
    first = false;
    const v = row[i];
    if (v === null || v === undefined || v === '') continue;
    const s = typeof v === 'string' ? v.trim() : String(v).trim();
    for (let j = 0; j < s.length; j++) {
      const c = s.charCodeAt(j);
      h1 = Math.imul(h1 ^ c, 0x01000193);
      h2 = Math.imul(h2 ^ c, 0x5bd1e995);
    }
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/**
 * True when fileRanges[fileIdx] overlaps the [minT, maxT] time span of any other indexed file.
 */
function ceraFileOverlapsAny_(fileRanges, fileIdx) {
  if (!fileRanges) return false;
  const r1 = fileRanges[fileIdx];
  if (!r1) return false;
  const keys = Object.keys(fileRanges);
  if (keys.length <= 1) return false;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (String(k) === String(fileIdx)) continue;
    const r2 = fileRanges[k];
    if (!r2) continue;
    if (!(isFinite(r1.minT) && isFinite(r1.maxT) && isFinite(r2.minT) && isFinite(r2.maxT))) return true;
    if (r1.minT <= r2.maxT && r2.minT <= r1.maxT) return true;
  }
  return false;
}

/**
 * Annotates every entry in fileRanges with overlapsAny and overlapsPrev.
 */
function ceraIndexFileRanges_(fileRanges) {
  if (!fileRanges) return fileRanges;
  const keys = Object.keys(fileRanges);
  for (let i = 0; i < keys.length; i++) {
    const idx = keys[i];
    const r = fileRanges[idx];
    if (!r) continue;
    r.overlapsAny = ceraFileOverlapsAny_(fileRanges, idx);
    const prev = fileRanges[Number(idx) - 1];
    r.overlapsPrev = Boolean(prev && (
      !(isFinite(r.minT) && isFinite(r.maxT) && isFinite(prev.minT) && isFinite(prev.maxT)) ||
      (r.minT <= prev.maxT && prev.minT <= r.maxT)
    ));
  }
  return fileRanges;
}

/**
 * Prunes rowHashes entries from earlier partition sheets whose time ranges are strictly disjoint from curFileIdx,
 * keeping store.rowHashes compact across 70+ chronological partition sheets while preserving 100% of overlapping boundary hashes.
 */
function ceraPruneDisjointRowHashes_(store, curFileIdx) {
  if (!store || !store.rowHashes || !store.fileRanges || !(curFileIdx > 0)) return;
  const rCur = store.fileRanges[curFileIdx];
  if (!rCur || !rCur.isPartition || !(isFinite(rCur.minT) && isFinite(rCur.maxT))) return;
  for (const entry of store.rowHashes.entries()) {
    const k = entry[0];
    const fIdx = entry[1];
    if (fIdx < curFileIdx) {
      const rPrev = store.fileRanges[fIdx];
      if (rPrev && rPrev.isPartition && isFinite(rPrev.minT) && isFinite(rPrev.maxT) &&
          !(rPrev.minT <= rCur.maxT && rCur.minT <= rPrev.maxT)) {
        store.rowHashes.delete(k);
      }
    }
  }
}

/**
 * Universal 4-scenario row deduplication:
 * 1. When Event ID (col.eventId) is present and non-empty: deduplicates by (Timestamp, Event, Event ID) across all sheets
 *    (bounded at 150,000 keys with FIFO eviction).
 * 2. When Event ID is absent:
 *    - Single-sheet runs (store.totalSheets === 1) return false immediately (0 bytes RAM).
 *    - Multi-sheet runs compute per-sheet occurrence keys (baseHash#occ via store._sheetOcc) so intra-sheet
 *      sub-second identical rows without Event ID are never dropped, while cross-sheet overlapping rows are deduped.
 */
function ceraShouldDedupeRow_(row, col, fileIdx, isCeraPartition, store) {
  if (!store || !row) return false;
  if (col && col.eventId !== undefined && col.eventId !== -1) {
    const rawId = row[col.eventId];
    if (rawId !== null && rawId !== undefined && String(rawId).trim() !== '') {
      const tsStr = (col.date !== -1 && row[col.date] !== null && row[col.date] !== undefined) ? String(row[col.date]).trim() : '';
      const evStr = (col.event !== -1 && row[col.event] !== null && row[col.event] !== undefined) ? String(row[col.event]).trim() : '';
      const idKey = tsStr + '|' + evStr + '|' + String(rawId).trim();
      if (store.eventIds.has(idKey)) return true;
      if (store.eventIds.size >= 150000) {
        const oldestId = store.eventIds.keys().next().value;
        if (oldestId !== undefined) store.eventIds.delete(oldestId);
      }
      store.eventIds.add(idKey);
      if (store.totalSheets !== 1) {
        const baseHash = ceraHashRow64_(row, col.eventId);
        if (!store._sheetOcc || store._sheetOccFileIdx !== fileIdx) {
          store._sheetOcc = new Map();
          store._sheetOccFileIdx = fileIdx;
        }
        const occ = (store._sheetOcc.get(baseHash) || 0) + 1;
        store._sheetOcc.set(baseHash, occ);
        const rowKey = occ === 1 ? baseHash : (baseHash + '#' + occ);
        if (!store.rowHashes.has(rowKey)) {
          if (store.rowHashes.size >= 250000) {
            const oldestHash = store.rowHashes.keys().next().value;
            if (oldestHash !== undefined) store.rowHashes.delete(oldestHash);
          }
          store.rowHashes.set(rowKey, fileIdx);
        }
      }
      return false;
    }
  }
  if (store.totalSheets === 1) return false;
  const baseHash = ceraHashRow64_(row, col ? col.eventId : -1);
  if (!store._sheetOcc || store._sheetOccFileIdx !== fileIdx) {
    store._sheetOcc = new Map();
    store._sheetOccFileIdx = fileIdx;
  }
  const occ = (store._sheetOcc.get(baseHash) || 0) + 1;
  store._sheetOcc.set(baseHash, occ);
  const rowKey = occ === 1 ? baseHash : (baseHash + '#' + occ);
  const firstFile = store.rowHashes.get(rowKey);
  if (firstFile === undefined) {
    if (store.rowHashes.size >= 250000) {
      const oldestHash = store.rowHashes.keys().next().value;
      if (oldestHash !== undefined) store.rowHashes.delete(oldestHash);
    }
    store.rowHashes.set(rowKey, fileIdx);
    return false;
  }
  if (firstFile === fileIdx) {
    return false;
  }
  const r1 = store.fileRanges && store.fileRanges[firstFile];
  const r2 = store.fileRanges && store.fileRanges[fileIdx];
  const overlaps = !r1 || !r2 ||
    !(isFinite(r1.minT) && isFinite(r1.maxT) && isFinite(r2.minT) && isFinite(r2.maxT)) ||
    (r1.minT <= r2.maxT && r2.minT <= r1.maxT);
  return Boolean(overlaps);
}

/**
 * Reads an explicit A1 range from a source spreadsheet via Sheets API v4 with up to 3 retry attempts.
 */
function ceraReadSheetRangeWithRetry_(spreadsheetId, a1Range) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = Sheets.Spreadsheets.Values.get(spreadsheetId, a1Range);
      return (resp && Array.isArray(resp.values)) ? resp.values : [];
    } catch (err) {
      lastErr = err;
      if (attempt < 3) {
        try { Utilities.sleep(300 * attempt); } catch (sErr) {}
      }
    }
  }
  if (lastErr) throw lastErr;
  return [];
}

/**
 * Reads a source spreadsheet with up to 3 retry attempts on transient errors. Uses the Sheets API v4 fast path
 * first, falling back to SpreadsheetApp.openById.
 */
function ceraReadSourceSheetWithRetry_(item, preloadedGridInfo) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let data = null;
    try {
      if (typeof Sheets !== 'undefined' && Sheets.Spreadsheets && Sheets.Spreadsheets.Values) {
        const range = (attempt === 1 && preloadedGridInfo && preloadedGridInfo.fullRange)
          ? preloadedGridInfo.fullRange
          : ceraSourceSheetRange_(item.id);
        let resp = Sheets.Spreadsheets.Values.get(item.id, range);
        if (resp && resp.values && resp.values.length > 1) {
          data = resp.values;
        }
        resp = null;
      }
    } catch (fastErr) {
      lastErr = fastErr;
    }
    if (!data) {
      try {
        const extSs = SpreadsheetApp.openById(item.id);
        const targetSheet = extSs.getSheetByName('Raw Data') || extSs.getSheets()[0];
        if (targetSheet && targetSheet.getLastRow() > 1) {
          data = targetSheet.getDataRange().getValues();
        } else if (targetSheet) {
          data = [];
        }
        lastErr = null;
      } catch (openErr) {
        lastErr = openErr;
      }
    }
    if (data !== null) return data;
    if (attempt < 3) {
      try { Utilities.sleep(300 * attempt); } catch (sErr) {}
    }
  }
  if (lastErr) throw lastErr;
  return [];
}

/**
 * Builds coverageMeta (Q3b-C) summarizing the time window, actual span, hourly coverage, internal gaps,
 * read-side deduplication count, unreadable sheets, and active report time zone.
 */
function ceraBuildCoverageMeta_(state, params, outlierMetrics, unreadableSheets, targetId) {
  const cov = (state && state.coverage) || {};
  const minMs = state && state.minDate instanceof Date ? state.minDate.getTime() : (state && state.minDate ? new Date(state.minDate).getTime() : NaN);
  const maxMs = state && state.maxDate instanceof Date ? state.maxDate.getTime() : (state && state.maxDate ? new Date(state.maxDate).getTime() : NaN);
  const hasSpan = isFinite(minMs) && isFinite(maxMs) && maxMs >= minMs;
  const actualSpanHours = hasSpan ? Math.round(((maxMs - minMs) / 3600000) * 100) / 100 : 0;
  const actualSpanDays = hasSpan ? Math.round(((maxMs - minMs) / 86400000) * 100) / 100 : 0;

  const hourSlots = (state && state._hourSlots) || {};
  const slotNums = Object.keys(hourSlots).map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
  const coveredHours = slotNums.length;
  const gapRanges = [];
  let missingHours = 0;
  for (let i = 1; i < slotNums.length; i++) {
    const gap = slotNums[i] - slotNums[i - 1] - 1;
    if (gap >= 6) {
      missingHours += gap;
      gapRanges.push({
        startIso: new Date((slotNums[i - 1] + 1) * 3600000).toISOString(),
        endIso: new Date(slotNums[i] * 3600000).toISOString(),
        hours: gap
      });
    }
  }

  let sessionWindowDays = 0;
  let sessionStoppedEarly = false;
  try {
    const docProps = (typeof PropertiesService !== 'undefined' && PropertiesService && PropertiesService.getDocumentProperties)
      ? PropertiesService.getDocumentProperties()
      : null;
    const rawSession = docProps ? docProps.getProperty('SIERRA_SESSION') : '';
    if (rawSession) {
      const sess = JSON.parse(rawSession);
      if (sess && (!targetId || sess.folderId === targetId)) {
        sessionWindowDays = Number(sess.dateRangeDays) || 0;
        sessionStoppedEarly = !!(sess.stoppedEarly || sess.status === 'STOPPED_PARTIAL' || (sess.timeSpanPct !== undefined && Number(sess.timeSpanPct) < 99.5 && !sess.isCompleted));
      }
    }
  } catch (sErr) {}

  const rawCalDays = outlierMetrics && outlierMetrics.calendarDays ? Number(outlierMetrics.calendarDays) : 0;
  let windowDays = Number(params && (params.windowDays || params.rangeDays)) || sessionWindowDays || 0;
  if (!windowDays && hasSpan && rawCalDays > 1) {
    const candidate = rawCalDays - 1;
    if ([7, 14, 30, 60, 90, 180].indexOf(candidate) !== -1 && actualSpanDays > candidate - 0.5 && actualSpanDays <= candidate + 0.05) {
      windowDays = candidate;
    }
  }

  const stoppedEarly = Boolean(
    (params && params.stoppedEarly) ||
    sessionStoppedEarly ||
    cov.truncated ||
    (Number(cov.sheetsTotal) > 0 && Number(cov.sheetsRead) < Number(cov.sheetsTotal))
  );
  const unreadableList = Array.isArray(unreadableSheets) ? unreadableSheets : [];
  const isPartial = Boolean(
    stoppedEarly ||
    unreadableList.length > 0 ||
    (windowDays > 0 && actualSpanDays > 0 && actualSpanDays < windowDays * 0.85)
  );
  const effectiveCalDays = (!stoppedEarly && windowDays > 0 && rawCalDays === windowDays + 1 && actualSpanDays <= windowDays + 0.05)
    ? windowDays
    : rawCalDays;

  return {
    windowDays: windowDays,
    actualSpanDays: actualSpanDays,
    actualSpanHours: actualSpanHours,
    coveredHours: coveredHours,
    calendarDays: effectiveCalDays,
    rawCalendarDays: rawCalDays,
    stoppedEarly: stoppedEarly,
    isPartial: isPartial,
    partial: isPartial,
    isPartialWindow: isPartial,
    missingHours: missingHours,
    gapRanges: gapRanges,
    sheetsRead: Number(cov.sheetsRead || 0),
    sheetsTotal: Number(cov.sheetsTotal || 0),
    partitionsRead: Number(cov.sheetsRead || 0),
    partitionsTotal: Number(cov.sheetsTotal || 0),
    dedupedRowCount: Number(cov.rowsDeduped || 0),
    rowsOutOfScope: Number(cov.rowsOutOfScope || 0),
    unreadableSheets: unreadableList,
    reportTz: (state && state.reportTz) || (typeof ceraTimeZone === 'function' ? ceraTimeZone() : 'UTC')
  };
}

function executeDlpAnalysis(params) {
  params = params || {};
  let lock = null;
  try {
    if (typeof LockService !== 'undefined' && LockService) {
      lock = (typeof LockService.getDocumentLock === 'function' && LockService.getDocumentLock()) ||
        (typeof LockService.getScriptLock === 'function' && LockService.getScriptLock()) || null;
      if (lock && typeof lock.tryLock === 'function') {
        if (!lock.tryLock(15000)) {
          throw new Error('Another analysis run is currently in progress. Please wait a moment and try again.');
        }
      }
    }
  } catch (lockErr) {
    if (lockErr && /Another analysis run is currently in progress/.test(lockErr.message)) throw lockErr;
    lock = null;
  }

  try {
    const lang = ceraNormalizeLang_(params.lang || ceraGetLanguage());
    const currentSs = SpreadsheetApp.getActiveSpreadsheet();
    const currentSsId = currentSs.getId();

    const corpDomains = parseDomains(params.corpDomains);
    const authorizedGenAi = parseDomains(params.authorizedGenAi);
    const sanctionedProd = parseDomains(params.sanctionedProductivity);
    const webMessaging = parseDomains(params.webMessagingDomains);

    // Backend Resolution: Grouping "All Registered Domains (x)" automatically incorporates all corporate registered domains into Sanctioned Productivity
    const hasAllRegisteredGrouping = sanctionedProd.some(d => /all\s*registered\s*domains/i.test(d)) ||
      /all\s*registered\s*domains/i.test(params.sanctionedProductivity || '');
    if (hasAllRegisteredGrouping && corpDomains && corpDomains.length > 0) {
      corpDomains.forEach(cd => {
        const cleanCd = cd.toLowerCase().trim();
        if (cleanCd && !sanctionedProd.includes(cleanCd)) {
          sanctionedProd.push(cleanCd);
        }
      });
    }

    const scope = { corpDomains: corpDomains, authorizedGenAi: authorizedGenAi, sanctionedProd: sanctionedProd, webMessaging: webMessaging };
    const allowContinuation = !!params.allowContinuation;
    const batchToken = params.batchToken ? String(params.batchToken) : (params.jobId ? String(params.jobId) : '');

    // Generation guard: reject stale continuation batch tokens superseded by a newer analysis run
    let activeGeneration = Number(params.generation) || 1;
    try {
      const docProps = (typeof PropertiesService !== 'undefined' && PropertiesService && PropertiesService.getDocumentProperties)
        ? PropertiesService.getDocumentProperties()
        : null;
      if (docProps) {
        const rawJob = docProps.getProperty(ceraAnalysisJobPropKey_());
        if (rawJob) {
          const existingJob = JSON.parse(rawJob);
          if (batchToken && existingJob && existingJob.batchToken && existingJob.batchToken !== batchToken &&
              Number(existingJob.generation) > activeGeneration) {
            throw new Error('Stale analysis batch token superseded by a newer run.');
          }
          if (!batchToken && existingJob && Number(existingJob.generation) >= activeGeneration) {
            activeGeneration = Number(existingJob.generation) + 1;
          }
        }
      }
    } catch (genErr) {
      if (genErr && /Stale analysis batch token/.test(genErr.message)) throw genErr;
    }

    const resumed = batchToken ? ceraLoadAnalysisBatch_(batchToken, scope) : null;
    if (batchToken && !resumed) {
      throw new Error('Analysis batch checkpoint expired or could not be loaded for token: ' + batchToken);
    }

    const resolvedTz = typeof ceraSetReportTimeZone_ === 'function'
      ? ceraSetReportTimeZone_(params.reportTz || params.timeZone || (resumed && resumed.state && resumed.state.reportTz) || '')
      : (typeof ceraTimeZone === 'function' ? ceraTimeZone() : 'UTC');

    let state;
    let errors;
    let unreadableSheets;
    let sheetsProcessedCount;
    let queue;
    let nextIndex = 0;
    let rowCursor = 0;
    let targetPresentationId = params.targetPresentationId || (resumed && resumed.targetPresentationId) || '';
    const targetInput = (params.driveFolderInput || '').trim();
    const targetId = extractFolderId(targetInput);

    if (resumed) {
      state = resumed.state;
      state.scope = { partnerDomains: parseDomains(params.partnerDomains || ''), authorizedGenAi: authorizedGenAi };
      state.reportLang = lang;
      state.reportTz = resolvedTz;
      errors = resumed.errors || [];
      unreadableSheets = resumed.unreadableSheets || [];
      sheetsProcessedCount = resumed.sheetsProcessedCount || 0;
      queue = resumed.queue || [];
      nextIndex = resumed.nextIndex || 0;
      rowCursor = resumed.rowCursor || 0;
      activeGeneration = resumed.generation || activeGeneration;
    } else {
      state = createInitialState();
      // Customer scope that is not a classification list of its own: partner tenants are external organizations
      // the customer works with, so their accounts are not counted as personal accounts.
      state.scope = { partnerDomains: parseDomains(params.partnerDomains || ''), authorizedGenAi: authorizedGenAi };
      // Language and time zone of the generated deck and report
      state.reportLang = lang;
      state.reportTz = resolvedTz;

      errors = [];
      unreadableSheets = [];
      const processedFileIds = new Set();
      // Strictly exclude active spreadsheet itself from being read as raw telemetry
      processedFileIds.add(currentSsId);
      sheetsProcessedCount = 0;
      queue = [];

      if (!targetId) {
        throw new Error(ceraT('err.noSource', null, lang));
      }

      updateProgress(ceraT('prog.resolving', null, lang), '', 0, 1, errors);

      // Auto-detect whether target is a single Google Sheet or a Drive Folder
      let isSingleSheet = false;
      if (targetInput.includes('/spreadsheets/d/')) {
        isSingleSheet = true;
      }

      // Name and type of the target from its Drive metadata (drive.metadata.readonly); the sheets themselves are read
      // through the Sheets API. Stays null when Drive cannot read the ID, which is then opened with SpreadsheetApp.
      let target = null;
      let targetErr = null;
      try {
        target = Drive.Files.get(targetId, { fields: 'id,name,mimeType', supportsAllDrives: true });
        if (target.mimeType === MimeType.GOOGLE_SHEETS) {
          isSingleSheet = true;
        }
      } catch (e) {
        // Kept for the fallback below: an ID Drive cannot read may still open as a spreadsheet
        targetErr = e;
      }

      if (isSingleSheet) {
        // 1. Single Google Sheet Direct Ingestion
        if (target) {
          queue.push({ isLocal: false, name: target.name, id: target.id });
        } else {
          try {
            const extSs = SpreadsheetApp.openById(targetId);
            queue.push({ isLocal: false, name: extSs.getName(), id: targetId });
          } catch (openErr) {
            errors.push(`Google Sheet Access Error: ${openErr.message}`);
          }
        }
      } else if (target) {
        // 2. Google Drive Folder Ingestion (Multiple Sheets)
        // Every sheet of the folder or none: part of a folder would be analyzed as if it were the whole, and "no sheets"
        // would be untrue, so a listing that keeps failing stops the analysis with its own message
        let files;
        try {
          files = ceraFolderSheets_(target.id);
        } catch (listErr) {
          throw new Error(ceraT('err.listFailed', { error: listErr.message }, lang));
        }
        files.forEach(file => {
          if (processedFileIds.has(file.id)) {
            // Silently skip active host spreadsheet or duplicates (expected design behavior)
            return;
          }
          processedFileIds.add(file.id);
          queue.push({ isLocal: false, name: file.name, id: file.id });
        });
        queue = ceraSortPartitionQueue_(queue);
      } else {
        // Fallback: Drive cannot read the ID, so attempt opening it as a direct sheet
        try {
          const fallbackSs = SpreadsheetApp.openById(targetId);
          queue.push({ isLocal: false, name: fallbackSs.getName(), id: targetId });
        } catch (fallbackErr) {
          errors.push(`Drive Access Error: ${targetErr.message}`);
        }
      }
    }

    const excludedIds = new Set(Array.isArray(params.excludedSheetIds) ? params.excludedSheetIds.map(String) : []);
    if (excludedIds.size > 0 && !resumed) {
      queue = queue.filter(item => !excludedIds.has(String(item.id)));
    }

    const totalSheets = queue.length;
    if (totalSheets === 0) {
      throw new Error(ceraT('err.noSheets', null, lang));
    }

    const pipelineStartTime = Date.now();
    const MAX_ANALYSIS_RUNTIME_MS = Number(params.maxAnalysisRuntimeMs) > 0 ? Number(params.maxAnalysisRuntimeMs) : 280000;
    const BATCH_BUDGET_MS = Number(params.maxBatchRuntimeMs) > 0 ? Number(params.maxBatchRuntimeMs) : (CeraConfig.ANALYSIS_BATCH_BUDGET_MS || 180000);
    const RENDER_HANDOFF_MS = Number(params.maxRenderStartMs) > 0 ? Number(params.maxRenderStartMs) : (CeraConfig.ANALYSIS_RENDER_HANDOFF_MS || 140000);
    const MAX_ROWS_PER_BATCH_SLICE = Number(params.maxRowsPerSlice) > 0 ? Number(params.maxRowsPerSlice) : 0;
    const CHUNK_ROWS = Number(CeraConfig.SHEET_READ_CHUNK_ROWS) > 0 ? Number(CeraConfig.SHEET_READ_CHUNK_ROWS) : 25000;
    const resumedPhase = (resumed && resumed.phase) ? String(resumed.phase) : 'ingest';

    // Coverage of this run (see createInitialState for field definitions)
    const coverage = state.coverage;
    coverage.sheetsTotal = totalSheets;
    const dedupeStore = ceraDedupeStore_(state);
    dedupeStore.totalSheets = totalSheets;
    const startNextIndex = nextIndex;
    const startRowCursor = rowCursor;

    for (let q = nextIndex; q < totalSheets; q++) {
      // Multi-batch continuation: when invoked from the setup dialog (allowContinuation: true) and progress was made
      // in this batch, checkpoint before the Apps Script limit and hand off the remaining partitions to the next call.
      if (allowContinuation && (q > startNextIndex || rowCursor > startRowCursor) && (Date.now() - pipelineStartTime >= BATCH_BUDGET_MS)) {
        const token = batchToken || Utilities.getUuid();
        ceraSaveAnalysisBatch_(token, {
          generation: activeGeneration,
          hostSpreadsheetId: currentSsId,
          folderId: targetId,
          targetPresentationId: targetPresentationId,
          phase: 'ingest',
          queue: queue,
          nextIndex: q,
          rowCursor: rowCursor,
          sheetsProcessedCount: sheetsProcessedCount,
          unreadableSheets: unreadableSheets,
          errors: errors,
          state: state
        });
        updateProgress(ceraT('prog.reading', null, lang), queue[q].name, q, totalSheets, errors);
        return {
          success: true,
          partialBatch: true,
          jobId: token,
          batchToken: token,
          generation: activeGeneration,
          nextIndex: q,
          rowCursor: rowCursor,
          sheetsProcessed: sheetsProcessedCount,
          totalSheets: totalSheets,
          targetPresentationId: targetPresentationId,
          phase: 'ingest'
        };
      }

      // Timeout Watchdog (single-call callers without continuation): Stop if approaching 5 minutes
      if (!allowContinuation && Date.now() - pipelineStartTime > MAX_ANALYSIS_RUNTIME_MS) {
        console.warn(`[Analysis Watchdog] Approaching 5-minute execution budget. Finalizing aggregation on ${sheetsProcessedCount} partitions.`);
        updateProgress(ceraT('prog.finalizing', { done: sheetsProcessedCount, total: totalSheets }, lang), '', q, totalSheets, errors);
        coverage.truncated = true;
        break;
      }

      const item = queue[q];
      coverage.sheetsAttempted = q + 1;
      updateProgress(ceraT('prog.reading', null, lang), item.name, q + 1, totalSheets, errors);

      try {
        const gridInfo = ceraGetSourceSheetGridInfo_(item.id);
        const useChunkedRead = Boolean(gridInfo && gridInfo.lastCol && gridInfo.rowCount > CHUNK_ROWS);

        if (useChunkedRead) {
          const headerRows = ceraReadSheetRangeWithRetry_(item.id, gridInfo.escapedTitle + '!A1:' + gridInfo.lastCol + '1');
          const headerRow = headerRows && headerRows[0];
          if (!headerRow || !headerRow.length) {
            errors.push(`Skipped "${item.name}": Sheet is empty.`);
            rowCursor = 0;
            continue;
          }
          const col = resolveColumnIndices(headerRow);
          if (!ceraHasRequiredColumns_(col)) {
            errors.push(ceraUnrecognizedSheetMessage_(item.name, headerRow, lang));
            rowCursor = 0;
            continue;
          }
          const isCeraPartition = /_part_?\d+/i.test(item.name || '') ||
            /^Chrome[_\s]+(Egress[_\s]+Telemetry|SecurityLogs)/i.test(item.name || '') ||
            /\bpartition\b/i.test(item.name || '') ||
            (col.eventId !== undefined && col.eventId !== -1);

          const effectiveChunkSize = MAX_ROWS_PER_BATCH_SLICE > 0 ? Math.min(CHUNK_ROWS, MAX_ROWS_PER_BATCH_SLICE) : CHUNK_ROWS;
          const initialStartRow = rowCursor > 1 ? rowCursor : 2;
          let curStartRow = initialStartRow;
          let sheetHadData = curStartRow > 2;
          let enumFailed = false;

          while (curStartRow <= gridInfo.rowCount) {
            if (allowContinuation && curStartRow > initialStartRow && (Date.now() - pipelineStartTime >= BATCH_BUDGET_MS)) {
              rowCursor = curStartRow;
              const token = batchToken || Utilities.getUuid();
              ceraSaveAnalysisBatch_(token, {
                generation: activeGeneration,
                hostSpreadsheetId: currentSsId,
                folderId: targetId,
                targetPresentationId: targetPresentationId,
                phase: 'ingest',
                queue: queue,
                nextIndex: q,
                rowCursor: rowCursor,
                sheetsProcessedCount: sheetsProcessedCount,
                unreadableSheets: unreadableSheets,
                errors: errors,
                state: state
              });
              return {
                success: true,
                partialBatch: true,
                jobId: token,
                batchToken: token,
                generation: activeGeneration,
                nextIndex: q,
                rowCursor: rowCursor,
                sheetsProcessed: sheetsProcessedCount,
                totalSheets: totalSheets,
                targetPresentationId: targetPresentationId,
                phase: 'ingest'
              };
            }

            const sliceEndRow = Math.min(gridInfo.rowCount, curStartRow + effectiveChunkSize - 1);
            const sliceRange = gridInfo.escapedTitle + '!A' + curStartRow + ':' + gridInfo.lastCol + sliceEndRow;
            let chunkData = ceraReadSheetRangeWithRetry_(item.id, sliceRange);
            if (!chunkData || chunkData.length === 0) {
              break;
            }

            if (curStartRow === 2) {
              const covSample = [headerRow].concat(chunkData.slice(0, 2000));
              const covCheck = ceraCheckEnumCoverage_(covSample, col);
              if ((covCheck.eventTotal > 0 && covCheck.eventRatio < 0.99) || (covCheck.triggerTotal > 0 && covCheck.triggerRatio < 0.99)) {
                const minRatio = covCheck.eventTotal > 0 && covCheck.triggerTotal > 0
                  ? Math.min(covCheck.eventRatio, covCheck.triggerRatio)
                  : (covCheck.eventTotal > 0 ? covCheck.eventRatio : covCheck.triggerRatio);
                errors.push(ceraT('err.unrecognizedEnumValues', {
                  files: '"' + item.name + '"',
                  pct: (minRatio * 100).toFixed(1) + '%',
                  samples: covCheck.unrecognizedSamples.slice(0, 5).join(', ')
                }, lang));
                chunkData = null;
                rowCursor = 0;
                enumFailed = true;
                break;
              }

              if (col.date !== -1) {
                const tsSamples = [];
                const sampleStep = Math.max(1, Math.floor(chunkData.length / 200));
                for (let sIdx = 0; sIdx < chunkData.length; sIdx += sampleStep) {
                  if (chunkData[sIdx] && chunkData[sIdx][col.date]) tsSamples.push(chunkData[sIdx][col.date]);
                }
                if (sliceEndRow < gridInfo.rowCount) {
                  try {
                    const tailStart = Math.max(sliceEndRow + 1, gridInfo.rowCount - 50);
                    const tailRows = ceraReadSheetRangeWithRetry_(item.id, gridInfo.escapedTitle + '!A' + tailStart + ':' + gridInfo.lastCol + gridInfo.rowCount);
                    if (tailRows && tailRows.length) {
                      for (let tIdx = 0; tIdx < tailRows.length; tIdx++) {
                        if (tailRows[tIdx] && tailRows[tIdx][col.date]) tsSamples.push(tailRows[tIdx][col.date]);
                      }
                    }
                  } catch (tErr) {}
                }
                const detectedOrder = typeof ceraDetectDateOrder_ === 'function'
                  ? ceraDetectDateOrder_(tsSamples, params.dateOrder || 'MDY')
                  : 'MDY';
                if (!Object.prototype.hasOwnProperty.call(state, '_dateOrder')) {
                  Object.defineProperty(state, '_dateOrder', { value: detectedOrder, enumerable: false, writable: true });
                } else {
                  state._dateOrder = detectedOrder;
                }
                let fMin = Infinity;
                let fMax = -Infinity;
                for (let sIdx = 0; sIdx < tsSamples.length; sIdx++) {
                  const rawTs = tsSamples[sIdx];
                  if (!rawTs) continue;
                  const tMs = typeof parseTimestampToMs_ === 'function' ? parseTimestampToMs_(rawTs, detectedOrder) : new Date(rawTs).getTime();
                  if (!isNaN(tMs)) {
                    if (tMs < fMin) fMin = tMs;
                    if (tMs > fMax) fMax = tMs;
                  }
                }
                dedupeStore.fileRanges[q] = { minT: fMin, maxT: fMax, isPartition: isCeraPartition };
              } else {
                dedupeStore.fileRanges[q] = { minT: Infinity, maxT: -Infinity, isPartition: isCeraPartition };
              }
              ceraIndexFileRanges_(dedupeStore.fileRanges);
              ceraPruneDisjointRowHashes_(dedupeStore, q);
              dedupeStore._sheetOcc = new Map();
              dedupeStore._sheetOccFileIdx = q;
              if (typeof ceraNotifySheetStart_ === 'function') {
                ceraNotifySheetStart_(state, dedupeStore.fileRanges[q]);
              }
            }

            sheetHadData = true;
            const fileRangeQ = dedupeStore.fileRanges[q];
            for (let i = 0; i < chunkData.length; i++) {
              const row = chunkData[i];
              if (!_isBlankRow_(row) && ceraShouldDedupeRow_(row, col, q, isCeraPartition, dedupeStore)) {
                coverage.rowsDeduped = (coverage.rowsDeduped || 0) + 1;
                coverage.rowsDuplicatesDropped = (coverage.rowsDuplicatesDropped || 0) + 1;
                continue;
              }
              coverage.rowsRead++;
              processRowStream(row, col, corpDomains, authorizedGenAi, sanctionedProd, webMessaging, state);
              if (fileRangeQ && state._lastTsMs !== undefined && !isNaN(state._lastTsMs)) {
                if (state._lastTsMs < fileRangeQ.minT) fileRangeQ.minT = state._lastTsMs;
                if (state._lastTsMs > fileRangeQ.maxT) fileRangeQ.maxT = state._lastTsMs;
              }
            }
            const readLen = chunkData.length;
            chunkData = null;
            curStartRow = sliceEndRow + 1;
            if (readLen < (sliceEndRow - (curStartRow - effectiveChunkSize) + 1) && curStartRow > gridInfo.rowCount) {
              break;
            }
            if (MAX_ROWS_PER_BATCH_SLICE > 0 && curStartRow <= gridInfo.rowCount && allowContinuation) {
              rowCursor = curStartRow;
              const token = batchToken || Utilities.getUuid();
              ceraSaveAnalysisBatch_(token, {
                generation: activeGeneration,
                hostSpreadsheetId: currentSsId,
                folderId: targetId,
                targetPresentationId: targetPresentationId,
                phase: 'ingest',
                queue: queue,
                nextIndex: q,
                rowCursor: rowCursor,
                sheetsProcessedCount: sheetsProcessedCount,
                unreadableSheets: unreadableSheets,
                errors: errors,
                state: state
              });
              return {
                success: true,
                partialBatch: true,
                jobId: token,
                batchToken: token,
                generation: activeGeneration,
                nextIndex: q,
                rowCursor: rowCursor,
                sheetsProcessed: sheetsProcessedCount,
                totalSheets: totalSheets,
                targetPresentationId: targetPresentationId,
                phase: 'ingest'
              };
            }
          }

          if (enumFailed) continue;
          if (!sheetHadData) {
            errors.push(`Skipped "${item.name}": Sheet is empty.`);
            rowCursor = 0;
            continue;
          }
          ceraIndexFileRanges_(dedupeStore.fileRanges);
          rowCursor = 0;
          sheetsProcessedCount++;
        } else {
          let data = ceraReadSourceSheetWithRetry_(item, gridInfo);

          if (data && data.length > 1) {
            const col = resolveColumnIndices(data[0]);
            if (!ceraHasRequiredColumns_(col)) {
              errors.push(ceraUnrecognizedSheetMessage_(item.name, data[0], lang));
              data = null;
              rowCursor = 0;
              continue;
            }
            const covCheck = ceraCheckEnumCoverage_(data, col);
            if ((covCheck.eventTotal > 0 && covCheck.eventRatio < 0.99) || (covCheck.triggerTotal > 0 && covCheck.triggerRatio < 0.99)) {
              const minRatio = covCheck.eventTotal > 0 && covCheck.triggerTotal > 0
                ? Math.min(covCheck.eventRatio, covCheck.triggerRatio)
                : (covCheck.eventTotal > 0 ? covCheck.eventRatio : covCheck.triggerRatio);
              errors.push(ceraT('err.unrecognizedEnumValues', {
                files: '"' + item.name + '"',
                pct: (minRatio * 100).toFixed(1) + '%',
                samples: covCheck.unrecognizedSamples.slice(0, 5).join(', ')
              }, lang));
              data = null;
              rowCursor = 0;
              continue;
            }

            // Detect column-level slash-date order (DMY vs MDY) and file time span once per sheet
            const isCeraPartition = /_part_?\d+/i.test(item.name || '') ||
              /^Chrome[_\s]+(Egress[_\s]+Telemetry|SecurityLogs)/i.test(item.name || '') ||
              /\bpartition\b/i.test(item.name || '') ||
              (col.eventId !== undefined && col.eventId !== -1);
            if (col.date !== -1) {
              const tsSamples = [];
              const sampleStep = Math.max(1, Math.floor((data.length - 1) / 200));
              for (let sIdx = 1; sIdx < data.length; sIdx += sampleStep) {
                if (data[sIdx] && data[sIdx][col.date]) tsSamples.push(data[sIdx][col.date]);
              }
              const detectedOrder = typeof ceraDetectDateOrder_ === 'function'
                ? ceraDetectDateOrder_(tsSamples, params.dateOrder || 'MDY')
                : 'MDY';
              if (!Object.prototype.hasOwnProperty.call(state, '_dateOrder')) {
                Object.defineProperty(state, '_dateOrder', { value: detectedOrder, enumerable: false, writable: true });
              } else {
                state._dateOrder = detectedOrder;
              }
              let fMin = Infinity;
              let fMax = -Infinity;
              for (let sIdx = 1; sIdx < data.length; sIdx += sampleStep) {
                const rawTs = data[sIdx] && data[sIdx][col.date];
                if (!rawTs) continue;
                const tMs = typeof parseTimestampToMs_ === 'function' ? parseTimestampToMs_(rawTs, detectedOrder) : new Date(rawTs).getTime();
                if (!isNaN(tMs)) {
                  if (tMs < fMin) fMin = tMs;
                  if (tMs > fMax) fMax = tMs;
                }
              }
              dedupeStore.fileRanges[q] = { minT: fMin, maxT: fMax, isPartition: isCeraPartition };
            } else {
              dedupeStore.fileRanges[q] = { minT: Infinity, maxT: -Infinity, isPartition: isCeraPartition };
            }
            ceraIndexFileRanges_(dedupeStore.fileRanges);

            const startRow = rowCursor > 1 ? rowCursor : 1;
            if (startRow === 1) {
              ceraPruneDisjointRowHashes_(dedupeStore, q);
              dedupeStore._sheetOcc = new Map();
              dedupeStore._sheetOccFileIdx = q;
              if (typeof ceraNotifySheetStart_ === 'function') {
                ceraNotifySheetStart_(state, dedupeStore.fileRanges[q]);
              }
            }
            const endRow = MAX_ROWS_PER_BATCH_SLICE > 0 ? Math.min(data.length, startRow + MAX_ROWS_PER_BATCH_SLICE) : data.length;
            for (let i = startRow; i < endRow; i++) {
              const row = data[i];
              if (!_isBlankRow_(row) && ceraShouldDedupeRow_(row, col, q, isCeraPartition, dedupeStore)) {
                coverage.rowsDeduped = (coverage.rowsDeduped || 0) + 1;
                coverage.rowsDuplicatesDropped = (coverage.rowsDuplicatesDropped || 0) + 1;
                continue;
              }
              coverage.rowsRead++;
              processRowStream(row, col, corpDomains, authorizedGenAi, sanctionedProd, webMessaging, state);
            }

            if (endRow < data.length && allowContinuation) {
              rowCursor = endRow;
              data = null;
              const token = batchToken || Utilities.getUuid();
              ceraSaveAnalysisBatch_(token, {
                generation: activeGeneration,
                hostSpreadsheetId: currentSsId,
                folderId: targetId,
                targetPresentationId: targetPresentationId,
                phase: 'ingest',
                queue: queue,
                nextIndex: q,
                rowCursor: rowCursor,
                sheetsProcessedCount: sheetsProcessedCount,
                unreadableSheets: unreadableSheets,
                errors: errors,
                state: state
              });
              return {
                success: true,
                partialBatch: true,
                jobId: token,
                batchToken: token,
                generation: activeGeneration,
                nextIndex: q,
                rowCursor: rowCursor,
                sheetsProcessed: sheetsProcessedCount,
                totalSheets: totalSheets,
                targetPresentationId: targetPresentationId,
                phase: 'ingest'
              };
            }

            rowCursor = 0;
            sheetsProcessedCount++;
            // V8 Heap Memory Management: Free 2D array immediately
            data = null;
          } else {
            errors.push(`Skipped "${item.name}": Sheet is empty.`);
            rowCursor = 0;
            data = null;
          }
        }
      } catch (err) {
        rowCursor = 0;
        unreadableSheets.push({ id: item.id, name: item.name, error: err.message });
        errors.push(`Failed "${item.name}": ${err.message}`);
      }
    }

    // Fail closed if any partition sheet remained unreadable after retries (unless allowSkipUnreadable is set)
    if (unreadableSheets.length > 0 && !params.allowSkipUnreadable && sheetsProcessedCount > 0) {
      if (batchToken) ceraClearAnalysisBatch_(batchToken);
      const unreadErr = new Error(errors.join(' '));
      unreadErr.unreadableSheets = unreadableSheets;
      throw unreadErr;
    }

    // User actions still waiting for rows are complete once every partition was read
    ceraFlushActions_(state);
    ceraCompactStateForRender_(state);
    coverage.sheetsRead = sheetsProcessedCount;

    if (sheetsProcessedCount === 0) {
      if (batchToken) ceraClearAnalysisBatch_(batchToken);
      const detail = errors.length > 0 ? errors.join(' ') : ceraUnrecognizedSheetMessage_(queue[0] ? queue[0].name : 'Sheet1', [], lang);
      throw new Error(detail);
    }

    // If reading the final batch of partitions consumed significant runtime, checkpoint the completed state
    // so deck and workbook rendering run in a dedicated google.script.run call with a fresh 6-minute budget.
    if (allowContinuation && nextIndex < totalSheets && (params.generateSheets || params.generateSlides !== false) &&
        (Date.now() - pipelineStartTime >= RENDER_HANDOFF_MS)) {
      const token = batchToken || Utilities.getUuid();
      ceraSaveAnalysisBatch_(token, {
        generation: activeGeneration,
        hostSpreadsheetId: currentSsId,
        folderId: targetId,
        targetPresentationId: targetPresentationId,
        phase: 'render',
        queue: queue,
        nextIndex: totalSheets,
        rowCursor: 0,
        sheetsProcessedCount: sheetsProcessedCount,
        unreadableSheets: unreadableSheets,
        errors: errors,
        state: state,
        dedupeStore: null
      });
      updateProgress(ceraT('prog.finalizing', { done: sheetsProcessedCount, total: totalSheets }, lang), '', totalSheets, totalSheets, errors);
      return {
        success: true,
        partialBatch: true,
        jobId: token,
        batchToken: token,
        generation: activeGeneration,
        nextIndex: totalSheets,
        rowCursor: 0,
        sheetsProcessed: sheetsProcessedCount,
        totalSheets: totalSheets,
        targetPresentationId: targetPresentationId,
        phase: 'render'
      };
    }

    // Calculate Behavioral Outlier Analytics
    const outlierMetrics = computeOutlierAnalytics(state.outliers, state);
    state.coverageMeta = ceraBuildCoverageMeta_(state, params, outlierMetrics, unreadableSheets, targetId);

    let dateRangeString = ceraT('deck.cover.periodAll', null, lang);
    if (state.minDate && state.maxDate) {
      // The first and last day of the rows read, by the rule of every day key (ceraLocalDayKey)
      dateRangeString = `${formatDisplayDate(state.firstDayKey || state.minDate, true, lang)} – ${formatDisplayDate(state.lastDayKey || state.maxDate, true, lang)}`;
    }

    if (resumedPhase !== 'render_slides' && params.generateSheets) {
      updateProgress(ceraT('prog.dashboard', null, lang), '', totalSheets, totalSheets, errors);
      renderExecutiveOverview(currentSs, state, outlierMetrics);
      renderPolicyOutcomesSheet(currentSs, state);
      for (let key in state.vectors) {
        if (key === 'securityRadar') {
          renderSecurityRadarSheetWithCharts(currentSs, state.vectors[key], state);
        } else {
          renderVectorSheetWithCharts(currentSs, state.vectors[key], state);
        }
      }

      if (allowContinuation && params.generateSlides !== false &&
          (Date.now() - pipelineStartTime >= RENDER_HANDOFF_MS || (coverage.rowsRead || 0) >= 50000)) {
        try { SpreadsheetApp.flush(); } catch (fErr) {}
        const token = batchToken || Utilities.getUuid();
        ceraSaveAnalysisBatch_(token, {
          generation: activeGeneration,
          hostSpreadsheetId: currentSsId,
          folderId: targetId,
          targetPresentationId: targetPresentationId,
          phase: 'render_slides',
          queue: queue,
          nextIndex: totalSheets,
          rowCursor: 0,
          sheetsProcessedCount: sheetsProcessedCount,
          unreadableSheets: unreadableSheets,
          errors: errors,
          state: state,
          dedupeStore: null
        });
        updateProgress(ceraT('prog.deck', null, lang), '', totalSheets, totalSheets, errors);
        return {
          success: true,
          partialBatch: true,
          jobId: token,
          batchToken: token,
          generation: activeGeneration,
          nextIndex: totalSheets,
          rowCursor: 0,
          sheetsProcessed: sheetsProcessedCount,
          totalSheets: totalSheets,
          targetPresentationId: targetPresentationId,
          phase: 'render_slides'
        };
      }
    }

    let presentationUrl = null;
    if (params.generateSlides !== false) {
      updateProgress(ceraT('prog.deck', null, lang), '', totalSheets, totalSheets, errors);
      if (targetPresentationId && /^https?:\/\//.test(targetPresentationId)) {
        presentationUrl = targetPresentationId;
      } else {
        presentationUrl = ExecutivePresentationEngine.buildDeck(state, corpDomains, dateRangeString, outlierMetrics, currentSs);
        const idMatch = String(presentationUrl || '').match(/\/presentation\/d\/([^/]+)/);
        if (idMatch && idMatch[1]) targetPresentationId = idMatch[1];
      }
    }

    if (batchToken) ceraClearAnalysisBatch_(batchToken);
    updateProgress(ceraT('prog.complete', null, lang), '', totalSheets, totalSheets, errors);

    let outputKey = 'result.out.none';
    if (presentationUrl && params.generateSheets) {
      outputKey = 'result.out.both';
    } else if (presentationUrl) {
      outputKey = 'result.out.deck';
    } else if (params.generateSheets) {
      outputKey = 'result.out.sheets';
    }

    let summaryTxt = ceraT('result.summary', {
      sheets: sheetsProcessedCount,
      // The user actions read, the same figure as on the deck cover (log rows are assembled into actions first)
      events: (state.coverage && state.coverage.actions) || state.totalEvents,
      output: ceraT(outputKey, null, lang)
    }, lang);
    if (coverage.truncated) {
      summaryTxt += ' ' + ceraT('result.partial', { read: coverage.sheetsAttempted, total: coverage.sheetsTotal }, lang);
    }

    try {
      const docProps = PropertiesService.getDocumentProperties();
      const prevRepSheetId = docProps.getProperty('CERA_REPORT_USED_SHEET_ID') || '';
      const currSheetId = (currentSs && typeof currentSs.getId === 'function' && currentSs.getId()) ? String(currentSs.getId()) : '';
      docProps.setProperty('CERA_ANALYSIS_EXECUTED', 'true');
      docProps.deleteProperty(ceraAnalysisJobPropKey_());
      if (currSheetId) {
        docProps.setProperty('CERA_REPORT_USED_SHEET_ID', currSheetId);
      }
      if (presentationUrl) {
        docProps.setProperty('CERA_LAST_SLIDES_URL', String(presentationUrl));
      } else if (currSheetId && prevRepSheetId !== currSheetId) {
        docProps.deleteProperty('CERA_LAST_SLIDES_URL');
      }
      if (summaryTxt) {
        docProps.setProperty('CERA_LAST_REPORT_SUMMARY', String(summaryTxt));
      }
    } catch (cpErr) {}

    try {
      if (typeof ceraRecordDiagAnalysisSummary_ === 'function') {
        const diagFolderId = extractFolderId((params.driveFolderInput || '').trim());
        if (diagFolderId) {
          ceraRecordDiagAnalysisSummary_(diagFolderId, {
            sheetsTotal: coverage.sheetsTotal,
            sheetsRead: coverage.sheetsRead,
            rowsRead: coverage.rowsRead,
            rowsMerged: coverage.rowsMerged,
            rowsDropped: coverage.rowsDropped,
            rowsDuplicatesDropped: coverage.rowsDuplicatesDropped || 0,
            actions: coverage.actions,
            truncated: coverage.truncated,
            slidesGenerated: !!presentationUrl,
            sheetsGenerated: !!params.generateSheets,
            errorsCount: Array.isArray(errors) ? errors.length : 0
          });
        }
      }
    } catch (dErr) {}

    return {
      success: true,
      slidesUrl: presentationUrl,
      targetPresentationId: targetPresentationId,
      sheetsGenerated: !!params.generateSheets,
      summaryTxt: summaryTxt,
      workbookAlreadyUsed: { ingestion: true, report: true },
      reportTz: state.reportTz,
      coverageMeta: state.coverageMeta,
      coverage: {
        sheetsRead: coverage.sheetsRead,
        sheetsAttempted: coverage.sheetsAttempted,
        sheetsTotal: coverage.sheetsTotal,
        rowsRead: coverage.rowsRead,
        rowsDropped: coverage.rowsDropped,
        rowsDuplicatesDropped: coverage.rowsDuplicatesDropped || 0,
        actions: coverage.actions,
        rowsMerged: coverage.rowsMerged,
        truncated: coverage.truncated
      }
    };
  } finally {
    if (lock && typeof lock.releaseLock === 'function') {
      try { lock.releaseLock(); } catch (relErr) {}
    }
  }
}

/**
 * Whether a header row resolved the required Chrome log columns for CERA to analyze the sheet: Date/Timestamp, Event,
 * Trigger Type, and at least one endpoint column (URL, Tab URL, or Destination). Prevents non-Chrome sheets or
 * non-Latin localized Admin Console exports from silently producing an all-"not reported" deck.
 */
function ceraHasRequiredColumns_(col) {
  if (!col) return false;
  return col.date !== -1 &&
    col.event !== -1 &&
    col.triggerType !== -1 &&
    (col.url !== -1 || col.tabUrl !== -1 || col.destination !== -1);
}

/**
 * Checks whether a single Event cell value is recognized after canonicalization.
 */
function ceraIsRecognizedEventValue_(rawVal) {
  if (rawVal === null || rawVal === undefined || rawVal === '') return true;
  const s = String(rawVal).trim();
  if (!s) return true;
  if (ceraIsOutOfScopeChromeEvent_(s)) return true;
  if (typeof CERA_CONSOLE_LABELS !== 'undefined' && CERA_CONSOLE_LABELS.events) {
    const k = ceraNormConsoleKey_(s);
    if (CERA_CONSOLE_LABELS.events[k] !== undefined) return true;
  }
  const canon = typeof ceraCanonConsoleEvent_ === 'function' ? ceraCanonConsoleEvent_(s) : s;
  const ek = ceraEventKey_(canon);
  const lc = String(canon).toLowerCase();
  if (/^(content_transfer|sensitive_data_transfer|web_protect_extension_install|unsafe_site_visit|malware_transfer|password_reuse|password_breach|password_change|browser_crash|url_filtering|login_event|profile_signin|security_interstitial_shown|extension_telemetry|client_certificate)$/.test(ek)) return true;
  if (/\b(transfer|sensitive|rule triggered|password|reuse|breach|malware|virus|unsafe|phishing|deceptive|dangerous|social_engineering|unwanted|harmful|threat|suspicious|interstitial|extension|crash|filtering|login|signin|certificate|unscanned|print)\b/.test(lc.replace(/_/g, ' '))) {
    return true;
  }
  return false;
}

/**
 * Checks whether a single Trigger type cell value is recognized after canonicalization.
 */
function ceraIsRecognizedTriggerValue_(rawVal) {
  if (rawVal === null || rawVal === undefined || rawVal === '') return true;
  const s = String(rawVal).trim();
  if (!s) return true;
  if (typeof CERA_CONSOLE_LABELS !== 'undefined' && CERA_CONSOLE_LABELS.triggerTypes) {
    const k = ceraNormConsoleKey_(s);
    if (CERA_CONSOLE_LABELS.triggerTypes[k] !== undefined) return true;
  }
  const canon = typeof ceraCanonConsoleTrigger_ === 'function' ? ceraCanonConsoleTrigger_(s) : s;
  const lc = String(canon).toLowerCase().trim();
  if (!lc || lc === 'trigger_type_unspecified' || lc === 'unspecified' || lc === 'none' || lc === 'unknown') return true;
  if (/\b(upload|paste|clipboard|print|download|transfer|visit|visited|navigation|extension|password|login|realtimeurlcheck|destination|file|page|web)\b/.test(lc.replace(/_/g, ' '))) {
    return true;
  }
  return false;
}

/**
 * Verifies that at least 99% of non-empty Event and Trigger type cells in a sheet are recognized
 * after canonicalization. Prevents unsupported locales or corrupted exports from silently producing
 * zero-action or partial decks. Known out-of-scope ChromeOS/device rows are skipped (BP-11).
 */
function ceraCheckEnumCoverage_(data, col) {
  let eventTotal = 0;
  let eventRecognized = 0;
  let triggerTotal = 0;
  let triggerRecognized = 0;
  const unrecognizedSamples = [];
  if (!data || data.length <= 1 || !col) {
    return { eventTotal: 0, eventRecognized: 0, triggerTotal: 0, triggerRecognized: 0, eventRatio: 1, triggerRatio: 1, unrecognizedSamples: [] };
  }
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row) continue;
    const rawEv = (col.event !== -1 && row[col.event] !== null && row[col.event] !== undefined) ? String(row[col.event]).trim() : '';
    if (rawEv && ceraIsOutOfScopeChromeEvent_(rawEv)) continue;
    if (rawEv) {
      eventTotal++;
      if (ceraIsRecognizedEventValue_(rawEv)) {
        eventRecognized++;
      } else if (unrecognizedSamples.length < 5 && !unrecognizedSamples.includes(rawEv)) {
        unrecognizedSamples.push(rawEv);
      }
    }
    if (col.triggerType !== -1 && row[col.triggerType] !== null && row[col.triggerType] !== undefined) {
      const tr = String(row[col.triggerType]).trim();
      if (tr) {
        triggerTotal++;
        if (ceraIsRecognizedTriggerValue_(tr)) {
          triggerRecognized++;
        } else if (unrecognizedSamples.length < 5 && !unrecognizedSamples.includes(tr)) {
          unrecognizedSamples.push(tr);
        }
      }
    }
  }
  const eventRatio = eventTotal > 0 ? eventRecognized / eventTotal : 1;
  const triggerRatio = triggerTotal > 0 ? triggerRecognized / triggerTotal : 1;
  return {
    eventTotal: eventTotal,
    eventRecognized: eventRecognized,
    triggerTotal: triggerTotal,
    triggerRecognized: triggerRecognized,
    eventRatio: eventRatio,
    triggerRatio: triggerRatio,
    unrecognizedSamples: unrecognizedSamples
  };
}

/**
 * Actionable error message for a sheet whose header row did not resolve the required Chrome log columns. Detects
 * non-Latin script headers (Japanese, Korean, Chinese, Thai, etc.) and advises exporting with the Admin Console
 * language set to English or using Direct Cloud Ingestion.
 */
function ceraUnrecognizedSheetMessage_(sheetName, headerRow, lang, col) {
  const c = col || resolveColumnIndices(headerRow || []);
  const missing = [];
  if (!c || c.date === -1) missing.push('Date');
  if (!c || c.event === -1) missing.push('Event');
  if (!c || c.triggerType === -1) missing.push('Trigger type');
  if (!c || (c.url === -1 && c.tabUrl === -1 && c.destination === -1)) {
    missing.push('URL / Tab URL / Destination');
  }
  const sample = (headerRow || [])
    .map(h => String(h === null || h === undefined ? '' : h).trim())
    .filter(Boolean)
    .join(', ');
  const hasNonLatin = /[^\u0000-\u024F\u1E00-\u1EFF\u2000-\u206F]/.test(sample);
  const key = hasNonLatin ? 'err.unrecognizedColumns.nonLatin' : 'err.unrecognizedColumns';
  return ceraT(key, { files: '"' + (sheetName || 'Sheet1') + '"', columns: missing.join(', ') }, lang);
}

/**
 * Google Sheets files in a Drive folder, in My Drive or a shared drive, as { id, name }. Drive can return a page
 * shorter than pageSize before the end of the list, so pages are read until there is no next page token. A page is
 * tried 3 times, 1 s then 2 s apart; when it still fails, the error is thrown and no partial list is returned.
 */
function ceraFolderSheets_(folderId) {
  const files = [];
  let pageToken = null;
  do {
    let page = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        page = Drive.Files.list({
          q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
          fields: 'nextPageToken,files(id,name)',
          pageSize: 1000,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          pageToken: pageToken
        });
        break;
      } catch (e) {
        if (attempt === 3) throw e;
        console.warn(`Drive.Files.list retry attempt ${attempt}/3: ${e.message}`);
        Utilities.sleep(1000 * attempt);
      }
    }
    (page.files || []).forEach(f => files.push({ id: f.id, name: f.name }));
    pageToken = page.nextPageToken || null;
  } while (pageToken);
  try {
    if (typeof ceraGetPartitionRegistry_ === 'function' && folderId) {
      const reg = ceraGetPartitionRegistry_(folderId);
      if (reg && Array.isArray(reg.partitions) &&
          (reg.folderId === folderId || (!reg.folderId && files.some(f => /^chrome_security_logs_/i.test(f.name || ''))))) {
        const seenIds = new Set(files.map(f => String(f.id)));
        reg.partitions.forEach(p => {
          if (p && p.fileId && p.fileName && !seenIds.has(String(p.fileId))) {
            seenIds.add(String(p.fileId));
            files.push({ id: String(p.fileId), name: String(p.fileName) });
          }
        });
      }
    }
  } catch (regErr) {}
  return files;
}

/**
 * Reads grid dimensions and escaped title of a source spreadsheet's first visible sheet via Sheets API v4.
 */
function ceraGetSourceSheetGridInfo_(spreadsheetId) {
  try {
    if (typeof Sheets !== 'undefined' && Sheets.Spreadsheets && typeof Sheets.Spreadsheets.get === 'function') {
      const meta = Sheets.Spreadsheets.get(spreadsheetId, {
        fields: 'sheets(properties(title,hidden,gridProperties(rowCount,columnCount)))'
      });
      const sheet = ((meta && meta.sheets) || []).map(s => (s && s.properties) || {}).find(p => !p.hidden && p.gridProperties);
      if (sheet) {
        const columns = Number(sheet.gridProperties.columnCount) || 0;
        const rows = Number(sheet.gridProperties.rowCount) || 0;
        if (!columns) return null;
        let last = '';
        for (let n = columns; n > 0; n = Math.floor((n - 1) / 26)) {
          last = String.fromCharCode(65 + ((n - 1) % 26)) + last;
        }
        const escapedTitle = "'" + String(sheet.title).replace(/'/g, "''") + "'";
        return {
          title: String(sheet.title),
          escapedTitle: escapedTitle,
          rowCount: rows,
          columnCount: columns,
          lastCol: last,
          fullRange: escapedTitle + '!A1:' + last
        };
      }
    }
  } catch (e) {}
  return null;
}

/**
 * A1 range of every column of a source spreadsheet's first visible sheet: 'Sheet title'!A1:<last column of its grid>.
 * A fixed range does not fit every source: one ending at column O cuts off the last columns of a console export, and the
 * Sheets API rejects a range wider than the sheet's grid. Throws when the sheet cannot be read; the caller then reads
 * it with SpreadsheetApp.
 */
function ceraSourceSheetRange_(spreadsheetId) {
  const info = ceraGetSourceSheetGridInfo_(spreadsheetId);
  if (!info || !info.fullRange) throw new Error('No sheet to read');
  return info.fullRange;
}

/**
 * True when a row has no non-empty cell.
 */
function _isBlankRow_(row) {
  if (!row || !row.length) return true;
  for (let i = 0; i < row.length; i++) {
    if (row[i] !== null && row[i] !== undefined && String(row[i]).trim() !== '') return false;
  }
  return true;
}

/**
 * Organizational unit label of a row, normalised once at ingestion so every report shows the same names. The root
 * unit ("/") gets the root label; a blank unit, or a domain name in the unit column (some log sources put the
 * customer's domain there), becomes "OU not reported"; a leading "/" of a unit path is dropped. Labels follow the
 * report language and are cached per run.
 */
function ceraOuLabel_(raw, state, corpDomains) {
  const s = raw === null || raw === undefined ? '' : String(raw).trim();
  if (!state._ouLabels) Object.defineProperty(state, '_ouLabels', { value: {}, enumerable: false, writable: true });
  const cache = state._ouLabels;
  if (cache[s] !== undefined) return cache[s];
  const lang = state.reportLang || 'en';
  const path = s.replace(/^\/+/, '').trim();
  const isDomain = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(path) ||
    (corpDomains || []).some(cd => cd && path.toLowerCase() === String(cd).toLowerCase());
  let label = path;
  if (s && !path) label = ceraT('report.ou.root', null, lang);
  else if (!path || /^(null|undefined|-)$/i.test(path) || isDomain) label = ceraT('report.ou.notReported', null, lang);
  cache[s] = label;
  return label;
}

/**
 * Reads one log row into named fields (row normalization). direction: upload (FILE_UPLOAD, and WEB_CONTENT_UPLOAD,
 * which is a paste into a page), download (FILE_DOWNLOAD), print (PAGE_PRINT), paste (paste events of other log
 * sources), copy (CLIPBOARD_COPY: content copied from a page, not sent anywhere) or other (no transfer direction, e.g.
 * TRIGGER_TYPE_UNSPECIFIED with a generic event name). isPassword, isMalware and isUnsafe mark Security Radar signals;
 * isPasswordChange a password change, counted apart. sig is the row's signature within a user action: its event name
 * and whether it names detectors. A row with a valid time extends the observed date range.
 */
function ceraNormalizeRow_(row, col, corpDomains, state) {
  const text = idx => (idx !== undefined && idx !== -1 && row[idx] !== null && row[idx] !== undefined ? String(row[idx]) : '');
  const rawTriggerCell = text(col.triggerType);
  const triggerType = (typeof ceraCanonConsoleTrigger_ === 'function' ? ceraCanonConsoleTrigger_(rawTriggerCell) : rawTriggerCell).toLowerCase();
  const rawEventCell = text(col.event);
  const rawEvent = typeof ceraCanonConsoleEvent_ === 'function' ? ceraCanonConsoleEvent_(rawEventCell) : rawEventCell;
  const eventName = rawEvent.toLowerCase();
  const eventKey = ceraEventKey_(rawEvent);
  const ou = ceraOuLabel_(col.ou !== -1 ? row[col.ou] : '', state, corpDomains);
  const emptyOu = state._ouLabels && state._ouLabels[''] !== undefined ? state._ouLabels[''] : ceraOuLabel_('', state, corpDomains);
  let rawUrl = text(col.url).trim();
  const rawTabUrl = text(col.tabUrl).trim();
  const rawDest = text(col.destination).trim();

  let userIdent = text(col.profileUser).trim().toLowerCase();
  if (!userIdent) userIdent = text(col.userAlt).trim().toLowerCase();

  const rawCatCell = text(col.urlCategory).trim();
  const canonCat = (typeof ceraCanonConsoleCategory_ === 'function' ? ceraCanonConsoleCategory_(rawCatCell) : rawCatCell) || 'Uncategorized';

  const rec = {
    t: null,
    // Offset east of UTC (minutes) the time was written with, or null (ceraTimestampOffset_)
    tzOffsetMin: null,
    triggerType: triggerType,
    eventName: eventName,
    rawUrl: rawUrl,
    rawTabUrl: rawTabUrl,
    ou: ou,
    ouReported: ou !== emptyOu,
    sizeBytes: col.contentSize !== -1 ? Number(row[col.contentSize]) || 0 : 0,
    userIdent: userIdent,
    account: text(col.account).trim().toLowerCase(),
    rawCategory: canonCat.trim(),
    // Outcome from the Event Result column (normalizeEventResult, classes in CeraConfig.EVENT_RESULT_CLASSES). When the
    // log does not report one, the outcome stays '' (not reported) rather than being assumed.
    result: col.eventResult !== -1 ? normalizeEventResult(row[col.eventResult]) : '',
    reason: text(col.eventReason).trim(),
    detector: text(col.detectorName).trim(),
    contentType: text(col.contentType).trim(),
    // The file's base name only: a logged path can name the user (ceraContentFileName_)
    contentName: ceraContentFileName_(text(col.contentName))
  };
  rec.sig = eventName + '|' + (rec.detector ? 'detectors' : '');

  // Day keys and working hours follow the offset a time was written with (a console export at +08:00), otherwise the
  // report time zone (ceraLocalDayKey, ceraLocalIsAfterHours), so they match the times in the log
  if (col.date !== -1 && row[col.date]) {
    const rawDate = row[col.date];
    const dateOrder = (state && state._dateOrder) || 'MDY';
    let ms = NaN;
    let offsetMin = null;
    let day = '';
    if (typeof rawDate === 'string' && rawDate === state._lastTsStr && state._lastTsOrder === dateOrder) {
      ms = state._lastTsMs;
      offsetMin = state._lastTsOffset;
      day = state._lastTsDay;
    } else {
      const parsedTs = typeof ceraParseTimestamp_ === 'function'
        ? ceraParseTimestamp_(rawDate, dateOrder)
        : { ms: (rawDate instanceof Date ? rawDate : new Date(rawDate)).getTime(), offsetMin: ceraTimestampOffset_(rawDate) };
      ms = parsedTs.ms;
      if (!isNaN(ms)) {
        offsetMin = parsedTs.offsetMin;
        day = ceraLocalDayKey(ms, offsetMin);
        if (typeof rawDate === 'string') {
          if (!Object.prototype.hasOwnProperty.call(state, '_lastTsStr')) {
            Object.defineProperty(state, '_lastTsStr', { value: '', enumerable: false, writable: true });
            Object.defineProperty(state, '_lastTsOrder', { value: '', enumerable: false, writable: true });
            Object.defineProperty(state, '_lastTsMs', { value: NaN, enumerable: false, writable: true });
            Object.defineProperty(state, '_lastTsOffset', { value: null, enumerable: false, writable: true });
            Object.defineProperty(state, '_lastTsDay', { value: '', enumerable: false, writable: true });
          }
          state._lastTsStr = rawDate;
          state._lastTsOrder = dateOrder;
          state._lastTsMs = ms;
          state._lastTsOffset = offsetMin;
          state._lastTsDay = day;
        }
      }
    }
    if (!isNaN(ms)) {
      if (!state.minDate || ms < state.minDate.getTime()) state.minDate = new Date(ms);
      if (!state.maxDate || ms > state.maxDate.getTime()) state.maxDate = new Date(ms);
      rec.t = ms;
      rec.tzOffsetMin = offsetMin;
      if (!state.firstDayKey || day < state.firstDayKey) state.firstDayKey = day;
      if (!state.lastDayKey || day > state.lastDayKey) state.lastDayKey = day;
      if (!state._hourSlots) {
        Object.defineProperty(state, '_hourSlots', { value: Object.create(null), enumerable: false, writable: true });
      }
      state._hourSlots[Math.floor(ms / 3600000)] = 1;
    }
  }

  // Password reuse by its exact event name: "Password changed" (the user changed a password) is no reuse signal, whatever
  // its trigger type says
  rec.isPassword = eventKey === 'password reuse';
  rec.isPasswordChange = eventKey === 'password changed';
  // A browser launch with command-line switches ("Suspicious browser launch", SUSPICIOUS_BROWSER_LAUNCH)
  rec.isLaunch = eventKey === 'suspicious browser launch' || eventKey === 'browser launch' || eventKey === 'browser launch with command line flags';
  if (!rec.userIdent && !rec.isLaunch) {
    rec.userIdent = text(col.deviceUser).trim().toLowerCase();
    if (!rec.userIdent && col.resource !== undefined && col.resource !== -1) {
      const resMatch = text(col.resource).match(/[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (resMatch) rec.userIdent = resMatch[0].toLowerCase();
    }
  }
  rec.isMalware = triggerType.includes('malware') || eventName.includes('malware') || triggerType.includes('dangerous_download') || eventName.includes('dangerous download');
  rec.isUnsafe = triggerType.includes('unsafe') || eventName.includes('unsafe site visit') || eventName.includes('unsafe_site_visit');

  let direction = 'other';
  if (triggerType.includes('upload') || eventName.includes('upload')) direction = 'upload';
  else if (triggerType.includes('download') || eventName.includes('download')) direction = 'download';
  else if (triggerType.includes('print') || eventName.includes('print')) direction = 'print';
  else if (triggerType.includes('paste') || eventName.includes('paste')) direction = 'paste';
  else if (triggerType.includes('clipboard') || triggerType.includes('copy') || eventName.includes('clipboard') || eventName.includes('copy')) direction = 'copy';
  rec.direction = direction;

  if (!extractHost(rec.rawUrl)) {
    if (direction !== 'print' && direction !== 'copy' && extractHost(rawDest)) {
      rec.rawUrl = rawDest;
    } else if (extractHost(rawTabUrl)) {
      rec.rawUrl = rawTabUrl;
    }
  }
  // The outcome mode of the report follows the data-protection results actually seen (state.outcomes)
  if (ceraIsDataProtectionRow_(rec)) ceraNoteEventResult_(state, rec.result);
  return rec;
}

/**
 * True when a row's Event Result is a data-protection outcome, the only results the outcome mode is decided from
 * (state.outcomes): an upload, a paste or a print and its unscanned content, a clipboard copy, a download's verdict on
 * sensitive data, or sensitive data shown on a page (masked or unmasked). Safe Browsing, dangerous-file and password
 * reuse warnings are threat protection that every edition has, and so is a warning on a download Chrome could not scan:
 * none of them says that a data-protection policy enforces.
 */
function ceraIsDataProtectionRow_(rec) {
  if (rec.isPassword || rec.isPasswordChange || rec.isMalware || rec.isUnsafe) return false;
  if (rec.direction === 'upload' || rec.direction === 'paste' || rec.direction === 'print' || rec.direction === 'copy') return true;
  return ceraRowIsSensitive_(rec);
}

/**
 * An event name as a key: lower case, one space between words, without a trailing "event" ("Password reuse",
 * "PASSWORD_REUSE" and "passwordReuseEvent" all read "password reuse").
 */
var _ceraEventKeyCache_ = Object.create(null);
function ceraEventKey_(name) {
  if (!name) return '';
  if (typeof name === 'string') {
    const hit = _ceraEventKeyCache_[name];
    if (hit !== undefined) return hit;
  }
  const res = String(name || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[\s_-]+/g, ' ').trim().replace(/ event$/, '');
  if (typeof name === 'string' && name.length <= 80) _ceraEventKeyCache_[name] = res;
  return res;
}

/**
 * Per-row stream processor. The row is normalized (ceraNormalizeRow_); a transfer row then waits in the action
 * assembly (ActionAssembler.gs) for the other rows Chrome wrote for the same user action, and each finished action is
 * aggregated once by ceraAggregateAction_. Security Radar rows (password reuse, unsafe site visits, malware alerts)
 * wait for the other rows of their event (a warning and its bypass) and each event is aggregated once by
 * ceraAggregateRadarEvent_; page-level sensitive detections and password changes are recorded at once; browser launch
 * events wait to be folded into launches (ceraAddLaunchRow_). Once every row was read the caller finalizes the actions,
 * events and launches still waiting with ceraFlushActions_ (computeOutlierAnalytics does it as well).
 */
function processRowStream(row, col, corpDomains, authorizedGenAi, sanctionedProd, webMessaging, state) {
  if (!state.coverage) state.coverage = { sheetsRead: 0, sheetsAttempted: 0, sheetsTotal: 0, rowsRead: 0, rowsDropped: 0, actions: 0, rowsMerged: 0, truncated: false };
  if (!state.unscanned) state.unscanned = { bytes: 0, count: 0 };
  if (_isBlankRow_(row)) {
    state.coverage.rowsDropped++;
    return;
  }
  if (col && col.event !== undefined && col.event !== -1 && ceraIsOutOfScopeChromeEvent_(row[col.event])) {
    state.coverage.rowsOutOfScope = (state.coverage.rowsOutOfScope || 0) + 1;
    state.coverage.rowsDropped++;
    return;
  }
  if (!state._actionAssembly) {
    const scope = { corpDomains: corpDomains, authorizedGenAi: authorizedGenAi, sanctionedProd: sanctionedProd, webMessaging: webMessaging };
    ceraActionAssembly_(state, action => ceraAggregateAction_(action, scope, state), event => ceraAggregateRadarEvent_(event, state));
  }

  const rec = ceraNormalizeRow_(row, col, corpDomains, state);
  ceraActionClock_(state, rec.t);

  // A browser launch is no transfer: its events wait to be folded into launches once every row was read
  // (BrowserLaunches.gs)
  if (rec.isLaunch) {
    ceraAddLaunchRow_(state, ceraLaunchRow_(row, col, rec));
    return;
  }

  // A password change is neither password reuse nor a transfer: counted apart in state.passwordChanges
  if (rec.isPasswordChange) {
    const pc = state.passwordChanges || (state.passwordChanges = { count: 0, users: {} });
    pc.count++;
    if (rec.userIdent) pc.users[rec.userIdent] = (pc.users[rec.userIdent] || 0) + 1;
    return;
  }

  // Transfers, and malware verdicts on downloads, are counted per user action. Password reuse and unsafe site visits
  // keep their precedence over a transfer direction, a malware verdict keeps it over an unsafe site visit.
  if (!rec.isPassword && rec.direction !== 'other' && (rec.isMalware || !rec.isUnsafe)) {
    ceraAddActionRow_(state, rec);
    return;
  }

  const dest = ceraClassifyDestination_(rec.rawUrl, rec.rawTabUrl, rec.account, rec.userIdent, rec.rawCategory, corpDomains, state);
  const domain = dest.domain;
  const ou = rec.ou;
  const userIdent = rec.userIdent;
  const rawUrl = rec.rawUrl;
  const eventDateStr = rec.t !== null ? ceraLocalDayKey(rec.t, rec.tzOffsetMin) : '';
  const nameResult = rec.eventName.includes('detected') ? 'DETECTED' : '';

  // Security Radar signals (password reuse, malware alerts without a transfer direction, unsafe site visits): each row
  // waits for the other rows of its event, a warning and the bypass logged after it (ceraAddRadarRow_)
  if (rec.isPassword || rec.isMalware || rec.isUnsafe) {
    const fallback = rec.isPassword ? 'PASSWORD_REUSE' : (rec.isMalware ? 'MALWARE_TRANSFER' : 'UNSAFE_SITE_VISIT');
    ceraAddRadarRow_(state, rec.isPassword ? 'password' : (rec.isMalware ? 'malware' : 'unsafe'), {
      t: rec.t, user: userIdent, url: rawUrl, result: rec.result || nameResult, reason: rec.reason || fallback, reasonGiven: ceraReasonGiven_(rec.reason),
      ou: ou, domain: domain, internal: !!dest.isInternalCorpDomain, day: eventDateStr, fileName: rec.isMalware ? ceraMalwareFileName_(rec.contentName, rawUrl) : ''
    });
    return; // Security signal handled
  }

  // Sensitive data matched on a page with no file or upload (trigger unspecified, size 0): data shown or typed in the
  // browser rather than transferred. Each row is one detection in state.sensitiveOnPage instead of being dropped, with
  // its outcome (masked, or unmasked when the user revealed the data).
  if (rec.sizeBytes === 0 && ceraRowIsSensitive_(rec)) {
    recordSensitiveOnPage(state, dest.urlHost || dest.tabHost || domain, rec.detector, ou, userIdent, eventDateStr, corpDomains, ceraOutcomeClass_(rec.result));
    return;
  }

  // No transfer direction: counted in coverage.rowsDropped
  state.coverage.rowsDropped++;
}

/**
 * Destination of a row or an action: the reporting domain (CeraConfig.UNKNOWN_DESTINATION when the URL and tab URL
 * name no host), the normalized URL category, the URL and tab hosts, GenAI flags, and whether it is a corporate
 * destination. Uncategorized destinations are tallied by tab domain in state.unspecifiedTabDomains.
 */
function ceraClassifyDestination_(rawUrl, rawTabUrl, account, userIdent, rawCategory, corpDomains, state) {
  const urlHost = extractHost(rawUrl);
  const tabHost = extractHost(rawTabUrl);
  const isFile = (/^file:\/\//i.test(rawUrl) || /^file:\/\//i.test(rawTabUrl)) ? '1' : '0';
  const baseKey = urlHost + '|' + tabHost + '|' + (rawCategory || '') + '|' + isFile;
  if (state && !state._destCache) {
    Object.defineProperty(state, '_destCache', { value: Object.create(null), enumerable: false, writable: true });
  }
  let base = state && state._destCache ? state._destCache[baseKey] : undefined;
  if (!base) {
    let cat = typeof normalizeUrlCategory === 'function' ? normalizeUrlCategory(rawCategory) : rawCategory;
    let dom = cleanAndNormalizeDomain(rawUrl, account, corpDomains, rawTabUrl);

    // 1. Dynamic Category Normalization & Mismatch Grouping
    const catLower = (cat || '').toLowerCase().trim();
    const isUnspecifiedCat = !cat || catLower === 'unspecified' || catLower === 'uncategorized' || catLower === 'none' || catLower === '';

    // Requirement: any fbsbx.com CDN host is facebook.com in the Social Networks category
    const isCdnFbsbx = domainMatches(urlHost, 'fbsbx.com') || domainMatches(tabHost, 'fbsbx.com');
    if (isCdnFbsbx) {
      dom = 'facebook.com';
      cat = 'Social Networks';
    }

    const isFbOrMessenger = isCdnFbsbx || ['facebook.com', 'messenger.com'].some(d =>
      domainMatches(dom, d) || domainMatches(urlHost, d) || domainMatches(tabHost, d));
    if (isFbOrMessenger && (isUnspecifiedCat || cat === 'Proxying & Filtering' || cat === 'Online Goodies')) {
      cat = 'Social Networks';
    }

    // GenAI tools: exact host or registrable-domain suffix match against CeraConfig.DEFAULT_DOMAINS.GENAI_TOOLS.
    // cleanAndNormalizeDomain already canonicalized the domain (e.g. openai.com -> chatgpt.com, ai.studio -> aistudio.google.com).
    // Bare google.com / bing.com are never GenAI, even when the URL category says so.
    const isGenAiExcluded = isGenAiExcludedHost(dom);
    const isGenAiTool = !isGenAiExcluded && isGenAiHost(dom);
    if (isGenAiTool) {
      cat = 'Generative AI';
    } else if (isGenAiExcluded && (cat || '').toLowerCase().includes('generative ai')) {
      cat = 'Search Engines';
    }

    const isScriptGoogle = dom === 'script.google.com' || domainMatches(urlHost, 'script.google.com') || domainMatches(tabHost, 'script.google.com');
    const isGoogleHost = domainMatches(urlHost, 'google.com');
    const isHostCorp = corpDomains.length > 0 && corpDomains.some(cd =>
      cd && (domainMatches(dom, cd) || domainMatches(urlHost, cd) || domainMatches(tabHost, cd))
    );
    base = {
      domain: dom,
      category: cat,
      urlHost: urlHost,
      tabHost: tabHost,
      isUnspecifiedCat: isUnspecifiedCat,
      isGenAiExcluded: isGenAiExcluded,
      isGenAiTool: isGenAiTool,
      isScriptGoogle: isScriptGoogle,
      isGoogleHost: isGoogleHost,
      isHostCorp: isHostCorp
    };
    if (state && state._destCache) state._destCache[baseKey] = base;
  }

  const domain = base.domain;
  let category = base.category;

  // Corporate destination: exact-or-suffix host match, a Google-hosted corporate path (e.g. sites.google.com/a/<corp>/...),
  // or script.google.com used with a corporate user / url
  let isInternalCorpDomain = base.isHostCorp;
  if (!isInternalCorpDomain && corpDomains.length > 0) {
    if (base.isGoogleHost) {
      const rawUrlLower = rawUrl.toLowerCase();
      if (corpDomains.some(cd => cd && rawUrlLower.includes('/' + cd + '/'))) {
        isInternalCorpDomain = true;
      }
    }
    if (!isInternalCorpDomain && base.isScriptGoogle) {
      const isCorpUser = corpDomains.some(cd =>
        cd && (
          (account && (account.endsWith('@' + cd) || account.endsWith('.' + cd))) ||
          (userIdent && (userIdent.endsWith('@' + cd) || userIdent.endsWith('.' + cd))) ||
          rawUrl.includes('/' + cd + '/') || rawUrl.includes('=' + cd) || rawUrl.includes('@' + cd) ||
          rawTabUrl.includes('/' + cd + '/') || rawTabUrl.includes('=' + cd) || rawTabUrl.includes('@' + cd)
        )
      );
      if (isCorpUser) isInternalCorpDomain = true;
    }
  }

  if (isInternalCorpDomain && base.isUnspecifiedCat) {
    category = 'Internal Apps';
  }

  // Track Tab URL domain for Unspecified category
  const isStillUnspecified = !category || category.toLowerCase() === 'unspecified' || category.toLowerCase() === 'uncategorized' || category.toLowerCase() === 'none';
  if (isStillUnspecified) {
    category = 'Unspecified';
    const tabDom = tabHost || (!rawTabUrl && urlHost) || extractTabDomain(rawTabUrl, rawUrl);
    if (tabDom && !isBlankDestination(tabDom)) {
      if (!state.unspecifiedTabDomains) state.unspecifiedTabDomains = {};
      state.unspecifiedTabDomains[tabDom] = (state.unspecifiedTabDomains[tabDom] || 0) + 1;
    }
  }

  return {
    domain: domain,
    category: category,
    urlHost: urlHost,
    tabHost: tabHost,
    isGenAiExcluded: base.isGenAiExcluded,
    isGenAiTool: base.isGenAiTool,
    isInternalCorpDomain: isInternalCorpDomain
  };
}

/**
 * Aggregates one Security Radar event (ceraFlushRadarRows_): a Safe Browsing visit, a flagged download or a password
 * reuse, counted once however many rows Chrome wrote for it (a detection logged just before the warning, a warning and
 * its bypass are one event). The event keeps the unit, destination, day and URL of its first row, the reason of its
 * rows that says why it was logged, and the result of its strongest outcome (BYPASSED for a bypassed warning). A
 * download is named by the first file name of its rows (ceraMalwareFileName_); a download without one is counted but
 * lists no file.
 */
function ceraAggregateRadarEvent_(ev, state) {
  const first = ev.rows[0];
  const ou = first.ou;
  const userIdent = first.user;
  const domain = first.domain;
  const fileName = (ev.rows.find(r => r.fileName) || {}).fileName || '';
  const radar = state.securityRadar;
  const signal = { unsafe: 'unsafeSiteVisit', malware: 'malwareTransfer', password: 'passwordReuse' }[ev.signal];
  if (!radar[signal]) radar[signal] = { total: 0, ous: {}, users: {}, domains: {}, threats: {} };
  const s = radar[signal];
  s.total++;
  s.ous[ou] = (s.ous[ou] || 0) + 1;
  s.domains[domain] = (s.domains[domain] || 0) + 1;
  if (userIdent) s.users[userIdent] = true;
  if (ev.signal === 'password') {
    const side = first.internal ? 'internalDomains' : 'externalDomains';
    s[side][domain] = (s[side][domain] || 0) + 1;
  }
  if (ev.signal === 'malware' && fileName) s.files[fileName] = (s.files[fileName] || 0) + 1;
  recordSecurityRadarHit(state.vectors.securityRadar, signal, first.day, ou, userIdent, domain, ev.result, ev.reason, fileName, first.url);
}

/**
 * Aggregates one user action (ceraMergeActionRows_ in ActionAssembler.gs) into the vectors, the outbound totals,
 * prints, the GenAI benchmark and the outlier series: an action counts once however many rows Chrome wrote for it,
 * and is attributed to its own unit, day and hour. A dangerous download goes to Security Radar as an event (its
 * Malware transfer rows, ceraAggregateRadarEvent_) and is not counted again as a download; a clipboard copy is counted
 * in state.copies only; a print job in the print aggregates and the global action totals only, never in a vector.
 */
function ceraAggregateAction_(a, scope, state) {
  // A clipboard copy takes content from the page the user is on and sends it nowhere: counted apart in state.copies
  // under the page it came from, never as a transfer to that page
  if (a.direction === 'copy') {
    const source = extractHost(a.url) || extractHost(a.tabUrl) || cleanAndNormalizeDomain(a.url, a.account, scope.corpDomains, a.tabUrl);
    recordClipboardCopy(state, source, a.user, a.sensitive, a.outcome, a.size);
    return;
  }

  const corpDomains = scope.corpDomains;
  const authorizedGenAi = scope.authorizedGenAi;
  const sanctionedProd = scope.sanctionedProd;
  const webMessaging = scope.webMessaging;
  const dest = ceraClassifyDestination_(a.url, a.tabUrl, a.account, a.user, a.category, corpDomains, state);
  const domain = dest.domain;
  const category = dest.category;
  const urlHost = dest.urlHost;
  const isInternalCorpDomain = dest.isInternalCorpDomain;
  const rawUrl = a.url;
  const rawUrlLower = rawUrl.toLowerCase();
  const ou = a.ou;
  const userIdent = a.user;
  const sizeBytes = a.size;
  const action = a.direction;
  // A print job sends the page to a printer, not to the site the page is on: it is no transfer to a channel, an AI tool
  // or a destination, and is counted in printing only (section 8)
  const isPrint = action === 'print';
  const atMs = a.t;
  // Day and working hours in the offset the action's time was written with, when it had one (ceraLocalDayKey)
  const eventDateStr = a.t !== null ? ceraLocalDayKey(a.t, a.tzOffsetMin) : '';
  const isAfterHours = a.t !== null ? ceraLocalIsAfterHours(a.t, a.tzOffsetMin) : false;
  // One policy outcome for the action (ceraActionOutcome_): it decides whether the data left or was stopped
  const outcome = a.outcome || 'notReported';
  const left = !ceraOutcomeStopped_(outcome);

  // A dangerous download is a Security Radar event, not a download: its Malware transfer rows wait for the other rows of
  // their event (a warning and the bypasses logged after it, possibly in another action)
  if (a.malware) {
    a.malwareRows.forEach(r => {
      const nameResult = r.eventName.includes('detected') ? 'DETECTED' : '';
      ceraAddRadarRow_(state, 'malware', {
        t: r.t, user: r.userIdent, url: r.rawUrl, result: r.result || nameResult, reason: r.reason || 'MALWARE_TRANSFER', reasonGiven: ceraReasonGiven_(r.reason), ou: r.ou,
        domain: domain, internal: false, day: r.t !== null ? ceraLocalDayKey(r.t, r.tzOffsetMin) : '', fileName: ceraMalwareFileName_(r.contentName || a.contentName, r.rawUrl)
      });
    });
    return;
  }

  // 5. Sensitive Data Inspection: an action is sensitive when any of its rows is; detectors are the union of its rows
  const contentType = cleanMimeType(a.contentType || 'application/octet-stream', rawUrl);
  const isSensitive = a.sensitive;
  const rawDetector = a.detectors.join(', ').toUpperCase();
  let detectorCategory = 'OTHER';
  if (isSensitive) {
    if (rawDetector.includes('CREDIT_CARD_NUMBER')) detectorCategory = 'CREDIT_CARD_NUMBER';
    else if (rawDetector.includes('PHONE_NUMBER')) detectorCategory = 'PHONE_NUMBER';
    else if (rawDetector.includes('EMAIL_ADDRESS')) detectorCategory = 'EMAIL_ADDRESS';
    else detectorCategory = 'OTHER';
  }

  // 5. Personal Account Ingress Detection: an action made with a consumer mailbox (gmail.com, outlook.com, ...) or with
  // an account of another organization (neither corporate nor a listed partner) is a personal-account action
  const account = a.account;
  const accountDomain = account.includes('@') ? account.split('@').pop() : '';
  if (!state._accountClassCache) {
    Object.defineProperty(state, '_accountClassCache', { value: Object.create(null), enumerable: false, writable: true });
  }
  let accountClass = state._accountClassCache[accountDomain];
  if (accountClass === undefined) {
    accountClass = ceraAccountClass_(account, corpDomains, (state.scope && state.scope.partnerDomains) || []);
    state._accountClassCache[accountDomain] = accountClass;
  }
  const isPersonalAccount = accountClass === 'consumer' || accountClass === 'otherOrg';

  if (!state._domainScopeCache) {
    Object.defineProperty(state, '_domainScopeCache', { value: Object.create(null), enumerable: false, writable: true });
  }
  const domScopeKey = domain + '|' + urlHost;
  let domScope = state._domainScopeCache[domScopeKey];
  if (!domScope) {
    domScope = {
      isAuthorizedGenAi: authorizedGenAi.some(d => domainMatches(domain, d) || domainMatches(urlHost, d)),
      isMessagingDomain: webMessaging.some(d => domainMatches(domain, d) || domainMatches(urlHost, d)),
      isGoogleOrGmail: domainMatches(domain, 'google.com') || domainMatches(domain, 'gmail.com') || domainMatches(domain, 'googleusercontent.com'),
      isSanctionedDomain: sanctionedProd.some(d => d && (domainMatches(domain, d) || domainMatches(urlHost, d))),
      isInternalDestination: isInternalHost(domain) || (!!urlHost && isInternalHost(urlHost))
    };
    state._domainScopeCache[domScopeKey] = domScope;
  }

  // 6. GenAI Benchmarking: Sanctioned Internal AI vs Shadow AI, outbound transfers only (a download from an AI
  // tool is not an AI transfer). A personal account on a sanctioned tool is not sanctioned AI, and the tool is not
  // unsanctioned either: those transfers go to genAiBenchmark.personalSanctioned.
  const catLower = category.toLowerCase();
  const isGenAiCategory = !dest.isGenAiExcluded && (catLower.includes('generative ai') || dest.isGenAiTool);
  const isAuthorizedGenAi = domScope.isAuthorizedGenAi;

  if (isGenAiCategory && isEgressAction(action) && !isPrint) {
    const bench = state.genAiBenchmark;
    const bucket = !isAuthorizedGenAi ? bench.shadow : (isPersonalAccount ? bench.personalSanctioned : bench.sanctioned);
    bucket.bytes += sizeBytes;
    bucket.count++;
    if (left) {
      bucket.leftCount = (bucket.leftCount || 0) + 1;
      bucket.leftBytes = (bucket.leftBytes || 0) + sizeBytes;
    }
    if (userIdent) bucket.users[userIdent] = true;
    bucket.ous[ou] = (bucket.ous[ou] || 0) + sizeBytes;
  }

  // 7. Mutex Primary Vector Classification Hierarchy (exact-or-suffix domain matching throughout)
  const isGoogleOrGmail = domScope.isGoogleOrGmail;
  const isMessaging = !isGoogleOrGmail && (domScope.isMessagingDomain || catLower.includes('messaging'));

  let isSanctionedGoogle = false;
  if (isGoogleOrGmail) {
    if (!isPersonalAccount) {
      isSanctionedGoogle = true;
    } else if (corpDomains.length > 0) {
      isSanctionedGoogle =
        (account && corpDomains.some(cd => cd && (account.endsWith('@' + cd) || account.endsWith('.' + cd) || account === cd))) ||
        (!account && userIdent && corpDomains.some(cd => cd && (userIdent.endsWith('@' + cd) || userIdent.endsWith('.' + cd))));
    }
  }
  const isSanctioned = isSanctionedGoogle || isInternalCorpDomain || domScope.isSanctionedDomain;
  const isShadowAi = isGenAiCategory && !isAuthorizedGenAi;

  const isInternalDestination = domScope.isInternalDestination;
  // Neither the URL nor the tab URL named a host (blank, blob:null, chrome-extension:// ...)
  const isUnknownDestination = domain === (CeraConfig.UNKNOWN_DESTINATION || 'Unknown destination');
  let assignedVector = null;
  if (isPrint) {
    // A print job is in no channel
  } else if (isPersonalAccount) {
    assignedVector = state.vectors.personal;
  } else if (isShadowAi) {
    assignedVector = state.vectors.shadowAi;
  } else if (isMessaging) {
    assignedVector = state.vectors.messaging;
  } else if (!isSanctioned && !isAuthorizedGenAi) {
    // Explicit guard: Exclude google.com / gmail.com with corporate sign-in and internal apps from unmanaged
    if (!isSanctionedGoogle && !isInternalCorpDomain && !isInternalDestination && !isUnknownDestination) {
      assignedVector = state.vectors.unmanaged;
    }
  }

  // Private or local destinations stay inside the network: tracked apart from the risk vectors
  if (!assignedVector && isInternalDestination && !isPrint) {
    const it = state.internalTransfers;
    it.count++;
    it.bytes += sizeBytes;
    if (isEgressAction(action)) { it.egressCount++; it.egressBytes += sizeBytes; }
    it.hosts[domain] = (it.hosts[domain] || 0) + 1;
  }

  // No recorded destination: not an unmanaged app, but never dropped either. Counted apart and disclosed.
  if (!assignedVector && !isInternalDestination && isUnknownDestination && !isPrint) {
    if (!state.unknownDestinations) state.unknownDestinations = { count: 0, bytes: 0, egressCount: 0, egressBytes: 0 };
    const ud = state.unknownDestinations;
    ud.count++;
    ud.bytes += sizeBytes;
    if (isEgressAction(action)) { ud.egressCount++; ud.egressBytes += sizeBytes; }
  }

  // File uploads, pastes into a page and prints apart: Chrome logs a paste into a page as an upload
  // (WEB_CONTENT_UPLOAD), so the upload counts above hold both
  const outboundKind = ceraOutboundKind_(action, a.triggerType);

  if (assignedVector) {
    recordVectorHit(assignedVector, action, sizeBytes, contentType, domain, category, ou, userIdent, isSensitive, detectorCategory, eventDateStr, a.unscanned, atMs, outcome);
    if (outboundKind) {
      ceraRecordOutboundKind_(assignedVector.egress, outboundKind, sizeBytes, left, isSensitive);
      ceraRecordOutboundKind_(assignedVector.domains[domain], outboundKind, sizeBytes, left, isSensitive);
      ceraRecordOutboundKind_(assignedVector.ous[ou], outboundKind, sizeBytes, left, isSensitive);
    }
    // Outbound volume by file family: the extension of the Content Name first, the MIME type otherwise
    if (isEgressAction(action)) {
      if (!assignedVector.families) assignedVector.families = {};
      const family = ceraFileFamily_(a.contentName, a.contentType, outboundKind);
      const fam = assignedVector.families[family] || (assignedVector.families[family] = { bytes: 0, count: 0 });
      fam.bytes += sizeBytes;
      fam.count++;
      if (a.unscanned) {
        if (!assignedVector.egress.unscanned) assignedVector.egress.unscanned = { count: 0, bytes: 0 };
        assignedVector.egress.unscanned.count++;
        assignedVector.egress.unscanned.bytes += sizeBytes;
      }
    }
    // Detector names as the customer's rules report them (NIK, Date of Birth, custom rules), not only the
    // four coarse categories, so insights can name what was detected
    if (isSensitive && a.detectors.length) {
      if (!assignedVector.detectorNames) assignedVector.detectorNames = {};
      if (isEgressAction(action)) {
        if (!assignedVector.egress.detectorNames) assignedVector.egress.detectorNames = {};
        if (!state.egress.detectorNames) state.egress.detectorNames = {};
      }
      a.detectors.forEach(d => {
        assignedVector.detectorNames[d] = (assignedVector.detectorNames[d] || 0) + 1;
        if (isEgressAction(action)) {
          assignedVector.egress.detectorNames[d] = (assignedVector.egress.detectorNames[d] || 0) + 1;
          state.egress.detectorNames[d] = (state.egress.detectorNames[d] || 0) + 1;
        }
      });
    }
    // Outbound actions per account class (consumer, otherOrg), next to the vector's outbound count: a download made
    // from a personal account is in the vector, but it is not an upload to an outside account
    if (isPersonalAccount && assignedVector === state.vectors.personal && isEgressAction(action)) {
      if (!assignedVector.accountClasses) assignedVector.accountClasses = {};
      const ac = assignedVector.accountClasses[accountClass] || (assignedVector.accountClasses[accountClass] = { count: 0, bytes: 0, domains: {} });
      ac.count++;
      ac.bytes += sizeBytes;
      ac.domains[accountDomain] = (ac.domains[accountDomain] || 0) + 1;
      // The same per account type by kind: a print made while signed in to an outside account sends nothing to it
      if (!assignedVector.accountClassKinds) assignedVector.accountClassKinds = {};
      const ack = assignedVector.accountClassKinds[accountClass] || (assignedVector.accountClassKinds[accountClass] = {});
      ceraRecordOutboundKind_(ack, outboundKind, sizeBytes, left, isSensitive);
    }
  }

  // 8. Physical & Print Analysis: one print job per action, in the print aggregates and, on a line of its own, in the
  // global action totals; never in a channel (isPrint)
  const isAboutBlank = rawUrlLower.includes('about:blank') || domain.toLowerCase().includes('about:blank');
  if (action === 'print' && !isAboutBlank) {
    state.printStats.totalEvents++;
    state.printStats.totalBytes += sizeBytes;
    if (userIdent) state.printStats.users[userIdent] = true;
    state.printStats.originDomains[domain] = (state.printStats.originDomains[domain] || 0) + 1;
    state.printStats.ous[ou] = (state.printStats.ous[ou] || 0) + 1;
    state.printStats.types[contentType] = (state.printStats.types[contentType] || 0) + 1;
    ceraRecordOutcome_(state.printStats, outcome, sizeBytes, userIdent);
    if (state.globalActions && state.globalActions.print) {
      state.globalActions.print.count++;
      state.globalActions.print.bytes += sizeBytes;
    }

    if (isSensitive) {
      const ps = state.printStats.sensitivity;
      ps.sensitiveCount++;
      ps.detectors[detectorCategory] = (ps.detectors[detectorCategory] || 0) + 1;
      // Detector names as the rules report them, as for the vectors: the print slide names them like a vector slide
      if (a.detectors.length) {
        if (!ps.detectorNames) ps.detectorNames = {};
        a.detectors.forEach(d => { ps.detectorNames[d] = (ps.detectorNames[d] || 0) + 1; });
      }
      ceraRecordOutcome_(ps, outcome, sizeBytes, userIdent);
      if (left) {
        if (!ps.leftOrigins) ps.leftOrigins = {};
        ps.leftOrigins[domain] = (ps.leftOrigins[domain] || 0) + 1;
      }
    } else {
      state.printStats.sensitivity.nonSensitiveCount++;
    }
  }

  // 9. Cumulative Global Aggregations & Outlier Telemetry (Filtered strictly to the 4 Threat Vectors)
  if (assignedVector) {
    state.totalEvents++;
    state.totalBytes += sizeBytes;
    if (userIdent) state.globalUsers[userIdent] = true;
    if (a.unscanned) {
      state.unscanned.count++;
      state.unscanned.bytes += sizeBytes;
    }

    if (state.globalActions && state.globalActions[action]) {
      state.globalActions[action].count++;
      state.globalActions[action].bytes += sizeBytes;
    }

    updateSubMap(state.globalOUs, ou, action, sizeBytes);
    if (outboundKind) ceraRecordOutboundKind_(state.globalOUs[ou], outboundKind, sizeBytes, left, isSensitive);
    updateSubMap(state.globalTypes, contentType, action, sizeBytes);
    updateSimpleMap(state.globalDomains, domain, sizeBytes);
    if (category) {
      updateSimpleMap(state.globalCategories, category, sizeBytes);
    }

    // Outlier 1: Daily Volume Tracking (all directions, downloads included)
    if (eventDateStr) {
      if (!state.outliers.dailyVolume[eventDateStr]) {
        state.outliers.dailyVolume[eventDateStr] = { bytes: 0, count: 0 };
      }
      state.outliers.dailyVolume[eventDateStr].bytes += sizeBytes;
      state.outliers.dailyVolume[eventDateStr].count++;
    }

    // Egress (outbound-only: upload, paste) per OU, per user and per day (outliers.dailyEgress)
    recordEgressHit(state, action, sizeBytes, ou, userIdent, eventDateStr, atMs, outcome);
    if (outboundKind) ceraRecordOutboundKind_(state.egress, outboundKind, sizeBytes, left, isSensitive);
    if (isEgressAction(action)) {
      // Outbound transfers outside working hours and outbound transfers carrying sensitive data
      if (isAfterHours) { state.egress.afterHoursCount = (state.egress.afterHoursCount || 0) + 1; state.egress.afterHoursBytes = (state.egress.afterHoursBytes || 0) + sizeBytes; }
      if (isSensitive) {
        state.egress.sensitiveCount = (state.egress.sensitiveCount || 0) + 1;
        assignedVector.egress.sensitiveCount = (assignedVector.egress.sensitiveCount || 0) + 1;
        if (left) state.egress.sensitiveLeft = (state.egress.sensitiveLeft || 0) + 1;
      }
      if (a.unscanned) {
        if (!state.egress.unscanned) state.egress.unscanned = { count: 0, bytes: 0 };
        state.egress.unscanned.count++;
        state.egress.unscanned.bytes += sizeBytes;
      }
    }

    // Outliers 2 and 3 describe data leaving the organization (funnelling into one endpoint,
    // one person dominating a unit's outbound volume), so they count egress actions only.
    // Downloads such as software installers must never surface as a "data dump".
    const isEgress = isEgressAction(action);

    // Outlier 2: Actor to Domain Tracking (HHI & Scatter)
    if (userIdent && isEgress) {
      if (!state.outliers.actorEndpoints[userIdent]) {
        state.outliers.actorEndpoints[userIdent] = { totalBytes: 0, totalCount: 0, ou: ou, domains: {}, domainCounts: {}, days: {} };
      }
      const actor = state.outliers.actorEndpoints[userIdent];
      ceraKeepLatestOu_(actor, ou, atMs);
      actor.totalBytes += sizeBytes;
      actor.totalCount = (actor.totalCount || 0) + 1;
      actor.domains[domain] = (actor.domains[domain] || 0) + sizeBytes;
      if (!actor.domainCounts) actor.domainCounts = {};
      actor.domainCounts[domain] = (actor.domainCounts[domain] || 0) + 1;
      if (eventDateStr) {
        if (!actor.days) actor.days = {};
        if (!actor.days[eventDateStr]) actor.days[eventDateStr] = { bytes: 0, count: 0 };
        actor.days[eventDateStr].bytes += sizeBytes;
        actor.days[eventDateStr].count++;
      }
    }

    // Outlier 3: OU Intra-Peer Tracking & Daily OU Breakdown
    if (isEgress) {
      if (!state.outliers.ouActors[ou]) {
        state.outliers.ouActors[ou] = { totalBytes: 0, totalCount: 0, users: {}, domains: {} };
      }
      const ouEntry = state.outliers.ouActors[ou];
      ouEntry.totalBytes += sizeBytes;
      ouEntry.totalCount = (ouEntry.totalCount || 0) + 1;
      if (userIdent) {
        ouEntry.users[userIdent] = (ouEntry.users[userIdent] || 0) + sizeBytes;
      }
      if (!ouEntry.domains) ouEntry.domains = {};
      if (domain) {
        if (!ouEntry.domains[domain]) ouEntry.domains[domain] = { bytes: 0, count: 0 };
        ouEntry.domains[domain].bytes += sizeBytes;
        ouEntry.domains[domain].count++;
      }
      if (eventDateStr && state.outliers.dailyEgress && state.outliers.dailyEgress[eventDateStr]) {
        if (!state.outliers.dailyEgressOus) state.outliers.dailyEgressOus = {};
        if (!state.outliers.dailyEgressOus[eventDateStr]) state.outliers.dailyEgressOus[eventDateStr] = {};
        const dayOus = state.outliers.dailyEgressOus[eventDateStr];
        if (!dayOus[ou]) dayOus[ou] = { bytes: 0, count: 0, domains: {} };
        dayOus[ou].bytes += sizeBytes;
        dayOus[ou].count++;
        if (domain) {
          if (!dayOus[ou].domains[domain]) dayOus[ou].domains[domain] = { bytes: 0, count: 0 };
          dayOus[ou].domains[domain].bytes += sizeBytes;
          dayOus[ou].domains[domain].count++;
        }
      }
    }
  }
}

/**
 * 5. Behavioral Anomaly & Outlier Computation Engine
 */