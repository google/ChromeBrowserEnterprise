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
 * Module: SheetsReportEngine.gs
 * Description: Executive Overview & Forensic Threat Vector Sheets Report Builder
 * ==============================================================================
 */

/**
 * Makes a log-derived string safe to write into a cell.
 * Strings that Sheets would parse as a formula (= + - @, leading tab/CR) or
 * auto-convert to a number, date, percent or boolean ("1-2", "00123", "TRUE")
 * are prefixed with an apostrophe so they are stored as literal text.
 * Numbers are returned unchanged; null/undefined become an empty string.
 */
function sanitizeCellText_(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return value;
  if (value === '') return value;
  if (/^[=+\-@\t\r\n]/.test(value)) return "'" + value;
  if (/\d/.test(value) && /^[\s\d.,:\/%$€£¥()eE+\-]+$/.test(value)) return "'" + value;
  if (/^\s*(true|false)\s*$/i.test(value)) return "'" + value;
  return value;
}

/** Coerces a possibly missing value to a finite number (0 when missing). */
function reportNum_(value) {
  const n = Number(value);
  return isFinite(n) ? n : 0;
}

/** Formats a GB quantity as human-readable text (GB / MB / KB) via formatBytes. */
function reportGbText_(gb) {
  return formatBytes(reportNum_(gb) * (1024 ** 3));
}

/**
 * Converts a percent value such as "12.3%" or 12.3 into a fraction (0.123)
 * for a cell formatted as a percentage. Returns '' (blank cell) when missing.
 */
function reportPctFraction_(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = parseFloat(String(value).replace('%', ''));
  return isFinite(n) ? n / 100 : '';
}

/**
 * Peak card text from the outbound peak statistics (outlierMetrics.egressPeak, ceraPeakStats over dailyEgress):
 * a day is called a peak only under the deck's peak rule, otherwise it is the busiest outbound day. Downloads
 * never count.
 */
function reportPeakText_(outlierMetrics, lang) {
  const p = (outlierMetrics && outlierMetrics.egressPeak) || {};
  if (!p.basis) return ceraT('report.noOutbound', null, lang);
  const params = { date: formatDisplayDate(p.peakKey, true, lang), multiple: (Number(p.multiple) || 0).toFixed(1) };
  return ceraT(p.isPeak ? 'report.peak' : 'report.busiest', params, lang);
}

/**
 * Prepares a generated sheet for re-rendering: breaks apart existing merges
 * (clear() does not reliably remove them), clears content/formatting and removes charts.
 */
/**
 * Destinations ingestion matched to the organization's own domains (password reuse on corporate domains, plus any
 * internal-domain map the Security Radar carries), for the destination-type columns.
 */
function reportCorporateDomains_(state, radar) {
  const map = {};
  const add = m => Object.keys(m || {}).forEach(d => { map[d] = true; });
  add(state && state.securityRadar && state.securityRadar.passwordReuse && state.securityRadar.passwordReuse.internalDomains);
  add(radar && radar.internalDomains);
  add(radar && radar.signals && radar.signals.internalDomains);
  add(radar && radar.signals && radar.signals.passwordReuse && radar.signals.passwordReuse.internalDomains);
  return map;
}

/**
 * What a destination is, in the deck's words: browser page, local file, direct IP, internal host, corporate site or
 * external site.
 */
function reportDestinationKind_(name, corporate, lang) {
  let kind = ceraHostKind(name);
  if ((kind === 'external' || kind === 'internal') && corporate && corporate[name]) kind = 'corporate';
  return ceraT('deck.hostKind.' + kind, null, lang);
}

/**
 * The sheet of a report part in the report language: report.sheet.<part> names it ("Executive Overview",
 * "Personal Accounts", ...). A sheet a run in another language left under its own name is renamed rather than kept
 * beside the new one. index: the position of a new sheet (at the end when omitted).
 */
function reportSheet_(ss, part, lang, index) {
  const key = 'report.sheet.' + part;
  const title = ceraT(key, null, lang);
  let sheet = ss.getSheetByName(title);
  if (!sheet) {
    CERA_LOCALES.map(l => ceraT(key, null, l.code)).filter(n => n !== title).forEach(name => {
      const old = sheet ? null : ss.getSheetByName(name);
      if (old) {
        old.setName(title);
        sheet = old;
      }
    });
  }
  if (!sheet) sheet = index === undefined ? ss.insertSheet(title) : ss.insertSheet(title, index);
  return sheet;
}

/** Name of a vector (personal, shadowAi, unmanaged, messaging, securityRadar) in the workbook, as its sheet is named. */
function reportVectorName_(key, lang) {
  return ceraT('report.sheet.' + key, null, lang);
}

function resetGeneratedSheet_(sheet) {
  if (typeof sheet.getMaxRows === 'function' && typeof sheet.getMaxColumns === 'function') {
    try {
      sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).breakApart();
    } catch (e) {
      console.warn('Sheet reset: could not break apart merges on "' + (sheet.getName ? sheet.getName() : '') + '": ' + (e && e.message ? e.message : e));
    }
  }
  sheet.clear();
  if (typeof sheet.getCharts === 'function') {
    sheet.getCharts().forEach(c => sheet.removeChart(c));
  }
}

/**
 * Renders executive cyber operations dashboard sheet
 */
