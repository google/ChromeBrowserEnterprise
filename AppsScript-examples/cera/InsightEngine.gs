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
 * Module: InsightEngine.gs
 * Description: Turns the aggregated state into the deck's story. It computes facts on the four
 *              data-transfer vectors, decides which vector slides have enough data (gates), writes each
 *              slide's headline from those facts (i18n templates deck.*), and derives recommendations
 *              only from findings that were actually observed. Nothing here invents a value: a fact
 *              that is missing produces a different template, never a default number.
 * ==============================================================================
 */

var INSIGHT_VECTORS = ['personal', 'shadowAi', 'unmanaged', 'messaging'];
// Outbound transfers without a recorded destination get a deck footnote from this share of outbound transfers
// or volume; below it they are disclosed in the workbook only
var CERA_UNKNOWN_NOTE_SHARE = 0.05;
// User concentration: the fewest people who account for volumeShare of the outbound data. Outbound data is
// "concentrated" when they are at most peopleShare of the people who sent data out, "distributed" otherwise. With
// maxSmall people or fewer that rule says little ("2 of 2 people account for 80%"): such a small group is described
// by its number of people and the largest share one of them sent.
var CERA_CONCENTRATION = { volumeShare: 0.8, peopleShare: 0.5, maxSmall: 3 };
// Intra-unit skew is measured only on units with at least minPeople people sending data out and minBytes of outbound
// data: in a unit of one or two people, one person's share is large by construction
var CERA_SKEW_RULE = { minPeople: 3, minBytes: 100 * 1024 * 1024 };
// Transfers to outside accounts are described by the larger account type (personal mailboxes or other
// organizations); the smaller one is mentioned when it is at least minorShare of them (33 of 739 is not)
var CERA_ACCOUNT_SPLIT = { minorShare: 0.1 };

