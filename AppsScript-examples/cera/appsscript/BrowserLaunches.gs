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
 * Module: BrowserLaunches.gs
 * Description: Browser launches with command-line switches (the Chrome event SUSPICIOUS_BROWSER_LAUNCH): the events of
 *              one launch are folded into one launch, and each launch is classed by what its switches allow
 * ==============================================================================
 *
 * Chrome logs this event every time the browser starts with command-line switches, its own startup switches included
 * (a start in the background at sign-in, a profile shortcut, a restart after an update), so the number of events says
 * nothing by itself. One launch is logged once at browser level and once per open profile, with the same time, device
 * and switches: events of the same device (or the same profile user when the device is not reported), with the same set
 * of switches and within CeraConfig.LAUNCH_FOLD_WINDOW_MS of the first of them are one launch, whatever their client
 * type. Rows wait until every row was read (ceraFlushLaunches_), so the launches never depend on the order of the rows.
 *
 * A launch is routine when every one of its switches is one Chrome passes itself (CeraConfig.LAUNCH_SWITCH_CLASSES);
 * otherwise it is in each class one of its other switches belongs to, 'other' for a switch in no class. A launch whose
 * switches the log does not report (an export without that column) is counted and never classed.
 */

/**
 * The switches of a launch as the log gives them: a list (Reports API), or one cell of a partition or an export, with
 * one switch per line, a JSON list, a command line ("--a --b=c") or a list separated by commas. A comma starts a new
 * switch only when a switch name follows it (lower case, digits and dashes) and it is followed by a space or ends a
 * switch without a value: a value can be a list itself (enable-features=FeatureA,FeatureB). Leading dashes, a leading
 * slash (/prefetch:5) and quotes are dropped; each switch is kept once, in the order given.
 */
function ceraSplitCommandLineArgs_(str) {
  const args = [];
  let cur = '';
  let quote = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str.charAt(i);
    if (quote) {
      cur += ch;
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (/\s/.test(ch)) {
      if (cur) {
        args.push(cur);
        cur = '';
      }
    } else {
      cur += ch;
    }
  }
  if (cur) args.push(cur);
  return args;
}