function renderExecutiveOverview(ss, state, outlierMetrics) {
  state = state || {};
  outlierMetrics = outlierMetrics || {};
  const lang = ceraNormalizeLang_(state.reportLang || 'en');
  const T = (key, params) => ceraT(key, params, lang);
  // The overview comes first, whether it is new, kept or renamed from another language
  const sheet = reportSheet_(ss, 'overview', lang, 0);
  ss.setActiveSheet(sheet);
  ss.moveActiveSheet(1);

  resetGeneratedSheet_(sheet);
  sheet.setHiddenGridlines(true); // Modern executive styling

  const totalBytes = reportNum_(state.totalBytes);
  const totalEvents = reportNum_(state.totalEvents);
  const vectors = state.vectors || {};
  const radarState = state.securityRadar || {};

  const vectorStats = [];

  for (let key in vectors) {
    const v = vectors[key];
    if (!v) continue;
    const vGb = (v.totalBytes || 0) / (1024 ** 3);
    const topDomain = mapToSortedArray(v.domains || {}, 1);
    const topOU = (typeof subMapToStackedArray === 'function' && v.actions) ? subMapToStackedArray(v.ous || {}, 1) : mapToSortedArray(v.ous || {}, 1);

    const stat = {
      name: reportVectorName_(key, lang),
      count: v.totalEvents || v.totalIncidents || 0,
      bytes: v.totalBytes || 0,
      volumeGb: vGb,
      topDomain: topDomain.length ? topDomain[0].name : '-',
      topOU: topOU.length ? topOU[0].name : '-'
    };
    vectorStats.push(stat);
  }

  // Largest outbound channel and destination (uploads, pastes, prints; downloads are not data leaving)
  const outTotal = reportNum_(state.egress && state.egress.bytes);
  let outChannel = null;
  const outDest = {};
  ['personal', 'shadowAi', 'unmanaged', 'messaging'].forEach(k => {
    const v = vectors[k] || {};
    const b = reportNum_(v.egress && v.egress.bytes);
    const c = reportNum_(v.egress && v.egress.count);
    if (c > 0 && (!outChannel || b > outChannel.bytes || (b === outChannel.bytes && c > outChannel.count))) outChannel = { key: k, bytes: b, count: c };
    Object.keys(v.domains || {}).forEach(d => {
      const e = v.domains[d] || {};
      if (reportNum_(e.egressBytes) > 0) outDest[d] = (outDest[d] || 0) + reportNum_(e.egressBytes);
    });
  });
  const topOutDest = Object.keys(outDest).sort((a, b) => outDest[b] - outDest[a] || (a < b ? -1 : 1))[0];
  const topGlobalType = subMapToStackedArray(state.globalTypes || {}, 1);
  const totalUniqueOUs = Object.keys(state.globalOUs || {}).length;
  const totalUniqueUsers = Object.keys(state.globalUsers || {}).length;

  // Banner
  sheet.getRange('B2:S2').merge()
    .setValue(T('report.ov.banner'))
    .setBackground('#0F172A').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(13).setHorizontalAlignment('left');

  // What the counts below are made of: the log rows read and, when ingestion counts user actions, the actions those
  // rows were merged into (the same disclosure as the deck cover)
  const cov = state.coverage || {};
  const coverageNote = typeof cov.actions === 'number'
    ? ceraT('report.coverage.actions', { rows: reportNum_(cov.rowsRead), actions: cov.actions, merged: reportNum_(cov.rowsMerged) }, lang)
    : ceraT('report.coverage.rows', { rows: reportNum_(cov.rowsRead), deduped: reportNum_(cov.dedupedRows) }, lang);
  sheet.getRange('B3:S3').merge().setValue(coverageNote)
    .setFontStyle('italic').setFontColor('#64748B').setFontSize(8).setHorizontalAlignment('left');

  // KPI Hero Cards: transfers and volume of the four channels in every direction (downloads included)
  sheet.getRange('B4:C4').merge().setValue(ceraT('report.kpi.transfers', null, lang)).setFontColor('#64748B').setFontSize(9).setFontWeight('bold');
  sheet.getRange('B5:C5').merge().setValue(totalEvents).setNumberFormat('#,##0').setFontColor('#0F172A').setFontSize(16).setFontWeight('bold');
  sheet.getRange('B4:C5').setBackground('#F8FAFC').setBorder(true, true, true, false, false, false, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);

  sheet.getRange('D4:E4').merge().setValue(ceraT('report.kpi.volume', null, lang)).setFontColor('#64748B').setFontSize(9).setFontWeight('bold');
  sheet.getRange('D5:E5').merge().setValue(formatBytes(totalBytes)).setFontColor('#0F172A').setFontSize(16).setFontWeight('bold');
  sheet.getRange('D4:E5').setBackground('#F8FAFC').setBorder(true, true, true, false, false, false, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);

  // The channel most data left through, as in the briefing below and on the deck (downloads do not rank it)
  sheet.getRange('F4:H4').merge().setValue(ceraT('report.kpi.channel', null, lang)).setFontColor('#64748B').setFontSize(9).setFontWeight('bold');
  sheet.getRange('F5:H5').merge().setValue(outChannel ? ceraT('deck.vector.' + outChannel.key, null, lang) : ceraT('report.kpi.channelNone', null, lang)).setFontColor('#DC2626').setFontSize(14).setFontWeight('bold');
  sheet.getRange('F4:H5').setBackground('#F8FAFC').setBorder(true, true, true, false, false, false, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);

  sheet.getRange('I4:K4').merge().setValue(T('report.ov.unitsLabel')).setFontColor('#64748B').setFontSize(9).setFontWeight('bold');
  sheet.getRange('I5:K5').merge().setValue(T('report.ov.unitsValue', { units: totalUniqueOUs, users: totalUniqueUsers })).setFontColor('#0F172A').setFontSize(14).setFontWeight('bold');
  sheet.getRange('I4:K5').setBackground('#F8FAFC').setBorder(true, true, true, false, false, false, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);

  // Security Radar Hero Card (Password Reuse, Malware & Unsafe Site Visits)
  const radarVecSignals = (vectors.securityRadar && vectors.securityRadar.signals) || {};
  const pwReuseCount = reportNum_(radarState.passwordReuse && radarState.passwordReuse.total);
  const malwareCount = reportNum_(radarState.malwareTransfer && radarState.malwareTransfer.total);
  const unsafeSiteCount = reportNum_(radarState.unsafeSiteVisit && radarState.unsafeSiteVisit.total) ||
    reportNum_(radarVecSignals.unsafeSiteVisit && radarVecSignals.unsafeSiteVisit.total);
  sheet.getRange('L4:N4').merge().setValue(T('report.ov.radarLabel')).setFontColor('#64748B').setFontSize(9).setFontWeight('bold');
  sheet.getRange('L5:N5').merge().setValue(T('report.ov.radarValue', { pw: pwReuseCount, mal: malwareCount, unsafe: unsafeSiteCount })).setFontColor('#7C3AED').setFontSize(10).setFontWeight('bold');
  sheet.getRange('L4:N5').setBackground('#FAF5FF').setBorder(true, true, true, false, false, false, '#E9D5FF', SpreadsheetApp.BorderStyle.SOLID);

  // Temporal Anomaly Card
  sheet.getRange('O4:S4').merge().setValue(T('report.ov.burstLabel')).setFontColor('#64748B').setFontSize(9).setFontWeight('bold');
  sheet.getRange('O5:S5').merge().setValue(reportPeakText_(outlierMetrics, lang)).setFontColor('#EA580C').setFontSize(11).setFontWeight('bold');
  sheet.getRange('O4:S5').setBackground('#FFFBEB').setBorder(true, true, true, true, false, false, '#FDE68A', SpreadsheetApp.BorderStyle.SOLID);

  // Dynamic Executive Briefing Banner
  // Unit that sent the most data out (outbound bytes, or outbound transfers when none had a size), as on the deck's
  // unit slide; downloads do not rank a unit here
  const outboundBySize = reportNum_(state.egress && state.egress.bytes) > 0;
  const topOutUnit = Object.keys(state.globalOUs || {}).map(k => {
    const e = state.globalOUs[k] || {};
    return { name: e.name || k, bytes: reportNum_(e.egressBytes), count: reportNum_(e.egressCount) };
  }).filter(u => u.name && u.name !== 'N/A' && (u.bytes > 0 || u.count > 0))
    .sort((a, b) => b.bytes - a.bytes || b.count - a.count || (a.name < b.name ? -1 : 1))[0] || null;
  const topTypeName = topGlobalType.length ? ceraMimeLabel(topGlobalType[0].name, lang) : T('deck.notRecorded');

  // User concentration measured like the deck: the fewest people holding 80% of the outbound data of identified people
  const egressUsers = (state.egress && state.egress.users) || {};
  const concByCount = !(reportNum_(state.egress && state.egress.bytes) > 0);
  const concAmounts = Object.keys(egressUsers).map(u => reportNum_(egressUsers[u] && (concByCount ? egressUsers[u].count : egressUsers[u].bytes)));
  const concTotal = concAmounts.reduce((sum, v) => sum + v, 0);
  const conc = ceraConcentration(concAmounts);
  const concText = ceraConcentrationText(conc, concByCount ? ceraT('deck.transfers', { n: concTotal }, lang) : formatBytes(concTotal), lang);
  const briefingLines = [T('report.briefing.title')];
  briefingLines.push(outChannel
    ? ceraT('report.briefing.channel', { vector: ceraT('deck.vector.' + outChannel.key, null, lang), pct: outTotal > 0 ? ((outChannel.bytes / outTotal) * 100).toFixed(1) + '%' : '0.0%', amount: formatBytes(outChannel.bytes), n: outChannel.count }, lang)
    : ceraT('report.briefing.channelNone', null, lang));
  briefingLines.push(topOutUnit
    ? ceraT('report.briefing.concentration', { badge: ceraT('deck.conc.' + conc.badge, null, lang), text: concText, units: totalUniqueOUs, ou: topOutUnit.name,
      amount: outboundBySize ? formatBytes(topOutUnit.bytes) : ceraT('deck.transfers', { n: topOutUnit.count }, lang) }, lang)
    : ceraT('report.briefing.concentrationNoUnit', { badge: ceraT('deck.conc.' + conc.badge, null, lang), text: concText, units: totalUniqueOUs }, lang));
  // What left and what was stopped, as the logs show it (ceraOutcomeMode); the Policy Outcomes sheet has the detail
  const outMode = ceraOutcomeMode(state);
  const outFacts = ceraOutcomeFacts(state.egress);
  if (outMode === 'enforced' && outChannel) {
    briefingLines.push(ceraT('report.briefing.outcomeEnforced', { left: formatBytes(outFacts.left.bytes), stopped: formatBytes(outFacts.stopped.bytes),
      n: outFacts.stopped.count, total: reportNum_(state.egress && state.egress.count), list: ceraOutcomeListText(outFacts.outcomes, CeraConfig.OUTCOME_STOPPED, lang) }, lang));
  } else if (outMode === 'audit') {
    briefingLines.push(ceraT('report.briefing.outcomeAudit', null, lang));
  } else if (outMode === 'not_reported') {
    briefingLines.push(ceraT('report.briefing.outcomeNotReported', null, lang));
  }
  if (topGlobalType.length) briefingLines.push(ceraT('report.briefing.format', { type: topTypeName, amount: formatBytes(topGlobalType[0].totalBytes) }, lang));
  if (topOutDest) briefingLines.push(ceraT('report.briefing.destination', { dest: ceraDestinationLabel(topOutDest, lang), amount: formatBytes(outDest[topOutDest]) }, lang));
  briefingLines.push(T('report.briefing.behavior', { text: (typeof DynamicNarrativeEngine !== 'undefined') ? DynamicNarrativeEngine.getOutlierNarrative(outlierMetrics, lang, state) : '' }));
  const briefing = briefingLines.join('\n');

  sheet.getRange('B7:S10').merge()
    .setValue(briefing)
    .setBackground('#F8FAFC').setFontColor('#1E293B').setFontSize(9).setWrap(true).setVerticalAlignment('middle')
    .setBorder(true, true, true, true, false, false, '#E2E8F0', SpreadsheetApp.BorderStyle.SOLID);

  // Cross-Vector Matrix
  sheet.getRange('B12:H12').merge()
    .setValue(T('report.ov.matrixTitle'))
    .setBackground('#E2E8F0').setFontColor('#0F172A').setFontWeight('bold').setFontSize(10);

  const matrixHeaders = [['vector', 'events', 'eventShare', 'volumeGb', 'volumeShare', 'endpoint', 'unit'].map(c => T('report.ov.col.' + c))];
  sheet.getRange('B13:H13').setValues(matrixHeaders).setBackground('#F1F5F9').setFontColor('#475569').setFontWeight('bold').setFontSize(9);

  const matrixRows = vectorStats.map(vs => [
    sanitizeCellText_(vs.name),
    vs.count,
    totalEvents > 0 ? vs.count / totalEvents : 0,
    vs.volumeGb,
    totalBytes > 0 ? vs.bytes / totalBytes : 0,
    sanitizeCellText_(vs.topDomain),
    sanitizeCellText_(vs.topOU)
  ]);

  const numVectors = matrixRows.length;
  sheet.getRange(14, 2, numVectors, 7).setValues(matrixRows).setFontSize(9);
  sheet.getRange(14, 3, numVectors, 1).setNumberFormat('#,##0');
  sheet.getRange(14, 4, numVectors, 1).setNumberFormat('0.0%');
  sheet.getRange(14, 5, numVectors, 1).setNumberFormat('#,##0.00');
  sheet.getRange(14, 6, numVectors, 1).setNumberFormat('0.0%');
  sheet.getRange(14, 2, numVectors, 7).setBorder(true, true, true, true, true, true, '#E2E8F0', SpreadsheetApp.BorderStyle.SOLID);

  // Transfers without a recorded destination are outside the vectors above: disclosed here, never dropped
  const unknownDest = state.unknownDestinations || {};
  if (reportNum_(unknownDest.count) > 0) {
    sheet.getRange(14 + numVectors, 2, 1, 7).merge()
      .setValue(ceraT('report.unknownDestinations', { n: reportNum_(unknownDest.count), bytes: formatBytes(reportNum_(unknownDest.bytes)), out: reportNum_(unknownDest.egressCount) }, lang))
      .setFontStyle('italic').setFontColor('#64748B').setFontSize(8).setWrap(true);
  }

  // Print jobs are outside the vectors too (a print sends nothing to the site of the page): disclosed on the next row,
  // with the detectors of the sensitive jobs named as on the deck's printing slide
  const printState = state.printStats || {};
  const printJobs = reportNum_(printState.totalEvents);
  if (printJobs > 0) {
    const printPeople = Object.keys(printState.users || {}).length;
    const printSensitive = reportNum_(printState.sensitivity && printState.sensitivity.sensitiveCount);
    const printDetectors = ceraDetectorListText(ceraSensitivityDetectorNames(printState.sensitivity, printState.sensitivity && printState.sensitivity.detectorNames), true, lang);
    const printParts = [printPeople > 0
      ? ceraT('report.printing', { n: printJobs, people: ceraT('deck.people', { n: printPeople }, lang) }, lang)
      : ceraT('report.printingNoPeople', { n: printJobs }, lang)];
    if (printSensitive > 0) printParts.push(ceraT('report.printingSensitive', { n: printSensitive }, lang));
    if (printSensitive > 0 && printDetectors) printParts.push(ceraT('deck.print.detectors', { list: printDetectors }, lang));
    sheet.getRange(14 + numVectors + (reportNum_(unknownDest.count) > 0 ? 1 : 0), 2, 1, 7).merge()
      .setValue(printParts.join(' '))
      .setFontStyle('italic').setFontColor('#64748B').setFontSize(8).setWrap(true);
  }

  // Embed Native Google Sheets Chart (Offline Resilient)
  try {
    const chart = sheet.newChart()
      .setChartType(Charts.ChartType.BAR)
      .addRange(sheet.getRange(13, 2, numVectors + 1, 1))
      .addRange(sheet.getRange(13, 5, numVectors + 1, 1))
      .setPosition(14 + numVectors + 2, 2, 0, 0)
      .setOption('title', T('report.ov.chartVolume'))
      .setOption('colors', ['#2563EB'])
      .setOption('legend', { position: 'none' })
      .setOption('width', 480)
      .setOption('height', 240)
      .build();
    sheet.insertChart(chart);
  } catch (e) {
    console.warn('Executive Overview chart "Payload Volume by Threat Vector" failed: ' + (e && e.message ? e.message : e));
  }

  // Security signals: what the log shows, and the action the deck recommends for each (InsightEngine.recByTopic)
  const insightRecs = (typeof InsightEngine !== 'undefined')
    ? (InsightEngine.build(state, outlierMetrics, { lang: lang, authorizedGenAi: (state.scope && state.scope.authorizedGenAi) || [] }).recByTopic || {})
    : {};
  const recText = topics => {
    const list = [];
    topics.forEach(t => (insightRecs[t] || []).forEach(r => list.push('• ' + r)));
    return list.length ? list.join('\n') : ceraT('report.adv.noAction', null, lang);
  };
  const topInternalPw = countMapToArray(radarState.passwordReuse ? (radarState.passwordReuse.internalDomains || {}) : {}, 2);
  const topExternalPw = countMapToArray(radarState.passwordReuse ? (radarState.passwordReuse.externalDomains || {}) : {}, 2);
  // Flagged files by name; files without a real name are grouped per source instead of shown by an opaque id
  const topMalFiles = ceraMalwareFileRows(state, lang).slice(0, 2);
  const pwUsersCount = radarState.passwordReuse && radarState.passwordReuse.users ? Object.keys(radarState.passwordReuse.users).length : 0;
  const malUsersCount = radarState.malwareTransfer && radarState.malwareTransfer.users ? Object.keys(radarState.malwareTransfer.users).length : 0;

  sheet.getRange('J19:S19').merge()
    .setValue(ceraT('report.adv.title', null, lang))
    .setBackground('#0F172A').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(10).setHorizontalAlignment('left');

  const advHeaders = [[ceraT('report.adv.signal', null, lang), '', ceraT('report.adv.count', null, lang), ceraT('report.adv.observed', null, lang), '', '', '', ceraT('report.adv.action', null, lang), '', '']];
  sheet.getRange('J20:S20').setValues(advHeaders).setBackground('#F1F5F9').setFontColor('#475569').setFontWeight('bold').setFontSize(8);
  sheet.getRange('J20:K20').merge();
  sheet.getRange('M20:P20').merge();
  sheet.getRange('Q20:S20').merge();

  // Row 21-23: Password Reuse
  sheet.getRange('J21:K23').merge()
    .setValue(T('report.ov.sigPw'))
    .setBackground('#FAF5FF').setFontColor('#7C3AED').setFontWeight('bold').setFontSize(9).setVerticalAlignment('middle').setHorizontalAlignment('center');

  sheet.getRange('L21:L23').merge()
    .setValue(T('report.ov.sigPwValue', { n: pwReuseCount, users: pwUsersCount }))
    .setBackground('#FAF5FF').setFontColor('#7C3AED').setFontWeight('bold').setFontSize(8).setVerticalAlignment('middle').setHorizontalAlignment('center');

  const noneLogged = ceraT('report.adv.none', null, lang);
  const intPwStr = topInternalPw.length > 0 ? topInternalPw.map(x => ceraDestinationLabel(x.name, lang)).join(', ') : noneLogged;
  const extPwStr = topExternalPw.length > 0 ? topExternalPw.map(x => ceraDestinationLabel(x.name, lang)).join(', ') : noneLogged;
  const pwContextNote = ceraT('report.adv.pwSites', { corporate: intPwStr, other: extPwStr }, lang);
  sheet.getRange('M21:P23').merge()
    .setValue(pwContextNote)
    .setBackground('#FFFFFF').setFontColor('#1E293B').setFontSize(8).setWrap(true).setVerticalAlignment('middle');

  sheet.getRange('Q21:S23').merge()
    .setValue(recText(['password']))
    .setBackground('#FAF5FF').setFontColor('#6D28D9').setFontSize(8).setWrap(true).setVerticalAlignment('middle');

  // Row 24-26: Potentially Malicious Files
  sheet.getRange('J24:K26').merge()
    .setValue(T('report.ov.sigMal'))
    .setBackground('#FFFBEB').setFontColor('#D97706').setFontWeight('bold').setFontSize(9).setVerticalAlignment('middle').setHorizontalAlignment('center');

  sheet.getRange('L24:L26').merge()
    .setValue(T('report.ov.sigMalValue', { n: malwareCount, users: malUsersCount }))
    .setBackground('#FFFBEB').setFontColor('#D97706').setFontWeight('bold').setFontSize(8).setVerticalAlignment('middle').setHorizontalAlignment('center');

  const malFileStr = topMalFiles.length > 0 ? topMalFiles.map(x => x.name).join(', ') : noneLogged;
  const malContextNote = ceraT('report.adv.malFiles', { files: malFileStr }, lang);
  sheet.getRange('M24:P26').merge()
    .setValue(malContextNote)
    .setBackground('#FFFFFF').setFontColor('#1E293B').setFontSize(8).setWrap(true).setVerticalAlignment('middle');

  sheet.getRange('Q24:S26').merge()
    .setValue(recText(['malware']))
    .setBackground('#FFFBEB').setFontColor('#B45309').setFontSize(8).setWrap(true).setVerticalAlignment('middle');

  // Row 27-29: Behavioral Outliers
  sheet.getRange('J27:K29').merge()
    .setValue(T('report.ov.sigOutliers'))
    .setBackground('#F0FDF4').setFontColor('#166534').setFontWeight('bold').setFontSize(9).setVerticalAlignment('middle').setHorizontalAlignment('center');

  sheet.getRange('L27:L29').merge()
    .setValue(reportPeakText_(outlierMetrics, lang))
    .setBackground('#F0FDF4').setFontColor('#166534').setFontWeight('bold').setFontSize(8).setWrap(true).setVerticalAlignment('middle').setHorizontalAlignment('center');

  // Destination concentration and spread of the people above 50 MB of outbound data (computeOutlierAnalytics)
  const validUnit = u => !!u && u !== 'N/A';
  const outlierLines = [];
  if (validUnit(outlierMetrics.topFunnelOU) && reportNum_(outlierMetrics.funnelHHI) > 0) {
    outlierLines.push(ceraT('report.adv.funnel', { ou: outlierMetrics.topFunnelOU, amount: reportGbText_(outlierMetrics.funnelVolumeGb), dest: ceraDestinationLabel(outlierMetrics.topFunnelDomain, lang), hhi: (reportNum_(outlierMetrics.funnelHHI) * 100).toFixed(0) + '%' }, lang));
  }
  if (validUnit(outlierMetrics.topScatterOU) && reportNum_(outlierMetrics.scatterDomainCount) > 0) {
    outlierLines.push(ceraT('report.adv.scatter', { ou: outlierMetrics.topScatterOU, n: reportNum_(outlierMetrics.scatterDomainCount) }, lang));
  }
  const outlierContextNote = outlierLines.length ? outlierLines.join('\n') : ceraT('report.adv.outliersNone', null, lang);
  sheet.getRange('M27:P29').merge()
    .setValue(outlierContextNote)
    .setBackground('#FFFFFF').setFontColor('#1E293B').setFontSize(8).setWrap(true).setVerticalAlignment('middle');

  sheet.getRange('Q27:S29').merge()
    .setValue(ceraT('report.adv.noAction', null, lang))
    .setBackground('#F0FDF4').setFontColor('#15803d').setFontSize(8).setWrap(true).setVerticalAlignment('middle');

  // Row 30-32: Web Perimeter & Browsing Integrity (Unsafe Site Visits)
  const unsafeStats = radarState.unsafeSiteVisit || { total: 0, users: {} };
  const vecUnsafe = radarVecSignals.unsafeSiteVisit || {};
  const unsafeCount = reportNum_(unsafeStats.total) || reportNum_(vecUnsafe.total);
  const unsafeUsersCount = unsafeStats.users ? Object.keys(unsafeStats.users).length : Object.keys(vecUnsafe.users || {}).length;
  // Bypassed and heeded warnings of these visits (not of the other signals)
  const bypassCount = reportNum_(vecUnsafe.bypassed);
  const warnedCountAll = reportNum_(vecUnsafe.warned);
  const bypassPct = (bypassCount + warnedCountAll > 0)
    ? ((bypassCount / (bypassCount + warnedCountAll)) * 100).toFixed(1)
    : '0.0';
  // Visits recorded without any Event Result: the bypass rate is unknown, not 0%
  const unsafeUnreported = reportNum_(vecUnsafe.unreported);
  const unsafeBypassUnknown = unsafeUnreported > 0 && unsafeUnreported >= reportNum_(vecUnsafe.total);

  sheet.getRange('J30:K32').merge()
    .setValue(T('report.ov.sigUnsafe'))
    .setBackground('#EFF6FF').setFontColor('#1D4ED8').setFontWeight('bold').setFontSize(9).setVerticalAlignment('middle').setHorizontalAlignment('center');

  sheet.getRange('L30:L32').merge()
    .setValue(T('report.ov.sigUnsafeValue', { n: unsafeCount, users: unsafeUsersCount,
      bypass: unsafeBypassUnknown ? T('report.bypassNotReported') : T('report.ov.bypassedPct', { pct: bypassPct }) }))
    .setBackground('#EFF6FF').setFontColor('#1D4ED8').setFontWeight('bold').setFontSize(8).setVerticalAlignment('middle').setHorizontalAlignment('center');

  const unsafeInternal = Object.keys(vecUnsafe.domains || {}).filter(d => isInternalHost(d))
    .reduce((t, d) => t + reportNum_(vecUnsafe.domains[d] && vecUnsafe.domains[d].total), 0);
  let unsafeContextNote;
  if (unsafeCount === 0) {
    unsafeContextNote = ceraT('report.radar.callout3ANone', null, lang);
  } else {
    unsafeContextNote = '• ' +
      (unsafeBypassUnknown
        ? ceraT('deck.radar.bypassUnknown', null, lang)
        : (bypassCount + warnedCountAll > 0
          ? ceraT('report.radar.bypassed', { n: bypassCount, total: bypassCount + warnedCountAll, pct: bypassPct + '%' }, lang)
          : ceraT('report.radar.bypassedNone', null, lang))) + '\n• ' +
      ceraT('report.adv.unsafeInternal', { n: unsafeInternal, total: unsafeCount }, lang);
  }
  sheet.getRange('M30:P32').merge()
    .setValue(unsafeContextNote)
    .setBackground('#FFFFFF').setFontColor('#1E293B').setFontSize(8).setWrap(true).setVerticalAlignment('middle');

  sheet.getRange('Q30:S32').merge()
    .setValue(recText(['certs', 'safeBrowsing']))
    .setBackground('#EFF6FF').setFontColor('#1E40AF').setFontSize(8).setWrap(true).setVerticalAlignment('middle');

  sheet.getRange('J19:S32').setBorder(true, true, true, true, true, true, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);

  // =========================================================================
  // SECTION 3: CROSS-VECTOR OUTLIER TIMELINE & MULTI-THREAT SURGE DYNAMICS
  // =========================================================================
  // Centred on the busiest outbound day (all directions only when nothing left the browser); the centre row is
  // called a peak only under the deck's peak rule
  const egressPeak = (outlierMetrics && outlierMetrics.egressPeak) || {};
  const peakOverallDate = egressPeak.peakKey || (outlierMetrics && (outlierMetrics.rawPeakDate || outlierMetrics.peakDate)) || null;
  const crossVectorTimeline = (typeof computeCrossVectorOutlierTimeline === 'function')
    ? computeCrossVectorOutlierTimeline(vectors, peakOverallDate, 7, lang)
    : [];

  const execTimelineHeaderRow = 35;
  sheet.getRange(execTimelineHeaderRow, 2, 1, 18).merge()
    .setValue(T('report.ov.timelineTitle'))
    .setBackground('#0F172A').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(10).setHorizontalAlignment('left');

  sheet.getRange(execTimelineHeaderRow + 1, 2, 1, 18).merge()
    .setValue(T('report.ov.timelineSub'))
    .setFontStyle('italic').setFontColor('#64748B').setFontSize(8);

  const execTimelineHeaders = [T('report.col.date')]
    .concat(['personal', 'shadowAi', 'unmanaged', 'messaging'].map(k => T('report.col.gbOf', { name: reportVectorName_(k, lang) })))
    .concat([T('report.ov.col.radarIncidents'), T('report.ov.col.status')]);
  sheet.getRange(execTimelineHeaderRow + 2, 2, 1, execTimelineHeaders.length).setValues([execTimelineHeaders])
    .setBackground('#F1F5F9').setFontColor('#334155').setFontWeight('bold').setFontSize(8).setHorizontalAlignment('center');

  const execTimelineRows = [];
  crossVectorTimeline.forEach(item => {
    const isPeak = item.isPeak && egressPeak.isPeak === true;
    const status = isPeak
      ? T('report.ov.statusPeak', { multiple: (Number(egressPeak.multiple) || 0).toFixed(1) })
      : T(item.totalDlpGb > 0 || item.radarIncidents > 0 ? 'report.ov.statusActive' : 'report.status.noActivity');

    execTimelineRows.push([
      item.displayDate || item.date,
      item.personalGb,
      item.shadowGb,
      item.unmanagedGb,
      item.messagingGb,
      item.radarIncidents,
      status
    ]);
  });

  if (execTimelineRows.length > 0) {
    sheet.getRange(execTimelineHeaderRow + 3, 2, execTimelineRows.length, execTimelineHeaders.length)
      .setValues(execTimelineRows).setFontSize(8);
    sheet.getRange(execTimelineHeaderRow + 3, 3, execTimelineRows.length, 4).setNumberFormat('#,##0.00'); // DLP Volumes (GB)
    sheet.getRange(execTimelineHeaderRow + 3, 7, execTimelineRows.length, 1).setNumberFormat('#,##0');    // Security Incidents
    sheet.getRange(execTimelineHeaderRow + 3, 2, execTimelineRows.length, execTimelineHeaders.length)
      .setBorder(true, true, true, true, true, true, '#E2E8F0', SpreadsheetApp.BorderStyle.SOLID);
  }

  // Embed Multi-Vector Outlier Combo Chart (Rows 37 to 52, Cols J to S / Cols 10 to 19)
  if (typeof NativeSheetsChartEngine !== 'undefined' && execTimelineRows.length > 0) {
    const execChartRange = sheet.getRange(execTimelineHeaderRow + 2, 2, execTimelineRows.length + 1, 6);
    NativeSheetsChartEngine.buildMultiVectorOutlierComboChart(
      sheet,
      execChartRange,
      execTimelineHeaderRow + 2,
      10, // Column J
      680,
      310,
      T('report.ov.chartTimeline'),
      lang
    );
  }

  // Column width configuration for Executive Overview
  sheet.setColumnWidth(2, 110);  // B: Threat Vector / Date
  sheet.setColumnWidth(3, 85);   // C: Events / Personal GB
  sheet.setColumnWidth(4, 85);   // D: Event Share / Shadow AI GB
  sheet.setColumnWidth(5, 90);   // E: Volume GB / Unmanaged Apps GB
  sheet.setColumnWidth(6, 85);   // F: Volume Share / Web Messaging GB
  sheet.setColumnWidth(7, 130);  // G: Primary Endpoint / Security Radar Incidents
  sheet.setColumnWidth(8, 140);  // H: Primary Impacted Unit / Cross-Vector Status
  sheet.setColumnWidth(9, 20);   // I: Spacer
  sheet.setColumnWidth(10, 80);  // J: Signal / Chart Start
  sheet.setColumnWidth(11, 75);  // K:
  sheet.setColumnWidth(12, 90);  // L: Count
  sheet.setColumnWidth(13, 95);  // M: Observed in the log 1
  sheet.setColumnWidth(14, 95);  // N: Observed in the log 2
  sheet.setColumnWidth(15, 95);  // O: Observed in the log 3
  sheet.setColumnWidth(16, 95);  // P: Observed in the log 4
  sheet.setColumnWidth(17, 100); // Q: Recommended action 1
  sheet.setColumnWidth(18, 100); // R: Recommended action 2
  sheet.setColumnWidth(19, 105); // S: Recommended action 3
}

