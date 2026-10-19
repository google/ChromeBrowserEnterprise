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
 * Columns of a partition. Device Name, Client Type, Command Line Switches, and Event ID come after the first 15 so that
 * partitions written before them keep their layout: the reader maps every column by its header (resolveColumnIndices),
 * so a folder can hold partitions of any width (15, 18, or 19 columns). Command Line Switches holds one switch per line.
 */
const PARTITION_HEADERS = [
  'Timestamp', 'Event', 'Event Reason', 'Detector Name', 'Organizational Unit',
  'User Profile', 'Content Size', 'Content Type', 'Trigger Type',
  'Web App Account', 'URL', 'Tab URL', 'URL Category', 'Event Result', 'Content Name',
  'Device Name', 'Client Type', 'Command Line Switches', 'Event ID'
];

const CERA_EXTRACTION_TRIGGER_MINUTES = (typeof CeraConfig !== 'undefined' && Number(CeraConfig.EXTRACTION_TRIGGER_MINUTES))
  ? Number(CeraConfig.EXTRACTION_TRIGGER_MINUTES)
  : 5;
const CERA_EXTRACTION_LEASE_MS = (typeof CeraConfig !== 'undefined' && Number(CeraConfig.EXTRACTION_LEASE_MS))
  ? Number(CeraConfig.EXTRACTION_LEASE_MS)
  : 390000;
const CERA_EXTRACTION_STALE_MS = (typeof CeraConfig !== 'undefined' && Number(CeraConfig.EXTRACTION_STALE_MS))
  ? Number(CeraConfig.EXTRACTION_STALE_MS)
  : 600000;
const CERA_EXTRACTION_STALL_MS = (typeof CeraConfig !== 'undefined' && Number(CeraConfig.EXTRACTION_STALL_MS))
  ? Number(CeraConfig.EXTRACTION_STALL_MS)
  : 900000;
const CERA_OPEN_REPAIR_HANDLER = 'ceraOnSpreadsheetOpenTrigger';

// ==============================================================================
// SECTION 1: TRIGGER LIFECYCLE MANAGEMENT (ZERO GHOST TRIGGERS)
// ==============================================================================

/**
 * Completely removes all active or orphaned cloud ingestion triggers with a mandatory reason code
 */
function cleanupAllIngestionTriggers(reasonCode) {
  const reason = String(reasonCode || 'CLEANUP_REQUESTED').trim() || 'CLEANUP_REQUESTED';
  try {
    const triggers = ScriptApp.getProjectTriggers();
    let deletedCount = 0;
    triggers.forEach(t => {
      if (t.getHandlerFunction() === TRIGGER_HANDLER_NAME) {
        try {
          ScriptApp.deleteTrigger(t);
          deletedCount++;
        } catch (e) {
          Logger.log('Delete trigger notice: ' + e.message);
        }
      }
    });
    if (deletedCount > 0 && reason !== 'TRIGGER_ROTATION') {
      ceraAppendFlightIncident_('TRIGGER_DELETED', reason);
    }
  } catch (err) {
    Logger.log('cleanupAllIngestionTriggers notice: ' + err.message);
  }
}

/**
 * Registers a fresh time-driven trigger (default 5-minute cadence) for autonomous cloud execution
 */
function registerCloudIngestionTrigger(cadenceMinutes) {
  cleanupAllIngestionTriggers('TRIGGER_ROTATION');
  const mins = Number(cadenceMinutes) || CERA_EXTRACTION_TRIGGER_MINUTES || 5;
  const validMins = [1, 5, 10, 15, 30].indexOf(mins) !== -1 ? mins : 5;
  const created = ScriptApp.newTrigger(TRIGGER_HANDLER_NAME)
    .timeBased()
    .everyMinutes(validMins)
    .create();
  ensureOwnerOpenRepairTrigger_();
  return created;
}

/**
 * Ensures an installable onOpen trigger is registered for the active spreadsheet so reopening the
 * sheet can auto-heal missing or stalled background extraction triggers when opened by the owner.
 */
function ensureOwnerOpenRepairTrigger_() {
  try {
    if (typeof ScriptApp === 'undefined' || typeof ScriptApp.getProjectTriggers !== 'function') return false;
    const triggers = ScriptApp.getProjectTriggers() || [];
    const exists = triggers.some(t => t && typeof t.getHandlerFunction === 'function' && t.getHandlerFunction() === CERA_OPEN_REPAIR_HANDLER);
    if (exists) return true;
    const ss = (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet) ? SpreadsheetApp.getActiveSpreadsheet() : null;
    if (!ss) return false;
    const builder = ScriptApp.newTrigger(CERA_OPEN_REPAIR_HANDLER);
    if (builder && typeof builder.forSpreadsheet === 'function') {
      builder.forSpreadsheet(ss).onOpen().create();
      return true;
    }
  } catch (e) {
    // Non-fatal in mock environments or when trigger quota is full
  }
  return false;
}

/**
 * Installable onOpen trigger handler for automatic trigger self-repair.
 */