function ceraSplitUnquotedCommas_(str) {
  const chunks = [];
  let cur = '';
  let quote = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str.charAt(i);
    if (quote) {
      cur += ch;
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ',') {
      chunks.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  chunks.push(cur);
  return chunks;
}

function ceraStripMatchingOuterQuotes_(str) {
  const s = String(str || '').trim();
  if (s.length >= 2 && ((s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') || (s.charAt(0) === "'" && s.charAt(s.length - 1) === "'"))) {
    return s.slice(1, -1).trim();
  }
  return s;
}

var CERA_BOOLEAN_LAUNCH_SWITCHES_ = {
  'no-startup-window': true,
  'startup-foreground-launch': true,
  'restore-last-session': true,
  'restart': true,
  'flag-switches-begin': true,
  'flag-switches-end': true,
  'remote-debugging-pipe': true,
  'headless': true,
  'enable-automation': true,
  'test-type': true,
  'auto-open-devtools-for-tabs': true,
  'no-sandbox': true,
  'disable-web-security': true,
  'ignore-certificate-errors': true,
  'disable-site-isolation-trials': true,
  'allow-running-insecure-content': true,
  'disable-gpu-sandbox': true,
  'disable-setuid-sandbox': true,
  'disable-seccomp-filter-sandbox': true,
  'single-process': true,
  'use-fake-ui-for-media-stream': true,
  'disable-client-side-phishing-detection': true,
  'safebrowsing-disable-download-protection': true,
  'disable-webrtc-encryption': true,
  'no-first-run': true,
  'no-default-browser-check': true,
  'incognito': true,
  'guest': true,
  'kiosk': true,
  'bwsi': true,
  'allow-file-access-from-files': true,
  'allow-insecure-localhost': true,
  'unsafely-disable-devtools-self-xss-warnings': true,
  'disable-extensions': true,
  'extensions-on-chrome-urls': true,
  'silent-debugger-extension-api': true,
  'no-proxy-server': true,
  'proxy-auto-detect': true
};

function ceraUnwrapCliSwitch_(raw) {
  const outer = ceraStripMatchingOuterQuotes_(raw);
  if (!outer) return null;
  if (outer === '--') return { end: true };
  const m = outer.match(/^(?:--+|-|\/(?=[^\/:=\s]+[:=]))(?:"([^"=\s:]+)"|'([^'=\s:]+)'|([a-z0-9][a-z0-9._-]*))(?=$|[=:\s])([\s\S]*)$/i);
  if (!m) return null;
  const swName = (m[1] || m[2] || m[3] || '').trim();
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(swName)) return null;
  const rest = m[4] || '';
  return {
    name: swName.toLowerCase(),
    hasInlineValue: /^[=:\s]/.test(rest) && rest.trim().length > 0,
    token: swName + rest
  };
}

function ceraLaunchSwitches_(value) {
  if (value === null || value === undefined) return [];
  let parts = null;
  if (Array.isArray(value)) {
    parts = value.map(String);
  } else {
    const s = String(value).trim();
    if (!s) return [];
    if (/^\[[\s\S]*\]$/.test(s)) {
      try {
        const list = JSON.parse(s);
        if (Array.isArray(list)) parts = list.map(String);
      } catch (e) {}
    }
    if (!parts && /[\r\n]/.test(s)) parts = s.split(/\r?\n/);
    if (!parts) {
      const rawArgs = ceraSplitCommandLineArgs_(s);
      let hasCliSwitch = false;
      let hasSwitchComma = false;
      for (let i = 0; i < rawArgs.length; i++) {
        const arg = rawArgs[i];
        const sw = ceraUnwrapCliSwitch_(arg);
        if (sw && !sw.end) hasCliSwitch = true;
        const commaChunks = ceraSplitUnquotedCommas_(arg);
        if (commaChunks.length > 1) {
          if (!commaChunks[commaChunks.length - 1].trim()) {
            hasSwitchComma = true;
          } else {
            for (let k = 1; k < commaChunks.length; k++) {
              if (/^\s*--[a-z0-9"']/i.test(commaChunks[k])) {
                hasSwitchComma = true;
                break;
              }
            }
            if (!hasSwitchComma && sw && !sw.end && commaChunks[0].indexOf('=') === -1 && commaChunks[0].indexOf(':') === -1) {
              hasSwitchComma = true;
            }
          }
        }
      }
      if (hasCliSwitch && !hasSwitchComma) {
        // A command line: the program path and trailing positional URLs are not switches; bare -- ends options
        parts = [];
        let seenSwitch = false;
        let prevNeedsValue = false;
        for (let i = 0; i < rawArgs.length; i++) {
          const arg = rawArgs[i];
          const sw = ceraUnwrapCliSwitch_(arg);
          if (sw && sw.end) break;
          if (sw) {
            seenSwitch = true;
            parts.push(sw.token);
            prevNeedsValue = !sw.hasInlineValue && !Object.prototype.hasOwnProperty.call(CERA_BOOLEAN_LAUNCH_SWITCHES_, sw.name);
          } else if (seenSwitch && prevNeedsValue && parts.length > 0) {
            parts[parts.length - 1] = parts[parts.length - 1] + ' ' + arg;
            prevNeedsValue = false;
          } else {
            prevNeedsValue = false;
          }
        }
      }
    }
    if (!parts) {
      parts = [];
      ceraSplitUnquotedCommas_(s).forEach((chunk, i) => {
        const startsSwitch = /^\s*(?:--?|\/(?=[a-z0-9-]+[:=]))?(?:"[a-z0-9][a-z0-9._-]*"|'[a-z0-9][a-z0-9._-]*'|[a-z0-9][a-z0-9._-]*)(?:[=:]|\s*$)/i.test(chunk);
        const current = parts[parts.length - 1];
        if (i > 0 && !(startsSwitch && (/^\s/.test(chunk) || /^\s*--/.test(chunk) || current.indexOf('=') === -1))) {
          parts[parts.length - 1] = current + ',' + chunk;
        } else {
          parts.push(chunk);
        }
      });
    }
  }
  const out = [];
  const closedFlagTokens = Object.create(null);
  const outsideTokens = Object.create(null);
  let pendingFlagBlock = null;
  parts.forEach(p => {
    let t = ceraStripMatchingOuterQuotes_(p);
    t = t.replace(/^-+/, '').replace(/^\/(?=[a-z0-9-]+[:=])/i, '').trim();
    t = t.replace(/^(?:"([^"=\s:]+)"|'([^'=\s:]+)')(?=$|[=:\s])/, '$1$2').trim();
    if (!t) return;
    const sep = t.search(/[=:\s]/);
    const swName = (sep === -1 ? t : t.slice(0, sep)).trim().replace(/^["']+|["']+$/g, '').toLowerCase();
    if (swName === 'flag-switches-begin' && sep === -1) {
      if (pendingFlagBlock) {
        for (let i = 0; i < pendingFlagBlock.length; i++) outsideTokens[pendingFlagBlock[i].toLowerCase()] = true;
      }
      pendingFlagBlock = [];
    } else if (swName === 'flag-switches-end' && sep === -1) {
      if (pendingFlagBlock) {
        for (let i = 0; i < pendingFlagBlock.length; i++) closedFlagTokens[pendingFlagBlock[i]] = true;
        pendingFlagBlock = null;
      }
    } else if (pendingFlagBlock) {
      pendingFlagBlock.push(t);
    } else {
      outsideTokens[t.toLowerCase()] = true;
    }
    if (out.indexOf(t) === -1) out.push(t);
  });
  if (pendingFlagBlock) {
    for (let i = 0; i < pendingFlagBlock.length; i++) outsideTokens[pendingFlagBlock[i].toLowerCase()] = true;
  }
  const flagSwitches = Object.create(null);
  Object.keys(closedFlagTokens).forEach(tok => {
    if (!outsideTokens[tok.toLowerCase()]) flagSwitches[tok] = true;
  });
  if (Object.keys(flagSwitches).length > 0) {
    Object.defineProperty(out, 'flagSwitches', { value: flagSwitches, enumerable: false });
  }
  return out;
}

/**
 * CeraConfig.LAUNCH_SWITCH_CLASSES as lookup tables, built once: valued entries ('name=Value'), names, and prefixes.
 */
var _ceraLaunchSwitchTable_ = null;
function ceraLaunchSwitchTable_() {
  if (_ceraLaunchSwitchTable_) return _ceraLaunchSwitchTable_;
  const table = { valued: [], named: Object.create(null), prefixes: [] };
  const classes = CeraConfig.LAUNCH_SWITCH_CLASSES || {};
  Object.keys(classes).forEach(cls => (classes[cls] || []).forEach(entry => {
    const e = String(entry).trim();
    const eq = e.indexOf('=');
    if (eq !== -1) table.valued.push({ name: e.slice(0, eq).toLowerCase(), value: e.slice(eq + 1).toLowerCase(), cls: cls, label: e });
    else if (/\*$/.test(e)) table.prefixes.push({ prefix: e.slice(0, -1).toLowerCase(), cls: cls });
    else table.named[e.toLowerCase()] = cls;
  }));
  _ceraLaunchSwitchTable_ = table;
  return table;
}

/**
 * Class of one switch (CeraConfig.LAUNCH_SWITCH_CLASSES) and the label it is listed under: { cls, label }. The label is
 * the switch name without its value (a value can hold a path that names a user), or the 'name=Value' entry that decided.
 */
function ceraLaunchSwitchClass_(token) {
  const t = String(token || '').trim();
  const sep = t.search(/[=:\s]/);
  const name = (sep === -1 ? t : t.slice(0, sep)).trim().replace(/^["']+|["']+$/g, '').toLowerCase();
  const rawVal = sep === -1 ? '' : ceraStripMatchingOuterQuotes_(t.slice(sep + 1));
  const values = [];
  if (rawVal) {
    rawVal.split(',').forEach(part => {
      const v = part.trim().replace(/^["']+|["']+$/g, '').trim().toLowerCase();
      if (!v) return;
      if (values.indexOf(v) === -1) values.push(v);
      const baseFeat = v.split(/[:<]/)[0].trim();
      if (baseFeat && values.indexOf(baseFeat) === -1) values.push(baseFeat);
    });
  }
  const table = ceraLaunchSwitchTable_();
  for (let i = 0; i < table.valued.length; i++) {
    const e = table.valued[i];
    if (e.name === name && values.indexOf(e.value) !== -1) return { cls: e.cls, label: e.label };
  }
  if (Object.prototype.hasOwnProperty.call(table.named, name)) return { cls: table.named[name], label: name };
  for (let i = 0; i < table.prefixes.length; i++) {
    if (name.indexOf(table.prefixes[i].prefix) === 0) return { cls: table.prefixes[i].cls, label: name };
  }
  return { cls: 'other', label: name || t };
}

/**
 * Explicit external command-line / launcher switches that Chrome never sets via chrome://flags and that must never
 * be downgraded to routine even if placed between --flag-switches-begin and --flag-switches-end.
 */
var CERA_EXTERNAL_LAUNCH_SWITCHES_ = {
  'user-data-dir': true,
  'app-id': true,
  'app': true,
  'load-extension': true,
  'disable-extensions-except': true,
  'disable-extensions': true,
  'extensions-on-chrome-urls': true,
  'silent-debugger-extension-api': true,
  'no-first-run': true,
  'no-default-browser-check': true,
  'lang': true,
  'incognito': true,
  'guest': true,
  'kiosk': true,
  'bwsi': true,
  'allow-file-access-from-files': true,
  'allow-insecure-localhost': true,
  'ssl-key-log-file': true,
  'log-net-log': true,
  'unsafely-disable-devtools-self-xss-warnings': true,
  'renderer-cmd-prefix': true,
  'utility-cmd-prefix': true,
  'gpu-launcher': true,
  'browser-subprocess-path': true,
  'no-proxy-server': true,
  'proxy-auto-detect': true
};

/**
 * Classifies one launch switch with chrome://flags context. The 4 security risk classes (automation, protectionsOff,
 * extensionsFromDisk, trafficRedirected) and explicit external launcher switches are always evaluated first and never
 * downgraded; only harmless 'other' experiment switches strictly inside --flag-switches-begin ... --flag-switches-end
 * become 'routine'.
 */
function ceraClassifyLaunchSwitch_(token, inFlagBlock) {
  const base = ceraLaunchSwitchClass_(token);
  if (base.cls !== 'other') return base;
  const swKey = String(base.label || '').toLowerCase();
  if (inFlagBlock && !Object.prototype.hasOwnProperty.call(CERA_EXTERNAL_LAUNCH_SWITCHES_, swKey)) {
    return { cls: 'routine', label: base.label };
  }
  return base;
}

function ceraLaunchOwnGet_(obj, key) {
  return (obj && Object.prototype.hasOwnProperty.call(obj, key)) ? obj[key] : undefined;
}

function ceraLaunchOwnSet_(obj, key, val) {
  if (key === '__proto__') {
    Object.defineProperty(obj, '__proto__', { value: val, enumerable: true, configurable: true, writable: true });
  } else {
    obj[key] = val;
  }
  return val;
}

/**
 * The fields of a launch row: time, device, profile user, device user and switches (null when the sheet has no switches
 * column). rec is the row normalized by ceraNormalizeRow_.
 */
function ceraLaunchRow_(row, col, rec) {
  const text = idx => (idx !== undefined && idx !== -1 && row[idx] !== null && row[idx] !== undefined ? String(row[idx]).trim() : '');
  const parsedSwitches = col.switches !== undefined && col.switches !== -1 ? ceraLaunchSwitches_(row[col.switches]) : null;
  return {
    t: rec.t,
    device: text(col.deviceName),
    user: rec.userIdent,
    deviceUser: text(col.deviceUser).toLowerCase(),
    switches: parsedSwitches,
    flagSwitches: (parsedSwitches && parsedSwitches.flagSwitches) ? parsedSwitches.flagSwitches : null
  };
}

/**
 * Adds one launch event (ceraLaunchRow_) to the events waiting to be folded, keyed by device (or profile user, or device
 * user) and set of switches. The waiting events are kept on the state as a non-enumerable property, their times and
 * users as numbers, so a log of many launches stays small in memory.
 */
function ceraAddLaunchRow_(state, row) {
  if (!Object.prototype.hasOwnProperty.call(state, '_launchRows')) {
    Object.defineProperty(state, '_launchRows', { value: null, enumerable: false, writable: true });
  }
  if (!state._launchRows) state._launchRows = { keys: new Map(), names: [''], nameIds: new Map([['', 0]]), events: 0 };
  const store = state._launchRows;
  const nameId = name => {
    const n = name || '';
    if (!store.nameIds.has(n)) {
      store.nameIds.set(n, store.names.length);
      store.names.push(n);
    }
    return store.nameIds.get(n);
  };
  store.events++;
  const switches = row.switches ? row.switches.slice().sort() : null;
  const rowFlags = row.flagSwitches || (row.switches && row.switches.flagSwitches) || null;
  const flagKeys = rowFlags ? Object.keys(rowFlags).filter(k => Object.prototype.hasOwnProperty.call(rowFlags, k) && rowFlags[k]).sort() : [];
  const identity = row.device ? 'd|' + row.device : (row.user ? 'u|' + row.user : (row.deviceUser ? 'w|' + row.deviceUser : ''));
  const key = identity + '\u0000' + (switches ? switches.join('\n') : '\u0001') + (flagKeys.length ? '\u0000' + flagKeys.join('\n') : '');
  let entry = store.keys.get(key);
  if (!entry) {
    let flagCopy = null;
    if (flagKeys.length) {
      flagCopy = Object.create(null);
      flagKeys.forEach(fk => { flagCopy[fk] = true; });
    }
    store.keys.set(key, entry = { device: row.device || '', switches: switches, flagSwitches: flagCopy, rows: [] });
  }
  entry.rows.push(typeof row.t === 'number' && !isNaN(row.t) ? row.t : NaN, nameId(row.user), nameId(row.deviceUser));
}

/** An empty tally of launches: how many, and the people and devices they came from (with launches that had none). */
function ceraLaunchSet_() {
  return { launches: 0, users: Object.create(null), devices: Object.create(null), noUser: 0, noDevice: 0 };
}

/**
 * Folds the waiting launch events into launches and aggregates each launch once into state.browserLaunches:
 *   events: log rows read; launches; notReported: launches whose switches the log does not report; routine: launches
 *   with only routine switches; all, nonRoutine, routineSet, notReportedSet and classes[cls]: ceraLaunchSet_ tallies of
 *   every launch, of the launches with a switch that is not routine, of the routine launches, of those without reported
 *   switches, and of each class; switches: label -> { launches, cls }, each label counted once per launch.
 * A launch is the events of one key within CeraConfig.LAUNCH_FOLD_WINDOW_MS of its first event, in time order. Its
 * people are the profile users of its events (two when two profiles were open), or their device users when no event
 * names a profile user. Called once every row was read (ceraFlushActions_); safe to call again.
 */
function ceraFlushLaunches_(state) {
  const store = state && state._launchRows;
  if (!store || !store.events) return;
  state._launchRows = null;
  const agg = state.browserLaunches || (state.browserLaunches = {
    events: 0, launches: 0, notReported: 0, routine: 0, all: ceraLaunchSet_(), nonRoutine: ceraLaunchSet_(), routineSet: ceraLaunchSet_(),
    notReportedSet: ceraLaunchSet_(), classes: Object.create(null), switches: Object.create(null)
  });
  agg.events += store.events;
  const windowMs = CeraConfig.LAUNCH_FOLD_WINDOW_MS || 1000;
  const names = store.names;
  Array.from(store.keys.keys()).sort().forEach(key => {
    const entry = store.keys.get(key);
    const rows = [];
    for (let i = 0; i < entry.rows.length; i += 3) rows.push({ t: entry.rows[i], user: names[entry.rows[i + 1]], deviceUser: names[entry.rows[i + 2]] });
    const at = r => (isNaN(r.t) ? Infinity : r.t);
    rows.sort((a, b) => at(a) - at(b) || (a.user < b.user ? -1 : a.user > b.user ? 1 : 0) || (a.deviceUser < b.deviceUser ? -1 : a.deviceUser > b.deviceUser ? 1 : 0));
    let launch = null;
    const emit = () => {
      if (!launch) return;
      const distinct = list => list.filter((u, i) => u && list.indexOf(u) === i);
      const profileUsers = distinct(launch.rows.map(r => r.user));
      const users = profileUsers.length ? profileUsers : distinct(launch.rows.map(r => r.deviceUser));
      ceraAggregateLaunch_(agg, { device: entry.device, users: users, switches: entry.switches, flagSwitches: entry.flagSwitches || null });
    };
    rows.forEach(r => {
      if (launch && !isNaN(r.t) && !isNaN(launch.t) && r.t - launch.t <= windowMs) {
        launch.rows.push(r);
        return;
      }
      emit();
      launch = { t: r.t, rows: [r] };
    });
    emit();
  });
}

/** Adds one launch to a ceraLaunchSet_ tally: each of its people and its device count it once. */
function ceraTallyLaunch_(set, launch) {
  set.launches++;
  launch.users.forEach(u => {
    ceraLaunchOwnSet_(set.users, u, (Number(ceraLaunchOwnGet_(set.users, u)) || 0) + 1);
  });
  if (!launch.users.length) set.noUser++;
  if (launch.device) {
    ceraLaunchOwnSet_(set.devices, launch.device, (Number(ceraLaunchOwnGet_(set.devices, launch.device)) || 0) + 1);
  } else {
    set.noDevice++;
  }
}

/**
 * Aggregates one launch ({ device, users, switches }) into state.browserLaunches (ceraFlushLaunches_): without
 * reported switches it is only counted; otherwise its switches are classed, and it is routine or in every class one
 * of its other switches belongs to.
 */
function ceraAggregateLaunch_(agg, launch) {
  agg.launches++;
  ceraTallyLaunch_(agg.all, launch);
  if (!launch.switches || !launch.switches.length) {
    agg.notReported++;
    ceraTallyLaunch_(agg.notReportedSet, launch);
    return;
  }
  const labels = Object.create(null);
  const classes = Object.create(null);
  const flagMap = launch.flagSwitches || (launch.switches && launch.switches.flagSwitches) || null;
  launch.switches.forEach(token => {
    const c = ceraClassifyLaunchSwitch_(token, Boolean(ceraLaunchOwnGet_(flagMap, token)));
    if (!labels[c.label] || labels[c.label] === 'routine') ceraLaunchOwnSet_(labels, c.label, c.cls);
    if (c.cls !== 'routine') ceraLaunchOwnSet_(classes, c.cls, true);
  });
  Object.keys(labels).forEach(label => {
    let sw = ceraLaunchOwnGet_(agg.switches, label);
    if (!sw) sw = ceraLaunchOwnSet_(agg.switches, label, { launches: 0, cls: labels[label] });
    if (sw.cls === 'routine' && labels[label] !== 'routine') sw.cls = labels[label];
    sw.launches++;
  });
  const list = Object.keys(classes);
  if (!list.length) {
    agg.routine++;
    ceraTallyLaunch_(agg.routineSet, launch);
    return;
  }
  ceraTallyLaunch_(agg.nonRoutine, launch);
  list.forEach(cls => {
    let bucket = ceraLaunchOwnGet_(agg.classes, cls);
    if (!bucket) bucket = ceraLaunchOwnSet_(agg.classes, cls, ceraLaunchSet_());
    ceraTallyLaunch_(bucket, launch);
  });
}

/**
 * People or devices of a tally (ceraLaunchSet_): { n, exact }. exact is false when some of its launches named none
 * (n is then a lower bound, and nothing is known when n is 0: "not reported", never zero).
 */
function ceraLaunchCount_(set, kind) {
  const s = set || ceraLaunchSet_();
  const n = Object.keys(kind === 'devices' ? s.devices : s.users).length;
  return { n: n, exact: (kind === 'devices' ? s.noDevice : s.noUser) === 0 };
}

/**
 * What the deck and the workbook say about browser launches, or null when the logs hold none:
 *   severity ('INFO': informational startup command-line visibility without per-process intent telemetry);
 *   events (log rows), launches, routine, notReported, nonRoutine (launches with a switch that is not routine);
 *   the people and devices ({ n, exact }, ceraLaunchCount_) of every launch (people, devices), of the launches with
 *   other switches (nonRoutinePeople, nonRoutineDevices), of the routine ones (routinePeople, routineDevices) and of
 *   those without reported switches (notReportedPeople, notReportedDevices);
 *   classes: [{ id, launches, people, devices }] of the classes with launches, most launches first (ties in
 *   CeraConfig.LAUNCH_CLASS_ORDER); switches: [{ name, cls, launches }], most launches first;
 *   devicesList and peopleList: [{ name, launches, nonRoutine }], the most launches with other switches first.
 */
function ceraLaunchFacts(state) {
  const b = state && state.browserLaunches;
  if (!b || !(b.launches > 0)) return null;
  const order = CeraConfig.LAUNCH_CLASS_ORDER || [];
  const rank = id => (order.indexOf(id) === -1 ? order.length : order.indexOf(id));
  const classes = Object.keys(b.classes || {}).filter(id => {
    const bucket = ceraLaunchOwnGet_(b.classes, id);
    return bucket && bucket.launches > 0;
  }).map(id => {
    const bucket = ceraLaunchOwnGet_(b.classes, id);
    return {
      id: id,
      launches: bucket.launches,
      people: ceraLaunchCount_(bucket, 'users'),
      devices: ceraLaunchCount_(bucket, 'devices')
    };
  }).sort((x, y) => y.launches - x.launches || rank(x.id) - rank(y.id));
  const switches = Object.keys(b.switches || {}).map(name => {
    const sw = ceraLaunchOwnGet_(b.switches, name);
    return { name: name, cls: sw ? sw.cls : 'other', launches: sw ? sw.launches : 0 };
  }).sort((x, y) => y.launches - x.launches || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  const ranked = kind => {
    const allMap = (b.all && b.all[kind]) || {};
    const nonRoutineMap = (b.nonRoutine && b.nonRoutine[kind]) || {};
    return Object.keys(allMap).map(name => ({
      name: name,
      launches: Number(ceraLaunchOwnGet_(allMap, name)) || 0,
      nonRoutine: Number(ceraLaunchOwnGet_(nonRoutineMap, name)) || 0
    })).sort((x, y) => (y.nonRoutine || 0) - (x.nonRoutine || 0) || y.launches - x.launches || String(x.name).localeCompare(String(y.name)));
  };
  return {
    severity: 'INFO',
    events: b.events,
    launches: b.launches,
    routine: b.routine,
    notReported: b.notReported,
    nonRoutine: b.nonRoutine.launches,
    people: ceraLaunchCount_(b.all, 'users'),
    devices: ceraLaunchCount_(b.all, 'devices'),
    nonRoutinePeople: ceraLaunchCount_(b.nonRoutine, 'users'),
    nonRoutineDevices: ceraLaunchCount_(b.nonRoutine, 'devices'),
    routinePeople: ceraLaunchCount_(b.routineSet, 'users'),
    routineDevices: ceraLaunchCount_(b.routineSet, 'devices'),
    notReportedPeople: ceraLaunchCount_(b.notReportedSet, 'users'),
    notReportedDevices: ceraLaunchCount_(b.notReportedSet, 'devices'),
    classes: classes,
    switches: switches,
    devicesList: ranked('devices'),
    peopleList: ranked('users')
  };
}
