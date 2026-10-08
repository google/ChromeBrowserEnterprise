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
 * Module: AdminSdkIngestion.gs
 * Description: Autonomous Google Apps Script Background Worker Engine
 *              - True Apps Script Background Execution (Runs unattended in Google Apps Script)
 *              - Trigger Lifecycle with Zero-Ghost Self-Destruction
 *              - Concurrency Lock Protection (LockService)
 *              - Strict Chronological Traversal (Oldest -> Newest: first day of the range to Day 0)
 *              - 4-Minute Execution Budget Watchdog (Anti-Timeout)
 *              - Zero-Memory Partition Streaming (50k Rows per Drive Sheet)
 *              - Realtime Updates to "⚡ Ingestion Monitor" Sheet
 * ==============================================================================
 */

const MAX_ROWS_PER_SHEET = (typeof globalThis !== 'undefined' && globalThis.OVERRIDE_MAX_ROWS_PER_SHEET) ? globalThis.OVERRIDE_MAX_ROWS_PER_SHEET : 50000;
// Rows per append. Flushes happen between pages, so an append carries 2,000 to 2,999 rows.
const BATCH_FLUSH_SIZE = (typeof globalThis !== 'undefined' && globalThis.OVERRIDE_BATCH_FLUSH_SIZE) ? globalThis.OVERRIDE_BATCH_FLUSH_SIZE : 2000;
const TIME_BUDGET_MS = (typeof globalThis !== 'undefined' && globalThis.OVERRIDE_TIME_BUDGET_MS) ? globalThis.OVERRIDE_TIME_BUDGET_MS : 42000; // 42 seconds (anti-starvation: guarantees 18s clean buffer before next 1-minute trigger tick)
const TRIGGER_HANDLER_NAME = 'processCloudIngestionBatch';
// Days a direct ingestion reads. Locked to at most 7 days for stability and reliability.
const CERA_DEFAULT_RANGE_DAYS = 7;
const CERA_MAX_RANGE_DAYS = (typeof globalThis !== 'undefined' && globalThis.OVERRIDE_MAX_RANGE_DAYS) ? globalThis.OVERRIDE_MAX_RANGE_DAYS : 7;

/**
 * Chrome events CERA reads, one stream each: the six security events, and browser launches with command-line switches
 * (SUSPICIOUS_BROWSER_LAUNCH, a small stream, logged for Chrome's own startup switches too)
 */
const TARGET_EVENTS = [
  'SENSITIVE_DATA_TRANSFER',
  'CONTENT_TRANSFER',
  'PASSWORD_REUSE',
  'CONTENT_UNSCANNED',
  'MALWARE_TRANSFER',
  'UNSAFE_SITE_VISIT',
  'SUSPICIOUS_BROWSER_LAUNCH'
];

/**
 * Event names written to the Event column of a partition: the names the Admin console gives the events, so the
 * reader recognizes a partition row and a console export row alike
 */
const EVENT_DISPLAY_NAMES = {
  'SENSITIVE_DATA_TRANSFER': 'Sensitive data transfer',
  'CONTENT_TRANSFER': 'Content transfer',
  'PASSWORD_REUSE': 'Password reuse',
  'CONTENT_UNSCANNED': 'Content unscanned',
  'MALWARE_TRANSFER': 'Malware transfer',
  'UNSAFE_SITE_VISIT': 'Unsafe site visit',
  'SUSPICIOUS_BROWSER_LAUNCH': 'Suspicious browser launch'
};

/**
 * Columns of a partition. Device Name, Client Type and Command Line Switches come after the first 15 so that the
 * partitions written before them keep their layout: the reader maps every column by its header (resolveColumnIndices),
 * so a folder can hold partitions of both widths. Command Line Switches holds one switch per line.
 */
const PARTITION_HEADERS = [
  'Timestamp', 'Event', 'Event Reason', 'Detector Name', 'Organizational Unit',
  'User Profile', 'Content Size', 'Content Type', 'Trigger Type',
  'Web App Account', 'URL', 'Tab URL', 'URL Category', 'Event Result', 'Content Name',
  'Device Name', 'Client Type', 'Command Line Switches'
];

// ==============================================================================
// SECTION 1: TRIGGER LIFECYCLE MANAGEMENT (ZERO GHOST TRIGGERS)
// ==============================================================================

/**
 * Completely removes all active or orphaned cloud ingestion triggers
 */
function cleanupAllIngestionTriggers() {
  try {
    const triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(t => {
      if (t.getHandlerFunction() === TRIGGER_HANDLER_NAME) {
        try {
          ScriptApp.deleteTrigger(t);
        } catch (e) {
          Logger.log('Delete trigger notice: ' + e.message);
        }
      }
    });
  } catch (err) {
    Logger.log('cleanupAllIngestionTriggers notice: ' + err.message);
  }
}

/**
 * Registers a fresh 1-minute time-driven trigger for autonomous cloud execution
 */
function registerCloudIngestionTrigger() {
  cleanupAllIngestionTriggers();
  ScriptApp.newTrigger(TRIGGER_HANDLER_NAME)
    .timeBased()
    .everyMinutes(1)
    .create();
}

// ==============================================================================
// SECTION 2: ENGAGE, PAUSE, RESUME & DISCARD HANDLERS
// ==============================================================================

/**
 * The range to read, in days: CERA_DEFAULT_RANGE_DAYS when none is given, at most CERA_MAX_RANGE_DAYS.
 * Shared with the pre-flight, so its saved plan matches the job it was made for.
 */
function ceraRangeDays_(dateRangeDays) {
  return Math.min(CERA_MAX_RANGE_DAYS, Math.max(1, Number(dateRangeDays) || CERA_DEFAULT_RANGE_DAYS));
}

/**
 * Engages a new autonomous ingestion job for the selected time range (7 days when none is given)
 * Runs Batch #1 immediately and schedules subsequent batches in Google Apps Script background
 */
function engageCloudIngestion(dateRangeDays) {
  const daysFilter = ceraRangeDays_(dateRangeDays);
  const nowMs = Date.now();
  const windowStartMs = nowMs - (daysFilter * 86400000);
  const targetEndMs = nowMs;

  const timestampStr = Utilities.formatDate(new Date(), ceraTimeZone(), 'yyyyMMdd_HHmmss');
  const folderName = `Chrome_SecurityLogs_${daysFilter}d_${timestampStr}`;
  // Created through the Drive API, so the drive.file scope covers the folder and the partitions created in it
  const folder = Drive.Files.create({ name: folderName, mimeType: 'application/vnd.google-apps.folder' });
  const folderId = folder.id;
  const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;

  const startStr = Utilities.formatDate(new Date(windowStartMs), ceraTimeZone(), 'yyyy-MM-dd');
  const endStr = Utilities.formatDate(new Date(targetEndMs), ceraTimeZone(), 'yyyy-MM-dd');

  // Create first partition sheet in Drive folder
  const firstPartition = createTargetSheetFile(folderId, startStr, endStr, 1);

  const eventStreams = {};
  TARGET_EVENTS.forEach(ev => {
    eventStreams[ev] = { pageToken: null, completed: false, count: 0 };
  });

  const partitions = [{
    fileIndex: 1,
    fileName: firstPartition.fileName,
    fileId: firstPartition.fileId,
    rowCount: 0,
    status: 'IN_PROGRESS'
  }];

  let userEmail = '';
  try {
    userEmail = (Session.getActiveUser() && Session.getActiveUser().getEmail()) ||
                (Session.getEffectiveUser() && Session.getEffectiveUser().getEmail()) || '';
  } catch (e) {}
  let primaryDomain = '';
  if (userEmail && userEmail.includes('@')) {
    primaryDomain = userEmail.split('@')[1];
  }

  const activityId = 'act_' + (typeof Utilities !== 'undefined' && Utilities.getUuid ? Utilities.getUuid().replace(/-/g, '').slice(0, 8) : Math.random().toString(36).substring(2, 10));
  try {
    PropertiesService.getDocumentProperties().setProperty('CERA_CURRENT_ACTIVITY_ID', activityId);
  } catch (actErr) {}

  // Pre-flight plan (active weeks and expected events per day), when it ran for this range just now
  const plan = ceraLoadPreflightPlan_(daysFilter);
  const firstActiveMs = plan ? ceraPlanFirstActiveMs_(plan, windowStartMs) : 0;

  const initialState = {
    activityId: activityId,
    plan: plan,
    status: 'RUNNING',
    processedCount: 0,
    scannedCount: 0,
    timeSpanPct: 0,
    estimatedRemainingSec: 0,
    elapsedTimeSec: 0,
    totalRealTimeElapsedMs: 0,
    processingRate: 0,
    currentFileName: firstPartition.fileName,
    currentFileId: firstPartition.fileId,
    folderId: folderId,
    folderName: folderName,
    folderUrl: folderUrl,
    fileIndex: 1,
    currentSheetRows: 1,
    dateRangeDays: daysFilter,
    startStr: startStr,
    endStr: endStr,
    startDateStr: startStr,
    currentLogDateStr: startStr,
    windowStartMs: windowStartMs,
    targetEndMs: targetEndMs,
    // Start from the oldest date, or from the first week pre-flight saw any Chrome activity in
    currentCursorMs: firstActiveMs || windowStartMs,
    totalLogSpanMs: Math.abs(targetEndMs - windowStartMs),
    globalVelocity: 1.0,
    rollingVelocity: 1.0,
    currentDay: 1,
    totalDays: daysFilter,
    eventStreams: eventStreams,
    partitions: partitions,
    userEmail: userEmail,
    primaryDomain: primaryDomain,
    lastUpdateMs: Date.now()
  };

  saveStateToStorage(initialState);
  try {
    PropertiesService.getDocumentProperties().deleteProperty('CERA_ANALYSIS_EXECUTED');
  } catch (cpErr) {}

  const diagMeta = ceraInitDiagnosticLog_(initialState, firstPartition);

  // Initialize the Live Monitor Sheet tab immediately
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  safeUpdateDashboard(ss, initialState, partitions);

  // Register autonomous background trigger to run in Google Apps Script
  registerCloudIngestionTrigger();

  return {
    success: true,
    folderId: folderId,
    folderName: folderName,
    folderUrl: folderUrl,
    logFolderId: (diagMeta && diagMeta.logFolderId) || '',
    logFolderUrl: (diagMeta && diagMeta.logFolderUrl) || folderUrl,
    logFileId: (diagMeta && diagMeta.logFileId) || '',
    status: 'RUNNING'
  };
}

/**
 * Pauses active cloud ingestion and self-cleans background triggers
 */
function pauseCloudIngestion() {
  cleanupAllIngestionTriggers();

  let state = getProgressUpdate();
  state.status = 'PAUSED';
  saveStateToStorage(state);
  ceraRecordDiagLifecycle_(state, 'PAUSED', 'USER_PAUSED', 'User paused background ingestion.');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  safeUpdateDashboard(ss, state, state.partitions || []);

  return { success: true, status: 'PAUSED' };
}

/**
 * Stops active background triggers and marks the current extraction session COMPLETED with the partitions
 * extracted so far, allowing the user to proceed directly to CERA analysis without waiting for remaining slices.
 */
function stopAndFinalizeCurrentIngestion() {
  cleanupAllIngestionTriggers();

  let state = getProgressUpdate();
  if (!state || !state.folderId) {
    throw new Error(ceraT('err.noSession'));
  }

  state.status = 'COMPLETED';
  state.isCompleted = true;
  state.timeSpanPct = 100;
  state.etaSec = 0;
  state.estimatedRemainingSec = 0;
  state.errorMessage = '';
  state.errorKey = '';
  if (Array.isArray(state.partitions) && state.partitions.length > 0) {
    state.partitions[state.partitions.length - 1].status = 'COMPLETED';
  }
  saveStateToStorage(state);
  ceraRecordDiagLifecycle_(state, 'COMPLETED', 'STOPPED_EARLY_FOR_ANALYSIS', 'User stopped extraction early to analyze collected partitions immediately.');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  safeUpdateDashboard(ss, state, state.partitions || []);
  const diagMeta = ceraGetDiagLogMeta_(state.folderId);

  return {
    success: true,
    status: 'COMPLETED',
    folderId: state.folderId,
    folderName: state.folderName || '',
    folderUrl: state.folderUrl || (state.folderId ? `https://drive.google.com/drive/folders/${state.folderId}` : ''),
    logFolderId: (diagMeta && diagMeta.logFolderId) || '',
    logFolderUrl: (diagMeta && diagMeta.logFolderUrl) || state.folderUrl || (state.folderId ? `https://drive.google.com/drive/folders/${state.folderId}` : ''),
    logFileId: (diagMeta && diagMeta.logFileId) || '',
    processedCount: state.processedCount || 0,
    fileIndex: state.fileIndex || 1
  };
}

/**
 * Resumes a paused or interrupted cloud ingestion from its last saved checkpoint
 */
function resumeCloudIngestion() {
  let state = getProgressUpdate();
  if (!state) {
    throw new Error(ceraT('err.noSession'));
  }

  state.status = 'RUNNING';
  state.errorMessage = '';
  state.errorKey = '';
  state.consecutiveFailures = 0;
  saveStateToStorage(state);
  ceraRecordDiagLifecycle_(state, 'RUNNING', 'USER_RESUMED', 'User resumed background ingestion from checkpoint.');

  registerCloudIngestionTrigger();

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  safeUpdateDashboard(ss, state, state.partitions || []);

  return {
    success: true,
    status: 'RUNNING',
    processedCount: state.processedCount || 0,
    folderName: state.folderName || '',
    currentFileName: state.currentFileName || '',
    fileIndex: state.fileIndex || 1
  };
}

/**
 * Discards active session, cleans triggers and resets monitor sheet
 */
function discardCloudIngestion() {
  let activeActId = '';
  try {
    activeActId = PropertiesService.getDocumentProperties().getProperty('CERA_CURRENT_ACTIVITY_ID') || '';
  } catch (e) {}

  const existing = getProgressUpdate();
  if (existing && existing.folderId) {
    ceraRecordDiagLifecycle_(existing, 'STOPPED', 'SESSION_DISCARDED', 'User discarded or reset active ingestion session.');
  }

  cleanupAllIngestionTriggers();

  PropertiesService.getDocumentProperties().deleteProperty('SIERRA_SESSION');
  PropertiesService.getDocumentProperties().deleteProperty('CERA_CURRENT_ACTIVITY_ID');
  CacheService.getUserCache().remove('SIERRA_LIVE_PROGRESS');
  CacheService.getScriptCache().remove('SIERRA_LIVE_PROGRESS');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const resetState = {
    activityId: activeActId,
    status: 'IDLE',
    processedCount: 0,
    timeSpanPct: 0,
    daysFilter: CERA_DEFAULT_RANGE_DAYS,
    currentFileName: '',
    folderName: ''
  };
  safeUpdateDashboard(ss, resetState, []);

  return { success: true, status: 'IDLE' };
}

// ==============================================================================
// SECTION 3: AUTONOMOUS CLOUD BATCH WORKER
// ==============================================================================

/**
 * Main autonomous worker invoked on each trigger tick
 * Protected by LockService and governed by 4-minute time-budget watchdog
 */