var InsightEngine = {
  /**
   * @param {Object} state aggregated state from executeDlpAnalysis
   * @param {Object} om outlier metrics from computeOutlierAnalytics
   * @param {Object} opts { lang, dateRange, authorizedGenAi: string[], mode: the outcome mode of the whole report (ceraOutcomeMode) }
   */
  build(state, om, opts) {
    const o = opts || {};
    const lang = ceraNormalizeLang_(o.lang || 'en');
    const T = (key, params) => ceraT(key, params, lang);
    const B = bytes => formatBytes(Number(bytes) || 0);
    const pct = (part, whole) => whole > 0 ? Math.round((part / whole) * 100) : 0;
    const P = n => T('deck.people', { n: n });
    const st = state || {};
    const m = om || {};
    const gate = CeraConfig.VECTOR_GATE || { fullEvents: 50, fullUsers: 3, compactEvents: 10 };

    const egress = st.egress || { bytes: 0, count: 0, ous: {}, users: {} };
    const days = Number(m.calendarDays) || 0;
    // Outbound basis: bytes, or the number of transfers when none carried a size (prints and pastes can be logged
    // without one). Shares, rankings and amounts follow the basis, so sizeless transfers never read as 0 MB.
    const outboundBytes = Number(egress.bytes) || 0;
    const outboundCount = Number(egress.count) || 0;
    const byCount = outboundBytes <= 0 && outboundCount > 0;
    const sizeOf = e => (byCount ? Number(e && e.count) : Number(e && e.bytes)) || 0;
    const A = (bytes, count, countBasis) => (countBasis ? T('deck.transfers', { n: Number(count) || 0 }) : B(bytes));
    const vectors = {};
    INSIGHT_VECTORS.forEach(key => {
      const v = (st.vectors && st.vectors[key]) || {};
      const out = v.egress || { bytes: 0, count: 0 };
      // People with outbound transfers in this vector (downloads alone do not count), for the sub-line and the gate
      const users = ceraOutboundPeople(v);
      const topDestRaw = this._topBy(v.domains, 'egressBytes', 'egressCount');
      const topDest = topDestRaw ? Object.assign({}, topDestRaw, { name: ceraDestinationLabel(topDestRaw.name, lang) }) : null;
      const topType = ceraOutboundFormats(v, lang, 1)[0] || null;
      const outCount = Number(out.count) || 0;
      const vByCount = !(Number(out.bytes) > 0) && outCount > 0;
      let tier = 'row';
      if (outCount >= gate.fullEvents && users >= gate.fullUsers) tier = 'full';
      else if (outCount >= gate.compactEvents) tier = 'compact';
      const outFacts = ceraOutcomeFacts(out);
      // What reached the sites themselves: file uploads and pastes into a page, from the split by kind
      // (ceraSentToSite); a print sends nothing to the site it was printed from. A state without the split counts every
      // outbound transfer. Recommendations about sending data to a channel use this basis.
      const sentTotals = ceraSentToSite(out);
      let sent;
      if (sentTotals) {
        const perDest = {};
        Object.keys(v.domains || {}).forEach(d => { perDest[d] = ceraSentToSite(v.domains[d]) || {}; });
        const sentByCount = !(sentTotals.bytes > 0) && sentTotals.count > 0;
        sent = Object.assign({}, sentTotals, {
          byCount: sentByCount,
          mixText: ceraActionMixText(ceraSentMix(v, false), lang),
          leftMixText: ceraActionMixText(ceraSentMix(v, true), lang),
          dest: this._label(this._topBy(perDest, sentByCount ? 'count' : 'bytes', 'count'), lang),
          leftDest: this._label(this._topBy(perDest, sentByCount ? 'leftCount' : 'leftBytes', 'leftCount'), lang),
          sensitiveLeftDest: this._label(this._topBy(perDest, 'sensitiveLeft', 'sensitiveLeft'), lang)
        });
      } else {
        sent = {
          count: outCount, bytes: Number(out.bytes) || 0, leftCount: outFacts.left.count, leftBytes: outFacts.left.bytes, byCount: vByCount,
          sensitive: Number(out.sensitiveCount) || 0,
          sensitiveLeft: out.sensitiveLeft !== undefined ? Number(out.sensitiveLeft) || 0 : Number(out.sensitiveCount) || 0,
          mixText: ceraActionMixText(ceraActionMix(v, st), lang),
          leftMixText: ceraActionMixText(ceraActionMix(v, st, true), lang),
          dest: topDest ? topDest.name : '',
          leftDest: this._label(this._topBy(v.domains, vByCount ? 'egressLeftCount' : 'egressLeftBytes', 'egressLeftCount'), lang),
          sensitiveLeftDest: this._label(this._topBy(v.domains, 'egressSensitiveLeft', 'egressSensitiveLeft'), lang)
        };
      }
      vectors[key] = {
        key: key,
        name: T('deck.vector.' + key),
        bytes: Number(out.bytes) || 0,
        count: outCount,
        byCount: vByCount,
        // What left and what was stopped of this vector's outbound transfers (ceraOutcomeFacts), the sensitive ones
        // that left, and where most of what left went (the destination with the most that left, and with the most
        // sensitive transfers that left)
        out: outFacts,
        // The same on the transfers that reached the sites (file uploads and pastes into a page)
        sent: sent,
        sensitive: Number(out.sensitiveCount) || 0,
        sensitiveLeft: out.sensitiveLeft !== undefined ? Number(out.sensitiveLeft) || 0 : Number(out.sensitiveCount) || 0,
        leftDest: this._label(this._topBy(v.domains, vByCount ? 'egressLeftCount' : 'egressLeftBytes', 'egressLeftCount'), lang),
        sensitiveLeftDest: this._label(this._topBy(v.domains, 'egressSensitiveLeft', 'egressSensitiveLeft'), lang),
        leftMixText: ceraActionMixText(ceraActionMix(v, st, true), lang),
        users: users,
        // Destinations that received at least one of its outbound transfers, the count both of its slides give
        destinations: ceraOutboundDestinations(v).length,
        topDest: topDest,
        topType: topType,
        // Most notable match among the detectors of this vector's outbound transfers only (never its downloads)
        topDetector: this._topDetector(ceraOutboundDetectors(v).names),
        // Outbound transfers by action type, as measured: uploads, pastes, prints
        mixText: ceraActionMixText(ceraActionMix(v, st), lang),
        tier: tier
      };
    });
    // Outbound transfers to outside accounts: another organization's accounts vs personal mailboxes; for the
    // recommendation, the same of the transfers that reached the sites (file uploads and pastes) when ingestion split them
    vectors.personal.split = ceraAccountSplit((st.vectors && st.vectors.personal) || {}, st);
    vectors.personal.sentSplit = ceraSentAccountSplit((st.vectors && st.vectors.personal) || {}) || vectors.personal.split;

    const ranked = INSIGHT_VECTORS.map(k => vectors[k]).sort((a, b) => b.bytes - a.bytes || b.count - a.count);
    const lead = ranked[0];
    const users = Object.keys(egress.users || {}).map(u => sizeOf(egress.users[u])).sort((a, b) => b - a);
    const ous = Object.keys(egress.ous || {}).map(k => {
      const e = egress.ous[k];
      const count = Number(e.count) || 0;
      const bytes = Number(e.bytes) || 0;
      return { name: k, bytes: bytes, count: count, size: sizeOf(e),
        leftBytes: e.leftCount !== undefined ? Number(e.leftBytes) || 0 : bytes, leftCount: e.leftCount !== undefined ? Number(e.leftCount) || 0 : count };
    }).filter(x => validOuName_(x.name)).sort((a, b) => b.size - a.size || b.count - a.count);
    const ai = (st.genAiBenchmark) || { sanctioned: { bytes: 0, count: 0 }, shadow: { bytes: 0, count: 0 } };
    // Sanctioned tools used from personal accounts: counted in the AI total, but neither sanctioned nor other tools
    const aiPersonalCount = Number(ai.personalSanctioned && ai.personalSanctioned.count) || 0;
    const aiTotal = (Number(ai.sanctioned && ai.sanctioned.count) || 0) + (Number(ai.shadow && ai.shadow.count) || 0) + aiPersonalCount;
    const radar = st.securityRadar || {};
    const unsafe = radar.unsafeSiteVisit || { total: 0, domains: {} };
    const unsafeInternal = Object.keys(unsafe.domains || {}).filter(d => isInternalHost(d)).reduce((s, d) => s + (unsafe.domains[d] || 0), 0);
    // Outcomes of the Safe Browsing visits (Event Result column); bypasses are known only for visits that reported one
    const unsafeOutcomes = (st.vectors && st.vectors.securityRadar && st.vectors.securityRadar.signals && st.vectors.securityRadar.signals.unsafeSiteVisit) || {};
    const pw = radar.passwordReuse || { total: 0, users: {} };
    const mal = radar.malwareTransfer || { total: 0, users: {} };
    const prints = st.printStats || { totalEvents: 0, sensitivity: { sensitiveCount: 0 } };
    const onPage = st.sensitiveOnPage || { count: 0, detectors: {} };
    const onPageOut = ceraOutcomeFacts(onPage).outcomes;
    const countOf = (o, k) => Number(o[k] && o[k].count) || 0;
    // Flagged downloads per event and outcome (ceraAggregateRadarEvent_): the ones that got through were not blocked,
    // cancelled or stopped at a heeded warning
    const malSig = (st.vectors && st.vectors.securityRadar && st.vectors.securityRadar.signals && st.vectors.securityRadar.signals.malwareTransfer) || {};
    const malStopped = (Number(malSig.blocked) || 0) + (Number(malSig.cancelled) || 0) + (Number(malSig.warned) || 0);

    // Outcome mode of the logs (ceraOutcomeMode) and the outcome split of all outbound transfers, prints and AI use
    const mode = o.mode || ceraOutcomeMode(st);
    const aiBuckets = ['sanctioned', 'shadow', 'personalSanctioned'].map(b => ai[b] || {});
    const facts = {
      lang: lang,
      mode: mode,
      enforced: mode === 'enforced',
      out: ceraOutcomeFacts(egress),
      printOut: ceraOutcomeFacts(prints),
      printSensitiveOut: ceraOutcomeFacts(prints.sensitivity),
      // True when a policy stopped some AI transfers: shares of AI transfers are then shares of what was attempted
      aiStopped: mode === 'enforced' && aiBuckets.some(b => b.leftCount !== undefined && (Number(b.leftCount) || 0) < (Number(b.count) || 0)),
      outboundBytes: outboundBytes,
      outboundCount: outboundCount,
      byCount: byCount,
      sensitiveOutbound: Number(egress.sensitiveCount) || 0,
      afterHoursCount: Number(egress.afterHoursCount) || 0,
      people: users.length,
      days: days,
      vectors: vectors,
      ranked: ranked,
      topPersonShare: users.length ? pct(users[0], byCount ? outboundCount : outboundBytes) : 0,
      topOu: ous[0] || null,
      ouCount: ous.length,
      aiShadowCount: Number(ai.shadow && ai.shadow.count) || 0,
      aiSanctionedCount: Number(ai.sanctioned && ai.sanctioned.count) || 0,
      aiPersonalCount: aiPersonalCount,
      aiTotal: aiTotal,
      // Busiest outbound day against the mean active day, and whether it qualifies as a peak (ceraPeakStats)
      peak: m.egressPeak || ceraPeakStats({}),
      unsafeTotal: Number(unsafe.total) || 0,
      unsafeInternal: unsafeInternal,
      unsafeBypassed: Number(unsafeOutcomes.bypassed) || 0,
      unsafeBlocked: Number(unsafeOutcomes.blocked) || 0,
      unsafeResultReported: (Number(unsafeOutcomes.total) || 0) - (Number(unsafeOutcomes.unreported) || 0) > 0,
      pwTotal: Number(pw.total) || 0,
      pwUsers: Object.keys(pw.users || {}).length,
      malTotal: Number(mal.total) || 0,
      malUsers: Object.keys(mal.users || {}).length,
      printTotal: Number(prints.totalEvents) || 0,
      printSensitive: Number(prints.sensitivity && prints.sensitivity.sensitiveCount) || 0,
      onPageCount: Number(onPage.count) || 0,
      onPageDetector: this._topDetector(onPage.detectors),
      // Data shown on pages: masked, unmasked (the user revealed it, with the host most of it was revealed on)
      onPageMasked: countOf(onPageOut, 'masked'),
      onPageUnmasked: countOf(onPageOut, 'unmasked'),
      unmaskHost: this._label(this._topBy(this._counts(onPage.unmaskHosts), 'n', 'n'), lang),
      // Sensitive print jobs that printed, and the site most of them came from
      printSensitiveLeftOrigin: this._label(this._topBy(this._counts(prints.sensitivity && prints.sensitivity.leftOrigins), 'n', 'n'), lang),
      malStopped: malStopped,
      malBypassed: Number(malSig.bypassed) || 0,
      // Safe Browsing warnings shown (heeded or clicked through) and the host with the most click-throughs
      unsafeShown: (Number(unsafeOutcomes.warned) || 0) + (Number(unsafeOutcomes.bypassed) || 0),
      unsafeBypassHost: this._label(this._topBy(unsafeOutcomes.domains, 'bypassed', 'bypassed'), lang),
      sanctionedAi: (o.authorizedGenAi || []).filter(Boolean).slice(0, 2).join(', ')
    };

    facts.printPeople = Object.keys(prints.users || {}).length;
    // Browser launches with command-line switches, folded and classed (ceraLaunchFacts); null when the logs hold none
    facts.launches = ceraLaunchFacts(st);
    // Outbound transfers with no recorded destination are outside the four vectors (state.unknownDestinations)
    const unknownDest = st.unknownDestinations || {};
    facts.unknownOutCount = Number(unknownDest.egressCount) || 0;
    const unknownOutBytes = Number(unknownDest.egressBytes) || 0;
    facts.unknownNotable = facts.unknownOutCount > 0 && (
      facts.unknownOutCount / (facts.unknownOutCount + outboundCount) >= CERA_UNKNOWN_NOTE_SHARE ||
      (unknownOutBytes > 0 && unknownOutBytes / (unknownOutBytes + outboundBytes) >= CERA_UNKNOWN_NOTE_SHARE));
    const headlines = this._headlines(facts, T, A, pct, o.dateRange || '', P);
    const recs = this._recommendations(facts, T, A, pct);
    // recByTopic: the same texts by finding (shadowAi, personal, unmanaged, messaging, print, malware, password,
    // certs, safeBrowsing, onPage, launches), so a slide can quote the action that the recommendations slide lists for it
    const recByTopic = {};
    recs.forEach(r => { (recByTopic[r.topic] = recByTopic[r.topic] || []).push(r.text); });
    return { facts: facts, tiers: this._tiers(vectors), headlines: headlines, recommendations: recs.map(r => r.text), recByTopic: recByTopic, lang: lang };
  },

  _tiers(vectors) {
    const t = {};
    INSIGHT_VECTORS.forEach(k => { t[k] = vectors[k].tier; });
    return t;
  },

  /**
   * A(bytes, count, countBasis) renders an outbound amount: a size, or a number of transfers on the count basis.
   */
  _headlines(f, T, A, pct, range, P) {
    const h = {};
    const lead = f.ranked[0];
    const hasOutbound = f.outboundBytes > 0 || f.outboundCount > 0;
    const outboundTotal = f.byCount ? f.outboundCount : f.outboundBytes;
    const sizeOf = e => (f.byCount ? e.count : e.bytes);

    // What left and what a policy stopped, when the logs show policies enforcing (ceraOutcomeMode); otherwise every
    // outbound transfer is what left, as the logs show it
    const out = f.out;
    if (!hasOutbound) {
      h.cover = T('deck.cover.hlNone', { days: f.days });
    } else if (f.enforced && out.stopped.count > 0 && out.left.count === 0) {
      h.cover = T('deck.cover.hlAllStopped', { n: f.outboundCount, days: f.days });
    } else if (f.enforced && out.blocked.count > 0) {
      h.cover = !f.byCount && out.blocked.bytes > 0
        ? T('deck.cover.hlOutcome', { left: A(out.left.bytes, out.left.count, false), blocked: A(out.blocked.bytes, out.blocked.count, false), days: f.days })
        : T('deck.cover.hlOutcomeCount', { left: A(out.left.bytes, out.left.count, f.byCount), n: out.blocked.count, days: f.days });
    } else if (f.enforced && out.stopped.count > 0) {
      h.cover = !f.byCount && out.stopped.bytes > 0
        ? T('deck.cover.hlStopped', { left: A(out.left.bytes, out.left.count, false), stopped: A(out.stopped.bytes, out.stopped.count, false), days: f.days })
        : T('deck.cover.hlStoppedCount', { left: A(out.left.bytes, out.left.count, f.byCount), n: out.stopped.count, days: f.days });
    } else {
      h.cover = T('deck.cover.hl', { bytes: A(f.outboundBytes, f.outboundCount, f.byCount), days: f.days, pct: pct(f.sensitiveOutbound, f.outboundCount) });
    }
    // The cover's note on outcomes: what was stopped (enforced), that nothing was (audit), or that the logs carry none
    if (f.mode === 'enforced') {
      h.coverNote = !hasOutbound ? '' : (out.stopped.count > 0
        ? T('deck.cover.noteEnforced', { n: f.outboundCount, left: out.left.count, list: ceraOutcomeListText(out.outcomes, CeraConfig.OUTCOME_STOPPED, f.lang) })
        : T('deck.cover.noteEnforcedNone', { n: f.outboundCount }));
    } else {
      h.coverNote = T(f.mode === 'audit' ? 'deck.cover.noteAudit' : 'deck.cover.noteNotReported');
    }

    if (!(hasOutbound && sizeOf(lead) > 0)) {
      h.s2 = T('deck.s2.hlNone');
    } else if (f.enforced && lead.out.stopped.count > 0) {
      // The largest channel was partly stopped: what of it left and what was stopped
      h.s2 = T('deck.s2.hlOutcome', { vector: lead.name, pct: pct(sizeOf(lead), outboundTotal), bytes: A(lead.bytes, lead.count, f.byCount),
        left: A(lead.out.left.bytes, lead.out.left.count, f.byCount), stopped: A(lead.out.stopped.bytes, lead.out.stopped.count, f.byCount) });
    } else {
      h.s2 = T(lead.topDest ? 'deck.s2.hl' : 'deck.s2.hlNoDest', { vector: lead.name, pct: pct(sizeOf(lead), outboundTotal), bytes: A(lead.bytes, lead.count, f.byCount), dest: lead.topDest ? lead.topDest.name : '' });
    }
    h.s2sub = T('deck.s2.sub', { range: range });
    // Footnote under the channel totals; empty (no text box) when the share is small
    h.s2note = f.unknownNotable ? T('deck.s2.noteUnknown', { n: f.unknownOutCount }) : '';

    // A person or a day is only said to dominate on a measured basis, and "spread evenly" needs both measured:
    // at least two identified people and enough active days for the peak rule (CERA_PEAK_RULE)
    const pk = f.peak;
    if (!hasOutbound) {
      h.s3 = T('deck.s2.hlNone');
    } else if (f.people >= 2 && f.topPersonShare >= 50) {
      h.s3 = T(f.byCount ? 'deck.s3.hlConcentrationCount' : 'deck.s3.hlConcentration', { n: f.people, pct: f.topPersonShare });
    } else if (pk.isPeak) {
      h.s3 = T('deck.s3.hlPeak', { date: formatDisplayDate(pk.peakKey, true, f.lang), amount: A(pk.peakBytes, pk.peakCount, pk.basis === 'count'), multiple: pk.multiple.toFixed(1) });
    } else if (f.people === 1) {
      h.s3 = T('deck.s3.hlOnePerson');
    } else if (pk.activeDays < CERA_PEAK_RULE.minActiveDays) {
      h.s3 = T('deck.s3.hlFewDays', { n: pk.activeDays });
    } else if (f.people >= 2) {
      h.s3 = T('deck.s3.hlSteady');
    } else {
      h.s3 = T('deck.s3.hlNoPeak', { n: pk.activeDays });
    }
    h.s3sub = f.outboundCount > 0 ? T('deck.s3.sub', { pct: pct(f.afterHoursCount, f.outboundCount) }) : T('deck.s3.subNone');

    // Transfers whose unit was not in the logs are a bucket, not a unit: the headline says so instead of naming it
    if (f.topOu && f.topOu.name === T('report.ou.notReported')) h.s4 = T('deck.s4.hlNoOu', { bytes: A(f.topOu.bytes, f.topOu.count, f.byCount), pct: pct(sizeOf(f.topOu), outboundTotal) });
    else if (f.topOu && f.ouCount >= 2 && f.enforced && f.topOu.leftCount < f.topOu.count) {
      h.s4 = T('deck.s4.hlOutcome', { ou: f.topOu.name, bytes: A(f.topOu.bytes, f.topOu.count, f.byCount), pct: pct(sizeOf(f.topOu), outboundTotal),
        left: A(f.topOu.leftBytes, f.topOu.leftCount, f.byCount) });
    } else if (f.topOu && f.ouCount >= 2) h.s4 = T('deck.s4.hl', { ou: f.topOu.name, bytes: A(f.topOu.bytes, f.topOu.count, f.byCount), pct: pct(sizeOf(f.topOu), outboundTotal) });
    else if (f.topOu) h.s4 = T('deck.s4.hlSingle', { ou: f.topOu.name });
    else h.s4 = T('deck.s2.hlNone');
    h.s4sub = T('deck.s4.sub');

    INSIGHT_VECTORS.forEach(k => {
      const v = f.vectors[k];
      const dest = v.topDest ? v.topDest.name : '';
      const amount = A(v.bytes, v.count, v.byCount);
      if (v.count === 0) {
        h[k] = T('deck.v.hlNone', { vector: v.name });
      } else if (f.enforced && v.out.stopped.count > 0 && v.out.left.count === 0) {
        // Every outbound transfer of the channel was stopped
        h[k] = T('deck.v.hlOutcomeAll', { vector: v.name, n: v.count, list: ceraOutcomeListText(v.out.outcomes, CeraConfig.OUTCOME_STOPPED, f.lang) });
      } else if (f.enforced && v.out.stopped.count > 0) {
        // Partly stopped: what left of what was sent, and how many transfers were stopped
        h[k] = T('deck.v.hlOutcome', { vector: v.name, left: A(v.out.left.bytes, v.out.left.count, v.byCount), bytes: amount, n: v.out.stopped.count, total: v.count });
      } else if (k === 'personal' && v.split && v.split.otherOrg.min > 0) {
        // Only outbound transfers that certainly went to an account type are claimed: the exact number, or a lower
        // bound when the log does not split the vector's downloads by account type. The larger type leads.
        h[k] = ceraAccountSplitHeadline(v.split, v.count, f.lang);
      } else if (k === 'shadowAi' && v.sensitive > 0) {
        h[k] = T('deck.shadowAi.hlSensitive', { bytes: amount, pct: pct(v.sensitive, v.count) });
      } else {
        h[k] = T(dest ? 'deck.v.hl' : 'deck.v.hlNoDest', { vector: v.name, bytes: amount, dest: dest, n: v.destinations });
      }
      h[k + 'Sub'] = T(v.topDetector ? 'deck.v.subDetector' : 'deck.v.sub', { n: v.count, people: P(v.users), detector: v.topDetector || '' });
      if (k === 'shadowAi' && f.aiTotal > 0) {
        // Shares of what users sent to AI tools; sanctioned tools used from non-corporate accounts fold into the
        // other-tools share so the two-part percentage bar adds up to 100%, with the detail explained below the bar
        const tail = f.aiStopped ? 'Targeted' : '';
        const sPct = pct(f.aiSanctionedCount, f.aiTotal);
        h[k + 'Deep'] = T('deck.shadowAi.hlBenchmark' + tail, { pct: sPct, other: 100 - sPct });
      } else if (v.topType) {
        h[k + 'Deep'] = T('deck.v.hlType', { vector: v.name, type: v.topType.name, pct: v.byCount ? pct(v.topType.count, v.count) : pct(v.topType.bytes, v.bytes) });
      } else {
        h[k + 'Deep'] = h[k];
      }
    });

    // Safe Browsing per event (a warning and the bypass logged after it are one event): warnings shown (heeded or
    // clicked through) and click-throughs among them, blocks, detections without a warning. Without an Event Result in
    // the logs the number of bypasses is unknown, never 0.
    const sb = { n: f.unsafeTotal, internal: f.unsafeInternal, shown: f.unsafeShown, bypassed: f.unsafeBypassed, blocked: f.unsafeBlocked, rate: pct(f.unsafeBypassed, f.unsafeShown) };
    if (f.unsafeTotal <= 0) h.signals = T('deck.signals.hlNone');
    else if (!f.unsafeResultReported) h.signals = T('deck.signals.hlBypassUnknown', sb);
    else if (f.unsafeShown > 0) h.signals = T(f.unsafeShown === f.unsafeTotal ? 'deck.signals.hlWarnings' : 'deck.signals.hlEvents', sb);
    else if (f.unsafeBlocked > 0) h.signals = T('deck.signals.hlBlocked', sb);
    else h.signals = T('deck.signals.hlDetected', sb);
    h.signals2 = (f.pwTotal + f.malTotal) > 0
      ? T('deck.signals2.hl', { pw: f.pwTotal, pwPeople: P(f.pwUsers), mal: f.malTotal, malPeople: P(f.malUsers) })
      : T('deck.signals2.hlNone');
    h.signalsSub = T('deck.signals.sub');
    h.signals2Sub = T('deck.signals2.sub');
    h.printingSub = T('deck.printing.sub', { n: f.printTotal, people: P(f.printPeople) });
    // Sensitive print jobs a policy stopped: all of them blocked, all stopped, or some stopped
    const ps = f.printSensitiveOut;
    const printParams = { pct: pct(f.printSensitive, f.printTotal), sensitive: f.printSensitive, n: f.printTotal };
    if (f.printTotal <= 0) h.printing = T('deck.printing.hlNone');
    else if (f.enforced && f.printSensitive > 0 && ps.stopped.count === f.printSensitive) {
      h.printing = T(ps.blocked.count === f.printSensitive ? 'deck.printing.hlAllBlocked' : 'deck.printing.hlAllStopped',
        Object.assign({}, printParams, { total: f.printTotal, n: f.printSensitive }));
    } else if (f.enforced && ps.stopped.count > 0) {
      h.printing = T('deck.printing.hlSomeStopped', Object.assign({}, printParams, { total: f.printTotal, n: ps.stopped.count }));
    } else h.printing = T('deck.printing.hl', printParams);

    // Browser launches: a slide when some used switches other than Chrome's own startup switches (its headline counts
    // them among all launches); otherwise one neutral sentence, on the last Security Radar slide. Chrome logs its own
    // startup switches under this event as well, so a launch is never called anything but what its switches allow.
    const lf = f.launches;
    h.launches = '';
    h.launchesSub = '';
    h.launchNote = '';
    if (lf && lf.nonRoutine > 0) {
      h.launches = lf.nonRoutine === lf.launches ? T('deck.launch.hlAll', { n: lf.nonRoutine }) : T('deck.launch.hl', { n: lf.nonRoutine, total: lf.launches });
      h.launchesSub = T('deck.launch.sub');
    } else if (lf && lf.notReported === lf.launches) {
      h.launchNote = T('deck.launch.noteNotReported', { n: lf.launches });
    } else if (lf && lf.notReported > 0) {
      h.launchNote = T('deck.launch.noteMixed', { n: lf.launches, routine: lf.routine, nr: lf.notReported });
    } else if (lf) {
      h.launchNote = T('deck.launch.noteRoutine', { n: lf.launches });
    }
    return h;
  },

  /**
   * Recommendations exist only for findings that were observed. Each maps the finding to the control that
   * would enforce on it; impact orders them (sensitive data first, then volume, then hygiene).
   */
  _recommendations(f, T, A, pct) {
    const recs = [];
    const add = (impact, key, params, topic) => recs.push({ impact: impact, text: T(key, params), topic: topic });
    const ai = f.vectors.shadowAi;
    const personal = f.vectors.personal;
    const unmanaged = f.vectors.unmanaged;
    const messaging = f.vectors.messaging;
    // A finding a policy already stopped in full gets no recommendation; one it stopped in part gets the control
    // where the data still got through, named by where it went (enforced logs only, ceraOutcomeMode). In audit and
    // not-reported logs every finding maps to the control that would act on it.
    const en = f.enforced;
    const stoppedAll = v => en && v.count > 0 && v.out.left.count === 0;
    // A recommendation about sending data to a channel counts what reached its sites: file uploads and pastes into a
    // page (v.sent), never a print of one of its pages, which sends nothing there
    const sentPartly = s => en && s.leftCount < s.count;
    const sentStoppedAll = s => en && s.count > 0 && s.leftCount === 0;

    const aiSent = ai.sent;
    if (aiSent.sensitive > 0 && !(en && aiSent.sensitiveLeft === 0)) {
      if (en && aiSent.sensitiveLeft < aiSent.sensitive) add(1000 + aiSent.sensitiveLeft, 'deck.rec.aiSensitiveLeft', { n: aiSent.sensitiveLeft, dest: aiSent.sensitiveLeftDest || aiSent.leftDest }, 'shadowAi');
      else add(1000 + aiSent.sensitive, 'deck.rec.aiSensitive', { n: aiSent.sensitive, dest: aiSent.dest }, 'shadowAi');
    }
    // AI use is steered while transfers to other tools still get through; the shares are of what users sent
    const aiOtherPct = f.aiTotal > 0 ? (100 - pct(f.aiSanctionedCount, f.aiTotal)) : 0;
    if (f.aiTotal > 0 && f.aiShadowCount > 0 && aiOtherPct >= 25 && !stoppedAll(ai)) {
      const tail = f.aiStopped ? 'Targeted' : '';
      add(600 + aiOtherPct, (f.sanctionedAi ? 'deck.rec.aiSteer' : 'deck.rec.aiSteerNoList') + tail, { pct: aiOtherPct, sanctioned: f.sanctionedAi }, 'shadowAi');
    }
    // Data shown on pages: watermarking and copy limits for matches no policy masked; a review of the unmask events
    const onPageOpen = en ? Math.max(0, f.onPageCount - f.onPageMasked - f.onPageUnmasked) : f.onPageCount;
    if (onPageOpen > 0) add(900 + Math.min(onPageOpen, 99), f.onPageDetector ? 'deck.rec.onPage' : 'deck.rec.onPageNoDetector', { n: onPageOpen, detector: f.onPageDetector || '' }, 'onPage');
    if (f.onPageUnmasked > 0) add(850 + Math.min(f.onPageUnmasked, 49), f.unmaskHost ? 'deck.rec.unmask' : 'deck.rec.unmaskNoHost', { n: f.onPageUnmasked, host: f.unmaskHost }, 'onPage');
    const ps = personal.sent;
    if (ps.count > 0 && !sentStoppedAll(ps)) {
      if (sentPartly(ps)) {
        add(700 + ps.sensitiveLeft, 'deck.rec.personalLeft', { mix: ps.leftMixText, dest: ps.leftDest }, 'personal');
      } else {
        // Where the transfers went once another organization is among them, named by the larger account type
        const s = personal.sentSplit;
        const lead = s && s.otherOrg.min > 0 ? ceraAccountSplitLead(s) : '';
        const split = lead ? T('deck.split.' + (lead === 'consumer' ? 'consumer' : 'other') + (s.exact ? 'Exact' : 'Min'), { n: s[lead].min }) : '';
        add(700 + ps.sensitive, split ? 'deck.rec.personalSplit' : 'deck.rec.personal', { mix: ps.mixText, split: split }, 'personal');
      }
    }
    const us = unmanaged.sent;
    if (us.count > 0 && us.dest && !sentStoppedAll(us)) {
      if (sentPartly(us)) add(500 + us.sensitiveLeft, 'deck.rec.unmanagedLeft', { dest: us.leftDest, bytes: A(us.leftBytes, us.leftCount, us.byCount) }, 'unmanaged');
      else add(500 + us.sensitive, 'deck.rec.unmanaged', { dest: us.dest, bytes: A(us.bytes, us.count, us.byCount) }, 'unmanaged');
    }
    // Named by the action types measured (file uploads, pastes), never assumed to be file sharing
    const ms = messaging.sent;
    if (ms.count > 0 && !sentStoppedAll(ms)) {
      if (sentPartly(ms)) add(400 + ms.sensitiveLeft, 'deck.rec.messagingLeft', { mix: ms.leftMixText, dest: ms.leftDest }, 'messaging');
      else add(400 + ms.sensitive, 'deck.rec.messaging', { mix: ms.mixText }, 'messaging');
    }
    const printLeft = f.printSensitiveOut.left.count;
    if (f.printSensitive > 0 && !(en && printLeft === 0)) {
      if (en && printLeft < f.printSensitive) add(450 + printLeft, f.printSensitiveLeftOrigin ? 'deck.rec.printLeft' : 'deck.rec.print', { n: printLeft, host: f.printSensitiveLeftOrigin }, 'print');
      else add(450 + f.printSensitive, 'deck.rec.print', { n: f.printSensitive }, 'print');
    }
    const malLeft = f.malTotal - f.malStopped;
    if (f.malTotal > 0 && !(en && malLeft === 0)) {
      if (en && f.malStopped > 0) add(350, 'deck.rec.malwareLeft', { n: malLeft, total: f.malTotal }, 'malware');
      else add(350, 'deck.rec.malware', { n: f.malTotal }, 'malware');
    }
    if (f.unsafeBypassed > 0) {
      add(340, f.unsafeBypassHost ? 'deck.rec.safeBrowsingRate' : 'deck.rec.safeBrowsing',
        f.unsafeBypassHost ? { n: f.unsafeShown, bypassed: f.unsafeBypassed, rate: pct(f.unsafeBypassed, f.unsafeShown), host: f.unsafeBypassHost } : { n: f.unsafeBypassed }, 'safeBrowsing');
    }
    if (f.unsafeInternal > 0) add(200, 'deck.rec.certs', { n: f.unsafeInternal }, 'certs');
    if (f.pwTotal > 0) add(300, 'deck.rec.password', { n: f.pwTotal }, 'password');
    // Browser launches: the Chrome Enterprise Core policy that acts on each class of switches present. Launches with
    // Chrome's own startup switches or other switches only call for none.
    const lf = f.launches;
    if (lf) {
      const launchesOf = id => (lf.classes.find(c => c.id === id) || { launches: 0 }).launches;
      const devTools = (lf.switches.find(s => s.name === 'auto-open-devtools-for-tabs') || { launches: 0 }).launches;
      if (launchesOf('protectionsOff') > 0) add(330, 'deck.rec.launchProtections', { n: launchesOf('protectionsOff') }, 'launches');
      if (launchesOf('automation') > 0) add(325, 'deck.rec.launchAutomation', { n: launchesOf('automation') }, 'launches');
      if (devTools > 0) add(322, 'deck.rec.launchDevTools', { n: devTools }, 'launches');
      if (launchesOf('extensionsFromDisk') > 0) add(320, 'deck.rec.launchExtensions', { n: launchesOf('extensionsFromDisk') }, 'launches');
    }
    recs.sort((a, b) => b.impact - a.impact);
    return recs;
  },

  /** Display label of a _topBy pick, or '' without one. */
  _label(top, lang) {
    return top ? ceraDestinationLabel(top.name, lang) : '';
  },

  /** A map of counts (name -> n) as entries _topBy can rank: name -> { n }. */
  _counts(map) {
    const out = {};
    Object.keys(map || {}).forEach(k => { out[k] = { n: Number(map[k]) || 0 }; });
    return out;
  },

  _topBy(map, bytesKey, countKey) {
    let top = null;
    Object.keys(map || {}).forEach(k => {
      const e = map[k];
      if (!e || typeof e !== 'object' || !validOuName_(k)) return;
      const bytes = Number(e[bytesKey]) || 0;
      const count = Number(e[countKey]) || 0;
      if (bytes <= 0 && count <= 0) return;
      if (!top || bytes > top.bytes || (bytes === top.bytes && count > top.count)) top = { name: k, bytes: bytes, count: count };
    });
    return top;
  },

  /**
   * The detector an executive should hear about: identity, financial and government identifiers first
   * (national IDs, card numbers, passports), then the most frequent of the rest. Rule ids are skipped.
   */
  _topDetector(map) {
    const HIGH = /NIK|NATIONAL|MY ?NUMBER|CCCD|SSN|SOCIAL SECURITY|PASSPORT|CREDIT|CARD|IBAN|BANK|TAX|DRIVER/i;
    let best = null;
    let bestHigh = null;
    Object.keys(map || {}).forEach(k => {
      if (!k || /^policies\//.test(k) || /^(OTHER|UNKNOWN)$/i.test(k)) return;
      if (!best || map[k] > map[best]) best = k;
      if (HIGH.test(k) && (!bestHigh || map[k] > map[bestHigh])) bestHigh = k;
    });
    const pick = bestHigh || best;
    return pick ? ceraDetectorLabel(pick) : '';
  }
};

/**
 * Outcome mode of a run (state.outcomes): 'enforced' when the logs show a policy enforcing, 'audit' when they report
 * results but only detections, 'not_reported' when no row carries a result. The deck says what left and what was
 * stopped only in 'enforced' mode, says that nothing was stopped in 'audit' mode, and makes no outcome claim otherwise.
 */
function ceraOutcomeMode(state) {
  const o = (state && state.outcomes) || {};
  if (o.mode === 'enforced' || o.mode === 'audit' || o.mode === 'not_reported') return o.mode;
  return o.enforced ? 'enforced' : (o.reported ? 'audit' : 'not_reported');
}

/**
 * Policy-outcome split of an aggregate (ceraRecordOutcome_): { left, stopped: { bytes, count }, outcomes:
 * class -> { bytes, count }, blocked: { bytes, count } }. An aggregate without a split (row counting) left in full.
 */
function ceraOutcomeFacts(holder) {
  const h = holder || {};
  const pair = e => ({ bytes: Number(e && e.bytes) || 0, count: Number(e && e.count) || 0 });
  if (!h.left || !h.stopped) {
    const all = pair(h);
    return { left: all, stopped: { bytes: 0, count: 0 }, outcomes: all.count ? { notReported: all } : {}, blocked: { bytes: 0, count: 0 } };
  }
  const outcomes = {};
  Object.keys(h.outcomes || {}).forEach(k => { outcomes[k] = pair(h.outcomes[k]); });
  return { left: pair(h.left), stopped: pair(h.stopped), outcomes: outcomes, blocked: outcomes.blocked || { bytes: 0, count: 0 } };
}

/**
 * "163 blocked, 2 cancelled by the user and 10 stopped at a warning": the outcome classes of a split with a count, in
 * CeraConfig.OUTCOME_PRECEDENCE order (only the classes listed in `classes`, all of them when omitted), in the report
 * language (deck.oc.*).
 */
function ceraOutcomeListText(outcomes, classes, lang) {
  const o = outcomes || {};
  const parts = CeraConfig.OUTCOME_PRECEDENCE
    .filter(c => (!classes || classes.indexOf(c) !== -1) && o[c] && (Number(o[c].count !== undefined ? o[c].count : o[c]) || 0) > 0)
    .map(c => ceraT('deck.oc.' + c, { n: Number(o[c].count !== undefined ? o[c].count : o[c]) || 0 }, lang));
  return ceraJoinList(parts, lang);
}

/**
 * One sentence on the busiest outbound day, from ceraPeakStats over outliers.dailyEgress: a peak when
 * CERA_PEAK_RULE holds, otherwise the busiest day, or why no day can be called a peak. Used by the outlier
 * slide and the workbook so both say the same thing as the deck headline.
 */
function ceraPeakSentence(peak, lang) {
  const p = peak || {};
  const T = (key, params) => ceraT(key, params, lang);
  if (!p.basis) return T('deck.peak.none');
  const params = {
    date: formatDisplayDate(p.peakKey, true, lang),
    amount: p.basis === 'count' ? T('deck.transfers', { n: p.peakCount }) : formatBytes(p.peakBytes),
    multiple: (Number(p.multiple) || 0).toFixed(1),
    n: p.activeDays
  };
  if (p.isPeak) return T('deck.peak.peak', params);
  if (p.activeDays < CERA_PEAK_RULE.minActiveDays) return T('deck.peak.fewDays', params);
  return T('deck.peak.busiest', params);
}

/**
 * Detector names of a vector's outbound transfers: { names: { name: count }, exact, sensitive }. Uses the outbound
 * detector map when ingestion provides one (vectors[v].egress.detectorNames). Otherwise the vector's detector names
 * cover all its transfers, downloads included: when none of its sensitive transfers was a download they are exact;
 * when some were, a name is kept only with the count it must have on outbound transfers (its count minus the
 * sensitive non-outbound transfers), so a detector matched only on downloads is never attributed to outbound data.
 */
function ceraOutboundDetectors(vec) {
  const v = vec || {};
  const out = v.egress || {};
  const sensitive = Number(out.sensitiveCount) || 0;
  const explicit = (out.detectorNames && typeof out.detectorNames === 'object') ? out.detectorNames
    : ((v.egressDetectorNames && typeof v.egressDetectorNames === 'object') ? v.egressDetectorNames : null);
  if (explicit) return { names: Object.assign({}, explicit), exact: true, sensitive: sensitive };
  if (sensitive <= 0) return { names: {}, exact: true, sensitive: 0 };
  const all = v.detectorNames || {};
  const notOutbound = Math.max(0, (Number(v.sensitivity && v.sensitivity.sensitiveCount) || 0) - sensitive);
  const names = {};
  Object.keys(all).forEach(k => {
    const n = (Number(all[k]) || 0) - notOutbound;
    if (n > 0) names[k] = n;
  });
  return { names: names, exact: notOutbound === 0, sensitive: sensitive };
}

/**
 * Detector names as the deck lists them: the most frequent first (at most limit, 3 by default), each named by
 * ceraDetectorLabel (predefined detectors in words, custom rules and national IDs by the name the log gives them) and
 * with its count when the counts are exact ("Credit card number (7), Indonesia - NIK (5) and Email address (2)").
 * Rule ids (policies/...) and the OTHER and UNKNOWN buckets name nothing and are left out. '' when none is left.
 */
function ceraDetectorListText(names, exact, lang, limit) {
  const map = names || {};
  const det = Object.keys(map).filter(k => k && !/^policies\//.test(k) && !/^(OTHER|UNKNOWN)$/i.test(k) && (Number(map[k]) || 0) > 0)
    .sort((a, b) => (Number(map[b]) || 0) - (Number(map[a]) || 0) || (a < b ? -1 : 1)).slice(0, limit || 3);
  return ceraJoinList(det.map(k => exact ? ceraT('deck.v.detectorCount', { name: ceraDetectorLabel(k), n: Number(map[k]) || 0 }, lang) : ceraDetectorLabel(k)), lang);
}

/**
 * Detector names with their counts of a sensitivity tally (vectors[v].sensitivity, printStats.sensitivity): the
 * names the rules report (names, recorded by ingestion), or, without them, the predefined detectors of its coarse
 * categories (CREDIT_CARD_NUMBER, PHONE_NUMBER, EMAIL_ADDRESS; OTHER names no detector).
 */
function ceraSensitivityDetectorNames(sens, names) {
  if (names && typeof names === 'object' && Object.keys(names).length) return names;
  const coarse = (sens && sens.detectors) || {};
  const out = {};
  ['CREDIT_CARD_NUMBER', 'PHONE_NUMBER', 'EMAIL_ADDRESS'].forEach(k => { if ((Number(coarse[k]) || 0) > 0) out[k] = Number(coarse[k]); });
  return out;
}

/**
 * Outbound transfers to outside accounts by account type: { total, exact, otherOrg: { min, max, domain },
 * consumer: { min, max, domain } }. Per-action counting (ceraActionModel) counts account types on outbound transfers
 * only, and per-type outbound counts (accountClasses[type].egressCount) are used when present. Under row counting the
 * account types cover all the vector's transfers: exact when the vector has no download, else a range (a type's
 * count minus the vector's non-outbound transfers, up to its count). A domain is named only when it is certain: the
 * type has a single domain, or the counts are exact.
 */
function ceraAccountSplit(vec, state) {
  const v = vec || {};
  const total = Number(v.egress && v.egress.count) || 0;
  const classes = v.accountClasses || {};
  const outboundOnly = ceraActionModel(state);
  const notOutbound = outboundOnly ? 0 : Math.max(0, (Number(v.totalEvents) || 0) - total);
  const outboundOf = c => (c && c.egressCount !== undefined) ? Number(c.egressCount) || 0
    : ((c && c.egress && c.egress.count !== undefined) ? Number(c.egress.count) || 0 : null);
  const explicit = ['otherOrg', 'consumer'].some(k => outboundOf(classes[k]) !== null);
  const range = k => {
    const c = classes[k] || {};
    const count = Number(c.count) || 0;
    let min;
    let max;
    if (explicit) min = max = outboundOf(c) || 0;
    else if (notOutbound === 0) min = max = count;
    else {
      min = Math.max(0, count - notOutbound);
      max = Math.min(count, total);
    }
    const domains = Object.keys(c.domains || {}).filter(validOuName_);
    let domain = '';
    if (min > 0 && (domains.length === 1 || (!explicit && notOutbound === 0))) {
      domain = domains.sort((a, b) => (c.domains[b] - c.domains[a]) || (a < b ? -1 : 1))[0] || '';
    }
    return { min: min, max: max, domain: domain };
  };
  const otherOrg = range('otherOrg');
  const consumer = range('consumer');
  return { total: total, exact: otherOrg.min === otherOrg.max && consumer.min === consumer.max, otherOrg: otherOrg, consumer: consumer };
}

/**
 * Outbound transfers of a vector by action type, as measured: [{ key, n }] (catalog keys deck.act.*): file uploads,
 * pastes into a page and prints, as ingestion split them (vectors[v].egress.kinds, ceraRecordOutboundKind_). Without
 * that split an upload is a file upload or content pasted into a page (Chrome reports both as uploads), and a paste
 * is a paste event of the log sources that report one under per-action counting (state.copies or
 * state.coverage.actions present); under row counting the paste action holds clipboard copies, and is named so.
 * leftOnly: count only the transfers no policy stopped, when ingestion split the vector by outcome (an action type
 * all of whose transfers were stopped has none).
 */
function ceraActionMix(vec, state, leftOnly) {
  const v = vec || {};
  const split = !!(leftOnly && v.egress && v.egress.left);
  const kinds = v.egress && v.egress.kinds;
  if (kinds) {
    const n = k => Number(kinds[k] && (split ? kinds[k].leftCount : kinds[k].count)) || 0;
    return [
      { key: 'deck.act.fileUpload', n: n('fileUpload') },
      { key: 'deck.act.paste', n: n('paste') },
      { key: 'deck.act.print', n: n('print') }
    ].filter(x => x.n > 0);
  }
  const count = a => {
    const e = v.actions && v.actions[a];
    if (!e) return 0;
    return Number(split ? e.leftCount : e.count) || 0;
  };
  return [
    { key: 'deck.act.upload', n: count('upload') },
    { key: ceraActionModel(state) ? 'deck.act.paste' : 'deck.act.copy', n: count('paste') },
    { key: 'deck.act.print', n: count('print') }
  ].filter(x => x.n > 0);
}

/**
 * What an aggregate's outbound transfers sent to the sites themselves: its file uploads and pastes into a page, from
 * the split by kind ingestion records (holder.kinds, ceraRecordOutboundKind_): { count, bytes, leftCount, leftBytes,
 * sensitive, sensitiveLeft }. A print sends nothing to the site it was printed from. null when the aggregate has no
 * split by kind (a state from row counting).
 */
function ceraSentToSite(holder) {
  const kinds = holder && holder.kinds;
  if (!kinds) return null;
  const out = { count: 0, bytes: 0, leftCount: 0, leftBytes: 0, sensitive: 0, sensitiveLeft: 0 };
  ['fileUpload', 'paste'].forEach(k => {
    const e = kinds[k];
    if (e) Object.keys(out).forEach(f => { out[f] += Number(e[f]) || 0; });
  });
  return out;
}

/** The file uploads and pastes into a page of a vector (ceraSentToSite) as a mix, all or only those that left. */
function ceraSentMix(vec, leftOnly) {
  const kinds = (vec && vec.egress && vec.egress.kinds) || {};
  const n = k => Number(kinds[k] && (leftOnly ? kinds[k].leftCount : kinds[k].count)) || 0;
  return [{ key: 'deck.act.fileUpload', n: n('fileUpload') }, { key: 'deck.act.paste', n: n('paste') }].filter(x => x.n > 0);
}

/**
 * The account type most transfers to outside accounts went to, of an account split (ceraAccountSplit): 'consumer'
 * (personal mailboxes) when it has more than another organization's accounts, 'otherOrg' when those have any, or ''.
 */
function ceraAccountSplitLead(s) {
  if (!s) return '';
  if (s.consumer.min > s.otherOrg.min) return 'consumer';
  return s.otherOrg.min > 0 ? 'otherOrg' : '';
}

/**
 * Headline of the personal-accounts channel from its account split (ceraAccountSplit) and its outbound transfers n:
 * the larger account type first, with its domain when it is certain; the smaller type follows only when it is at least
 * CERA_ACCOUNT_SPLIT.minorShare of the transfers to outside accounts.
 */
function ceraAccountSplitHeadline(s, n, lang) {
  const consumerLeads = ceraAccountSplitLead(s) === 'consumer';
  const lead = consumerLeads ? s.consumer : s.otherOrg;
  const key = 'deck.personal.hl' + (consumerLeads ? 'Consumer' : 'OtherOrg') + (s.exact ? '' : 'Min') + (lead.domain ? '' : 'NoDomain');
  const text = ceraT(key, { n: n, other: s.otherOrg.min, consumer: s.consumer.min, domain: lead.domain }, lang);
  const minor = consumerLeads ? s.otherOrg : s.consumer;
  if (!(minor.min > 0) || minor.min < CERA_ACCOUNT_SPLIT.minorShare * (s.total || n)) return text;
  const part = ceraT('deck.split.' + (consumerLeads ? 'other' : 'consumer') + (minor.min === minor.max ? 'Exact' : 'Min'), { n: minor.min }, lang);
  return ceraT('deck.personal.hlMinor', { lead: text, part: part }, lang);
}

/**
 * The file uploads and pastes of the personal-accounts vector to another organization's accounts and to personal
 * mailboxes (vectors.personal.accountClassKinds), in the shape of ceraAccountSplit; null without that split.
 */
function ceraSentAccountSplit(vec) {
  const classes = vec && vec.accountClassKinds;
  if (!classes) return null;
  const n = cls => { const s = ceraSentToSite(classes[cls]); return s ? s.count : 0; };
  const range = cls => ({ min: n(cls), max: n(cls), domain: '' });
  return { total: n('otherOrg') + n('consumer'), exact: true, otherOrg: range('otherOrg'), consumer: range('consumer') };
}

/**
 * True when ingestion counts user actions (state.copies or state.coverage.actions present): clipboard copies are then
 * kept apart and are not outbound, and account types are counted on outbound transfers. False for row counting.
 */
function ceraActionModel(state) {
  const st = state || {};
  return st.copies !== undefined || !!(st.coverage && st.coverage.actions !== undefined);
}

/** "3 file uploads", "3 file uploads and 2 prints", "3 file uploads, 2 pastes and 1 print" in the report language. */
function ceraActionMixText(mix, lang) {
  const parts = (mix || []).map(x => ceraT(x.key, { n: x.n }, lang));
  return ceraJoinList(parts, lang);
}

/** Joins items as a list in the report language: "a", "a and b", "a, b and c". */
function ceraJoinList(items, lang) {
  const list = (items || []).filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  const head = list.slice(0, -1).join(ceraT('deck.list.sep', null, lang));
  return ceraT('deck.list.and', { a: head, b: list[list.length - 1] }, lang);
}

/**
 * Potentially malicious files, most hits first: [{ name, count }]. A file is named by the file name ingestion recorded
 * (an entry's fileName, else its key). Files without a real name (a blob: download leaves only an opaque id) are not
 * listed by that id: they are grouped per source as "N unnamed files from host". Used by the deck and the workbook.
 */
function ceraMalwareFileRows(state, lang) {
  const sig = state && state.vectors && state.vectors.securityRadar && state.vectors.securityRadar.signals && state.vectors.securityRadar.signals.malwareTransfer;
  const legacy = state && state.securityRadar && state.securityRadar.malwareTransfer;
  const files = (sig && sig.files && Object.keys(sig.files).length) ? sig.files : ((legacy && legacy.files) || {});
  const rows = [];
  const unnamed = {}; // source host -> { files, hits }
  Object.keys(files).forEach(key => {
    const e = files[key];
    const hits = (e && typeof e === 'object') ? (Number(e.total || e.count) || 0) : (Number(e) || 0);
    if (hits <= 0) return;
    const fileName = (e && typeof e === 'object' && e.fileName) ? e.fileName : key;
    const host = (e && typeof e === 'object' && e.domain) ? e.domain : '';
    if (ceraIsOpaqueFileName(fileName)) {
      if (!unnamed[host]) unnamed[host] = { files: 0, hits: 0 };
      unnamed[host].files++;
      unnamed[host].hits += hits;
    } else {
      rows.push({ name: String(fileName).trim(), count: hits });
    }
  });
  Object.keys(unnamed).forEach(host => {
    const u = unnamed[host];
    const where = host && !isBlankDestination(host) ? ceraShortLabel(ceraDestinationLabel(host, lang), 24) : '';
    rows.push({
      name: where ? ceraT('deck.file.unnamedGroup', { n: u.files, host: where }, lang) : ceraT('deck.file.unnamedCount', { n: u.files }, lang),
      count: u.hits
    });
  });
  return rows.sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1));
}

