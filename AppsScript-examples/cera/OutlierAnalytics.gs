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
 * Module: OutlierAnalytics.gs
 * Description: Statistical behavioral anomaly engine (Velocity, Funnels, Scatter, Skew)
 * ==============================================================================
 */

/**
 * Computes behavioral outlier metrics from raw telemetry aggregations
 * - Daily Velocity Surges: Temporal bursts exceeding baseline mean
 * - Monolithic Funneling: HHI concentration score into a single external repository
 * - Scatter Egress: Actor dispersing data across numerous distinct unapproved SaaS
 * - Intra-OU Skew: Departmental blast radius where a single actor dominates unit egress
 */
function computeOutlierAnalytics(outliers, state) {
  // Every user action is counted before anything is measured, including actions still waiting for rows when the
  // caller read the rows itself (ActionAssembler.gs)
  if (state && typeof ceraFlushActions_ === 'function') ceraFlushActions_(state);
  if (!outliers) {
    return {
      peakDate: 'N/A',
      peakVolumeGb: 0,
      burstMultiple: 1.0,
      topFunnelOU: 'N/A',
      topFunnelDomain: 'N/A',
      funnelHHI: 0,
      funnelVolumeGb: 0,
      topScatterOU: 'N/A',
      scatterDomainCount: 0,
      topSkewOU: 'N/A',
      topSkewRatio: 0,
      burstMultipleEgress: 1.0,
      peakEgressDate: 'N/A',
      rawPeakEgressDate: 'N/A',
      peakEgressGb: 0,
      egressVolumeGb: 0,
      egressPeak: ceraPeakStats({}),
      volumePeak: ceraPeakStats({}),
      calendarDays: 0,
      sampleSize: { users: 0, days: 0, events: 0 }
    };
  }

  // A. Temporal Daily Bursts
  // calendarDays: every day from the first to the last observed day (ceraLocalDayKey), for the length of the window.
  const calendarKeys = _ceraObservationCalendar_(outliers, state);
  const calendarDays = calendarKeys.length;

  // Peak days measured against the active days (ceraPeakStats): all directions (dailyVolume) and outbound only
  // (dailyEgress: upload, paste, print). burstMultiple / burstMultipleEgress = peak day / mean active day.
  const volumePeak = ceraPeakStats(outliers.dailyVolume || {});
  const egressPeak = ceraPeakStats(outliers.dailyEgress || {});
  const peakDate = volumePeak.peakKey || 'N/A';
  const burstMultiple = volumePeak.multiple || 1.0;
  const peakVolumeGb = volumePeak.peakBytes / (1024 ** 3);

  // sampleSize: users = distinct users counted in the 4 DLP vectors; days = days with at least one
  // counted event; events = counted events. Engines should suppress statistical claims on small samples.
  const sampleSize = {
    users: Object.keys((state && state.globalUsers) || {}).length,
    days: Object.keys(outliers.dailyVolume || {}).length,
    events: (state && state.totalEvents) || 0
  };

  // B. Monolithic Funneling (HHI >= 0.70) & Scatter Dispersion (k >= 4)
  // Every pick is independent of row order: actors, units and destinations are visited in name order and a later
  // one replaces the pick only when it ranks strictly higher. Funnel: highest HHI, then larger volume, then name.
  // Dispersion: most destinations, then larger volume, then name.
  const SHARE_EPSILON = 1e-9;
  let topFunnelActor = 'N/A';
  let topFunnelOU = 'N/A';
  let topFunnelDomain = 'N/A';
  let maxHHI = 0;
  let funnelBytes = 0;

  let topScatterActor = 'N/A';
  let topScatterOU = 'N/A';
  let maxScatterCount = 0;
  let scatterBytes = 0;

  Object.keys(outliers.actorEndpoints || {}).sort().forEach(actor => {
    const act = outliers.actorEndpoints[actor];
    if (act.totalBytes < 50 * (1024 ** 2)) return; // Minimum 50 MB threshold

    // Herfindahl-Hirschman Index (HHI) calculation
    let sumSquares = 0;
    let localMaxDomain = '';
    let localMaxDomainBytes = 0;
    const domainKeys = Object.keys(act.domains || {}).sort();

    domainKeys.forEach(dom => {
      const share = act.domains[dom] / act.totalBytes;
      sumSquares += (share * share);
      if (act.domains[dom] > localMaxDomainBytes) {
        localMaxDomainBytes = act.domains[dom];
        localMaxDomain = dom;
      }
    });

    const higherHHI = sumSquares > maxHHI + SHARE_EPSILON;
    const sameHHI = Math.abs(sumSquares - maxHHI) <= SHARE_EPSILON;
    if (topFunnelActor === 'N/A' || higherHHI || (sameHHI && act.totalBytes > funnelBytes)) {
      maxHHI = sumSquares;
      topFunnelActor = actor;
      topFunnelOU = act.ou || 'Unknown OU';
      topFunnelDomain = localMaxDomain;
      funnelBytes = act.totalBytes;
    }

    if (domainKeys.length > maxScatterCount || (domainKeys.length === maxScatterCount && act.totalBytes > scatterBytes)) {
      maxScatterCount = domainKeys.length;
      topScatterActor = actor;
      topScatterOU = act.ou || 'Unknown OU';
      scatterBytes = act.totalBytes;
    }
  });

  // C. Departmental Blast Radius (Intra-OU Skew): largest single-user share, then larger unit volume, then name
  let topSkewOU = 'N/A';
  let topSkewRatio = 0;
  let skewBytes = 0;

  Object.keys(outliers.ouActors || {}).sort().forEach(ou => {
    const o = outliers.ouActors[ou];
    if (o.totalBytes < 100 * (1024 ** 2)) return;
    let maxUserBytes = 0;
    for (let u in (o.users || {})) {
      if (o.users[u] > maxUserBytes) maxUserBytes = o.users[u];
    }
    const ratio = o.totalBytes > 0 ? (maxUserBytes / o.totalBytes) : 0;
    const higher = ratio > topSkewRatio + SHARE_EPSILON;
    const same = Math.abs(ratio - topSkewRatio) <= SHARE_EPSILON;
    if (ratio > 0 && (higher || (same && o.totalBytes > skewBytes))) {
      topSkewRatio = ratio;
      topSkewOU = ou;
      skewBytes = o.totalBytes;
    }
  });

  return {
    peakDate: formatDisplayDate(peakDate),
    rawPeakDate: peakDate,
    peakVolumeGb: peakVolumeGb,
    burstMultiple: burstMultiple,
    topFunnelOU: topFunnelOU,
    topFunnelDomain: topFunnelDomain,
    funnelHHI: maxHHI,
    funnelVolumeGb: funnelBytes / (1024 ** 3),
    topScatterOU: topScatterOU,
    scatterDomainCount: maxScatterCount,
    topSkewOU: topSkewOU,
    topSkewRatio: topSkewRatio,
    burstMultipleEgress: egressPeak.multiple || 1.0,
    peakEgressDate: egressPeak.peakKey ? formatDisplayDate(egressPeak.peakKey) : 'N/A',
    rawPeakEgressDate: egressPeak.peakKey || 'N/A',
    peakEgressGb: egressPeak.peakBytes / (1024 ** 3),
    egressVolumeGb: egressPeak.totalBytes / (1024 ** 3),
    // Full peak statistics (basis, active days, median, isPeak) for the deck and the workbook
    egressPeak: egressPeak,
    volumePeak: volumePeak,
    calendarDays: calendarDays,
    sampleSize: sampleSize
  };
}