function processCloudIngestionBatch() {
  // 1. Concurrency Protection: Avoid overlapping trigger ticks (wait up to 10s if previous batch is finalizing)
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    Logger.log('Previous background execution still active. Skipping concurrent tick.');
    return;
  }

  const executionStartTime = Date.now();
  let state = getProgressUpdate();

  // If job is no longer running or in active quota sleep, self-destruct trigger and exit
  if (!state || (state.status !== 'RUNNING' && state.status !== 'QUOTA_PAUSED')) {
    cleanupAllIngestionTriggers();
    lock.releaseLock();
    return;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // If user deleted '⚡ Ingestion Monitor' tab during background execution, abort and reset session
  if (ss && !ss.getSheetByName('⚡ Ingestion Monitor')) {
    Logger.log("'⚡ Ingestion Monitor' tab was deleted. Aborting background batch and wiping session.");
    cleanupAllIngestionTriggers();
    PropertiesService.getDocumentProperties().deleteProperty('SIERRA_SESSION');
    CacheService.getScriptCache().remove('SIERRA_LIVE_PROGRESS');
    CacheService.getUserCache().remove('SIERRA_LIVE_PROGRESS');
    lock.releaseLock();
    return;
  }

  let totalLogsProcessed = Number(state.processedCount || 0);
  let totalScanned = Number(state.scannedCount || 0);
  let fileIndex = state.fileIndex || 1;
  let currentFileId = state.currentFileId;
  let currentFileName = state.currentFileName || '';
  let currentSheetRows = state.currentSheetRows || 1;
  let folderId = state.folderId;
  let folderUrl = state.folderUrl;
  let folderName = state.folderName;
  let windowStartMs = state.windowStartMs;
  let targetEndMs = state.targetEndMs;
  let currentCursorMs = state.currentCursorMs || windowStartMs;
  const cursorAtTickStartMs = currentCursorMs;
  let totalLogSpanMs = Math.max(1, targetEndMs - windowStartMs);
  let totalRealTimeElapsedMs = state.totalRealTimeElapsedMs || 0;
  let eventStreams = state.eventStreams || {};
  let partitions = state.partitions || [];
  let daysFilter = state.dateRangeDays || CERA_DEFAULT_RANGE_DAYS;

  // Rows read but not appended yet, with the uniqueQualifier of each
  let buffer = [];
  let bufferIds = [];
  // The pages in the buffer: their stream, where their rows sit in the buffer, and the read position (cursor and
  // streams) before each was read. Streams move past a page as soon as it is read, so after a failed append the
  // read position goes back to the first page that did not reach a partition: the next tick reads exactly the
  // rows that were not written, and none twice.
  let pages = [];
  // Rows of the buffer appended by the flush in progress, including those of an append that failed part way
  let pendingWrite = null;
  let lastBatchWallClockMs = Date.now();
  // What this tick did and what it cost, for the remaining-work estimate
  const work = { requests: 0, requestMs: 0, rows: 0, writeMs: 0 };
  const tickDiag = {
    startedAtMs: executionStartTime,
    cursorStartMs: cursorAtTickStartMs,
    cursorEndMs: currentCursorMs,
    quietWeeksSkipped: 0,
    completedSlices: [],
    newPartitions: [],
    recoveredPartitions: 0,
    adaptiveSplits: 0,
    tokenFallbacks: 0,
    rewinds: 0,
    sleepMs: 0,
    streamPages: {},
    streamTokenFallbacks: {},
    streamSchema: {},
    anomalies: []
  };

  const readPosition = () => JSON.stringify({
    cursor: currentCursorMs, streams: eventStreams, scanned: totalScanned, sliceChecked: state.sliceChecked,
    activeUntilMs: state.activeUntilMs, recentDays: state.recentDays, calib: state.calib
  });
  const restorePosition = saved => {
    const p = JSON.parse(saved);
    currentCursorMs = p.cursor;
    eventStreams = p.streams;
    totalScanned = p.scanned;
    state.sliceChecked = p.sliceChecked;
    state.activeUntilMs = p.activeUntilMs;
    state.recentDays = p.recentDays;
    state.calib = p.calib;
  };
  const countWritten = rows => {
    totalLogsProcessed += rows;
    currentSheetRows += rows;
    if (partitions.length > 0) {
      partitions[partitions.length - 1].rowCount = currentSheetRows - 1;
    }
  };
  const openPartition = () => {
    fileIndex++;
    const nextPart = createTargetSheetFile(folderId, state.startStr, state.endStr, fileIndex);
    currentFileId = nextPart.fileId;
    currentFileName = nextPart.fileName;
    currentSheetRows = 1;
    partitions.push({
      fileIndex: fileIndex,
      fileName: nextPart.fileName,
      fileId: nextPart.fileId,
      rowCount: 0,
      status: 'IN_PROGRESS'
    });
    tickDiag.newPartitions.push({
      part: fileIndex,
      rows: 0,
      status: 'IN_PROGRESS',
      createdAtUtc: new Date().toISOString()
    });
    // Sliding Window: Keep maximum 10 active/recent partitions in state to prevent memory and storage bloat
    if (partitions.length > 10) {
      partitions = partitions.slice(-10);
    }
  };

  // Safe writer with auto-regeneration if active partition sheet was deleted in Drive (404)
  const writeBufferSafely = (targetFileId, rows, progress) => {
    const writeStartMs = Date.now();
    try {
      return appendWithRecovery(targetFileId, rows, progress);
    } finally {
      work.writeMs += Date.now() - writeStartMs;
      work.rows += rows.length;
    }
  };
  const appendWithRecovery = (targetFileId, rows, progress) => {
    try {
      return flushBufferWithRetry(targetFileId, rows, 0, progress);
    } catch (appendErr) {
      const errStr = (appendErr.message || String(appendErr)).toLowerCase();
      if (errStr.includes('404') || errStr.includes('not found')) {
        console.warn(`[Auto-Recovery] Active partition file (${targetFileId}) missing or deleted. Auto-generating fresh partition...`);
        tickDiag.recoveredPartitions++;
        tickDiag.anomalies.push({
          atUtc: new Date().toISOString(),
          phase: 'SHEETS_APPEND',
          code: 'PARTITION_404_AUTO_RECOVERED',
          action: 'OPENED_NEW_PARTITION',
          detail: 'Active partition sheet was missing or deleted; auto-generated replacement partition.'
        });
        // Rows that reached the deleted file went with it: all of them go to the new partition
        progress.written = 0;
        openPartition();
        return flushBufferWithRetry(currentFileId, rows, 0, progress);
      }
      throw appendErr;
    }
  };

  // Appends the buffered pages, filling the current partition up to MAX_ROWS_PER_SHEET rows before opening the next
  const flushBuffer = () => {
    pendingWrite = { done: 0, written: 0, splits: 0 };
    while (pendingWrite.done < buffer.length) {
      if (currentSheetRows - 1 >= MAX_ROWS_PER_SHEET) {
        if (partitions.length > 0) {
          partitions[partitions.length - 1].status = 'COMPLETED';
        }
        openPartition();
      }
      const chunk = buffer.slice(pendingWrite.done, pendingWrite.done + MAX_ROWS_PER_SHEET - (currentSheetRows - 1));
      writeBufferSafely(currentFileId, chunk, pendingWrite);
      countWritten(chunk.length);
      pendingWrite.done += chunk.length;
      pendingWrite.written = 0;
    }
    tickDiag.adaptiveSplits += Number(pendingWrite.splits || 0);
    pendingWrite = null;
    buffer = [];
    bufferIds = [];
    pages = [];
    state.consecutiveFailures = 0; // Successful append resets failure strike count
  };

  // After an error: rows that a failed append did write count as written, and the read position goes back to just
  // after the last row that reached a partition
  const rewindToWrittenRows = () => {
    let written = 0;
    if (pendingWrite) {
      countWritten(pendingWrite.written);
      written = pendingWrite.done + pendingWrite.written;
      tickDiag.adaptiveSplits += Number(pendingWrite.splits || 0);
    }
    let p = 0;
    while (p < pages.length && pages[p].end <= written) p++;
    if (p === pages.length) return; // nothing unwritten
    tickDiag.rewinds++;
    restorePosition(pages[p].before);
    if (written > pages[p].start) {
      // The append stopped inside this page: its stream resumes after the last row written (see ceraExtendEdge_)
      const stream = eventStreams[pages[p].ev];
      stream.pageToken = null;
      stream.completed = false;
      for (let r = pages[p].start; r < written; r++) ceraExtendEdge_(stream, Date.parse(buffer[r][0]), bufferIds[r]);
      const rows = written - pages[p].start;
      stream.dayRows = (stream.dayRows || 0) + rows;
      stream.count = (stream.count || 0) + rows;
      totalScanned += rows;
    }
  };

  try {
    let jobComplete = false;
    let jobGone = false;

    // Chronological day-by-day sliding window: first day of the range up to Day 0
    const DAY_MS = 86400000;
    while (Date.now() - executionStartTime < TIME_BUDGET_MS) {

      // Check if user paused, stopped or reset the job
      const storedStatus = ceraStoredJobStatus_(state.activityId);
      if (storedStatus === 'GONE') {
        jobGone = true;
        break;
      }
      if (storedStatus === 'PAUSED' || storedStatus === 'STOPPED') {
        cleanupAllIngestionTriggers();
        break;
      }

      if (currentCursorMs >= targetEndMs) {
        jobComplete = true;
        break;
      }

      const sliceStartMs = currentCursorMs;
      const sliceEndMs = Math.min(targetEndMs, currentCursorMs + DAY_MS);
      const startIso = new Date(sliceStartMs).toISOString();
      const endIso = new Date(sliceEndMs).toISOString();

      // Quiet-period skip: before the per-event queries of a new week, one unfiltered query (it does not count
      // toward the 250 filter queries per minute) checks whether Chrome logged anything at all in the next 7 days.
      // A quiet week is skipped in one step; tenants often enable reporting long after a long range starts.
      if (!state.sliceChecked && !(Number(state.activeUntilMs) > sliceStartMs)) {
        const weekEndMs = Math.min(targetEndMs, sliceStartMs + 7 * DAY_MS);
        const checkStartMs = Date.now();
        const weekIsEmpty = chromeWindowIsEmpty_(startIso, new Date(weekEndMs).toISOString());
        work.requests++;
        work.requestMs += Date.now() - checkStartMs;
        if (weekIsEmpty) {
          tickDiag.quietWeeksSkipped++;
          currentCursorMs = weekEndMs;
          TARGET_EVENTS.forEach(ev => { eventStreams[ev] = { pageToken: null, completed: false, count: (eventStreams[ev] && eventStreams[ev].count) || 0 }; });
          if (currentCursorMs >= targetEndMs) {
            jobComplete = true;
            break;
          }
          continue;
        }
        // The week has activity: scan its days normally without probing again until it ends
        state.activeUntilMs = weekEndMs;
        state.sliceChecked = true;
      }

      // Check active event streams for current day slice
      const activeEvents = TARGET_EVENTS.filter(ev => !eventStreams[ev] || !eventStreams[ev].completed);
      if (activeEvents.length === 0) {
        // All events for this day slice completed: advance to the next day slice
        const sliceEvents = TARGET_EVENTS.reduce((sum, ev) => sum + (Number(eventStreams[ev] && eventStreams[ev].dayRows) || 0), 0);
        tickDiag.completedSlices.push({
          dayIndex: Math.min(daysFilter, Math.max(1, Math.floor((sliceStartMs - windowStartMs) / DAY_MS) + 1)),
          sliceStartUtc: startIso,
          sliceEndUtc: endIso,
          events: sliceEvents,
          completedAtUtc: new Date().toISOString()
        });
        ceraRecordDayDone_(state, sliceStartMs, eventStreams);
        currentCursorMs = sliceEndMs;
        state.sliceChecked = false;
        if (currentCursorMs >= targetEndMs) {
          jobComplete = true;
          break;
        }
        TARGET_EVENTS.forEach(ev => {
          eventStreams[ev] = { pageToken: null, completed: false, count: (eventStreams[ev] && eventStreams[ev].count) || 0, dayRows: 0 };
        });
        continue;
      }

      // Query round-robin 1 chunk per active stream
      for (let eIdx = 0; eIdx < activeEvents.length; eIdx++) {
        const evName = activeEvents[eIdx];
        if (!eventStreams[evName]) {
          eventStreams[evName] = { pageToken: null, completed: false, count: 0 };
        }
        const stream = eventStreams[evName];
        // Without a pageToken (a rejected one, or an append that failed inside a page), a stream that already took
        // events from this slice restarts right after the oldest of them: endTime is one millisecond past it, and
        // what it took at that millisecond is skipped
        const resumeAtEdge = !stream.pageToken && ceraHasEdge_(stream);
        const pageEndIso = resumeAtEdge ? new Date(Number(stream.edgeMs) + 1).toISOString() : endIso;
        const positionBeforePage = readPosition();

        let page = null;
        const fetchStartMs = Date.now();
        try {
          page = fetchChromeLogPage(stream.pageToken, startIso, null, evName, 1000, pageEndIso);
        } catch (apiErr) {
          work.requests++;
          work.requestMs += Date.now() - fetchStartMs;
          const apiErrMsg = (apiErr.message || String(apiErr)).toLowerCase();
          if (stream.pageToken && (apiErrMsg.includes('pagetoken') || apiErrMsg.includes('400') || apiErrMsg.includes('invalid token'))) {
            console.warn(`[Admin SDK] Expired or invalid pageToken for ${evName}. Resuming the slice after the last event taken: ${apiErr.message}`);
            tickDiag.tokenFallbacks++;
            tickDiag.streamTokenFallbacks[evName] = (tickDiag.streamTokenFallbacks[evName] || 0) + 1;
            tickDiag.anomalies.push({
              atUtc: new Date().toISOString(),
              phase: 'REPORTS_API',
              stream: evName,
              code: 'PAGE_TOKEN_EXPIRED_FALLBACK',
              action: 'EDGE_TIMESTAMP_RESUME',
              detail: ceraSanitizeDiagnosticText_(apiErr.message || String(apiErr))
            });
            stream.pageToken = null;
            continue; // CRITICAL: Skip fall-through so stream is NOT erroneously marked completed!
          } else if (ceraIsDailyQuotaError_(apiErrMsg) || ceraIsRateLimitError_(apiErrMsg) || ceraIsPermissionError_(apiErrMsg)) {
            // A daily quota or rate limit that outlasted the backoff ends the tick (QUOTA_PAUSED); a permission
            // error ends it as a failure, which stops the job after 10 ticks instead of retrying it forever
            throw apiErr;
          } else {
            console.warn(`Stream transient notice (${evName}): ${apiErr.message}. Preserving stream state for retry.`);
            tickDiag.anomalies.push({
              atUtc: new Date().toISOString(),
              phase: 'REPORTS_API',
              stream: evName,
              code: 'STREAM_TRANSIENT_NOTICE',
              action: 'RETRY_NEXT_TICK',
              detail: ceraSanitizeDiagnosticText_(apiErr.message || String(apiErr))
            });
            // Do NOT mark stream.completed = true on transient server errors!
            continue;
          }
        }

        work.requests++;
        work.requestMs += Date.now() - fetchStartMs;
        tickDiag.streamPages[evName] = (tickDiag.streamPages[evName] || 0) + 1;
        const items = (page && page.items) || [];

        // Parse the whole page before the stream moves past it
        const pageRows = [];
        const pageIds = [];
        const pageTimes = [];
        let reachedSliceStart = false;
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const itemMs = item && item.id ? Date.parse(item.id.time) : NaN;
          const itemId = item && item.id && item.id.uniqueQualifier ? String(item.id.uniqueQualifier) : '';
          if (!isNaN(itemMs) && itemMs < sliceStartMs) {
            reachedSliceStart = true;
            continue;
          }
          if (resumeAtEdge && ceraTakenFromStream_(stream, itemMs, itemId)) continue;
          const parsedRow = parseEventToRow(item, evName);
          ceraRecordDiagRowSchema_(tickDiag.streamSchema, evName, parsedRow);
          pageRows.push(parsedRow);
          pageIds.push(itemId);
          pageTimes.push(itemMs);
        }

        stream.pageToken = reachedSliceStart ? null : ((page && page.nextPageToken) || null);
        const pageStart = buffer.length;
        for (let r = 0; r < pageRows.length; r++) {
          ceraExtendEdge_(stream, pageTimes[r], pageIds[r]);
          buffer.push(pageRows[r]);
          bufferIds.push(pageIds[r]);
        }

        const taken = pageRows.length;
        totalScanned += taken;
        stream.dayRows = (stream.dayRows || 0) + taken;
        // Rows per stream for the monitor, counted as read: a buffer flush mixes rows from several streams
        stream.count = (stream.count || 0) + taken;
        if (!stream.pageToken) {
          stream.completed = true;
          // A finished stream never restarts within its slice
          delete stream.edgeMs;
          delete stream.edgeIds;
        }
        if (taken > 0) {
          pages.push({ ev: evName, start: pageStart, end: buffer.length, before: positionBeforePage });
        }

        // Periodic buffer flush directly to Drive partition, between pages so every stream stands at a page boundary
        if (buffer.length >= BATCH_FLUSH_SIZE) {
          flushBuffer();
        }

        // Free memory promptly for V8 GC & apply micro-pacing for 150 req/min Admin SDK quota
        page = null;
        Utilities.sleep(120);
        tickDiag.sleepMs += 120;
      }
    }

    // Reset (or replaced by a new job) during this tick: nothing of it is written back
    if (jobGone) {
      Logger.log('Ingestion job was reset during this tick. Its progress is discarded.');
      return;
    }

    // Flush remaining buffer
    if (buffer.length > 0) {
      flushBuffer();
    }

    // Update real-time metrics
    const runDurationMs = Date.now() - executionStartTime;
    totalRealTimeElapsedMs += runDurationMs;

    const coveredMs = Math.max(0, currentCursorMs - windowStartMs);
    const coverageRatio = totalLogSpanMs > 0 ? Math.min(1.0, coveredMs / totalLogSpanMs) : 1.0;
    let timeSpanPct = jobComplete ? 100 : Math.min(99.9, Math.max(0.1, Math.round(coverageRatio * 1000) / 10));
    const currentDay = Math.min(daysFilter, Math.max(1, Math.floor(coveredMs / 86400000) + 1));
    const rate = totalRealTimeElapsedMs > 0 ? Math.round((totalLogsProcessed / (totalRealTimeElapsedMs / 1000)) * 10) / 10 : 0;
    const remainingLogsEst = coverageRatio > 0.01 ? Math.max(0, Math.round((totalLogsProcessed / coverageRatio) - totalLogsProcessed)) : 0;
    // Wall-clock ETA from how much of the window this tick covered: the job ends when the cursor reaches the
    // end, one tick runs per minute, and the latest tick reflects the current data density (quiet weeks are
    // skipped quickly, busy days are slow). Keeps the previous estimate when this tick did not move.
    const advancedMs = currentCursorMs - cursorAtTickStartMs;
    let etaSec = advancedMs > 0
      ? Math.round(((targetEndMs - currentCursorMs) / advancedMs) * 60)
      : Number(state.etaSec || 0);

    // With a pre-flight plan, progress and ETA come from the work left (requests and rows on the remaining
    // active days) at the cost measured over the last ticks, instead of from calendar coverage.
    const tickEndMs = Date.now();
    const workEstimate = ceraUpdateWorkEstimate_(state, work, executionStartTime, tickEndMs, currentCursorMs, targetEndMs, eventStreams, totalScanned);
    let workPct = null;
    if (workEstimate && !jobComplete) {
      etaSec = workEstimate.etaSec;
      workPct = workEstimate.pct;
      state.expectedEvents = workEstimate.expectedEvents;
    }

    let displayCursorMs = currentCursorMs;
    if (!jobComplete && currentCursorMs > 0 && currentCursorMs < targetEndMs) {
      const sliceSpanMs = Math.min(86400000, targetEndMs - currentCursorMs);
      const sliceEnd = currentCursorMs + sliceSpanMs;
      let minCoveredFrac = 1;
      let anyPaging = false;
      TARGET_EVENTS.forEach(ev => {
        const st = eventStreams[ev] || {};
        if (st.completed) return;
        if (Number(st.edgeMs) > currentCursorMs && Number(st.edgeMs) < sliceEnd) {
          anyPaging = true;
          const frac = (sliceEnd - Number(st.edgeMs)) / sliceSpanMs;
          if (frac < minCoveredFrac) minCoveredFrac = frac;
        }
      });
      if (anyPaging && minCoveredFrac > 0 && minCoveredFrac < 1) {
        displayCursorMs = currentCursorMs + Math.floor(minCoveredFrac * sliceSpanMs);
      }
    }
    const currentLogDateStr = displayCursorMs > 0 ? Utilities.formatDate(new Date(displayCursorMs), ceraTimeZone(), 'yyyy-MM-dd HH:mm') : state.startDateStr;

    // Check completion
    const finalStatus = jobComplete ? 'COMPLETED' : 'RUNNING';

    state.status = finalStatus;
    state.processedCount = totalLogsProcessed;
    state.scannedCount = totalScanned;
    if (workPct !== null) timeSpanPct = Math.min(99.9, Math.max(0.1, workPct));
    state.timeSpanPct = timeSpanPct;
    state.currentDay = currentDay;
    state.currentCursorMs = currentCursorMs;
    state.currentLogDateStr = currentLogDateStr;
    state.processingRate = rate;
    state.rate = rate;
    state.etaSec = etaSec;
    state.estimatedRemainingSec = etaSec;
    state.totalRealTimeElapsedMs = totalRealTimeElapsedMs;
    state.elapsedTimeSec = Math.round(totalRealTimeElapsedMs / 1000);
    state.fileIndex = fileIndex;
    state.currentFileId = currentFileId;
    state.currentFileName = currentFileName;
    state.currentSheetRows = currentSheetRows;
    state.eventStreams = eventStreams;
    state.partitions = partitions;
    state.lastUpdateMs = Date.now();
    state.consecutiveFailures = 0;
    state.errorMessage = '';
    state.errorKey = '';

    if (jobComplete && partitions.length > 0) {
      partitions[partitions.length - 1].status = 'COMPLETED';
    }

    // Pause and reset do not wait for this tick's lock: read the session again right before writing it back. A job
    // reset meanwhile stays gone; one paused or stopped keeps that status with this tick's progress.
    const storedStatus = ceraStoredJobStatus_(state.activityId);
    if (storedStatus === 'GONE') {
      Logger.log('Ingestion job was reset during this tick. Its progress is discarded.');
      return;
    }
    if (storedStatus === 'PAUSED' || storedStatus === 'STOPPED') {
      state.status = storedStatus;
    } else if (jobComplete) {
      cleanupAllIngestionTriggers(); // AUTO SELF-DESTRUCT!
    }

    saveStateToStorage(state);
    safeUpdateDashboard(ss, state, partitions);
    tickDiag.cursorEndMs = currentCursorMs;
    ceraRecordDiagTick_(state, work, tickDiag, state.status === 'FAILED' ? 'FAILED_STATE_OVERSIZE' : (jobComplete ? 'COMPLETED' : 'OK'), state.errorMessage || '');

  } catch (err) {
    console.error('Autonomous batch execution error: ' + err.stack);
    const rawErrMsg = err.message || String(err);
    const errMsgLower = rawErrMsg.toLowerCase();

    // Check for Google Apps Script Daily Runtime Quota (6 Hours / Day for Workspace) across supported locales
    const isDailyQuota = ceraIsDailyQuotaError_(rawErrMsg);
    // A Reports or Sheets API rate limit that outlasted the retries clears within a minute: wait like for the quota
    const isRateLimit = !isDailyQuota && ceraIsRateLimitError_(errMsgLower);

    // Rows read but not written are read again next tick, from just after the last row that reached a partition
    rewindToWrittenRows();

    // Synchronize latest in-flight metrics to prevent loss of progress
    state.processedCount = totalLogsProcessed;
    state.scannedCount = totalScanned;
    state.currentCursorMs = currentCursorMs;
    state.fileIndex = fileIndex;
    state.currentFileId = currentFileId;
    state.currentFileName = currentFileName;
    state.currentSheetRows = currentSheetRows;
    state.eventStreams = eventStreams;
    state.partitions = partitions;
    state.lastUpdateMs = Date.now();
    tickDiag.cursorEndMs = currentCursorMs;

    // As above: a job reset meanwhile stays gone, a paused or stopped one keeps its status (and this tick's progress)
    const storedStatus = ceraStoredJobStatus_(state.activityId);
    if (storedStatus === 'GONE') {
      Logger.log('Ingestion job was reset during this tick. Its progress is discarded.');
      return;
    }
    if (storedStatus === 'PAUSED' || storedStatus === 'STOPPED') {
      state.status = storedStatus;
      saveStateToStorage(state);
      safeUpdateDashboard(ss, state, partitions);
      ceraRecordDiagTick_(state, work, tickDiag, storedStatus, rawErrMsg);
      return;
    }

    if (isDailyQuota || isRateLimit) {
      // ⏳ Daily Apps Script Quota hit: Enter Quota Sleep without failure penalty
      console.warn(`[Quota Sleep] ${isDailyQuota ? 'Google Apps Script daily runtime limit' : 'Google API rate limit'} reached: ${rawErrMsg}. Preserving state and trigger for auto-resume.`);
      state.status = 'QUOTA_PAUSED';
      // Shown in the dialog in the viewer's language; the raw reason stays in the logs
      state.errorMessage = '';
      state.errorKey = isDailyQuota ? 'mon.quotaDefault' : 'mon.err.rateLimit';
      state.consecutiveFailures = 0;
      saveStateToStorage(state);
      safeUpdateDashboard(ss, state, partitions);
      ceraRecordDiagTick_(state, work, tickDiag, isDailyQuota ? 'DAILY_QUOTA_SLEEP' : 'RATE_LIMIT_PAUSE', rawErrMsg);
    } else {
      const failCount = (Number(state.consecutiveFailures) || 0) + 1;
      state.consecutiveFailures = failCount;
      state.errorMessage = rawErrMsg;
      state.errorKey = '';

      if (failCount < 10) {
        // Self-healing: keep trigger alive for next scheduled minute tick (allow up to 9 transient strikes = 10 minutes)
        console.warn(`Transient batch notice (Strike ${failCount}/10). Preserving trigger for next tick: ${rawErrMsg}`);
        state.status = 'RUNNING';
        saveStateToStorage(state);
        safeUpdateDashboard(ss, state, partitions);
        ceraRecordDiagTick_(state, work, tickDiag, 'TRANSIENT_STRIKE_' + failCount, rawErrMsg);
      } else {
        // 10 consecutive failures (10 minutes persistent cloud outage): Safely pause triggers and notify user
        state.status = 'FAILED';
        cleanupAllIngestionTriggers();
        saveStateToStorage(state);
        safeUpdateDashboard(ss, state, partitions);
        ceraRecordDiagTick_(state, work, tickDiag, 'FAILED_MAX_STRIKES', rawErrMsg);
      }
    }
  } finally {
    lock.releaseLock();
  }
}