// Outcome classes in the order of the report's columns (CeraConfig.EVENT_RESULT_CLASSES, plus other and not reported)
var CERA_OUTCOME_COLUMNS = ['blocked', 'cancelled', 'warned', 'bypassed', 'detected', 'masked', 'unmasked', 'other', 'notReported'];

/**
 * Renders the Policy Outcomes sheet: the outcome mode of the logs; outbound transfers per channel, attempted, left
 * and stopped, with every outcome class; the destinations with the most transfers stopped; prints, sensitive prints,
 * clipboard copies and data shown on pages by outcome; security signals per event; and how outcomes are counted.
 */
function renderPolicyOutcomesSheet(ss, state) {
  state = state || {};
  const lang = ceraNormalizeLang_(state.reportLang || 'en');
  const T = (key, params) => ceraT(key, params, lang);
  const sheet = reportSheet_(ss, 'outcomes', lang);
  resetGeneratedSheet_(sheet);
  sheet.setHiddenGridlines(true);
  const mode = ceraOutcomeMode(state);
  const width = 7 + CERA_OUTCOME_COLUMNS.length;
  const classCounts = outcomes => CERA_OUTCOME_COLUMNS.map(c => reportNum_(outcomes && outcomes[c] && outcomes[c].count));
  const classHeaders = CERA_OUTCOME_COLUMNS.map(c => T('report.outcomes.class.' + c));
  const header = (row, values) => sheet.getRange(row, 2, 1, values.length).setValues([values])
    .setBackground('#F1F5F9').setFontColor('#334155').setFontWeight('bold').setFontSize(8).setWrap(true);
  const section = (row, text) => sheet.getRange(row, 2, 1, width).merge().setValue(text)
    .setBackground('#0F172A').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(10).setHorizontalAlignment('left');
  const table = (row, rows, countCols) => {
    if (!rows.length) return;
    sheet.getRange(row, 2, rows.length, rows[0].length).setValues(rows).setFontSize(8)
      .setBorder(true, true, true, true, true, true, '#E2E8F0', SpreadsheetApp.BorderStyle.SOLID);
    countCols.forEach(c => sheet.getRange(row, c, rows.length, 1).setNumberFormat('#,##0'));
  };

  sheet.getRange(2, 2, 1, width).merge().setValue(T('report.outcomes.title'))
    .setBackground('#0F172A').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(12).setHorizontalAlignment('left');
  sheet.getRange(3, 2, 1, width).merge().setValue(T('report.outcomes.mode.' + mode))
    .setFontStyle('italic').setFontColor('#475569').setFontSize(9).setWrap(true);

  // 1. Outbound transfers per channel: attempted, left, stopped and every outcome class
  let row = 5;
  section(row, T('report.outcomes.outboundTitle'));
  header(row + 1, [T('report.outcomes.channel'), T('report.outcomes.transfers'), T('report.outcomes.volume'), T('report.outcomes.left'),
    T('report.outcomes.leftVolume'), T('report.outcomes.stopped'), T('report.outcomes.stoppedVolume')].concat(classHeaders));
  const channelRow = (name, holder) => {
    const f = ceraOutcomeFacts(holder);
    return [sanitizeCellText_(name), reportNum_(holder && holder.count), formatBytes(reportNum_(holder && holder.bytes)), f.left.count, formatBytes(f.left.bytes),
      f.stopped.count, formatBytes(f.stopped.bytes)].concat(classCounts(f.outcomes));
  };
  const vectors = state.vectors || {};
  const channelRows = ['personal', 'shadowAi', 'unmanaged', 'messaging'].map(k => channelRow(T('deck.vector.' + k), (vectors[k] && vectors[k].egress) || {}));
  channelRows.push(channelRow(T('report.outcomes.total'), state.egress || {}));
  table(row + 2, channelRows, [3, 5, 7].concat(CERA_OUTCOME_COLUMNS.map((c, i) => 9 + i)));
  sheet.getRange(row + 2 + channelRows.length - 1, 2, 1, width).setFontWeight('bold');

  // 2. Destinations: the ten with the most outbound transfers stopped (then the most transfers)
  row += 2 + channelRows.length + 1;
  section(row, T('report.outcomes.destTitle'));
  header(row + 1, [T('report.outcomes.channel'), T('report.outcomes.destination'), T('report.outcomes.transfers'), T('report.outcomes.left'), T('report.outcomes.stopped')]
    .concat(classHeaders));
  const dests = [];
  ['personal', 'shadowAi', 'unmanaged', 'messaging'].forEach(k => {
    const domains = (vectors[k] && vectors[k].domains) || {};
    Object.keys(domains).forEach(d => {
      const e = domains[d] || {};
      if (!e.egressOutcomes || !validOuName_(d)) return;
      const count = reportNum_(e.egressCount);
      const left = reportNum_(e.egressLeftCount);
      dests.push({ row: [sanitizeCellText_(T('deck.vector.' + k)), sanitizeCellText_(ceraDestinationLabel(d, lang)), count, left, count - left].concat(classCounts(e.egressOutcomes)),
        stopped: count - left, count: count, name: d });
    });
  });
  dests.sort((a, b) => b.stopped - a.stopped || b.count - a.count || (a.name < b.name ? -1 : 1));
  const destRows = dests.slice(0, 10).map(x => x.row);
  if (destRows.length) table(row + 2, destRows, [4, 5, 6].concat(CERA_OUTCOME_COLUMNS.map((c, i) => 7 + i)));
  else sheet.getRange(row + 2, 2, 1, width).merge().setValue(T('report.outcomes.destNone')).setFontSize(8).setFontColor('#64748B');

  // 3. Other user actions by outcome: prints, sensitive prints, clipboard copies, data shown on pages
  row += 2 + Math.max(1, destRows.length) + 1;
  section(row, T('report.outcomes.otherTitle'));
  header(row + 1, [T('report.outcomes.item'), T('report.outcomes.actions'), T('report.outcomes.stopped')].concat(classHeaders));
  const itemRow = (key, holder, count) => {
    const f = ceraOutcomeFacts(holder);
    return [T(key), reportNum_(count), f.stopped.count].concat(classCounts(f.outcomes));
  };
  const ps = state.printStats || {};
  const otherRows = [
    itemRow('report.outcomes.prints', ps, ps.totalEvents),
    itemRow('report.outcomes.printsSensitive', ps.sensitivity || {}, ps.sensitivity && ps.sensitivity.sensitiveCount),
    itemRow('report.outcomes.copies', state.copies || {}, state.copies && state.copies.count),
    itemRow('report.outcomes.onPage', state.sensitiveOnPage || {}, state.sensitiveOnPage && state.sensitiveOnPage.count)
  ];
  table(row + 2, otherRows, [3, 4].concat(CERA_OUTCOME_COLUMNS.map((c, i) => 5 + i)));

  // 4. Security signals per event (a warning and the bypass logged after it are one event)
  row += 2 + otherRows.length + 1;
  section(row, T('report.outcomes.signalsTitle'));
  header(row + 1, [T('report.outcomes.signal'), T('report.outcomes.events'), T('report.outcomes.shown'), T('report.outcomes.class.bypassed'),
    T('report.outcomes.class.blocked'), T('report.outcomes.class.cancelled'), T('report.outcomes.class.detected'), T('report.outcomes.class.other'), T('report.outcomes.class.notReported')]);
  const sig = (vectors.securityRadar && vectors.securityRadar.signals) || {};
  const signalRow = (key, s) => {
    s = s || {};
    const r = s.results || {};
    if (s.warned === undefined) {
      // Password reuse: by the results of its events
      const known = ['WARNED', 'BYPASSED', 'BLOCKED', 'CANCELLED_BY_USER', 'ALLOWED', 'DETECTED', 'REPORTED', 'NOT_REPORTED'];
      const other = Object.keys(r).filter(k => known.indexOf(k) === -1).reduce((t, k) => t + reportNum_(r[k]), 0);
      return [T(key), reportNum_(s.total), reportNum_(r.WARNED) + reportNum_(r.BYPASSED), reportNum_(r.BYPASSED), reportNum_(r.BLOCKED), reportNum_(r.CANCELLED_BY_USER),
        reportNum_(r.ALLOWED) + reportNum_(r.DETECTED) + reportNum_(r.REPORTED), other, reportNum_(r.NOT_REPORTED)];
    }
    return [T(key), reportNum_(s.total), reportNum_(s.warned) + reportNum_(s.bypassed), reportNum_(s.bypassed), reportNum_(s.blocked), reportNum_(s.cancelled),
      reportNum_(s.detected), reportNum_(s.other), reportNum_(s.unreported)];
  };
  const signalRows = [signalRow('report.outcomes.safeBrowsing', sig.unsafeSiteVisit), signalRow('report.outcomes.downloads', sig.malwareTransfer),
    signalRow('report.outcomes.passwordReuse', sig.passwordReuse)];
  table(row + 2, signalRows, [3, 4, 5, 6, 7, 8, 9, 10]);

  // 5. How outcomes are counted, and the results of no known class
  row += 2 + signalRows.length + 1;
  const other = (state.outcomes && state.outcomes.other) || {};
  const otherList = Object.keys(other).sort().map(k => `${k} (${ceraFormatNumber(reportNum_(other[k]), lang)})`).join(', ');
  sheet.getRange(row, 2, 5, width).merge()
    .setValue(T('report.outcomes.disclosure') + (otherList ? '\n' + T('report.outcomes.otherValues', { list: otherList }) : ''))
    .setBackground('#F8FAFC').setFontColor('#334155').setFontSize(8).setWrap(true).setVerticalAlignment('top')
    .setBorder(true, true, true, true, false, false, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);

  sheet.setColumnWidth(2, 150);
  sheet.setColumnWidth(3, 170);
  for (let c = 4; c <= width + 1; c++) sheet.setColumnWidth(c, 88);
}