/**
 * Day keys from the first to the last observed day, inclusive. Uses the first and last day of the rows read
 * (state.firstDayKey / lastDayKey, bucketed like every day key; state.minDate / maxDate in the report time zone
 * without them) and the keys of dailyVolume / dailyEgress.
 */
function _ceraObservationCalendar_(outliers, state) {
  const keys = Object.keys((outliers && outliers.dailyVolume) || {})
    .concat(Object.keys((outliers && outliers.dailyEgress) || {}));
  if (state && state.firstDayKey) keys.push(state.firstDayKey);
  else if (state && state.minDate instanceof Date) keys.push(ceraDayKey(state.minDate));
  if (state && state.lastDayKey) keys.push(state.lastDayKey);
  else if (state && state.maxDate instanceof Date) keys.push(ceraDayKey(state.maxDate));
  const valid = keys.filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
  if (valid.length === 0) return [];
  return ceraCalendarDayKeys(valid[0], valid[valid.length - 1]);
}

/**
 * When a day may be called a peak: the series needs at least minActiveDays active days, and the day must be at
 * least minMedianMultiple times the median active day. Medians, not standard deviations: a few heavy days do not
 * hide each other.
 */
var CERA_PEAK_RULE = { minActiveDays: 7, minMedianMultiple: 2.5 };

/**
 * Peak statistics of a daily { bytes, count } series keyed 'yyyy-MM-dd'. Active days are days with at least one
 * event; days without events are not averaged in. The basis is bytes when any day has bytes, otherwise the event
 * count (prints and pastes can be logged without a size). multiple = peak day / mean active day, the one mean used
 * by the deck headline, the outlier slide and the workbook. isPeak applies CERA_PEAK_RULE.
 */
function ceraPeakStats(daily) {
  const src = daily || {};
  const days = Object.keys(src).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort()
    .map(k => ({ key: k, bytes: Number(src[k] && src[k].bytes) || 0, count: Number(src[k] && src[k].count) || 0 }))
    .filter(d => d.bytes > 0 || d.count > 0);
  const totalBytes = days.reduce((s, d) => s + d.bytes, 0);
  const totalCount = days.reduce((s, d) => s + d.count, 0);
  const basis = totalBytes > 0 ? 'bytes' : (totalCount > 0 ? 'count' : '');
  const out = {
    basis: basis, activeDays: days.length, totalBytes: totalBytes, totalCount: totalCount,
    peakKey: '', peakBytes: 0, peakCount: 0, peakValue: 0, mean: 0, median: 0, multiple: 0, isPeak: false
  };
  if (!basis) return out;

  const valueOf = d => (basis === 'bytes' ? d.bytes : d.count);
  let peak = days[0];
  days.forEach(d => { if (valueOf(d) > valueOf(peak)) peak = d; }); // the earliest day wins a tie
  const values = days.map(valueOf).sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  out.median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  out.mean = (basis === 'bytes' ? totalBytes : totalCount) / days.length;
  out.peakKey = peak.key;
  out.peakBytes = peak.bytes;
  out.peakCount = peak.count;
  out.peakValue = valueOf(peak);
  out.multiple = out.mean > 0 ? out.peakValue / out.mean : 0;
  out.isPeak = days.length >= CERA_PEAK_RULE.minActiveDays && out.peakValue > 0 &&
    out.peakValue >= CERA_PEAK_RULE.minMedianMultiple * out.median;
  return out;
}

/**
 * Computes the three right-side behavioral analysis cards for Slide 3 (Behavioral Anomaly Analytics),
 * identifying activity by Organizational Unit (OU) rather than individual user identity:
 *   1. Destination Funneling: heaviest single-user outbound volume concentrated into a primary destination (plus peak-day volume when active).
 *   2. Multi-Portal Dispersion: single user spreading outbound data across multiple distinct destinations (plus leading destination & peak-day volume).
 *   3. Intra-Unit Skew & Peak-Day Unit Activity: single-user dominance within a unit (>= 3 users, >= 100 MB) and the unit leading the peak/busiest outbound day.
 */
