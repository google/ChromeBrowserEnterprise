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
 * Module: PreflightEstimator.gs
 * Description: Pre-ingestion check shown before a cloud ingestion starts
 *              - Access check on the Reports API (falls back to manual import)
 *              - Active-week map (one unfiltered query per week)
 *              - Event-volume probe on stratified 15-minute sample windows inside active weeks
 *              - Duration estimate with an up-front warning
 * ==============================================================================
 */

const PREFLIGHT_WINDOW_MIN = 15;
const PREFLIGHT_MAX_PAGES_PER_WINDOW = 5;
const PREFLIGHT_FETCHALL_BATCH = 24;
const PREFLIGHT_TIME_BUDGET_MS = 240000;
const CERA_PREFLIGHT_PLAN_KEY = 'CERA_PREFLIGHT_PLAN';
const CERA_PREFLIGHT_PLAN_TTL_MS = 2 * 3600 * 1000;

// Official quotas (developers.google.com/workspace/admin/reports/v1/limits, apps-script/guides/services/quotas)
const REPORTS_FILTER_QUERIES_PER_MIN = 250;
const TRIGGER_RUNTIME_SEC_PER_DAY = 6 * 3600;
const URLFETCH_CALLS_PER_DAY = 100000;

// Current engine model: one serial page, two 500-row Sheets appends, 120 ms pacing, 42 s of work per 1-minute tick.
// The append cost is an assumption until it is measured on a real tenant.
const LEGACY_SHEET_WRITE_SEC_PER_PAGE = 2.0;
const LEGACY_PACING_SEC_PER_PAGE = 0.12;
const LEGACY_ROWS_PER_PARTITION = 50000;
const LEGACY_TICK_DUTY = 42 / 60;

const REPORTS_CHROME_URL = 'https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/chrome';
const PREFLIGHT_PROBE_FIELDS = 'nextPageToken,items(id(time))';
const PREFLIGHT_TRIMMED_FIELDS = 'nextPageToken,items(id(time,uniqueQualifier),actor(email),events(name,parameters(name,value,intValue,boolValue,multiValue)))';

/**
 * Entry point called from the setup dialog before engageCloudIngestion.
 * Never throws for missing access: it returns recommendManual = true so the dialog can route to manual import.
 */
function runIngestionPreflight(dateRangeDays) {
  const startedMs = Date.now();
  const days = ceraRangeDays_(dateRangeDays);
  const token = ScriptApp.getOAuthToken();
  const result = {
    days: days,
    access: null,
    probe: null,
    estimate: null,
    warnings: [],
    recommendManual: false,
    messageKey: '',
    messageParams: null,
    summaryParams: null
  };

  result.access = _preflightCheckReportsAccess_(token);
  if (!result.access.ok) {
    result.recommendManual = true;
    result.messageKey = result.access.reasonKey;
    result.messageParams = { detail: result.access.detail };
    console.warn('[Preflight] Reports API access unavailable: ' + result.access.detail);
    return result;
  }

  result.activity = _preflightActiveWeeks_(token, days);
  result.probe = _preflightProbe_(token, days, startedMs, result.activity);
  result.estimate = _preflightEstimate_(result.probe, days, result.activity);
  _preflightSavePlan_(result);
  _preflightAddWarnings_(result);
  result.summaryParams = _preflightSummaryParams_(result);
  result.elapsedSec = Math.round((Date.now() - startedMs) / 1000);

  console.log('[Preflight] ' + JSON.stringify({
    days: days,
    activeWeeks: result.activity.weeks.filter(Boolean).length + '/' + result.activity.weeks.length,
    measured: result.estimate.measured,
    totalEvents: result.estimate.totalEvents,
    legacy: result.estimate.legacy,
    rollup: result.estimate.rollup,
    warnings: result.warnings,
    elapsedSec: result.elapsedSec
  }));
  return result;
}

// ==============================================================================
// SECTION 1: HTTP HELPERS
// ==============================================================================