function ceraOnSpreadsheetOpenTrigger() {
  try {
    return ceraMaybeAutoHealIngestionOnOpen_('on_open_trigger');
  } catch (e) {
    return { healed: false, reason: 'ERROR' };
  }
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
 * Finds or creates the top-level "CERA" folder in the user's My Drive via the Drive v3 API
 * so all CERA artifacts (Direct Ingestion job folders, generated decks, and workbooks) live in one place.
 */
function ceraEnsureRootFolder_(forceCreateNew) {
  let docProps = null;
  let userProps = null;
  try { docProps = PropertiesService.getDocumentProperties(); } catch (e) {}
  try { userProps = PropertiesService.getUserProperties(); } catch (e) {}

  const cachedId = !forceCreateNew
    ? ((docProps && docProps.getProperty('CERA_ROOT_FOLDER_ID')) || (userProps && userProps.getProperty('CERA_ROOT_FOLDER_ID')) || '')
    : '';

  if (cachedId) {
    try {
      const existing = Drive.Files.get(cachedId, { fields: 'id,name,mimeType,trashed', supportsAllDrives: true });
      if (existing && existing.id && !existing.trashed && existing.name === 'CERA') {
        return existing.id;
      }
    } catch (getErr) {
      const errMsg = String((getErr && getErr.message) || getErr || '').toLowerCase();
      if (!errMsg.includes('404') && !errMsg.includes('not found') && !errMsg.includes('notfound')) {
        return cachedId;
      }
    }
  }

  let resolvedId = '';
  if (!forceCreateNew && typeof Drive !== 'undefined' && Drive.Files && typeof Drive.Files.list === 'function') {
    try {
      const listRes = Drive.Files.list({
        q: "name = 'CERA' and 'root' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
        orderBy: 'createdTime',
        pageSize: 50,
        fields: 'files(id,name,parents,trashed)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      });
      const files = (listRes && Array.isArray(listRes.files)) ? listRes.files : [];
      const match = files.find(f => f && f.id && !f.trashed && f.name === 'CERA');
      if (match) resolvedId = match.id;
    } catch (listErr) {
      // Drive.Files.list unavailable or failed; fall through to create
    }
  }

  if (!resolvedId) {
    const created = Drive.Files.create(
      { name: 'CERA', mimeType: 'application/vnd.google-apps.folder' },
      null,
      { supportsAllDrives: true }
    );
    resolvedId = (created && created.id) || '';
  }

  if (resolvedId) {
    try { if (docProps) docProps.setProperty('CERA_ROOT_FOLDER_ID', resolvedId); } catch (e) {}
    try { if (userProps) userProps.setProperty('CERA_ROOT_FOLDER_ID', resolvedId); } catch (e) {}
  }
  return resolvedId;
}

/**
 * Engages a new autonomous ingestion job for the selected time range (7 days when none is given).
 * Optionally runs Batch #1 inline when runFirstBatchInline is true, and schedules subsequent batches in Google Apps Script background.
 */
function engageCloudIngestion(dateRangeDays, runFirstBatchInline) {
  const daysFilter = ceraRangeDays_(dateRangeDays);
  const nowMs = Date.now();
  const windowStartMs = nowMs - (daysFilter * 86400000);
  const targetEndMs = nowMs;

  const timestampStr = Utilities.formatDate(new Date(), ceraTimeZone(), 'yyyyMMdd_HHmmss');
  const folderName = `Chrome_SecurityLogs_${daysFilter}d_${timestampStr}`;
  // Created through the Drive API inside the top-level CERA folder, so the drive.file scope covers the folder and the partitions created in it
  let folder = null;
  let ceraRootId = '';
  try {
    ceraRootId = ceraEnsureRootFolder_(false);
  } catch (rootErr) {
    ceraRootId = '';
  }
  if (ceraRootId) {
    try {
      folder = Drive.Files.create({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [ceraRootId]
      });
    } catch (subErr) {
      folder = null;
    }
  }
  if (!folder) {
    folder = Drive.Files.create({ name: folderName, mimeType: 'application/vnd.google-apps.folder' });
  }
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
  const initialExpected = plan && Number(plan.total) > 0 ? Number(plan.total) : 0;
  const initialEtaSec = plan && Number(plan.etaSec) > 0 ? Number(plan.etaSec) : 0;

  const initialState = {
    activityId: activityId,
    plan: plan,
    expectedEvents: initialExpected,
    etaSec: initialEtaSec,
    status: 'RUNNING',
    processedCount: 0,
    scannedCount: 0,
    timeSpanPct: 0,
    estimatedRemainingSec: initialEtaSec,
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
  ceraInitJobCtl_(initialState);
  ceraRegisterPartition_(folderId, 1, firstPartition.fileId, firstPartition.fileName, 'IN_PROGRESS', 1);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    const docProps = PropertiesService.getDocumentProperties();
    docProps.deleteProperty('CERA_ANALYSIS_EXECUTED');
    const ssId = (ss && typeof ss.getId === 'function') ? ss.getId() : '';
    if (ssId) {
      docProps.setProperty('CERA_INGESTION_USED_SHEET_ID', ssId);
    }
  } catch (cpErr) {}

  const diagMeta = ceraInitDiagnosticLog_(initialState, firstPartition);

  // Initialize the Live Monitor Sheet tab immediately
  safeUpdateDashboard(ss, initialState, partitions);

  // Register autonomous background trigger to run in Google Apps Script
  registerCloudIngestionTrigger();

  if (runFirstBatchInline) {
    try {
      processCloudIngestionBatch();
    } catch (inlineErr) {
      console.warn('Inline first batch notice: ' + (inlineErr.message || inlineErr));
    }
  }

  const latestState = runFirstBatchInline ? (getProgressUpdate() || initialState) : initialState;
  const finalStatus = (latestState && latestState.status) ? latestState.status : 'RUNNING';

  return {
    success: true,
    folderId: folderId,
    folderName: folderName,
    folderUrl: folderUrl,
    logFolderId: (diagMeta && diagMeta.logFolderId) || '',
    logFolderUrl: (diagMeta && diagMeta.logFolderUrl) || folderUrl,
    logFileId: (diagMeta && diagMeta.logFileId) || '',
    status: finalStatus,
    isCompleted: finalStatus === 'COMPLETED' || !!(latestState && latestState.isCompleted),
    processedCount: Number((latestState && latestState.processedCount) || 0),
    timeSpanPct: finalStatus === 'COMPLETED' ? 100 : Number((latestState && latestState.timeSpanPct) || 0),
    rate: Number((latestState && (latestState.processingRate || latestState.rate)) || 0),
    fileIndex: Number((latestState && latestState.fileIndex) || 1),
    expectedEvents: Number((latestState && latestState.expectedEvents) || initialExpected || 0),
    etaSec: finalStatus === 'COMPLETED' ? 0 : Number((latestState && latestState.etaSec) || initialEtaSec || 0)
  };
}

/**
 * Pauses active cloud ingestion and self-cleans background triggers
 */
function pauseCloudIngestion() {
  cleanupAllIngestionTriggers('USER_PAUSED');

  let state = getProgressUpdate();
  state.status = 'PAUSED';
  saveStateToStorage(state);
  ceraUpdateJobCtlStatus_(state, 'PAUSED', 'USER_PAUSED');
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
  cleanupAllIngestionTriggers('STOPPED_EARLY_FOR_ANALYSIS');

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
  ceraUpdateJobCtlStatus_(state, 'COMPLETED', 'STOPPED_EARLY_FOR_ANALYSIS');
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
  ceraUpdateJobCtlStatus_(state, 'RUNNING', 'USER_RESUMED');
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
  if (!activeActId && existing && existing.activityId) {
    activeActId = existing.activityId;
  }
  if (existing && existing.folderId && existing.status !== 'COMPLETED' && !existing.isCompleted) {
    ceraRecordDiagLifecycle_(existing, 'STOPPED', 'SESSION_DISCARDED', 'User discarded or reset active ingestion session.');
  }

  cleanupAllIngestionTriggers('SESSION_DISCARDED');

  const docProps = PropertiesService.getDocumentProperties();
  docProps.deleteProperty('SIERRA_SESSION');
  docProps.deleteProperty('CERA_CURRENT_ACTIVITY_ID');
  docProps.deleteProperty('CERA_PART_REG');
  docProps.deleteProperty('CERA_FR_HOT');
  docProps.deleteProperty('CERA_FR_RING');
  docProps.deleteProperty('CERA_FR_INC');
  docProps.deleteProperty('CERA_JOB_BEAT');
  try {
    docProps.setProperty('CERA_JOB_CTL', JSON.stringify({
      activityId: activeActId,
      status: 'DISCARDED',
      rev: 1,
      updatedMs: Date.now(),
      heartbeatMs: Date.now(),
      lastHeartbeatMs: Date.now(),
      lastReason: 'SESSION_DISCARDED'
    }));
  } catch (e) {}
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
 * Protected by LockService and governed by time-budget watchdog
 */
function processCloudIngestionBatch() {
  // 1. Concurrency Protection: Avoid overlapping trigger ticks (wait up to 10s if previous batch is finalizing)
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    Logger.log('Previous background execution still active. Skipping concurrent tick.');
    ceraRecordLockSkipped_();
    return;
  }

  const executionStartTime = Date.now();
  let state = getProgressUpdate();

  // Tri-state read guard (BP-01 / Q2-B): NEVER delete triggers on a transient property read error!
  if (state && (state.status === 'TRANSIENT_READ_ERROR' || state.readState === 'UNREADABLE')) {
    console.warn('[Liveness] Transient DocumentProperties read error during tick; keeping background trigger alive.');
    ceraRecordTransientReadStrike_();
    lock.releaseLock();
    return;
  }

  // If job is no longer running or in active quota sleep, self-destruct trigger with explicit reason and exit
  if (!state || (state.status !== 'RUNNING' && state.status !== 'QUOTA_PAUSED')) {
    cleanupAllIngestionTriggers('STATUS_' + (state && state.status || 'IDLE'));
    lock.releaseLock();
    return;
  }

  // Check if in active quota sleep with a future resume timestamp
  if (state.status === 'QUOTA_PAUSED' && Number(state.quotaResumeAtMs) > executionStartTime) {
    ceraAppendBeat_('Q');
    lock.releaseLock();
    return;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Views never change state (d2 §2.4): if '⚡ Ingestion Monitor' tab was accidentally deleted, recreate it instead of wiping the session
  if (ss && !ss.getSheetByName('⚡ Ingestion Monitor')) {
    Logger.log("'⚡ Ingestion Monitor' tab missing during active job; recreating monitor sheet without wiping session.");
    safeUpdateDashboard(ss, state, state.partitions || []);
  }

  ceraAcquireTickLease_(state, executionStartTime);

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
    ceraUpdatePartitionRows_(folderId, fileIndex, currentFileId, currentFileName, currentSheetRows, 'IN_PROGRESS');
  };
  const openPartition = () => {
    ceraUpdatePartitionRows_(folderId, fileIndex, currentFileId, currentFileName, currentSheetRows, 'COMPLETED');
    fileIndex++;
    const nextPart = createTargetSheetFile(folderId, state.startStr, state.endStr, fileIndex);
    currentFileId = nextPart.fileId;
    currentFileName = nextPart.fileName;
    currentSheetRows = 1;
    ceraRegisterPartition_(folderId, fileIndex, nextPart.fileId, nextPart.fileName, 'IN_PROGRESS', 1);
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
      return flushBufferWithRetry(targetFileId, rows, 0, progress, currentSheetRows + 1);
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
        ceraAppendFlightIncident_('PARTITION_RECOVERED', 'Active partition missing (404); opened replacement partition');
        // Rows that reached the deleted file went with it: all of them go to the new partition
        progress.written = 0;
        openPartition();
        return flushBufferWithRetry(currentFileId, rows, 0, progress, currentSheetRows + 1);
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

      // Check if user paused, stopped, finalized early, or reset the job
      const storedStatus = ceraStoredJobStatus_(state.activityId);
      if (storedStatus === 'GONE') {
        jobGone = true;
        break;
      }
      if (storedStatus === 'PAUSED' || storedStatus === 'STOPPED' || storedStatus === 'COMPLETED') {
        cleanupAllIngestionTriggers('STATUS_' + storedStatus);
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

      // Check active event streams for current day slice (all 7 TARGET_EVENTS are queried on active days — BP-12)
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
          const classified = ceraClassifyIngestionError_(apiErr);
          const apiErrMsg = (apiErr.message || String(apiErr)).toLowerCase();
          if (stream.pageToken && (classified.isInvalidToken || apiErrMsg.includes('pagetoken') || apiErrMsg.includes('400') || apiErrMsg.includes('invalid token'))) {
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
            ceraAppendFlightIncident_('TOKEN_FALLBACK', evName + ' resumed via edgeMs');
            stream.pageToken = null;
            continue; // CRITICAL: Skip fall-through so stream is NOT erroneously marked completed!
          } else if (classified.isDailyQuota || classified.isRateLimit || classified.isPermission || ceraIsDailyQuotaError_(apiErrMsg) || ceraIsRateLimitError_(apiErrMsg) || ceraIsPermissionError_(apiErrMsg)) {
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
        let skippedEdgeMs = NaN;
        let skippedEdgeId = '';
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
          if (ceraIsNonEgressTransferRow_(evName, parsedRow)) {
            if (!isNaN(itemMs)) {
              skippedEdgeMs = itemMs;
              skippedEdgeId = itemId;
            }
            continue;
          }
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
        if (!isNaN(skippedEdgeMs) && stream.pageToken) {
          ceraExtendEdge_(stream, skippedEdgeMs, skippedEdgeId);
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

    const coveredMs = Math.max(0, currentCursorMs - windowStartMs);
    const coverageRatio = totalLogSpanMs > 0 ? Math.min(1.0, coveredMs / totalLogSpanMs) : 1.0;
    let timeSpanPct = jobComplete ? 100 : Math.min(99.9, Math.max(0.1, Math.round(coverageRatio * 1000) / 10));
    const currentDay = Math.min(daysFilter, Math.max(1, Math.floor(coveredMs / 86400000) + 1));
    const rate = totalRealTimeElapsedMs > 0 ? Math.round((totalLogsProcessed / (totalRealTimeElapsedMs / 1000)) * 10) / 10 : 0;
    // Wall-clock ETA from how much of the window this tick covered: the job ends when the cursor reaches the
    // end, one tick runs per minute, and the latest tick reflects the current data density (quiet weeks are
    // skipped quickly, busy days are slow). Keeps the previous estimate when this tick did not move.
    const advancedMs = currentCursorMs - cursorAtTickStartMs;
    const displayAdvMs = Math.max(0, displayCursorMs - cursorAtTickStartMs);
    const tickCycleSec = Math.max(60, Math.round(runDurationMs / 1000));
    let etaSec = advancedMs > 0
      ? Math.round(((targetEndMs - currentCursorMs) / advancedMs) * tickCycleSec)
      : (displayAdvMs > 0
        ? Math.round(((targetEndMs - displayCursorMs) / displayAdvMs) * Math.max(CERA_EXTRACTION_TRIGGER_MINUTES * 60, tickCycleSec))
        : Number(state.etaSec || 0));

    // With a pre-flight plan, progress and ETA come from the work left (requests and rows on the remaining
    // active days) at the cost measured over the last ticks, instead of from calendar coverage.
    const tickEndMs = Date.now();
    const workEstimate = ceraUpdateWorkEstimate_(state, work, executionStartTime, tickEndMs, currentCursorMs, targetEndMs, eventStreams, totalScanned);
    let workPct = null;
    if (workEstimate) {
      state.expectedEvents = jobComplete && totalScanned > 0 ? totalScanned : workEstimate.expectedEvents;
      if (!jobComplete) {
        etaSec = workEstimate.etaSec;
        workPct = workEstimate.pct;
      }
    }
    const currentLogDateStr = displayCursorMs > 0 ? Utilities.formatDate(new Date(displayCursorMs), ceraTimeZone(), 'yyyy-MM-dd HH:mm') : state.startDateStr;

    // Zero-progress livelock circuit breaker (BP-07 / FI-D2): 4 consecutive ticks with 0 cursor/row/scan advancement
    const prevProcessed = Number(state.processedCount || 0);
    const prevScanned = Number(state.scannedCount || 0);
    const madeRealProgress = (currentCursorMs > cursorAtTickStartMs) || (displayCursorMs > cursorAtTickStartMs) ||
      (work.rows > 0) || (totalLogsProcessed > prevProcessed) || (totalScanned > prevScanned);
    if (!jobComplete && !madeRealProgress) {
      state.zeroProgressTicks = (Number(state.zeroProgressTicks) || 0) + 1;
    } else {
      state.zeroProgressTicks = 0;
    }

    // Check completion or zero-progress livelock
    let finalStatus = jobComplete ? 'COMPLETED' : 'RUNNING';
    let livelockTripped = false;
    if (!jobComplete && state.zeroProgressTicks >= 4) {
      finalStatus = 'FAILED';
      livelockTripped = true;
    }

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
    if (livelockTripped) {
      state.errorKey = 'mon.err.noProgressLivelock';
      state.errorMessage = ceraT('mon.err.noProgressLivelock');
      cleanupAllIngestionTriggers('NO_PROGRESS_LIVELOCK');
    } else {
      state.errorMessage = '';
      state.errorKey = '';
    }
    delete state.quotaResumeAtMs;

    if (jobComplete && partitions.length > 0) {
      partitions[partitions.length - 1].status = 'COMPLETED';
      ceraUpdatePartitionRows_(folderId, fileIndex, currentFileId, currentFileName, currentSheetRows, 'COMPLETED');
    }

    // Pause, early finalize, and reset do not wait for this tick's lock: read the session again right before writing it back.
    // A job reset meanwhile stays gone; one paused, stopped, or finalized early keeps that status with this tick's progress.
    const storedStatus = ceraStoredJobStatus_(state.activityId);
    if (storedStatus === 'GONE') {
      Logger.log('Ingestion job was reset during this tick. Its progress is discarded.');
      return;
    }
    if (storedStatus === 'COMPLETED') {
      state.status = 'COMPLETED';
      state.isCompleted = true;
      state.timeSpanPct = 100;
      state.etaSec = 0;
      state.estimatedRemainingSec = 0;
      if (partitions.length > 0) {
        partitions[partitions.length - 1].status = 'COMPLETED';
      }
      cleanupAllIngestionTriggers('STOPPED_EARLY_FOR_ANALYSIS');
    } else if (storedStatus === 'PAUSED' || storedStatus === 'STOPPED') {
      state.status = storedStatus;
    } else if (jobComplete) {
      cleanupAllIngestionTriggers('JOB_COMPLETED'); // AUTO SELF-DESTRUCT!
    }

    saveStateToStorage(state);
    ceraFinalizeTickCtl_(state, executionStartTime, state.status, work.rows, work.requests, state.errorKey || '');
    safeUpdateDashboard(ss, state, partitions);
    tickDiag.cursorEndMs = currentCursorMs;
    ceraRecordDiagTick_(state, work, tickDiag, state.status === 'FAILED' ? (livelockTripped ? 'FAILED_NO_PROGRESS_LIVELOCK' : 'FAILED_STATE_OVERSIZE') : ((jobComplete || state.status === 'COMPLETED') ? 'COMPLETED' : 'OK'), state.errorMessage || '');

  } catch (err) {
    console.error('Autonomous batch execution error: ' + err.stack);
    const rawErrMsg = err.message || String(err);
    const errMsgLower = rawErrMsg.toLowerCase();
    const classifiedErr = ceraClassifyIngestionError_(err);

    // Check for Google Apps Script Daily Runtime Quota (6 Hours / Day for Workspace) across supported locales
    const isDailyQuota = classifiedErr.isDailyQuota || ceraIsDailyQuotaError_(rawErrMsg);
    // A Reports or Sheets API rate limit that outlasted the retries clears within a minute: wait like for the quota
    const isRateLimit = !isDailyQuota && (classifiedErr.isRateLimit || ceraIsRateLimitError_(errMsgLower));

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

    // As above: a job reset meanwhile stays gone, a paused, stopped, or finalized one keeps its status (and this tick's progress)
    const storedStatus = ceraStoredJobStatus_(state.activityId);
    if (storedStatus === 'GONE') {
      Logger.log('Ingestion job was reset during this tick. Its progress is discarded.');
      return;
    }
    if (storedStatus === 'PAUSED' || storedStatus === 'STOPPED' || storedStatus === 'COMPLETED') {
      state.status = storedStatus;
      if (storedStatus === 'COMPLETED') {
        state.isCompleted = true;
        state.timeSpanPct = 100;
        state.etaSec = 0;
        state.estimatedRemainingSec = 0;
        if (partitions.length > 0) {
          partitions[partitions.length - 1].status = 'COMPLETED';
        }
      }
      saveStateToStorage(state);
      ceraFinalizeTickCtl_(state, executionStartTime, state.status, work.rows, work.requests, rawErrMsg);
      safeUpdateDashboard(ss, state, partitions);
      ceraRecordDiagTick_(state, work, tickDiag, storedStatus, rawErrMsg);
      return;
    }

    if (isDailyQuota || isRateLimit) {
      // ⏳ Daily Apps Script Quota or API Rate Limit hit: Enter Quota Sleep without failure penalty
      console.warn(`[Quota Sleep] ${isDailyQuota ? 'Google Apps Script daily runtime limit' : 'Google API rate limit'} reached: ${rawErrMsg}. Preserving state and trigger for auto-resume.`);
      state.status = 'QUOTA_PAUSED';
      // Shown in the dialog in the viewer's language; the raw reason stays in the logs
      state.errorMessage = '';
      state.errorKey = isDailyQuota ? 'mon.quotaDefault' : 'mon.err.rateLimit';
      state.consecutiveFailures = 0;
      ceraAppendFlightIncident_(isDailyQuota ? 'DAILY_QUOTA_SLEEP' : 'RATE_LIMIT_PAUSE', rawErrMsg);
      saveStateToStorage(state);
      ceraFinalizeTickCtl_(state, executionStartTime, state.status, work.rows, work.requests, state.errorKey);
      safeUpdateDashboard(ss, state, partitions);
      ceraRecordDiagTick_(state, work, tickDiag, isDailyQuota ? 'DAILY_QUOTA_SLEEP' : 'RATE_LIMIT_PAUSE', rawErrMsg);
    } else {
      const failCount = (Number(state.consecutiveFailures) || 0) + 1;
      state.consecutiveFailures = failCount;
      state.errorMessage = rawErrMsg;
      state.errorKey = '';
      ceraAppendFlightIncident_('TICK_ERROR', rawErrMsg);

      if (failCount < 10) {
        // Self-healing: keep trigger alive for next scheduled tick (allow up to 9 transient strikes)
        console.warn(`Transient batch notice (Strike ${failCount}/10). Preserving trigger for next tick: ${rawErrMsg}`);
        state.status = 'RUNNING';
        saveStateToStorage(state);
        ceraFinalizeTickCtl_(state, executionStartTime, state.status, work.rows, work.requests, rawErrMsg);
        safeUpdateDashboard(ss, state, partitions);
        ceraRecordDiagTick_(state, work, tickDiag, 'TRANSIENT_STRIKE_' + failCount, rawErrMsg);
      } else {
        // 10 consecutive failures: Safely pause triggers and notify user
        state.status = 'FAILED';
        cleanupAllIngestionTriggers('FAILED_MAX_STRIKES');
        saveStateToStorage(state);
        ceraFinalizeTickCtl_(state, executionStartTime, state.status, work.rows, work.requests, rawErrMsg);
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

// IDs kept for the edge millisecond: enough for a burst of up to 50 events sharing one millisecond, compacted to fit in 9 KB
const CERA_EDGE_ID_CAP = 50;

function ceraCompactEdgeId_(id) {
  const s = String(id || '');
  if (!s) return '';
  return s.length > 10 ? s.slice(-10) : s;
}

/**
 * Records an event taken from a stream. Pages come newest first, so the stream's edge is the oldest event taken in
 * its day slice; the uniqueQualifiers taken at exactly that millisecond are kept with it. The stream can then
 * restart after the edge without a pageToken (endTime = edge + 1 ms, skipping those IDs). Restarting at
 * edge - 1 ms instead would drop the events of that millisecond that were not taken yet.
 */
function ceraExtendEdge_(stream, ms, id) {
  if (isNaN(ms)) return;
  const compact = ceraCompactEdgeId_(id);
  if (!ceraHasEdge_(stream) || ms < stream.edgeMs) {
    stream.edgeMs = ms;
    stream.edgeIds = compact ? [compact] : [];
  } else if (ms === stream.edgeMs && compact) {
    stream.edgeIds = stream.edgeIds || [];
    if (stream.edgeIds.length < CERA_EDGE_ID_CAP && stream.edgeIds.indexOf(compact) === -1) {
      stream.edgeIds.push(compact);
    }
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
  if (ms > stream.edgeMs) return true;
  if (ms !== stream.edgeMs || !id) return false;
  const ids = stream.edgeIds || [];
  const compact = ceraCompactEdgeId_(id);
  return ids.indexOf(compact) !== -1 || ids.indexOf(String(id)) !== -1;
}

// ==============================================================================
// REMAINING-WORK ESTIMATE (progress and ETA)
// ==============================================================================

// Finished active days at which the pre-flight plan and the measured volume weigh equally in the estimate (2 days on a 7-day window)
var CERA_ETA_PLAN_DAYS = (typeof globalThis !== 'undefined' && globalThis.OVERRIDE_ETA_PLAN_DAYS) || 2;

/**
 * The plan saved by the pre-flight for the same range, if it ran within the last 2 hours.
 */
function ceraLoadPreflightPlan_(days) {
  try {
    const plan = JSON.parse(PropertiesService.getDocumentProperties().getProperty(CERA_PREFLIGHT_PLAN_KEY) || 'null');
    if (!plan || Number(plan.days) !== Number(days) || Date.now() - Number(plan.savedMs) > CERA_PREFLIGHT_PLAN_TTL_MS) return null;
    return {
      startMs: Number(plan.startMs),
      weeks: String(plan.weeks || ''),
      perDay: plan.perDay || {},
      total: Number(plan.total) || 0,
      etaSec: Number(plan.etaSec) || 0,
      isExact: Boolean(plan.isExact),
      zeroStreams: plan.zeroStreams || null
    };
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
  // Empty days before the first event when the plan also expected 0 say nothing about volume;
  // when the plan expected events (day[0] > 0) and actual was 0, record it for downward calibration
  if (!state.recentDays && day[0] === 0 && day[1] === 0) return;
  state.recentDays = (state.recentDays || []).concat([day]).slice(-7);
  const calib = state.calib || [0, 0, 0];
  state.calib = [calib[0] + 1, calib[1] + day[0], calib[2] + day[1]];
}

/**
 * Records this tick's work and cost, then estimates what is left. Returns null without a pre-flight plan.
 *
 * Rows left: combines the pre-flight per-day plan with measured daily volume from finished active days (starting from
 * Day 1) and symmetric intra-day progress from each stream's timestamp edge. Never inflates future days when early
 * days are quieter than planned.
 * Cost: seconds per request and per row measured over the last 3 ticks, bounded by physical Apps Script limits so a
 * sparse tick cannot explode the remaining wall-clock estimate.
 */
function ceraUpdateWorkEstimate_(state, work, tickStartMs, tickEndMs, cursorMs, targetEndMs, eventStreams, totalScanned) {
  // Wall time per tick includes the gap until the next trigger; the first tick has no previous one to measure from
  const workMs = tickEndMs - tickStartMs;
  const wallMs = state.lastTickEndMs
    ? Math.min(360000, Math.max(tickEndMs - Number(state.lastTickEndMs), workMs))
    : Math.max(workMs, workMs * 60000 / Math.max(30000, TIME_BUDGET_MS));
  state.lastTickEndMs = tickEndMs;
  state.requestsDone = (Number(state.requestsDone) || 0) + work.requests;
  state.recentTicks = (state.recentTicks || []).concat([{ r: work.requests, rm: work.requestMs, w: work.rows, wm: work.writeMs, wall: wallMs }]).slice(-3);

  const plan = state.plan;
  if (!plan) return null;

  const sum = key => state.recentTicks.reduce((a, t) => a + (Number(t[key]) || 0), 0);
  const rawSecPerReq = sum('r') > 0 ? sum('rm') / sum('r') / 1000 : 0.5;
  const secPerRequest = Math.min(120.0, Math.max(0.2, rawSecPerReq));
  const rawSecPerRow = sum('w') >= 500 ? sum('wm') / sum('w') / 1000 : LEGACY_SHEET_WRITE_SEC_PER_PAGE / 1000;
  const secPerRow = Math.min(0.5, Math.max(0.0005, rawSecPerRow));
  const busyMs = sum('rm') + sum('wm');
  const defaultDuty = 60000 / Math.max(30000, TIME_BUDGET_MS);
  const rawWallPerBusy = busyMs >= 4000 ? sum('wall') / busyMs : defaultDuty;
  const wallPerBusy = Math.min(8.0, Math.max(1.05, rawWallPerBusy));

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
        if (Number(st.edgeMs) > cursorMs && Number(st.edgeMs) < sliceEndMs) {
          const linearFrac = (sliceEndMs - Number(st.edgeMs)) / Math.max(1, sliceEndMs - cursorMs);
          // Floor coveredFrac at 0.12 so an early peak-hour burst never extrapolates by 19x
          const coveredFrac = Math.min(0.98, Math.max(0.12, linearFrac));
          if (dayRows > 0 && dayRows >= plannedDayRows) {
            left = Math.max(0, Math.round(dayRows * (1 - coveredFrac) / coveredFrac));
          } else if (coveredFrac >= 0.20 && plannedDayRows > 0 && dayRows < plannedDayRows * coveredFrac * 0.85) {
            // Symmetric intra-day downward adjustment when >=20% of the slice is scanned at a lower rate than planned
            const empiricalLeft = Math.max(0, Math.round(dayRows * (1 - coveredFrac) / coveredFrac));
            const plannedLeft = Math.max(0, plannedDayRows - dayRows);
            const trust = Math.min(1, (coveredFrac - 0.15) / 0.65);
            left = Math.max(0, Math.round((1 - trust) * plannedLeft + trust * empiricalLeft));
          }
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
  // Two-way calibration from Day 1 (calib[0] >= 1): triggers when actual volume diverges by >2.5x up or down
  const planIsOff = (calib[0] >= 1 && (cumRatio > 2.5 || cumRatio < 0.4)) ||
    (planTotal > 0 && totalScanned > planTotal * 1.15) ||
    (planTotal === 0 && totalScanned > 0);
  const recent = state.recentDays || [];
  const recentExpected = recent.reduce((a, d) => a + d[0], 0);
  const recentActual = recent.reduce((a, d) => a + d[1], 0);
  const measured = recent.length >= 1
    ? (recentExpected > 0 ? remaining(recentActual / recentExpected) : remaining(1, recentActual / recent.length / TARGET_EVENTS.length))
    : null;
  const raw = remaining(1);
  // Never inflate remaining days above 1.0x when early days are quieter than an estimated plan
  const rawScale = raw.rows > 0 ? Math.max(0, planTotal - totalScanned) / raw.rows : 1;
  const scale = plan.isExact ? rawScale : Math.min(1, rawScale);
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
  const rawEtaSec = Math.round(remainingSec * wallPerBusy);
  const prevEtaSec = Number(state.etaSec || 0);
  let finalEtaSec = rawEtaSec;
  if (prevEtaSec > 0 && state.recentTicks.length >= 2) {
    const predictedEtaSec = Math.max(0, prevEtaSec - Math.round(wallMs / 1000));
    if (predictedEtaSec > 0) {
      finalEtaSec = Math.round(0.45 * rawEtaSec + 0.55 * predictedEtaSec);
    }
  }
  return {
    etaSec: finalEtaSec,
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

/**
 * Classifies an Admin SDK / Sheets / Apps Script error by HTTP status code and structured Google API reason tokens first,
 * falling back to localized runtime quota pattern matching only for Apps Script runtime exceptions that carry no HTTP code.
 */
function ceraClassifyIngestionError_(err) {
  let msg = '';
  let httpCode = 0;
  let apiReason = '';
  if (err && typeof err === 'object') {
    msg = String(err.message || err);
    httpCode = Number((err.details && err.details.code) || err.code || err.statusCode || 0);
    if (err.details && Array.isArray(err.details.errors) && err.details.errors[0]) {
      apiReason = String(err.details.errors[0].reason || '');
    }
  } else {
    msg = String(err || '');
  }
  const m = msg.toLowerCase();
  if (!httpCode) {
    const codeMatch = /\b(400|401|403|404|408|429|500|502|503|504)\b/.exec(m);
    if (codeMatch) httpCode = Number(codeMatch[1]);
  }
  const rLower = apiReason.toLowerCase();
  const isDailyToken = rLower === 'dailylimitexceeded' || m.includes('dailylimitexceeded') || m.includes('daily limit exceeded');
  let isDailyQuota = isDailyToken;
  if (!isDailyQuota) {
    for (let i = 0; i < CERA_DAILY_QUOTA_PATTERNS.length; i++) {
      if (m.includes(CERA_DAILY_QUOTA_PATTERNS[i].toLowerCase())) {
        isDailyQuota = true;
        break;
      }
    }
  }
  const isRateToken = httpCode === 429 ||
    rLower === 'ratelimitexceeded' || rLower === 'userratelimitexceeded' || rLower === 'quotaexceeded' || rLower === 'resource_exhausted' ||
    m.includes('429') || m.includes('limitexceeded') || m.includes('limit exceeded') || m.includes('rate limit') ||
    m.includes('user rate') || m.includes('quota') || m.includes('too many requests') || m.includes('resource_exhausted');
  const isRateLimit = !isDailyQuota && isRateToken;
  const isInvalidToken = (httpCode === 400 || m.includes('400')) && (m.includes('pagetoken') || m.includes('invalid token') || rLower === 'invalid');
  const isPermission = !isDailyQuota && !isRateLimit && (
    httpCode === 401 || httpCode === 403 ||
    rLower === 'forbidden' || rLower === 'insufficientpermissions' || rLower === 'autherror' || rLower === 'permission_denied' || rLower === 'unauthenticated' ||
    m.includes('401') || m.includes('403') || m.includes('permission') || m.includes('forbidden') || m.includes('not authorized') || m.includes('unauthorized')
  );
  const isNotFound = httpCode === 404 || rLower === 'notfound' || m.includes('404') || m.includes('not found');
  let category = 'TRANSIENT';
  if (isDailyQuota) category = 'API_DAILY_QUOTA';
  else if (isRateLimit) category = 'RATE_LIMIT';
  else if (isInvalidToken) category = 'TOKEN_INVALID';
  else if (isPermission) category = 'AUTH';
  else if (isNotFound) category = 'PARTITION_MISSING';
  else if (httpCode === 400) category = 'BAD_REQUEST';
  return {
    category: category,
    httpStatus: httpCode,
    reason: apiReason || category,
    retryable: category === 'TRANSIENT' || category === 'RATE_LIMIT',
    isDailyQuota: isDailyQuota,
    isRateLimit: isRateLimit,
    isPermission: isPermission,
    isInvalidToken: isInvalidToken,
    isNotFound: isNotFound
  };
}

function ceraIsDailyQuotaError_(message) {
  return ceraClassifyIngestionError_(message).isDailyQuota;
}

/**
 * Rate limits and quotas: HTTP 429, or a 403 for rateLimitExceeded, userRateLimitExceeded or a quota. They clear
 * with time, so they are retried with backoff (and end a tick as QUOTA_PAUSED), never treated as a permission error.
 */
function ceraIsRateLimitError_(message) {
  const c = ceraClassifyIngestionError_(message);
  return c.isRateLimit || c.isDailyQuota;
}

/**
 * Permission errors (401, or a 403 that is not a rate limit): retrying cannot fix them.
 */
function ceraIsPermissionError_(message) {
  return ceraClassifyIngestionError_(message).isPermission;
}

const CERA_SAFE_REPORTS_FIELDS = 'nextPageToken,items(id(time,uniqueQualifier),actor(email),events(name,parameters))';
const CERA_EGRESS_FILTERED_EVENTS = ['CONTENT_TRANSFER', 'SENSITIVE_DATA_TRANSFER', 'CONTENT_UNSCANNED'];
const CERA_REPORTS_EGRESS_FILTER = 'TRIGGER_TYPE!=FILE_DOWNLOAD';

/**
 * True when a transfer-stream row (CONTENT_TRANSFER, SENSITIVE_DATA_TRANSFER, CONTENT_UNSCANNED) represents
 * a non-egress action (FILE_DOWNLOAD or CLIPBOARD_COPY). Never filters MALWARE_TRANSFER or security signals.
 */
function ceraIsNonEgressTransferRow_(queryEventName, parsedRow) {
  if (!parsedRow || CERA_EGRESS_FILTERED_EVENTS.indexOf(String(queryEventName || '').toUpperCase()) === -1) {
    return false;
  }
  const rawTrig = String(parsedRow[8] || parsedRow[9] || '').trim().toUpperCase().replace(/\s+/g, '_');
  return rawTrig === 'FILE_DOWNLOAD' || rawTrig === 'CLIPBOARD_COPY';
}

/**
 * Fetch page from Google Admin SDK Reports API. Always passes startTime and endTime alongside pageToken so the
 * Reports API stays bounded to the requested slice window on page 2+.
 */
function fetchChromeLogPage(pageToken, startTimeIso, currentLogTimestampMs, eventName, maxResults, endTimeIso) {
  const evName = eventName || 'CONTENT_TRANSFER';
  const options = {
    userKey: 'all',
    applicationName: 'chrome',
    maxResults: maxResults || 1000,
    eventName: evName,
    fields: CERA_SAFE_REPORTS_FIELDS
  };

  if (!pageToken && CERA_EGRESS_FILTERED_EVENTS.indexOf(evName) !== -1) {
    options.filters = CERA_REPORTS_EGRESS_FILTER;
  }

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
      const classified = ceraClassifyIngestionError_(e);
      const errMsg = (e.message || String(e)).toLowerCase();
      if ((options.fields || options.filters) && !options.pageToken &&
          (classified.httpStatus === 400 || errMsg.includes('invalid') || errMsg.includes('field') || errMsg.includes('filter'))) {
        if (options.filters && (errMsg.includes('filter') || errMsg.includes('parameter') || !errMsg.includes('field'))) {
          delete options.filters;
        } else {
          delete options.fields;
        }
        return AdminReports.Activities.list('all', 'chrome', options);
      }
      // Checked first: a rate limit can come as a 403, and it clears with time
      const isRateLimit = classified.isRateLimit || ceraIsRateLimitError_(errMsg);
      const isFatal = !isRateLimit && (classified.isPermission || classified.isInvalidToken || classified.isNotFound ||
        errMsg.includes('400') || errMsg.includes('pagetoken') || errMsg.includes('404') || errMsg.includes('403'));

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
 * Separates DETECTOR_ID from human-readable DETECTOR_NAME so detectorIds never pollute Detector Name (col 3).
 */
function extractAdminSdkParameters(params) {
  const res = {
    eventReason: '',
    eventResult: '',
    detectors: [],
    detectorIds: [],
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

  const addDetectorIds = (val) => {
    if (!val) return;
    const parts = String(val).split(',').map(s => s.trim()).filter(Boolean);
    parts.forEach(d => {
      if (!res.detectorIds.includes(d)) res.detectorIds.push(d);
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
      const isIdField = cleanName === 'DETECTOR_ID' || cleanName === 'MATCHED_DETECTOR_IDS' || cleanName.endsWith('_DETECTOR_ID') || cleanName.endsWith('_ID');
      if (val) {
        if (isIdField) addDetectorIds(val);
        else addDetectors(val);
      }
      if (p.multiMessageValue && Array.isArray(p.multiMessageValue)) {
        p.multiMessageValue.forEach(msg => {
          if (msg && msg.parameter) {
            msg.parameter.forEach(subP => {
              const subName = (subP.name || '').toUpperCase().replace(/^CHROME\./, '');
              if (!subP.value) return;
              if (subName === 'DETECTOR_ID' || subName === 'ID' || subName.endsWith('_ID')) {
                addDetectorIds(subP.value);
              } else if (subName.includes('DETECTOR') || subName.includes('NAME')) {
                addDetectors(subP.value);
              }
            });
          }
        });
      }
      if (p.messageValue && p.messageValue.parameter) {
        p.messageValue.parameter.forEach(subP => {
          const subName = (subP.name || '').toUpperCase().replace(/^CHROME\./, '');
          if (!subP.value) return;
          if (subName === 'DETECTOR_ID' || subName === 'ID' || subName.endsWith('_ID')) {
            addDetectorIds(subP.value);
          } else if (subName.includes('DETECTOR') || subName.includes('NAME')) {
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

  // Fallback to DETECTOR_ID only when human-readable DETECTOR_NAME is absent (F9)
  if (res.detectors.length === 0 && res.detectorIds.length > 0) {
    res.detectors = res.detectorIds.slice();
  }

  return res;
}

/**
 * Parse Admin SDK activity event into a 19-column partition row (PARTITION_HEADERS)
 */
function parseEventToRow(event, queryEventName) {
  const time = event.id ? event.id.time : '';
  const eventId = (event.id && event.id.uniqueQualifier !== undefined && event.id.uniqueQualifier !== null)
    ? String(event.id.uniqueQualifier)
    : '';
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
    switches.join('\n'),
    eventId
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
  // The new spreadsheet has one sheet (sheetId 0) titled in the user's language: name it Sheet1, where positional
  // updates write, pre-sized to MAX_ROWS_PER_SHEET + 1 rows and one column per header (Q3a-C). Retried like the
  // creation, so a transient error does not fail the run and leave an unnamed partition behind.
  const initialGridRows = Math.max(2, (Number(MAX_ROWS_PER_SHEET) || 50000) + 1);
  const sheetSetup = {
    requests: [{
      updateSheetProperties: {
        properties: { sheetId: 0, title: 'Sheet1', gridProperties: { rowCount: initialGridRows, columnCount: PARTITION_HEADERS.length } },
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

  flushBufferWithRetry(fileId, [PARTITION_HEADERS.slice()], 0, null, 1);

  return { fileId: fileId, fileName: fileName };
}

/**
 * Flush Buffer with Adaptive Binary Splitting and Exponential Backoff Retry
 * Resilient against: Empty response, 503, 500, 502, 504, 429, Quota, Rate Limit, Socket/Network hiccups
 * Uses valueInputOption: 'RAW' to bypass server formula evaluation (10x-15x faster and zero gateway timeouts)
 * progress.written (optional) counts the rows appended so far, in order, so a caller knows how far a split
 * batch got when a later half fails
 */
function flushBufferWithRetry(fileId, dataRows, depth, progress, startRowOffset) {
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
      if (startRowOffset >= 1 && typeof Sheets !== 'undefined' && Sheets.Spreadsheets && Sheets.Spreadsheets.Values && typeof Sheets.Spreadsheets.Values.update === 'function') {
        const endRowOffset = startRowOffset + sanitizedRows.length - 1;
        const endColLetter = String.fromCharCode(64 + PARTITION_HEADERS.length);
        Sheets.Spreadsheets.Values.update(
          resource,
          fileId,
          `Sheet1!A${startRowOffset}:${endColLetter}${endRowOffset}`,
          { valueInputOption: 'RAW' }
        );
      } else {
        Sheets.Spreadsheets.Values.append(
          resource,
          fileId,
          'Sheet1!A1',
          { valueInputOption: 'RAW' } // ⚡ RAW mode: skips formula & type parsing, 10x faster & zero timeout
        );
      }
      if (progress) progress.written += sanitizedRows.length;
      return sanitizedRows.length;
    } catch (e) {
      const classified = ceraClassifyIngestionError_(e);
      const errMsg = (e.message || String(e)).toLowerCase();

      // Self-healing grid expansion (BP-06 / Q3a-C): if Values.update hits a 1-row legacy partition or grid limit,
      // expand Sheet1's grid immediately and retry Values.update in the same attempt.
      if (startRowOffset >= 1 && (errMsg.includes('exceeds grid limits') || errMsg.includes('grid limits')) &&
          typeof Sheets !== 'undefined' && Sheets.Spreadsheets && typeof Sheets.Spreadsheets.batchUpdate === 'function' &&
          Sheets.Spreadsheets.Values && typeof Sheets.Spreadsheets.Values.update === 'function') {
        try {
          const endRowOffset = startRowOffset + sanitizedRows.length - 1;
          const targetGridRows = Math.max(endRowOffset + 1000, (Number(MAX_ROWS_PER_SHEET) || 50000) + 1);
          console.warn(`[Self-Healing Grid] Expanding Sheet1 grid of ${fileId} to ${targetGridRows} rows after grid-limit notice...`);
          Sheets.Spreadsheets.batchUpdate({
            requests: [{
              updateSheetProperties: {
                properties: {
                  sheetId: 0,
                  gridProperties: { rowCount: targetGridRows, columnCount: PARTITION_HEADERS.length }
                },
                fields: 'gridProperties.rowCount,gridProperties.columnCount'
              }
            }]
          }, fileId);
          const endColLetter = String.fromCharCode(64 + PARTITION_HEADERS.length);
          Sheets.Spreadsheets.Values.update(
            resource,
            fileId,
            `Sheet1!A${startRowOffset}:${endColLetter}${endRowOffset}`,
            { valueInputOption: 'RAW' }
          );
          if (progress) progress.written += sanitizedRows.length;
          return sanitizedRows.length;
        } catch (expandErr) {
          console.warn(`[Self-Healing Grid] Grid expansion retry notice: ${expandErr.message || expandErr}`);
        }
      }

      // Checked first: a rate limit or quota can come as a 403, and it clears with time
      const isRateLimit = classified.isRateLimit || ceraIsRateLimitError_(errMsg);
      const isFatal = !isRateLimit && (classified.isNotFound || classified.isPermission ||
                      errMsg.includes('404') || errMsg.includes('not found') ||
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
        const nextOffset2 = startRowOffset >= 1 ? startRowOffset + part1.length : undefined;
        const written1 = flushBufferWithRetry(fileId, part1, depth + 1, progress, startRowOffset);
        const written2 = flushBufferWithRetry(fileId, part2, depth + 1, progress, nextOffset2);
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
          const nextOffset2 = startRowOffset >= 1 ? startRowOffset + part1.length : undefined;
          const written1 = flushBufferWithRetry(fileId, part1, depth + 1, progress, startRowOffset);
          const written2 = flushBufferWithRetry(fileId, part2, depth + 1, progress, nextOffset2);
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
    let viewState = state ? Object.assign({}, state) : state;
    if (viewState && !viewState.logFolderUrl && viewState.folderId) {
      const diagMeta = ceraGetDiagLogMeta_(viewState.folderId);
      if (diagMeta && diagMeta.logFolderUrl) {
        viewState.logFolderUrl = diagMeta.logFolderUrl;
      }
    }
    if (viewState && !viewState.healthState && typeof ceraComputeJobHealth_ === 'function') {
      try {
        const health = ceraComputeJobHealth_(viewState, ceraLoadJobCtl_());
        if (health) {
          viewState.healthState = health.healthState;
          if (viewState.isStalled === undefined) viewState.isStalled = health.isStalled;
          if (viewState.heartbeatAgeSec === undefined) viewState.heartbeatAgeSec = health.heartbeatAgeSec;
        }
      } catch (hErr) {}
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
  cleanupAllIngestionTriggers('STATE_TOO_LARGE');
  state.status = 'FAILED';
  state.errorKey = 'mon.err.stateTooLarge';
  state.errorMessage = ceraT('mon.err.stateTooLarge');
  ceraUpdateJobCtlStatus_(state, 'FAILED', 'STATE_TOO_LARGE');
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
 * Tri-state DocumentProperties read with 3-attempt transient retry (150ms, 350ms, 750ms).
 * Returns { status: 'PRESENT' | 'MISSING' | 'UNREADABLE', value: string|null, error: Error|null }.
 * Never confuses a transient PropertiesService read error with a missing session.
 */
function ceraReadPropTriState_(props, key) {
  const store = props || (typeof PropertiesService !== 'undefined' ? PropertiesService.getDocumentProperties() : null);
  if (!store || typeof store.getProperty !== 'function') {
    return { status: 'UNREADABLE', state: 'UNREADABLE', value: null, error: new Error('DocumentProperties store unavailable') };
  }
  const delays = [150, 350, 750];
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const val = store.getProperty(key);
      if (val === null || val === undefined || val === '') {
        return { status: 'MISSING', state: 'ABSENT', value: null, error: null };
      }
      return { status: 'PRESENT', state: 'PRESENT', value: String(val), error: null };
    } catch (err) {
      lastErr = err;
      if (attempt < 3) {
        try { Utilities.sleep(delays[attempt - 1]); } catch (_) {}
      }
    }
  }
  return { status: 'UNREADABLE', state: 'UNREADABLE', value: null, error: lastErr };
}

/**
 * Loads `CERA_JOB_CTL` (~0.8 KB control & liveness record) from DocumentProperties.
 */
function ceraLoadJobCtl_() {
  try {
    const res = ceraReadPropTriState_(PropertiesService.getDocumentProperties(), 'CERA_JOB_CTL');
    if (res.status === 'PRESENT' && res.value) {
      return JSON.parse(res.value);
    }
  } catch (e) {}
  return null;
}

/**
 * Saves `CERA_JOB_CTL` to DocumentProperties.
 */
function ceraSaveJobCtl_(ctl) {
  if (!ctl) return false;
  try {
    ctl.rev = (Number(ctl.rev) || 0) + 1;
    ctl.updatedMs = Date.now();
    PropertiesService.getDocumentProperties().setProperty('CERA_JOB_CTL', JSON.stringify(ctl));
    return true;
  } catch (e) {
    console.warn('ceraSaveJobCtl_ notice: ' + (e.message || e));
    return false;
  }
}

/**
 * Initializes `CERA_JOB_CTL` when a new Direct Ingestion job is engaged.
 */
function ceraInitJobCtl_(state) {
  if (!state) return null;
  const nowMs = Date.now();
  let ssId = '';
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss && typeof ss.getId === 'function') ssId = String(ss.getId() || '');
  } catch (e) {}
  const ctl = {
    activityId: state.activityId || '',
    spreadsheetId: ssId || state.hostSpreadsheetId || '',
    folderId: state.folderId || '',
    ownerEmail: state.userEmail || '',
    status: state.status || 'RUNNING',
    rev: 1,
    createdMs: nowMs,
    updatedMs: nowMs,
    heartbeatMs: nowMs,
    lastHeartbeatMs: nowMs,
    lastProgressMs: nowMs,
    leaseHolder: '',
    leaseUntilMs: 0,
    runStartMs: 0,
    runEndMs: 0,
    ticksExecuted: 0,
    killedTicks: 0,
    lockSkips: 0,
    readStrikes: 0,
    healCount: 0,
    resumeCount: 0,
    lastHealMs: 0,
    quotaResumeAtMs: 0,
    ledger24hMs: 0,
    lastErrorCode: '',
    lastErrorMsg: ''
  };
  ceraSaveJobCtl_(ctl);
  return ctl;
}

/**
 * Updates `CERA_JOB_CTL` status and optional reason/error code.
 */
function ceraUpdateJobCtlStatus_(state, status, reasonCode) {
  try {
    const nowMs = Date.now();
    let ctl = ceraLoadJobCtl_();
    if (!ctl && state) ctl = ceraInitJobCtl_(state);
    if (!ctl) return;
    if (status) ctl.status = status;
    ctl.heartbeatMs = nowMs;
    ctl.lastHeartbeatMs = nowMs;
    if (reasonCode) ctl.lastReason = String(reasonCode);
    if (state && state.quotaResumeAtIso) {
      const qMs = Date.parse(state.quotaResumeAtIso);
      if (Number.isFinite(qMs)) ctl.quotaResumeAtMs = qMs;
    } else if (status === 'RUNNING' || status === 'COMPLETED') {
      ctl.quotaResumeAtMs = 0;
    }
    ceraSaveJobCtl_(ctl);
  } catch (e) {}
}

/**
 * Acquires the tick execution lease in `CERA_JOB_CTL` and detects if the previous run was hard-killed by Apps Script's 6-minute wall limit.
 */
function ceraAcquireTickLease_(state, runId) {
  const nowMs = Date.now();
  let ctl = ceraLoadJobCtl_();
  if (!ctl) ctl = ceraInitJobCtl_(state);
  if (!ctl) return { acquired: true, killedPrevious: false };

  // Foreign-owner guard: if another user's trigger fires on a session owned by a different user, do not interleave writes
  let effEmail = '';
  try {
    effEmail = Session.getEffectiveUser().getEmail() || '';
  } catch (e) {}
  if (ctl.ownerEmail && effEmail && ctl.ownerEmail.toLowerCase() !== effEmail.toLowerCase()) {
    ceraAppendFlightIncident_('FOREIGN_OWNER_SKIPPED', 'Tick skipped due to owner mismatch.');
    return { acquired: false, reason: 'FOREIGN_OWNER', killedPrevious: false };
  }

  let killedPrevious = false;
  if (ctl.runStartMs > 0 && ctl.runEndMs < ctl.runStartMs) {
    if (ctl.leaseUntilMs > nowMs && ctl.leaseHolder && ctl.leaseHolder !== runId) {
      return { acquired: false, reason: 'LEASE_ACTIVE', killedPrevious: false };
    }
    killedPrevious = true;
    ctl.killedTicks = (Number(ctl.killedTicks) || 0) + 1;
    ceraAppendFlightIncident_('TICK_KILLED', 'Previous tick exceeded runtime limit without clean finalize.');
  }

  ctl.leaseHolder = String(runId || 'tick');
  ctl.leaseUntilMs = nowMs + CERA_EXTRACTION_LEASE_MS;
  ctl.runStartMs = nowMs;
  ctl.heartbeatMs = nowMs;
  ctl.lastHeartbeatMs = nowMs;
  ctl.status = (state && state.status) || ctl.status || 'RUNNING';
  ceraSaveJobCtl_(ctl);
  return { acquired: true, killedPrevious: killedPrevious };
}

/**
 * Finalizes the tick execution lease in `CERA_JOB_CTL` and appends a compact tuple to `CERA_FR_HOT` / `CERA_FR_RING`.
 */
function ceraFinalizeTickCtl_(state, runId, status, rowsWritten, apiCalls, errorCode) {
  try {
    const nowMs = Date.now();
    let ctl = ceraLoadJobCtl_();
    if (!ctl && state) ctl = ceraInitJobCtl_(state);
    if (!ctl) return;
    const durMs = ctl.runStartMs > 0 ? Math.max(0, nowMs - ctl.runStartMs) : 0;
    ctl.leaseHolder = '';
    ctl.leaseUntilMs = 0;
    ctl.runEndMs = nowMs;
    ctl.heartbeatMs = nowMs;
    ctl.lastHeartbeatMs = nowMs;
    if (Number(rowsWritten) > 0 || status === 'COMPLETED') {
      ctl.lastProgressMs = nowMs;
    }
    ctl.ticksExecuted = (Number(ctl.ticksExecuted) || 0) + 1;
    ctl.ledger24hMs = Math.min(86400000, (Number(ctl.ledger24hMs) || 0) + durMs);
    if (status) ctl.status = status;
    const cleanErr = errorCode ? ceraScrubText_(String(errorCode), 100) : '';
    if (cleanErr) {
      ctl.lastErrorCode = cleanErr;
      ctl.lastErrorMsg = ceraScrubText_((state && state.errorMessage) || cleanErr, 120);
    } else if (status === 'RUNNING' || status === 'COMPLETED') {
      ctl.lastErrorCode = '';
      ctl.lastErrorMsg = '';
    }
    if (state && state.quotaResumeAtIso) {
      const qMs = Date.parse(state.quotaResumeAtIso);
      if (Number.isFinite(qMs)) ctl.quotaResumeAtMs = qMs;
    } else if (status === 'RUNNING' || status === 'COMPLETED') {
      ctl.quotaResumeAtMs = 0;
    }
    ceraSaveJobCtl_(ctl);

    ceraAppendFlightHot_({
      t: nowMs,
      durMs: durMs,
      rows: Number(rowsWritten) || 0,
      api: Number(apiCalls) || 0,
      part: (state && state.fileIndex) || 1,
      pct: (state && state.timeSpanPct) || 0,
      st: status || (state && state.status) || 'RUNNING',
      err: cleanErr
    });
  } catch (e) {}
}

/**
 * Records a skipped tick when LockService.tryLock(0) is busy or unavailable.
 */
function ceraRecordLockSkipped_() {
  try {
    ceraAppendBeat_({ t: Date.now(), kind: 'SKIP_LOCK' });
    const ctl = ceraLoadJobCtl_();
    if (ctl) {
      ctl.lockSkips = (Number(ctl.lockSkips) || 0) + 1;
      ceraSaveJobCtl_(ctl);
    }
  } catch (e) {}
}

/**
 * Records a transient DocumentProperties read failure without wiping session state or deleting triggers.
 */
function ceraRecordTransientReadStrike_(err) {
  try {
    ceraAppendBeat_({ t: Date.now(), kind: 'READ_ERR', err: ceraScrubText_(err && err.message ? err.message : String(err || ''), 80) });
    const ctl = ceraLoadJobCtl_();
    if (ctl) {
      ctl.readStrikes = (Number(ctl.readStrikes) || 0) + 1;
      ceraSaveJobCtl_(ctl);
    }
  } catch (e) {}
}

/**
 * Appends a heartbeat entry to `CERA_JOB_BEAT` (capped at 10 entries, < 800 bytes).
 */
function ceraAppendBeat_(beatObj) {
  try {
    const props = PropertiesService.getDocumentProperties();
    let list = [];
    try {
      const raw = props.getProperty('CERA_JOB_BEAT');
      if (raw) list = JSON.parse(raw);
      if (!Array.isArray(list)) list = [];
    } catch (_) { list = []; }
    list.push(beatObj);
    if (list.length > 10) list = list.slice(-10);
    props.setProperty('CERA_JOB_BEAT', JSON.stringify(list));
  } catch (e) {}
}

/**
 * Appends a tick summary entry to `CERA_FR_HOT` and `CERA_FR_RING` (capped at 30 entries, < 4.5 KB).
 */
function ceraAppendFlightHot_(entryObj) {
  try {
    const props = PropertiesService.getDocumentProperties();
    let list = [];
    try {
      const raw = props.getProperty('CERA_FR_HOT') || props.getProperty('CERA_FR_RING');
      if (raw) list = JSON.parse(raw);
      if (!Array.isArray(list)) list = [];
    } catch (_) { list = []; }
    list.push(entryObj);
    if (list.length > 30) list = list.slice(-30);
    const serialized = JSON.stringify(list);
    props.setProperty('CERA_FR_HOT', serialized);
    props.setProperty('CERA_FR_RING', serialized);
  } catch (e) {}
}

/**
 * Appends a structured incident to `CERA_FR_INC` (first 5 pinned + last 20 entries, < 3.5 KB).
 */
function ceraAppendFlightIncident_(code, detail) {
  try {
    const props = PropertiesService.getDocumentProperties();
    let list = [];
    try {
      const raw = props.getProperty('CERA_FR_INC');
      if (raw) list = JSON.parse(raw);
      if (!Array.isArray(list)) list = [];
    } catch (_) { list = []; }
    list.push({
      t: new Date().toISOString(),
      code: String(code || 'INCIDENT'),
      detail: ceraScrubText_(detail || '', 120)
    });
    if (list.length > 25) {
      list = list.slice(0, 5).concat(list.slice(-20));
    }
    props.setProperty('CERA_FR_INC', JSON.stringify(list));
  } catch (e) {}
}

/**
 * Loads the durable partition registry (`CERA_PART_REG`) for the given job folderId.
 */
function ceraGetPartitionRegistry_(folderId) {
  try {
    const raw = PropertiesService.getDocumentProperties().getProperty('CERA_PART_REG');
    if (raw) {
      const reg = JSON.parse(raw);
      if (reg && (!folderId || !reg.folderId || reg.folderId === folderId) && Array.isArray(reg.partitions)) {
        return reg;
      }
    }
  } catch (e) {}
  return { folderId: folderId || '', partitions: [] };
}

/**
 * Registers a partition in `CERA_PART_REG` BEFORE rows are written to it (register-before-write).
 * Supports both 6-arg `(folderId, fileIndex, fileId, fileName, status, rows)` and 4-arg `(fileId, fileName, fileIndex, rows)`.
 */
function ceraRegisterPartition_(folderId, fileIndex, fileId, fileName, status, rows) {
  try {
    let fldId = folderId;
    let idx = fileIndex;
    let fId = fileId;
    let fName = fileName;
    let st = status;
    let r = rows;
    if (arguments.length === 4 && typeof fileId === 'number') {
      fId = folderId;
      fName = fileIndex;
      idx = fileId;
      r = fileName;
      fldId = '';
      st = 'IN_PROGRESS';
    }
    const reg = ceraGetPartitionRegistry_(fldId);
    if (fldId) reg.folderId = fldId;
    const partIdx = Number(idx) || 1;
    let entry = reg.partitions.find(p => Number(p.index) === partIdx || (fId && p.fileId === fId));
    if (!entry) {
      entry = { index: partIdx, fileId: fId || '', fileName: fName || '', rows: Number(r) || 0, status: st || 'IN_PROGRESS' };
      reg.partitions.push(entry);
    } else {
      if (fId) entry.fileId = fId;
      if (fName) entry.fileName = fName;
      if (r !== undefined) entry.rows = Number(r) || 0;
      if (st) entry.status = st;
    }
    if (reg.partitions.length > 60) reg.partitions = reg.partitions.slice(-60);
    PropertiesService.getDocumentProperties().setProperty('CERA_PART_REG', JSON.stringify(reg));
  } catch (e) {}
}

/**
 * Updates the committed row count and status of a partition in `CERA_PART_REG`.
 * Supports both 6-arg `(folderId, fileIndex, fileId, fileName, rows, status)` and 3-arg `(fileId, rows, status)`.
 */
function ceraUpdatePartitionRows_(folderId, fileIndex, fileId, fileName, rows, status) {
  if (arguments.length === 3 && typeof fileIndex === 'number') {
    const fId = folderId;
    const r = fileIndex;
    const st = fileId || 'IN_PROGRESS';
    try {
      const reg = ceraGetPartitionRegistry_('');
      const entry = reg.partitions.find(p => p.fileId === fId) || reg.partitions[reg.partitions.length - 1];
      if (entry) {
        entry.rows = Number(r) || 0;
        entry.status = st;
        PropertiesService.getDocumentProperties().setProperty('CERA_PART_REG', JSON.stringify(reg));
        return;
      }
    } catch (e) {}
  }
  ceraRegisterPartition_(folderId, fileIndex, fileId, fileName, status || 'IN_PROGRESS', rows);
}

/**
 * Computes job liveness and health signals from `SIERRA_SESSION` and `CERA_JOB_CTL`.
 */
function ceraComputeJobHealth_(state, ctl) {
  const nowMs = Date.now();
  const status = (state && state.status) ? String(state.status) : ((ctl && ctl.status) ? String(ctl.status) : 'IDLE');
  if (!state || status === 'IDLE') {
    return {
      healthState: 'IDLE',
      isStalled: false,
      heartbeatAgeSec: null,
      lastHeartbeatIso: '',
      ownerMatch: true,
      triggerCount: 0,
      quotaResumeAtIso: '',
      healthChecks: []
    };
  }

  let ssId = '';
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss && typeof ss.getId === 'function') ssId = String(ss.getId() || '');
  } catch (e) {}

  const boundSsId = (ctl && ctl.spreadsheetId) || state.hostSpreadsheetId || '';
  if (boundSsId && ssId && boundSsId !== ssId) {
    return {
      healthState: 'FOREIGN',
      isStalled: false,
      heartbeatAgeSec: null,
      lastHeartbeatIso: '',
      ownerMatch: false,
      triggerCount: 0,
      quotaResumeAtIso: '',
      healthChecks: [{ id: 'binding', status: 'WARN', code: 'FOREIGN_COPY' }]
    };
  }

  let currentEmail = '';
  try {
    currentEmail = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || '';
  } catch (e) {}
  const ownerEmail = (ctl && ctl.ownerEmail) || state.userEmail || '';
  const ownerMatch = !ownerEmail || !currentEmail || ownerEmail.toLowerCase() === currentEmail.toLowerCase();

  let triggerCount = -1;
  try {
    if (typeof ScriptApp !== 'undefined' && typeof ScriptApp.getProjectTriggers === 'function') {
      const triggers = ScriptApp.getProjectTriggers() || [];
      triggerCount = triggers.filter(t => t && typeof t.getHandlerFunction === 'function' && t.getHandlerFunction() === 'processCloudIngestionBatch').length;
    }
  } catch (e) {
    triggerCount = -1;
  }

  const ctlHbMs = Number((ctl && (ctl.heartbeatMs !== undefined ? ctl.heartbeatMs : ctl.lastHeartbeatMs)) || 0);
  const lastHbMs = ctlHbMs > 0
    ? ctlHbMs
    : Math.max(Number(state.lastUpdateMs || 0), Number((ctl && ctl.createdMs) || 0));
  const heartbeatAgeSec = lastHbMs > 0 ? Math.max(0, Math.round((nowMs - lastHbMs) / 1000)) : null;
  const lastHeartbeatIso = lastHbMs > 0 ? new Date(lastHbMs).toISOString() : '';
  const stallSec = Math.round(CERA_EXTRACTION_STALL_MS / 1000);
  const staleSec = Math.round(CERA_EXTRACTION_STALE_MS / 1000);
  const quotaResumeAtIso = state.quotaResumeAtIso || ((ctl && ctl.quotaResumeAtMs > nowMs) ? new Date(ctl.quotaResumeAtMs).toISOString() : '');

  let healthState = status;
  let isStalled = false;
  if (status === 'COMPLETED') {
    healthState = 'COMPLETED';
  } else if (status === 'QUOTA_PAUSED' || (quotaResumeAtIso && Date.parse(quotaResumeAtIso) > nowMs)) {
    healthState = 'WAITING_FOR_QUOTA';
  } else if (status === 'PAUSED') {
    healthState = 'PAUSED';
  } else if (status === 'FAILED') {
    healthState = 'FAILED';
  } else if (status === 'RUNNING') {
    const hbStalled = (heartbeatAgeSec !== null && heartbeatAgeSec >= stallSec);
    const missingTriggerAfterGrace = (triggerCount === 0 && (heartbeatAgeSec === null || heartbeatAgeSec >= 60));
    if (hbStalled || missingTriggerAfterGrace) {
      isStalled = true;
      healthState = ownerMatch ? 'STALLED' : 'NEEDS_OWNER';
    } else if (state.consecutiveFailures > 0 || (ctl && ctl.lastErrorCode)) {
      healthState = 'RETRYING';
    } else if ((ctl && (ctl.ticksExecuted || 0) === 0) && (state.processedCount || 0) === 0 && (heartbeatAgeSec === null || heartbeatAgeSec < 300)) {
      healthState = 'STARTING';
    } else {
      healthState = 'RUNNING';
    }
  }

  const healthChecks = [
    { id: 'trigger', status: triggerCount > 0 ? 'OK' : (triggerCount === 0 && status === 'RUNNING' ? 'ERR' : 'INFO'), detail: triggerCount >= 0 ? String(triggerCount) : 'NOT_VISIBLE' },
    { id: 'heartbeat', status: isStalled ? 'ERR' : (heartbeatAgeSec !== null && heartbeatAgeSec >= staleSec ? 'WARN' : 'OK'), detail: heartbeatAgeSec !== null ? (heartbeatAgeSec + 's') : 'N/A' },
    { id: 'owner', status: ownerMatch ? 'OK' : 'WARN', detail: ownerMatch ? 'OWNER' : 'NON_OWNER' }
  ];

  return {
    healthState: healthState,
    isStalled: isStalled,
    heartbeatAgeSec: heartbeatAgeSec,
    lastHeartbeatIso: lastHeartbeatIso,
    ownerMatch: ownerMatch,
    triggerCount: triggerCount >= 0 ? triggerCount : 0,
    quotaResumeAtIso: quotaResumeAtIso,
    healthChecks: healthChecks
  };
}

/**
 * Automatically repairs a missing or stale background ingestion trigger when the owner opens the workbook or Setup Dialog.
 */
function ceraMaybeAutoHealIngestionOnOpen_(source) {
  try {
    const docProps = PropertiesService.getDocumentProperties();
    const readRes = ceraReadPropTriState_(docProps, 'SIERRA_SESSION');
    if (readRes.status !== 'PRESENT' || !readRes.value) {
      return { checked: true, healed: false, reason: readRes.status };
    }
    const state = JSON.parse(readRes.value);
    if (!state || state.status !== 'RUNNING') {
      return { checked: true, healed: false, reason: 'NOT_RUNNING', status: (state && state.status) || 'IDLE' };
    }

    const ctl = ceraLoadJobCtl_();
    const health = ceraComputeJobHealth_(state, ctl);
    if (health.healthState === 'FOREIGN') {
      return { checked: true, healed: false, reason: 'FOREIGN_COPY', ownerMatch: false };
    }
    if (!health.ownerMatch) {
      ceraAppendFlightIncident_('AUTO_HEAL_SKIPPED_NON_OWNER', 'Non-owner opened stalled job (' + (source || 'open') + ').');
      return { checked: true, healed: false, reason: 'OWNER_MISMATCH', ownerMatch: false };
    }

    const healsSoFar = Number((ctl && (ctl.resumeCount !== undefined ? ctl.resumeCount : ctl.healCount)) || 0);
    if (healsSoFar >= 5) {
      return { checked: true, healed: false, reason: 'MAX_HEALS_REACHED', ownerMatch: true };
    }

    const staleSec = Math.round(CERA_EXTRACTION_STALE_MS / 1000);
    const needsTriggerRepair = (health.triggerCount === 0) || (health.heartbeatAgeSec !== null && health.heartbeatAgeSec >= staleSec);
    if (!needsTriggerRepair) {
      return { checked: true, healed: false, reason: 'HEALTHY', ownerMatch: true };
    }

    const nowMs = Date.now();
    const minHealGapMs = (typeof CeraConfig !== 'undefined' && CeraConfig.LIVENESS && CeraConfig.LIVENESS.REPAIR_MIN_INTERVAL_MS)
      ? CeraConfig.LIVENESS.REPAIR_MIN_INTERVAL_MS
      : 300000;
    if (ctl && ctl.lastHealMs && (nowMs - ctl.lastHealMs) < minHealGapMs && health.triggerCount > 0) {
      return { checked: true, healed: false, reason: 'RATE_LIMITED', ownerMatch: true };
    }

    registerCloudIngestionTrigger(CERA_EXTRACTION_TRIGGER_MINUTES);
    state.lastUpdateMs = nowMs;
    saveStateToStorage(state);
    if (ctl) {
      const nextHeals = healsSoFar + 1;
      ctl.healCount = nextHeals;
      ctl.resumeCount = nextHeals;
      ctl.lastHealMs = nowMs;
      ctl.heartbeatMs = nowMs;
      ctl.lastHeartbeatMs = nowMs;
      ceraSaveJobCtl_(ctl);
    }
    ceraAppendFlightIncident_('TRIGGER_REPAIRED_ON_OPEN', 'Re-armed background trigger via ' + (source || 'open') + '.');
    ceraRecordDiagLifecycle_(state, 'RUNNING', 'TRIGGER_REPAIRED_ON_OPEN', 'Auto-repaired missing/stale background trigger via ' + (source || 'open') + '.');
    return { checked: true, healed: true, reason: 'TRIGGER_REPAIRED_ON_OPEN', ownerMatch: true };
  } catch (e) {
    return { checked: false, healed: false, reason: 'ERROR', error: e.message || String(e) };
  }
}

/**
 * Builds a compact, 100% Zero-PII diagnostic incident summary packet (`cera.incident.v1`, <= 2 KB) from DocumentProperties.
 * Works even when the job is stalled or Drive is unreachable.
 */
function ceraBuildIncidentPacket_(passedState) {
  let state = passedState;
  if (!state) {
    try { state = getProgressUpdate(); } catch (e) { state = {}; }
  }
  state = state || {};
  const ctl = ceraLoadJobCtl_() || {};
  const health = ceraComputeJobHealth_(state, ctl);
  let incidents = [];
  let hotTicks = [];
  try {
    const props = PropertiesService.getDocumentProperties();
    const rawInc = props.getProperty('CERA_FR_INC');
    if (rawInc) incidents = JSON.parse(rawInc) || [];
    const rawHot = props.getProperty('CERA_FR_RING') || props.getProperty('CERA_FR_HOT');
    if (rawHot) hotTicks = JSON.parse(rawHot) || [];
  } catch (e) {}

  const ver = (typeof CeraConfig !== 'undefined' && CeraConfig.VERSION) ? CeraConfig.VERSION : '2.0.12';
  const status = state.status || ctl.status || 'IDLE';
  const errCode = ceraScrubText_(ctl.lastErrorCode || state.errorKey || 'NONE', 60);
  const errMsg = ceraScrubText_(ctl.lastErrorMsg || state.errorMessage || '', 120);

  const packetObj = {
    schema: 'cera.incident.v1',
    v: ver,
    activityId: state.activityId || ctl.activityId || 'NONE',
    status: status,
    healthState: health.healthState,
    isStalled: !!health.isStalled,
    ownerMatch: !!health.ownerMatch,
    triggers: health.triggerCount,
    processedCount: Number(state.processedCount || 0),
    scannedCount: Number(state.scannedCount || 0),
    timeSpanPct: Number(Number(state.timeSpanPct || 0).toFixed(1)),
    fileIndex: Number(state.fileIndex || 1),
    heartbeatAgeSec: health.heartbeatAgeSec,
    errorKey: errCode,
    lastError: errMsg,
    counters: {
      ticks: Number(ctl.ticksExecuted || hotTicks.length || 0),
      killed: Number(ctl.killedTicks || 0),
      skips: Number(ctl.lockSkips || 0),
      strikes: Number(ctl.readStrikes || 0),
      heals: Number(ctl.resumeCount || ctl.healCount || 0)
    },
    ring: hotTicks.slice(-6).map(t => ({
      t: t.t,
      durMs: t.durMs,
      rows: t.rows,
      api: t.api,
      part: t.part,
      pct: t.pct,
      st: t.st,
      err: ceraScrubText_(t.err || '', 40)
    })),
    incidents: incidents.slice(-6).map(inc => ({
      t: inc.t,
      code: inc.code,
      detail: ceraScrubText_(inc.detail || '', 80)
    }))
  };
  let json = JSON.stringify(packetObj);
  if (ceraUtf8Bytes_(json) > 2048) {
    packetObj.ring = packetObj.ring.slice(-3);
    packetObj.incidents = packetObj.incidents.slice(-3);
    json = JSON.stringify(packetObj);
  }
  return json;
}

if (typeof globalThis !== 'undefined' && typeof globalThis.copyIngestionIncidentPacket !== 'function') {
  globalThis.copyIngestionIncidentPacket = function() {
    const json = ceraBuildIncidentPacket_();
    return { success: true, json: json, incidentSummary: json };
  };
}

/**
 * Retrieves progress checkpoint from DocumentProperties or ScriptCache using tri-state reads.
 */
function getProgressUpdate() {
  const readRes = ceraReadPropTriState_(
    typeof PropertiesService !== 'undefined' ? PropertiesService.getDocumentProperties() : null,
    'SIERRA_SESSION'
  );
  if (readRes.status === 'PRESENT' && readRes.value) {
    try {
      return JSON.parse(readRes.value);
    } catch (parseErr) {
      return {
        status: 'TRANSIENT_READ_ERROR',
        healthState: 'UNKNOWN',
        processedCount: 0,
        timeSpanPct: 0,
        currentFileName: '',
        folderId: '',
        folderName: ''
      };
    }
  }

  if (readRes.status === 'UNREADABLE') {
    try {
      const cached = CacheService.getScriptCache().get('SIERRA_LIVE_PROGRESS');
      if (cached) return JSON.parse(cached);
    } catch (e) {}
    return {
      status: 'TRANSIENT_READ_ERROR',
      healthState: 'UNKNOWN',
      processedCount: 0,
      timeSpanPct: 0,
      currentFileName: '',
      folderId: '',
      folderName: ''
    };
  }

  // Fallback: ScriptCache
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
 * Also consults `CERA_JOB_CTL` so a transient null read on `SIERRA_SESSION` while `CERA_JOB_CTL` says RUNNING
 * never tricks an in-flight tick into treating the job as 'GONE' (FI-A3), and an explicit pause/finalize/discard
 * recorded in `CERA_JOB_CTL` is respected even if `SIERRA_SESSION` was unreadable (FI-A4..A5).
 */
function ceraStoredJobStatus_(activityId) {
  const ctl = ceraLoadJobCtl_();
  const ctlMatches = ctl && (!activityId || !ctl.activityId || ctl.activityId === activityId);
  if (ctlMatches) {
    if (ctl.status === 'IDLE' || ctl.status === 'DISCARDED') return 'GONE';
    if (ctl.status === 'PAUSED' || ctl.status === 'STOPPED' || ctl.status === 'COMPLETED') return String(ctl.status);
  } else if (ctl && activityId && ctl.activityId && ctl.activityId !== activityId) {
    return 'GONE';
  }

  const readRes = ceraReadPropTriState_(
    typeof PropertiesService !== 'undefined' ? PropertiesService.getDocumentProperties() : null,
    'SIERRA_SESSION'
  );
  if (readRes.status === 'UNREADABLE') return '';
  if (readRes.status === 'MISSING' || !readRes.value) {
    // FI-A3: if SIERRA_SESSION returned null transiently while CERA_JOB_CTL confirms this job is RUNNING, do not treat as GONE
    if (ctlMatches && ctl.status === 'RUNNING') return '';
    return 'GONE';
  }
  try {
    const stored = JSON.parse(readRes.value);
    if (!stored || stored.status === 'IDLE' || (activityId && stored.activityId && stored.activityId !== activityId)) return 'GONE';
    return String(stored.status || '');
  } catch (e) {
    return '';
  }
}

/**
 * Detects existing session state for modal consumption (Bulletproof sync with Ingestion Monitor & Liveness Engine)
 */
function detectExistingSession() {
  let state = getProgressUpdate();
  if (state && state.status === 'TRANSIENT_READ_ERROR') {
    const ctl = ceraLoadJobCtl_();
    if (ctl && ctl.status && ctl.status !== 'IDLE') {
      return {
        hasExisting: true,
        status: ctl.status,
        healthState: 'UNKNOWN',
        storageDegraded: true,
        isCompleted: ctl.status === 'COMPLETED',
        isStalled: false,
        folderId: ctl.folderId || '',
        totalLogsProcessed: 0,
        timeSpanPct: ctl.status === 'COMPLETED' ? 100 : 0
      };
    }
    return {
      hasExisting: true,
      status: 'TRANSIENT_READ_ERROR',
      healthState: 'UNKNOWN',
      storageDegraded: true,
      isCompleted: false,
      isStalled: false,
      totalLogsProcessed: 0,
      timeSpanPct: 0
    };
  }

  // Bulletproof sync: Cross-check with '⚡ Ingestion Monitor' dashboard sheet
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) {
      const monitorSheet = ss.getSheetByName('⚡ Ingestion Monitor');
      if (monitorSheet) {
        const a2Val = String(monitorSheet.getRange('A2').getValue() || '').trim();
        const a3Val = String(monitorSheet.getRange('A3').getValue() || '').trim();
        const isDoneStr = v => v.includes('✅') || v.includes('COMPLETED') || v.includes('READY FOR CERA');
        const statusVal = isDoneStr(a2Val) ? a2Val : a3Val;

        if (isDoneStr(statusVal)) {
          const wasExplicitlyReset = (!state || state.status === 'IDLE') && ss && typeof ss.getId === 'function' && ss.getId() &&
            PropertiesService.getDocumentProperties().getProperty('CERA_INGESTION_USED_SHEET_ID') === String(ss.getId());
          if (!wasExplicitlyReset && (!state || state.status !== 'COMPLETED')) {
            if (!state) state = {};
            state.status = 'COMPLETED';
            state.timeSpanPct = 100;
            state.isCompleted = true;

            // Sync total logs from cell A5 (or legacy A6, e.g. "966 Events" or "12.500 Peristiwa")
            const a5Val = String(monitorSheet.getRange('A5').getValue() || '');
            const a6Val = String(monitorSheet.getRange('A6').getValue() || '');
            const logsStr = /\d/.test(a5Val) ? a5Val : a6Val;
            const matchLogs = logsStr.match(/(\d[\d,.]*)/);
            if (matchLogs) {
              const parsedLogs = parseInt(matchLogs[1].replace(/[^\d]/g, ''), 10);
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
        // Views never destroy state (BP-02 / F13a): if '⚡ Ingestion Monitor' was deleted while a job exists, recreate it
        if (state && state.status && state.status !== 'IDLE') {
          Logger.log("'⚡ Ingestion Monitor' sheet tab was missing during detectExistingSession. Recreating monitor sheet...");
          ceraAppendFlightIncident_('MONITOR_RECREATED', 'Recreated missing Ingestion Monitor sheet tab on session check.');
          safeUpdateDashboard(ss, state, state.partitions || []);
        }
      }
    }
  } catch (sheetSyncErr) {
    console.warn('Dashboard sheet sync notice: ' + sheetSyncErr.message);
  }

  if (state && (state.folderId || (state.status === 'COMPLETED')) && state.status && state.status !== 'IDLE') {
    const diagMeta = ceraGetDiagLogMeta_(state.folderId);
    const ctl = ceraLoadJobCtl_();
    const health = ceraComputeJobHealth_(state, ctl);
    const incidentSummary = ceraBuildIncidentPacket_(state);
    return {
      hasExisting: true,
      status: state.status,
      healthState: health.healthState,
      isCompleted: (state.status === 'COMPLETED'),
      isStalled: health.isStalled,
      heartbeatAgeSec: health.heartbeatAgeSec,
      lastHeartbeatIso: health.lastHeartbeatIso,
      ownerMatch: health.ownerMatch,
      triggerCount: health.triggerCount,
      quotaResumeAtIso: health.quotaResumeAtIso,
      incidentSummary: incidentSummary,
      healthChecks: health.healthChecks,
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
      etaSec: (state.status === 'COMPLETED' || health.isStalled || health.healthState === 'WAITING_FOR_QUOTA') ? 0 : (state.etaSec || 0),
      expectedEvents: state.expectedEvents || 0,
      errorMessage: state.errorMessage || '',
      errorKey: state.errorKey || '',
      partitions: state.partitions || [],
      eventStreams: state.eventStreams || null
    };
  }
  return { hasExisting: false, status: 'IDLE', healthState: 'IDLE', isStalled: false };
}

// ==============================================================================
// 5. DIRECT INGESTION DIAGNOSTIC LOGGER (diagnostics/cera-diagnostic-log.txt)
// ==============================================================================

const CERA_DIAG_LOG_MAX_BYTES = (typeof CeraConfig !== 'undefined' && CeraConfig.DIAG_LOG_MAX_BYTES) ? CeraConfig.DIAG_LOG_MAX_BYTES : 1000000;
const CERA_DIAG_LOG_SOFT_BYTES = Math.floor(CERA_DIAG_LOG_MAX_BYTES * 0.94);

/**
 * Retrieves the Drive IDs/URLs of the `diagnostics/` subfolder and `cera-diagnostic-log.txt` for a Direct Ingestion job folder.
 * Stored in its own DocumentProperties key (`CERA_DIAG_LOG_META`) so `SIERRA_SESSION` stays well under its 9,216-byte limit.
 * Falls back to `Drive.Files.list` if `CERA_DIAG_LOG_META` is missing or belongs to another folder (e.g. cross-spreadsheet analysis).
 */
function ceraGetDiagLogMeta_(folderId, allowListFallback) {
  try {
    const raw = PropertiesService.getDocumentProperties().getProperty('CERA_DIAG_LOG_META');
    if (raw) {
      const meta = JSON.parse(raw);
      if (meta && (!folderId || !meta.folderId || meta.folderId === folderId)) {
        return meta;
      }
    }
  } catch (e) {}

  if (allowListFallback && folderId && typeof Drive !== 'undefined' && Drive.Files && typeof Drive.Files.list === 'function') {
    try {
      const logFolderName = (typeof CeraConfig !== 'undefined' && CeraConfig.DIAG_LOG_FOLDER_NAME) ? CeraConfig.DIAG_LOG_FOLDER_NAME : 'diagnostics';
      const logFileName = (typeof CeraConfig !== 'undefined' && CeraConfig.DIAG_LOG_FILE_NAME) ? CeraConfig.DIAG_LOG_FILE_NAME : 'cera-diagnostic-log.txt';
      const folderList = Drive.Files.list({
        q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        pageSize: 20,
        fields: 'files(id,name,trashed)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      });
      const subFolders = (folderList && Array.isArray(folderList.files)) ? folderList.files : [];
      const candidateNames = [logFolderName, 'diagnostics', 'diagnostic-logs', 'logs'];
      let logFolder = null;
      for (let i = 0; i < candidateNames.length && !logFolder; i++) {
        logFolder = subFolders.find(f => f && f.id && !f.trashed && f.name === candidateNames[i]);
      }
      if (logFolder) {
        const fileList = Drive.Files.list({
          q: `'${logFolder.id}' in parents and trashed = false`,
          pageSize: 20,
          fields: 'files(id,name,trashed)',
          supportsAllDrives: true,
          includeItemsFromAllDrives: true
        });
        const files = (fileList && Array.isArray(fileList.files)) ? fileList.files : [];
        const logFile = files.find(f => f && f.id && !f.trashed && f.name === logFileName);
        if (logFile) {
          return {
            activityId: '',
            folderId: folderId,
            logFolderId: logFolder.id,
            logFolderUrl: `https://drive.google.com/drive/folders/${logFolder.id}`,
            logFileId: logFile.id
          };
        }
      }
    } catch (listErr) {}
  }
  return null;
}

const CERA_SCRUB_REASON_ALLOWLIST = {
  PERMISSION_DENIED: true,
  UNAUTHENTICATED: true,
  RESOURCE_EXHAUSTED: true,
  UNAVAILABLE: true,
  DEADLINE_EXCEEDED: true,
  INVALID_ARGUMENT: true,
  NOT_FOUND: true,
  INTERNAL: true,
  insufficientPermissions: true,
  rateLimitExceeded: true,
  userRateLimitExceeded: true,
  dailyLimitExceeded: true,
  quotaExceeded: true,
  backendError: true,
  notFound: true,
  badRequest: true,
  authError: true,
  forbidden: true,
  invalid: true
};

/**
 * 9-class Zero-PII & Zero-Identifier Scrubber (`ceraScrubText_`, Q8-C / d2 §3.4).
 * Strips emails, URLs of any scheme, hostnames across all alphabetic TLDs (2..24 chars),
 * IPv4/IPv6 addresses, pageTokens & customer IDs (`C0...`), quoted literals (double, single,
 * smart, CJK), OU paths (`/Segment/Segment`), and long opaque IDs/hex/digit runs.
 */
function ceraScrubText_(text, maxLen) {
  if (!text) return '';
  let s = String(text);
  // 1. Emails
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]');
  // 2. URLs with any scheme
  s = s.replace(/\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'<>)]+/gi, '[REDACTED_URL]');
  // 3. IPv4 and IPv6 addresses
  s = s.replace(/\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, '[REDACTED_IP]');
  s = s.replace(/\b(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}\b/g, '[REDACTED_IP]');
  // 4. Page-token-like strings and Google Workspace customer IDs (C0xxxxxxx)
  s = s.replace(/\bA:[0-9A-Za-z_:-]{6,}\b/g, '[REDACTED_TOKEN]');
  s = s.replace(/\b[0-9A-Za-z_-]+:[0-9A-Za-z_-]+:chrome:[0-9A-Za-z_:-]+\b/gi, '[REDACTED_TOKEN]');
  s = s.replace(/\bC0[0-9a-zA-Z]{6,}\b/g, '[REDACTED_ID]');
  // 5. Quoted literals ("...", '...', “...”, ‘...’, 「...」), preserving standard Sheet1/Raw Data ranges and API reason tokens
  const isAllowedLiteral = inner => {
    if (/^(Sheet1|Raw Data)(![A-Z0-9:]+)?$/i.test(inner)) return true;
    if (/^(Write requests|Read requests|urlfetch)$/i.test(inner)) return true;
    return !!CERA_SCRUB_REASON_ALLOWLIST[inner];
  };
  s = s.replace(/"([^"]{1,200})"/g, (m, inner) => (isAllowedLiteral(inner) ? m : '"[REDACTED]"'));
  s = s.replace(/“([^”]{1,200})”/g, (m, inner) => (isAllowedLiteral(inner) ? m : '"[REDACTED]"'));
  s = s.replace(/‘([^’]{1,200})’/g, (m, inner) => (isAllowedLiteral(inner) ? m : '"[REDACTED]"'));
  s = s.replace(/「([^」]{1,200})」/g, (m, inner) => (isAllowedLiteral(inner) ? m : '"[REDACTED]"'));
  s = s.replace(/(?:^|[\s(:=])'([^']{1,200})'(?=$|[\s),.;:!])/g, (m, inner) => {
    if (isAllowedLiteral(inner)) return m;
    return m.replace("'" + inner + "'", '"[REDACTED]"');
  });
  // 6. Host names (2+ labels with any 2..24 char alphabetic TLD, excluding standard Google API service identifiers)
  s = s.replace(/\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,24}\b/g, m => {
    const lower = m.toLowerCase();
    if (
      lower === 'googleapis.com' ||
      lower === 'google.com' ||
      lower === 'script.google.com' ||
      lower === 'cera-diagnostic-log.txt' ||
      lower.indexOf('sheets.spreadsheets') === 0 ||
      lower.indexOf('reports.activities') === 0 ||
      lower.indexOf('drive.files') === 0 ||
      lower.indexOf('script.container') === 0
    ) {
      return m;
    }
    return '[REDACTED_DOMAIN]';
  });
  // 7. OU-like paths (/Segment/Segment)
  s = s.replace(/(^|[\s(])(\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+)/g, '$1[REDACTED_PATH]');
  // 8. Digit runs >= 10 chars (trigger IDs, uniqueQualifiers) and opaque Drive/Sheet IDs >= 20 chars containing digits/hyphens/underscores
  s = s.replace(/\b\d{10,}\b/g, '[REDACTED_ID]');
  s = s.replace(/\b(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}\b/g, m => {
    if (m.indexOf('REDACTED_') === 0 || m.indexOf('CERA_') === 0) return m;
    return '[REDACTED_ID]';
  });
  const limit = Number(maxLen) > 0 ? Number(maxLen) : 320;
  if (s.length > limit) s = s.slice(0, Math.max(1, limit - 3)) + '...';
  return s;
}

/**
 * Redacts emails, URLs, domains, file names, and long identifiers from any diagnostic or error message string
 * to guarantee 100% Zero-PII & Zero-Sensitive-Data in `cera-diagnostic-log.txt`.
 */
function ceraSanitizeDiagnosticText_(text) {
  return ceraScrubText_(text, 320);
}

/**
 * Increments non-empty field presence counters for an extracted Chrome event row (19-column schema).
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
      hasCmdSwitches: 0,
      hasEventId: 0
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
  if (row[18]) st.hasEventId++;
}

/**
 * Initializes the `diagnostics/` subfolder and `diagnostics/cera-diagnostic-log.txt` file inside the Direct Ingestion Drive folder.
 * Non-fatal: any Drive error is logged as a warning and never blocks ingestion.
 */
function ceraInitDiagnosticLog_(initialState, firstPartition) {
  if (!initialState || !initialState.folderId) return null;
  try {
    const logFolderName = (typeof CeraConfig !== 'undefined' && CeraConfig.DIAG_LOG_FOLDER_NAME) ? CeraConfig.DIAG_LOG_FOLDER_NAME : 'diagnostics';
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
    let hostSpreadsheetId = '';
    try {
      const activeSs = SpreadsheetApp.getActiveSpreadsheet();
      if (activeSs && typeof activeSs.getId === 'function') {
        hostSpreadsheetId = activeSs.getId() || '';
      }
    } catch (e) {}

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
    const plannedSlices = Array.isArray(initialState.plan)
      ? initialState.plan.length
      : (initialState.dateRangeDays || CERA_DEFAULT_RANGE_DAYS);
    const initialExpectedEvents = Number(
      (preflight && (preflight.expectedEvents !== undefined ? preflight.expectedEvents : preflight.estimatedEvents)) ||
      initialState.expectedEvents ||
      (initialState.plan && initialState.plan.total) ||
      0
    );
    const diag = {
      schemaVersion: '1.0',
      ceraVersion: (typeof CeraConfig !== 'undefined' && CeraConfig.VERSION) ? CeraConfig.VERSION : '2.0.12',
      privacyNotice: 'Zero-PII Diagnostic Log: Contains only execution metrics, partition counts, timing, and sanitized status codes. No user emails, domains, OUs, URLs, file names, or device names are recorded.',
      activityId: initialState.activityId || '',
      status: initialState.status || 'RUNNING',
      createdAtUtc: nowIso,
      updatedAtUtc: nowIso,
      environment: {
        hostSpreadsheetId: hostSpreadsheetId,
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
        totalPlannedSlices: plannedSlices,
        quietWeeksSkipped: 0,
        timeSpanPct: 0
      },
      policyPrecheck: policyPrecheck || { status: 'NOT_RUN' },
      preflight: preflight || {
        status: initialExpectedEvents ? 'ESTIMATED' : 'NOT_RUN',
        expectedEvents: initialExpectedEvents,
        plannedSlicesCount: plannedSlices
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
        expectedEvents: initialExpectedEvents,
        actualToExpectedRatio: 0,
        avgEventsPerTick: 0,
        avgEventsPerSec: 0,
        peakTickEvents: 0
      },
      streamDiagnostics: streamDiagnostics,
      slices: [],
      partitions: firstPartition ? [{
        index: firstPartition.fileIndex || firstPartition.index || 1,
        rows: firstPartition.rowCount || firstPartition.rows || 0,
        status: firstPartition.status || 'IN_PROGRESS',
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
  const sd = diag.scaleDiagnostics || {};
  const anoms = Array.isArray(diag.anomalies) ? diag.anomalies : [];
  const lastAnom = anoms.length > 0 ? anoms[anoms.length - 1] : null;

  const polStatus = pol.status || (pol.allReady === true ? 'ALL_READY' : (pol.allReady === false ? 'INCOMPLETE' : 'NOT_RUN'));
  const polDetail = pol.connectorStatus
    ? ' (Connector: ' + pol.connectorStatus + ')'
    : (pol.totalPoliciesCount ? ' (' + (pol.activePoliciesCount || 0) + '/' + pol.totalPoliciesCount + ' policies ready)' : '');
  const preExpected = (pre.expectedEvents !== undefined ? pre.expectedEvents : pre.estimatedEvents) || sd.expectedEvents || 0;
  const preStatus = pre.status || (pre.estimatedEvents !== undefined || preExpected > 0 ? 'ESTIMATED' : 'NOT_RUN');
  const preActive = pre.activeSlicesCount !== undefined ? pre.activeSlicesCount : (pre.activeWeeksCount || 0);
  const preTotal = pre.plannedSlicesCount !== undefined ? pre.plannedSlicesCount : (pre.totalWeeksCount || wd.totalPlannedSlices || 0);
  const preUnit = (pre.activeSlicesCount === undefined && pre.activeWeeksCount !== undefined) ? 'Active Weeks' : 'Active Slices';

  const headerLines = [
    '================================================================================',
    `CERA (Chrome Egress Risk Analysis) — Direct Ingestion Diagnostic Log`,
    `Version            : v${diag.ceraVersion || '2.0.12'} (Schema v${diag.schemaVersion || '1.0'})`,
    `Privacy Guarantee  : ZERO-PII / ZERO-SENSITIVE-DATA (Safe to inspect & share)`,
    '================================================================================',
    `Activity ID        : ${diag.activityId || 'N/A'}`,
    `Host Spreadsheet   : ${(diag.environment && diag.environment.hostSpreadsheetId) || 'N/A'}`,
    `Job Status         : ${diag.status || 'UNKNOWN'}`,
    `Created (UTC)      : ${diag.createdAtUtc || 'N/A'}`,
    `Last Updated (UTC) : ${diag.updatedAtUtc || 'N/A'}`,
    `Locale / TimeZone  : ${(diag.environment && diag.environment.locale) || 'en'} / ${(diag.environment && diag.environment.scriptTimeZone) || 'UTC'}`,
    '--------------------------------------------------------------------------------',
    `EXTRACTION PROGRESS & SCALE`,
    `  Window Coverage  : ${wd.timeSpanPct || 0}% (${wd.dateRangeDays || 0} days | ${wd.windowStartUtc || ''} -> ${wd.windowEndUtc || ''})`,
    `  Current Cursor   : ${wd.currentCursorUtc || 'N/A'} (Slice ${wd.currentSliceIndex || 0}/${wd.totalPlannedSlices || 0}, Quiet Skipped: ${wd.quietWeeksSkipped || 0})`,
    `  Events Extracted : ${rh.totalEventsExtracted || 0} written / ${rh.totalEventsScanned || 0} scanned (Expected: ${preExpected})`,
    `  Partitions       : ${rh.totalPartitionsCreated || 0} created (${rh.totalPartitionsRecovered || 0} auto-recovered)`,
    `  Worker Ticks     : ${rh.ticksExecuted || 0} ticks | API Calls: ${rh.totalApiCalls || 0} | Retries: ${rh.totalRetries || 0} | 429s: ${rh.totalRateLimitHits || 0}`,
    `  Resilience       : Token Fallbacks: ${rh.totalTokenFallbacks || 0} | Rewinds: ${rh.totalStreamRewinds || 0} | Batch Splits: ${rh.totalAdaptiveBatchSplits || 0}`,
    `  Session State    : Peak ${rh.peakSessionStateBytes || 0} / ${rh.sessionLimitBytes || 9000} bytes | Log Compactions: ${rh.compactionCount || 0}`,
    `  Timing (ms)      : Total ${tb.totalElapsedMs || 0} | Admin API ${tb.adminApiFetchMs || 0} | Sheets Append ${tb.sheetsAppendMs || 0} | Sleep ${tb.retrySleepMs || 0}`,
    '--------------------------------------------------------------------------------',
    `POLICY PRECHECK & PREFLIGHT`,
    `  Policy Precheck  : ${polStatus}${polDetail}`,
    `  Preflight Est.   : ${preStatus} (Expected: ${preExpected}, ${preUnit}: ${preActive}/${preTotal})`,
    `  Anomalies Logged : ${anoms.length}${lastAnom ? ' | Latest: [' + lastAnom.code + '] ' + lastAnom.detail : ''}`,
    `  Analysis Summary : ${diag.analysisSummary ? 'COMPLETED (Sheets Read: ' + diag.analysisSummary.sheetsRead + '/' + diag.analysisSummary.sheetsTotal + ', Actions: ' + diag.analysisSummary.actionsAssembled + (diag.analysisSummary.analyzedFromSpreadsheetId ? ', Analyzed From: ' + diag.analysisSummary.analyzedFromSpreadsheetId : '') + ')' : 'NOT_RUN_YET'}`,
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

    const prevScanned = Number(rh.totalEventsScanned || 0);
    const tickApiCalls = Number((work && (work.requests !== undefined ? work.requests : work.apiCalls)) || 0);
    const tickRetries = Number((work && work.retries) || 0);
    const tickRateLimits = Number((work && work.rateLimits) || 0);

    rh.ticksExecuted = (rh.ticksExecuted || 0) + 1;
    rh.totalEventsExtracted = state.processedCount || 0;
    rh.totalEventsScanned = state.scannedCount || 0;
    rh.totalApiCalls = (rh.totalApiCalls || 0) + tickApiCalls;
    rh.totalRetries = (rh.totalRetries || 0) + tickRetries;
    rh.totalRateLimitHits = (rh.totalRateLimitHits || 0) + tickRateLimits;
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

    const startMs = (tickDiag && (tickDiag.startedAtMs || tickDiag.tickStartMs)) || Date.now();
    const tickDurationMs = Math.max(0, Date.now() - startMs);
    const apiMs = Number((work && (work.requestMs !== undefined ? work.requestMs : work.apiMs)) || 0);
    const appendMs = Number((work && (work.writeMs !== undefined ? work.writeMs : work.appendMs)) || 0);
    const partCreateMs = Number((work && work.partCreateMs) || 0);
    const sleepMs = Number(((work && work.sleepMs) || 0) + ((tickDiag && tickDiag.sleepMs) || 0));

    tb.totalElapsedMs = (tb.totalElapsedMs || 0) + tickDurationMs;
    tb.adminApiFetchMs = (tb.adminApiFetchMs || 0) + apiMs;
    tb.sheetsAppendMs = (tb.sheetsAppendMs || 0) + appendMs;
    tb.partitionCreateMs = (tb.partitionCreateMs || 0) + partCreateMs;
    tb.retrySleepMs = (tb.retrySleepMs || 0) + sleepMs;

    wd.currentCursorUtc = state.currentCursorMs ? new Date(state.currentCursorMs).toISOString() : wd.currentCursorUtc;
    wd.currentSliceIndex = state.sliceIndex || state.currentDay || 0;
    wd.totalPlannedSlices = Array.isArray(state.plan)
      ? state.plan.length
      : (state.dateRangeDays || state.totalDays || wd.totalPlannedSlices || 0);
    wd.quietWeeksSkipped = (wd.quietWeeksSkipped || 0) + ((tickDiag && tickDiag.quietWeeksSkipped) || 0);
    wd.timeSpanPct = state.status === 'COMPLETED' ? 100 : (state.timeSpanPct || 0);

    const tickWritten = Number((work && (work.rows !== undefined ? work.rows : work.written)) || 0);
    const tickScanned = (work && work.scanned !== undefined)
      ? Number(work.scanned)
      : Math.max(tickWritten, Number(state.scannedCount || 0) - prevScanned);
    if (state.expectedEvents) {
      sd.expectedEvents = state.expectedEvents;
    }
    if (tickWritten > (sd.peakTickEvents || 0)) sd.peakTickEvents = tickWritten;
    sd.avgEventsPerTick = rh.ticksExecuted > 0 ? Math.round(rh.totalEventsExtracted / rh.ticksExecuted) : 0;
    sd.avgEventsPerSec = tb.totalElapsedMs > 0 ? Math.round((rh.totalEventsExtracted * 1000) / tb.totalElapsedMs) : 0;
    if (sd.expectedEvents > 0) {
      sd.actualToExpectedRatio = Number((rh.totalEventsExtracted / sd.expectedEvents).toFixed(3));
    }

    // Merge stream diagnostics & schema presence
    const completedSlicesInTick = (tickDiag && Array.isArray(tickDiag.completedSlices)) ? tickDiag.completedSlices.length : 0;
    if (state.eventStreams && diag.streamDiagnostics) {
      Object.keys(state.eventStreams).forEach(ev => {
        if (!diag.streamDiagnostics[ev]) return;
        const st = diag.streamDiagnostics[ev];
        st.rowsWritten = (state.eventStreams[ev] && state.eventStreams[ev].count) || st.rowsWritten || 0;
        if (completedSlicesInTick > 0) {
          st.completedSlices = (st.completedSlices || 0) + completedSlicesInTick;
        }
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
        const pIdx = np.part || np.fileIndex || np.index;
        if (!pIdx) return;
        const existing = diag.partitions.find(p => p.index === pIdx);
        if (!existing) {
          diag.partitions.push({
            index: pIdx,
            rows: np.rowCount !== undefined ? np.rowCount : (np.rows || 0),
            status: np.status || 'IN_PROGRESS',
            createdAtUtc: np.createdAtUtc || nowIso,
            closedAtUtc: np.status === 'COMPLETED' ? nowIso : null
          });
        }
      });
    }
    if (Array.isArray(state.partitions)) {
      state.partitions.forEach(sp => {
        const pIdx = sp.fileIndex || sp.index;
        if (!pIdx) return;
        const pRows = sp.rowCount !== undefined ? sp.rowCount : sp.rows;
        let dp = diag.partitions.find(p => p.index === pIdx);
        if (!dp) {
          dp = {
            index: pIdx,
            rows: pRows || 0,
            status: sp.status || 'IN_PROGRESS',
            createdAtUtc: nowIso,
            closedAtUtc: sp.status === 'COMPLETED' ? nowIso : null
          };
          diag.partitions.push(dp);
        } else {
          if (pRows !== undefined) dp.rows = pRows;
          if (sp.status) dp.status = sp.status;
          if (sp.status === 'COMPLETED' && !dp.closedAtUtc) dp.closedAtUtc = nowIso;
        }
      });
    }

    // Append anomalies from tick
    if (tickDiag && Array.isArray(tickDiag.anomalies)) {
      tickDiag.anomalies.forEach(a => {
        diag.anomalies.push({
          tsUtc: a.atUtc || a.tsUtc || nowIso,
          level: a.level || 'WARN',
          code: a.code || 'NOTICE',
          detail: ceraSanitizeDiagnosticText_(a.detail || '')
        });
      });
    }
    if (rawErrMsg) {
      diag.anomalies.push({
        tsUtc: nowIso,
        level: String(outcome || '').indexOf('FAILED') === 0 ? 'ERROR' : 'WARN',
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
      scanned: tickScanned,
      written: tickWritten,
      apiCalls: tickApiCalls,
      retries: tickRetries,
      rateLimits: tickRateLimits,
      sliceIdx: wd.currentSliceIndex,
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
    if (Array.isArray(state.partitions) && Array.isArray(diag.partitions)) {
      state.partitions.forEach(sp => {
        const pIdx = sp.fileIndex || sp.index;
        if (!pIdx) return;
        const pRows = sp.rowCount !== undefined ? sp.rowCount : sp.rows;
        const dp = diag.partitions.find(p => p.index === pIdx);
        if (dp) {
          if (pRows !== undefined) dp.rows = pRows;
          if (sp.status) dp.status = sp.status;
          if (sp.status === 'COMPLETED' && !dp.closedAtUtc) dp.closedAtUtc = nowIso;
        }
      });
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
    const meta = ceraGetDiagLogMeta_(folderId, !!(analysisStats.slidesGenerated || analysisStats.sheetsGenerated));
    if (!meta || !meta.logFileId) return;
    const diag = ceraLoadDiagState_(meta.activityId, meta.logFileId);
    if (!diag) return;

    let analyzedFromSpreadsheetId = '';
    try {
      const activeSs = SpreadsheetApp.getActiveSpreadsheet();
      if (activeSs && typeof activeSs.getId === 'function') {
        analyzedFromSpreadsheetId = activeSs.getId() || '';
      }
    } catch (e) {}

    const nowIso = new Date().toISOString();
    diag.analysisSummary = {
      completedAtUtc: nowIso,
      analyzedFromSpreadsheetId: analyzedFromSpreadsheetId,
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
    ceraSaveDiagState_(meta.activityId || diag.activityId, diag, meta.logFileId, false);
  } catch (err) {
    console.warn('ceraRecordDiagAnalysisSummary_ non-fatal notice: ' + (err.message || err));
  }
}

