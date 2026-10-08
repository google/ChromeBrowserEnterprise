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
    if (!parts && /(^|\s)--[a-z0-9]/i.test(s) && !/,/.test(s.replace(/=[^\s]*/g, ''))) {
      // A command line: the program path (if any) is not a switch
      parts = s.split(/\s+(?=--?[a-z0-9]|\/[a-z])/i).filter(p => /^(--?|\/)[a-z0-9]/i.test(p));
    }
    if (!parts) {
      parts = [];
      s.split(',').forEach((chunk, i) => {
        const startsSwitch = /^\s*-{0,2}[a-z0-9][a-z0-9._-]*(?:[=:]|\s*$)/.test(chunk);
        const current = parts[parts.length - 1];
        if (i > 0 && !(startsSwitch && (/^\s/.test(chunk) || current.indexOf('=') === -1))) parts[parts.length - 1] = current + ',' + chunk;
        else parts.push(chunk);
      });
    }
  }
  const out = [];
  parts.forEach(p => {
    const t = String(p).trim().replace(/^["']+|["']+$/g, '').trim().replace(/^-+/, '').replace(/^\/(?=[a-z])/i, '').trim();
    if (t && out.indexOf(t) === -1) out.push(t);
  });
  return out;
}

/**
 * CeraConfig.LAUNCH_SWITCH_CLASSES as lookup tables, built once: valued entries ('name=Value'), names, and prefixes.
 */
var _ceraLaunchSwitchTable_ = null;
function ceraLaunchSwitchTable_() {
  if (_ceraLaunchSwitchTable_) return _ceraLaunchSwitchTable_;
  const table = { valued: [], named: {}, prefixes: [] };
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
  const sep = t.search(/[=:]/);
  const name = (sep === -1 ? t : t.slice(0, sep)).trim().toLowerCase();
  const values = sep === -1 ? [] : t.slice(sep + 1).split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
  const table = ceraLaunchSwitchTable_();
  for (let i = 0; i < table.valued.length; i++) {
    const e = table.valued[i];
    if (e.name === name && values.indexOf(e.value) !== -1) return { cls: e.cls, label: e.label };
  }
  if (table.named[name]) return { cls: table.named[name], label: name };
  for (let i = 0; i < table.prefixes.length; i++) {
    if (name.indexOf(table.prefixes[i].prefix) === 0) return { cls: table.prefixes[i].cls, label: name };
  }
  return { cls: 'other', label: name || t };
}

/**
 * The fields of a launch row: time, device, profile user, device user and switches (null when the sheet has no switches
 * column). rec is the row normalized by ceraNormalizeRow_.
 */
function ceraLaunchRow_(row, col, rec) {
  const text = idx => (idx !== undefined && idx !== -1 && row[idx] !== null && row[idx] !== undefined ? String(row[idx]).trim() : '');
  return {
    t: rec.t,
    device: text(col.deviceName),
    user: rec.userIdent,
    deviceUser: text(col.deviceUser).toLowerCase(),
    switches: col.switches !== undefined && col.switches !== -1 ? ceraLaunchSwitches_(row[col.switches]) : null
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
  const identity = row.device ? 'd|' + row.device : (row.user ? 'u|' + row.user : (row.deviceUser ? 'w|' + row.deviceUser : ''));
  const key = identity + '\u0000' + (switches ? switches.join('\n') : '\u0001');
  let entry = store.keys.get(key);
  if (!entry) store.keys.set(key, entry = { device: row.device || '', switches: switches, rows: [] });
  entry.rows.push(typeof row.t === 'number' && !isNaN(row.t) ? row.t : NaN, nameId(row.user), nameId(row.deviceUser));
}

/** An empty tally of launches: how many, and the people and devices they came from (with launches that had none). */
function ceraLaunchSet_() {
  return { launches: 0, users: {}, devices: {}, noUser: 0, noDevice: 0 };
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
    notReportedSet: ceraLaunchSet_(), classes: {}, switches: {}
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
      ceraAggregateLaunch_(agg, { device: entry.device, users: users, switches: entry.switches });
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
  launch.users.forEach(u => { set.users[u] = (set.users[u] || 0) + 1; });
  if (!launch.users.length) set.noUser++;
  if (launch.device) set.devices[launch.device] = (set.devices[launch.device] || 0) + 1;
  else set.noDevice++;
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
  const labels = {};
  const classes = {};
  launch.switches.forEach(token => {
    const c = ceraLaunchSwitchClass_(token);
    labels[c.label] = c.cls;
    if (c.cls !== 'routine') classes[c.cls] = true;
  });
  Object.keys(labels).forEach(label => {
    const sw = agg.switches[label] || (agg.switches[label] = { launches: 0, cls: labels[label] });
    sw.launches++;
  });
  const list = Object.keys(classes);
  if (!list.length) {
    agg.routine++;
    ceraTallyLaunch_(agg.routineSet, launch);
    return;
  }
  ceraTallyLaunch_(agg.nonRoutine, launch);
  list.forEach(cls => ceraTallyLaunch_(agg.classes[cls] || (agg.classes[cls] = ceraLaunchSet_()), launch));
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
  const classes = Object.keys(b.classes || {}).filter(id => b.classes[id].launches > 0).map(id => ({
    id: id,
    launches: b.classes[id].launches,
    people: ceraLaunchCount_(b.classes[id], 'users'),
    devices: ceraLaunchCount_(b.classes[id], 'devices')
  })).sort((x, y) => y.launches - x.launches || rank(x.id) - rank(y.id));
  const switches = Object.keys(b.switches || {}).map(name => ({ name: name, cls: b.switches[name].cls, launches: b.switches[name].launches }))
    .sort((x, y) => y.launches - x.launches || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  const ranked = kind => Object.keys(b.all[kind]).map(name => ({ name: name, launches: b.all[kind][name], nonRoutine: b.nonRoutine[kind][name] || 0 }))
    .sort((x, y) => y.nonRoutine - x.nonRoutine || y.launches - x.launches || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  return {
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