function _preflightRequest_(url, token) {
  return { url: url, method: 'get', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true };
}

function _preflightParse_(response) {
  const code = response.getResponseCode();
  const text = response.getContentText();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (e) {}
  return { code: code, json: json, bytes: text.length };
}

function _preflightGet_(url, token) {
  return _preflightParse_(UrlFetchApp.fetch(url, _preflightRequest_(url, token)));
}

function _preflightErrorText_(res) {
  const err = res && res.json && res.json.error;
  return err ? `HTTP ${res.code}: ${err.message || err.status || ''}`.trim() : `HTTP ${res ? res.code : '?'}`;
}

function _preflightQuery_(params) {
  return Object.keys(params)
    .filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');
}

function _preflightReportsUrl_(params) {
  return REPORTS_CHROME_URL + '?' + _preflightQuery_(params);
}

// ==============================================================================
// SECTION 2: ACCESS
// ==============================================================================

function _preflightCheckReportsAccess_(token) {
  try {
    const res = _preflightGet_(_preflightReportsUrl_({ maxResults: 1, fields: 'items(id(time))' }), token);
    if (res.code === 200) return { ok: true };
    if (res.code === 401 || res.code === 403) {
      return { ok: false, code: res.code, reasonKey: 'pf.access.denied', detail: _preflightErrorText_(res) };
    }
    return { ok: false, code: res.code, reasonKey: 'pf.access.failed', detail: _preflightErrorText_(res) };
  } catch (e) {
    return { ok: false, code: 0, reasonKey: 'pf.access.failed', detail: e.message };
  }
}

// ==============================================================================
// SECTION 3: EVENT-VOLUME PROBE
// ==============================================================================

/**
 * Stratified sample windows spread over the range, in the script time zone: 3 on weekday business
 * hours (10:00), 3 on weekday off-hours (22:00) and 2 on weekends (14:00). Each stratum always gets
 * windows when the range contains such days, so a weekday-only sample cannot stand in for weekends.
 */
/**
 * Which 7-day weeks of the range have any Chrome activity, using one unfiltered query per week
 * (maxResults 1; unfiltered queries do not count toward the 250 filter queries per minute).
 * Weeks start at the beginning of the range, the same alignment ingestion uses to skip quiet weeks,
 * so the estimate covers exactly the days ingestion will scan. A failed check counts as active.
 */
function _preflightActiveWeeks_(token, days) {
  const DAY_MS = 86400000;
  const endMs = Date.now();
  const startMs = endMs - days * DAY_MS;
  const bounds = [];
  for (let ws = startMs; ws < endMs; ws += 7 * DAY_MS) bounds.push([ws, Math.min(endMs, ws + 7 * DAY_MS)]);
  let weeks = bounds.map(() => true);
  try {
    const responses = UrlFetchApp.fetchAll(bounds.map(b => _preflightRequest_(_preflightReportsUrl_({
      startTime: new Date(b[0]).toISOString(),
      endTime: new Date(b[1]).toISOString(),
      maxResults: 1,
      fields: PREFLIGHT_PROBE_FIELDS
    }), token)));
    weeks = responses.map(resp => {
      const res = _preflightParse_(resp);
      return res.code !== 200 || !!(res.json && res.json.items && res.json.items.length);
    });
  } catch (e) {
    console.warn('[Preflight] Active-week check failed, assuming every week is active: ' + e.message);
  }

  const tz = ceraTimeZone();
  const activity = { startMs: startMs, endMs: endMs, weeks: weeks, activeDays: 0, weekdays: 0, weekendDays: 0, firstActiveMs: 0 };
  for (let ds = startMs; ds < endMs; ds += DAY_MS) {
    if (!_preflightIsActiveMs_(activity, ds)) continue;
    const share = Math.min(1, (endMs - ds) / DAY_MS);
    if (!activity.firstActiveMs) activity.firstActiveMs = ds;
    activity.activeDays += share;
    if (ceraIsWeekendMs_(ds + DAY_MS / 2, tz)) activity.weekendDays += share;
    else activity.weekdays += share;
  }
  return activity;
}