// ==============================================================================
// SECTION 4: DATA FETCHING & FORMATTING HELPERS
// ==============================================================================

/**
 * True when Chrome logged no activity of any kind in [startIso, endIso). Unfiltered (no eventName), so it
 * does not count toward the filter-query quota. Any error answers false, so a window is never skipped
 * on a failed check.
 */
function chromeWindowIsEmpty_(startIso, endIso) {
  try {
    const page = AdminReports.Activities.list('all', 'chrome', { startTime: startIso, endTime: endIso, maxResults: 1 });
    return !(page && page.items && page.items.length);
  } catch (e) {
    console.warn('Quiet-window check failed, scanning the window instead: ' + e.message);
    return false;
  }
}

// ==============================================================================
// STREAM EDGE (resuming a stream without its pageToken)
// ==============================================================================

// IDs kept for the edge millisecond: enough for a burst of events sharing one millisecond, small enough for the state
const CERA_EDGE_ID_CAP = 20;

/**
 * Records an event taken from a stream. Pages come newest first, so the stream's edge is the oldest event taken in
 * its day slice; the uniqueQualifiers taken at exactly that millisecond are kept with it. The stream can then
 * restart after the edge without a pageToken (endTime = edge + 1 ms, skipping those IDs). Restarting at
 * edge - 1 ms instead would drop the events of that millisecond that were not taken yet.
 */
function ceraExtendEdge_(stream, ms, id) {
  if (isNaN(ms)) return;
  if (!ceraHasEdge_(stream) || ms < stream.edgeMs) {
    stream.edgeMs = ms;
    stream.edgeIds = id ? [id] : [];
  } else if (ms === stream.edgeMs && id) {
    stream.edgeIds = stream.edgeIds || [];
    if (stream.edgeIds.length < CERA_EDGE_ID_CAP && stream.edgeIds.indexOf(id) === -1) stream.edgeIds.push(id);
  }
}

function ceraHasEdge_(stream) {
  return stream.edgeMs !== undefined && stream.edgeMs !== null;
}

/**
 * Whether an event of a restarted stream was taken before: newer than the edge, or at the edge with a known ID.
 */
function ceraTakenFromStream_(stream, ms, id) {
  if (!ceraHasEdge_(stream) || isNaN(ms)) return false;
  return ms > stream.edgeMs || (ms === stream.edgeMs && !!id && (stream.edgeIds || []).indexOf(id) !== -1);
}

// ==============================================================================
// REMAINING-WORK ESTIMATE (progress and ETA)
// ==============================================================================

// Finished active days at which the pre-flight plan and the measured volume weigh equally in the estimate
var CERA_ETA_PLAN_DAYS = (typeof globalThis !== 'undefined' && globalThis.OVERRIDE_ETA_PLAN_DAYS) || 5;

/**
 * The plan saved by the pre-flight for the same range, if it ran within the last 2 hours.
 */
function ceraLoadPreflightPlan_(days) {
  try {
    const plan = JSON.parse(PropertiesService.getDocumentProperties().getProperty(CERA_PREFLIGHT_PLAN_KEY) || 'null');
    if (!plan || Number(plan.days) !== Number(days) || Date.now() - Number(plan.savedMs) > CERA_PREFLIGHT_PLAN_TTL_MS) return null;
    return { startMs: Number(plan.startMs), weeks: String(plan.weeks || ''), perDay: plan.perDay || {}, total: Number(plan.total) || 0 };
  } catch (e) {
    return null;
  }
}

/**
 * Whether the plan expects Chrome activity on the day starting at ms. Days after the pre-flight ran count as active.
 */
function ceraPlanIsActive_(plan, ms) {
  const idx = Math.floor((ms - plan.startMs) / (7 * 86400000));
  if (idx < 0) return false;
  return idx >= plan.weeks.length || plan.weeks.charAt(idx) === '1';
}

/**
 * Start of the first week the pre-flight saw activity in, aligned to the pre-flight's weeks so no day is skipped.
 */