function ceraSlide3Cards(state, om, egressVelocity, lang) {
  const l = (typeof ceraNormalizeLang_ === 'function') ? ceraNormalizeLang_(lang || 'en') : (lang || 'en');
  const T = (key, params) => ceraT(key, params, l);
  const NR = T('deck.notRecorded');
  const fmtB = bytes => formatBytes(Number(bytes) || 0);
  const destLabel = name => ceraDestinationLabel(name, l);
  const isValid = name => {
    if (name === null || name === undefined) return false;
    const s = String(name).trim().toLowerCase();
    return s !== '' && s !== 'null' && s !== 'undefined' && s !== 'n/a' && s !== '-';
  };
  const fmtAmt = (bytes, count, byCount) => byCount ? T('deck.transfers', { n: Number(count) || 0 }) : fmtB(bytes);

  const outliers = (state && state.outliers) || {};
  const m = om || {};
  const peak = (egressVelocity && egressVelocity.peak) || m.egressPeak || {};
  const peakKey = peak.peakKey || '';
  const activeDays = Number(peak.activeDays) || 0;
  const globalByCount = peak.basis === 'count';
  const peakDate = peakKey ? formatDisplayDate(peakKey, true, l) : '';

  const actors = [];
  Object.keys(outliers.actorEndpoints || {}).sort().forEach(u => {
    const a = outliers.actorEndpoints[u] || {};
    const ou = a.ou || '';
    if (!isValid(ou)) return;
    const totalBytes = Number(a.totalBytes) || 0;
    const domKeys = Object.keys(a.domains || {}).filter(isValid).sort();
    const domainCounts = a.domainCounts || {};
    let totalCount = Number(a.totalCount) || 0;
    if (!totalCount && domKeys.length) {
      totalCount = domKeys.reduce((s, d) => s + (Number(domainCounts[d]) || (Number(a.domains[d]) > 0 ? 1 : 0)), 0);
    }
    const byCount = !(totalBytes > 0) && totalCount > 0;
    const totalVal = byCount ? totalCount : totalBytes;
    if (totalVal <= 0 || !domKeys.length) return;

    let hhi = 0;
    let topDom = domKeys[0];
    let topDomBytes = 0;
    let topDomCount = 0;
    let topDomVal = -1;
    domKeys.forEach(d => {
      const db = Number(a.domains[d]) || 0;
      const dc = Number(domainCounts[d]) || (db > 0 ? 1 : 0);
      const dv = byCount ? dc : db;
      const share = dv / totalVal;
      hhi += share * share;
      if (dv > topDomVal) {
        topDomVal = dv;
        topDom = d;
        topDomBytes = db;
        topDomCount = dc;
      }
    });
    const topShare = totalVal > 0 ? topDomVal / totalVal : 0;
    const dayRec = (peakKey && a.days && a.days[peakKey]) || null;
    const peakBytes = dayRec ? (Number(dayRec.bytes) || 0) : 0;
    const peakCount = dayRec ? (Number(dayRec.count) || 0) : 0;
    const peakVal = byCount ? peakCount : peakBytes;

    actors.push({
      user: u, ou: ou, byCount: byCount,
      totalBytes: totalBytes, totalCount: totalCount, totalVal: totalVal,
      domainCount: domKeys.length, hhi: hhi,
      topDom: topDom, topDomBytes: topDomBytes, topDomCount: topDomCount, topDomVal: topDomVal, topShare: topShare,
      peakBytes: peakBytes, peakCount: peakCount, peakVal: peakVal
    });
  });

  // 1. Card 1: Destination Funneling (Single-Destination Heavy Uploader by OU)
  const MIN_FUNNEL_BYTES = 50 * 1024 * 1024;
  const heavyActors = actors.filter(a => a.totalBytes >= MIN_FUNNEL_BYTES);
  const funnelBase = heavyActors.length ? heavyActors : actors;
  const focusedPool = funnelBase.filter(a => a.topShare >= 0.50);
  const funnelPool = focusedPool.length ? focusedPool : funnelBase;
  let bestFunnel = null;
  funnelPool.forEach(a => {
    if (!bestFunnel) { bestFunnel = a; return; }
    if (a.topDomVal !== bestFunnel.topDomVal) {
      if (a.topDomVal > bestFunnel.topDomVal) bestFunnel = a;
      return;
    }
    if (Math.abs(a.hhi - bestFunnel.hhi) > 1e-9) {
      if (a.hhi > bestFunnel.hhi) bestFunnel = a;
      return;
    }
    if (a.totalVal > bestFunnel.totalVal) bestFunnel = a;
  });

  let funnelOU = NR;
  let funnelDomain = NR;
  let funnelHHI = 0;
  let funnelNarrative;
  if (bestFunnel) {
    funnelOU = bestFunnel.ou;
    funnelDomain = destLabel(bestFunnel.topDom);
    funnelHHI = bestFunnel.hhi;
    const params = {
      ou: funnelOU,
      destAmount: fmtAmt(bestFunnel.topDomBytes, bestFunnel.topDomCount, bestFunnel.byCount),
      share: Math.round(bestFunnel.topShare * 100) + '%',
      amount: fmtAmt(bestFunnel.totalBytes, bestFunnel.totalCount, bestFunnel.byCount),
      hhi: Math.round(bestFunnel.hhi * 100) + '%',
      dest: funnelDomain
    };
    if (bestFunnel.peakVal > 0 && activeDays > 1 && peakDate) {
      params.peakAmount = fmtAmt(bestFunnel.peakBytes, bestFunnel.peakCount, bestFunnel.byCount);
      params.peakDate = peakDate;
      funnelNarrative = T('deck.s3.funnelTextPeak', params);
    } else {
      funnelNarrative = T('deck.s3.funnelText', params);
    }
  } else if (isValid(m.topFunnelOU) && (Number(m.funnelHHI) || 0) > 0) {
    funnelOU = m.topFunnelOU;
    funnelDomain = isValid(m.topFunnelDomain) ? destLabel(m.topFunnelDomain) : NR;
    funnelHHI = Number(m.funnelHHI) || 0;
    const volStr = fmtB((Number(m.funnelVolumeGb) || 0) * (1024 ** 3));
    const hhiStr = Math.round(funnelHHI * 100) + '%';
    funnelNarrative = T('deck.s3.funnelText', {
      ou: funnelOU, destAmount: volStr, share: hhiStr, amount: volStr, hhi: hhiStr, dest: funnelDomain
    });
  } else {
    funnelNarrative = T('deck.s3.funnelNone');
  }

  // 2. Card 2: Multi-Portal Dispersion (Multi-Destination Heavy Uploader by OU)
  const heavyMulti = actors.filter(a => a.domainCount >= 2 && a.totalBytes >= MIN_FUNNEL_BYTES);
  const allMulti = actors.filter(a => a.domainCount >= 2);
  const scatterPool = heavyMulti.length ? heavyMulti : (allMulti.length ? allMulti : (heavyActors.length ? heavyActors : actors));
  let bestScatter = null;
  scatterPool.forEach(a => {
    if (!bestScatter) { bestScatter = a; return; }
    if (a.domainCount !== bestScatter.domainCount) {
      if (a.domainCount > bestScatter.domainCount) bestScatter = a;
      return;
    }
    if (a.totalBytes !== bestScatter.totalBytes) {
      if (a.totalBytes > bestScatter.totalBytes) bestScatter = a;
      return;
    }
    if (a.totalCount > bestScatter.totalCount) bestScatter = a;
  });

  let scatterOU = NR;
  let scatterCount = 0;
  let scatterNarrative;
  if (bestScatter) {
    scatterOU = bestScatter.ou;
    scatterCount = bestScatter.domainCount;
    const scatterDest = destLabel(bestScatter.topDom);
    const scatterAmt = fmtAmt(bestScatter.totalBytes, bestScatter.totalCount, bestScatter.byCount);
    if (scatterCount >= 2 && bestScatter.peakVal > 0 && activeDays > 1 && peakDate) {
      scatterNarrative = T('deck.s3.scatterTextPeak', {
        ou: scatterOU, amount: scatterAmt, n: scatterCount, dest: scatterDest,
        peakAmount: fmtAmt(bestScatter.peakBytes, bestScatter.peakCount, bestScatter.byCount),
        peakDate: peakDate
      });
    } else {
      scatterNarrative = T('deck.s3.scatterText', {
        ou: scatterOU, amount: scatterAmt, n: scatterCount, dest: scatterDest
      });
    }
  } else if (isValid(m.topScatterOU) && (Number(m.scatterDomainCount) || 0) > 0) {
    scatterOU = m.topScatterOU;
    scatterCount = Number(m.scatterDomainCount) || 0;
    scatterNarrative = T('deck.s3.scatterText', {
      ou: scatterOU, amount: NR, n: scatterCount, dest: NR
    });
  } else {
    scatterNarrative = T('deck.s3.scatterNone');
  }

  // 3. Card 3: Intra-Unit Skew & Peak-Day Unit Activity
  const skew = (typeof ceraUnitSkew === 'function') ? ceraUnitSkew(state) : null;
  const hasSkew = !!skew;
  const skewOU = hasSkew ? skew.ou : NR;
  const skewRatio = hasSkew ? skew.ratio : 0;
  const skewPct = Math.round(skewRatio * 100) + '%';
  const skewSize = fmtB(CERA_SKEW_RULE.minBytes);

  let peakUnit = null;
  const dayEntry = (peakKey && outliers.dailyEgress && outliers.dailyEgress[peakKey]) || null;
  const dayOus = (peakKey && outliers.dailyEgressOus && outliers.dailyEgressOus[peakKey]) || (dayEntry && dayEntry.ous) || {};
  const dayTotalVal = dayEntry ? (globalByCount ? (Number(dayEntry.count) || 0) : (Number(dayEntry.bytes) || 0)) : 0;
  Object.keys(dayOus).filter(isValid).sort().forEach(ou => {
    const o = dayOus[ou] || {};
    const b = Number(o.bytes) || 0;
    const c = Number(o.count) || 0;
    const v = globalByCount ? c : b;
    if (v <= 0) return;
    if (!peakUnit || v > peakUnit.val || (v === peakUnit.val && c > peakUnit.count)) {
      let topDom = '';
      let topDomVal = -1;
      Object.keys(o.domains || {}).filter(isValid).sort().forEach(d => {
        const domObj = o.domains[d] || {};
        const dv = globalByCount ? (Number(domObj.count) || 0) : (Number(domObj.bytes) || 0);
        if (dv > topDomVal) { topDomVal = dv; topDom = d; }
      });
      peakUnit = {
        ou: ou, bytes: b, count: c, val: v,
        share: dayTotalVal > 0 ? Math.round((v / dayTotalVal) * 100) + '%' : '100%',
        topDom: topDom
      };
    }
  });

  const skewTitle = hasSkew ? T('deck.skew.title', { ou: skewOU }) : T('deck.skew.titleNone');
  let skewNarrative;
  if (hasSkew) {
    const skewTopAmt = fmtB(skew.topBytes || Math.round(skew.bytes * skew.ratio));
    const skewUnitAmt = fmtB(skew.bytes);
    const skewDest = isValid(skew.topDomain) ? destLabel(skew.topDomain) : NR;
    if (peakUnit && peakDate) {
      skewNarrative = T('deck.skew.textPeak', {
        n: skew.people, pct: skewPct, topAmount: skewTopAmt, unitAmount: skewUnitAmt, dest: skewDest,
        peakDate: peakDate, peakOU: peakUnit.ou,
        peakAmount: fmtAmt(peakUnit.bytes, peakUnit.count, globalByCount),
        peakDest: isValid(peakUnit.topDom) ? destLabel(peakUnit.topDom) : skewDest
      });
    } else {
      skewNarrative = T('deck.skew.text', {
        n: skew.people, pct: skewPct, topAmount: skewTopAmt, unitAmount: skewUnitAmt, dest: skewDest,
        min: CERA_SKEW_RULE.minPeople, size: skewSize
      });
    }
  } else if (peakUnit && peakDate) {
    skewNarrative = T('deck.skew.peakOnly', {
      peakDate: peakDate, peakOU: peakUnit.ou,
      peakAmount: fmtAmt(peakUnit.bytes, peakUnit.count, globalByCount),
      peakShare: peakUnit.share,
      peakDest: isValid(peakUnit.topDom) ? destLabel(peakUnit.topDom) : NR,
      min: CERA_SKEW_RULE.minPeople, size: skewSize
    });
  } else {
    skewNarrative = T('deck.skew.none', { min: CERA_SKEW_RULE.minPeople, size: skewSize });
  }

  return {
    hasFunnel: !!bestFunnel || (isValid(m.topFunnelOU) && funnelHHI > 0),
    funnelOU: funnelOU,
    funnelDomain: funnelDomain,
    funnelHHI: funnelHHI,
    funnelHHIStr: Math.round(funnelHHI * 100) + '%',
    funnelNarrative: funnelNarrative,
    hasScatter: !!bestScatter || (isValid(m.topScatterOU) && scatterCount > 0),
    scatterOU: scatterOU,
    scatterCount: scatterCount,
    scatterNarrative: scatterNarrative,
    hasSkew: hasSkew,
    skewOU: skewOU,
    skewRatio: skewRatio,
    skewPct: skewPct,
    skewTitle: skewTitle,
    skewNarrative: skewNarrative
  };
}