/**
 * Formats of a vector's outbound transfers, largest first: [{ name, bytes, count, volumeGb, totalBytes }]. Uses the
 * format families ingestion reports (vectors[v].families: familyId -> { bytes, count }, outbound fields preferred when
 * an entry has them) with their catalog labels, otherwise the outbound share of each content type. limit: optional.
 */
function ceraOutboundFormats(vec, lang, limit) {
  const v = vec || {};
  const fams = v.families && typeof v.families === 'object' ? v.families : null;
  let items;
  if (fams && Object.keys(fams).length) {
    items = Object.keys(fams).map(id => {
      const e = fams[id] || {};
      return {
        name: ceraFamilyLabel(id, lang),
        bytes: Number(e.egressBytes !== undefined ? e.egressBytes : e.bytes) || 0,
        count: Number(e.egressCount !== undefined ? e.egressCount : e.count) || 0
      };
    });
  } else {
    items = Object.keys(v.types || {}).map(k => {
      const e = v.types[k] || {};
      return { name: (e && e.name) || k, bytes: Number(e.egressBytes) || 0, count: Number(e.egressCount) || 0 };
    });
  }
  items = items.filter(i => validOuName_(i.name) && (i.bytes > 0 || i.count > 0));
  const byCount = !items.some(i => i.bytes > 0);
  items.sort((a, b) => (byCount ? b.count - a.count : (b.bytes - a.bytes || b.count - a.count)));
  items.forEach(i => { i.volumeGb = i.bytes / (1024 ** 3); i.totalBytes = i.bytes; });
  return limit ? items.slice(0, limit) : items;
}