function ceraPlanFirstActiveMs_(plan, windowStartMs) {
  const idx = plan.weeks.indexOf('1');
  if (idx <= 0) return 0;
  return Math.max(windowStartMs, plan.startMs + idx * 7 * 86400000);
}

/**
 * Called when a day slice is done: keeps how the finished active days compared with the plan,
 * overall and for the last 7 days, so a plan that turns out wrong can be replaced by measured volume.
 */
function ceraRecordDayDone_(state, dayStartMs, eventStreams) {
  const plan = state.plan;
  if (!plan || !ceraPlanIsActive_(plan, dayStartMs)) return;
  const weekend = ceraIsWeekendMs_(dayStartMs + 43200000) ? 1 : 0;
  const day = [0, 0];
  TARGET_EVENTS.forEach(ev => {
    day[0] += Number((plan.perDay[ev] || [0, 0])[weekend]) || 0;
    day[1] += Number(eventStreams[ev] && eventStreams[ev].dayRows) || 0;
  });
  // Empty days before the first event (an active week can start mid-week) say nothing about volume
  if (!state.recentDays && day[1] === 0) return;
  state.recentDays = (state.recentDays || []).concat([day]).slice(-7);
  const calib = state.calib || [0, 0, 0];
  state.calib = [calib[0] + 1, calib[1] + day[0], calib[2] + day[1]];
}

/**
 * Records this tick's work and cost, then estimates what is left. Returns null without a pre-flight plan.
 *
 * Rows left: the pre-flight total minus the rows already read, spread over the remaining active days in the
 * plan's weekday/weekend shape. This stays right when volume grows over the range (a browser rollout), since the
 * pre-flight sampled the whole range. When the finished days show the plan is off by more than 3x, or more rows
 * were read than it expected, the measured volume of the last 7 active days is used instead.
 * Cost: seconds per request and per row measured over the last 3 ticks, and the wall-clock time those ticks
 * took (trigger gaps included).
 */
function ceraUpdateWorkEstimate_(state, work, tickStartMs, tickEndMs, cursorMs, targetEndMs, eventStreams, totalScanned) {
  // Wall time per tick includes the gap until the next trigger; the first tick has no previous one to measure from
  const workMs = tickEndMs - tickStartMs;
  const wallMs = state.lastTickEndMs
    ? Math.min(180000, Math.max(tickEndMs - Number(state.lastTickEndMs), workMs))
    : Math.max(workMs, workMs * 60000 / TIME_BUDGET_MS);
  state.lastTickEndMs = tickEndMs;
  state.requestsDone = (Number(state.requestsDone) || 0) + work.requests;
  state.recentTicks = (state.recentTicks || []).concat([{ r: work.requests, rm: work.requestMs, w: work.rows, wm: work.writeMs, wall: wallMs }]).slice(-3);

  const plan = state.plan;
  if (!plan) return null;

  const sum = key => state.recentTicks.reduce((a, t) => a + (Number(t[key]) || 0), 0);
  const secPerRequest = sum('r') > 0 ? sum('rm') / sum('r') / 1000 : 0.5;
  const secPerRow = sum('w') >= 500 ? sum('wm') / sum('w') / 1000 : LEGACY_SHEET_WRITE_SEC_PER_PAGE / 1000;
  const busyMs = sum('rm') + sum('wm');
  const wallPerBusy = busyMs > 0 ? sum('wall') / busyMs : 60000 / TIME_BUDGET_MS;

  // Rows and requests left at a given scale of the plan's per-day rows
  const DAY_MS = 86400000;
  const planned = (ev, dayStartMs) => Number((plan.perDay[ev] || [0, 0])[ceraIsWeekendMs_(dayStartMs + 43200000) ? 1 : 0]) || 0;
  const remaining = (scale, flatPerEvent) => {
    const rowsFor = (ev, dayStartMs) => (flatPerEvent !== undefined ? flatPerEvent : planned(ev, dayStartMs) * scale);
    let requests = 0;
    let rows = 0;
    if (cursorMs >= targetEndMs) return { requests: 0, rows: 0 };
    // The day in progress: what its unfinished streams still have to return
    const share = Math.min(1, (targetEndMs - cursorMs) / DAY_MS);
    const sliceEndMs = Math.min(targetEndMs, cursorMs + DAY_MS);
    if (state.sliceChecked || ceraPlanIsActive_(plan, cursorMs)) {
      TARGET_EVENTS.forEach(ev => {
        const st = eventStreams[ev] || {};
        if (st.completed) return;
        const dayRows = Number(st.dayRows) || 0;
        const plannedDayRows = rowsFor(ev, cursorMs) * share;
        let left = Math.max(0, plannedDayRows - dayRows);
        // When an active stream has already read more rows than planned for this slice, estimate what remains in the
        // slice from how far its timestamp edge has moved from sliceEndMs toward cursorMs instead of clamping to 0
        if (dayRows > 0 && dayRows >= plannedDayRows && Number(st.edgeMs) > cursorMs && Number(st.edgeMs) < sliceEndMs) {
          const coveredFrac = Math.max(0.05, (sliceEndMs - Number(st.edgeMs)) / Math.max(1, sliceEndMs - cursorMs));
          left = Math.max(0, Math.round(dayRows * (1 - coveredFrac) / coveredFrac));
        }
        rows += left;
        requests += Math.max(1, Math.ceil(left / 1000));
      });
    }
    for (let dayMs = cursorMs + DAY_MS; dayMs < targetEndMs; dayMs += DAY_MS) {
      if (!ceraPlanIsActive_(plan, dayMs)) continue;
      const dayShare = Math.min(1, (targetEndMs - dayMs) / DAY_MS);
      TARGET_EVENTS.forEach(ev => {
        const dayRows = rowsFor(ev, dayMs) * dayShare;
        rows += dayRows;
        requests += ceraPagesFor_(dayRows);
      });
    }
    requests += Math.ceil((targetEndMs - cursorMs) / (7 * DAY_MS)); // quiet-week checks
    return { requests: requests, rows: rows };
  };

  const calib = state.calib || [0, 0, 0];
  const cumRatio = calib[1] > 0 ? calib[2] / calib[1] : Infinity;
  const planTotal = Number(plan.total) || 0;
  const planIsOff = (calib[0] >= 7 && (cumRatio > 3 || cumRatio < 1 / 3)) || (planTotal > 0 && totalScanned > planTotal) ||
    (planTotal === 0 && totalScanned > 0);
  // Two views of what is left: the plan total minus the rows read (right when volume changes over the range, as
  // the plan sampled all of it) and the last 7 active days' volume (right when the plan sample was off). The plan
  // starts with full weight and hands over as finished days accumulate; it is dropped when it is clearly wrong.
  const recent = state.recentDays || [];
  const recentExpected = recent.reduce((a, d) => a + d[0], 0);
  const recentActual = recent.reduce((a, d) => a + d[1], 0);
  const measured = (recent.length >= 7 || (planIsOff && recent.length >= 1))
    ? (recentExpected > 0 ? remaining(recentActual / recentExpected) : remaining(1, recentActual / recent.length / TARGET_EVENTS.length))
    : null;
  const raw = remaining(1);
  const scale = raw.rows > 0 ? Math.max(0, planTotal - totalScanned) / raw.rows : 1;
  const anchored = !planIsOff && scale <= 3 && scale >= 1 / 3 ? remaining(scale) : null;
  const planWeight = CERA_ETA_PLAN_DAYS / (CERA_ETA_PLAN_DAYS + calib[0]);
  let left;
  if (anchored && measured) {
    left = {
      requests: planWeight * anchored.requests + (1 - planWeight) * measured.requests,
      rows: planWeight * anchored.rows + (1 - planWeight) * measured.rows
    };
  } else {
    left = anchored || measured || raw;
  }

  const remainingSec = left.requests * secPerRequest + left.rows * secPerRow;
  const doneSec = state.requestsDone * secPerRequest + totalScanned * secPerRow;
  return {
    etaSec: Math.round(remainingSec * wallPerBusy),
    pct: doneSec + remainingSec > 0 ? Math.round((doneSec / (doneSec + remainingSec)) * 1000) / 10 : 0,
    expectedEvents: Math.round(totalScanned + left.rows)
  };
}

/**
 * Localized Google Apps Script daily trigger/runtime quota messages across supported Admin Console & Google Account
 * locales (English, Japanese, Indonesian, Korean, Simplified/Traditional Chinese, Thai, Vietnamese). Matched before
 * generic strike counting so a localized quota exhaustion enters QUOTA_PAUSED (0 strikes) instead of burning 10
 * strikes into FAILED.
 */
var CERA_DAILY_QUOTA_PATTERNS = [
  // English
  'too many times',
  'total runtime',
  'quota exceeded for script total runtime',
  'exceeded maximum execution time',
  'service invoked too many times for one day',
  // Japanese (ja)
  '1 日にサービスを実行した回数が多すぎます',
  '回数が多すぎます',
  'サービスの実行回数が多すぎます',
  'スクリプトの合計実行時間',
  '最大実行時間を超えました',
  '上限を超えました',
  // Indonesian (id)
  'terlalu sering dipanggil untuk satu hari',
  'terlalu banyak kali dalam satu hari',
  'melebihi waktu eksekusi maksimum',
  'total waktu proses skrip',
  // Korean (ko)
  '하루 동안 서비스를 너무 많이 호출했습니다',
  '최대 실행 시간을 초과했습니다',
  '총 실행 시간 할당량',
  // Simplified & Traditional Chinese (zh-CN / zh-TW)
  '一天内调用服务的次数过多',
  '已超过最长执行时间',
  '脚本总运行时间',
  '一天內呼叫服務的次數過多',
  '一天內叫用服務的次數過多',
  '已超過最長執行時間',
  // Thai & Vietnamese (th / vi)
  'เรียกใช้บริการมากเกินไปในหนึ่งวัน',
  'เกินเวลาดำเนินการสูงสุด',
  'được gọi quá nhiều lần trong một ngày',
  'quá nhiều lần trong một ngày',
  'vượt quá thời gian thực thi tối đa'
];

function ceraIsDailyQuotaError_(message) {
  const m = String(message || '').toLowerCase();
  if (!m) return false;
  for (let i = 0; i < CERA_DAILY_QUOTA_PATTERNS.length; i++) {
    if (m.includes(CERA_DAILY_QUOTA_PATTERNS[i].toLowerCase())) return true;
  }
  return false;
}

/**
 * Rate limits and quotas: HTTP 429, or a 403 for rateLimitExceeded, userRateLimitExceeded or a quota. They clear
 * with time, so they are retried with backoff (and end a tick as QUOTA_PAUSED), never treated as a permission error.
 */
function ceraIsRateLimitError_(message) {
  const m = String(message || '').toLowerCase();
  return m.includes('429') || m.includes('limitexceeded') || m.includes('limit exceeded') || m.includes('rate limit') ||
    m.includes('user rate') || m.includes('quota') || m.includes('too many requests') || m.includes('resource_exhausted');
}

/**
 * Permission errors (401, or a 403 that is not a rate limit): retrying cannot fix them.
 */
function ceraIsPermissionError_(message) {
  const m = String(message || '').toLowerCase();
  return !ceraIsRateLimitError_(m) && (m.includes('401') || m.includes('403') || m.includes('permission') ||
    m.includes('forbidden') || m.includes('not authorized') || m.includes('unauthorized'));
}

/**
 * Fetch page from Google Admin SDK Reports API. Always passes startTime and endTime alongside pageToken so the
 * Reports API stays bounded to the requested slice window on page 2+.
 */
function fetchChromeLogPage(pageToken, startTimeIso, currentLogTimestampMs, eventName, maxResults, endTimeIso) {
  const options = {
    userKey: 'all',
    applicationName: 'chrome',
    maxResults: maxResults || 1000,
    eventName: eventName || 'CONTENT_TRANSFER'
  };

  if (endTimeIso) {
    options.endTime = endTimeIso;
  } else if (currentLogTimestampMs) {
    options.endTime = new Date(currentLogTimestampMs).toISOString();
  }
  if (startTimeIso) {
    options.startTime = startTimeIso;
  }
  if (pageToken) {
    options.pageToken = pageToken;
  }

  const maxAttempts = 5;
  let delayMs = 1500;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return AdminReports.Activities.list('all', 'chrome', options);
    } catch (e) {
      const errMsg = (e.message || String(e)).toLowerCase();
      // Checked first: a rate limit can come as a 403, and it clears with time
      const isRateLimit = ceraIsRateLimitError_(errMsg);
      const isFatal = !isRateLimit && (errMsg.includes('400') || errMsg.includes('pagetoken') || errMsg.includes('404') || errMsg.includes('403'));

      if (attempt < maxAttempts && !isFatal) {
        const jitter = Math.floor(Math.random() * 800);
        const waitMs = (isRateLimit ? Math.max(delayMs, 3000) : delayMs) + jitter;
        console.warn(`AdminReports.Activities.list attempt ${attempt}/${maxAttempts} (${errMsg}). Waiting ${waitMs}ms...`);
        Utilities.sleep(waitMs);
        delayMs = Math.min(delayMs * 2, 12000);
      } else {
        throw e;
      }
    }
  }
}

/**
 * Dynamic parameter extractor for Google Admin SDK Reports API ('chrome' application)
 * Handles 'chrome.' prefixes, nested multiMessageValue/messageValue, and multi-detectors
 */
