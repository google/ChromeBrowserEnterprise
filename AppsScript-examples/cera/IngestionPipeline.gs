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

var CERA_BATCH_CACHE_CHUNK = 80000;
var CERA_BATCH_CACHE_TTL_SEC = 21600;
var CERA_BATCH_MAX_PENDING_ROWS = 2000;

function ceraAnalysisBatchCache_() {
  try {
    if (typeof CacheService !== 'undefined' && CacheService) {
      return CacheService.getUserCache() || CacheService.getScriptCache();
    }
  } catch (e) {}
  return null;
}

function ceraSaveAnalysisBatch_(token, checkpoint) {
  const cache = ceraAnalysisBatchCache_();
  if (!cache) throw new Error('CacheService unavailable for batch continuation');
  const state = checkpoint.state;
  if (state && state._actionAssembly && typeof ceraSweepActions_ === 'function') {
    ceraSweepActions_(state, false, CERA_BATCH_MAX_PENDING_ROWS);
  }
  const asm = state && state._actionAssembly;
  const launchStore = state && state._launchRows;
  const payload = JSON.stringify({
    queue: checkpoint.queue,
    nextIndex: checkpoint.nextIndex,
    sheetsProcessedCount: checkpoint.sheetsProcessedCount,
    errors: checkpoint.errors || [],
    state: state,
    asm: asm ? {
      keys: Array.from(asm.keys.entries()),
      pendingRows: asm.pendingRows,
      peakPending: asm.peakPending,
      at: asm.at,
      sinceSweep: asm.sinceSweep,
      sweepEvery: asm.sweepEvery,
      radar: Array.from(asm.radar.entries())
    } : null,
    launches: launchStore && launchStore.events ? {
      keys: Array.from(launchStore.keys.entries()),
      names: launchStore.names,
      events: launchStore.events
    } : null
  });
  const chunks = Math.ceil(payload.length / CERA_BATCH_CACHE_CHUNK) || 1;
  const prefix = 'CERA_ANALYSIS_BATCH_' + token + '_';
  for (let i = 0; i < chunks; i++) {
    cache.put(prefix + i, payload.slice(i * CERA_BATCH_CACHE_CHUNK, (i + 1) * CERA_BATCH_CACHE_CHUNK), CERA_BATCH_CACHE_TTL_SEC);
  }
  cache.put(prefix + 'meta', JSON.stringify({ chunks: chunks, savedAt: Date.now() }), CERA_BATCH_CACHE_TTL_SEC);
}