function _preflightIsActiveMs_(activity, ms) {
  const idx = Math.floor((ms - activity.startMs) / (7 * 86400000));
  return idx >= 0 && idx < activity.weeks.length && !!activity.weeks[idx];
}

function _preflightWindows_(days, activity) {
  const tz = ceraTimeZone();
  const weekdays = [];
  const weekends = [];
  for (let back = 1; back <= days; back++) {
    const day = new Date(Date.now() - back * 86400000);
    if (activity && !_preflightIsActiveMs_(activity, day.getTime())) continue;
    const isoDow = Number(Utilities.formatDate(day, tz, 'u')); // 1 = Monday ... 7 = Sunday
    (isoDow >= 6 ? weekends : weekdays).push(day);
  }
  const spread = (list, n) => {
    if (!list.length) return [];
    const picks = [];
    for (let k = 0; k < n; k++) picks.push(list.at(Math.min(list.length - 1, Math.floor(((k + 0.5) / n) * list.length))));
    return picks;
  };
  const plan = [];
  spread(weekdays, 3).forEach(d => plan.push({ day: d, stratum: 'business', hour: '10' }));
  spread(weekdays.slice().reverse(), 3).forEach(d => plan.push({ day: d, stratum: 'offhours', hour: '22' }));
  spread(weekends, 2).forEach(d => plan.push({ day: d, stratum: 'weekend', hour: '14' }));

  return plan.map(p => {
    const dateStr = Utilities.formatDate(p.day, tz, 'yyyy-MM-dd');
    const offset = Utilities.formatDate(p.day, tz, 'XXX');
    const startMs = Date.parse(`${dateStr}T${p.hour}:00:00${offset}`);
    return {
      stratum: p.stratum,
      startIso: new Date(startMs).toISOString(),
      endIso: new Date(startMs + PREFLIGHT_WINDOW_MIN * 60000).toISOString(),
      seconds: PREFLIGHT_WINDOW_MIN * 60
    };
  });
}

