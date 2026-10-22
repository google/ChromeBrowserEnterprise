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
 * Module: UiController.gs
 * Description: Unified Spreadsheet menu trigger, dialog launcher & bridge controller
 * ==============================================================================
 */

/**
 * Triggered upon opening the Google Spreadsheet
 * Single unified popup entry point
 */
function onOpen(e) {
  buildCeraMenu_();

  // If running via an Installable Trigger (AuthMode.FULL), we can safely auto-heal stalled triggers and launch showSetupDialog
  if (e && e.authMode === ScriptApp.AuthMode.FULL) {
    try {
      if (typeof ceraMaybeAutoHealIngestionOnOpen_ === 'function') {
        try {
          ceraMaybeAutoHealIngestionOnOpen_('onOpen');
        } catch (healErr) {
          Logger.log('Installable onOpen auto-heal notice: ' + healErr.message);
        }
      }
      const docProps = PropertiesService.getDocumentProperties();
      const isAnalysisDone = docProps && docProps.getProperty('CERA_ANALYSIS_EXECUTED') === 'true';
      if (!isAnalysisDone && typeof detectExistingSession === 'function') {
        const session = detectExistingSession();
        if (session && (session.status === 'COMPLETED' || session.isCompleted)) {
          showSetupDialog(session.folderId, session.folderName);
        }
      }
    } catch (err) {
      Logger.log('Installable onOpen dialog notice: ' + err.message);
    }
  } else {
    // In Simple Trigger mode (AuthMode.LIMITED on page open/refresh):
    // Apps Script strictly forbids showModalDialog in AuthMode.LIMITED (even with scopes in appsscript.json).
    // Instead, display a native, non-intrusive Google Sheets Toast notification.
    try {
      if (typeof detectExistingSession === 'function') {
        const session = detectExistingSession();
        if (session && (session.status === 'COMPLETED' || session.isCompleted)) {
          const docProps = PropertiesService.getDocumentProperties();
          const isAnalysisDone = docProps && docProps.getProperty('CERA_ANALYSIS_EXECUTED') === 'true';
          if (!isAnalysisDone) {
            const ss = SpreadsheetApp.getActiveSpreadsheet();
            if (ss && typeof ss.toast === 'function') {
              ss.toast(ceraT('toast.ready.body'), ceraT('toast.ready.title'), 15);
            }
          }
        } else if (session && (session.isStalled || session.healthState === 'STALLED' || session.healthState === 'NEEDS_OWNER')) {
          const ss = SpreadsheetApp.getActiveSpreadsheet();
          if (ss && typeof ss.toast === 'function') {
            ss.toast(ceraT('toast.stalled.body'), ceraT('toast.stalled.title'), 15);
          }
        }
      }
    } catch (tErr) {
      Logger.log('onOpen toast notice: ' + tErr.message);
    }
  }
}

/**
 * Adds the CERA menu in the user's current language. Also called by setCeraLanguage: adding the menu again under
 * the same name replaces the one on screen, so it follows the new language without a reload.
 */
function buildCeraMenu_() {
  SpreadsheetApp.getUi()
    .createMenu('🛡️ CERA')
    .addItem(ceraT('menu.open'), 'showSetupDialog')
    .addSeparator()
    .addItem(ceraT('menu.resume'), 'menuResumeCloudIngestion')
    .addItem(ceraT('menu.reset'), 'emergencyResetIngestion')
    .addSeparator()
    .addItem(ceraT('menu.privacy'), 'showPrivacyPolicyDialog')
    .addToUi();
}

/**
 * Helper to produce HtmlOutput supporting native UiDialog.html
 */