function extractAdminSdkParameters(params) {
  const res = {
    eventReason: '',
    eventResult: '',
    detectors: [],
    orgUnitName: '',
    profileUser: '',
    deviceUser: '',
    contentName: '',
    contentSize: '',
    contentType: '',
    triggerType: '',
    webAppAccount: '',
    url: '',
    tabUrl: '',
    urlCategory: '',
    threatType: '',
    deviceName: '',
    clientType: '',
    // Command-line switches of a browser launch, one entry per switch as the event lists them
    switches: []
  };

  if (!params || !Array.isArray(params)) return res;

  const addDetectors = (val) => {
    if (!val) return;
    const parts = String(val).split(',').map(s => s.trim()).filter(Boolean);
    parts.forEach(d => {
      if (!res.detectors.includes(d)) res.detectors.push(d);
    });
  };

  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    if (!p || !p.name) continue;

    const rawName = p.name.toUpperCase();
    const cleanName = rawName.replace(/^CHROME\./, '');

    // Extract value
    let val = '';
    if (p.value !== undefined && p.value !== null) {
      val = String(p.value);
    } else if (p.intValue !== undefined) {
      val = String(p.intValue);
    } else if (p.boolValue !== undefined) {
      val = String(p.boolValue);
    } else if (p.multiValue && Array.isArray(p.multiValue)) {
      val = p.multiValue.join(', ');
    }

    // 1. Matched Detectors (supports single value, multiValue, or nested messageValue)
    if (cleanName.includes('MATCHED_DETECTORS') || cleanName.includes('DETECTOR') || cleanName === 'RULE_NAME') {
      if (val) addDetectors(val);
      if (p.multiMessageValue && Array.isArray(p.multiMessageValue)) {
        p.multiMessageValue.forEach(msg => {
          if (msg && msg.parameter) {
            msg.parameter.forEach(subP => {
              const subName = (subP.name || '').toUpperCase();
              if ((subName.includes('DETECTOR') || subName.includes('NAME')) && subP.value) {
                addDetectors(subP.value);
              }
            });
          }
        });
      }
      if (p.messageValue && p.messageValue.parameter) {
        p.messageValue.parameter.forEach(subP => {
          const subName = (subP.name || '').toUpperCase();
          if ((subName.includes('DETECTOR') || subName.includes('NAME')) && subP.value) {
            addDetectors(subP.value);
          }
        });
      }
      continue;
    }

    // 2. Event Reason
    if (cleanName === 'EVENT_REASON' || cleanName === 'REASON' || cleanName.endsWith('.EVENT_REASON')) {
      if (val) res.eventReason = val;
    }
    // 3. URLs
    else if (cleanName === 'URL' || cleanName === 'TARGET_URL' || cleanName === 'DESTINATION_URL') {
      if (val) res.url = val;
    } else if (cleanName === 'TAB_URL' || cleanName === 'SOURCE_URL') {
      if (val) res.tabUrl = val;
    }
    // 4. Organizational Unit
    else if (cleanName.includes('ORGANIZATIONAL_UNIT') || cleanName.includes('ORG_UNIT') || cleanName === 'OU') {
      if (val) res.orgUnitName = val;
    }
    // 5. User Profile (the profile's Workspace user), then the device user (ChromeOS or OS account)
    else if (cleanName === 'PROFILE_USER_NAME' || cleanName === 'PROFILE_USER' || cleanName === 'USER' || cleanName === 'USER_EMAIL') {
      if (val) res.profileUser = val;
    } else if (cleanName === 'DEVICE_USER') {
      if (val) res.deviceUser = val;
    }
    // 6. Content Size
    else if (cleanName === 'CONTENT_SIZE' || cleanName === 'FILE_SIZE') {
      if (val) res.contentSize = val;
    }
    // 7. Content Type
    else if (cleanName === 'CONTENT_TYPE' || cleanName === 'FILE_TYPE' || cleanName === 'MIME_TYPE') {
      if (val) res.contentType = val;
    }
    // 8. Trigger Type
    else if (cleanName === 'TRIGGER_TYPE') {
      if (val) res.triggerType = val;
    }
    // 9. Web App Signed In Account
    else if (cleanName === 'WEB_APP_SIGNED_IN_ACCOUNT' || cleanName === 'SIGNED_IN_ACCOUNT') {
      if (val) res.webAppAccount = val;
    }
    // 10. URL Category
    else if (cleanName === 'LOCALIZED_URL_CATEGORY') {
      if (val) res.urlCategory = typeof normalizeUrlCategory === 'function' ? normalizeUrlCategory(val) : val;
    } else if (cleanName === 'URL_CATEGORY' || cleanName === 'CONTENT_CATEGORY' || cleanName === 'CATEGORY') {
      if (val && !res.urlCategory) {
        res.urlCategory = typeof normalizeUrlCategory === 'function' ? normalizeUrlCategory(val) : val;
      }
    }
    // 11. Threat Type
    else if (cleanName === 'THREAT_TYPE' || cleanName === 'THREAT' || cleanName === 'UNSAFE_SITE_REASON') {
      if (val) res.threatType = val;
      if (!res.eventReason && val) res.eventReason = val;
    }
    // 12. Event Result: ALLOWED, BLOCKED, BYPASSED, DETECTED, REPORTED or WARNED, sometimes as EVENT_RESULT_BLOCKED
    else if (cleanName === 'EVENT_RESULT') {
      if (val) res.eventResult = val.trim().toUpperCase().replace(/^EVENT_RESULT_/, '');
    }
    // 13. Content Name (file name)
    else if (cleanName === 'CONTENT_NAME') {
      if (val) res.contentName = val;
    }
    // 14. Device and client type (CHROME_BROWSER or CHROME_PROFILE), and the switches of a browser launch: a
    // multiValue list, kept as a list because a switch value can hold commas (enable-features=A,B)
    else if (cleanName === 'DEVICE_NAME') {
      if (val) res.deviceName = val;
    } else if (cleanName === 'CLIENT_TYPE') {
      if (val) res.clientType = val;
    } else if (cleanName === 'COMMAND_LINE_SWITCHES') {
      if (Array.isArray(p.multiValue)) res.switches = p.multiValue.map(s => String(s).trim()).filter(Boolean);
      else if (val) res.switches = [val.trim()];
    }
  }

  return res;
}

/**
 * Parse Admin SDK activity event into a partition row (PARTITION_HEADERS)
 */
function parseEventToRow(event, queryEventName) {
  const time = event.id ? event.id.time : '';
  const actorEmail = (event.actor && event.actor.email) || '';

  let eventDisplayName = EVENT_DISPLAY_NAMES[queryEventName] || (event.events && event.events[0] && event.events[0].name) || 'Content transfer';
  // The OU stays empty when the event has none (ownerDomain is the customer's domain, not an OU)
  let eventReason = '', detectorName = '', orgUnitName = '', profileUser = actorEmail;
  let contentSize = '', contentType = '', triggerType = '', webAppAccount = '', url = '', tabUrl = '', urlCategory = '';
  let eventResult = '', contentName = '', deviceName = '', clientType = '', switches = [];

  if (event.events && event.events.length > 0) {
    const rawName = event.events[0].name;
    if (rawName && EVENT_DISPLAY_NAMES[rawName]) {
      eventDisplayName = EVENT_DISPLAY_NAMES[rawName];
    }

    const parsed = extractAdminSdkParameters(event.events[0].parameters);
    if (parsed.eventReason) eventReason = parsed.eventReason;
    if (parsed.detectors.length > 0) detectorName = parsed.detectors.join(', ');
    if (parsed.orgUnitName) orgUnitName = parsed.orgUnitName;
    // Events without an actor email (unsigned profiles, ChromeOS devices) name the user in their parameters
    if (!profileUser) profileUser = parsed.profileUser || parsed.deviceUser;
    if (parsed.contentSize) contentSize = parsed.contentSize;
    if (parsed.contentType) contentType = parsed.contentType;
    if (parsed.triggerType) triggerType = parsed.triggerType;
    if (parsed.webAppAccount) webAppAccount = parsed.webAppAccount;
    if (parsed.url) url = parsed.url;
    if (parsed.tabUrl) tabUrl = parsed.tabUrl;
    if (parsed.urlCategory) urlCategory = parsed.urlCategory;
    if (!eventReason && parsed.threatType) eventReason = parsed.threatType;
    eventResult = parsed.eventResult;
    contentName = parsed.contentName;
    deviceName = parsed.deviceName;
    clientType = parsed.clientType;
    switches = parsed.switches;
  }

  // If tabUrl exists but url is empty, default url to tabUrl
  if (!url && tabUrl) url = tabUrl;
  if (!tabUrl && url) tabUrl = url;

  // Sensible defaults based on event type if parameters were omitted
  if (queryEventName === 'PASSWORD_REUSE') {
    if (!triggerType) triggerType = 'Password entry';
    if (!contentSize) contentSize = '0';
    if (!contentType) contentType = 'text/plain';
  } else if (queryEventName === 'MALWARE_TRANSFER') {
    if (!triggerType) triggerType = 'File download';
  } else if (queryEventName === 'SENSITIVE_DATA_TRANSFER') {
    if (!eventReason) eventReason = 'CONTENT_MATCHED_SENSITIVE_DATA_TYPES';
  } else if (queryEventName === 'CONTENT_UNSCANNED') {
    if (!triggerType) triggerType = 'File transfer';
  } else if (queryEventName === 'UNSAFE_SITE_VISIT') {
    if (!triggerType) triggerType = 'Unsafe site visit';
    if (!eventReason) eventReason = 'SECURITY_THREAT_VISIT';
    if (!urlCategory) urlCategory = 'Security Risk / Malware';
    if (!contentSize) contentSize = '0';
    if (!contentType) contentType = 'text/html';
  }

  return [
    time,
    eventDisplayName,
    eventReason,
    detectorName,
    orgUnitName,
    profileUser,
    contentSize,
    contentType,
    triggerType,
    webAppAccount,
    url,
    tabUrl,
    urlCategory || 'Uncategorized',
    eventResult,
    contentName,
    deviceName,
    clientType,
    // One switch per line: a switch value can hold commas, never a line break
    switches.join('\n')
  ];
}

/**
 * Creates partition spreadsheet file inside target Drive folder (PARTITION_HEADERS, one grid column each)
 */
function createTargetSheetFile(folderId, startStr, endStr, index) {
  const fileName = `chrome_security_logs_${startStr}_to_${endStr}_part_${String(index).padStart(3, '0')}`;
  // Created in the job folder through the Drive API: CERA created the folder, so drive.file covers creating in it,
  // and nothing has to be moved afterwards
  const resource = { name: fileName, mimeType: 'application/vnd.google-apps.spreadsheet', parents: [folderId] };

  let newFile = null;
  const maxAttempts = 5;
  let delayMs = 1500;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      newFile = Drive.Files.create(resource);
      break;
    } catch (e) {
      if (attempt < maxAttempts) {
        console.warn(`Drive.Files.create retry attempt ${attempt}/${maxAttempts}: ${e.message}`);
        Utilities.sleep(delayMs);
        delayMs *= 2;
      } else {
        throw e;
      }
    }
  }

  const fileId = newFile.id;
  // The new spreadsheet has one sheet (sheetId 0) titled in the user's language: name it Sheet1, where the appends
  // write, with a grid of one row and one column per header. Retried like the creation, so a transient error does not
  // fail the run and leave an unnamed partition behind.
  const sheetSetup = {
    requests: [{
      updateSheetProperties: {
        properties: { sheetId: 0, title: 'Sheet1', gridProperties: { rowCount: 1, columnCount: PARTITION_HEADERS.length } },
        fields: 'title,gridProperties.rowCount,gridProperties.columnCount'
      }
    }]
  };
  delayMs = 1500;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      Sheets.Spreadsheets.batchUpdate(sheetSetup, fileId);
      break;
    } catch (e) {
      if (attempt < maxAttempts) {
        console.warn(`Sheets.Spreadsheets.batchUpdate retry attempt ${attempt}/${maxAttempts}: ${e.message}`);
        Utilities.sleep(delayMs);
        delayMs *= 2;
      } else {
        throw e;
      }
    }
  }

  flushBufferWithRetry(fileId, [PARTITION_HEADERS.slice()]);

  return { fileId: fileId, fileName: fileName };
}

/**
 * Flush Buffer with Adaptive Binary Splitting and Exponential Backoff Retry
 * Resilient against: Empty response, 503, 500, 502, 504, 429, Quota, Rate Limit, Socket/Network hiccups
 * Uses valueInputOption: 'RAW' to bypass server formula evaluation (10x-15x faster and zero gateway timeouts)
 * progress.written (optional) counts the rows appended so far, in order, so a caller knows how far a split
 * batch got when a later half fails
 */
function flushBufferWithRetry(fileId, dataRows, depth, progress) {
  if (!dataRows || dataRows.length === 0) return 0;
  depth = depth || 0;

  // Sanitize values to prevent cell overflow (>10,000 chars) or binary artifacts
  const sanitizedRows = dataRows.map(row => {
    if (!Array.isArray(row)) return row;
    return row.map(cell => {
      if (typeof cell === 'string' && cell.length > 10000) {
        return cell.slice(0, 10000) + '...[TRUNCATED]';
      }
      return cell;
    });
  });

  const resource = { values: sanitizedRows };
  const maxAttempts = 5;
  let delayMs = 1200;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      Sheets.Spreadsheets.Values.append(
        resource,
        fileId,
        'Sheet1!A1',
        { valueInputOption: 'RAW' } // ⚡ RAW mode: skips formula & type parsing, 10x faster & zero timeout
      );
      if (progress) progress.written += sanitizedRows.length;
      return sanitizedRows.length;
    } catch (e) {
      const errMsg = (e.message || String(e)).toLowerCase();
      // Checked first: a rate limit or quota can come as a 403, and it clears with time
      const isRateLimit = ceraIsRateLimitError_(errMsg);
      const isFatal = !isRateLimit && (errMsg.includes('404') || errMsg.includes('not found') ||
                      errMsg.includes('403') || errMsg.includes('permission') ||
                      errMsg.includes('disabled'));

      if (isFatal) {
        throw e;
      }

      // If error suggests payload/timeout/gateway drop (such as 'empty response', 'timeout', 'payload', '503', '502', '500')
      // AND we have more than 50 rows, adaptively split the batch in half! (Not on a rate limit: more requests only
      // make it worse.)
      const isGatewayOrSizeChoke = !isRateLimit && (errMsg.includes('empty response') || errMsg.includes('timed out') ||
                                  errMsg.includes('timeout') || errMsg.includes('exceeded') ||
                                  errMsg.includes('500') || errMsg.includes('502') || errMsg.includes('503') ||
                                  errMsg.includes('socket'));

      if (isGatewayOrSizeChoke && sanitizedRows.length > 50 && depth < 5) {
        if (progress) progress.splits = (progress.splits || 0) + 1;
        console.warn(`[Adaptive Chunking] Batch of ${sanitizedRows.length} rows encountered "${e.message || errMsg}". Splitting into halves at depth ${depth + 1}...`);
        const mid = Math.floor(sanitizedRows.length / 2);
        const part1 = sanitizedRows.slice(0, mid);
        const part2 = sanitizedRows.slice(mid);
        const written1 = flushBufferWithRetry(fileId, part1, depth + 1, progress);
        const written2 = flushBufferWithRetry(fileId, part2, depth + 1, progress);
        return written1 + written2;
      }

      if (attempt < maxAttempts) {
        const jitter = Math.floor(Math.random() * 500);
        const waitMs = (isRateLimit ? Math.max(delayMs, 5000) : delayMs) + jitter;
        console.warn(`Sheets append notice (${e.message || errMsg}). Retrying attempt ${attempt}/${maxAttempts} in ${waitMs}ms...`);
        Utilities.sleep(waitMs);
        delayMs = Math.min(delayMs * 2, 10000);
      } else {
        // Last resort: if still multiple rows, attempt emergency halving before failing
        if (!isRateLimit && sanitizedRows.length > 20 && depth < 5) {
          if (progress) progress.splits = (progress.splits || 0) + 1;
          console.warn(`[Adaptive Chunking Emergency] Max attempts reached for ${sanitizedRows.length} rows. Attempting final halving...`);
          const mid = Math.floor(sanitizedRows.length / 2);
          const part1 = sanitizedRows.slice(0, mid);
          const part2 = sanitizedRows.slice(mid);
          const written1 = flushBufferWithRetry(fileId, part1, depth + 1, progress);
          const written2 = flushBufferWithRetry(fileId, part2, depth + 1, progress);
          return written1 + written2;
        }
        throw e;
      }
    }
  }
  return 0;
}

// ==============================================================================
/**
 * Safely updates Ingestion Monitor Sheet with error isolation boundary
 * Ensures dashboard/UI formatting glitches never crash the core ingestion worker
 */
function safeUpdateDashboard(ss, state, partitions) {
  try {
    let viewState = state;
    if (state && !state.logFolderUrl && state.folderId) {
      const diagMeta = ceraGetDiagLogMeta_(state.folderId);
      if (diagMeta && diagMeta.logFolderUrl) {
        viewState = Object.assign({}, state, { logFolderUrl: diagMeta.logFolderUrl });
      }
    }
    IngestionMonitorSheet.updateDashboard(ss, viewState, partitions);
  } catch (mErr) {
    console.warn('IngestionMonitorSheet.updateDashboard non-fatal notice: ' + (mErr.message || mErr));
  }
}