/**
 * How concentrated outbound data is over people, from each person's measured amount (bytes, or transfers on the
 * count basis): { n, k, share, top, badge }. n: the people who sent data out, one amount each, those whose transfers
 * carried no size included, so n is the population the deck cover counts; k: the fewest of them that account for
 * CERA_CONCENTRATION.volumeShare of it; top: the share in percent of the person who sent the most; badge: 'none',
 * 'single' (one person), 'small' (CERA_CONCENTRATION.maxSmall people or fewer), 'concentrated' (k / n at most
 * CERA_CONCENTRATION.peopleShare) or 'distributed'.
 */
function ceraConcentration(amounts) {
  const vals = (amounts || []).map(Number).filter(v => isFinite(v) && v >= 0).sort((a, b) => b - a);
  const total = vals.reduce((s, v) => s + v, 0);
  const n = vals.length;
  const share = Math.round(CERA_CONCENTRATION.volumeShare * 100);
  if (!n || !(total > 0)) return { n: 0, k: 0, share: share, top: 0, badge: 'none' };
  let cum = 0;
  let k = 0;
  for (let i = 0; i < n; i++) {
    cum += vals[i];
    k++;
    if (cum >= total * CERA_CONCENTRATION.volumeShare - 1e-9) break;
  }
  let badge = k / n <= CERA_CONCENTRATION.peopleShare + 1e-9 ? 'concentrated' : 'distributed';
  if (n === 1) badge = 'single';
  else if (n <= CERA_CONCENTRATION.maxSmall) badge = 'small';
  return { n: n, k: k, share: share, top: Math.round((vals[0] / total) * 100), badge: badge };
}