function ceraLoadAnalysisBatch_(token, scope) {
  const cache = ceraAnalysisBatchCache_();
  if (!cache || !token) return null;
  const prefix = 'CERA_ANALYSIS_BATCH_' + token + '_';
  const metaRaw = cache.get(prefix + 'meta');
  if (!metaRaw) return null;
  const meta = JSON.parse(metaRaw);
  const parts = [];
  for (let i = 0; i < (meta.chunks || 0); i++) {
    const part = cache.get(prefix + i);
    if (part === null || part === undefined) return null;
    parts.push(part);
  }
  const saved = JSON.parse(parts.join(''));
  const state = saved.state;
  if (state) {
    if (state.minDate) state.minDate = new Date(state.minDate);
    if (state.maxDate) state.maxDate = new Date(state.maxDate);
    if (saved.asm) {
      const asm = ceraActionAssembly_(state, action => ceraAggregateAction_(action, scope, state), event => ceraAggregateRadarEvent_(event, state));
      asm.keys = new Map(saved.asm.keys || []);
      asm.pendingRows = saved.asm.pendingRows || 0;
      asm.peakPending = saved.asm.peakPending || 0;
      asm.at = saved.asm.at;
      asm.sinceSweep = saved.asm.sinceSweep || 0;
      asm.sweepEvery = saved.asm.sweepEvery || 1000;
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
    if (!cache || !token) return;
    const prefix = 'CERA_ANALYSIS_BATCH_' + token + '_';
    const metaRaw = cache.get(prefix + 'meta');
    if (metaRaw) {
      const meta = JSON.parse(metaRaw);
      for (let i = 0; i < (meta.chunks || 0); i++) cache.remove(prefix + i);
    }
    cache.remove(prefix + 'meta');
  } catch (e) {}
}

function executeDlpAnalysis(params) {
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
  const batchToken = params.batchToken ? String(params.batchToken) : '';
  const resumed = batchToken ? ceraLoadAnalysisBatch_(batchToken, scope) : null;

  let state;
  let errors;
  let sheetsProcessedCount;
  let queue;
  let nextIndex = 0;

  if (resumed) {
    state = resumed.state;
    state.scope = { partnerDomains: parseDomains(params.partnerDomains || ''), authorizedGenAi: authorizedGenAi };
    state.reportLang = lang;
    errors = resumed.errors || [];
    sheetsProcessedCount = resumed.sheetsProcessedCount || 0;
    queue = resumed.queue || [];
    nextIndex = resumed.nextIndex || 0;
  } else {
    state = createInitialState();
    // Customer scope that is not a classification list of its own: partner tenants are external organizations
    // the customer works with, so their accounts are not counted as personal accounts.
    state.scope = { partnerDomains: parseDomains(params.partnerDomains || ''), authorizedGenAi: authorizedGenAi };
    // Language of the generated deck and report: the language the user chose in the dialog
    state.reportLang = lang;

    errors = [];
    const processedFileIds = new Set();
    // Strictly exclude active spreadsheet itself from being read as raw telemetry
    processedFileIds.add(currentSsId);
    sheetsProcessedCount = 0;
    queue = [];

    const targetInput = (params.driveFolderInput || '').trim();
    const targetId = extractFolderId(targetInput);
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

  const totalSheets = queue.length;
  if (totalSheets === 0) {
    throw new Error(ceraT('err.noSheets', null, lang));
  }

  const pipelineStartTime = Date.now();
  const MAX_ANALYSIS_RUNTIME_MS = Number(params.maxAnalysisRuntimeMs) > 0 ? Number(params.maxAnalysisRuntimeMs) : 280000;
  const BATCH_BUDGET_MS = Number(params.maxBatchRuntimeMs) > 0 ? Number(params.maxBatchRuntimeMs) : (CeraConfig.ANALYSIS_BATCH_BUDGET_MS || 180000);
  const RENDER_HANDOFF_MS = Number(params.maxRenderStartMs) > 0 ? Number(params.maxRenderStartMs) : (CeraConfig.ANALYSIS_RENDER_HANDOFF_MS || 140000);

  // Coverage of this run (see createInitialState for field definitions)
  const coverage = state.coverage;
  coverage.sheetsTotal = totalSheets;

  for (let q = nextIndex; q < totalSheets; q++) {
    // Multi-batch continuation: when invoked from the setup dialog (allowContinuation: true) and at least one
    // partition was read in this batch, checkpoint to CacheService before the Apps Script limit and hand off the
    // remaining partitions to the next google.script.run call so every partition is read without truncation.
    if (allowContinuation && q > nextIndex && (Date.now() - pipelineStartTime >= BATCH_BUDGET_MS)) {
      const token = batchToken || Utilities.getUuid();
      ceraSaveAnalysisBatch_(token, {
        queue: queue,
        nextIndex: q,
        sheetsProcessedCount: sheetsProcessedCount,
        errors: errors,
        state: state
      });
      updateProgress(ceraT('prog.reading', null, lang), queue[q].name, q, totalSheets, errors);
      return {
        success: true,
        partialBatch: true,
        batchToken: token,
        nextIndex: q,
        sheetsProcessed: sheetsProcessedCount,
        totalSheets: totalSheets,
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
      let data = null;

      // ⚡ FAST-PATH: Direct REST call via Sheets API v4 (10x-15x faster than SpreadsheetApp.openById)
      try {
        if (typeof Sheets !== 'undefined' && Sheets.Spreadsheets && Sheets.Spreadsheets.Values) {
          // Every column, to the width of the sheet (ceraSourceSheetRange_): console exports have 21 columns, with Tab URL,
          // URL category and Content Name after column O; partitions written by direct ingestion have 18 (15 before Device
          // Name, Client Type and Command Line Switches were added)
          let resp = Sheets.Spreadsheets.Values.get(item.id, ceraSourceSheetRange_(item.id));
          if (resp && resp.values && resp.values.length > 1) {
            data = resp.values;
          }
          resp = null;
        }
      } catch (fastErr) {
        // Silent fallback to SpreadsheetApp
      }

      // Fallback: Native SpreadsheetApp
      if (!data) {
        const extSs = SpreadsheetApp.openById(item.id);
        const targetSheet = extSs.getSheetByName('Raw Data') || extSs.getSheets()[0];
        if (targetSheet && targetSheet.getLastRow() > 1) {
          data = targetSheet.getDataRange().getValues();
        }
      }

      if (data && data.length > 1) {
        const col = resolveColumnIndices(data[0]);
        if (!ceraHasRequiredColumns_(col)) {
          errors.push(ceraUnrecognizedSheetMessage_(item.name, data[0], lang));
          data = null;
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
          continue;
        }
        coverage.rowsRead += data.length - 1;

        for (let i = 1; i < data.length; i++) {
          processRowStream(data[i], col, corpDomains, authorizedGenAi, sanctionedProd, webMessaging, state);
        }
        sheetsProcessedCount++;
        // V8 Heap Memory Management: Free 2D array immediately
        data = null;
      } else {
        errors.push(`Skipped "${item.name}": Sheet is empty.`);
        data = null;
      }
    } catch (err) {
      errors.push(`Failed "${item.name}": ${err.message}`);
    }
  }
  // User actions still waiting for rows are complete once every partition was read
  ceraFlushActions_(state);
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
      queue: queue,
      nextIndex: totalSheets,
      sheetsProcessedCount: sheetsProcessedCount,
      errors: errors,
      state: state
    });
    updateProgress(ceraT('prog.finalizing', { done: sheetsProcessedCount, total: totalSheets }, lang), '', totalSheets, totalSheets, errors);
    return {
      success: true,
      partialBatch: true,
      batchToken: token,
      nextIndex: totalSheets,
      sheetsProcessed: sheetsProcessedCount,
      totalSheets: totalSheets,
      phase: 'render'
    };
  }

  let dateRangeString = ceraT('deck.cover.periodAll', null, lang);
  if (state.minDate && state.maxDate) {
    // The first and last day of the rows read, by the rule of every day key (ceraLocalDayKey)
    dateRangeString = `${formatDisplayDate(state.firstDayKey || state.minDate, true, lang)} – ${formatDisplayDate(state.lastDayKey || state.maxDate, true, lang)}`;
  }

  // Calculate Behavioral Outlier Analytics
  const outlierMetrics = computeOutlierAnalytics(state.outliers, state);

  if (params.generateSheets) {
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
  }

  let presentationUrl = null;
  if (params.generateSlides !== false) {
    updateProgress(ceraT('prog.deck', null, lang), '', totalSheets, totalSheets, errors);
    presentationUrl = ExecutivePresentationEngine.buildDeck(state, corpDomains, dateRangeString, outlierMetrics, currentSs);
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
    PropertiesService.getDocumentProperties().setProperty('CERA_ANALYSIS_EXECUTED', 'true');
  } catch (cpErr) {}

  return {
    success: true,
    slidesUrl: presentationUrl,
    sheetsGenerated: !!params.generateSheets,
    summaryTxt: summaryTxt,
    coverage: {
      sheetsRead: coverage.sheetsRead,
      sheetsAttempted: coverage.sheetsAttempted,
      sheetsTotal: coverage.sheetsTotal,
      rowsRead: coverage.rowsRead,
      rowsDropped: coverage.rowsDropped,
      actions: coverage.actions,
      rowsMerged: coverage.rowsMerged,
      truncated: coverage.truncated
    }
  };
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
 * zero-action or partial decks.
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
    if (col.event !== -1 && row[col.event] !== null && row[col.event] !== undefined) {
      const ev = String(row[col.event]).trim();
      if (ev) {
        eventTotal++;
        if (ceraIsRecognizedEventValue_(ev)) {
          eventRecognized++;
        } else if (unrecognizedSamples.length < 5 && !unrecognizedSamples.includes(ev)) {
          unrecognizedSamples.push(ev);
        }
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
  return files;
}

/**
 * A1 range of every column of a source spreadsheet's first visible sheet: 'Sheet title'!A1:<last column of its grid>.
 * A fixed range does not fit every source: one ending at column O cuts off the last columns of a console export, and the
 * Sheets API rejects a range wider than the sheet's grid. Throws when the sheet cannot be read; the caller then reads
 * it with SpreadsheetApp.
 */
function ceraSourceSheetRange_(spreadsheetId) {
  const meta = Sheets.Spreadsheets.get(spreadsheetId, { fields: 'sheets(properties(title,hidden,gridProperties(columnCount)))' });
  const sheet = ((meta && meta.sheets) || []).map(s => (s && s.properties) || {}).find(p => !p.hidden && p.gridProperties);
  const columns = sheet ? Number(sheet.gridProperties.columnCount) || 0 : 0;
  if (!columns) throw new Error('No sheet to read');
  let last = '';
  for (let n = columns; n > 0; n = Math.floor((n - 1) / 26)) last = String.fromCharCode(65 + ((n - 1) % 26)) + last;
  return "'" + String(sheet.title).replace(/'/g, "''") + "'!A1:" + last;
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
    let ms = NaN;
    let offsetMin = null;
    let day = '';
    if (typeof rawDate === 'string' && rawDate === state._lastTsStr) {
      ms = state._lastTsMs;
      offsetMin = state._lastTsOffset;
      day = state._lastTsDay;
    } else {
      const dt = rawDate instanceof Date ? rawDate : new Date(rawDate);
      ms = dt.getTime();
      if (!isNaN(ms)) {
        offsetMin = ceraTimestampOffset_(rawDate);
        day = ceraLocalDayKey(ms, offsetMin);
        if (typeof rawDate === 'string') {
          if (!Object.prototype.hasOwnProperty.call(state, '_lastTsStr')) {
            Object.defineProperty(state, '_lastTsStr', { value: '', enumerable: false, writable: true });
            Object.defineProperty(state, '_lastTsMs', { value: NaN, enumerable: false, writable: true });
            Object.defineProperty(state, '_lastTsOffset', { value: null, enumerable: false, writable: true });
            Object.defineProperty(state, '_lastTsDay', { value: '', enumerable: false, writable: true });
          }
          state._lastTsStr = rawDate;
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
      const family = ceraFileFamily_(a.contentName, a.contentType);
      const fam = assignedVector.families[family] || (assignedVector.families[family] = { bytes: 0, count: 0 });
      fam.bytes += sizeBytes;
      fam.count++;
    }
    // Detector names as the customer's rules report them (NIK, Date of Birth, custom rules), not only the
    // four coarse categories, so insights can name what was detected
    if (isSensitive && a.detectors.length) {
      if (!assignedVector.detectorNames) assignedVector.detectorNames = {};
      a.detectors.forEach(d => {
        assignedVector.detectorNames[d] = (assignedVector.detectorNames[d] || 0) + 1;
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