// A DocumentProperties value holds at most 9,216 bytes (UTF-8); the session stays below that with room to spare
const CERA_STATE_MAX_BYTES = 9000;
// Raw error text kept in the session; the full text stays in the execution log
const CERA_ERROR_MESSAGE_MAX_CHARS = 500;

/**
 * Saves state checkpoint to DocumentProperties and ScriptCache
 * A session over the size limit cannot be saved, and the job would resume from an older checkpoint on every tick.
 * Optional history goes first: older partitions in the monitor's registry (the files stay in the folder), then the
 * ETA's recent ticks and days, then the pre-flight plan (progress and ETA then follow calendar coverage). A session
 * that still does not fit stops the job with an explicit error.
 */
function saveStateToStorage(state) {
  if (!state) return;
  try {
    if (state.errorMessage && String(state.errorMessage).length > CERA_ERROR_MESSAGE_MAX_CHARS) {
      state.errorMessage = String(state.errorMessage).slice(0, CERA_ERROR_MESSAGE_MAX_CHARS - 1) + '…';
    }
    if (state.partitions && state.partitions.length > 10) {
      state.partitions = state.partitions.slice(-10);
    }
    // Seven streams paging at once with long page tokens and full edges come within a few hundred bytes of the limit
    const optional = [
      s => { if (s.partitions && s.partitions.length > 3) s.partitions = s.partitions.slice(-3); },
      s => { delete s.recentTicks; },
      s => { delete s.recentDays; },
      s => { if (s.partitions && s.partitions.length > 1) s.partitions = s.partitions.slice(-1); },
      s => { delete s.plan; delete s.expectedEvents; }
    ];
    let raw = JSON.stringify(state);
    for (let i = 0; i < optional.length && ceraUtf8Bytes_(raw) > CERA_STATE_MAX_BYTES; i++) {
      optional[i](state);
      raw = JSON.stringify(state);
    }
    if (ceraUtf8Bytes_(raw) > CERA_STATE_MAX_BYTES) {
      raw = ceraOversizeSession_(state);
    }

    PropertiesService.getDocumentProperties().setProperty('SIERRA_SESSION', raw);
    // Short 3s TTL in ScriptCache (shared across triggers & sessions)
    try {
      CacheService.getScriptCache().put('SIERRA_LIVE_PROGRESS', raw, 3);
    } catch (cErr) {}
  } catch (e) {
    console.warn('saveStateToStorage notice: ' + e.message);
  }
}

/**
 * A session too big to save even without its optional history: the job stops with an explicit error. Unusually
 * long page tokens are what can make it this big, so they are dropped; each stream then resumes right after the
 * last event it took (its edge). Returns the session to store.
 */
function ceraOversizeSession_(state) {
  console.error('Ingestion state does not fit in a document property; stopping the job.');
  cleanupAllIngestionTriggers();
  state.status = 'FAILED';
  state.errorKey = 'mon.err.stateTooLarge';
  state.errorMessage = ceraT('mon.err.stateTooLarge');
  Object.keys(state.eventStreams || {}).forEach(ev => {
    if (state.eventStreams[ev]) state.eventStreams[ev].pageToken = null;
  });
  let raw = JSON.stringify(state);
  if (ceraUtf8Bytes_(raw) > CERA_STATE_MAX_BYTES) {
    // Still too big: keep what the dialog and the monitor show, and where the job was
    const minimal = {};
    ['activityId', 'status', 'errorKey', 'errorMessage', 'processedCount', 'scannedCount', 'timeSpanPct', 'currentDay',
      'dateRangeDays', 'totalDays', 'startStr', 'endStr', 'startDateStr', 'currentLogDateStr', 'windowStartMs',
      'targetEndMs', 'currentCursorMs', 'folderId', 'folderName', 'folderUrl', 'fileIndex', 'currentFileName',
      'currentFileId', 'currentSheetRows', 'primaryDomain'].forEach(k => {
      if (state[k] !== undefined) minimal[k] = state[k];
    });
    raw = JSON.stringify(minimal);
  }
  return raw;
}

/**
 * UTF-8 size of a string, which is what the property value limit counts.
 */
function ceraUtf8Bytes_(text) {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    // A character outside the BMP is two surrogates of 2 bytes each (4 in UTF-8)
    bytes += c < 0x80 ? 1 : (c < 0x800 || (c >= 0xD800 && c <= 0xDFFF)) ? 2 : 3;
  }
  return bytes;
}

/**
 * Retrieves progress checkpoint from DocumentProperties or ScriptCache
 */
function getProgressUpdate() {
  // 1. Authoritative: DocumentProperties (Shared across triggers & browser sessions)
  try {
    const saved = PropertiesService.getDocumentProperties().getProperty('SIERRA_SESSION');
    if (saved) return JSON.parse(saved);
  } catch (e) {}

  // 2. Fallback: ScriptCache
  try {
    const cached = CacheService.getScriptCache().get('SIERRA_LIVE_PROGRESS');
    if (cached) return JSON.parse(cached);
  } catch (e) {}

  return {
    status: 'IDLE',
    processedCount: 0,
    timeSpanPct: 0,
    currentFileName: '',
    folderId: '',
    folderName: ''
  };
}

/**
 * Status of the stored session as other executions left it (pause and reset do not wait for the worker's lock).
 * 'GONE' when the job was reset or replaced by a new one, '' when the session cannot be read.
 */
function ceraStoredJobStatus_(activityId) {
  let raw = null;
  try {
    raw = PropertiesService.getDocumentProperties().getProperty('SIERRA_SESSION');
  } catch (e) {
    return '';
  }
  if (!raw) return 'GONE';
  try {
    const stored = JSON.parse(raw);
    if (!stored || stored.status === 'IDLE' || (activityId && stored.activityId && stored.activityId !== activityId)) return 'GONE';
    return String(stored.status || '');
  } catch (e) {
    return '';
  }
}

/**
 * Detects existing session state for modal consumption (Bulletproof sync with Ingestion Monitor)
 */
function detectExistingSession() {
  let state = getProgressUpdate();

  // Bulletproof sync: Cross-check with '⚡ Ingestion Monitor' dashboard sheet
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) {
      const monitorSheet = ss.getSheetByName('⚡ Ingestion Monitor');
      if (monitorSheet) {
        const a2Val = String(monitorSheet.getRange('A2').getValue() || '').trim();
        const a3Val = String(monitorSheet.getRange('A3').getValue() || '').trim();
        const statusVal = (a2Val.includes('COMPLETED') || a2Val.includes('READY FOR CERA')) ? a2Val : a3Val;

        if (statusVal.includes('COMPLETED') || statusVal.includes('READY FOR CERA ANALYSIS')) {
          if (!state || state.status !== 'COMPLETED') {
            if (!state) state = {};
            state.status = 'COMPLETED';
            state.timeSpanPct = 100;
            state.isCompleted = true;

            // Sync total logs from cell A5 (or legacy A6, e.g. "966 Events")
            const a5Val = String(monitorSheet.getRange('A5').getValue() || '');
            const a6Val = String(monitorSheet.getRange('A6').getValue() || '');
            const logsStr = a5Val.match(/([\d,]+)/) ? a5Val : a6Val;
            const matchLogs = logsStr.match(/([\d,]+)/);
            if (matchLogs) {
              const parsedLogs = parseInt(matchLogs[1].replace(/,/g, ''), 10);
              if (!isNaN(parsedLogs) && parsedLogs > (state.processedCount || 0)) {
                state.processedCount = parsedLogs;
              }
            }

            // Sync target folder URL and ID from cell E6 (or legacy E7) formula
            const e6Formula = String(monitorSheet.getRange('E6').getFormula() || '');
            const e7Formula = String(monitorSheet.getRange('E7').getFormula() || '');
            const formulaStr = e6Formula.includes('HYPERLINK') ? e6Formula : e7Formula;
            const matchUrl = formulaStr.match(/HYPERLINK\("([^"]+)"/i);
            if (matchUrl && matchUrl[1]) {
              state.folderUrl = matchUrl[1];
              const matchFldId = matchUrl[1].match(/folders\/([-\w]+)/);
              if (matchFldId) state.folderId = matchFldId[1];
            }

            // Sync target folder name from cell E6 (or legacy E7) value if plain text
            if (!state.folderName) {
              const e6Val = String(monitorSheet.getRange('E6').getValue() || '');
              const e7Val = String(monitorSheet.getRange('E7').getValue() || '');
              const fldStr = e6Val.includes('Folder: ') ? e6Val : e7Val;
              if (fldStr.includes('Folder: ')) {
                state.folderName = fldStr.replace('Folder: ', '').trim();
              }
            }

            // Resave authoritative completed state and bust stale caches
            try {
              PropertiesService.getDocumentProperties().setProperty('SIERRA_SESSION', JSON.stringify(state));
              CacheService.getScriptCache().remove('SIERRA_LIVE_PROGRESS');
              CacheService.getUserCache().remove('SIERRA_LIVE_PROGRESS');
            } catch (pErr) {}
          }
        }
      } else {
        // TAB DELETED BY USER:
        // If the '⚡ Ingestion Monitor' sheet tab was deleted from the spreadsheet,
        // treat this as an explicit reset signal: wipe SIERRA_SESSION, cleanup background triggers, and start from 0.
        if (state && state.status && state.status !== 'IDLE') {
          Logger.log("'⚡ Ingestion Monitor' sheet tab was deleted. Automatically wiping SIERRA_SESSION to start from 0...");
          try {
            cleanupAllIngestionTriggers();
            PropertiesService.getDocumentProperties().deleteProperty('SIERRA_SESSION');
            PropertiesService.getDocumentProperties().deleteProperty('CERA_ANALYSIS_EXECUTED');
            CacheService.getScriptCache().remove('SIERRA_LIVE_PROGRESS');
            CacheService.getUserCache().remove('SIERRA_LIVE_PROGRESS');
            const lock = LockService.getScriptLock();
            try { lock.releaseLock(); } catch (lErr) {}
          } catch (delErr) {
            console.warn('Session wipe notice: ' + delErr.message);
          }
          state = null;
        }
      }
    }
  } catch (sheetSyncErr) {
    console.warn('Dashboard sheet sync notice: ' + sheetSyncErr.message);
  }

  if (state && (state.folderId || (state.status === 'COMPLETED')) && state.status && state.status !== 'IDLE') {
    const diagMeta = ceraGetDiagLogMeta_(state.folderId);
    return {
      hasExisting: true,
      status: state.status,
      isCompleted: (state.status === 'COMPLETED'),
      totalLogsProcessed: state.processedCount || 0,
      timeSpanPct: state.status === 'COMPLETED' ? 100 : (state.timeSpanPct || 0),
      currentDay: state.currentDay || 1,
      totalDays: state.dateRangeDays || state.totalDays || CERA_DEFAULT_RANGE_DAYS,
      currentLogDateStr: state.currentLogDateStr || '',
      folderId: state.folderId || '',
      folderName: state.folderName || 'Extracted Chrome Logs Folder',
      folderUrl: state.folderUrl || (state.folderId ? `https://drive.google.com/drive/folders/${state.folderId}` : ''),
      logFolderId: (diagMeta && diagMeta.logFolderId) || '',
      logFolderUrl: (diagMeta && diagMeta.logFolderUrl) || '',
      logFileId: (diagMeta && diagMeta.logFileId) || '',
      fileIndex: state.fileIndex || 1,
      rate: state.processingRate || state.rate || 0,
      etaSec: state.status === 'COMPLETED' ? 0 : (state.etaSec || 0),
      expectedEvents: state.expectedEvents || 0,
      errorMessage: state.errorMessage || '',
      errorKey: state.errorKey || '',
      partitions: state.partitions || [],
      eventStreams: state.eventStreams || null
    };
  }
  return { hasExisting: false, status: 'IDLE' };
}

// ==============================================================================
// 5. DIRECT INGESTION DIAGNOSTIC LOGGER (logs/cera-diagnostic-log.txt)
// ==============================================================================

const CERA_DIAG_LOG_MAX_BYTES = (typeof CeraConfig !== 'undefined' && CeraConfig.DIAG_LOG_MAX_BYTES) ? CeraConfig.DIAG_LOG_MAX_BYTES : 1000000;
const CERA_DIAG_LOG_SOFT_BYTES = Math.floor(CERA_DIAG_LOG_MAX_BYTES * 0.94);

/**
 * Retrieves the Drive IDs/URLs of the `logs/` subfolder and `cera-diagnostic-log.txt` for a Direct Ingestion job folder.
 * Stored in its own DocumentProperties key (`CERA_DIAG_LOG_META`) so `SIERRA_SESSION` stays well under its 9,216-byte limit.
 */
function ceraGetDiagLogMeta_(folderId) {
  try {
    const raw = PropertiesService.getDocumentProperties().getProperty('CERA_DIAG_LOG_META');
    if (!raw) return null;
    const meta = JSON.parse(raw);
    if (!meta || (folderId && meta.folderId && meta.folderId !== folderId)) return null;
    return meta;
  } catch (e) {
    return null;
  }
}

/**
 * Redacts emails, URLs, domains, file names, and long identifiers from any diagnostic or error message string
 * to guarantee 100% Zero-PII & Zero-Sensitive-Data in `cera-diagnostic-log.txt`.
 */
function ceraSanitizeDiagnosticText_(text) {
  if (!text) return '';
  let s = String(text);
  // Redact email addresses
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]');
  // Redact http/https/chrome/file URLs
  s = s.replace(/\b(?:https?|chrome|chrome-extension|file|ftp):\/\/[^\s"'<>)]+/gi, '[REDACTED_URL]');
  // Redact quoted strings (could hold file names, tab titles, or user strings) other than standard Sheet1/Raw Data ranges
  s = s.replace(/"([^"]{1,200})"/g, (m, inner) => {
    if (/^(Sheet1|Raw Data)(![A-Z0-9:]+)?$/i.test(inner)) return m;
    return '"[REDACTED]"';
  });
  // Redact domain-like tokens (excluding standard Google API/Apps Script service tokens)
  s = s.replace(/\b([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|org|net|edu|gov|mil|io|co|ai|app|dev|id|sg|ph|my|th|vn|jp|kr|cn|uk|de|fr|au|in|br|ca|info|biz|me|tv|xyz)\b/gi, m => {
    const lower = m.toLowerCase();
    if (lower === 'googleapis.com' || lower === 'google.com' || lower === 'script.google.com') return m;
    return '[REDACTED_DOMAIN]';
  });
  if (s.length > 320) s = s.slice(0, 317) + '...';
  return s;
}

/**
 * Increments non-empty field presence counters for an extracted Chrome event row (18-column schema).
 * Tracks only integer counts — never stores cell values.
 */
function ceraRecordDiagRowSchema_(schemaMap, evName, row) {
  if (!schemaMap || !evName || !Array.isArray(row)) return;
  if (!schemaMap[evName]) {
    schemaMap[evName] = {
      rows: 0,
      hasUrl: 0,
      hasTabUrl: 0,
      hasContentName: 0,
      hasContentSize: 0,
      hasWebAppAccount: 0,
      hasProfileUser: 0,
      hasDetectorName: 0,
      hasOrgUnit: 0,
      hasDeviceName: 0,
      hasClientType: 0,
      hasCmdSwitches: 0
    };
  }
  const st = schemaMap[evName];
  st.rows++;
  if (row[3]) st.hasDetectorName++;
  if (row[4]) st.hasOrgUnit++;
  if (row[5]) st.hasProfileUser++;
  if (row[6] !== '' && row[6] !== null && row[6] !== undefined) st.hasContentSize++;
  if (row[9]) st.hasWebAppAccount++;
  if (row[10]) st.hasUrl++;
  if (row[11]) st.hasTabUrl++;
  if (row[14]) st.hasContentName++;
  if (row[15]) st.hasDeviceName++;
  if (row[16]) st.hasClientType++;
  if (row[17]) st.hasCmdSwitches++;
}