/**
 * Renders dedicated breakdown tab for an individual threat vector with:
 * - Header Banner & Executive KPI Metrics
 * - Dual Native Google Sheets Charts (Directional Timeline Combo & File Format Bar Chart)
 * - Daily Outlier Timeline Telemetry Table (Upload / Download GB & Events; print jobs are in no vector)
 * - Top 10 User Actors Breakdown Matrix (with OU attribution and directional action split)
 * - Top 3 Temporal Velocity Spikes (Outlier Surges)
 * - Forensic Deep Dive Tables (File Formats, OUs, Domains, URL Categories)
 */
function renderVectorSheetWithCharts(ss, v, stateOrDomains) {
  const unspecifiedTabDomains = (stateOrDomains && stateOrDomains.unspecifiedTabDomains) ? stateOrDomains.unspecifiedTabDomains : stateOrDomains;
  const lang = ceraNormalizeLang_((stateOrDomains && stateOrDomains.reportLang) || 'en');
  const T = (key, params) => ceraT(key, params, lang);
  const sheet = reportSheet_(ss, v.key, lang);

  resetGeneratedSheet_(sheet);
  sheet.setHiddenGridlines(true);

  const vName = reportVectorName_(v.key, lang);
  const actions = v.actions || {};
  const actionCount = k => reportNum_(actions[k] && actions[k].count);
  const totalBytes = v.totalBytes || 0;
  const totalEvents = v.totalEvents || 0;
  const userCount = Object.keys(v.users || {}).length;

  // 1. Compute deep timeline & actor outlier analytics, its dates and labels in the report language
  const vectorAnalytics = (typeof computeVectorTimelineAnalytics === 'function')
    ? computeVectorTimelineAnalytics(v.timeline, v.actors, lang)
    : { timelineSeries: [], outlierTimelineSeries: [], topSpikes: [], top10Actors: [], top5ActorTimelines: [], avgDailyBytes: 0, avgDailyEvents: 0 };

  const topSpikes = vectorAnalytics.topSpikes || [];
  const top10Actors = vectorAnalytics.top10Actors || [];
  // Use ±7-day outlier context window for the outlier timeline chart
  const timelineSeries = (vectorAnalytics.outlierTimelineSeries && vectorAnalytics.outlierTimelineSeries.length > 0)
    ? vectorAnalytics.outlierTimelineSeries
    : (vectorAnalytics.timelineSeries || []);

  // 2. Header Banner (Row 2)
  sheet.getRange('B2:T2').merge()
    .setValue(T('report.vec.banner', { name: vName.toUpperCase() }))
    .setBackground(v.color || '#1E293B').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(12).setHorizontalAlignment('left');

  // 3. KPI Cards (Rows 4-5)
  // Card 1: Vector Payload
  sheet.getRange('B4:C4').merge().setValue(T('report.vec.kpiVolume')).setFontColor('#64748B').setFontSize(9).setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange('B5:C5').merge().setValue(formatBytes(totalBytes)).setFontColor('#0F172A').setFontSize(15).setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange('B4:C5').setBackground('#F8FAFC').setBorder(true, true, true, true, false, false, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);

  // Card 2: Logged Events
  sheet.getRange('D4:E4').merge().setValue(T('report.vec.kpiEvents')).setFontColor('#64748B').setFontSize(9).setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange('D5:E5').merge().setValue(totalEvents).setNumberFormat('#,##0').setFontColor('#0F172A').setFontSize(15).setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange('D4:E5').setBackground('#F8FAFC').setBorder(true, true, true, true, false, false, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);

  // Card 3: Unique Actors
  sheet.getRange('F4:G4').merge().setValue(T('report.vec.kpiPeople')).setFontColor('#64748B').setFontSize(9).setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange('F5:G5').merge().setValue(userCount).setNumberFormat('#,##0').setFontColor('#0F172A').setFontSize(15).setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange('F4:G5').setBackground('#F8FAFC').setBorder(true, true, true, true, false, false, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);

  // Card 4: busiest outbound day of the vector, under the deck's peak rule (ceraVectorPeak): the deck's vector slides
  // quote the same day with the same multiple. Downloads are not part of it.
  sheet.getRange('H4:I4').merge().setValue(ceraT('report.vector.peakTitle', null, lang)).setFontColor('#64748B').setFontSize(9).setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange('H5:I5').merge().setValue(reportPeakText_({ egressPeak: ceraVectorPeak(v) }, lang)).setFontColor('#EA580C').setFontSize(10).setFontWeight('bold').setWrap(true).setHorizontalAlignment('center');
  sheet.getRange('H4:I5').setBackground('#F8FAFC').setBorder(true, true, true, true, false, false, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);

  // Card 5: Narrative Profile & DLP Summary
  const topOU = (typeof subMapToStackedArray === 'function') ? subMapToStackedArray(v.ous || {}, 1) : [];
  const topDomain = (typeof mapToSortedArray === 'function') ? mapToSortedArray(v.domains || {}, 1) : [];
  const topOUName = topOU.length ? topOU[0].name : T('deck.notRecorded');
  const topDomainName = topDomain.length ? topDomain[0].name : T('deck.notRecorded');

  const sensInfo = (typeof formatSensitivityInfo === 'function') ? formatSensitivityInfo(v.sensitivity) : { sensPct: '0.0%' };
  // Detectors named as on the deck (ceraDetectorListText), over all the vector's transfers like the share before them
  const detList = ceraDetectorListText(ceraSensitivityDetectorNames(v.sensitivity, v.detectorNames), true, lang);
  const sensitiveCount = reportNum_(v.sensitivity && v.sensitivity.sensitiveCount);
  const dlpNote = sensitiveCount > 0
    ? ' ' + T('report.vec.sensitivity', { pct: sensInfo.sensPct, n: sensitiveCount, detectors: detList ? ' [' + detList + ']' : '' })
    : '';

  // What left and what was stopped of the vector's outbound transfers, when the logs show policies enforcing
  const vecOut = ceraOutcomeFacts(v.egress);
  const outcomeNote = ceraOutcomeMode(stateOrDomains) === 'enforced' && reportNum_(v.egress && v.egress.count) > 0
    ? ' ' + ceraT('report.vector.outcomes', { left: formatBytes(vecOut.left.bytes), stopped: formatBytes(vecOut.stopped.bytes), list: ceraOutcomeListText(vecOut.outcomes, null, lang) }, lang)
    : '';
  // The vector's actions by type: file uploads, pastes into a page and prints as the deck names them, then downloads
  const splitParts = ceraActionMix(v, stateOrDomains).map(x => ceraT(x.key, { n: x.n }, lang));
  if (actionCount('download') > 0) splitParts.push(ceraT('deck.act.download', { n: actionCount('download') }, lang));
  const actionSplit = splitParts.length ? ' ' + ceraT('report.vector.actionSplit', { list: ceraJoinList(splitParts, lang) }, lang) : '';
  const vectorSummary = T('report.vec.profile', { n: totalEvents, amount: formatBytes(totalBytes), people: T('report.vec.actors', { n: userCount }), ou: topOUName, dest: topDomainName }) +
    dlpNote + actionSplit + outcomeNote;

  sheet.getRange('K4:T5').merge()
    .setValue(vectorSummary)
    .setBackground('#F8FAFC').setFontColor('#1E293B').setFontSize(9).setWrap(true).setVerticalAlignment('middle')
    .setBorder(true, true, true, true, false, false, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);

  // Subtitle / Privacy Note (Row 6)
  sheet.getRange('B6:T6').merge()
    .setValue(T('report.vec.sub'))
    .setFontStyle('italic').setFontColor('#64748B').setFontSize(9);

  // 4. Rows 8-22: Visual Chart Area (Combo Chart on Left, Bar Chart on Right)
  // Data tables start at row 24 to back the charts
  const timelineHeaderRow = 24;
  sheet.getRange(timelineHeaderRow, 2, 1, 7).merge()
    .setValue(T('report.vec.timelineTitle'))
    .setBackground('#0F172A').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(10).setHorizontalAlignment('left');

  // Chart 2 Data Header (Cols L to O)
  sheet.getRange(timelineHeaderRow, 12, 1, 4).merge()
    .setValue(T('report.vec.formatsTitle'))
    .setBackground('#0F172A').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(10).setHorizontalAlignment('left');

  // Column Headers for Timeline Table (Row 25)
  // Columns B to E are specifically ordered to feed the COMBO chart: Date, Upload GB, Download GB, Total Events. A
  // print job is in no vector (it sends nothing to the site of the page), so the vector has no print columns.
  const timelineColHeaders = ['date', 'uploadGb', 'downloadGb', 'totalEvents', 'totalGb', 'uploadEvents', 'downloadEvents']
    .map(c => T('report.col.' + c));
  sheet.getRange(timelineHeaderRow + 1, 2, 1, timelineColHeaders.length).setValues([timelineColHeaders])
    .setBackground('#F1F5F9').setFontColor('#334155').setFontWeight('bold').setFontSize(8).setHorizontalAlignment('center');

  // Column Headers for MIME Table (Row 25, Cols L to O)
  sheet.getRange(timelineHeaderRow + 1, 12, 1, 4).setValues([['rank', 'format', 'volumeGb', 'events'].map(c => T('report.col.' + c))])
    .setBackground('#F1F5F9').setFontColor('#334155').setFontWeight('bold').setFontSize(8).setHorizontalAlignment('center');

  // Populate Timeline Data Rows
  const timelineRows = [];
  timelineSeries.forEach(item => {
    timelineRows.push([
      item.displayDate || item.date,
      item.uploadGb,
      item.downloadGb,
      item.totalEvents,
      item.totalGb,
      item.uploadCount,
      item.downloadCount
    ]);
  });

  const timelineRowCount = Math.max(1, timelineRows.length);
  if (timelineRows.length > 0) {
    sheet.getRange(timelineHeaderRow + 2, 2, timelineRows.length, timelineColHeaders.length).setValues(timelineRows).setFontSize(8);
    sheet.getRange(timelineHeaderRow + 2, 3, timelineRows.length, 2).setNumberFormat('#,##0.00'); // Upload, Download GB
    sheet.getRange(timelineHeaderRow + 2, 5, timelineRows.length, 1).setNumberFormat('#,##0');    // Total Events
    sheet.getRange(timelineHeaderRow + 2, 6, timelineRows.length, 1).setNumberFormat('#,##0.00'); // Total GB
    sheet.getRange(timelineHeaderRow + 2, 7, timelineRows.length, 2).setNumberFormat('#,##0');    // Action Counts
    sheet.getRange(timelineHeaderRow + 2, 2, timelineRows.length, timelineColHeaders.length).setBorder(true, true, true, true, true, true, '#E2E8F0', SpreadsheetApp.BorderStyle.SOLID);
  } else {
    sheet.getRange(timelineHeaderRow + 2, 2, 1, timelineColHeaders.length).setValues([[T('report.status.noTimeline'), 0, 0, 0, 0, 0, 0]]).setFontSize(8);
  }

  // Populate Top MIME Types Data Rows (Cols L to O), each format by its name in the report language
  const topMimeTypes = (typeof subMapToStackedArray === 'function') ? subMapToStackedArray(v.types || {}, 5) : [];
  const mimeRows = [];
  for (let m = 0; m < 5; m++) {
    if (m < topMimeTypes.length) {
      mimeRows.push([m + 1, sanitizeCellText_(ceraMimeLabel(topMimeTypes[m].name, lang)), topMimeTypes[m].volumeGb, topMimeTypes[m].count]);
    } else {
      mimeRows.push([m + 1, '-', 0, 0]);
    }
  }
  const mimeRowCount = 5;
  sheet.getRange(timelineHeaderRow + 2, 12, mimeRowCount, 4).setValues(mimeRows).setFontSize(8);
  sheet.getRange(timelineHeaderRow + 2, 14, mimeRowCount, 1).setNumberFormat('#,##0.00'); // Volume GB
  sheet.getRange(timelineHeaderRow + 2, 15, mimeRowCount, 1).setNumberFormat('#,##0');    // Events
  sheet.getRange(timelineHeaderRow + 2, 12, mimeRowCount, 4).setBorder(true, true, true, true, true, true, '#E2E8F0', SpreadsheetApp.BorderStyle.SOLID);

  // 5. Build Native Google Sheets Charts (Rows 8 to 22)
  if (typeof NativeSheetsChartEngine !== 'undefined') {
    // Left Chart: Combo Chart (Stacked Directional Volume Bars + Events Velocity Line)
    // Range includes row 25 headers (Date, Upload, Download, Total Events) + data rows
    const comboRange = sheet.getRange(timelineHeaderRow + 1, 2, timelineRowCount + 1, 4);
    NativeSheetsChartEngine.buildTimelineComboChart(sheet, comboRange, 8, 2, 600, 280, T('report.vec.chartTimeline', { name: vName.toUpperCase() }), lang);

    // Right Chart: Top File Formats Bar Chart (Cols M & N: File Format, Volume GB). Only the real rows are
    // plotted, never the '-' / 0 padding of the table; with no file format there is nothing to chart.
    if (topMimeTypes.length > 0) {
      const mimeChartRange = sheet.getRange(timelineHeaderRow + 1, 13, topMimeTypes.length + 1, 2);
      NativeSheetsChartEngine.buildMimeDistributionChart(sheet, mimeChartRange, 8, 12, 460, 280, T('report.vec.chartFormats', { name: vName.toUpperCase() }), v.color, lang);
    }
  }

  // 6. Section 2: User Actors Matrix (Left) & Top 3 Velocity Spikes (Right)
  // Dynamic placement below the timeline data rows
  let nextRow = timelineHeaderRow + 2 + Math.max(timelineRowCount, mimeRowCount) + 2;

  // Left Section Header: TOP 10 USER ACTORS
  sheet.getRange(nextRow, 2, 1, 8).merge()
    .setValue(T('report.vec.actorsTitle'))
    .setBackground('#0F172A').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(10).setHorizontalAlignment('left');

  // Right Section Header: TOP 3 VELOCITY SPIKES
  sheet.getRange(nextRow, 12, 1, 9).merge()
    .setValue(ceraT('report.vector.spikesTitle', null, lang))
    .setBackground('#0F172A').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(10).setHorizontalAlignment('left');

  // Subheaders
  sheet.getRange(nextRow + 1, 2, 1, 8).merge()
    .setValue(T('report.vec.actorsSub'))
    .setFontStyle('italic').setFontColor('#64748B').setFontSize(8);

  sheet.getRange(nextRow + 1, 12, 1, 9).merge()
    .setValue(ceraT('report.vector.spikesSub', null, lang))
    .setFontStyle('italic').setFontColor('#64748B').setFontSize(8);

  // Table Headers
  const actorHeaders = ['rank', 'user', 'ou', 'uploadGb', 'downloadGb', 'totalGb', 'uploadEvents', 'totalEvents'].map(c => T('report.col.' + c));
  sheet.getRange(nextRow + 2, 2, 1, actorHeaders.length).setValues([actorHeaders])
    .setBackground('#F1F5F9').setFontColor('#334155').setFontWeight('bold').setFontSize(8).setHorizontalAlignment('center');

  const spikeHeaders = ['rank', 'spikeDate', 'volumeGb', 'events', 'multiple', 'dominantAction', 'directionSplit'].map(c => T('report.col.' + c));
  sheet.getRange(nextRow + 2, 12, 1, spikeHeaders.length).setValues([spikeHeaders])
    .setBackground('#F1F5F9').setFontColor('#334155').setFontWeight('bold').setFontSize(8).setHorizontalAlignment('center');

  // Populate Top 10 Actors Rows
  const actorRows = [];
  for (let a = 0; a < 10; a++) {
    if (a < top10Actors.length) {
      const act = top10Actors[a];
      actorRows.push([
        act.rank,
        sanitizeCellText_(act.user),
        sanitizeCellText_(act.ou),
        act.uploadGb,
        act.downloadGb,
        act.totalGb,
        act.uploadCount,
        act.totalEvents
      ]);
    } else {
      actorRows.push([a + 1, '-', '-', 0, 0, 0, 0, 0]);
    }
  }
  sheet.getRange(nextRow + 3, 2, 10, actorHeaders.length).setValues(actorRows).setFontSize(8);
  sheet.getRange(nextRow + 3, 5, 10, 3).setNumberFormat('#,##0.00'); // Upload, Download, Total GB
  sheet.getRange(nextRow + 3, 8, 10, 2).setNumberFormat('#,##0');    // Upload, Total Events
  sheet.getRange(nextRow + 3, 2, 10, actorHeaders.length).setBorder(true, true, true, true, true, true, '#E2E8F0', SpreadsheetApp.BorderStyle.SOLID);

  // Populate Top 3 Spikes Rows
  const spikeRows = [];
  for (let s = 0; s < 3; s++) {
    if (s < topSpikes.length) {
      const sp = topSpikes[s];
      spikeRows.push([
        s + 1,
        sp.date,
        sp.totalGb,
        sp.totalEvents,
        `${reportNum_(sp.burstMultiple || 1).toFixed(1)}x`,
        sanitizeCellText_(sp.dominantDirection),
        `${reportGbText_(sp.uploadGb)} / ${reportGbText_(sp.downloadGb)}`
      ]);
    } else {
      spikeRows.push([s + 1, '-', 0, 0, '1.0x', '-', '-']);
    }
  }
  sheet.getRange(nextRow + 3, 12, 3, spikeHeaders.length).setValues(spikeRows).setFontSize(8);
  sheet.getRange(nextRow + 3, 14, 3, 1).setNumberFormat('#,##0.00'); // Volume GB
  sheet.getRange(nextRow + 3, 15, 3, 1).setNumberFormat('#,##0');    // Events
  sheet.getRange(nextRow + 3, 12, 3, spikeHeaders.length).setBorder(true, true, true, true, true, true, '#E2E8F0', SpreadsheetApp.BorderStyle.SOLID);

  // 7. Section 3: Detailed Action Forensic Drilldowns (Uploads, Downloads; print jobs are in no vector)
  let drilldownRow = nextRow + 15;
  drilldownRow = writeActionSectionFromAgg(sheet, ceraT('report.vector.uploads', null, lang), actions.upload, drilldownRow, '#DC2626', unspecifiedTabDomains, lang);
  drilldownRow = writeActionSectionFromAgg(sheet, ceraT('report.vector.downloads', null, lang), actions.download, drilldownRow, '#059669', unspecifiedTabDomains, lang);

  // 8. Section 4: Top 5 Actors Daily Timeline Breakdown (Upload / Download)
  drilldownRow = renderTop5ActorsTimelineSection(sheet, v, vectorAnalytics, drilldownRow + 2, lang);

  // Proportional Column Widths. Every column from B to T holds table data
  // (L-O: MIME / spike tables; L-O, Q-T: drilldown blocks), so none are spacers.
  sheet.setColumnWidth(2, 60);   // B: Rank / Date
  sheet.setColumnWidth(3, 180);  // C: Entity / User / Upload GB
  sheet.setColumnWidth(4, 170);  // D: OU / Download GB
  sheet.setColumnWidth(5, 95);   // E: Upload GB / Total Events
  sheet.setColumnWidth(6, 90);   // F: Download GB / Total GB
  sheet.setColumnWidth(7, 80);   // G: Rank / Total GB / Upload Evts
  sheet.setColumnWidth(8, 150);  // H: Entity (OU name) / Upload Evts / Download Evts
  sheet.setColumnWidth(9, 85);   // I: Events / Total Events / Outlier Status
  sheet.setColumnWidth(10, 85);  // J: Vol (GB) of the units block
  sheet.setColumnWidth(11, 165); // K: Behavioral Outlier Status Badge
  sheet.setColumnWidth(12, 60);  // L: Rank (MIME / Spikes / Domains block)
  sheet.setColumnWidth(13, 160); // M: File Format / Spike Date / Entity Name
  sheet.setColumnWidth(14, 90);  // N: Volume / Events / Actor Chart Start (Col 14)
  sheet.setColumnWidth(15, 95);  // O: Events / Volume
  sheet.setColumnWidth(16, 110); // P: Burst Multiple
  sheet.setColumnWidth(17, 85);  // Q: Dominant Action / Rank (URL Categories)
  sheet.setColumnWidth(18, 180); // R: Direction Split / URL Category Name
  sheet.setColumnWidth(19, 90);  // S: Events
  sheet.setColumnWidth(20, 95);  // T: Vol (GB)
}