function _preflightProbe_(token, days, startedMs, activity) {
  // Sample only days inside active weeks; when nothing is active, fall back to the whole range
  let windows = activity && activity.activeDays ? _preflightWindows_(days, activity) : [];
  if (!windows.length) windows = _preflightWindows_(days);
  const measured = _preflightMeasurePayload_(token, windows[0]);
  const streams = [];
  TARGET_EVENTS.forEach(ev => {
    windows.forEach((w, wi) => {
      streams.push({ event: ev, window: wi, pageToken: null, count: 0, pages: 0, minMs: Infinity, maxMs: 0, done: false, error: '' });
    });
  });

  let requests = 0;
  let fetchMs = 0;
  const recent = [];
  while (Date.now() - startedMs < PREFLIGHT_TIME_BUDGET_MS) {
    const active = streams.filter(s => !s.done && s.pages < PREFLIGHT_MAX_PAGES_PER_WINDOW).slice(0, PREFLIGHT_FETCHALL_BATCH);
    if (active.length === 0) break;

    // Stay under the 250 filter queries per minute limit
    const now = Date.now();
    while (recent.length && now - recent[0] > 60000) recent.shift();
    if (recent.length + active.length > REPORTS_FILTER_QUERIES_PER_MIN - 10) {
      Utilities.sleep(Math.max(1000, 60000 - (now - recent[0])));
      continue;
    }

    const reqs = active.map(s => {
      const w = windows[s.window];
      const params = { eventName: s.event, maxResults: 1000, fields: PREFLIGHT_PROBE_FIELDS };
      if (s.pageToken) params.pageToken = s.pageToken;
      params.startTime = w.startIso;
      params.endTime = w.endIso;
      return _preflightRequest_(_preflightReportsUrl_(params), token);
    });
    const t0 = Date.now();
    const responses = UrlFetchApp.fetchAll(reqs);
    fetchMs += Date.now() - t0;
    requests += reqs.length;
    for (let i = 0; i < reqs.length; i++) recent.push(t0);

    responses.forEach((resp, i) => {
      const s = active[i];
      const res = _preflightParse_(resp);
      s.pages++;
      if (res.code !== 200) {
        if (res.code === 429 || res.code >= 500) return; // retried on the next round
        s.error = _preflightErrorText_(res);
        s.done = true;
        return;
      }
      const items = (res.json && res.json.items) || [];
      s.count += items.length;
      items.forEach(it => {
        const ms = Date.parse(it.id && it.id.time);
        if (!isNaN(ms)) {
          if (ms < s.minMs) s.minMs = ms;
          if (ms > s.maxMs) s.maxMs = ms;
        }
      });
      s.pageToken = (res.json && res.json.nextPageToken) || null;
      if (!s.pageToken) s.done = true;
    });
  }

  // Events per second for each event x window. A capped window extrapolates from the time span its items cover.
  const rates = streams.map(s => {
    const w = windows[s.window];
    let rate = s.count / w.seconds;
    let capped = false;
    if (!s.done && s.count > 0) {
      capped = true;
      const spanSec = (s.maxMs - s.minMs) / 1000;
      if (spanSec > 1) rate = Math.max(rate, s.count / spanSec);
    }
    return { event: s.event, stratum: w.stratum, rate: rate, capped: capped, error: s.error };
  });

  // One page per event over the whole active span: when it has no next page it is the exact count, which
  // matters for quiet tenants where 15-minute samples are mostly empty (one filter query per event of TARGET_EVENTS)
  const exact = {};
  if (activity && activity.activeDays) {
    const spanStartIso = new Date(activity.firstActiveMs).toISOString();
    const spanEndIso = new Date(activity.endMs).toISOString();
    const responses = UrlFetchApp.fetchAll(TARGET_EVENTS.map(ev => _preflightRequest_(_preflightReportsUrl_({
      eventName: ev, maxResults: 1000, fields: PREFLIGHT_PROBE_FIELDS, startTime: spanStartIso, endTime: spanEndIso
    }), token)));
    requests += responses.length;
    responses.forEach((resp, i) => {
      const res = _preflightParse_(resp);
      if (res.code !== 200 || !res.json) return;
      const items = res.json.items || [];
      if (!res.json.nextPageToken) {
        exact[TARGET_EVENTS[i]] = { count: items.length };
        return;
      }
      // Newest first: the page covers the most recent days; at least a full day of it gives a usable daily rate
      const oldestMs = items.reduce((m, it) => Math.min(m, Date.parse(it.id && it.id.time) || m), activity.endMs);
      const coveredDays = (activity.endMs - oldestMs) / 86400000;
      exact[TARGET_EVENTS[i]] = { atLeast: items.length, perDay: coveredDays >= 1 ? items.length / coveredDays : 0 };
    });
  }

  measured.probeRequests = requests;
  measured.parallelReqPerSec = fetchMs > 0 ? Math.round((requests / (fetchMs / 1000)) * 10) / 10 : 0;
  return { windows: windows, rates: rates, exact: exact, measured: measured };
}

/**
 * Times a full-payload page and a fields=-trimmed page serially, to model the current engine
 * and to show how much partial response saves.
 */
function _preflightMeasurePayload_(token, w) {
  const base = { eventName: 'CONTENT_TRANSFER', maxResults: 1000, startTime: w.startIso, endTime: w.endIso };
  const timeOne = fields => {
    const params = Object.assign({}, base);
    if (fields) params.fields = fields;
    const t0 = Date.now();
    const res = _preflightGet_(_preflightReportsUrl_(params), token);
    const items = (res.json && res.json.items) || [];
    return { ms: Date.now() - t0, bytes: res.bytes, items: items.length, code: res.code };
  };
  const full = timeOne('');
  const trimmed = timeOne(PREFLIGHT_TRIMMED_FIELDS);
  return {
    serialFullPageMs: full.ms,
    fullPageBytes: full.bytes,
    trimmedPageMs: trimmed.ms,
    trimmedPageBytes: trimmed.bytes,
    sampleItems: full.items
  };
}