/**
 * Initializes the `logs/` subfolder and `logs/cera-diagnostic-log.txt` file inside the Direct Ingestion Drive folder.
 * Non-fatal: any Drive error is logged as a warning and never blocks ingestion.
 */
function ceraInitDiagnosticLog_(initialState, firstPartition) {
  if (!initialState || !initialState.folderId) return null;
  try {
    const logFolderName = (typeof CeraConfig !== 'undefined' && CeraConfig.DIAG_LOG_FOLDER_NAME) ? CeraConfig.DIAG_LOG_FOLDER_NAME : 'logs';
    const logFileName = (typeof CeraConfig !== 'undefined' && CeraConfig.DIAG_LOG_FILE_NAME) ? CeraConfig.DIAG_LOG_FILE_NAME : 'cera-diagnostic-log.txt';

    const logFolder = Drive.Files.create({
      name: logFolderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [initialState.folderId]
    }, null, { supportsAllDrives: true });
    const logFolderId = logFolder.id;
    const logFolderUrl = `https://drive.google.com/drive/folders/${logFolderId}`;

    let tz = 'UTC';
    try { tz = Session.getScriptTimeZone() || 'UTC'; } catch (e) {}

    let policyPrecheck = null;
    let preflight = null;
    try {
      const docProps = PropertiesService.getDocumentProperties();
      const rawPol = docProps.getProperty('CERA_LAST_POLICY_PRECHECK');
      if (rawPol) policyPrecheck = JSON.parse(rawPol);
      const rawPre = docProps.getProperty('CERA_LAST_PREFLIGHT_DIAG');
      if (rawPre) preflight = JSON.parse(rawPre);
    } catch (pErr) {}

    const streamDiagnostics = {};
    TARGET_EVENTS.forEach(ev => {
      streamDiagnostics[ev] = {
        rowsWritten: 0,
        pagesFetched: 0,
        tokenFallbacks: 0,
        completedSlices: 0,
        schemaPresence: {
          rows: 0,
          hasUrl: 0,
          hasTabUrl: 0,
          hasContentName: 0,
          hasContentSize: 0,
          hasWebAppAccount: 0,
          hasProfileUser: 0,
          hasDetectorName: 0,
          hasOrgUnit: 0,
          hasDeviceName: 0,
          hasClientType: 0,
          hasCmdSwitches: 0
        }
      };
    });

    const nowIso = new Date().toISOString();
    const diag = {
      schemaVersion: '1.0',
      ceraVersion: (typeof CeraConfig !== 'undefined' && CeraConfig.VERSION) ? CeraConfig.VERSION : '2.0.10',
      privacyNotice: 'Zero-PII Diagnostic Log: Contains only execution metrics, partition counts, timing, and sanitized status codes. No user emails, domains, OUs, URLs, file names, or device names are recorded.',
      activityId: initialState.activityId || '',
      status: initialState.status || 'RUNNING',
      createdAtUtc: nowIso,
      updatedAtUtc: nowIso,
      environment: {
        locale: (typeof ceraGetLanguage === 'function') ? ceraGetLanguage() : 'en',
        scriptTimeZone: tz,
        targetEventsCount: TARGET_EVENTS.length,
        maxRowsPerSheet: MAX_ROWS_PER_SHEET,
        flushChunkThreshold: BATCH_FLUSH_SIZE,
        maxRuntimeMs: TIME_BUDGET_MS
      },
      windowDiagnostics: {
        dateRangeDays: initialState.dateRangeDays || CERA_DEFAULT_RANGE_DAYS,
        windowStartUtc: initialState.startStr || '',
        windowEndUtc: initialState.endStr || '',
        currentCursorUtc: initialState.startStr || '',
        currentSliceIndex: 0,
        totalPlannedSlices: Array.isArray(initialState.plan) ? initialState.plan.length : 0,
        quietWeeksSkipped: 0,
        timeSpanPct: 0
      },
      policyPrecheck: policyPrecheck || { status: 'NOT_RUN' },
      preflight: preflight || {
        status: initialState.expectedEvents ? 'ESTIMATED' : 'NOT_RUN',
        expectedEvents: initialState.expectedEvents || 0,
        plannedSlicesCount: Array.isArray(initialState.plan) ? initialState.plan.length : 0
      },
      runtimeHealth: {
        ticksExecuted: 0,
        totalEventsExtracted: 0,
        totalEventsScanned: 0,
        totalApiCalls: 0,
        totalRetries: 0,
        totalRateLimitHits: 0,
        totalTokenFallbacks: 0,
        totalStreamRewinds: 0,
        totalAdaptiveBatchSplits: 0,
        totalPartitionsCreated: firstPartition ? 1 : 0,
        totalPartitionsRecovered: 0,
        peakSessionStateBytes: 0,
        sessionLimitBytes: CERA_STATE_MAX_BYTES,
        compactionCount: 0
      },
      timingBreakdownMs: {
        totalElapsedMs: 0,
        adminApiFetchMs: 0,
        sheetsAppendMs: 0,
        partitionCreateMs: 0,
        retrySleepMs: 0
      },
      scaleDiagnostics: {
        expectedEvents: initialState.expectedEvents || 0,
        actualToExpectedRatio: 0,
        avgEventsPerTick: 0,
        avgEventsPerSec: 0,
        peakTickEvents: 0
      },
      streamDiagnostics: streamDiagnostics,
      slices: [],
      partitions: firstPartition ? [{
        index: firstPartition.index || 1,
        rows: firstPartition.rows || 0,
        status: firstPartition.status || 'WRITING',
        createdAtUtc: nowIso,
        closedAtUtc: null
      }] : [],
      ticks: [],
      anomalies: [{
        tsUtc: nowIso,
        level: 'INFO',
        code: 'JOB_STARTED',
        detail: `Direct ingestion initialized for ${initialState.dateRangeDays || CERA_DEFAULT_RANGE_DAYS}-day window.`
      }],
      analysisSummary: null
    };

    const txtContent = ceraRenderDiagnosticLogTxt_(diag);
    const mediaBlob = Utilities.newBlob(txtContent, 'text/plain', logFileName);
    const createdFile = Drive.Files.create({
      name: logFileName,
      mimeType: 'text/plain',
      parents: [logFolderId]
    }, mediaBlob, { supportsAllDrives: true });

    const meta = {
      activityId: initialState.activityId || '',
      folderId: initialState.folderId,
      logFolderId: logFolderId,
      logFolderUrl: logFolderUrl,
      logFileId: createdFile.id
    };

    try {
      const docProps = PropertiesService.getDocumentProperties();
      docProps.setProperty('CERA_DIAG_LOG_META', JSON.stringify(meta));
    } catch (mErr) {}

    ceraSaveDiagState_(initialState.activityId, diag, createdFile.id, true);
    return meta;
  } catch (err) {
    console.warn('ceraInitDiagnosticLog_ non-fatal notice: ' + (err.message || err));
    return null;
  }
}

/**
 * Loads the current diagnostic state from CacheService or by parsing the JSON block in `cera-diagnostic-log.txt`.
 */