/**
 * Computes deep timeline, directional breakdown, outlier velocity spikes, and actor matrices
 * for a specific threat vector.
 *
 * @param {Object} vectorTimeline - Map of 'YYYY-MM-DD' => { uploadBytes, downloadBytes, printBytes, totalBytes, uploadCount, downloadCount, printCount, totalEvents }
 * @param {Object} vectorActors - Map of userIdent => { user, ou, uploadBytes, downloadBytes, printBytes, totalBytes, uploadCount, downloadCount, printCount, totalEvents }
 * @param {string} lang - report language of the dates and labels (default English)
 * @return {Object} Structured vector timeline analytics
 */
function computeVectorTimelineAnalytics(vectorTimeline, vectorActors, lang) {
  vectorTimeline = vectorTimeline || {};
  vectorActors = vectorActors || {};
  lang = lang || 'en';
  const notRecorded = ceraT('deck.notRecorded', null, lang);

  // 1. Sorted Timeline Series
  const dates = Object.keys(vectorTimeline).sort();
  const timelineSeries = [];
  let sumBytes = 0;
  let sumEvents = 0;

  dates.forEach(d => {
    const item = vectorTimeline[d] || {};
    const evts = (item.totalEvents !== undefined && item.totalEvents !== null) ? item.totalEvents : (item.totalCount || 0);
    sumBytes += (item.totalBytes || 0);
    sumEvents += evts;
    const dispDate = typeof formatDisplayDate === 'function' ? formatDisplayDate(d, true, lang) : d;
    timelineSeries.push({
      date: d,
      displayDate: dispDate,
      uploadGb: (item.uploadBytes || 0) / (1024 ** 3),
      downloadGb: (item.downloadBytes || 0) / (1024 ** 3),
      printGb: (item.printBytes || 0) / (1024 ** 3),
      totalGb: (item.totalBytes || 0) / (1024 ** 3),
      uploadCount: item.uploadCount || 0,
      downloadCount: item.downloadCount || 0,
      printCount: item.printCount || 0,
      totalEvents: evts
    });
  });

  const dayCount = dates.length || 1;
  const avgDailyBytes = sumBytes / dayCount;
  const avgDailyEvents = sumEvents / dayCount;

  // 2. Velocity Spikes (Top 3 Days by Volume / Event Surges)
  const sortedDaysByVol = [...timelineSeries].sort((a, b) => b.totalGb - a.totalGb);
  const topSpikes = sortedDaysByVol.slice(0, 3).map(sp => {
    const burstMultiple = avgDailyBytes > 0 ? ((sp.totalGb * (1024 ** 3)) / avgDailyBytes) : 1.0;
    let dominantDir = 'upload';
    let maxDirVal = sp.uploadGb;
    if (sp.downloadGb > maxDirVal) {
      dominantDir = 'download';
      maxDirVal = sp.downloadGb;
    }
    if (sp.printGb > maxDirVal) {
      dominantDir = 'print';
      maxDirVal = sp.printGb;
    }
    return {
      date: sp.displayDate || sp.date,
      rawDate: sp.date,
      totalGb: sp.totalGb,
      totalEvents: sp.totalEvents,
      burstMultiple: burstMultiple,
      dominantDirection: ceraT('report.direction.' + dominantDir, null, lang),
      uploadGb: sp.uploadGb,
      downloadGb: sp.downloadGb,
      printGb: sp.printGb
    };
  });

  // 3. User Actors Ranking (Top 10 by total volume, plus directional splits and OU)
  const actorList = Object.values(vectorActors);
  actorList.sort((a, b) => (b.totalBytes || 0) - (a.totalBytes || 0));
  const top10Actors = actorList.slice(0, 10).map((act, idx) => {
    return {
      rank: idx + 1,
      user: act.user || notRecorded,
      ou: act.ou || notRecorded,
      uploadGb: (act.uploadBytes || 0) / (1024 ** 3),
      downloadGb: (act.downloadBytes || 0) / (1024 ** 3),
      printGb: (act.printBytes || 0) / (1024 ** 3),
      totalGb: (act.totalBytes || 0) / (1024 ** 3),
      uploadCount: act.uploadCount || 0,
      downloadCount: act.downloadCount || 0,
      printCount: act.printCount || 0,
      totalEvents: act.totalEvents || 0
    };
  });

  // 4. Centered Outlier Context Window (±7 days around peak outlier)
  const topSpike = topSpikes.length > 0 ? topSpikes[0] : null;
  const peakDateStr = topSpike ? topSpike.rawDate : (dates.length > 0 ? dates[0] : null);
  const outlierTimelineSeries = computeOutlierContextTimeline(vectorTimeline, peakDateStr, 7, lang);

  // 5. Top 5 Actors Granular Daily Timelines (Centered on peak outlier corridor)
  const top5ActorTimelines = computeTop5ActorTimelines({ key: 'dlp', timeline: vectorTimeline, actors: vectorActors }, peakDateStr, lang);

  return {
    timelineSeries: timelineSeries,
    outlierTimelineSeries: outlierTimelineSeries,
    topSpikes: topSpikes,
    top10Actors: top10Actors,
    top5ActorTimelines: top5ActorTimelines,
    avgDailyBytes: avgDailyBytes,
    avgDailyEvents: avgDailyEvents
  };
}