// ==============================================================================
// SECTION 4: ESTIMATE & WARNINGS
// ==============================================================================

function _preflightEstimate_(probe, days, activity) {
  const BUSINESS_SEC = 10 * 3600; // weekday 08:00-18:00
  const OFFHOURS_SEC = 14 * 3600;
  const WEEKEND_SEC = 24 * 3600;
  const pick = (list, fn) => list.length ? fn(...list) : null;

  const perEvent = TARGET_EVENTS.map(ev => {
    const rows = probe.rates.filter(r => r.event === ev && !r.error);
    const byStratum = s => rows.filter(r => r.stratum === s).map(r => r.rate);
    const all = rows.map(r => r.rate);
    const mean = list => list.reduce((a, b) => a + b, 0) / list.length;
    const fallback = all.length ? mean(all) : 0;
    const stat = (s, fn) => {
      const list = byStratum(s);
      return list.length ? fn(list) : fallback;
    };
    const weekdayEvents = fn => BUSINESS_SEC * stat('business', fn) + OFFHOURS_SEC * stat('offhours', fn);
    const weekendEvents = fn => WEEKEND_SEC * stat('weekend', fn);
    // Extrapolate over the active days only; quiet weeks contribute nothing
    const wd = activity ? activity.weekdays : days * 5 / 7;
    const we = activity ? activity.weekendDays : days * 2 / 7;
    const total = fn => Math.round(wd * weekdayEvents(fn) + we * weekendEvents(fn));
    let perWeekday = weekdayEvents(mean);
    let perWeekendDay = weekendEvents(mean);
    let mid = total(mean);
    let lo = total(list => pick(list, Math.min));
    let hi = total(list => pick(list, Math.max));
    const exact = (probe.exact || {})[ev];
    if (exact && exact.count !== undefined) {
      // Known count: keep the sampled weekday/weekend shape when there is one, else spread it evenly
      const scale = mid > 0 ? exact.count / mid : 0;
      const even = wd + we > 0 ? exact.count / (wd + we) : 0;
      perWeekday = scale ? perWeekday * scale : even;
      perWeekendDay = scale ? perWeekendDay * scale : even;
      mid = lo = hi = exact.count;
    } else if (exact && exact.atLeast) {
      if (exact.perDay && mid < exact.perDay * (wd + we)) {
        // Sparse samples missed most events; the recent daily rate is the better basis
        const even = exact.perDay;
        perWeekday = even;
        perWeekendDay = even;
        mid = Math.round(even * (wd + we));
      }
      lo = Math.max(lo, exact.atLeast);
      mid = Math.max(mid, lo);
      hi = Math.max(hi, mid);
    }
    return {
      event: ev,
      perWeekday: Math.round(perWeekday * 10) / 10,
      perWeekendDay: Math.round(perWeekendDay * 10) / 10,
      total: mid,
      lo: lo,
      hi: hi,
      capped: rows.some(r => r.capped),
      error: (probe.rates.find(r => r.event === ev && r.error) || {}).error || ''
    };
  });

  const sum = key => perEvent.reduce((a, e) => a + e[key], 0);
  const totalEvents = sum('total');
  const m = probe.measured;

  // Current engine: one quiet-week check per week, then day slices per event on active weeks,
  // one serial page then two Sheets appends
  const weekChecks = activity ? activity.weeks.length : Math.ceil(days / 7);
  const legacyRequests = Math.round(weekChecks + perEvent.reduce((a, e) => a + (activity
    ? activity.weekdays * ceraPagesFor_(e.perWeekday) + activity.weekendDays * ceraPagesFor_(e.perWeekendDay)
    : days * ceraPagesFor_(e.total / days)), 0));
  // Every request pays the fetch and the pacing; only returned rows pay the Sheets appends
  const legacyRuntimeSec = legacyRequests * ((m.serialFullPageMs / 1000) + LEGACY_PACING_SEC_PER_PAGE) +
    (totalEvents / 1000) * LEGACY_SHEET_WRITE_SEC_PER_PAGE;

  // Rollup engine: hour slices per event, parallel fetchAll capped by the filter-query limit
  const rollupRequests = perEvent.reduce((a, e) => a + days * 24 * Math.max(1, Math.ceil(e.total / days / 24 / 1000)), 0);
  const filterCapPerSec = REPORTS_FILTER_QUERIES_PER_MIN / 60;
  const rollupReqPerSec = Math.min(m.parallelReqPerSec || filterCapPerSec, filterCapPerSec);
  const rollupPerDay = Math.min(rollupReqPerSec * TRIGGER_RUNTIME_SEC_PER_DAY, URLFETCH_CALLS_PER_DAY);

  const round1 = x => Math.round(x * 10) / 10;
  return {
    perEvent: perEvent,
    totalEvents: totalEvents,
    totalLo: sum('lo'),
    totalHi: sum('hi'),
    measured: m,
    legacy: {
      requests: legacyRequests,
      runtimeHours: round1(legacyRuntimeSec / 3600),
      calendarDays: round1(legacyRuntimeSec / TRIGGER_RUNTIME_SEC_PER_DAY),
      wallHours: round1(legacyRuntimeSec / LEGACY_TICK_DUTY / 3600),
      wallMinutes: Math.ceil(legacyRuntimeSec / LEGACY_TICK_DUTY / 60),
      partitions: Math.ceil(totalEvents / LEGACY_ROWS_PER_PARTITION),
      assumedSheetWriteSec: LEGACY_SHEET_WRITE_SEC_PER_PAGE
    },
    rollup: {
      requests: rollupRequests,
      reqPerSec: round1(rollupReqPerSec),
      calendarDays: round1(rollupRequests / rollupPerDay)
    }
  };
}