function createCeraDialogOutput(extractedFolderId, extractedFolderName) {
  if (typeof extractedFolderId !== 'string') extractedFolderId = '';
  if (typeof extractedFolderName !== 'string') extractedFolderName = '';

  const template = HtmlService.createTemplateFromFile('UiDialog');
  template.extractedFolderId = extractedFolderId;
  template.extractedFolderName = extractedFolderName;
  // Escape '<' so catalog strings containing HTML cannot close the <script> block they are injected into
  template.i18nJson = JSON.stringify(getCeraI18nState()).replace(/</g, '\\u003c');
  const ver = (typeof CeraConfig !== 'undefined' && CeraConfig.VERSION) ? ' (v' + CeraConfig.VERSION + ')' : '';
  return template.evaluate()
    .setTitle(ceraT('dialog.title') + ver)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Launch Smart State-Aware Setup Dialog (Strictly Modal Pop-up)
 */
function showSetupDialog(extractedFolderId, extractedFolderName) {
  try {
    Logger.log('showSetupDialog invoked: preparing HTML modal output...');
    const html = createCeraDialogOutput(extractedFolderId, extractedFolderName)
      .setWidth(640)
      .setHeight(720);
    const ver = (typeof CeraConfig !== 'undefined' && CeraConfig.VERSION) ? ' (v' + CeraConfig.VERSION + ')' : '';

    SpreadsheetApp.getUi().showModalDialog(html, ceraT('dialog.title') + ver);
    Logger.log('showSetupDialog: modal dispatched successfully.');
  } catch (err) {
    Logger.log('showSetupDialog error: ' + err.toString());
    // Only alert if this is not a background/limited auth restriction
    if (!err.message.includes('script.container.ui') && !err.message.includes('not sufficient')) {
      SpreadsheetApp.getUi().alert(ceraT('dialog.notice', { error: err.message }));
    }
  }
}

/**
 * Launch In-Tenant Privacy Policy & Local Execution Guarantee Dialog
 */
function showPrivacyPolicyDialog() {
  try {
    const tx = key => ceraEscapeHtml_(ceraT(key));
    const verBadge = (typeof CeraConfig !== 'undefined' && CeraConfig.VERSION)
      ? `<span style="font-size: 11px; font-weight: 600; color: #1D4ED8; background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 9999px; padding: 2px 8px; vertical-align: middle; margin-left: 6px;">v${ceraEscapeHtml_(CeraConfig.VERSION)}</span>`
      : '';
    const htmlContent = `
      <!DOCTYPE html>
      <html lang="${ceraGetLanguage()}">
        <head>
          <base target="_top">
          <link href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&family=Roboto:wght@400;500&display=swap" rel="stylesheet">
          <style>
            body {
              font-family: 'Roboto', -apple-system, BlinkMacSystemFont, sans-serif;
              margin: 0;
              padding: 22px 24px;
              color: #1F2937;
              background: #FFFFFF;
              line-height: 1.5;
              box-sizing: border-box;
            }
            .privacy-header {
              display: flex;
              align-items: center;
              gap: 12px;
              margin-bottom: 18px;
              padding-bottom: 14px;
              border-bottom: 1px solid #E5E7EB;
            }
            .privacy-icon-badge {
              width: 40px;
              height: 40px;
              border-radius: 10px;
              background: #EFF6FF;
              color: #1D4ED8;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 20px;
              flex-shrink: 0;
            }
            h2 {
              font-family: 'Google Sans', sans-serif;
              font-size: 17px;
              font-weight: 700;
              margin: 0;
              color: #0F172A;
            }
            .subtitle {
              font-size: 11.5px;
              color: #64748B;
              margin: 2px 0 0 0;
            }
            .clause-card {
              background: #F8FAFC;
              border: 1px solid #E2E8F0;
              border-radius: 8px;
              padding: 10px 14px;
              margin-bottom: 10px;
            }
            .clause-title {
              font-family: 'Google Sans', sans-serif;
              font-size: 12.5px;
              font-weight: 700;
              color: #1E293B;
              margin-bottom: 3px;
              display: flex;
              align-items: center;
              gap: 6px;
            }
            .clause-desc {
              font-size: 11.5px;
              color: #475569;
              line-height: 1.45;
              margin: 0;
            }
            .dialog-actions {
              margin-top: 18px;
              display: flex;
              justify-content: flex-end;
            }
            .btn-close {
              background: #0B57D0;
              color: #FFFFFF;
              border: none;
              border-radius: 8px;
              padding: 8px 22px;
              font-family: 'Google Sans', sans-serif;
              font-size: 12.5px;
              font-weight: 500;
              cursor: pointer;
              transition: background 0.2s;
            }
            .btn-close:hover {
              background: #0842A0;
            }
          </style>
        </head>
        <body>
          <div class="privacy-header">
            <div class="privacy-icon-badge">🔒</div>
            <div>
              <h2>${tx('privacy.title')}${verBadge}</h2>
              <div class="subtitle">${tx('privacy.subtitle')}</div>
            </div>
          </div>

          <div class="clause-card">
            <div class="clause-title">${tx('privacy.c1.title')}</div>
            <p class="clause-desc">
              ${tx('privacy.c1.body')}
            </p>
          </div>

          <div class="clause-card">
            <div class="clause-title">${tx('privacy.c2.title')}</div>
            <p class="clause-desc">
              ${tx('privacy.c2.body')}
            </p>
          </div>

          <div class="clause-card">
            <div class="clause-title">${tx('privacy.c3.title')}</div>
            <p class="clause-desc">
              ${tx('privacy.c3.body')}
            </p>
          </div>

          <div class="clause-card">
            <div class="clause-title">${tx('privacy.c4.title')}</div>
            <p class="clause-desc">
              ${ceraT('privacy.c4.body')}
            </p>
          </div>

          <div class="clause-card">
            <div class="clause-title">${tx('privacy.c5.title')}</div>
            <p class="clause-desc">
              ${tx('privacy.c5.body')}
            </p>
          </div>

          <div class="dialog-actions">
            <button class="btn-close" onclick="google.script.host.close()">${tx('common.close')}</button>
          </div>
        </body>
      </html>
    `;

    const html = HtmlService.createHtmlOutput(htmlContent)
      .setWidth(540)
      .setHeight(520);
    SpreadsheetApp.getUi().showModalDialog(html, ceraT('privacy.dialogTitle'));
  } catch (err) {
    Logger.log('showPrivacyPolicyDialog error: ' + err.toString());
    SpreadsheetApp.getUi().alert(ceraT('privacy.notice', { error: err.message }));
  }
}

/**
 * Returns whether the active spreadsheet (by its own spreadsheet ID, so File -> Make a copy starts clean)
 * has already been used for a Direct Ingestion run or a full Report Generation run.
 */
function ceraGetWorkbookUsageState_(ss, docProps) {
  let ingUsed = false;
  let repUsed = false;
  try {
    const activeSs = ss || SpreadsheetApp.getActiveSpreadsheet();
    const ssId = (activeSs && typeof activeSs.getId === 'function' && activeSs.getId()) ? String(activeSs.getId()) : '';
    const props = docProps || PropertiesService.getDocumentProperties();
    if (ssId && props) {
      const ingUsedId = props.getProperty('CERA_INGESTION_USED_SHEET_ID') || '';
      const repUsedId = props.getProperty('CERA_REPORT_USED_SHEET_ID') || '';
      repUsed = (repUsedId === ssId);
      ingUsed = (ingUsedId === ssId || repUsed);
    }
  } catch (e) {}
  return { ingestion: ingUsed, report: repUsed };
}

/**
 * Emergency Reset: Immediately halts background triggers, clears locks, cache, and session.
 * If the previous extraction was already COMPLETED, report generation has not yet executed on it,
 * and forceReset is not true (e.g. accidental menu click), keeps the completed session and the
 * ⚡ Ingestion Monitor sheet intact.
 */
function emergencyResetIngestion(forceReset) {
  try {
    Logger.log('emergencyResetIngestion triggered by user...');
    cleanupAllIngestionTriggers('EMERGENCY_RESET');
    const lock = LockService.getScriptLock();
    try { lock.releaseLock(); } catch (e) {}

    const existing = (typeof getProgressUpdate === 'function') ? getProgressUpdate() : null;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const docProps = PropertiesService.getDocumentProperties();
    const analysisAlreadyExecuted = !!(docProps && docProps.getProperty('CERA_ANALYSIS_EXECUTED') === 'true');
    const monSheetName = typeof MONITOR_SHEET_NAME !== 'undefined' ? MONITOR_SHEET_NAME : '⚡ Ingestion Monitor';
    const monSheet = (ss && typeof ss.getSheetByName === 'function') ? ss.getSheetByName(monSheetName) : null;
    let sheetAlreadyCompleted = false;
    try {
      if (monSheet && typeof monSheet.getRange === 'function') {
        const a2Val = String(monSheet.getRange('A2').getValue() || '');
        if (a2Val.indexOf('✅') !== -1) sheetAlreadyCompleted = true;
      }
    } catch (e) {}

    if (!forceReset && !analysisAlreadyExecuted && ((existing && (existing.status === 'COMPLETED' || existing.isCompleted)) || (!existing && sheetAlreadyCompleted))) {
      if (ss && typeof ss.toast === 'function') {
        ss.toast(
          ceraT('resume.complete.body', {
            folder: (existing && existing.folderName) || ceraT('common.na'),
            logs: Number((existing && existing.processedCount) || 0)
          }),
          ceraT('resume.complete.title'),
          8
        );
      }
      return {
        success: true,
        alreadyCompleted: true,
        status: 'COMPLETED',
        folderId: (existing && existing.folderId) || '',
        folderName: (existing && existing.folderName) || '',
        processedCount: Number((existing && existing.processedCount) || 0),
        workbookAlreadyUsed: ceraGetWorkbookUsageState_(ss, docProps)
      };
    }

    let activeActId = '';
    try {
      activeActId = (docProps && docProps.getProperty('CERA_CURRENT_ACTIVITY_ID')) || (existing && existing.activityId) || '';
    } catch (e) {}

    if (existing && existing.folderId && existing.status !== 'COMPLETED' && !existing.isCompleted && typeof ceraRecordDiagLifecycle_ === 'function') {
      ceraRecordDiagLifecycle_(existing, 'STOPPED', 'EMERGENCY_RESET', 'User triggered Emergency Reset.');
    }

    if (existing && ss && typeof ss.getId === 'function' && ss.getId() && docProps) {
      docProps.setProperty('CERA_INGESTION_USED_SHEET_ID', String(ss.getId()));
    }

    if (docProps) {
      docProps.deleteProperty('SIERRA_SESSION');
      docProps.deleteProperty('CERA_CURRENT_ACTIVITY_ID');
      docProps.deleteProperty('CERA_ANALYSIS_EXECUTED');
      docProps.deleteProperty('CERA_PART_REG');
      docProps.deleteProperty('CERA_FR_HOT');
      docProps.deleteProperty('CERA_FR_RING');
      docProps.deleteProperty('CERA_FR_INC');
      docProps.deleteProperty('CERA_JOB_BEAT');
      docProps.deleteProperty('CERA_ANALYSIS_JOB');
      try {
        docProps.setProperty('CERA_JOB_CTL', JSON.stringify({
          activityId: activeActId,
          status: 'DISCARDED',
          rev: 1,
          updatedMs: Date.now(),
          heartbeatMs: Date.now(),
          lastHeartbeatMs: Date.now(),
          lastReason: 'EMERGENCY_RESET'
        }));
      } catch (e) {}
    }
    CacheService.getUserCache().remove('SIERRA_LIVE_PROGRESS');
    CacheService.getScriptCache().remove('SIERRA_LIVE_PROGRESS');

    if (ss) {
      if (monSheet && typeof IngestionMonitorSheet !== 'undefined' && IngestionMonitorSheet.updateDashboard) {
        const resetState = Object.assign({}, existing || {}, {
          status: 'IDLE',
          isCompleted: false,
          processedCount: existing ? Number(existing.processedCount || 0) : 0,
          timeSpanPct: existing ? Number(existing.timeSpanPct || 0) : 0,
          daysFilter: (existing && existing.daysFilter) || CERA_DEFAULT_RANGE_DAYS,
          currentFileName: (existing && existing.currentFileName) || '',
          folderName: (existing && existing.folderName) || ''
        });
        const resetParts = (existing && Array.isArray(existing.partitions))
          ? existing.partitions.map(p => Object.assign({}, p, { status: p.status === 'COMPLETED' ? 'COMPLETED' : 'STOPPED' }))
          : [];
        try {
          IngestionMonitorSheet.updateDashboard(ss, resetState, resetParts);
        } catch (mErr) {
          Logger.log('Monitor sheet update notice: ' + mErr.message);
        }
      }
      if (typeof ss.toast === 'function') {
        ss.toast(ceraT('toast.reset.body'), ceraT('toast.reset.title'), 6);
      }
    }
    return {
      success: true,
      status: 'IDLE',
      workbookAlreadyUsed: ceraGetWorkbookUsageState_(ss, docProps)
    };
  } catch (err) {
    Logger.log('emergencyResetIngestion error: ' + err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Quick menu trigger to resume a paused or interrupted cloud ingestion
 */
function menuResumeCloudIngestion() {
  const ui = SpreadsheetApp.getUi();
  try {
    const res = resumeCloudIngestion();
    if (res && (res.status === 'RUNNING' || res.status === 'COMPLETED')) {
      if (res.status === 'COMPLETED') {
        ui.alert(
          ceraT('resume.complete.title'),
          ceraT('resume.complete.body', { folder: res.folderName || '', logs: Number(res.processedCount || 0) }),
          ui.ButtonSet.OK
        );
      } else {
        ui.alert(
          ceraT('resume.resumed.title'),
          ceraT('resume.resumed.body', {
            logs: Number(res.processedCount || 0),
            file: res.currentFileName || 'Partition 1',
            folder: res.folderName || ceraT('common.na')
          }),
          ui.ButtonSet.OK
        );
      }
    } else {
      ui.alert(ceraT('resume.notice.title'), ceraT('resume.notice.body', { status: res ? res.status : ceraT('resume.notice.none') }), ui.ButtonSet.OK);
    }
  } catch (e) {
    ui.alert(ceraT('resume.error.title'), ceraT('alert.resumeFailed', { error: e.message }), ui.ButtonSet.OK);
  }
}

/**
 * Setup metadata: registered domains and the background cloud job state.
 * Safely ignores non-admin privileges. The manual source is always the link or ID the user enters; the folder of
 * this spreadsheet is not offered as a source.
 */
function getAsyncSetupMetadata(passedFolderId, passedFolderName) {
  let detectedDomains = [];
  let primaryDomain = '';
  let directoryDomainsCount = 0;

  try {
    // 1. Ingest registered corporate domains from Admin Directory SDK API if accessible
    try {
      if (typeof AdminDirectory !== 'undefined' && AdminDirectory.Domains && AdminDirectory.Domains.list) {
        const dirResp = AdminDirectory.Domains.list('my_customer');
        if (dirResp && dirResp.domains && dirResp.domains.length > 0) {
          dirResp.domains.forEach(d => {
            if (d && d.domainName) {
              const dName = d.domainName.toLowerCase().trim();
              detectedDomains.push(dName);
              if (d.isPrimary) primaryDomain = dName;
              directoryDomainsCount++;
            }
          });
        }
      }
    } catch (err) {
      Logger.log('AdminDirectory.Domains.list notice (optional admin API not accessible, ignoring): ' + err.message);
    }

    // 2. Ingest domain aliases if configured and accessible
    try {
      if (typeof AdminDirectory !== 'undefined' && AdminDirectory.DomainAliases && AdminDirectory.DomainAliases.list) {
        const aliasResp = AdminDirectory.DomainAliases.list('my_customer');
        if (aliasResp && aliasResp.domainAliases && aliasResp.domainAliases.length > 0) {
          aliasResp.domainAliases.forEach(a => {
            if (a && a.domainAliasName) {
              detectedDomains.push(a.domainAliasName.toLowerCase().trim());
              directoryDomainsCount++;
            }
          });
        }
      }
    } catch (err) {
      Logger.log('AdminDirectory.DomainAliases.list notice (optional admin API not accessible, ignoring): ' + err.message);
    }
  } catch (globalErr) {
    Logger.log('getAsyncSetupMetadata notice: ' + globalErr.message);
  }

  // Check whether the signed-in user holds the Admin role required to read Chrome audit logs via Reports API
  let adminSdkAccess = true;
  try {
    if (typeof _preflightCheckReportsAccess_ === 'function' && typeof ScriptApp !== 'undefined' && ScriptApp.getOAuthToken) {
      const access = _preflightCheckReportsAccess_(ScriptApp.getOAuthToken());
      adminSdkAccess = !!(access && access.ok);
    }
  } catch (accessErr) {
    Logger.log('Admin SDK Reports access check notice: ' + accessErr.message);
    adminSdkAccess = false;
  }

  let policyPrecheck = null;
  if (adminSdkAccess && typeof runAdminPolicyPrecheck === 'function') {
    try {
      policyPrecheck = runAdminPolicyPrecheck();
    } catch (preErr) {
      Logger.log('runAdminPolicyPrecheck notice: ' + preErr.message);
    }
  }

  // Attempt owner auto-heal if a background ingestion session was interrupted
  let autoHealResult = null;
  if (typeof ceraMaybeAutoHealIngestionOnOpen_ === 'function') {
    try {
      autoHealResult = ceraMaybeAutoHealIngestionOnOpen_('setup');
    } catch (healErr) {
      Logger.log('getAsyncSetupMetadata auto-heal notice: ' + healErr.message);
    }
  }

  // Check active cloud ingestion background job
  const cloudSession = detectExistingSession();
  const activeSs = SpreadsheetApp.getActiveSpreadsheet();
  const docProps = PropertiesService.getDocumentProperties();
  const workbookAlreadyUsed = ceraGetWorkbookUsageState_(activeSs, docProps);
  const currentSessionAnalyzed = !!(workbookAlreadyUsed.report && docProps && docProps.getProperty('CERA_ANALYSIS_EXECUTED') === 'true');
  const lastSlidesUrl = (workbookAlreadyUsed.report && docProps) ? (docProps.getProperty('CERA_LAST_SLIDES_URL') || '') : '';
  const lastReportSummary = (workbookAlreadyUsed.report && docProps) ? (docProps.getProperty('CERA_LAST_REPORT_SUMMARY') || '') : '';

  let activeExtractedFolderId = passedFolderId || '';
  let activeExtractedFolderName = passedFolderName || '';

  if (!activeExtractedFolderId && cloudSession && cloudSession.folderId && !currentSessionAnalyzed) {
    activeExtractedFolderId = cloudSession.folderId;
    activeExtractedFolderName = cloudSession.folderName || 'Admin SDK Export Folder';
  }

  // Local template freshness calculation (zero external network calls)
  const releaseDate = (typeof CeraConfig !== 'undefined' && CeraConfig.RELEASE_DATE)
    ? String(CeraConfig.RELEASE_DATE)
    : '2026-10-19';
  const freshnessWarnDays = (typeof CeraConfig !== 'undefined' && Number(CeraConfig.FRESHNESS_WARN_DAYS) > 0)
    ? Number(CeraConfig.FRESHNESS_WARN_DAYS)
    : 90;
  const parsedReleaseMs = Date.parse(releaseDate);
  const templateAgeDays = Number.isFinite(parsedReleaseMs)
    ? Math.max(0, Math.floor((Date.now() - parsedReleaseMs) / 86400000))
    : 0;
  const isTemplateStale = templateAgeDays > freshnessWarnDays;

  // Check for resumable multi-batch analysis job scoped to this spreadsheet
  let analysisJob = null;
  try {
    const rawJob = docProps ? docProps.getProperty('CERA_ANALYSIS_JOB') : '';
    if (rawJob) {
      const parsedJob = JSON.parse(rawJob);
      const ssId = (activeSs && typeof activeSs.getId === 'function') ? String(activeSs.getId() || '') : '';
      if (parsedJob && (!parsedJob.hostSpreadsheetId || !ssId || parsedJob.hostSpreadsheetId === ssId)) {
        analysisJob = parsedJob;
      }
    }
  } catch (ajErr) {}

  // Deduplicate domains
  const uniqueDomains = Array.from(new Set(detectedDomains.filter(Boolean)));
  const detectedCorpDomain = uniqueDomains.length > 0 ? uniqueDomains.join(', ') : '';

  return {
    primaryDomain: primaryDomain || (uniqueDomains.length > 0 ? uniqueDomains[0] : ''),
    detectedCorpDomain: detectedCorpDomain,
    registeredDomains: uniqueDomains,
    directoryDomainsCount: uniqueDomains.length || directoryDomainsCount,
    adminSdkAccess: adminSdkAccess,
    policyPrecheck: policyPrecheck,
    cloudSession: cloudSession,
    autoHealResult: autoHealResult,
    extractedFolderId: activeExtractedFolderId,
    extractedFolderName: activeExtractedFolderName,
    workbookAlreadyUsed: workbookAlreadyUsed,
    currentSessionAnalyzed: currentSessionAnalyzed,
    lastSlidesUrl: lastSlidesUrl,
    lastReportSummary: lastReportSummary,
    releaseDate: releaseDate,
    freshnessWarnDays: freshnessWarnDays,
    templateAgeDays: templateAgeDays,
    isTemplateStale: isTemplateStale,
    analysisJob: analysisJob
  };
}

/**
 * Samples up to 3 spreadsheets from a manual Drive folder or sheet (reading only A1:AZ201 per sheet)
 * to discover corporate and subsidiary domains from User Profile, Account, and OU columns for Step 2.
 */
function discoverManualSourceDomains(sourceInput) {
  const empty = { domains: [], primaryDomain: '', counts: {} };
  try {
    const rawInput = String(sourceInput || '').trim();
    if (!rawInput) return empty;
    const targetId = (typeof extractDriveId === 'function' ? extractDriveId(rawInput) : '') ||
      (typeof extractFolderId === 'function' ? extractFolderId(rawInput) : '');
    if (!targetId) return empty;

    let currentSsId = '';
    try {
      const activeSs = SpreadsheetApp.getActiveSpreadsheet();
      if (activeSs && typeof activeSs.getId === 'function') {
        currentSsId = String(activeSs.getId() || '');
      }
    } catch (ssErr) {}

    let isSingleSheet = rawInput.includes('/spreadsheets/d/');
    let target = null;
    try {
      if (typeof Drive !== 'undefined' && Drive.Files && typeof Drive.Files.get === 'function') {
        target = Drive.Files.get(targetId, { fields: 'id,name,mimeType', supportsAllDrives: true });
        if (target && (target.mimeType === MimeType.GOOGLE_SHEETS || target.mimeType === 'application/vnd.google-apps.spreadsheet')) {
          isSingleSheet = true;
        }
      }
    } catch (dErr) {}

    const sheetIds = [];
    if (isSingleSheet) {
      if (targetId !== currentSsId) sheetIds.push(targetId);
    } else if (target) {
      try {
        let files = typeof ceraFolderSheets_ === 'function' ? ceraFolderSheets_(target.id) : [];
        if (typeof ceraSortPartitionQueue_ === 'function') {
          files = ceraSortPartitionQueue_(files);
        }
        let queue = [];
        for (let i = 0; i < files.length; i++) {
          const fid = files[i] && files[i].id ? String(files[i].id) : '';
          if (fid && fid !== currentSsId && !queue.includes(fid)) {
            queue.push(fid);
          }
        }
        if (queue.length <= 8) {
          for (let i = 0; i < queue.length; i++) sheetIds.push(queue[i]);
        } else {
          for (let i = 0; i < 8; i++) {
            const idx = Math.floor(i * (queue.length - 1) / 7);
            if (!sheetIds.includes(queue[idx])) sheetIds.push(queue[idx]);
          }
        }
      } catch (listErr) {}
    } else if (targetId !== currentSsId) {
      sheetIds.push(targetId);
    }

    if (sheetIds.length === 0) return empty;

    const consumerList = (typeof CeraConfig !== 'undefined' && Array.isArray(CeraConfig.CONSUMER_EMAIL_DOMAINS))
      ? CeraConfig.CONSUMER_EMAIL_DOMAINS
      : ['gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'live.com', 'msn.com', 'protonmail.com', 'proton.me', 'mail.com', 'zoho.com', 'yandex.com', 'gmx.com', 'me.com', 'mac.com'];
    const consumerSet = new Set(consumerList.map(d => String(d).toLowerCase().trim()));
    const consumerPrefixRe = /^(yahoo|outlook|hotmail|live|msn|icloud|aol|proton|gmx|ymail)./i;

    const extractValidDomain = rawVal => {
      if (rawVal === null || rawVal === undefined || rawVal === '') return '';
      const s = String(rawVal).trim().toLowerCase();
      if (!s) return '';
      const m = s.match(/@([a-z0-9.-]+\.[a-z]{2,})\b/i);
      if (!m || !m[1]) return '';
      const dom = m[1].replace(/^\.+|\.+$/g, '').toLowerCase();
      if (!dom || consumerSet.has(dom) || consumerPrefixRe.test(dom)) return '';
      return dom;
    };

    const counts = {};
    const accountCounts = {};
    const corpStems = new Set();
    const hasManagedOu = {};

    function ceraColIndexToLetter_(idx) {
      let temp, letter = '';
      while (idx > 0) {
        temp = (idx - 1) % 26;
        letter = String.fromCharCode(temp + 65) + letter;
        idx = (idx - temp - 1) / 26;
      }
      return letter;
    }

    const processOu = ouStr => {
      if (!ouStr) return;
      const parts = String(ouStr).split('/');
      for (let p = 0; p < parts.length; p++) {
        const segDom = extractValidDomain('u@' + parts[p].trim());
        if (segDom) {
          counts[segDom] = (counts[segDom] || 0) + 1;
          hasManagedOu[segDom] = true;
        }
      }
    };

    for (let sIdx = 0; sIdx < sheetIds.length; sIdx++) {
      const sheetId = sheetIds[sIdx];
      let rows = [];
      let grid = null;
      try {
        grid = typeof ceraGetSourceSheetGridInfo_ === 'function' ? ceraGetSourceSheetGridInfo_(sheetId) : null;
        const maxRow = grid && Number(grid.rowCount) > 0 ? Math.min(201, Math.max(2, Number(grid.rowCount))) : 201;
        const range = (grid && grid.escapedTitle && grid.lastCol)
          ? (grid.escapedTitle + '!A1:' + grid.lastCol + maxRow)
          : 'A1:AZ201';
        if (typeof ceraReadSheetRangeWithRetry_ === 'function') {
          rows = ceraReadSheetRangeWithRetry_(sheetId, range);
        } else if (typeof Sheets !== 'undefined' && Sheets.Spreadsheets && Sheets.Spreadsheets.Values) {
          const resp = Sheets.Spreadsheets.Values.get(sheetId, range);
          rows = (resp && Array.isArray(resp.values)) ? resp.values : [];
        }
      } catch (readErr) {
        try {
          const extSs = SpreadsheetApp.openById(sheetId);
          const sh = extSs.getSheetByName('Raw Data') || extSs.getSheets()[0];
          if (sh && sh.getLastRow() > 1) {
            const numRows = Math.min(201, sh.getLastRow());
            const numCols = Math.min(52, Math.max(1, sh.getLastColumn()));
            rows = sh.getRange(1, 1, numRows, numCols).getValues();
          }
        } catch (openErr) {}
      }

      if (!rows || rows.length < 2) continue;
      const col = typeof resolveColumnIndices === 'function' ? resolveColumnIndices(rows[0] || []) : null;
      if (!col) continue;

      const limit = Math.min(rows.length, 201);
      for (let r = 1; r < limit; r++) {
        const row = rows[r];
        if (!row) continue;
        const puRaw = col.profileUser !== -1 ? row[col.profileUser] : (col.userAlt !== -1 ? row[col.userAlt] : '');
        const puDom = extractValidDomain(puRaw) || (col.userAlt !== -1 && col.userAlt !== col.profileUser ? extractValidDomain(row[col.userAlt]) : '');
        if (puDom) {
          counts[puDom] = (counts[puDom] || 0) + 1;
          const stem = puDom.split('.')[0];
          if (stem && stem.length >= 3) corpStems.add(stem);
        }
        if (col.account !== -1 && row[col.account]) {
          const accDom = extractValidDomain(row[col.account]);
          if (accDom) {
            accountCounts[accDom] = (accountCounts[accDom] || 0) + 1;
          }
        }
        if (col.ou !== -1 && row[col.ou]) {
          processOu(row[col.ou]);
        }
      }

      if (typeof Sheets !== 'undefined' && Sheets.Spreadsheets && Sheets.Spreadsheets.Values && typeof Sheets.Spreadsheets.Values.batchGet === 'function' && grid && grid.rowCount > 201) {
        try {
          const puCol = col.profileUser !== -1 ? col.profileUser : col.userAlt;
          const ouCol = col.ou;
          const acCol = col.account;
          if (puCol !== -1 || ouCol !== -1 || acCol !== -1) {
            const ranges = [];
            const r1 = 202;
            let r2 = Math.min(sheetIds.length === 1 ? 100001 : 5001, grid.rowCount);
            const title = grid.escapedTitle + '!';
            if (puCol !== -1) ranges.push(title + ceraColIndexToLetter_(puCol + 1) + r1 + ':' + ceraColIndexToLetter_(puCol + 1) + r2);
            if (ouCol !== -1) ranges.push(title + ceraColIndexToLetter_(ouCol + 1) + r1 + ':' + ceraColIndexToLetter_(ouCol + 1) + r2);
            if (acCol !== -1) ranges.push(title + ceraColIndexToLetter_(acCol + 1) + r1 + ':' + ceraColIndexToLetter_(acCol + 1) + r2);
            
            if (sheetIds.length > 1 && grid.rowCount > 25000) {
               const midR1 = 25001;
               const midR2 = Math.min(30000, grid.rowCount);
               if (puCol !== -1) ranges.push(title + ceraColIndexToLetter_(puCol + 1) + midR1 + ':' + ceraColIndexToLetter_(puCol + 1) + midR2);
               if (ouCol !== -1) ranges.push(title + ceraColIndexToLetter_(ouCol + 1) + midR1 + ':' + ceraColIndexToLetter_(ouCol + 1) + midR2);
               if (acCol !== -1) ranges.push(title + ceraColIndexToLetter_(acCol + 1) + midR1 + ':' + ceraColIndexToLetter_(acCol + 1) + midR2);
            }
            
            const batchResp = Sheets.Spreadsheets.Values.batchGet(sheetId, { ranges: ranges });
            if (batchResp && Array.isArray(batchResp.valueRanges)) {
              for (let v = 0; v < batchResp.valueRanges.length; v++) {
                const vr = batchResp.valueRanges[v];
                if (!vr || !vr.values || !vr.range) continue;
                const puColLetter = puCol !== -1 ? ceraColIndexToLetter_(puCol + 1) : '';
                const ouColLetter = ouCol !== -1 ? ceraColIndexToLetter_(ouCol + 1) : '';
                const acColLetter = acCol !== -1 ? ceraColIndexToLetter_(acCol + 1) : '';
                const isPuCol = puCol !== -1 && (vr.range.includes('!' + puColLetter) || vr.range.includes(puColLetter + ':'));
                const isOuCol = ouCol !== -1 && (vr.range.includes('!' + ouColLetter) || vr.range.includes(ouColLetter + ':'));
                const isAcCol = acCol !== -1 && (vr.range.includes('!' + acColLetter) || vr.range.includes(acColLetter + ':'));
                for (let k = 0; k < vr.values.length; k++) {
                  const cellVal = vr.values[k][0];
                  if (!cellVal) continue;
                  if (isPuCol) {
                    const puDom = extractValidDomain(cellVal);
                    if (puDom) {
                      counts[puDom] = (counts[puDom] || 0) + 1;
                      const stem = puDom.split('.')[0];
                      if (stem && stem.length >= 3) corpStems.add(stem);
                    }
                  }
                  if (isOuCol) {
                    processOu(cellVal);
                  }
                  if (isAcCol) {
                    const accDom = extractValidDomain(cellVal);
                    if (accDom) {
                      accountCounts[accDom] = (accountCounts[accDom] || 0) + 1;
                    }
                  }
                }
              }
            }
          }
        } catch (bErr) {}
      }
    }

    const hasProfileDomains = Object.keys(counts).length > 0;
    Object.keys(accountCounts).forEach(dom => {
      const stem = dom.split('.')[0];
      if (!hasProfileDomains || counts[dom] || (stem && corpStems.has(stem))) {
        counts[dom] = (counts[dom] || 0) + accountCounts[dom];
      }
    });

    const domains = Object.keys(counts)
      .filter(d => counts[d] > 0)
      .sort((a, b) => (counts[b] - counts[a]) || (a < b ? -1 : (a > b ? 1 : 0)))
      .slice(0, 50);

    return {
      domains: domains,
      primaryDomain: domains[0] || '',
      counts: counts
    };
  } catch (err) {
    Logger.log('discoverManualSourceDomains notice: ' + err.message);
    return empty;
  }
}

/**
 * Bridge method to query live cloud ingestion status from the modal
 */
function getCloudIngestionStatus() {
  return detectExistingSession();
}

/**
 * Builds and returns a sanitized, zero-PII incident summary packet for clipboard copy in the Setup Dialog.
 */
function copyIngestionIncidentPacket() {
  try {
    if (typeof ceraBuildIncidentPacket_ === 'function') {
      const state = (typeof getProgressUpdate === 'function') ? getProgressUpdate() : null;
      const packet = ceraBuildIncidentPacket_(state);
      return {
        success: true,
        incidentSummary: typeof packet === 'string' ? packet : JSON.stringify(packet, null, 2)
      };
    }
    const session = (typeof detectExistingSession === 'function') ? detectExistingSession() : null;
    if (session && session.incidentSummary) {
      return {
        success: true,
        incidentSummary: String(session.incidentSummary)
      };
    }
    const fallbackLines = [
      'CERA Diagnostic Incident Summary (Zero-PII)',
      'Version: v' + ((typeof CeraConfig !== 'undefined' && CeraConfig.VERSION) ? CeraConfig.VERSION : '2.0.12'),
      'Status: ' + ((session && session.status) || 'IDLE'),
      'Health: ' + ((session && session.healthState) || 'IDLE'),
      'Progress: ' + Number((session && session.timeSpanPct) || 0) + '% (' + Number((session && session.processedCount) || 0) + ' events)',
      'Partitions: ' + Number((session && session.fileIndex) || 0),
      'Error Key: ' + ((session && session.errorKey) || 'NONE')
    ];
    return {
      success: true,
      incidentSummary: fallbackLines.join('\n')
    };
  } catch (err) {
    return {
      success: false,
      error: err.message || String(err),
      incidentSummary: ''
    };
  }
}

/**
 * Cache Polling with Size Bounding Guard (<100KB safe)
 */
function getProgressStatus() {
  const cache = CacheService.getUserCache();
  const data = cache.get('DLP_V2_JOB_PROGRESS');
  return data ? JSON.parse(data) : null;
}

function updateProgress(message, currentFile, index, total, errors) {
  const cache = CacheService.getUserCache();
  const safeErrors = (errors || []).slice(-10); // Keep last 10 errors to prevent cache overflow
  const payload = {
    message: message || '',
    currentFile: currentFile || '',
    index: index || 0,
    total: total || 1,
    errors: safeErrors
  };
  cache.put('DLP_V2_JOB_PROGRESS', JSON.stringify(payload), 300);
}