function writeActionSectionFromAgg(sheet, title, actObj, startRow, sectionColor, unspecifiedTabDomains, lang) {
  actObj = actObj || {};
  const T = (key, params) => ceraT(key, params, lang || 'en');
  const bytes = reportNum_(actObj.bytes);
  const count = reportNum_(actObj.count);

  sheet.getRange(startRow, 2, 1, 19).merge()
    .setValue(T('report.vec.sectionHeader', { title: title, amount: formatBytes(bytes), n: count }))
    .setBackground('#F1F5F9').setFontColor('#0F172A').setFontWeight('bold').setFontSize(11);

  // Formats and the categories CERA names (internal apps, unspecified) in the report language; units, hosts and the
  // categories of the log stay as recorded
  const topTypes = mapToSortedArray(actObj.types, 10).map(t => Object.assign({}, t, { name: ceraMimeLabel(t.name, lang) }));
  const topOUs = mapToSortedArray(actObj.ous, 10);
  const topEndpoints = mapToSortedArray(actObj.domains, 10);
  const unspecLabel = formatUnspecifiedCategoryLabel(unspecifiedTabDomains);
  const topCats = mapToSortedArray(actObj.cats, 10);
  topCats.forEach(cat => {
    if (typeof cat.name === 'string' && (cat.name.toLowerCase() === 'unspecified' || cat.name.toLowerCase() === 'uncategorized')) {
      cat.name = unspecLabel;
    }
    cat.name = ceraCategoryLabel(cat.name, lang);
  });

  writeTableBlock(sheet, startRow + 2, 2, T('report.vec.block.formats'), topTypes, sectionColor, lang);
  writeTableBlock(sheet, startRow + 2, 7, T('report.vec.block.units'), topOUs, sectionColor, lang);
  writeTableBlock(sheet, startRow + 2, 12, T('report.vec.block.domains'), topEndpoints, sectionColor, lang);
  writeTableBlock(sheet, startRow + 2, 17, T('report.vec.block.categories'), topCats, sectionColor, lang);

  return startRow + 16;
}

function writeTableBlock(sheet, row, col, blockTitle, dataList, headerBg, lang) {
  sheet.getRange(row, col, 1, 4).merge()
    .setValue(blockTitle)
    .setBackground(headerBg).setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(9).setHorizontalAlignment('center');

  sheet.getRange(row + 1, col, 1, 4).setValues([['rank', 'entity', 'events', 'volShort'].map(c => ceraT('report.col.' + c, null, lang || 'en'))])
    .setBackground('#F8FAFC').setFontColor('#475569').setFontWeight('bold').setFontSize(8);

  const rows = [];
  for (let i = 0; i < 10; i++) {
    if (i < dataList.length) {
      const volGb = (dataList[i].volumeGb !== undefined) ? dataList[i].volumeGb : ((dataList[i].bytes || 0) / (1024 ** 3));
      rows.push([i + 1, sanitizeCellText_(dataList[i].name), reportNum_(dataList[i].count), reportNum_(volGb)]);
    } else {
      rows.push([i + 1, '-', '', '']);
    }
  }

  const dataRange = sheet.getRange(row + 2, col, 10, 4);
  dataRange.setValues(rows).setFontSize(8);
  sheet.getRange(row + 2, col + 2, 10, 1).setNumberFormat('#,##0');
  sheet.getRange(row + 2, col + 3, 10, 1).setNumberFormat('#,##0.00');
  dataRange.setBorder(true, true, true, true, true, true, '#E2E8F0', SpreadsheetApp.BorderStyle.SOLID);
}

/**
 * Renders dedicated breakdown tab for Threat Vector 5: Security Signals Radar with:
 * - Header Banner (Deep Indigo #4338CA) & Executive KPI Cards
 * - Dual Native Google Sheets Charts:
 *     1. Multi-threat incident combo timeline chart (Unsafe, Password, Malware bars + Warning Bypass line)
 *     2. Horizontal policy enforcement bar chart (Warned, Bypassed, Detected)
 * - Daily Security Incident Timeline Telemetry Table
 * - Policy Enforcement & Warning Override Audit Table
 * - Top 10 Organizational Units by Security Incidents (Left)
 * - Top 10 Password Reuse Destinations (Right)
 * - Top 10 User Actors Incident Exposure Matrix (Left)
 * - Potentially Malicious Files Log (Right)
 */