/**
 * The sentence under a user concentration badge (ceraConcentration), in the report language: who sent the outbound
 * data of all channels (amount: what identified people sent out) or, with amount omitted, of one channel. A small
 * group is described by its number of people and the largest share one of them sent.
 */
function ceraConcentrationText(c, amount, lang) {
  const channel = amount === undefined || amount === null;
  if (!c || !c.n) return ceraT('deck.conc.textNone', null, lang);
  const params = { n: c.n, k: c.k, share: c.share, top: c.top, amount: amount };
  if (c.badge === 'small') return ceraT(channel ? 'deck.conc.vectorTextSmall' : 'deck.conc.textSmall', params, lang);
  return ceraT(channel ? 'deck.conc.vectorText' : 'deck.conc.text', params, lang);
}

/**
 * The unit whose outbound data comes most from one person, among units with at least CERA_SKEW_RULE.minPeople people
 * sending data out and CERA_SKEW_RULE.minBytes of outbound data (state.outliers.ouActors, outbound only):
 * { ou, ratio, bytes, people }, or null when no unit qualifies. Ties go to the larger unit, then the name.
 */
function ceraUnitSkew(state) {
  const units = (state && state.outliers && state.outliers.ouActors) || {};
  let best = null;
  Object.keys(units).sort().forEach(ou => {
    const u = units[ou] || {};
    const total = Number(u.totalBytes) || 0;
    const people = Object.keys(u.users || {}).filter(p => (Number(u.users[p]) || 0) > 0);
    if (!validOuName_(ou) || total < CERA_SKEW_RULE.minBytes || people.length < CERA_SKEW_RULE.minPeople) return;
    const top = people.reduce((m, p) => Math.max(m, Number(u.users[p]) || 0), 0);
    const ratio = total > 0 ? top / total : 0;
    if (!best || ratio > best.ratio + 1e-9 || (Math.abs(ratio - best.ratio) <= 1e-9 && total > best.bytes)) {
      let topDomain = '';
      let topDomBytes = -1;
      let topDomCount = -1;
      Object.keys(u.domains || {}).filter(validOuName_).sort().forEach(d => {
        const domObj = u.domains[d] || {};
        const db = Number(domObj.bytes) || 0;
        const dc = Number(domObj.count) || 0;
        if (db > topDomBytes || (db === topDomBytes && dc > topDomCount)) {
          topDomBytes = db;
          topDomCount = dc;
          topDomain = d;
        }
      });
      best = { ou: ou, ratio: ratio, bytes: total, topBytes: top, topDomain: topDomain, people: people.length };
    }
  });
  return best;
}

