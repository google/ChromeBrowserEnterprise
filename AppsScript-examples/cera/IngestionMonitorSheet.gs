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
 * Module: IngestionMonitorSheet.gs
 * Description: Dedicated Realtime Google Sheets Command Center Tab
 *              "⚡ Ingestion Monitor" with MD3-styled KPI Cards, Progress Gauge,
 *              Event Stream Breakdown & Drive Partitions Registry
 * ==============================================================================
 */

const MONITOR_SHEET_NAME = '⚡ Ingestion Monitor';

var IngestionMonitorSheet = {

  /**
   * Retrieves or initializes the dedicated Ingestion Monitor sheet tab
   */
  getOrCreateSheet: function(ss) {
    ss = ss || SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(MONITOR_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(MONITOR_SHEET_NAME, 0); // Place at first tab position
      this.initSheetStructure(sheet);
    }
    return sheet;
  },

  /**
   * Initializes sheet layout, column dimensions and freeze lines
   */
  initSheetStructure: function(sheet) {
    sheet.clear();
    if (typeof sheet.setHiddenGridlines === 'function') {
      sheet.setHiddenGridlines(true); // Executive styling: hide raw sheet gridlines
    }

    // Set standard column widths for clean card & table alignment
    const colWidths = [180, 140, 160, 150, 170, 140, 150, 240];
    colWidths.forEach((w, idx) => sheet.setColumnWidth(idx + 1, w));

    sheet.getRange('A1:H100').setFontFamily('Google Sans, Roboto, Arial, sans-serif');
    if (SpreadsheetApp.WrapStrategy && SpreadsheetApp.WrapStrategy.CLIP && typeof sheet.getRange('A1:H100').setWrapStrategy === 'function') {
      sheet.getRange('A1:H100').setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
    }
  },

  /**
   * Formats a duration in seconds as weeks, days, hours, minutes and seconds in the report language ("1d 4h 5m")
   */
  formatDuration: function(sec, lang) {
    if (!sec || sec <= 0 || isNaN(sec)) return '--';
    sec = Math.round(sec);
    const units = [['w', 604800], ['d', 86400], ['h', 3600], ['m', 60], ['s', 1]];
    const parts = [];
    units.forEach(([unit, size]) => {
      const n = Math.floor(sec / size);
      sec -= n * size;
      if (n > 0 || (unit === 's' && parts.length === 0)) parts.push(ceraT('mon.sheet.unit.' + unit, { n: n }, lang));
    });
    return parts.join(' ');
  },

  /**
   * Builds an ASCII / Unicode visual progress gauge string
   */
  buildProgressGauge: function(pct) {
    const safePct = Math.max(0, Math.min(100, Math.round(pct || 0)));
    const totalBars = 36;
    const filledBars = Math.round((safePct / 100) * totalBars);
    const emptyBars = Math.max(0, totalBars - filledBars);
    const barStr = '█'.repeat(filledBars) + '░'.repeat(emptyBars);
    return `[ ${barStr} ]  ${safePct}%`;
  },

  /**
   * Main rendering function: updates the entire Live Monitor Sheet, in the CERA language (ceraGetLanguage: the
   * language saved by the person who started the job, which time-driven runs read as well)
   */
  updateDashboard: function(ss, state, partitions) {
    const sheet = this.getOrCreateSheet(ss);
    state = state || {};
    partitions = partitions || [];
    const lang = ceraGetLanguage();
    const T = (key, params) => ceraT(key, params, lang);
    const num = n => ceraFormatNumber(Number(n) || 0, lang);
    // A label inside a HYPERLINK formula: its double quotes doubled
    const linkLabel = text => String(text).replace(/"/g, '""');

    const status = (state.status || 'RUNNING').toUpperCase();
    const isIdle = (status === 'IDLE' || status === 'STOPPED' || status === 'RESET');
    const totalLogs = Number(state.processedCount || state.totalLogsProcessed || 0);
    const timeSpanPct = Number(state.timeSpanPct || 0);
    const currentDay = isIdle ? 0 : Number(state.currentDay || 1);
    const totalDays = Number(state.daysFilter || state.totalDays || 7);
    const currentLogDate = state.currentLogDateStr || state.currentLogTimeStr || (isIdle || status === 'FAILED' ? T('mon.status.stopped') : (status === 'PAUSED' ? T('mon.sheet.streamStatus.paused') : T('mon.eta.calculating')));
    const startDate = isIdle ? '--' : (state.startDateStr || T('mon.sheet.origin'));
    const folderUrl = state.folderUrl || (state.folderId ? `https://drive.google.com/drive/folders/${state.folderId}` : '');
    const folderName = state.folderName || (isIdle ? T('common.na') : T('mon.folderDefault'));
    const fileIndex = state.fileIndex || partitions.length || 1;
    const currentRows = isIdle ? 0 : Number(state.currentSheetRows || 1);
    const rate = Number(state.rate || state.processingRate || 0);
    const etaSec = Number(state.etaSec || state.estimatedRemainingSec || 0);
    const lastUpdateStr = Utilities.formatDate(new Date(), ceraTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    const maxRows = typeof MAX_ROWS_PER_SHEET !== 'undefined' ? MAX_ROWS_PER_SHEET : 50000;
    const menuPath = key => '🛡️ CERA > ' + T(key);

    // Status Pill Colors
    let statusBg = '#E8F0FE';
    let statusFg = '#1A73E8';
    let statusText = '🟢 ' + T('mon.status.running');

    if (status === 'COMPLETED' || status === 'SUCCESS') {
      statusBg = '#E6F4EA';
      statusFg = '#137333';
      statusText = T('mon.sheet.status.completed');
    } else if (status === 'PAUSED') {
      statusBg = '#FEF7E0';
      statusFg = '#B06000';
      statusText = T('mon.sheet.status.paused');
    } else if (status === 'QUOTA_PAUSED') {
      statusBg = '#F5F3FF';
      statusFg = '#7C3AED';
      statusText = T('mon.status.quota');
    } else if (status === 'FAILED') {
      statusBg = '#FCE8E6';
      statusFg = '#C5221F';
      statusText = '🔴 ' + T('mon.status.failed');
    } else if (isIdle) {
      statusBg = '#FCE8E6';
      statusFg = '#C5221F';
      statusText = '🛑 ' + T('mon.status.stopped');
    }

    // 1. Header Banner (Row 1)
    sheet.getRange('A1:H1').merge()
      .setValue(T('mon.sheet.banner'))
      .setBackground('#0F172A')
      .setFontColor('#FFFFFF')
      .setFontSize(13)
      .setFontWeight('bold')
      .setHorizontalAlignment('left')
      .setVerticalAlignment('middle');
    sheet.setRowHeight(1, 38);

    // 2. Status Strip (Row 2)
    sheet.getRange('A2:C2').merge()
      .setValue(statusText)
      .setBackground(statusBg)
      .setFontColor(statusFg)
      .setFontSize(10)
      .setFontWeight('bold')
      .setHorizontalAlignment('left')
      .setVerticalAlignment('middle');

    sheet.getRange('D2:E2').merge()
      .setValue(T('mon.sheet.mode', { days: totalDays }))
      .setBackground('#F8FAFC')
      .setFontColor('#475569')
      .setFontSize(9)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');

    sheet.getRange('F2:H2').merge()
      .setValue(T('mon.sheet.lastSync', { time: lastUpdateStr }))
      .setBackground('#F8FAFC')
      .setFontColor('#64748B')
      .setFontSize(9)
      .setHorizontalAlignment('right')
      .setVerticalAlignment('middle');
    sheet.setRowHeight(2, 26);

    // 3. Four KPI Metric Cards (Rows 4-6)
    sheet.setRowHeight(3, 10); // Spacer

    // Card 1: Total Logs Ingested (A4:B6)
    sheet.getRange('A4:B4').merge().setValue(T('mon.kpi.logs').toUpperCase())
      .setFontSize(8.5).setFontWeight('bold').setFontColor('#64748B').setBackground('#F1F5F9');
    sheet.getRange('A5:B5').merge().setValue(T('mon.sheet.events', { n: totalLogs }))
      .setFontSize(18).setFontWeight('bold').setFontColor('#0B57D0').setBackground('#F8FAFD');
    sheet.getRange('A6:B6').merge().setValue(T('mon.sheet.rate', { rate: rate > 0 ? T('mon.rate', { rate: rate }) : '--' }))
      .setFontSize(9).setFontColor('#475569').setBackground('#F8FAFD');

    // Card 2: Chronological Timeline (C4:D6)
    const pctText = timeSpanPct.toFixed(1) + '%';
    const timelineVal = totalDays > 0 ? T('mon.sheet.progressDay', { day: Math.min(totalDays, currentDay), days: totalDays, pct: pctText }) : pctText;
    sheet.getRange('C4:D4').merge().setValue(T('mon.sheet.progressTitle'))
      .setFontSize(8.5).setFontWeight('bold').setFontColor('#64748B').setBackground('#F1F5F9');
    sheet.getRange('C5:D5').merge().setValue(timelineVal)
      .setFontSize(15).setFontWeight('bold').setFontColor('#0F172A').setBackground('#F8FAFD');
    sheet.getRange('C6:D6').merge().setValue(T('mon.sheet.current', { date: currentLogDate }))
      .setFontSize(9).setFontColor('#475569').setBackground('#F8FAFD');

    // Card 3: Active Drive Partition (E4:F6)
    const partitionText = T('mon.sheet.partitionValue', { part: isIdle ? '--' : T('mon.part', { n: fileIndex }), rows: currentRows, max: maxRows });
    sheet.getRange('E4:F4').merge().setValue(T('mon.sheet.partitionTitle'))
      .setFontSize(8.5).setFontWeight('bold').setFontColor('#64748B').setBackground('#F1F5F9');
    sheet.getRange('E5:F5').merge().setValue(partitionText)
      .setFontSize(14).setFontWeight('bold').setFontColor('#15803D').setBackground('#F0FDF4');

    if (folderUrl) {
      sheet.getRange('E6:F6').merge().setFormula(`=HYPERLINK("${folderUrl}", "${linkLabel(T('mon.sheet.openFolder'))}")`)
        .setFontSize(9).setFontColor('#0B57D0').setFontLine('underline').setBackground('#F0FDF4');
    } else {
      sheet.getRange('E6:F6').merge().setValue(T('mon.sheet.folder', { name: folderName }))
        .setFontSize(9).setFontColor('#475569').setBackground('#F0FDF4');
    }

    // Card 4: Estimated Completion & Watchdog (G4:H6)
    const etaText = (status === 'COMPLETED' || status === 'SUCCESS') ? T('mon.eta.finished')
      : (isIdle || status === 'FAILED') ? T('mon.status.stopped')
        : (status === 'PAUSED') ? T('mon.sheet.streamStatus.paused')
          : (timeSpanPct >= 1 && etaSec > 0 ? this.formatDuration(etaSec, lang) : T('mon.eta.calculating'));
    sheet.getRange('G4:H4').merge().setValue(T('mon.kpi.eta').toUpperCase())
      .setFontSize(8.5).setFontWeight('bold').setFontColor('#64748B').setBackground('#F1F5F9');
    sheet.getRange('G5:H5').merge().setValue(etaText)
      .setFontSize(15).setFontWeight('bold').setFontColor(isIdle || status === 'FAILED' ? '#C5221F' : '#B06000').setBackground('#FFFBEB');
    sheet.getRange('G6:H6').merge().setValue(T('mon.kpi.watchdog'))
      .setFontSize(9).setFontColor('#64748B').setBackground('#FFFBEB');

    sheet.getRange('A4:H6').setBorder(true, true, true, true, true, true, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);
    sheet.setRowHeight(4, 18);
    sheet.setRowHeight(5, 32);
    sheet.setRowHeight(6, 20);

    // 4. Visual Progress Gauge (Row 8-9)
    sheet.setRowHeight(7, 10);
    const gaugeStr = this.buildProgressGauge(timeSpanPct);
    sheet.getRange('A8:H8').merge().setValue(gaugeStr)
      .setFontSize(12).setFontWeight('bold').setFontFamily('Roboto Mono, Courier New, monospace')
      .setFontColor('#0B57D0').setBackground('#EEF2FF').setHorizontalAlignment('center').setVerticalAlignment('middle');
    sheet.setRowHeight(8, 26);

    // One row per stream CERA reads (TARGET_EVENTS): the event name it filters on, and the catalog keys of its name and
    // note (mon.sheet.stream.<id>, mon.sheet.note.<id>). Chrome logs every launch with command-line switches under
    // SUSPICIOUS_BROWSER_LAUNCH, its own startup switches included, so that stream is named "Browser Launch".
    const streamInfo = [
      ['CONTENT_TRANSFER', 'contentTransfer'],
      ['SENSITIVE_DATA_TRANSFER', 'sensitiveData'],
      ['PASSWORD_REUSE', 'passwordReuse'],
      ['MALWARE_TRANSFER', 'malware'],
      ['CONTENT_UNSCANNED', 'unscanned'],
      ['UNSAFE_SITE_VISIT', 'unsafeSite'],
      ['SUSPICIOUS_BROWSER_LAUNCH', 'browserLaunch']
    ];
    const streamCount = streamInfo.length;
    sheet.getRange('A9:H9').merge()
      .setValue(T('mon.sheet.processed', { n: totalLogs, streams: streamCount }))
      .setFontSize(9).setFontColor('#64748B').setBackground('#EEF2FF').setHorizontalAlignment('center').setVerticalAlignment('middle');
    sheet.setRowHeight(9, 20);
    sheet.getRange('A8:H9').setBorder(true, true, true, true, false, false, '#C7D2FE', SpreadsheetApp.BorderStyle.SOLID);

    // 5. Event Streams Table (Rows 11-19)
    sheet.setRowHeight(10, 14);
    sheet.getRange('A11:H11').merge().setValue(T('mon.sheet.streamsTitle', { n: streamCount }))
      .setFontSize(10).setFontWeight('bold').setFontColor('#0F172A').setBackground('#F1F5F9');
    sheet.setRowHeight(11, 22);

    const streamHeaders = ['stream', 'event', 'logs', 'earliest', 'latest', 'status', 'partition', 'notes'].map(c => T('mon.sheet.col.' + c));
    sheet.getRange(12, 1, 1, 8).setValues([streamHeaders])
      .setFontSize(9).setFontWeight('bold').setFontColor('#475569').setBackground('#E2E8F0');
    sheet.setRowHeight(12, 20);

    const streams = state.eventStreams || {};
    const isJobCompleted = !isIdle && (status === 'COMPLETED' || state.isCompleted);
    const streamStatus = isJobCompleted ? T('mon.sheet.streamStatus.completed')
      : status === 'PAUSED' ? T('mon.sheet.streamStatus.paused')
        : (isIdle || status === 'FAILED') ? T('mon.sheet.streamStatus.stopped')
          : T('mon.sheet.streamStatus.ingesting');

    const streamRows = streamInfo.map(([key, id]) => [
      T('mon.sheet.stream.' + id), key,
      num(streams[key] && streams[key].count),
      startDate, isIdle ? '--' : currentLogDate,
      streamStatus,
      isIdle ? '--' : T('mon.part', { n: fileIndex }), T('mon.sheet.note.' + id)
    ]);

    const lastStreamRow = 12 + streamCount;
    sheet.getRange(13, 1, streamCount, 8).setValues(streamRows)
      .setFontSize(9).setFontColor('#1E293B').setBackground('#FFFFFF');
    if (SpreadsheetApp.WrapStrategy && SpreadsheetApp.WrapStrategy.CLIP && typeof sheet.getRange(13, 8, streamCount, 1).setWrapStrategy === 'function') {
      sheet.getRange(13, 8, streamCount, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
    }
    for (let r = 13; r <= lastStreamRow; r++) sheet.setRowHeight(r, 20);
    sheet.getRange(11, 1, streamCount + 2, 8).setBorder(true, true, true, true, true, true, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);

    // 6. Google Drive Partitions Table (below the streams, after a spacer row)
    const partTitleRow = lastStreamRow + 2;
    sheet.setRowHeight(lastStreamRow + 1, 14);
    sheet.getRange(partTitleRow, 1, 1, 8).merge().setValue(T('mon.sheet.partsTitle', { max: maxRows }))
      .setFontSize(10).setFontWeight('bold').setFontColor('#0F172A').setBackground('#F1F5F9');
    sheet.setRowHeight(partTitleRow, 22);

    const partHeaders = ['part', 'name', 'rows', 'max', 'status', 'fileId', 'link', 'storage'].map(c => T('mon.sheet.pcol.' + c));
    sheet.getRange(partTitleRow + 1, 1, 1, 8).setValues([partHeaders])
      .setFontSize(9).setFontWeight('bold').setFontColor('#475569').setBackground('#E2E8F0');
    sheet.setRowHeight(partTitleRow + 1, 20);

    // A partition is IN_PROGRESS while rows are written to it and COMPLETED once it is full or the job ended
    const partStatus = raw => raw === 'COMPLETED' ? T('mon.sheet.part.completed')
      : (raw === 'STOPPED' || raw === 'IDLE') ? T('mon.status.stopped')
        : (raw === 'PAUSED') ? T('mon.sheet.streamStatus.paused')
          : (raw === 'IN_PROGRESS' || raw === 'WRITING' ? T('mon.sheet.part.writing') : raw);
    const sheetLink = fileId => `=HYPERLINK("https://docs.google.com/spreadsheets/d/${fileId}/edit", "${linkLabel(T('mon.sheet.openSheet'))}")`;
    const partRows = [];
    if (partitions && partitions.length > 0) {
      partitions.forEach((p, idx) => {
        partRows.push([
          T('mon.part', { n: idx + 1 }),
          p.fileName || `Chrome_Logs_Part_${String(idx + 1).padStart(2, '0')}`,
          num(p.rowCount),
          num(maxRows),
          partStatus(p.status || (idx === partitions.length - 1 && status === 'RUNNING' ? 'IN_PROGRESS' : 'COMPLETED')),
          p.fileId || '--',
          p.fileId ? sheetLink(p.fileId) : '--',
          T('mon.sheet.storage')
        ]);
      });
    } else {
      partRows.push([
        isIdle ? '--' : T('mon.part', { n: 1 }),
        state.currentFileName || (isIdle ? T('common.na') : T('mon.sheet.part.init')),
        num(currentRows),
        num(maxRows),
        partStatus(status === 'COMPLETED' ? 'COMPLETED' : (isIdle || status === 'FAILED' ? 'STOPPED' : (status === 'PAUSED' ? 'PAUSED' : 'IN_PROGRESS'))),
        state.currentFileId || '--',
        state.currentFileId ? sheetLink(state.currentFileId) : '--',
        T('mon.sheet.storage')
      ]);
    }

    const firstPartRow = partTitleRow + 2;
    sheet.getRange(firstPartRow, 1, partRows.length, 8).setValues(partRows)
      .setFontSize(9).setFontColor('#1E293B').setBackground('#FFFFFF');
    for (let pr = firstPartRow; pr < firstPartRow + partRows.length; pr++) sheet.setRowHeight(pr, 20);
    sheet.getRange(partTitleRow, 1, 2 + partRows.length, 8).setBorder(true, true, true, true, true, true, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);

    // 7. Action Guidance & Error Box (Below tables)
    const nextRow = firstPartRow + 1 + partRows.length;
    sheet.setRowHeight(nextRow - 1, 14);

    if (status === 'QUOTA_PAUSED') {
      sheet.getRange(nextRow, 1, 2, 8).merge()
        .setValue(T('mon.quotaDefault'))
        .setBackground('#F5F3FF').setFontColor('#6D28D9').setFontSize(9.5).setFontWeight('bold')
        .setHorizontalAlignment('center').setVerticalAlignment('middle');
      sheet.getRange(nextRow, 1, 2, 8).setBorder(true, true, true, true, false, false, '#C4B5FD', SpreadsheetApp.BorderStyle.SOLID);
    } else if (status === 'FAILED' && state.errorMessage) {
      const lastCursorInfo = state.currentLogDateStr ? T('mon.sheet.lastDate', { date: state.currentLogDateStr }) : '';
      sheet.getRange(nextRow, 1, 2, 8).merge()
        .setValue(T('mon.sheet.failed', { error: state.errorMessage, cursor: lastCursorInfo, menu: menuPath('menu.resume') }))
        .setBackground('#FEF2F2').setFontColor('#991B1B').setFontSize(9.5).setFontWeight('bold');
      sheet.getRange(nextRow, 1, 2, 8).setBorder(true, true, true, true, false, false, '#F87171', SpreadsheetApp.BorderStyle.SOLID);
    } else if (status === 'COMPLETED' || status === 'SUCCESS') {
      sheet.getRange(nextRow, 1, 2, 8).merge()
        .setValue(T('mon.sheet.completed', { days: totalDays, menu: menuPath('menu.open') }))
        .setBackground('#F0FDF4').setFontColor('#166534').setFontSize(10).setFontWeight('bold')
        .setHorizontalAlignment('center').setVerticalAlignment('middle');
      sheet.getRange(nextRow, 1, 2, 8).setBorder(true, true, true, true, false, false, '#86EFAC', SpreadsheetApp.BorderStyle.SOLID);
    } else if (isIdle) {
      sheet.getRange(nextRow, 1, 2, 8).merge()
        .setValue('🛑 ' + T('toast.reset.title') + ' — ' + T('toast.reset.body'))
        .setBackground('#FEF2F2').setFontColor('#991B1B').setFontSize(9.5).setFontWeight('bold')
        .setHorizontalAlignment('center').setVerticalAlignment('middle');
      sheet.getRange(nextRow, 1, 2, 8).setBorder(true, true, true, true, false, false, '#F87171', SpreadsheetApp.BorderStyle.SOLID);
    } else {
      sheet.getRange(nextRow, 1, 2, 8).merge()
        .setValue(T('mon.sheet.running', { menu: menuPath('menu.reset') }))
        .setBackground('#F8FAFC').setFontColor('#475569').setFontSize(9)
        .setHorizontalAlignment('center').setVerticalAlignment('middle');
      sheet.getRange(nextRow, 1, 2, 8).setBorder(true, true, true, true, false, false, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);
    }
  }
};