function ceraPagesFor_(events) {
  return Math.max(1, Math.ceil((Number(events) || 0) / 1000));
}

/**
 * Keeps what ingestion needs to report real progress: which weeks are active and the expected events per
 * weekday and weekend day for each event. engageCloudIngestion picks it up when it starts within 2 hours.
 */
function _preflightSavePlan_(result) {
  try {
    const plan = {
      savedMs: Date.now(),
      days: result.days,
      startMs: result.activity.startMs,
      weeks: result.activity.weeks.map(w => (w ? '1' : '0')).join(''),
      total: result.estimate.totalEvents,
      perDay: {}
    };
    result.estimate.perEvent.forEach(e => { plan.perDay[e.event] = [e.perWeekday, e.perWeekendDay]; });
    PropertiesService.getDocumentProperties().setProperty(CERA_PREFLIGHT_PLAN_KEY, JSON.stringify(plan));
  } catch (e) {
    console.warn('[Preflight] Could not save the ingestion plan: ' + e.message);
  }
}

function _preflightAddWarnings_(result) {
  const est = result.estimate;
  if (est.totalEvents === 0) {
    result.warnings.push({ key: 'pf.warn.noEvents' });
  }
  if (est.legacy.calendarDays > 3) {
    result.warnings.push({ key: 'pf.warn.longRange', params: { days: est.legacy.calendarDays } });
  }
  if (est.legacy.partitions > 60) {
    result.warnings.push({ key: 'pf.warn.partitions', params: { n: est.legacy.partitions } });
  }
  if (est.perEvent.some(e => e.capped)) {
    result.warnings.push({ key: 'pf.warn.capped' });
  }
}

/**
 * Numbers for the dialog's summary sentence (pf.summary); the dialog formats them in the user's language.
 */
function ceraDurationParts_(legacy) {
  // One tick per minute, so the first result shows up after a minute at the earliest
  if (legacy.wallHours < 1) return { unit: 'minutes', n: Math.max(2, Math.ceil(legacy.wallMinutes / 5) * 5) };
  if (legacy.wallHours < 20) return { unit: 'hours', n: Math.max(1, Math.round(legacy.wallHours)) };
  return { unit: 'days', n: Math.ceil(legacy.calendarDays) };
}