function renderSecurityRadarSheetWithCharts(ss, radar, state) {
  radar = radar || {};
  const lang = ceraNormalizeLang_((state && state.reportLang) || 'en');
  const T = (key, params) => ceraT(key, params, lang);
  const sheet = reportSheet_(ss, 'securityRadar', lang);

  resetGeneratedSheet_(sheet);
  sheet.setHiddenGridlines(true);

  const totalIncidents = reportNum_(radar.totalIncidents || radar.totalEvents);
  const userCount = Object.keys(radar.users || {}).length;
  const themeColor = radar.color || '#4338CA';

  // 1. Compute specialized analytics, its dates and labels in the report language
  const radarAnalytics = (typeof computeSecurityRadarAnalytics === 'function')
    ? computeSecurityRadarAnalytics(radar, lang)
    : { timelineSeries: [], outlierTimelineSeries: [], topSpikes: [], top10OUs: [], top10Destinations: [], topMalwareFiles: [], top10Actors: [], top5ActorTimelines: [], detailedBreakdown: null, bypassRatePct: '0.0' };

  // Use ±7-day outlier context window for the security incident combo chart
  const timelineSeries = (radarAnalytics.outlierTimelineSeries && radarAnalytics.outlierTimelineSeries.length > 0)
    ? radarAnalytics.outlierTimelineSeries
    : (radarAnalytics.timelineSeries || []);
  const topSpikes = radarAnalytics.topSpikes || [];
  const top10OUs = radarAnalytics.top10OUs || [];
  const top10Destinations = radarAnalytics.top10Destinations || [];
  const topMalwareFiles = radarAnalytics.topMalwareFiles || [];
  const top10Actors = radarAnalytics.top10Actors || [];
  const bypassRatePct = radarAnalytics.bypassRatePct || '0.0';
  // No incident carried an Event Result: show the bypass rate as not reported instead of 0%
  const bypassUnknown = totalIncidents > 0 && radarAnalytics.resultReported === false;
  const bypassRateText = bypassUnknown
    ? ceraT('report.bypassNotReported', null, lang)
    : T('report.radar.bypassRateValue', { pct: bypassRatePct, n: reportNum_(radar.bypassCount) });

  // 2. Header Banner (Row 2)
  sheet.getRange('B2:T2').merge()
    .setValue(ceraT('report.radar.title', null, lang))
    .setBackground(themeColor).setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(12).setHorizontalAlignment('left');

  // 3. KPI Cards (Rows 4-5)
  // Card 1: Total Incidents
  sheet.getRange('B4:C4').merge().setValue(T('report.radar.kpiTotal')).setFontColor('#64748B').setFontSize(9).setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange('B5:C5').merge().setValue(totalIncidents).setNumberFormat('#,##0').setFontColor('#0F172A').setFontSize(15).setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange('B4:C5').setBackground('#F8FAFC').setBorder(true, true, true, true, false, false, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);

  // Card 2: Warning Bypass Rate
  sheet.getRange('D4:E4').merge().setValue(T('report.radar.kpiBypass')).setFontColor('#64748B').setFontSize(9).setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange('D5:E5').merge().setValue(bypassRateText).setFontColor('#DC2626').setFontSize(13).setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange('D4:E5').setBackground('#FEF2F2').setBorder(true, true, true, true, false, false, '#FECACA', SpreadsheetApp.BorderStyle.SOLID);

  // Card 3: Monitored Users
  sheet.getRange('F4:G4').merge().setValue(T('report.radar.kpiPeople')).setFontColor('#64748B').setFontSize(9).setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange('F5:G5').merge().setValue(userCount).setNumberFormat('#,##0').setFontColor('#0F172A').setFontSize(15).setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange('F4:G5').setBackground('#F8FAFC').setBorder(true, true, true, true, false, false, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);

  // Card 4: Peak Burst Surge
  const topSpike = topSpikes.length > 0 ? topSpikes[0] : null;
  const burstText = topSpike ? T('report.radar.peakValue', { multiple: reportNum_(topSpike.burstMultiple || 1).toFixed(1), date: topSpike.date }) : T('report.radar.peakNone');
  sheet.getRange('H4:I4').merge().setValue(T('report.radar.kpiPeak')).setFontColor('#64748B').setFontSize(9).setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange('H5:I5').merge().setValue(burstText).setFontColor('#EA580C').setFontSize(11).setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange('H4:I5').setBackground('#FFFBEB').setBorder(true, true, true, true, false, false, '#FDE68A', SpreadsheetApp.BorderStyle.SOLID);

  // Card 5: Dynamic Executive Radar Summary
  const unsafeHits = (radar.signals && radar.signals.unsafeSiteVisit && radar.signals.unsafeSiteVisit.total) || 0;
  const pwdHits = (radar.signals && radar.signals.passwordReuse && radar.signals.passwordReuse.total) || 0;
  const malHits = (radar.signals && radar.signals.malwareTransfer && radar.signals.malwareTransfer.total) || 0;
  const topOUItem = top10OUs.length > 0 ? top10OUs[0].ou : T('deck.notRecorded');

  const radarSummary = totalIncidents > 0
    ? ceraT('report.radar.summary', {
      n: totalIncidents, people: ceraT('deck.people', { n: userCount }, lang), ou: topOUItem,
      bypass: bypassUnknown ? ceraT('report.radar.bypassUnknown', null, lang) : `${bypassRatePct}% (${ceraFormatNumber(reportNum_(radar.bypassCount), lang)})`,
      unsafe: unsafeHits, pw: pwdHits, mal: malHits
    }, lang)
    : ceraT('report.radar.summaryNone', null, lang);

  sheet.getRange('K4:T5').merge()
    .setValue(radarSummary)
    .setBackground('#F8FAFC').setFontColor('#1E293B').setFontSize(9).setWrap(true).setVerticalAlignment('middle')
    .setBorder(true, true, true, true, false, false, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);

  // Subtitle / Scope Note (Row 6)
  sheet.getRange('B6:T6').merge()
    .setValue(ceraT('report.radar.sub', null, lang))
    .setFontStyle('italic').setFontColor('#64748B').setFontSize(9);

  // 4. Data Tables Starting at Row 24 (Backing Native Charts in Rows 8-22)
  const timelineHeaderRow = 24;

  // Left Section Header (Row 24, Cols B to J)
  sheet.getRange(timelineHeaderRow, 2, 1, 9).merge()
    .setValue(T('report.radar.timelineTitle'))
    .setBackground('#0F172A').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(10).setHorizontalAlignment('left');

  // Right Section Header (Row 24, Cols L to O)
  sheet.getRange(timelineHeaderRow, 12, 1, 4).merge()
    .setValue(T('report.radar.enforcementTitle'))
    .setBackground('#0F172A').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(10).setHorizontalAlignment('left');

  // Left Table Column Headers (Row 25)
  // Columns B to F feed the Combo Chart: Date, Unsafe, Password, Malware, Bypassed
  const timelineColHeaders = ['date', 'unsafeVisits', 'passwordReuse', 'malware', 'bypassedWarnings', 'totalIncidents', 'warned', 'detectedAllowed', 'bypassPct']
    .map(c => T('report.col.' + c));
  sheet.getRange(timelineHeaderRow + 1, 2, 1, timelineColHeaders.length).setValues([timelineColHeaders])
    .setBackground('#F1F5F9').setFontColor('#334155').setFontWeight('bold').setFontSize(8).setHorizontalAlignment('center');

  // Right Table Column Headers (Row 25)
  sheet.getRange(timelineHeaderRow + 1, 12, 1, 4).setValues([['rank', 'enforcementState', 'incidentCount', 'sharePct'].map(c => T('report.col.' + c))])
    .setBackground('#F1F5F9').setFontColor('#334155').setFontWeight('bold').setFontSize(8).setHorizontalAlignment('center');

  // Populate Timeline Rows
  const timelineRows = [];
  timelineSeries.forEach(item => {
    const warned = reportNum_(item.warned);
    const bypassed = reportNum_(item.bypassed);
    const total = reportNum_(item.total);
    const bPct = (warned + bypassed > 0) ? (bypassed / (warned + bypassed)) : 0;
    timelineRows.push([
      item.displayDate || item.date,
      reportNum_(item.unsafe),
      reportNum_(item.password),
      reportNum_(item.malware),
      bypassed,
      total,
      warned,
      // Blocked incidents and incidents without a reported result are neither detected nor allowed
      Math.max(0, total - warned - bypassed - reportNum_(item.blocked) - reportNum_(item.unreported)),
      bPct
    ]);
  });

  const timelineRowCount = Math.max(1, timelineRows.length);
  if (timelineRows.length > 0) {
    sheet.getRange(timelineHeaderRow + 2, 2, timelineRows.length, timelineColHeaders.length).setValues(timelineRows).setFontSize(8);
    sheet.getRange(timelineHeaderRow + 2, 3, timelineRows.length, 7).setNumberFormat('#,##0'); // Counts, C (Unsafe) to I (Detected / Allowed)
    sheet.getRange(timelineHeaderRow + 2, 10, timelineRows.length, 1).setNumberFormat('0.0%'); // Bypass %
    sheet.getRange(timelineHeaderRow + 2, 2, timelineRows.length, timelineColHeaders.length).setBorder(true, true, true, true, true, true, '#E2E8F0', SpreadsheetApp.BorderStyle.SOLID);
  } else {
    sheet.getRange(timelineHeaderRow + 2, 2, 1, timelineColHeaders.length).setValues([[T('report.status.noIncidentData'), 0, 0, 0, 0, 0, 0, 0, 0]]).setFontSize(8);
  }

  // Populate Enforcement Rows (Cols L to O)
  // One row per outcome of the Event Result column, so the shares add up to all incidents
  const totalEnf = Math.max(1, totalIncidents);
  const enfRows = [
    [1, T('report.radar.enf.warned'), radar.warnedCount || 0, (radar.warnedCount || 0) / totalEnf],
    [2, T('report.radar.enf.bypassed'), radar.bypassCount || 0, (radar.bypassCount || 0) / totalEnf],
    [3, ceraT('report.radar.blocked', null, lang), radar.blockedCount || 0, (radar.blockedCount || 0) / totalEnf],
    [4, ceraT('report.radar.cancelled', null, lang), radar.cancelledCount || 0, (radar.cancelledCount || 0) / totalEnf],
    [5, T('report.radar.enf.detected'), radar.detectedCount || 0, (radar.detectedCount || 0) / totalEnf],
    [6, ceraT('report.radar.other', null, lang), radar.otherCount || 0, (radar.otherCount || 0) / totalEnf],
    [7, ceraT('report.radar.unreported', null, lang), radar.unreportedCount || 0, (radar.unreportedCount || 0) / totalEnf]
  ];
  const enfRowCount = enfRows.length;
  sheet.getRange(timelineHeaderRow + 2, 12, enfRowCount, 4).setValues(enfRows).setFontSize(8);
  sheet.getRange(timelineHeaderRow + 2, 14, enfRowCount, 1).setNumberFormat('#,##0');
  sheet.getRange(timelineHeaderRow + 2, 15, enfRowCount, 1).setNumberFormat('0.0%');
  sheet.getRange(timelineHeaderRow + 2, 12, enfRowCount, 4).setBorder(true, true, true, true, true, true, '#E2E8F0', SpreadsheetApp.BorderStyle.SOLID);

  // 5. Build Native Google Sheets Charts (Rows 8 to 22)
  if (typeof NativeSheetsChartEngine !== 'undefined') {
    // Left Chart: Security Incident Combo Chart (Cols B to F: Date, Unsafe, Password, Malware, Bypassed)
    const comboRange = sheet.getRange(timelineHeaderRow + 1, 2, timelineRowCount + 1, 5);
    NativeSheetsChartEngine.buildSecurityIncidentComboChart(sheet, comboRange, 8, 2, 600, 280, T('report.radar.chartTimeline'), lang);

    // Right Chart: Enforcement Distribution Bar Chart (Cols M & N: Enforcement State, Incident Count)
    const enfChartRange = sheet.getRange(timelineHeaderRow + 1, 13, enfRowCount + 1, 2);
    NativeSheetsChartEngine.buildEnforcementBarChart(sheet, enfChartRange, 8, 12, 460, 280, T('report.radar.chartEnforcement'), lang);
  }

  // 6. Section 2: Top 10 Impacted OUs (Left) & Top 10 Credential Destinations (Right)
  let nextRow = timelineHeaderRow + 2 + Math.max(timelineRowCount, enfRowCount) + 2;

  // Headers
  sheet.getRange(nextRow, 2, 1, 9).merge()
    .setValue(T('report.radar.ouTitle'))
    .setBackground('#0F172A').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(10).setHorizontalAlignment('left');

  sheet.getRange(nextRow, 12, 1, 9).merge()
    .setValue(ceraT('report.radar.pwTopTitle', null, lang))
    .setBackground('#0F172A').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(10).setHorizontalAlignment('left');

  sheet.getRange(nextRow + 1, 2, 1, 9).merge()
    .setValue(ceraT('report.radar.ouTopSub', null, lang))
    .setFontStyle('italic').setFontColor('#64748B').setFontSize(8);

  sheet.getRange(nextRow + 1, 12, 1, 9).merge()
    .setValue(ceraT('report.radar.pwTopSub', null, lang))
    .setFontStyle('italic').setFontColor('#64748B').setFontSize(8);

  const ouHeaders = ['rank', 'ou', 'unsafeVisits', 'passwordReuse', 'malware', 'totalIncidents', 'sharePct'].map(c => T('report.col.' + c));
  sheet.getRange(nextRow + 2, 2, 1, ouHeaders.length).setValues([ouHeaders])
    .setBackground('#F1F5F9').setFontColor('#334155').setFontWeight('bold').setFontSize(8).setHorizontalAlignment('center');

  const destHeaders = [T('report.col.rank'), T('report.col.destEndpoint'), ceraT('report.radar.pwType', null, lang), T('report.col.loggedHits'), T('report.col.sharePct')];
  sheet.getRange(nextRow + 2, 12, 1, destHeaders.length).setValues([destHeaders])
    .setBackground('#F1F5F9').setFontColor('#334155').setFontWeight('bold').setFontSize(8).setHorizontalAlignment('center');

  // Populate Top 10 OUs
  const ouRows = [];
  for (let o = 0; o < 10; o++) {
    if (o < top10OUs.length) {
      const ouItem = top10OUs[o];
      ouRows.push([
        ouItem.rank,
        sanitizeCellText_(ouItem.ou),
        reportNum_(ouItem.unsafe),
        reportNum_(ouItem.password),
        reportNum_(ouItem.malware),
        reportNum_(ouItem.incidents),
        totalIncidents > 0 ? (reportNum_(ouItem.incidents) / totalIncidents) : 0
      ]);
    } else {
      ouRows.push([o + 1, '-', 0, 0, 0, 0, 0]);
    }
  }
  sheet.getRange(nextRow + 3, 2, 10, ouHeaders.length).setValues(ouRows).setFontSize(8);
  sheet.getRange(nextRow + 3, 4, 10, 4).setNumberFormat('#,##0'); // Counts
  sheet.getRange(nextRow + 3, 8, 10, 1).setNumberFormat('0.0%');   // Share
  sheet.getRange(nextRow + 3, 2, 10, ouHeaders.length).setBorder(true, true, true, true, true, true, '#E2E8F0', SpreadsheetApp.BorderStyle.SOLID);

  // Populate Top 10 Destinations (password reuse): type of destination and share of the password reuse events
  const corporateDomains = reportCorporateDomains_(state, radar);
  const pwEventsTotal = reportNum_(radar.signals && radar.signals.passwordReuse && radar.signals.passwordReuse.total);
  const destRows = [];
  for (let d = 0; d < 10; d++) {
    if (d < top10Destinations.length) {
      const destItem = top10Destinations[d];
      destRows.push([
        destItem.rank,
        sanitizeCellText_(ceraDestinationLabel(destItem.destination, lang)),
        sanitizeCellText_(reportDestinationKind_(destItem.destination, corporateDomains, lang)),
        reportNum_(destItem.hits),
        pwEventsTotal > 0 ? (reportNum_(destItem.hits) / pwEventsTotal) : 0
      ]);
    } else {
      destRows.push([d + 1, '-', '-', 0, 0]);
    }
  }
  sheet.getRange(nextRow + 3, 12, 10, destHeaders.length).setValues(destRows).setFontSize(8);
  sheet.getRange(nextRow + 3, 15, 10, 1).setNumberFormat('#,##0'); // Hits
  sheet.getRange(nextRow + 3, 16, 10, 1).setNumberFormat('0.0%');   // Share
  sheet.getRange(nextRow + 3, 12, 10, destHeaders.length).setBorder(true, true, true, true, true, true, '#E2E8F0', SpreadsheetApp.BorderStyle.SOLID);

  // 7. Comprehensive Granular Forensic Sections (3A, 3B, 3C, 3D)
  let section3Row = nextRow + 15;
  section3Row = renderSecurityRadarGranularSections(sheet, radar, radarAnalytics, section3Row, lang, state);

  // 8. Browser launches with command-line switches, only when the logs hold the event
  const launchFacts = ceraLaunchFacts(state);
  if (launchFacts) renderBrowserLaunchSection_(sheet, launchFacts, section3Row + 1, lang);

  // Proportional Column Widths. J-P hold the Section 3A endpoint table, L-P the
  // enforcement / destination tables, so J-M carry data and are not spacers.
  sheet.setColumnWidth(2, 60);   // B: Rank / Date
  sheet.setColumnWidth(3, 180);  // C: User / Endpoint / Unsafe
  sheet.setColumnWidth(4, 170);  // D: OU / Password
  sheet.setColumnWidth(5, 95);   // E: Malware
  sheet.setColumnWidth(6, 90);   // F: Total / Bypasses
  sheet.setColumnWidth(7, 85);   // G: Warned Events (was 45)
  sheet.setColumnWidth(8, 90);   // H: Total Incidents (was 180)
  sheet.setColumnWidth(9, 170);  // I: Incident Surge Status Badge (was 85)
  sheet.setColumnWidth(10, 60);  // J: Rank (3A endpoints)
  sheet.setColumnWidth(11, 160); // K: Target Host / IP / Domain (3A)
  sheet.setColumnWidth(12, 120); // L: Rank / Classification (3A)
  sheet.setColumnWidth(13, 160); // M: Enforcement State / Destination Endpoint / Total Visits
  sheet.setColumnWidth(14, 110); // N: Threat Category / Incident Count / Actor Chart Start (Col 14)
  sheet.setColumnWidth(15, 95);  // O: Chart Area
  sheet.setColumnWidth(16, 85);  // P: Chart Area
  sheet.setColumnWidth(17, 85);  // Q: Chart Area
  sheet.setColumnWidth(18, 120); // R: Chart Area
  sheet.setColumnWidth(19, 90);  // S: Chart Area
  sheet.setColumnWidth(20, 95);  // T: Chart Area
}

/**
 * Section 4 of the Security Radar sheet: browser launches with command-line switches (ceraLaunchFacts), on one basis,
 * launches: a summary, the launches per class of switches with their people and devices (a launch can be in several
 * classes; Chrome's own startup switches only, and switches not reported, on rows of their own), the top switches, and
 * the devices and people with the most launches with other switches. People and devices a log does not carry read
 * "not reported", a lower bound "at least N", never zero. Returns the row after the section.
 */