/**
 * People in the log: { n, exact }. Exact from state.coverage.people when ingestion counts every person in the log;
 * otherwise a lower bound, everyone the aggregated events name (transfers in the four channels, prints, sensitive
 * data shown on pages, clipboard copies, security signals). People whose only rows went to sanctioned or internal
 * destinations are in the log but not in these aggregates.
 */
function ceraPeopleInLog(state) {
  const st = state || {};
  const cov = st.coverage || {};
  if (typeof cov.people === 'number') return { n: cov.people, exact: true };
  const seen = {};
  const add = m => Object.keys(m || {}).forEach(u => { if (u) seen[u] = true; });
  add(st.globalUsers);
  add(st.egress && st.egress.users);
  add(st.printStats && st.printStats.users);
  add(st.sensitiveOnPage && st.sensitiveOnPage.users);
  add(st.copies && st.copies.users);
  const radar = st.securityRadar || {};
  ['passwordReuse', 'malwareTransfer', 'unsafeSiteVisit'].forEach(k => add(radar[k] && radar[k].users));
  add(st.vectors && st.vectors.securityRadar && st.vectors.securityRadar.users);
  return { n: Object.keys(seen).length, exact: false };
}

/**
 * Each person's outbound bytes and transfers in a vector: { user: { bytes, count } }. Read from
 * vectors[v].egress.users when ingestion records it, otherwise from the outbound counters of vectors[v].actors, and
 * from the vector's user set (no amounts) when neither is there. Downloads never count.
 */