function _preflightSummaryParams_(result) {
  const est = result.estimate;
  const d = ceraDurationParts_(est.legacy);
  return {
    lo: est.totalLo,
    hi: est.totalHi,
    total: est.totalEvents,
    days: result.days,
    durationKey: 'pf.duration.' + d.unit,
    durationN: d.n
  };
}

// ==============================================================================
// ==============================================================================
// SECTION 5: STEP 0 CHROME ENTERPRISE PRE-REQUISITE POLICY CHECK
// ==============================================================================

const CHROME_POLICY_RESOLVE_URL = 'https://chromepolicy.googleapis.com/v1/customers/my_customer/policies/orgunits:resolve';
const DIRECTORY_ORGUNITS_URL = 'https://admin.googleapis.com/admin/directory/v1/customers/my_customer/orgunits?type=ALL_INCLUDING_PARENT';

// Three essential Chrome Enterprise reporting pre-requisite policies verified in Step 0 for administrators.
const CERA_CEC_POLICIES = [
  {
    id: 'on_security_event',
    schema: 'chrome.users.OnSecurityEvent',
    titleKey: 'precheck.pol.on_security_event.title',
    targetKey: 'precheck.pol.on_security_event.target',
    url: 'https://admin.google.com/ac/chrome/settings/user/details/on_security_event'
  },
  {
    id: 'cloud_reporting',
    schema: 'chrome.users.CloudReportingEnabled',
    titleKey: 'precheck.pol.cloud_reporting.title',
    targetKey: 'precheck.pol.cloud_reporting.target',
    url: 'https://admin.google.com/ac/chrome/settings/user/details/cloud_reporting'
  },
  {
    id: 'cloud_profile_reporting',
    schema: 'chrome.users.CloudProfileReportingEnabled',
    titleKey: 'precheck.pol.cloud_profile_reporting.title',
    targetKey: 'precheck.pol.cloud_profile_reporting.target',
    url: 'https://admin.google.com/ac/chrome/settings/user/details/cloud_profile_reporting'
  }
];

function _precheckExtractRootOuId_(ous) {
  if (!Array.isArray(ous)) return '';
  for (let i = 0; i < ous.length; i++) {
    const ou = ous[i];
    if (ou && ou.orgUnitPath === '/' && typeof ou.orgUnitId === 'string' && ou.orgUnitId) {
      return ou.orgUnitId.replace(/^id:/, '');
    }
    if (ou && ou.parentOrgUnitPath === '/' && typeof ou.parentOrgUnitId === 'string' && ou.parentOrgUnitId) {
      return ou.parentOrgUnitId.replace(/^id:/, '');
    }
  }
  return '';
}

function _precheckResolveRootOuId_(token) {
  try {
    if (typeof AdminDirectory !== 'undefined' && AdminDirectory.Orgunits && typeof AdminDirectory.Orgunits.list === 'function') {
      const resp = AdminDirectory.Orgunits.list('my_customer', { type: 'ALL_INCLUDING_PARENT' });
      const id = _precheckExtractRootOuId_(resp && resp.organizationUnits);
      if (id) return id;
    }
  } catch (e) {}
  try {
    const res = _preflightGet_(DIRECTORY_ORGUNITS_URL, token);
    if (res.code === 200 && res.json) {
      return _precheckExtractRootOuId_(res.json.organizationUnits);
    }
  } catch (e) {}
  return '';
}

function _precheckEvaluatePolicyValue_(policyId, val) {
  if (!val || typeof val !== 'object') return null;
  if (policyId === 'on_security_event') {
    if (val.explicitlyEmptyEventNames === true) return 'disabled';
    if (!Array.isArray(val.eventNames) || val.eventNames.length === 0 || val.eventNames.length >= 4) return 'enabled';
    return 'partial';
  }
  if (policyId === 'cloud_reporting') {
    if (val.cloudReportingEnabled === true) return 'enabled';
    if (val.cloudReportingEnabled === false) return 'disabled';
    return null;
  }
  if (policyId === 'cloud_profile_reporting') {
    if (val.cloudProfileReportingEnabled === true) return 'enabled';
    if (val.cloudProfileReportingEnabled === false) return 'disabled';
    return null;
  }
  return null;
}