/**
 * Computes Specialized Anomaly & Timeline Analytics for Threat Vector 5: Security Signals Radar
 * Focuses on Incident Rates, User Exposure, Warning Bypass Velocity, and Target Attack Surfaces.
 */
function computeSecurityRadarAnalytics(radar, lang) {
  if (!radar) return null;
  lang = lang || 'en';
  const notRecorded = ceraT('deck.notRecorded', null, lang);

  // 1. Chronological Timeline Analysis
  const dates = Object.keys(radar.timeline || {}).sort();
  let sumIncidents = 0;
  let sumBypasses = 0;
  const timelineSeries = dates.map(dStr => {
    const entry = radar.timeline[dStr];
    const total = entry.total || (entry.unsafe + entry.password + entry.malware) || 0;
    sumIncidents += total;
    sumBypasses += (entry.bypassed || 0);
    return {
      date: dStr,
      displayDate: typeof formatDisplayDate === 'function' ? formatDisplayDate(dStr, false, lang) : dStr,
      unsafe: entry.unsafe || 0,
      password: entry.password || 0,
      malware: entry.malware || 0,
      bypassed: entry.bypassed || 0,
      warned: entry.warned || 0,
      blocked: entry.blocked || 0,
      unreported: entry.unreported || 0,
      total: total
    };
  });

  const dayCount = Math.max(1, timelineSeries.length);
  const avgDailyIncidents = sumIncidents / dayCount;

  // 2. Incident Velocity Spikes (Top 3 Days by Incident Volume)
  const sortedDays = [...timelineSeries].sort((a, b) => b.total - a.total);
  const topSpikes = sortedDays.slice(0, 3).map(sp => {
    const burstMultiple = avgDailyIncidents > 0 ? (sp.total / avgDailyIncidents) : 1.0;
    let dominantSignal = 'unsafe';
    let maxSig = sp.unsafe;
    if (sp.password > maxSig) {
      dominantSignal = 'password';
      maxSig = sp.password;
    }
    if (sp.malware > maxSig) {
      dominantSignal = 'malware';
      maxSig = sp.malware;
    }
    dominantSignal = ceraT('report.signal.' + dominantSignal, null, lang);
    return {
      date: sp.displayDate || sp.date,
      rawDate: sp.date,
      total: sp.total,
      unsafe: sp.unsafe,
      password: sp.password,
      malware: sp.malware,
      bypassed: sp.bypassed,
      burstMultiple: burstMultiple,
      dominantSignal: dominantSignal
    };
  });

  // 3. Top 10 Impacted Organizational Units
  const ouEntries = Object.entries(radar.ous || {}).sort((a, b) => b[1] - a[1]);
  const top10OUs = ouEntries.slice(0, 10).map((entry, idx) => {
    const ouName = entry[0];
    const totalHits = entry[1];
    const unsafeHits = (radar.signals && radar.signals.unsafeSiteVisit && radar.signals.unsafeSiteVisit.ous[ouName]) || 0;
    const pwdHits = (radar.signals && radar.signals.passwordReuse && radar.signals.passwordReuse.ous[ouName]) || 0;
    const malHits = (radar.signals && radar.signals.malwareTransfer && radar.signals.malwareTransfer.ous[ouName]) || 0;
    const pct = radar.totalIncidents > 0 ? ((totalHits / radar.totalIncidents) * 100).toFixed(1) + '%' : '0.0%';
    return {
      rank: idx + 1,
      ou: ouName,
      incidents: totalHits,
      unsafe: unsafeHits,
      password: pwdHits,
      malware: malHits,
      pctOfTotal: pct
    };
  });

  // 4. Top 10 Credential Exposure & High-Risk Endpoints
  const pwdDomains = (radar.signals && radar.signals.passwordReuse && radar.signals.passwordReuse.domains) || {};
  const sortedDestinations = Object.entries(pwdDomains).sort((a, b) => {
    const aHits = typeof a[1] === 'object' ? (a[1].total || 0) : (a[1] || 0);
    const bHits = typeof b[1] === 'object' ? (b[1].total || 0) : (b[1] || 0);
    return bHits - aHits;
  });
  const top10Destinations = sortedDestinations.slice(0, 10).map((entry, idx) => {
    const hits = typeof entry[1] === 'object' ? (entry[1].total || 0) : (entry[1] || 0);
    return {
      rank: idx + 1,
      destination: entry[0],
      hits: hits,
      signal: ceraT('report.signal.password', null, lang)
    };
  });

  // 5. Intercepted Malware Payload Binaries
  const malFiles = (radar.signals && radar.signals.malwareTransfer && radar.signals.malwareTransfer.files) || {};
  const sortedFiles = Object.entries(malFiles).sort((a, b) => {
    const aHits = typeof a[1] === 'object' ? (a[1].total || 0) : (a[1] || 0);
    const bHits = typeof b[1] === 'object' ? (b[1].total || 0) : (b[1] || 0);
    return bHits - aHits;
  });
  const topMalwareFiles = sortedFiles.slice(0, 10).map((entry, idx) => {
    const hits = typeof entry[1] === 'object' ? (entry[1].total || 0) : (entry[1] || 0);
    return {
      rank: idx + 1,
      fileName: entry[0],
      hits: hits
    };
  });

  // 6. User Actors Exposure (Top 10 Actors)
  const actorEntries = Object.values(radar.actors || {}).sort((a, b) => (b.total || 0) - (a.total || 0));
  const top10Actors = actorEntries.slice(0, 10).map((act, idx) => {
    return {
      rank: idx + 1,
      user: act.user || notRecorded,
      ou: act.ou || notRecorded,
      unsafe: act.unsafe || 0,
      password: act.password || 0,
      malware: act.malware || 0,
      total: act.total || 0,
      bypassed: act.bypassed || 0
    };
  });

  // 7. Security Enforcement Efficiency
  const totalEnforced = (radar.bypassCount || 0) + (radar.warnedCount || 0);
  const bypassRate = totalEnforced > 0 ? (((radar.bypassCount || 0) / totalEnforced) * 100).toFixed(1) : '0.0';
  // False when no incident carried an Event Result: the bypass rate is then unknown, not 0%
  const resultReported = (radar.totalIncidents || 0) - (radar.unreportedCount || 0) > 0;

  // 8. Centered Outlier Context Window (±7 days around peak incident date)
  const topSpike = topSpikes.length > 0 ? topSpikes[0] : null;
  const peakRadarDateStr = topSpike ? topSpike.rawDate : (dates.length > 0 ? dates[0] : null);
  const outlierTimelineSeries = computeSecurityRadarOutlierContextTimeline(radar.timeline, peakRadarDateStr, 7, lang);

  return {
    timelineSeries: timelineSeries,
    outlierTimelineSeries: outlierTimelineSeries,
    topSpikes: topSpikes,
    top10OUs: top10OUs,
    top10Destinations: top10Destinations,
    topMalwareFiles: topMalwareFiles,
    top10Actors: top10Actors,
    avgDailyIncidents: avgDailyIncidents,
    bypassRatePct: bypassRate,
    resultReported: resultReported,
    detailedBreakdown: computeDetailedSecurityRadarBreakdown(radar, lang),
    top5ActorTimelines: computeTop5ActorTimelines(radar, peakRadarDateStr, lang)
  };
}