function ceraOutboundUsers(vec) {
  const v = vec || {};
  const out = {};
  const eu = v.egress && v.egress.users;
  if (eu && typeof eu === 'object' && Object.keys(eu).length) {
    Object.keys(eu).forEach(u => {
      const e = eu[u] || {};
      if ((Number(e.count) || 0) > 0 || (Number(e.bytes) || 0) > 0) out[u] = { bytes: Number(e.bytes) || 0, count: Number(e.count) || 0 };
    });
    return out;
  }
  const actors = v.actors || {};
  if (Object.keys(actors).length) {
    Object.keys(actors).forEach(u => {
      const a = actors[u] || {};
      if ((Number(a.egressCount) || 0) > 0) out[u] = { bytes: Number(a.egressBytes) || 0, count: Number(a.egressCount) || 0 };
    });
    return out;
  }
  if (eu && typeof eu === 'object') return out;
  Object.keys(v.users || {}).forEach(u => { out[u] = { bytes: 0, count: 0 }; });
  return out;
}

/**
 * Destinations of a vector that received at least one outbound transfer, a sizeless one included (a paste or print
 * can be logged without a size): the keys of vectors[v].domains with a real name. The one destination count of a
 * vector, on its overview and its deep-dive.
 */
function ceraOutboundDestinations(vec) {
  const d = (vec && vec.domains) || {};
  return Object.keys(d).filter(k => validOuName_(k) && String(k).trim().toLowerCase() !== 'n/a' && d[k] && (Number(d[k].egressCount) || 0) > 0);
}