function renderBrowserLaunchSection_(sheet, lf, startRow, lang) {
  const T = (key, params) => ceraT(key, params, lang);
  const countCell = c => (c.exact ? c.n : (c.n > 0 ? T('report.launch.atLeast', { n: c.n }) : T('report.launch.notReportedCell')));
  let row = startRow;

  sheet.getRange(row, 2, 1, 19).merge()
    .setValue(T('report.launch.title'))
    .setBackground('#0F172A').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(10).setHorizontalAlignment('left');
  sheet.getRange(row + 1, 2, 1, 19).merge()
    .setValue(T('report.launch.sub'))
    .setFontStyle('italic').setFontColor('#64748B').setFontSize(8);
  const summaryParams = { launches: lf.launches, events: lf.events, routine: lf.routine, other: lf.nonRoutine, nr: lf.notReported };
  sheet.getRange(row + 2, 2, 1, 19).merge()
    .setValue(T(lf.notReported > 0 ? 'report.launch.summaryNotReported' : 'report.launch.summary', summaryParams))
    .setBackground('#EEF2FF').setFontColor('#312E81').setFontSize(9).setWrap(true).setVerticalAlignment('middle')
    .setBorder(true, true, true, true, false, false, '#C7D2FE', SpreadsheetApp.BorderStyle.SOLID);
  row += 4;

  // Launches per class of switches (left) and the switches with the most launches (right)
  sheet.getRange(row, 3, 1, 5).merge().setValue(T('report.launch.classesTitle'))
    .setBackground('#334155').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(9).setHorizontalAlignment('center');
  sheet.getRange(row, 10, 1, 4).merge().setValue(T('report.launch.switchesTitle'))
    .setBackground('#334155').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(9).setHorizontalAlignment('center');
  const classHeaders = ['class', 'launches', 'people', 'devices', 'what'].map(c => T('report.launch.col.' + c));
  sheet.getRange(row + 1, 3, 1, classHeaders.length).setValues([classHeaders])
    .setBackground('#F1F5F9').setFontColor('#334155').setFontWeight('bold').setFontSize(8).setHorizontalAlignment('center');
  const switchHeaders = [T('report.col.rank'), T('report.launch.col.switch'), T('report.launch.col.class'), T('report.launch.col.launches')];
  sheet.getRange(row + 1, 10, 1, switchHeaders.length).setValues([switchHeaders])
    .setBackground('#F1F5F9').setFontColor('#334155').setFontWeight('bold').setFontSize(8).setHorizontalAlignment('center');

  const classRows = lf.classes.map(c => [T('deck.launch.class.' + c.id), c.launches, countCell(c.people), countCell(c.devices), T('deck.launch.what.' + c.id)]);
  if (lf.routine > 0) classRows.push([T('report.launch.routine'), lf.routine, countCell(lf.routinePeople), countCell(lf.routineDevices), T('report.launch.what.routine')]);
  if (lf.notReported > 0) classRows.push([T('report.launch.notReported'), lf.notReported, countCell(lf.notReportedPeople), countCell(lf.notReportedDevices), T('report.launch.what.notReported')]);
  sheet.getRange(row + 2, 3, classRows.length, classHeaders.length).setValues(classRows).setFontSize(8);
  sheet.getRange(row + 2, 4, classRows.length, 3).setNumberFormat('#,##0');
  sheet.getRange(row + 2, 3, classRows.length, classHeaders.length).setBorder(true, true, true, true, true, true, '#E2E8F0', SpreadsheetApp.BorderStyle.SOLID);

  const classLabel = cls => (cls === 'routine' ? T('report.launch.class.routine') : T('deck.launch.class.' + cls));
  const switchRows = [];
  for (let i = 0; i < 10; i++) {
    const sw = lf.switches[i];
    switchRows.push(sw ? [i + 1, sanitizeCellText_(sw.name), classLabel(sw.cls), sw.launches] : [i + 1, '-', '-', '']);
  }
  sheet.getRange(row + 2, 10, 10, switchHeaders.length).setValues(switchRows).setFontSize(8);
  sheet.getRange(row + 2, 13, 10, 1).setNumberFormat('#,##0');
  sheet.getRange(row + 2, 10, 10, switchHeaders.length).setBorder(true, true, true, true, true, true, '#E2E8F0', SpreadsheetApp.BorderStyle.SOLID);
  row += 2 + Math.max(classRows.length, 10) + 1;

  // The devices (left) and people (right) with the most launches with other switches, then the most launches
  const ranked = (list, count, titleKey, nameKey, col) => {
    sheet.getRange(row, col, 1, 4).merge().setValue(T(titleKey))
      .setBackground('#334155').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(9).setHorizontalAlignment('center');
    sheet.getRange(row + 1, col, 1, 4).setValues([[T('report.col.rank'), T(nameKey), T('report.launch.col.launches'), T('report.launch.col.other')]])
      .setBackground('#F1F5F9').setFontColor('#334155').setFontWeight('bold').setFontSize(8).setHorizontalAlignment('center');
    const rows = [];
    for (let i = 0; i < 10; i++) {
      const e = list[i];
      if (e) rows.push([i + 1, sanitizeCellText_(e.name), e.launches, e.nonRoutine]);
      else if (i === 0 && !count.n) rows.push(['', T('report.launch.notReportedCell'), '', '']);
      else rows.push([i + 1, '-', '', '']);
    }
    sheet.getRange(row + 2, col, 10, 4).setValues(rows).setFontSize(8);
    sheet.getRange(row + 2, col + 2, 10, 2).setNumberFormat('#,##0');
    sheet.getRange(row + 2, col, 10, 4).setBorder(true, true, true, true, true, true, '#E2E8F0', SpreadsheetApp.BorderStyle.SOLID);
  };
  ranked(lf.devicesList, lf.devices, 'report.launch.devicesTitle', 'report.launch.col.device', 2);
  ranked(lf.peopleList, lf.people, 'report.launch.peopleTitle', 'report.launch.col.person', 10);
  return row + 12;
}

/**
 * Renders Section 4 on DLP Threat Vector sheets:
 * Detailed chronological timeline breakdown for the Top 5 Actors,
 * mapping day-by-day Upload and Download volumes, event counts, and personal outlier burst indicators.
 */
function renderTop5ActorsTimelineSection(sheet, v, vectorAnalytics, startRow, lang) {
  let currentRow = startRow;
  const top5 = (vectorAnalytics && vectorAnalytics.top5ActorTimelines) || [];
  if (top5.length === 0) return currentRow;
  const T = (key, params) => ceraT(key, params, lang || 'en');

  // 1. Main Section Header
  sheet.getRange(currentRow, 2, 1, 19).merge()
    .setValue(T('report.vec.top5Title'))
    .setBackground('#0F172A').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(10).setHorizontalAlignment('left');

  sheet.getRange(currentRow + 1, 2, 1, 19).merge()
    .setValue(T('report.vec.top5Sub'))
    .setFontStyle('italic').setFontColor('#64748B').setFontSize(8);

  currentRow += 3;

  const colHeaders = ['date', 'uploadGb', 'downloadGb', 'totalEvents', 'totalGb', 'uploadEvents', 'downloadEvents', 'outlierStatus']
    .map(c => T('report.col.' + c));

  top5.forEach((act, idx) => {
    // Actor Sub-Banner
    const actBurst = reportNum_(act.burstMultiple || 1);
    const subTitle = T('report.vec.actorBanner', {
      rank: act.rank, user: act.user, ou: act.ou, amount: reportGbText_(act.totalGb), n: reportNum_(act.totalEvents),
      date: act.peakDate, multiple: actBurst.toFixed(1), action: act.dominantAction
    });
    sheet.getRange(currentRow, 2, 1, 19).merge()
      .setValue(subTitle)
      .setBackground('#F1F5F9').setFontColor('#1E293B').setFontWeight('bold').setFontSize(9).setHorizontalAlignment('left');

    // Table Headers (Cols 2 to 9)
    sheet.getRange(currentRow + 1, 2, 1, colHeaders.length).setValues([colHeaders])
      .setBackground('#E2E8F0').setFontColor('#334155').setFontWeight('bold').setFontSize(8).setHorizontalAlignment('center');

    const dayRows = [];
    const dailyData = act.dailyRows || [];
    dailyData.forEach(d => {
      const isPeak = (d.displayDate === act.peakDate || d.date === act.peakDate) && actBurst >= 1.5 && d.totalGb > 0;
      const status = isPeak
        ? T('report.vec.statusPeak', { multiple: actBurst.toFixed(1) })
        : (d.totalGb > 0 ? T('report.vec.statusNormal') : T('report.status.noActivity'));

      dayRows.push([
        d.displayDate || d.date,
        d.uploadGb,
        d.downloadGb,
        d.totalEvents,
        d.totalGb,
        d.uploadCount,
        d.downloadCount,
        status
      ]);
    });

    if (dayRows.length > 0) {
      const range = sheet.getRange(currentRow + 2, 2, dayRows.length, colHeaders.length);
      range.setValues(dayRows).setFontSize(8);
      sheet.getRange(currentRow + 2, 3, dayRows.length, 2).setNumberFormat('#,##0.00'); // Upload, Download GB
      sheet.getRange(currentRow + 2, 5, dayRows.length, 1).setNumberFormat('#,##0');    // Total Events
      sheet.getRange(currentRow + 2, 6, dayRows.length, 1).setNumberFormat('#,##0.00'); // Total GB
      sheet.getRange(currentRow + 2, 7, dayRows.length, 2).setNumberFormat('#,##0');    // Action Counts
      range.setBorder(true, true, true, true, true, true, '#E2E8F0', SpreadsheetApp.BorderStyle.SOLID);

      // Render native combo timeline chart for the actor starting at Column N (Col 14)
      if (typeof NativeSheetsChartEngine !== 'undefined') {
        const actorComboRange = sheet.getRange(currentRow + 1, 2, dayRows.length + 1, 4);
        const chartTitle = T('report.vec.actorChart', { rank: act.rank, user: act.user });
        NativeSheetsChartEngine.buildTimelineComboChart(sheet, actorComboRange, currentRow + 1, 14, 560, 270, chartTitle, lang);
      }

      currentRow += Math.max(dayRows.length + 3, 18);
    } else {
      sheet.getRange(currentRow + 2, 2, 1, colHeaders.length).setValues([[T('report.status.noActivityLogs'), 0, 0, 0, 0, 0, 0, '-']]).setFontSize(8);
      currentRow += 4;
    }
  });

  return currentRow;
}

/**
 * Renders Sections 3A, 3B, 3C, and 3D on the Security Radar Tab:
 * - 3A: Unsafe site visits by reason and destination, with bypasses where the log reports a result
 * - 3B: Password reuse by destination (destination type and share of the events)
 * - 3C: Potentially malicious files (reason, source and outcome as logged)
 * - 3D: Top 5 Security Radar Actors Daily Timeline Breakdown (day-by-day incident trajectory per actor)
 */