/**
 * Computes granular day-by-day chronological timeline trajectories for the Top 5 Actors
 * of any given threat vector, calculating personal baseline velocity and outlier burst multiples.
 */
function computeTop5ActorTimelines(vector, peakDateStr, lang) {
  if (!vector || !vector.actors) return [];
  lang = lang || 'en';
  const actorList = Object.values(vector.actors);
  const isSecurity = vector.key === 'securityRadar';

  // Sort actors descending by volume (for DLP) or incidents/events (for Security Radar)
  if (isSecurity) {
    actorList.sort((a, b) => (b.total || b.totalEvents || 0) - (a.total || a.totalEvents || 0));
  } else {
    actorList.sort((a, b) => (b.totalBytes || 0) - (a.totalBytes || 0));
  }

  const top5 = actorList.slice(0, 5);
  let vectorDates = Object.keys(vector.timeline || {}).sort();
  if (vectorDates.length === 0) {
    const dSet = new Set();
    actorList.forEach(a => {
      Object.keys(a.timeline || {}).forEach(d => dSet.add(d));
    });
    vectorDates = Array.from(dSet).sort();
  }

  // Derive peakDateStr if not explicitly supplied
  if (!peakDateStr) {
    let maxMetric = -1;
    vectorDates.forEach(dKey => {
      const vItem = (vector.timeline && vector.timeline[dKey]) || {};
      const metric = vItem.totalBytes !== undefined ? vItem.totalBytes : (vItem.total || vItem.totalCount || 0);
      if (metric > maxMetric) {
        maxMetric = metric;
        peakDateStr = dKey;
      }
    });
  }

  // Build the continuous 15-day outlier window (7 days before, peak day, 7 days after)
  let windowDates = [];
  const m = String(peakDateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const peakYear = parseInt(m[1], 10);
    const peakMonth = parseInt(m[2], 10) - 1;
    const peakDay = parseInt(m[3], 10);
    for (let offset = -7; offset <= 7; offset++) {
      const d = new Date(Date.UTC(peakYear, peakMonth, peakDay + offset));
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      windowDates.push(`${yyyy}-${mm}-${dd}`);
    }
  } else {
    windowDates = vectorDates;
  }

  return top5.map((act, idx) => {
    const actTimeline = act.timeline || {};
    let sumVol = 0;
    let sumEvts = 0;
    let peakDate = '-';
    let maxMetric = 0;
    // A signal (report.signal.*) or a direction (report.direction.*) of the peak day
    let dominantAction = '';

    // Scan full actor timeline to find true peak date and dominant action
    Object.keys(actTimeline).forEach(dKey => {
      const dayData = actTimeline[dKey] || {};
      const displayDate = typeof formatDisplayDate === 'function' ? formatDisplayDate(dKey, false, lang) : dKey;
      if (isSecurity) {
        const unsafe = dayData.unsafe || 0;
        const password = dayData.password || 0;
        const malware = dayData.malware || 0;
        const total = dayData.total || (unsafe + password + malware) || 0;
        if (total > maxMetric) {
          maxMetric = total;
          peakDate = displayDate;
          if (unsafe >= password && unsafe >= malware) dominantAction = 'unsafe';
          else if (password >= unsafe && password >= malware) dominantAction = 'password';
          else dominantAction = 'malware';
        }
      } else {
        const upBytes = dayData.uploadBytes || 0;
        const downBytes = dayData.downloadBytes || 0;
        const printBytes = dayData.printBytes || 0;
        const totBytes = dayData.totalBytes || (upBytes + downBytes + printBytes) || 0;
        const totGb = totBytes / (1024 ** 3);
        if (totGb > maxMetric) {
          maxMetric = totGb;
          peakDate = displayDate;
          const upGb = upBytes / (1024 ** 3);
          const downGb = downBytes / (1024 ** 3);
          const printGb = printBytes / (1024 ** 3);
          if (upGb >= downGb && upGb >= printGb) dominantAction = 'upload';
          else if (downGb >= upGb && downGb >= printGb) dominantAction = 'download';
          else dominantAction = 'print';
        }
      }
    });

    // Construct the continuous 15-day corridor rows [T_peak - 7, T_peak + 7]
    const dailyRows = windowDates.map(dStr => {
      const dayData = actTimeline[dStr] || {};
      const displayDate = typeof formatDisplayDate === 'function' ? formatDisplayDate(dStr, false, lang) : dStr;

      if (isSecurity) {
        const unsafe = dayData.unsafe || 0;
        const password = dayData.password || 0;
        const malware = dayData.malware || 0;
        const total = dayData.total || (unsafe + password + malware) || 0;
        const bypassed = dayData.bypassed || 0;
        const warned = dayData.warned || 0;

        sumVol += total;
        sumEvts += total;

        return {
          date: dStr,
          displayDate: displayDate,
          unsafe: unsafe,
          password: password,
          malware: malware,
          total: total,
          bypassed: bypassed,
          warned: warned
        };
      } else {
        const upBytes = dayData.uploadBytes || 0;
        const downBytes = dayData.downloadBytes || 0;
        const printBytes = dayData.printBytes || 0;
        const totBytes = dayData.totalBytes || (upBytes + downBytes + printBytes) || 0;

        const upGb = upBytes / (1024 ** 3);
        const downGb = downBytes / (1024 ** 3);
        const printGb = printBytes / (1024 ** 3);
        const totGb = totBytes / (1024 ** 3);

        const upEvts = dayData.uploadCount || 0;
        const downEvts = dayData.downloadCount || 0;
        const printEvts = dayData.printCount || 0;
        const totEvts = dayData.totalEvents || (upEvts + downEvts + printEvts) || 0;

        sumVol += totGb;
        sumEvts += totEvts;

        return {
          date: dStr,
          displayDate: displayDate,
          uploadGb: upGb,
          downloadGb: downGb,
          printGb: printGb,
          totalGb: totGb,
          uploadCount: upEvts,
          downloadCount: downEvts,
          printCount: printEvts,
          totalEvents: totEvts
        };
      }
    });

    const activeDays = Math.max(1, Object.keys(actTimeline).length);
    const totalMetric = isSecurity ? (act.totalEvents || act.total || sumEvts) : ((act.totalBytes || 0) / (1024 ** 3));
    const avgDailyMetric = totalMetric / activeDays;
    const burstMultiple = avgDailyMetric > 0 ? (maxMetric / avgDailyMetric) : 1.0;

    const notRecorded = ceraT('deck.notRecorded', null, lang);
    const firstDay = windowDates.length > 0 && typeof formatDisplayDate === 'function' ? formatDisplayDate(windowDates[0], false, lang) : (windowDates[0] || '-');
    return {
      rank: idx + 1,
      user: act.user || notRecorded,
      ou: act.ou || notRecorded,
      totalGb: (act.totalBytes || 0) / (1024 ** 3),
      totalEvents: act.totalEvents || act.total || 0,
      peakDate: peakDate !== '-' ? peakDate : firstDay,
      maxDayMetric: maxMetric,
      burstMultiple: burstMultiple,
      dominantAction: isSecurity
        ? ceraT('report.signal.' + (dominantAction || 'unsafe'), null, lang)
        : ceraT('report.direction.' + (dominantAction || 'upload'), null, lang),
      dailyRows: dailyRows
    };
  });
}