/** Number of people with outbound transfers in a vector (ceraOutboundUsers). */
function ceraOutboundPeople(vec) {
  return Object.keys(ceraOutboundUsers(vec)).length;
}

/**
 * Busiest day of one vector's outbound transfers: ceraPeakStats over the vector's daily outbound bytes and counts,
 * the rule the deck headline and the outlier slide apply to all outbound data (busiest day over the mean active day,
 * a peak only under CERA_PEAK_RULE). The vector slides and the vector sheets quote it, so a day carries one multiple.
 */
function ceraVectorPeak(vec) {
  const tl = (vec && vec.timeline) || {};
  const daily = {};
  Object.keys(tl).forEach(d => {
    const e = tl[d] || {};
    daily[d] = { bytes: Number(e.egressBytes) || 0, count: Number(e.egressCount) || 0 };
  });
  return ceraPeakStats(daily);
}

/** One sentence on a vector's busiest outbound day (ceraVectorPeak), in the words of ceraPeakSentence. */
function ceraVectorPeakSentence(peak, lang) {
  const p = peak || {};
  const T = (key, params) => ceraT(key, params, lang);
  if (!p.basis) return T('deck.vpeak.none');
  const byCount = p.basis === 'count';
  const params = {
    date: formatDisplayDate(p.peakKey, true, lang),
    amount: byCount ? T('deck.transfers', { n: p.peakCount }) : formatBytes(p.peakBytes),
    multiple: (Number(p.multiple) || 0).toFixed(1),
    n: p.peakCount
  };
  if (p.activeDays < CERA_PEAK_RULE.minActiveDays) return T('deck.vpeak.fewDays', Object.assign({}, params, { n: p.activeDays }));
  if (p.isPeak) return T(byCount ? 'deck.vpeak.peakCount' : 'deck.vpeak.peak', params);
  return T(byCount ? 'deck.vpeak.busiestCount' : 'deck.vpeak.busiest', params);
}

/** Card title for a vector's busiest outbound day: "Peak day: <date>" only under the peak rule. */
function ceraVectorPeakTitle(peak, lang) {
  const p = peak || {};
  if (!p.basis) return ceraT('deck.vpeak.titleNone', null, lang);
  return ceraT(p.isPeak ? 'deck.vpeak.titlePeak' : 'deck.vpeak.title', { date: formatDisplayDate(p.peakKey, true, lang) }, lang);
}

/**
 * Names that can be shown as a unit or destination: not empty, not a "null"/"undefined" artifact.
 */
function validOuName_(name) {
  const n = String(name || '').trim().toLowerCase();
  return !!n && n !== 'null' && n !== 'undefined' && n !== '-';
}
