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
 * Module: EventDiscovery.gs
 * Description: Read-only diagnostic for developers. Lists which Chrome log events this tenant
 *              produces and which parameters they carry, so events that the Reports API reference
 *              does not document yet can be checked before CERA ingests them.
 *              Run it from the Apps Script editor and read the execution log.
 * ==============================================================================
 */

/**
 * Pages unfiltered Chrome activities of the last `days` days (at most 20 pages of 1,000) and logs, per event
 * name: the count, the event type, how often each parameter appears and, for events CERA does not ingest,
 * up to three sample parameter sets. Email addresses and home folder names in samples are masked.
 */
function ceraDiscoverChromeEvents(days) {
  const span = Math.min(180, Math.max(1, Number(days) || 30));
  const startTime = new Date(Date.now() - span * 86400000).toISOString();
  const ingested = {};
  TARGET_EVENTS.forEach(ev => { ingested[ev] = true; });
  const summary = {};
  let pageToken = null;
  let pages = 0;
  let activities = 0;
  do {
    const options = { startTime: startTime, maxResults: 1000 };
    if (pageToken) options.pageToken = pageToken;
    const page = AdminReports.Activities.list('all', 'chrome', options);
    (page.items || []).forEach(item => {
      activities++;
      (item.events || []).forEach(ev => {
        const entry = summary[ev.name] || (summary[ev.name] = { count: 0, type: ev.type || '', params: {}, samples: [] });
        entry.count++;
        (ev.parameters || []).forEach(p => { entry.params[p.name] = (entry.params[p.name] || 0) + 1; });
        if (!ingested[ev.name] && entry.samples.length < 3) {
          const sample = {};
          (ev.parameters || []).forEach(p => { sample[p.name] = _discoveryMask_(_discoveryValue_(p)); });
          entry.samples.push(sample);
        }
      });
    });
    pageToken = page.nextPageToken || null;
    pages++;
  } while (pageToken && pages < 20);

  const report = {
    days: span,
    activities: activities,
    pages: pages,
    truncated: !!pageToken,
    events: Object.keys(summary).sort((a, b) => summary[b].count - summary[a].count).map(name => ({
      name: name,
      ingestedByCera: !!ingested[name],
      count: summary[name].count,
      type: summary[name].type,
      params: summary[name].params,
      samples: summary[name].samples
    }))
  };
  console.log('[EventDiscovery] ' + JSON.stringify(report));
  return report;
}

function _discoveryValue_(p) {
  if (p.value !== undefined) return p.value;
  if (p.intValue !== undefined) return p.intValue;
  if (p.boolValue !== undefined) return p.boolValue;
  if (p.multiValue) return p.multiValue;
  if (p.messageValue) return p.messageValue;
  if (p.multiMessageValue) return p.multiMessageValue;
  return null;
}

/**
 * Masks the local part of email addresses and the user folder in home paths, at any depth of the value.
 */
function _discoveryMask_(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(_discoveryMask_);
  if (typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach(k => { out[k] = _discoveryMask_(value[k]); });
    return out;
  }
  if (typeof value !== 'string') return value;
  return value
    .replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@/g, '$1***@')
    .replace(/(\/Users\/|\/home\/|\\Users\\)[^\/\\\s"']+/g, '$1~');
}