/**
 * Checks the 3 essential Chrome Enterprise pre-requisite policies in Step 0:
 * Event reporting, Managed browser reporting, and Managed profile reporting.
 * Uses Chrome Policy API v1 when available and falls back to a lightweight Reports API
 * activity check when policies are configured on child OUs or when the Policy API is not enabled.
 */
function runAdminPolicyPrecheck() {
  const token = (typeof ScriptApp !== 'undefined' && ScriptApp.getOAuthToken) ? ScriptApp.getOAuthToken() : '';
  const rootOuId = _precheckResolveRootOuId_(token);
  let policyApiReachable = false;
  const directStatusMap = {};

  if (rootOuId) {
    try {
      const polReqs = CERA_CEC_POLICIES.map(pol => ({
        url: CHROME_POLICY_RESOLVE_URL,
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + token },
        payload: JSON.stringify({
          policyTargetKey: { targetResource: 'orgunits/' + rootOuId },
          policySchemaFilter: pol.schema
        }),
        muteHttpExceptions: true
      }));
      const polResponses = UrlFetchApp.fetchAll(polReqs);
      polResponses.forEach((resp, idx) => {
        const res = _preflightParse_(resp);
        if (res.code === 200) {
          policyApiReachable = true;
          const resolved = (res.json && Array.isArray(res.json.resolvedPolicies)) ? res.json.resolvedPolicies : [];
          const rawVal = (resolved[0] && resolved[0].value && resolved[0].value.value) || null;
          const pol = CERA_CEC_POLICIES[idx];
          const evaluated = _precheckEvaluatePolicyValue_(pol.id, rawVal);
          if (evaluated) directStatusMap[pol.id] = evaluated;
        }
      });
    } catch (e) {
      console.warn('[PolicyPrecheck] Chrome Policy API notice: ' + e.message);
    }
  }

  let anyEventActive = false;
  const needsFallback = CERA_CEC_POLICIES.some(pol => !directStatusMap[pol.id]);
  if (needsFallback) {
    try {
      const endMs = Date.now();
      const startIso = new Date(endMs - 7 * 86400000).toISOString();
      const endIso = new Date(endMs).toISOString();
      const probeRes = _preflightGet_(_preflightReportsUrl_({
        maxResults: 1,
        startTime: startIso,
        endTime: endIso,
        fields: PREFLIGHT_PROBE_FIELDS
      }), token);
      anyEventActive = probeRes.code === 200 && !!(probeRes.json && Array.isArray(probeRes.json.items) && probeRes.json.items.length > 0);
    } catch (e) {}
  }

  const policies = CERA_CEC_POLICIES.map(pol => {
    const direct = directStatusMap[pol.id] || null;
    let status = direct;
    let source = 'policy_api';
    if (!status) {
      if (anyEventActive) {
        status = 'inferred';
        source = 'telemetry';
      } else if (policyApiReachable) {
        status = 'missing';
        source = 'policy_api';
      } else {
        status = 'verify';
        source = 'telemetry';
      }
    }
    return {
      id: pol.id,
      schema: pol.schema,
      titleKey: pol.titleKey,
      targetKey: pol.targetKey,
      url: pol.url,
      status: status,
      source: source
    };
  });

  const activePoliciesCount = policies.filter(p => p.status === 'enabled' || p.status === 'inferred').length;

  return {
    rootOuId: rootOuId,
    policyApiReachable: policyApiReachable,
    policies: policies,
    activePoliciesCount: activePoliciesCount,
    totalPoliciesCount: policies.length,
    allReady: activePoliciesCount === policies.length
  };
}