function ceraLoadDiagState_(activityId, logFileId) {
  const cacheKey = 'CERA_DIAG_' + (activityId || 'ACTIVE');
  try {
    const cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (e) {}

  if (!logFileId) return null;
  try {
    let rawTxt = '';
    if (typeof Drive !== 'undefined' && Drive.Files && typeof Drive.Files.get === 'function') {
      const resp = Drive.Files.get(logFileId, { alt: 'media', supportsAllDrives: true });
      if (typeof resp === 'string') {
        rawTxt = resp;
      } else if (resp && typeof resp.getDataAsString === 'function') {
        rawTxt = resp.getDataAsString();
      } else if (resp && typeof resp.content === 'string') {
        rawTxt = resp.content;
      }
    }
    if (!rawTxt && typeof UrlFetchApp !== 'undefined' && typeof ScriptApp !== 'undefined' && ScriptApp.getOAuthToken) {
      const httpResp = UrlFetchApp.fetch(
        'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(logFileId) + '?alt=media&supportsAllDrives=true',
        { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true }
      );
      if (httpResp && httpResp.getResponseCode() === 200) {
        rawTxt = httpResp.getContentText() || '';
      }
    }
    if (rawTxt) {
      const beginMarker = '--- BEGIN CERA DIAGNOSTIC PAYLOAD (JSON) ---';
      const endMarker = '--- END CERA DIAGNOSTIC PAYLOAD (JSON) ---';
      const bIdx = rawTxt.indexOf(beginMarker);
      const eIdx = rawTxt.indexOf(endMarker);
      if (bIdx !== -1 && eIdx !== -1 && eIdx > bIdx) {
        const jsonPart = rawTxt.slice(bIdx + beginMarker.length, eIdx).trim();
        return JSON.parse(jsonPart);
      }
    }
  } catch (e) {
    console.warn('ceraLoadDiagState_ fallback notice: ' + (e.message || e));
  }
  return null;
}

/**
 * Enforces the 1 MB (`CERA_DIAG_LOG_MAX_BYTES`) ceiling and saves the updated hybrid `.txt` file to Google Drive.
 */
function ceraSaveDiagState_(activityId, diag, logFileId, skipDriveWrite) {
  if (!diag) return;
  diag.updatedAtUtc = new Date().toISOString();
  let txtContent = ceraEnforceDiagLogCap_(diag);

  const cacheKey = 'CERA_DIAG_' + (activityId || diag.activityId || 'ACTIVE');
  try {
    const rawJson = JSON.stringify(diag);
    if (ceraUtf8Bytes_(rawJson) < 95000) {
      CacheService.getScriptCache().put(cacheKey, rawJson, 21600);
    } else {
      CacheService.getScriptCache().remove(cacheKey);
    }
  } catch (cErr) {}

  if (skipDriveWrite || !logFileId) return;
  try {
    const logFileName = (typeof CeraConfig !== 'undefined' && CeraConfig.DIAG_LOG_FILE_NAME) ? CeraConfig.DIAG_LOG_FILE_NAME : 'cera-diagnostic-log.txt';
    const mediaBlob = Utilities.newBlob(txtContent, 'text/plain', logFileName);
    Drive.Files.update(
      { name: logFileName, mimeType: 'text/plain' },
      logFileId,
      mediaBlob,
      { supportsAllDrives: true }
    );
  } catch (uErr) {
    console.warn('ceraSaveDiagState_ Drive update non-fatal notice: ' + (uErr.message || uErr));
  }
}

/**
 * Compacts `ticks`, `anomalies`, `slices`, and `partitions` if the rendered `.txt` approaches 1 MB (`1,000,000` bytes).
 * Guarantees the returned `.txt` string is strictly `<= CERA_DIAG_LOG_MAX_BYTES`.
 */
function ceraEnforceDiagLogCap_(diag) {
  // Structural array bounds for normal operation
  if (Array.isArray(diag.ticks) && diag.ticks.length > 600) {
    const first = diag.ticks.slice(0, 50);
    const last = diag.ticks.slice(-500);
    diag.ticks = first.concat(last);
    diag.runtimeHealth.compactionCount = (diag.runtimeHealth.compactionCount || 0) + 1;
  }
  if (Array.isArray(diag.anomalies) && diag.anomalies.length > 250) {
    diag.anomalies = diag.anomalies.slice(0, 40).concat(diag.anomalies.slice(-180));
    diag.runtimeHealth.compactionCount = (diag.runtimeHealth.compactionCount || 0) + 1;
  }
  if (Array.isArray(diag.slices) && diag.slices.length > 300) {
    diag.slices = diag.slices.slice(0, 30).concat(diag.slices.slice(-240));
  }
  if (Array.isArray(diag.partitions) && diag.partitions.length > 400) {
    diag.partitions = diag.partitions.slice(0, 40).concat(diag.partitions.slice(-300));
  }

  let txt = ceraRenderDiagnosticLogTxt_(diag);
  let bytes = ceraUtf8Bytes_(txt);
  if (bytes <= CERA_DIAG_LOG_SOFT_BYTES) return txt;

  // Progressive compaction pass if approaching 940 KB / 1 MB ceiling
  const steps = [
    d => { if (d.ticks && d.ticks.length > 200) d.ticks = d.ticks.slice(0, 25).concat(d.ticks.slice(-150)); },
    d => { if (d.anomalies && d.anomalies.length > 100) d.anomalies = d.anomalies.slice(0, 20).concat(d.anomalies.slice(-70)); },
    d => { if (d.slices && d.slices.length > 120) d.slices = d.slices.slice(0, 15).concat(d.slices.slice(-90)); },
    d => { if (d.partitions && d.partitions.length > 150) d.partitions = d.partitions.slice(0, 20).concat(d.partitions.slice(-100)); },
    d => { if (d.ticks && d.ticks.length > 60) d.ticks = d.ticks.slice(0, 10).concat(d.ticks.slice(-40)); },
    d => { if (d.anomalies && d.anomalies.length > 40) d.anomalies = d.anomalies.slice(0, 10).concat(d.anomalies.slice(-25)); },
    d => { if (d.ticks && d.ticks.length > 15) d.ticks = d.ticks.slice(-15); },
    d => { if (d.slices && d.slices.length > 20) d.slices = d.slices.slice(-20); },
    d => { if (d.partitions && d.partitions.length > 25) d.partitions = d.partitions.slice(-25); }
  ];

  for (let i = 0; i < steps.length && bytes > CERA_DIAG_LOG_SOFT_BYTES; i++) {
    steps[i](diag);
    diag.runtimeHealth.compactionCount = (diag.runtimeHealth.compactionCount || 0) + 1;
    txt = ceraRenderDiagnosticLogTxt_(diag);
    bytes = ceraUtf8Bytes_(txt);
  }

  if (bytes > CERA_DIAG_LOG_MAX_BYTES) {
    diag.ticks = (diag.ticks || []).slice(-5);
    diag.anomalies = (diag.anomalies || []).slice(-10);
    diag.slices = (diag.slices || []).slice(-5);
    diag.partitions = (diag.partitions || []).slice(-10);
    txt = ceraRenderDiagnosticLogTxt_(diag);
  }
  return txt;
}

/**
 * Renders the Hybrid Plain-Text + Structured JSON content for `logs/cera-diagnostic-log.txt`.
 */
function ceraRenderDiagnosticLogTxt_(diag) {
  const rh = diag.runtimeHealth || {};
  const wd = diag.windowDiagnostics || {};
  const tb = diag.timingBreakdownMs || {};
  const pol = diag.policyPrecheck || {};
  const pre = diag.preflight || {};
  const anoms = Array.isArray(diag.anomalies) ? diag.anomalies : [];
  const lastAnom = anoms.length > 0 ? anoms[anoms.length - 1] : null;

  const headerLines = [
    '================================================================================',
    `CERA (Chrome Egress Risk Analysis) — Direct Ingestion Diagnostic Log`,
    `Version            : v${diag.ceraVersion || '2.0.10'} (Schema v${diag.schemaVersion || '1.0'})`,
    `Privacy Guarantee  : ZERO-PII / ZERO-SENSITIVE-DATA (Safe to inspect & share)`,
    '================================================================================',
    `Activity ID        : ${diag.activityId || 'N/A'}`,
    `Job Status         : ${diag.status || 'UNKNOWN'}`,
    `Created (UTC)      : ${diag.createdAtUtc || 'N/A'}`,
    `Last Updated (UTC) : ${diag.updatedAtUtc || 'N/A'}`,
    `Locale / TimeZone  : ${(diag.environment && diag.environment.locale) || 'en'} / ${(diag.environment && diag.environment.scriptTimeZone) || 'UTC'}`,
    '--------------------------------------------------------------------------------',
    `EXTRACTION PROGRESS & SCALE`,
    `  Window Coverage  : ${wd.timeSpanPct || 0}% (${wd.dateRangeDays || 0} days | ${wd.windowStartUtc || ''} -> ${wd.windowEndUtc || ''})`,
    `  Current Cursor   : ${wd.currentCursorUtc || 'N/A'} (Slice ${wd.currentSliceIndex || 0}/${wd.totalPlannedSlices || 0}, Quiet Skipped: ${wd.quietWeeksSkipped || 0})`,
    `  Events Extracted : ${rh.totalEventsExtracted || 0} written / ${rh.totalEventsScanned || 0} scanned (Expected: ${pre.expectedEvents || 0})`,
    `  Partitions       : ${rh.totalPartitionsCreated || 0} created (${rh.totalPartitionsRecovered || 0} auto-recovered)`,
    `  Worker Ticks     : ${rh.ticksExecuted || 0} ticks | API Calls: ${rh.totalApiCalls || 0} | Retries: ${rh.totalRetries || 0} | 429s: ${rh.totalRateLimitHits || 0}`,
    `  Resilience       : Token Fallbacks: ${rh.totalTokenFallbacks || 0} | Rewinds: ${rh.totalStreamRewinds || 0} | Batch Splits: ${rh.totalAdaptiveBatchSplits || 0}`,
    `  Session State    : Peak ${rh.peakSessionStateBytes || 0} / ${rh.sessionLimitBytes || 9000} bytes | Log Compactions: ${rh.compactionCount || 0}`,
    `  Timing (ms)      : Total ${tb.totalElapsedMs || 0} | Admin API ${tb.adminApiFetchMs || 0} | Sheets Append ${tb.sheetsAppendMs || 0} | Sleep ${tb.retrySleepMs || 0}`,
    '--------------------------------------------------------------------------------',
    `POLICY PRECHECK & PREFLIGHT`,
    `  Policy Precheck  : ${pol.status || 'NOT_RUN'}${pol.connectorStatus ? ' (Connector: ' + pol.connectorStatus + ')' : ''}`,
    `  Preflight Est.   : ${pre.status || 'NOT_RUN'} (Expected: ${pre.expectedEvents || 0}, Active Slices: ${pre.activeSlicesCount || 0}/${pre.plannedSlicesCount || 0})`,
    `  Anomalies Logged : ${anoms.length}${lastAnom ? ' | Latest: [' + lastAnom.code + '] ' + lastAnom.detail : ''}`,
    `  Analysis Summary : ${diag.analysisSummary ? 'COMPLETED (Sheets Read: ' + diag.analysisSummary.sheetsRead + '/' + diag.analysisSummary.sheetsTotal + ', Actions: ' + diag.analysisSummary.actionsAssembled + ')' : 'NOT_RUN_YET'}`,
    '================================================================================',
    '',
    '--- BEGIN CERA DIAGNOSTIC PAYLOAD (JSON) ---',
    JSON.stringify(diag, null, 2),
    '--- END CERA DIAGNOSTIC PAYLOAD (JSON) ---',
    ''
  ];
  return headerLines.join('\n');
}

/**
 * Appends a worker tick summary and updates cumulative counters in `logs/cera-diagnostic-log.txt`.
 */
function ceraRecordDiagTick_(state, work, tickDiag, outcome, rawErrMsg) {
  if (!state || !state.folderId) return;
  try {
    const meta = ceraGetDiagLogMeta_(state.folderId);
    if (!meta || !meta.logFileId) return;
    const diag = ceraLoadDiagState_(state.activityId, meta.logFileId);
    if (!diag) return;

    const nowIso = new Date().toISOString();
    diag.status = state.status || outcome || diag.status;

    const rh = diag.runtimeHealth;
    const tb = diag.timingBreakdownMs;
    const wd = diag.windowDiagnostics;
    const sd = diag.scaleDiagnostics;

    rh.ticksExecuted = (rh.ticksExecuted || 0) + 1;
    rh.totalEventsExtracted = state.processedCount || 0;
    rh.totalEventsScanned = state.scannedCount || 0;
    rh.totalApiCalls = (rh.totalApiCalls || 0) + ((work && work.apiCalls) || 0);
    rh.totalRetries = (rh.totalRetries || 0) + ((work && work.retries) || 0);
    rh.totalRateLimitHits = (rh.totalRateLimitHits || 0) + ((work && work.rateLimits) || 0);
    rh.totalTokenFallbacks = (rh.totalTokenFallbacks || 0) + ((tickDiag && tickDiag.tokenFallbacks) || 0);
    rh.totalStreamRewinds = (rh.totalStreamRewinds || 0) + ((tickDiag && tickDiag.rewinds) || 0);
    rh.totalAdaptiveBatchSplits = (rh.totalAdaptiveBatchSplits || 0) + ((tickDiag && tickDiag.adaptiveSplits) || 0);
    rh.totalPartitionsCreated = Math.max(rh.totalPartitionsCreated || 0, state.fileIndex || 1);
    rh.totalPartitionsRecovered = (rh.totalPartitionsRecovered || 0) + ((tickDiag && tickDiag.recoveredPartitions) || 0);

    let sessionBytes = 0;
    try {
      sessionBytes = ceraUtf8Bytes_(JSON.stringify(state));
    } catch (e) {}
    if (sessionBytes > (rh.peakSessionStateBytes || 0)) {
      rh.peakSessionStateBytes = sessionBytes;
    }

    const tickDurationMs = Math.max(0, Date.now() - ((tickDiag && tickDiag.tickStartMs) || Date.now()));
    const apiMs = (work && work.apiMs) || 0;
    const appendMs = (work && work.appendMs) || 0;
    const partCreateMs = (work && work.partCreateMs) || 0;
    const sleepMs = ((work && work.sleepMs) || 0) + ((tickDiag && tickDiag.sleepMs) || 0);

    tb.totalElapsedMs = (tb.totalElapsedMs || 0) + tickDurationMs;
    tb.adminApiFetchMs = (tb.adminApiFetchMs || 0) + apiMs;
    tb.sheetsAppendMs = (tb.sheetsAppendMs || 0) + appendMs;
    tb.partitionCreateMs = (tb.partitionCreateMs || 0) + partCreateMs;
    tb.retrySleepMs = (tb.retrySleepMs || 0) + sleepMs;

    wd.currentCursorUtc = state.currentCursorMs ? new Date(state.currentCursorMs).toISOString() : wd.currentCursorUtc;
    wd.currentSliceIndex = state.sliceIndex || 0;
    wd.totalPlannedSlices = Array.isArray(state.plan) ? state.plan.length : (wd.totalPlannedSlices || 0);
    wd.quietWeeksSkipped = (wd.quietWeeksSkipped || 0) + ((tickDiag && tickDiag.quietWeeksSkipped) || 0);
    wd.timeSpanPct = state.status === 'COMPLETED' ? 100 : (state.timeSpanPct || 0);

    const tickWritten = (work && work.written) || 0;
    if (tickWritten > (sd.peakTickEvents || 0)) sd.peakTickEvents = tickWritten;
    sd.avgEventsPerTick = rh.ticksExecuted > 0 ? Math.round(rh.totalEventsExtracted / rh.ticksExecuted) : 0;
    sd.avgEventsPerSec = tb.totalElapsedMs > 0 ? Math.round((rh.totalEventsExtracted * 1000) / tb.totalElapsedMs) : 0;
    if (sd.expectedEvents > 0) {
      sd.actualToExpectedRatio = Number((rh.totalEventsExtracted / sd.expectedEvents).toFixed(3));
    }

    // Merge stream diagnostics & schema presence
    if (state.eventStreams && diag.streamDiagnostics) {
      Object.keys(state.eventStreams).forEach(ev => {
        if (!diag.streamDiagnostics[ev]) return;
        const st = diag.streamDiagnostics[ev];
        st.rowsWritten = (state.eventStreams[ev] && state.eventStreams[ev].count) || st.rowsWritten || 0;
        if (tickDiag && tickDiag.streamPages && tickDiag.streamPages[ev]) {
          st.pagesFetched = (st.pagesFetched || 0) + tickDiag.streamPages[ev];
        }
        if (tickDiag && tickDiag.streamTokenFallbacks && tickDiag.streamTokenFallbacks[ev]) {
          st.tokenFallbacks = (st.tokenFallbacks || 0) + tickDiag.streamTokenFallbacks[ev];
        }
        if (tickDiag && tickDiag.streamSchema && tickDiag.streamSchema[ev]) {
          const src = tickDiag.streamSchema[ev];
          const dst = st.schemaPresence;
          Object.keys(src).forEach(k => {
            dst[k] = (dst[k] || 0) + (src[k] || 0);
          });
        }
      });
    }

    // Append completed slices
    if (tickDiag && Array.isArray(tickDiag.completedSlices) && tickDiag.completedSlices.length > 0) {
      tickDiag.completedSlices.forEach(s => diag.slices.push(s));
    }

    // Sync partition statuses & newly created partitions
    if (tickDiag && Array.isArray(tickDiag.newPartitions)) {
      tickDiag.newPartitions.forEach(np => {
        const existing = diag.partitions.find(p => p.index === np.index);
        if (!existing) {
          diag.partitions.push(np);
        }
      });
    }
    if (Array.isArray(state.partitions)) {
      state.partitions.forEach(sp => {
        const dp = diag.partitions.find(p => p.index === sp.index);
        if (dp) {
          dp.rows = sp.rows || dp.rows;
          dp.status = sp.status || dp.status;
          if (sp.status === 'COMPLETED' && !dp.closedAtUtc) dp.closedAtUtc = nowIso;
        }
      });
    }

    // Append anomalies from tick
    if (tickDiag && Array.isArray(tickDiag.anomalies)) {
      tickDiag.anomalies.forEach(a => {
        diag.anomalies.push({
          tsUtc: a.tsUtc || nowIso,
          level: a.level || 'WARN',
          code: a.code || 'NOTICE',
          detail: ceraSanitizeDiagnosticText_(a.detail || '')
        });
      });
    }
    if (rawErrMsg) {
      diag.anomalies.push({
        tsUtc: nowIso,
        level: outcome === 'FAILED' ? 'ERROR' : 'WARN',
        code: state.errorKey || outcome || 'TICK_ERROR',
        detail: ceraSanitizeDiagnosticText_(rawErrMsg)
      });
    }
    if (outcome === 'COMPLETED') {
      diag.anomalies.push({
        tsUtc: nowIso,
        level: 'INFO',
        code: 'JOB_COMPLETED',
        detail: `Direct ingestion finished: ${rh.totalEventsExtracted} events across ${rh.totalPartitionsCreated} partition(s).`
      });
    }

    diag.ticks.push({
      tick: rh.ticksExecuted,
      tsUtc: nowIso,
      durationMs: tickDurationMs,
      apiMs: apiMs,
      appendMs: appendMs,
      sleepMs: sleepMs,
      scanned: (work && work.scanned) || 0,
      written: tickWritten,
      apiCalls: (work && work.apiCalls) || 0,
      retries: (work && work.retries) || 0,
      rateLimits: (work && work.rateLimits) || 0,
      sliceIdx: state.sliceIndex || 0,
      partitionIdx: state.fileIndex || 1,
      timeSpanPct: wd.timeSpanPct,
      stateBytes: sessionBytes,
      outcome: outcome || state.status || 'RUNNING'
    });

    ceraSaveDiagState_(state.activityId, diag, meta.logFileId, false);
  } catch (err) {
    console.warn('ceraRecordDiagTick_ non-fatal notice: ' + (err.message || err));
  }
}

/**
 * Records a user lifecycle transition (PAUSE, RESUME, FINALIZE_STOP, EMERGENCY_RESET, DISCARD) in `cera-diagnostic-log.txt`.
 */
function ceraRecordDiagLifecycle_(state, statusLabel, code, detail) {
  if (!state || !state.folderId) return;
  try {
    const meta = ceraGetDiagLogMeta_(state.folderId);
    if (!meta || !meta.logFileId) return;
    const diag = ceraLoadDiagState_(state.activityId, meta.logFileId);
    if (!diag) return;

    const nowIso = new Date().toISOString();
    if (statusLabel) diag.status = statusLabel;
    if (state.processedCount !== undefined) {
      diag.runtimeHealth.totalEventsExtracted = state.processedCount || 0;
    }
    if (state.timeSpanPct !== undefined) {
      diag.windowDiagnostics.timeSpanPct = state.status === 'COMPLETED' ? 100 : (state.timeSpanPct || 0);
    }
    diag.anomalies.push({
      tsUtc: nowIso,
      level: 'INFO',
      code: code || 'LIFECYCLE',
      detail: ceraSanitizeDiagnosticText_(detail || '')
    });
    ceraSaveDiagState_(state.activityId, diag, meta.logFileId, false);
  } catch (err) {
    console.warn('ceraRecordDiagLifecycle_ non-fatal notice: ' + (err.message || err));
  }
}

/**
 * Records the final CERA analysis summary (`executeDlpAnalysis`) into `cera-diagnostic-log.txt`
 * when analyzing the Direct Ingestion folder. Manual Export folders do not have `CERA_DIAG_LOG_META` and are ignored.
 */
function ceraRecordDiagAnalysisSummary_(folderId, analysisStats) {
  if (!folderId || !analysisStats) return;
  try {
    const meta = ceraGetDiagLogMeta_(folderId);
    if (!meta || !meta.logFileId) return;
    const diag = ceraLoadDiagState_(meta.activityId, meta.logFileId);
    if (!diag) return;

    const nowIso = new Date().toISOString();
    diag.analysisSummary = {
      completedAtUtc: nowIso,
      sheetsTotal: analysisStats.sheetsTotal || 0,
      sheetsRead: analysisStats.sheetsRead || 0,
      rowsRead: analysisStats.rowsRead || 0,
      rowsMerged: analysisStats.rowsMerged || 0,
      rowsDropped: analysisStats.rowsDropped || 0,
      actionsAssembled: analysisStats.actions || 0,
      truncatedByWatchdog: !!analysisStats.truncated,
      slidesGenerated: !!analysisStats.slidesGenerated,
      sheetsGenerated: !!analysisStats.sheetsGenerated,
      nonFatalWarningsCount: analysisStats.errorsCount || 0
    };
    diag.anomalies.push({
      tsUtc: nowIso,
      level: 'INFO',
      code: 'ANALYSIS_COMPLETED',
      detail: `Report generation completed: ${analysisStats.sheetsRead || 0}/${analysisStats.sheetsTotal || 0} partitions read, ${analysisStats.actions || 0} user actions assembled.`
    });
    ceraSaveDiagState_(meta.activityId, diag, meta.logFileId, false);
  } catch (err) {
    console.warn('ceraRecordDiagAnalysisSummary_ non-fatal notice: ' + (err.message || err));
  }
}