/**
 * Computes granular forensic tables for the 3 distinct signals of Threat Vector 5: Security Signals Radar
 */
function computeDetailedSecurityRadarBreakdown(radar, lang) {
  if (!radar) return null;
  const signals = radar.signals || radar;
  if (!signals.unsafeSiteVisit && !signals.passwordReuse && !signals.malwareTransfer) return null;
  // A host or file the log left empty, in the report language
  const notRecorded = ceraT('deck.notRecorded', null, lang || 'en');

  // 1. Unsafe Site Visits Breakdown
  const u = signals.unsafeSiteVisit || {};
  const unsafeReasons = Object.entries(u.reasons || {}).map(([reason, count]) => {
    const pct = u.total > 0 ? ((count / u.total) * 100).toFixed(1) + '%' : '0.0%';
    let desc = 'SSL/TLS certificate error or expired cert';
    if (reason.includes('SOCIAL_ENGINEERING')) desc = 'Phishing or deceptive domain';
    else if (reason.includes('MALWARE')) desc = 'Malicious domain blacklisted by Google Safe Browsing';
    return { reason, count, pct, description: desc };
  }).sort((a, b) => b.count - a.count);

  const unsafeEndpoints = Object.entries(u.domains || {}).map(([domain, data]) => {
    const total = typeof data === 'object' ? data.total : data;
    const warned = typeof data === 'object' ? data.warned : 0;
    const bypassed = typeof data === 'object' ? data.bypassed : 0;
    const blocked = typeof data === 'object' ? (data.blocked || 0) : 0;
    const unreported = typeof data === 'object' ? (data.unreported || 0) : 0;
    const isIp = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(domain.trim());
    let type = 'External Web Destination';
    if (isIp) {
      type = 'Direct IP Address';
    } else if ((radar.internalDomains && radar.internalDomains[domain]) || (signals.internalDomains && signals.internalDomains[domain])) {
      type = 'Corporate Managed Domain';
    }
    const cleanDomain = domain || notRecorded;
    // Per event: warnings shown are the heeded and the bypassed ones; the bar is the host's events, split into
    // click-throughs, heeded warnings and events with no warning shown (blocked, detected, not reported)
    const shown = (warned || 0) + (bypassed || 0);
    return {
      domain: cleanDomain,
      name: isIp ? (cleanDomain + ' [Direct IP]') : cleanDomain,
      total: total || 0,
      count: total || 0,
      warned: warned || 0,
      bypassed: bypassed || 0,
      shown: shown,
      blocked: blocked,
      unreported: unreported,
      bypassedCount: bypassed || 0,
      warnedCount: warned || 0,
      volumeGb: total || 0,      // Bar length: the host's events
      uploadGb: bypassed || 0,   // Segment 1 (Rose: Bypassed Overrides)
      downloadGb: warned || 0,   // Segment 2 (Blue: Warning Heeded)
      printGb: Math.max(0, (total || 0) - shown), // Segment 3 (Amber: no warning shown)
      bypassRate: (warned + bypassed > 0) ? (((bypassed) / (warned + bypassed)) * 100).toFixed(1) + '%' : '0.0%',
      type: type
    };
  }).sort((a, b) => b.total - a.total);

  const unsafeOUs = Object.entries(u.ous || {}).map(([ou, count]) => {
    const pct = u.total > 0 ? ((count / u.total) * 100).toFixed(1) + '%' : '0.0%';
    return { ou, count, pct };
  }).sort((a, b) => b.count - a.count);

  // 2. Password Reuse Breakdown
  const p = signals.passwordReuse || {};
  const passwordDestinations = Object.entries(p.domains || {}).map(([domain, data]) => {
    const total = typeof data === 'object' ? data.total : data;
    const isMeta = domain.includes('facebook.com') || domain.includes('messenger.com');
    const isIp = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(domain.trim());
    const isInternal = ((p.internalDomains && p.internalDomains[domain]) || (signals.internalDomains && signals.internalDomains[domain]));
    let classification = 'External Web Service';
    if (isIp) {
      classification = 'Direct IP Address';
    } else if (isMeta) {
      classification = 'Consumer Social Network (Meta)';
    } else if (isInternal) {
      classification = 'Unmanaged Internal Portal (SSO Gap)';
    }

    return {
      domain: domain || notRecorded,
      total: total || 0,
      classification: classification
    };
  }).sort((a, b) => b.total - a.total);

  // 3. Malware Transfer Breakdown
  const m = signals.malwareTransfer || {};
  const malwareFiles = Object.entries(m.files || {}).map(([fileName, data]) => {
    const total = typeof data === 'object' ? data.total : data;
    const warned = typeof data === 'object' ? data.warned : 0;
    const bypassed = typeof data === 'object' ? data.bypassed : 0;
    const domain = (typeof data === 'object' && data.domain) ? data.domain : notRecorded;
    const isWarez = fileName.toLowerCase().includes('reset') || fileName.toLowerCase().includes('rar') || fileName.toLowerCase().includes('crack');
    return {
      fileName: fileName || notRecorded,
      total: total || 0,
      warned: warned || 0,
      bypassed: bypassed || 0,
      domain: domain,
      threatProfile: isWarez ? 'Warez / Hardware Reset Crack' : 'Dangerous Binary Config'
    };
  }).sort((a, b) => b.total - a.total);

  const overallBypassRate = (u.warned + u.bypassed > 0)
    ? (((u.bypassed) / (u.warned + u.bypassed)) * 100).toFixed(1) + '%'
    : (u.total > 0 && u.bypassed > 0 ? ((u.bypassed / u.total) * 100).toFixed(1) + '%' : '0.0%');

  // Heeded warnings are visits whose result was WARNED. Blocked visits offered nothing to heed or bypass, and
  // visits without a reported result are not assumed to be either.
  const unsafeTotal = u.total || 0;
  const unsafeUnreported = u.unreported || 0;
  return {
    unsafeReasons: unsafeReasons,
    unsafeEndpoints: unsafeEndpoints,
    unsafeOUs: unsafeOUs,
    warnedCount: u.warned || 0,
    bypassedCount: u.bypassed || 0,
    blockedCount: u.blocked || 0,
    unreportedCount: unsafeUnreported,
    // Visits whose Event Result was logged; 0 means the logs say nothing about bypasses
    reportedCount: Math.max(0, unsafeTotal - unsafeUnreported),
    overallBypassRate: overallBypassRate,
    passwordDestinations: passwordDestinations,
    malwareFiles: malwareFiles,
    malwareResultReported: (m.total || 0) - (m.unreported || 0) > 0,
    sampleUrls: {
      unsafe: u.sampleUrls || [],
      password: p.sampleUrls || [],
      malware: m.sampleUrls || []
    }
  };
}