function renderSecurityRadarGranularSections(sheet, radar, radarAnalytics, startRow, lang, state) {
  let currentRow = startRow;
  const detailed = (radarAnalytics && radarAnalytics.detailedBreakdown) || {};
  const T = (key, params) => ceraT(key, params, lang);
  const corporate = reportCorporateDomains_(state, radar);
  const kindOf = d => reportDestinationKind_(d, corporate, lang);
  const capital = text => String(text).charAt(0).toUpperCase() + String(text).slice(1);
  // Safe Browsing reason codes in the deck's words (certificate errors, phishing, ...)
  const reasonLabel = code => {
    const c = String(code || '').toUpperCase();
    let key = 'other';
    if (c.indexOf('SSL') !== -1) key = 'ssl';
    else if (c.indexOf('SOCIAL_ENGINEERING') !== -1) key = 'phishing';
    else if (c.indexOf('MALWARE') !== -1) key = 'malware';
    else if (c.indexOf('UNWANTED') !== -1) key = 'unwanted';
    else if (c.indexOf('UNSPECIFIED') !== -1 || !c) key = 'unspecified';
    return T('deck.sb.reason.' + key);
  };

  // =========================================================================
  // SECTION 3A: UNSAFE SITE VISITS BY REASON AND DESTINATION
  // =========================================================================
  sheet.getRange(currentRow, 2, 1, 19).merge()
    .setValue(T('report.radar.sec3aTitle'))
    .setBackground('#0F172A').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(10).setHorizontalAlignment('left');

  sheet.getRange(currentRow + 1, 2, 1, 19).merge()
    .setValue(T('report.radar.sec3aSub'))
    .setFontStyle('italic').setFontColor('#64748B').setFontSize(8);

  currentRow += 2;

  // Left Subheader (Cols 2-8): ROOT CAUSES
  sheet.getRange(currentRow, 2, 1, 7).merge()
    .setValue(T('report.radar.reasonsTitle'))
    .setBackground('#334155').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(9).setHorizontalAlignment('center');

  // Right Subheader (Cols 10-20): TOP TARGET ENDPOINTS
  sheet.getRange(currentRow, 10, 1, 11).merge()
    .setValue(T('report.radar.endpointsTitle'))
    .setBackground('#334155').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(9).setHorizontalAlignment('center');

  currentRow += 1;

  // Headers
  const reasonHeaders = ['reasonCode', 'description', 'incidents', 'sharePctShort'].map(c => T('report.col.' + c));
  sheet.getRange(currentRow, 2, 1, 4).setValues([reasonHeaders])
    .setBackground('#F1F5F9').setFontColor('#334155').setFontWeight('bold').setFontSize(8).setHorizontalAlignment('center');

  // Per event, as on the deck: a host's events, the warnings shown there (heeded or bypassed) and the bypassed ones
  const endpointHeaders = [T('report.col.rank'), T('report.col.targetHost'), T('report.col.classification'), T('report.col.totalVisits'), T('report.outcomes.shown'), T('report.col.bypassed'), T('report.col.bypassPct')];
  sheet.getRange(currentRow, 10, 1, endpointHeaders.length).setValues([endpointHeaders])
    .setBackground('#F1F5F9').setFontColor('#334155').setFontWeight('bold').setFontSize(8).setHorizontalAlignment('center');

  currentRow += 1;

  // Populate Left Table: Reasons (Top 5)
  const reasonList = detailed.unsafeReasons || [];
  const reasonRows = [];
  for (let r = 0; r < 5; r++) {
    if (r < reasonList.length) {
      const item = reasonList[r];
      reasonRows.push([sanitizeCellText_(item.reason), sanitizeCellText_(capital(reasonLabel(item.reason))), reportNum_(item.count), reportPctFraction_(item.pct)]);
    } else {
      reasonRows.push(['-', '-', '', '']);
    }
  }
  sheet.getRange(currentRow, 2, 5, 4).setValues(reasonRows).setFontSize(8);
  sheet.getRange(currentRow, 4, 5, 1).setNumberFormat('#,##0');
  sheet.getRange(currentRow, 5, 5, 1).setNumberFormat('0.0%');
  sheet.getRange(currentRow, 2, 5, 4).setBorder(true, true, true, true, true, true, '#E2E8F0', SpreadsheetApp.BorderStyle.SOLID);

  // Populate Right Table: Endpoints (Top 10)
  const endpointList = detailed.unsafeEndpoints || [];
  const endpointRows = [];
  for (let ep = 0; ep < 10; ep++) {
    if (ep < endpointList.length) {
      const item = endpointList[ep];
      // Visits without a reported result leave the warned / bypassed cells blank instead of 0
      const noResult = reportNum_(item.unreported) > 0 && reportNum_(item.unreported) >= reportNum_(item.total);
      endpointRows.push([ep + 1, sanitizeCellText_(ceraDestinationLabel(item.domain, lang)), sanitizeCellText_(kindOf(item.domain)), reportNum_(item.total),
        noResult ? '' : reportNum_(item.warned) + reportNum_(item.bypassed), noResult ? '' : reportNum_(item.bypassed), noResult ? '' : reportPctFraction_(item.bypassRate)]);
    } else {
      endpointRows.push([ep + 1, '-', '-', '', '', '', '']);
    }
  }
  sheet.getRange(currentRow, 10, 10, endpointHeaders.length).setValues(endpointRows).setFontSize(8);
  sheet.getRange(currentRow, 13, 10, 3).setNumberFormat('#,##0');
  sheet.getRange(currentRow, 16, 10, 1).setNumberFormat('0.0%');
  sheet.getRange(currentRow, 10, 10, endpointHeaders.length).setBorder(true, true, true, true, true, true, '#E2E8F0', SpreadsheetApp.BorderStyle.SOLID);

  currentRow += 11;

  // Callout 3A: the most common reason and host, and the bypass rate only when the visits carried an Event Result
  const topReasonItem = (detailed.unsafeReasons && detailed.unsafeReasons.length > 0) ? detailed.unsafeReasons[0] : null;
  const topEndpointItem = (detailed.unsafeEndpoints && detailed.unsafeEndpoints.length > 0) ? detailed.unsafeEndpoints[0] : null;
  const unsafeBypassUnknown = !(reportNum_(detailed.reportedCount) > 0) && reportNum_(detailed.unreportedCount) > 0;
  const unsafeBypassed = reportNum_(detailed.bypassedCount);
  const unsafeHeeded = reportNum_(detailed.warnedCount);
  const calloutParts3A = [];
  if (topReasonItem) {
    calloutParts3A.push(T('deck.sb.reasonTitle', { reason: reasonLabel(topReasonItem.reason), pct: topReasonItem.pct }) + '.');
    if (topEndpointItem) calloutParts3A.push(T('deck.radar.endpoint', { host: ceraDestinationLabel(topEndpointItem.domain, lang), kind: kindOf(topEndpointItem.domain), n: reportNum_(topEndpointItem.total) }));
    if (unsafeBypassUnknown) calloutParts3A.push(T('deck.radar.bypassUnknown'));
    else if (unsafeBypassed + unsafeHeeded > 0) calloutParts3A.push(T('report.radar.bypassed', { n: unsafeBypassed, total: unsafeBypassed + unsafeHeeded, pct: ((unsafeBypassed / (unsafeBypassed + unsafeHeeded)) * 100).toFixed(1) + '%' }));
    else calloutParts3A.push(T('report.radar.bypassedNone'));
  } else {
    calloutParts3A.push(T('report.radar.callout3ANone'));
  }
  const callout3A = calloutParts3A.join(' ');

  sheet.getRange(currentRow, 2, 1, 19).merge()
    .setValue(callout3A)
    .setBackground('#EFF6FF').setFontColor('#1E3A8A').setFontSize(9).setWrap(true).setVerticalAlignment('middle')
    .setBorder(true, true, true, true, false, false, '#BFDBFE', SpreadsheetApp.BorderStyle.SOLID);

  currentRow += 3;

  // =========================================================================
  // SECTION 3B: PASSWORD REUSE BY DESTINATION
  // =========================================================================
  sheet.getRange(currentRow, 2, 1, 19).merge()
    .setValue(T('report.radar.sec3bTitle'))
    .setBackground('#0F172A').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(10).setHorizontalAlignment('left');

  sheet.getRange(currentRow + 1, 2, 1, 19).merge()
    .setValue(T('report.radar.sec3bSub'))
    .setFontStyle('italic').setFontColor('#64748B').setFontSize(8);

  currentRow += 2;

  const pwdHeaders = [T('report.col.rank'), T('report.radar.pwDest'), T('report.radar.pwType'), T('report.outcomes.events'), T('report.radar.share')];
  sheet.getRange(currentRow, 2, 1, pwdHeaders.length).setValues([pwdHeaders])
    .setBackground('#F1F5F9').setFontColor('#334155').setFontWeight('bold').setFontSize(8).setHorizontalAlignment('center');

  currentRow += 1;

  // Destinations of password reuse by what they are (corporate site, external site, browser page, direct IP, ...)
  const pwdList = detailed.passwordDestinations || [];
  const pwTotalAll = pwdList.reduce((acc, it) => acc + reportNum_(it.total), 0);
  const pwdRows = [];
  for (let p = 0; p < 10; p++) {
    if (p < pwdList.length) {
      const item = pwdList[p];
      pwdRows.push([p + 1, sanitizeCellText_(ceraDestinationLabel(item.domain, lang)), sanitizeCellText_(kindOf(item.domain)), reportNum_(item.total),
        pwTotalAll > 0 ? reportNum_(item.total) / pwTotalAll : 0]);
    } else {
      pwdRows.push([p + 1, '-', '-', '', '']);
    }
  }
  sheet.getRange(currentRow, 2, 10, pwdHeaders.length).setValues(pwdRows).setFontSize(8);
  sheet.getRange(currentRow, 5, 10, 1).setNumberFormat('#,##0');
  sheet.getRange(currentRow, 6, 10, 1).setNumberFormat('0.0%');
  sheet.getRange(currentRow, 2, 10, pwdHeaders.length).setBorder(true, true, true, true, true, true, '#E2E8F0', SpreadsheetApp.BorderStyle.SOLID);

  currentRow += 11;

  // Callout 3B: how many events, on how many destinations, and the destination with the most
  const callout3B = pwdList.length
    ? T('deck.sig.pwCount', { n: pwTotalAll }) + ' ' + T('report.radar.callout3B', { hosts: pwdList.length, top: ceraDestinationLabel(pwdList[0].domain, lang), topN: reportNum_(pwdList[0].total) })
    : T('deck.sig.pwNone');

  sheet.getRange(currentRow, 2, 1, 19).merge()
    .setValue(callout3B)
    .setBackground('#FEF3C7').setFontColor('#78350F').setFontSize(9).setWrap(true).setVerticalAlignment('middle')
    .setBorder(true, true, true, true, false, false, '#FDE68A', SpreadsheetApp.BorderStyle.SOLID);

  currentRow += 3;

  // =========================================================================
  // SECTION 3C: POTENTIALLY MALICIOUS FILE TRANSFERS
  // =========================================================================
  sheet.getRange(currentRow, 2, 1, 19).merge()
    .setValue(T('report.radar.sec3cTitle'))
    .setBackground('#0F172A').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(10).setHorizontalAlignment('left');

  sheet.getRange(currentRow + 1, 2, 1, 19).merge()
    .setValue(T('report.radar.sec3cSub'))
    .setFontStyle('italic').setFontColor('#64748B').setFontSize(8);

  currentRow += 2;

  const malHeaders = [T('report.col.rank'), T('report.col.fileName'), T('report.radar.malReason'), T('report.col.source'), T('report.col.attempts'), T('report.col.warned'), T('report.col.bypassedByUser'), T('report.col.enforcementStatus')];
  sheet.getRange(currentRow, 2, 1, malHeaders.length).setValues([malHeaders])
    .setBackground('#F1F5F9').setFontColor('#334155').setFontWeight('bold').setFontSize(8).setHorizontalAlignment('center');

  currentRow += 1;

  const malList = detailed.malwareFiles || [];
  // Without an Event Result for these downloads, warned / bypassed are unknown rather than 0
  const malResultUnknown = detailed.malwareResultReported === false;
  const malFiles = (radar && radar.signals && radar.signals.malwareTransfer && radar.signals.malwareTransfer.files) || {};
  // The reason Chrome logged for a file (MALWARE_TRANSFER_DANGEROUS_FILE_TYPE -> "Dangerous file type"); a code
  // without a catalog entry is shown as logged
  const MAL_CODES = { DANGEROUS: 'dangerous', DANGEROUS_FILE_TYPE: 'fileType', DANGEROUS_HOST: 'host', UNCOMMON: 'uncommon', POTENTIALLY_UNWANTED: 'unwanted', UNKNOWN: 'unknown' };
  const malReason = name => {
    const raw = String((malFiles[name] && malFiles[name].reason) || '').trim();
    const code = raw.toUpperCase().replace(/^MALWARE_TRANSFER_?/, '');
    if (!code) return T('report.radar.malCode.none');
    return MAL_CODES[code] ? T('report.radar.malCode.' + MAL_CODES[code]) : raw;
  };
  // The outcome the log reports: bypassed, blocked or warned, otherwise only detected
  const malOutcome = item => {
    const f = malFiles[item.fileName] || {};
    if (reportNum_(item.bypassed) > 0) return T('report.radar.outcome.bypassed');
    if (reportNum_(f.blocked) > 0) return T('report.radar.outcome.blocked');
    if (reportNum_(item.warned) > 0) return T('report.radar.outcome.warned');
    return T('report.radar.outcome.detected');
  };
  const malRows = [];
  for (let m = 0; m < 10; m++) {
    if (m < malList.length) {
      const item = malList[m];
      const enfStatus = malResultUnknown ? ceraT('report.radar.unreported', null, lang) : malOutcome(item);
      malRows.push([m + 1, sanitizeCellText_(ceraFileLabel(item.fileName, item.domain, lang)), sanitizeCellText_(malReason(item.fileName)), sanitizeCellText_(ceraDestinationLabel(item.domain, lang)), reportNum_(item.total),
        malResultUnknown ? '' : reportNum_(item.warned), malResultUnknown ? '' : reportNum_(item.bypassed), enfStatus]);
    } else {
      malRows.push([m + 1, '-', '-', '-', '', '', '', '-']);
    }
  }
  sheet.getRange(currentRow, 2, 10, malHeaders.length).setValues(malRows).setFontSize(8);
  sheet.getRange(currentRow, 6, 10, 3).setNumberFormat('#,##0');
  sheet.getRange(currentRow, 2, 10, malHeaders.length).setBorder(true, true, true, true, true, true, '#E2E8F0', SpreadsheetApp.BorderStyle.SOLID);

  currentRow += 11;

  // Callout 3C: how many flagged downloads of how many files, the most frequent one, and bypasses when reported
  const topMalItem = (malList.length > 0 && malList[0] && malList[0].total > 0) ? malList[0] : null;
  const malTotalAll = malList.reduce((acc, it) => acc + reportNum_(it.total), 0);
  let callout3C = topMalItem
    ? T('deck.sig.malCount', { n: malTotalAll }) + ' ' + T('report.radar.callout3C', { files: malList.length, top: ceraFileLabel(topMalItem.fileName, topMalItem.domain, lang), topN: reportNum_(topMalItem.total) })
    : T('deck.sig.malNone');
  const malBypassed = malList.reduce((acc, it) => acc + reportNum_(it.bypassed), 0);
  if (topMalItem && !malResultUnknown && malBypassed > 0) callout3C += ' ' + T('report.radar.callout3CBypass', { n: malBypassed });

  sheet.getRange(currentRow, 2, 1, 19).merge()
    .setValue(callout3C)
    .setBackground('#FEF2F2').setFontColor('#991B1B').setFontSize(9).setWrap(true).setVerticalAlignment('middle')
    .setBorder(true, true, true, true, false, false, '#FECACA', SpreadsheetApp.BorderStyle.SOLID);

  currentRow += 3;

  // =========================================================================
  // SECTION 3D: TOP 5 SECURITY RADAR ACTORS TIMELINE BREAKDOWN
  // =========================================================================
  sheet.getRange(currentRow, 2, 1, 19).merge()
    .setValue(T('report.radar.top5Title'))
    .setBackground('#0F172A').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(10).setHorizontalAlignment('left');

  sheet.getRange(currentRow + 1, 2, 1, 19).merge()
    .setValue(T('report.radar.top5Sub'))
    .setFontStyle('italic').setFontColor('#64748B').setFontSize(8);

  currentRow += 3;

  const top5Sec = (radarAnalytics && radarAnalytics.top5ActorTimelines) || [];
  const secColHeaders = ['date', 'unsafeSiteVisits', 'passwordReuse', 'malwareDownloads', 'bypassedWarnings', 'warnedEvents', 'totalIncidents', 'surgeStatus']
    .map(c => T('report.col.' + c));

  top5Sec.forEach((act, idx) => {
    const actBurst = reportNum_(act.burstMultiple || 1);
    const subTitle = T('report.radar.actorBanner', {
      rank: act.rank, user: act.user, ou: act.ou, n: reportNum_(act.totalEvents),
      date: act.peakDate, multiple: actBurst.toFixed(1), signal: act.dominantAction
    });
    sheet.getRange(currentRow, 2, 1, 19).merge()
      .setValue(subTitle)
      .setBackground('#F1F5F9').setFontColor('#1E293B').setFontWeight('bold').setFontSize(9).setHorizontalAlignment('left');

    sheet.getRange(currentRow + 1, 2, 1, secColHeaders.length).setValues([secColHeaders])
      .setBackground('#E2E8F0').setFontColor('#334155').setFontWeight('bold').setFontSize(8).setHorizontalAlignment('center');

    const dayRows = [];
    const dailyData = act.dailyRows || [];
    dailyData.forEach(d => {
      const isPeak = (d.displayDate === act.peakDate || d.date === act.peakDate) && actBurst >= 1.5 && d.total > 0;
      const status = isPeak
        ? T('report.radar.statusPeak', { multiple: actBurst.toFixed(1) })
        : (d.total > 0 ? T('report.radar.statusNormal') : T('report.radar.statusNone'));

      dayRows.push([
        d.displayDate || d.date,
        d.unsafe,
        d.password,
        d.malware,
        d.bypassed,
        d.warned,
        d.total,
        status
      ]);
    });

    if (dayRows.length > 0) {
      const range = sheet.getRange(currentRow + 2, 2, dayRows.length, secColHeaders.length);
      range.setValues(dayRows).setFontSize(8);
      sheet.getRange(currentRow + 2, 3, dayRows.length, 5).setNumberFormat('#,##0');
      range.setBorder(true, true, true, true, true, true, '#E2E8F0', SpreadsheetApp.BorderStyle.SOLID);

      // Render native security incident combo chart for the actor starting at Column N (Col 14)
      if (typeof NativeSheetsChartEngine !== 'undefined') {
        const secActorRange = sheet.getRange(currentRow + 1, 2, dayRows.length + 1, 5);
        const chartTitle = T('report.radar.actorChart', { rank: act.rank, user: act.user });
        NativeSheetsChartEngine.buildSecurityIncidentComboChart(sheet, secActorRange, currentRow + 1, 14, 560, 270, chartTitle, lang);
      }

      currentRow += Math.max(dayRows.length + 3, 18);
    } else {
      sheet.getRange(currentRow + 2, 2, 1, secColHeaders.length).setValues([[T('report.status.noIncidentLogs'), 0, 0, 0, 0, 0, 0, '-']]).setFontSize(8);
      currentRow += 4;
    }
  });

  return currentRow;
}