/**
 * Constructs a centered ±N-day chronological context window around a peak outlier date (e.g. T_peak ± 7 days).
 * Guarantees a continuous 15-day corridor (7 days before, peak day, 7 days after) for visualizing outlier ramp-up and aftermath.
 */
function computeOutlierContextTimeline(vectorTimeline, peakDateStr, windowDays, lang) {
  windowDays = windowDays || 7;
  if (!peakDateStr) return [];

  const m = String(peakDateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return [];
  const peakYear = parseInt(m[1], 10);
  const peakMonth = parseInt(m[2], 10) - 1;
  const peakDay = parseInt(m[3], 10);
  const result = [];
  for (let offset = -windowDays; offset <= windowDays; offset++) {
    const d = new Date(Date.UTC(peakYear, peakMonth, peakDay + offset));
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const item = (vectorTimeline && vectorTimeline[dateStr]) || {};
    const evts = (item.totalEvents !== undefined && item.totalEvents !== null) ? item.totalEvents : (item.totalCount || 0);
    const dispDate = typeof formatDisplayDate === 'function' ? formatDisplayDate(dateStr, false, lang) : dateStr;

    result.push({
      date: dateStr,
      displayDate: dispDate,
      uploadGb: (item.uploadBytes || 0) / (1024 ** 3),
      downloadGb: (item.downloadBytes || 0) / (1024 ** 3),
      printGb: (item.printBytes || 0) / (1024 ** 3),
      totalGb: (item.totalBytes || 0) / (1024 ** 3),
      uploadCount: item.uploadCount || 0,
      downloadCount: item.downloadCount || 0,
      printCount: item.printCount || 0,
      totalEvents: evts,
      isPeak: (offset === 0),
      offsetDays: offset
    });
  }
  return result;
}

/**
 * Constructs a centered ±N-day chronological context window for Security Radar around peak incident date.
 */
function computeSecurityRadarOutlierContextTimeline(radarTimeline, peakDateStr, windowDays, lang) {
  windowDays = windowDays || 7;
  if (!peakDateStr) return [];

  const m = String(peakDateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return [];
  const peakYear = parseInt(m[1], 10);
  const peakMonth = parseInt(m[2], 10) - 1;
  const peakDay = parseInt(m[3], 10);

  const result = [];
  for (let offset = -windowDays; offset <= windowDays; offset++) {
    const d = new Date(Date.UTC(peakYear, peakMonth, peakDay + offset));
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const entry = (radarTimeline && radarTimeline[dateStr]) || {};
    const total = entry.total || (entry.unsafe + entry.password + entry.malware) || 0;
    const dispDate = typeof formatDisplayDate === 'function' ? formatDisplayDate(dateStr, false, lang) : dateStr;

    result.push({
      date: dateStr,
      displayDate: dispDate,
      unsafe: entry.unsafe || 0,
      password: entry.password || 0,
      malware: entry.malware || 0,
      bypassed: entry.bypassed || 0,
      warned: entry.warned || 0,
      blocked: entry.blocked || 0,
      unreported: entry.unreported || 0,
      total: total,
      isPeak: (offset === 0),
      offsetDays: offset
    });
  }
  return result;
}

/**
 * Constructs a centralized multi-vector outlier timeline corridor [T_peak - windowDays, T_peak + windowDays]
 * aggregating daily payload metrics for Personal Accounts, Shadow AI, Unmanaged Apps, Web Messaging, and Security Radar.
 */
function computeCrossVectorOutlierTimeline(vectors, peakDateStr, windowDays, lang) {
  windowDays = windowDays || 7;
  if (!vectors) return [];

  // Derive or parse peakDateStr
  let m = String(peakDateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) {
    let maxMetric = -1;
    let foundPeak = null;
    for (let k in vectors) {
      const v = vectors[k];
      for (let dKey in (v.timeline || {})) {
        const item = v.timeline[dKey];
        const val = item.totalBytes !== undefined ? item.totalBytes : (item.total || 0);
        if (val > maxMetric && /^(\d{4})-(\d{2})-(\d{2})/.test(dKey)) {
          maxMetric = val;
          foundPeak = dKey;
        }
      }
    }
    if (foundPeak) {
      peakDateStr = foundPeak;
      m = String(peakDateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
    }
  }

  if (!m) return [];
  const peakYear = parseInt(m[1], 10);
  const peakMonth = parseInt(m[2], 10) - 1;
  const peakDay = parseInt(m[3], 10);

  const personalTimeline = (vectors.personal && vectors.personal.timeline) || {};
  const shadowTimeline = (vectors.shadowAi && vectors.shadowAi.timeline) || {};
  const unmanagedTimeline = (vectors.unmanaged && vectors.unmanaged.timeline) || {};
  const messagingTimeline = (vectors.messaging && vectors.messaging.timeline) || {};
  const radarTimeline = (vectors.securityRadar && vectors.securityRadar.timeline) || {};

  const result = [];
  for (let offset = -windowDays; offset <= windowDays; offset++) {
    const d = new Date(Date.UTC(peakYear, peakMonth, peakDay + offset));
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const dispDate = typeof formatDisplayDate === 'function' ? formatDisplayDate(dateStr, false, lang) : dateStr;

    const pItem = personalTimeline[dateStr] || {};
    const sItem = shadowTimeline[dateStr] || {};
    const uItem = unmanagedTimeline[dateStr] || {};
    const mItem = messagingTimeline[dateStr] || {};
    const rItem = radarTimeline[dateStr] || {};

    const pGb = (pItem.totalBytes || 0) / (1024 ** 3);
    const sGb = (sItem.totalBytes || 0) / (1024 ** 3);
    const uGb = (uItem.totalBytes || 0) / (1024 ** 3);
    const mGb = (mItem.totalBytes || 0) / (1024 ** 3);
    const totalDlpGb = pGb + sGb + uGb + mGb;

    const radarIncidents = rItem.total || ((rItem.unsafe || 0) + (rItem.password || 0) + (rItem.malware || 0)) || 0;

    result.push({
      date: dateStr,
      displayDate: dispDate,
      personalGb: pGb,
      shadowGb: sGb,
      unmanagedGb: uGb,
      messagingGb: mGb,
      totalDlpGb: totalDlpGb,
      radarIncidents: radarIncidents,
      isPeak: (offset === 0),
      offsetDays: offset
    });
  }
  return result;
}


