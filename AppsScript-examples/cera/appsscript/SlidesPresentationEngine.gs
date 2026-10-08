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
 * Module: SlidesPresentationEngine.gs (Compiled from CERA Visual Slide Studio)
 * Standard: 16:9 Widescreen (720 × 405 pt PostScript Coordinate System)
 * ==============================================================================
 */

/**
 * The deck is about data leaving the organization. When a map carries outbound (egress) figures,
 * rank and size its entries by outbound volume only (uploads, paste, print), so downloads such as
 * software installers never top a risk list. Maps without any egress data are returned unchanged.
 * Download detail stays available in the Sheets report.
 */
function deckEgressView_(map) {
  if (!map || typeof map !== 'object') return map;
  const keys = Object.keys(map);
  if (!keys.some(k => map[k] && typeof map[k] === 'object' && Number(map[k].egressBytes) > 0)) return map;
  const out = {};
  keys.forEach(k => {
    const e = map[k];
    if (!e || typeof e !== 'object' || !(Number(e.egressBytes) > 0)) return;
    out[k] = Object.assign({}, e, {
      totalBytes: Number(e.egressBytes) || 0,
      bytes: Number(e.egressBytes) || 0,
      count: Number(e.egressCount) || 0,
      downloadBytes: 0,
      downloadCount: 0
    });
  });
  return out;
}

var ExecutivePresentationEngine = {
  currentSpreadsheet: null,

  getPalette() {
    return {
      "bg": "#EFF6FF",
      "cardBg": "#FFFFFF",
      "cardBgSub": "#FFFFFF",
      "cardBgSoft": "#EFF6FF",
      "border": "#E2E8F0",
      "borderSub": "#CBD5E1",
      "textDark": "#0F172A",
      "textBody": "#334155",
      "textMuted": "#64748B",
      "primary": "#2563EB",
      "primaryLight": "#EFF6FF",
      "primaryBorder": "#BFDBFE",
      "rose": "#DC2626",
      "roseLight": "#FFF1F2",
      "roseBorder": "#FECDD3",
      "amber": "#D97706",
      "amberLight": "#FFFBEB",
      "amberBorder": "#FDE68A",
      "blue": "#0284C7",
      "blueLight": "#F0F9FF",
      "blueBorder": "#BAE6FD",
      "emerald": "#059669",
      "emeraldLight": "#ECFDF5",
      "emeraldBorder": "#A7F3D0",
      "purple": "#7C3AED",
      "purpleLight": "#FAF5FF",
      "purpleBorder": "#DDD6FE"
};
  },

  addCard(slide, x, y, w, h, bgHex, borderHex, radius, opacity, borderWidth) {
    const shapeType = (radius && radius > 0) ? (SlidesApp.ShapeType.ROUND_RECTANGLE || SlidesApp.ShapeType.RECTANGLE) : SlidesApp.ShapeType.RECTANGLE;
    const card = slide.insertShape(shapeType, x, y, Math.max(4, w), Math.max(4, h));
    if (bgHex === 'transparent' || !bgHex) {
      card.getFill().setTransparent();
    } else if (typeof opacity === 'number' && opacity >= 0 && opacity <= 1.0) {
      card.getFill().setSolidFill(bgHex, opacity);
    } else {
      card.getFill().setSolidFill(bgHex || '#FFFFFF');
    }
    if (borderHex === 'transparent' || !borderHex) {
      card.getBorder().setTransparent();
    } else {
      card.getBorder().getLineFill().setSolidFill(borderHex);
      card.getBorder().setWeight(typeof borderWidth === 'number' ? borderWidth : 1);
    }
    return card;
  },

  addTextBox(slide, text, x, y, w, h, font, size, weight, color, align) {
    // Slides cannot style a box with no text, and an empty box shows nothing: skip it (an unused recommendation
    // slot, a headline with no data)
    const str = text === null || text === undefined ? '' : String(text);
    if (!str) return null;
    const box = slide.insertTextBox(str, x, y, Math.max(10, w), Math.max(10, h));
    const ts = box.getText().getTextStyle();
    if (font) ts.setFontFamily(font);
    if (size) ts.setFontSize(size);
    if (weight === 'bold' || weight === 700) ts.setBold(true);
    if (color) ts.setForegroundColor(color);
    if (align) {
      const pa = align === 'center' ? SlidesApp.ParagraphAlignment.CENTER :
                 align === 'right' ? SlidesApp.ParagraphAlignment.END :
                 align === 'justify' ? SlidesApp.ParagraphAlignment.JUSTIFIED : SlidesApp.ParagraphAlignment.START;
      box.getText().getParagraphStyle().setParagraphAlignment(pa);
    }
    return box;
  },

  /**
   * Largest integer font size (max..min) at which text fits one line of the given width in points.
   * Estimate per character: CJK and full-width 1.0 em, capitals and digits 0.62 em, other glyphs 0.53 em.
   */
  fitFont(text, width, max, min) {
    const t = String(text || '');
    let ems = 0;
    for (const ch of t) {
      if (/[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch)) ems += 1.0;
      else if (/[A-Z0-9%@]/.test(ch)) ems += 0.62;
      else ems += 0.53;
    }
    for (let size = max; size > min; size--) {
      if (ems * size <= width) return size;
    }
    return min;
  },

  /**
   * A text box that must stay on one line (a label, a header, a card or chart title): its font shrinks from size, at
   * most down to minSize (60% of size by default), until the text fits the width of the box (fitFont). Labels run
   * longer in some languages than in English.
   */
  addLineBox(slide, text, x, y, w, h, font, size, weight, color, align, minSize) {
    const str = text === null || text === undefined ? '' : String(text);
    return this.addTextBox(slide, str, x, y, w, h, font, this.fitFont(str, w, size, minSize || Math.max(5, Math.round(size * 0.6 * 2) / 2)), weight, color, align);
  },

  /** A message of the deck's language (ctx._lang). */
  t_(ctx, key, params) {
    return ceraT(key, params, (ctx && ctx._lang) || 'en');
  },

  /**
   * The header of a content slide: the product name and the section (deck.header.*) on the left, the scope on the
   * right, both on one line.
   */
  addHeader_(slide, ctx, sectionKey, params, color) {
    this.addLineBox(slide, this.t_(ctx, sectionKey, params), 36, 12, 430, 16, 'Roboto', 8, 'bold', color || '#2563EB', 'left');
    this.addLineBox(slide, this.t_(ctx, 'deck.header.scope', { domain: ctx['{{primaryDomain}}'] }), 470, 12, 214, 16, 'Roboto', 8, 'bold', '#64748B', 'right');
  },

  buildDeck(state, corpDomains, dateRangeString, outlierMetrics, currentSs, targetPresentationId) {
    this.currentSpreadsheet = currentSs || null;
    const p = this.getPalette();
    const primaryDomain = (corpDomains && corpDomains[0]) || '';
    const title = primaryDomain ? 'Chrome Egress Risk Analysis — ' + primaryDomain : 'Chrome Egress Risk Analysis';

    let presentation;
    let oldSlides = [];
    if (targetPresentationId) {
      presentation = SlidesApp.openById(targetPresentationId);
      oldSlides = presentation.getSlides();
    } else {
      presentation = SlidesApp.create(title);
      oldSlides = presentation.getSlides();
    }
    const w = 720;
    const h = 405;

    // One outcome mode for the whole deck (ceraOutcomeMode): the cover note, every channel note and the
    // recommendations subtitle all read it, so a deck never mixes the enforced, audit and not-reported framings
    const mode = ceraOutcomeMode(state);
    const ctx = this.buildRuntimeContext(state, primaryDomain, dateRangeString, outlierMetrics, corpDomains, mode);
    ctx.state = state;
    ctx.outlierMetrics = outlierMetrics;

    // Story: headlines, vector gates and recommendations computed from the data (InsightEngine)
    const insights = InsightEngine.build(state, outlierMetrics, {
      lang: (state && state.reportLang) || 'en',
      dateRange: dateRangeString,
      authorizedGenAi: (state && state.scope && state.scope.authorizedGenAi) || [],
      mode: mode
    });
    ctx.insights = insights;
    ctx._recByTopic = insights.recByTopic || {};
    const hl = insights.headlines;
    Object.keys(hl).forEach(k => { ctx['{{hl_' + k + '}}'] = hl[k]; });
    const gate = insights.tiers;

    // Slide 1: Executive Cover Briefing
    this.buildSlide_slide_01(presentation, ctx, p, w, h, state, outlierMetrics);

    // Slide 2: Enterprise Threat Matrix: Cross-Channel Benchmark
    this.buildSlide_slide_02(presentation, ctx, p, w, h, state, outlierMetrics);

    // Slide 3: Behavioral Outliers: Velocity Bursts & Funneling
    this.buildSlide_slide_03(presentation, ctx, p, w, h, state, outlierMetrics);

    // Slide 4: Organizational & Endpoint Exposure
    this.buildSlide_slide_04(presentation, ctx, p, w, h, state, outlierMetrics);

    // Slides 5-12: the four data-transfer vectors. Overview when a vector has >= compactEvents outbound
    // transfers, deep-dive as well when it is 'full'; otherwise the vector stays a row on the threat matrix.
    const vectorSlides = [
      ['personal', 'buildSlide_slide_05', 'buildSlide_vector_01_deepdive'],
      ['shadowAi', 'buildSlide_slide_06', 'buildSlide_vector_02_deepdive'],
      ['unmanaged', 'buildSlide_slide_07', 'buildSlide_vector_03_deepdive'],
      ['messaging', 'buildSlide_slide_08', 'buildSlide_vector_04_deepdive']
    ];
    vectorSlides.forEach(([key, overview, deep]) => {
      if (gate[key] === 'row') return;
      this[overview](presentation, ctx, p, w, h, state, outlierMetrics);
      if (gate[key] === 'full') this[deep](presentation, ctx, p, w, h, state, outlierMetrics);
    });

    // Supporting signals: Safe Browsing, then password reuse and malicious files, only when recorded. Browser launches
    // with Chrome's own startup switches only (or whose switches the logs do not report) get one sentence at the foot of
    // the last of these slides, never a slide of their own; launches with other switches get the slide after them.
    const radarSlides = [];
    if (insights.facts.unsafeTotal > 0) radarSlides.push('signals');
    if (insights.facts.pwTotal + insights.facts.malTotal > 0) radarSlides.push('signals2');
    ctx._launchNoteOn = hl.launchNote ? (radarSlides[radarSlides.length - 1] || '') : '';
    if (insights.facts.unsafeTotal > 0) this.buildSlide_vector_05_browsing_integrity(presentation, ctx, p, w, h, state, outlierMetrics);
    if (insights.facts.pwTotal + insights.facts.malTotal > 0) this.buildSlide_slide_09(presentation, ctx, p, w, h, state, outlierMetrics);
    if (insights.facts.launches && insights.facts.launches.nonRoutine > 0) this.buildSlide_browser_launches(presentation, ctx, p, w, h);

    // Printing (physical channel): only with enough print jobs to say something
    if (insights.facts.printTotal >= (CeraConfig.PRINT_SLIDE_MIN || 20)) this.buildSlide_slide_10(presentation, ctx, p, w, h, state, outlierMetrics);

    // Slide 16: 3-Horizon Strategic Remediation Roadmap
    this.buildSlide_slide_11(presentation, ctx, p, w, h, state, outlierMetrics);

    if (oldSlides.length > 0) {
      oldSlides.forEach(s => { try { s.remove(); } catch (e) {} });
    }
    return presentation.getUrl();
  },

  /**
   * True when a label is a real name (not empty, "null", "undefined" or the analytics 'N/A' marker)
   */
  isValidName(name) {
    if (name === null || name === undefined) return false;
    const str = String(name).trim().toLowerCase();
    return str !== '' && str !== 'null' && str !== 'undefined' && str !== 'n/a';
  },

  /**
   * "host (kind)" for a list row: a browser page reads "chrome-untrusted:// (Browser page)", a local file "Local file",
   * any other destination its short label followed by its kind (External site, Internal host, Direct IP, ...).
   */
  destinationWithKind_(name, kind, ctx, maxLen) {
    const lang = (ctx && ctx._lang) || 'en';
    const kindText = ceraT('deck.hostKind.' + kind, null, lang);
    if (kind === 'local') return kindText;
    if (kind === 'browser') {
      const scheme = String(name || '').toLowerCase().match(/^[a-z][a-z0-9+.-]*/);
      return (scheme ? scheme[0] : 'chrome') + ':// (' + kindText + ')';
    }
    const label = ceraDestinationLabel(name, lang);
    const short = typeof VectorChartEngine !== 'undefined' ? VectorChartEngine.cleanLabel(label, maxLen || 26) : label;
    return short + ' (' + kindText + ')';
  },

  /**
   * Chart rows of destinations with their display labels (browser pages and local files by name, shared-hosting
   * sites by full host). ctx: the runtime context, for the deck language.
   */
  labelDestinations_(items, ctx) {
    const lang = (ctx && ctx._lang) || 'en';
    return (items || []).map(i => Object.assign({}, i, { name: ceraDestinationLabel(i.name, lang) }));
  },

  fmtBytes(bytes) {
    if (typeof formatBytes === 'function') return formatBytes(bytes || 0);
    return ((Number(bytes) || 0) / (1024 ** 3)).toFixed(2) + ' GB';
  },

  /**
   * 'YYYY-MM-DD' -> 'DD MON' (or 'DD MON YYYY'), independent of script timezone; in the calendar format of the report
   * language when lang is not English (formatDisplayDate)
   */
  shortDateLabel(dateStr, includeYear, lang) {
    const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return String(dateStr || '');
    if (lang && lang !== 'en') return formatDisplayDate(m[1] + '-' + m[2] + '-' + m[3], !!includeYear, lang);
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const base = m[3] + ' ' + (months[parseInt(m[2], 10) - 1] || m[2]);
    return includeYear ? base + ' ' + m[1] : base;
  },

  /**
   * Builds the real transfer-volume series from a daily map ('YYYY-MM-DD' -> { bytes, count }), such as
   * state.outliers.dailyEgress. Days are sorted and calendar-filled with zeros; more than 60 days are aggregated to
   * weeks (and more than 60 weeks to months). Peak-day statistics come from ceraPeakStats, the rule the deck
   * headline uses: peak day over the mean active day, by bytes or, when no transfer has a size, by count. lang: the
   * report language of the bucket labels.
   */
  buildVelocitySeries(dailyVolume, lang) {
    const result = {
      labels: [], bytes: [], counts: [], granularity: 'day', peakIdx: -1,
      totalBytes: 0, totalCount: 0, recordedDays: 0,
      peakDayKey: null, peakDayBytes: 0, peakDayCount: 0, burstMultiple: 0,
      basis: '', isPeak: false, peak: ceraPeakStats({})
    };
    const dv = dailyVolume || {};
    const keys = Object.keys(dv).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
    if (!keys.length) return result;

    const peak = ceraPeakStats(dv);
    result.peak = peak;
    result.basis = peak.basis;
    result.totalBytes = peak.totalBytes;
    result.totalCount = peak.totalCount;
    result.recordedDays = peak.activeDays;
    result.peakDayKey = peak.peakKey || null;
    result.peakDayBytes = peak.peakBytes;
    result.peakDayCount = peak.peakCount;
    result.burstMultiple = peak.multiple;
    result.isPeak = peak.isPeak;

    const toUtc = k => Date.UTC(parseInt(k.substr(0, 4), 10), parseInt(k.substr(5, 2), 10) - 1, parseInt(k.substr(8, 2), 10));
    const DAY_MS = 24 * 60 * 60 * 1000;
    const start = toUtc(keys[0]);
    const end = toUtc(keys[keys.length - 1]);
    const days = [];
    for (let t = start; t <= end && days.length < 3700; t += DAY_MS) {
      const k = new Date(t).toISOString().substring(0, 10);
      const e = dv[k] || {};
      days.push({ key: k, bytes: Number(e.bytes) || 0, count: Number(e.count) || 0 });
    }

    let gran = 'day';
    if (days.length > 60) gran = 'week';
    if (Math.ceil(days.length / 7) > 60) gran = 'month';
    result.granularity = gran;

    const buckets = [];
    days.forEach((d, i) => {
      let id, label;
      if (gran === 'day') {
        id = d.key;
        label = this.shortDateLabel(d.key, false, lang);
      } else if (gran === 'week') {
        const w = Math.floor(i / 7);
        id = 'w' + w;
        label = this.shortDateLabel(days[w * 7].key, false, lang);
      } else {
        id = d.key.substring(0, 7);
        label = ceraMonthLabel(id, lang);
      }
      let last = buckets[buckets.length - 1];
      if (!last || last.id !== id) {
        last = { id: id, label: label, bytes: 0, count: 0 };
        buckets.push(last);
      }
      last.bytes += d.bytes;
      last.count += d.count;
    });

    let maxV = 0;
    buckets.forEach((b, i) => {
      result.labels.push(b.label);
      result.bytes.push(b.bytes);
      result.counts.push(b.count);
      const v = result.basis === 'count' ? b.count : b.bytes;
      if (v > maxV) { maxV = v; result.peakIdx = i; }
    });
    return result;
  },

  buildRuntimeContext(state, primaryDomain, dateRangeString, outlierMetrics, corpDomains, mode) {
    const self = this;
    const GB = 1024 ** 3;
    const om = outlierMetrics || {};
    // Language of the deck, for the sentences that come from the message catalogs
    const lang = ceraNormalizeLang_((state && state.reportLang) || 'en');
    const NR = ceraT('deck.notRecorded', null, lang);
    const corp = (corpDomains && corpDomains.length) ? corpDomains : (self.isValidName(primaryDomain) ? [primaryDomain] : []);
    // Destinations are shown by what they are: browser pages and local files by name, shared-hosting sites by host
    const destLabel = (name) => ceraDestinationLabel(name, lang);
    // Kind of a destination for its tag: browser page, local file, direct IP, internal host, corporate site or external site
    const hostKind = (name, corporateMap) => {
      let kind = ceraHostKind(name);
      const isCorp = !!(corporateMap && corporateMap[name]) || corp.some(cd => cd && domainMatches(String(name || ''), cd));
      if ((kind === 'external' || kind === 'internal') && isCorp) kind = 'corporate';
      return kind;
    };
    const kindLabel = kind => ceraT('deck.hostKind.' + kind, null, lang);
    const fmtB = (b) => self.fmtBytes(b);
    const validName = (n) => self.isValidName(n);
    const cleanArr = (arr) => (arr || []).filter(i => i && validName(i.name));
    const pctStr = (part, whole) => (whole > 0 ? ((part / whole) * 100).toFixed(1) + '%' : '0.0%');
    const domainLabel = validName(primaryDomain) ? primaryDomain : NR;
    const T = (key, params) => ceraT(key, params, lang);
    const P = n => T('deck.people', { n: n });
    // Only a log that shows policies enforcing says what left and what was stopped (ceraOutcomeMode)
    const enforced = (mode || ceraOutcomeMode(state)) === 'enforced';
    // Outbound rows of a destination or unit map, largest first: outbound bytes and transfers only, with the file
    // upload / paste split for the bar segments (the second segment slot carries pastes; a print job is in no channel
    // or unit total, so there is no print segment); entries without any outbound transfer are dropped. Pastes into a page are uploads to Chrome: the split ingestion records
    // (ceraRecordOutboundKind_) puts them with the pastes; without it they stay in the upload segment.
    const kindBytes = (e, kind, legacy) => (e.kinds ? Number(e.kinds[kind] && e.kinds[kind].bytes) || 0 : Number(e[legacy]) || 0);
    const outboundRows = (map, limit, labelFn) => Object.keys(map || {}).map(k => {
      const e = (map[k] && typeof map[k] === 'object') ? map[k] : {};
      const bytes = Number(e.egressBytes) || 0;
      return {
        name: labelFn ? labelFn(e.name || k) : (e.name || k),
        bytes: bytes, totalBytes: bytes, volumeGb: bytes / GB, count: Number(e.egressCount) || 0,
        uploadGb: kindBytes(e, 'fileUpload', 'uploadBytes') / GB, downloadGb: kindBytes(e, 'paste', 'pasteBytes') / GB,
        // Outbound transfers to this destination by policy outcome (ceraRecordDestinationOutcome_)
        outcomes: e.egressOutcomes || null
      };
    }).filter(r => validName(r.name) && (r.bytes > 0 || r.count > 0))
      .sort((a, b) => b.bytes - a.bytes || b.count - a.count || (a.name < b.name ? -1 : 1))
      .slice(0, limit || 5);

    const ouCount = Object.keys((state && state.globalOUs) || {}).length;
    // Unit with the most outbound data (outbound transfers only, by bytes or by count when none had a size)
    const topGlobalOU = outboundRows(state && state.globalOUs, 1);
    const hasTopOU = topGlobalOU.length > 0;
    const topOUName = hasTopOU ? topGlobalOU[0].name : NR;
    const topOUVol = hasTopOU ? fmtB(topGlobalOU[0].bytes) : fmtB(0);
    const topOUCount = hasTopOU ? (topGlobalOU[0].count || 0).toLocaleString() : '0';
    // Unit ranking uses the outbound view, so its share is taken of outbound volume as well
    const ouOutbound = Number(state && state.egress && state.egress.bytes) > 0;
    const ouShareTotal = ouOutbound ? Number(state.egress.bytes) : ((state && state.totalBytes) || 0);
    const topOUPct = (ouShareTotal > 0 && hasTopOU) ? pctStr(topGlobalOU[0].bytes || 0, ouShareTotal) : '0.0%';

    // User concentration (ceraConcentration): the fewest people holding 80% of the outbound data of identified people,
    // against the people who sent data out; the label follows that measured share. Bytes, or transfers when no
    // outbound transfer carried a size.
    const egressUsers = (state && state.egress && state.egress.users) || {};
    const concByCount = !(Number(state && state.egress && state.egress.bytes) > 0);
    const concAmounts = Object.keys(egressUsers).map(u => Number(egressUsers[u] && (concByCount ? egressUsers[u].count : egressUsers[u].bytes)) || 0);
    const concTotal = concAmounts.reduce((sum, v) => sum + v, 0);
    const concAll = ceraConcentration(concAmounts);
    const concTitleOf = c => T('deck.conc.title', { badge: T('deck.conc.' + c.badge) });
    const conc = {
      title: concTitleOf(concAll),
      text: ceraConcentrationText(concAll, concByCount ? T('deck.transfers', { n: concTotal }) : fmtB(concTotal), lang)
    };

    // Vectors are ranked by outbound volume; downloads are retrieval, not a risk channel
    const rankByEgress = Number(state && state.egress && state.egress.bytes) > 0;
    const rankTotal = rankByEgress ? Number(state.egress.bytes) : ((state && state.totalBytes) || 0);
    const vList = [];
    if (state && state.vectors) {
      for (let k in state.vectors) {
        if (k === 'securityRadar') continue; // signal counter, not a transfer channel
        const vec = state.vectors[k] || {};
        const outBytes = rankByEgress ? (Number(vec.egress && vec.egress.bytes) || 0) : (vec.totalBytes || 0);
        vList.push({
          id: k,
          name: vec.name || k,
          bytes: outBytes,
          volumeGb: outBytes / GB,
          count: rankByEgress ? (Number(vec.egress && vec.egress.count) || 0) : (vec.totalEvents || 0),
          // People with outbound transfers in the vector, the basis of its count
          users: ceraOutboundPeople(vec)
        });
      }
    }
    vList.sort((a, b) => b.bytes - a.bytes || b.count - a.count);
    const emptyVec = { name: NR, volumeGb: 0, count: 0, users: 0, bytes: 0 };
    const vDominant = vList[0] || emptyVec;
    const hasDominant = (vDominant.bytes || 0) > 0 || (vDominant.count || 0) > 0;
    const dominantPct = rankTotal > 0 ? pctStr(vDominant.bytes || 0, rankTotal) : '0.0%';
    const dominantVol = fmtB(vDominant.bytes || 0);
    const vSub1 = vList[1] || emptyVec;
    const vSub2 = vList[2] || emptyVec;
    const vSub3 = vList[3] || emptyVec;

    // Top destination by bytes (count as tie-break), skipping empty / "null" names
    function getTopDomain(dMap) {
      let top = null;
      for (let d in (dMap || {})) {
        if (!validName(d)) continue;
        const e = dMap[d];
        const name = (e && typeof e === 'object' && validName(e.name)) ? e.name : d;
        const bytes = (e && typeof e === 'object') ? (Number(e.totalBytes || e.bytes) || 0) : 0;
        const count = (e && typeof e === 'object') ? (Number(e.count || e.total) || 0) : (Number(e) || 0);
        if (!top || bytes > top.bytes || (bytes === top.bytes && count > top.count)) {
          top = { name: name, bytes: bytes, count: count };
        }
      }
      return top;
    }

    // Direction of the four channels' volume: what was sent out against what was downloaded through them. Downloads
    // are retrieval and are never counted as data leaving.
    const outAllBytes = Number(state && state.egress && state.egress.bytes) || 0;
    const outAllCount = Number(state && state.egress && state.egress.count) || 0;
    const downAllBytes = Number(state && state.globalActions && state.globalActions.download && state.globalActions.download.bytes) || 0;
    const outAllAmount = outAllBytes > 0 ? fmtB(outAllBytes) : T('deck.transfers', { n: outAllCount });
    let directionText;
    if (outAllBytes <= 0 && outAllCount <= 0 && downAllBytes <= 0) directionText = T('deck.s4.directionNone');
    else if (downAllBytes > 0) directionText = T('deck.s4.direction', { out: outAllAmount, down: fmtB(downAllBytes) });
    else directionText = T('deck.s4.directionOut', { out: outAllAmount });

    // Daily velocity series (state.outliers.dailyEgress): outbound transfers by bytes or, when none carried a size, by
    // count. All-direction volume is charted only when nothing left the browser, and is then never called a peak.
    const outlierData = (state && state.outliers) || {};
    const egressVelocity = this.buildVelocitySeries(outlierData.dailyEgress, lang);
    const velocityIsEgress = egressVelocity.recordedDays > 0;
    const velocity = velocityIsEgress ? egressVelocity : this.buildVelocitySeries(outlierData.dailyVolume, lang);
    const burstMult = velocityIsEgress ? egressVelocity.burstMultiple : 0;
    const burstMultStr = burstMult > 0 ? burstMult.toFixed(1) + 'x' : NR;
    // Same rule and mean (ceraPeakStats over active days) as the deck headline
    const burstNarrative = velocityIsEgress ? ceraPeakSentence(egressVelocity.peak, lang) : ceraT('deck.peak.none', null, lang);

    // Slide 3 right-side behavioral cards by Organizational Unit (ceraSlide3Cards)
    const s3Cards = ceraSlide3Cards(state, om, egressVelocity, lang);
    const hasFunnel = s3Cards.hasFunnel;
    const funnelOU = s3Cards.funnelOU;
    const funnelDomain = s3Cards.funnelDomain;
    const funnelHHI = s3Cards.funnelHHI;
    const funnelHHIStr = s3Cards.funnelHHIStr;
    const funnelNarrative = s3Cards.funnelNarrative;
    const scatterOU = s3Cards.scatterOU;
    const scatterNarrative = s3Cards.scatterNarrative;
    const hasSkew = s3Cards.hasSkew;
    const skewOU = s3Cards.skewOU;
    const skewRatio = s3Cards.skewRatio;
    const skewPct = s3Cards.skewPct;
    const skewTitle = s3Cards.skewTitle;
    const skewNarrative = s3Cards.skewNarrative;

    const outlierParts = [burstNarrative];
    // An index of 0.75 or more: one destination received most of that person's outbound data
    if (hasFunnel && funnelHHI >= 0.75) outlierParts.push(T('deck.narr.funnel', { ou: funnelOU, dest: funnelDomain, hhi: funnelHHIStr }));
    if (hasSkew && skewRatio >= 0.8) outlierParts.push(T('deck.skew.assess', { pct: skewPct, ou: skewOU }));
    const outlierNarrative = outlierParts.join(' ');

    // Security Signals Radar calculations
    const radar = (state && ((state.vectors && state.vectors.securityRadar && state.vectors.securityRadar.signals) || state.securityRadar)) || {};
    const pwData = radar.passwordReuse || {};
    const pwTotal = pwData.total || 0;
    const topPwOUs = (typeof countMapToArray === 'function' && pwData.ous) ? cleanArr(countMapToArray(pwData.ous)).slice(0, 1) : [];

    // Findings on password reuse: the unit with the most events and, when corporate sites are among the destinations,
    // how many events were on them
    const pwInternalCount = Object.keys(pwData.internalDomains || {}).reduce((t, d) => t + (Number(pwData.internalDomains[d]) || 0), 0);
    const pwFindings = [];
    if (topPwOUs.length) pwFindings.push('• ' + T('deck.sig.pwUnit', { ou: topPwOUs[0].name, n: Number(topPwOUs[0].count) || 0, total: pwTotal }));
    if (pwInternalCount > 0) pwFindings.push('• ' + T('deck.sig.pwCorporate', { n: pwInternalCount, total: pwTotal }));
    // Outcomes of the reuse events when the logs report them (warned, allowed)
    const pwResults = pwData.results || {};
    const pwKnown = { WARNED: 'warned', ALLOWED: 'allowed', DETECTED: 'detected', REPORTED: 'detected' };
    const pwCounts = {};
    Object.keys(pwResults).filter(k => k !== 'NOT_REPORTED').forEach(k => {
      const cls = pwKnown[k] || 'other';
      pwCounts[cls] = (pwCounts[cls] || 0) + (Number(pwResults[k]) || 0);
    });
    const pwOutcome = ['warned', 'allowed', 'detected', 'other'].filter(c => pwCounts[c] > 0).map(c => T('deck.sig.pw.' + c, { n: pwCounts[c] }));
    if (pwTotal > 0 && pwOutcome.length) pwFindings.push('• ' + T('deck.sig.outcomes', { list: ceraJoinList(pwOutcome, lang) }));
    const pwAdvText = pwTotal > 0 ? (pwFindings.join('\n') || '• ' + T('deck.sig.pwCount', { n: pwTotal })) : '• ' + T('deck.sig.pwNone');

    const malData = radar.malwareTransfer || {};
    const malTotal = malData.total || 0;
    // Findings on potentially malicious files: the source with the most of them
    const malSources = (typeof countMapToArray === 'function' && malData.domains) ? cleanArr(countMapToArray(malData.domains)) : [];
    // Outcomes of the flagged downloads, one per download (a warning and its bypasses are one), when reported
    const malOutcome = ['blocked', 'cancelled', 'bypassed', 'warned', 'detected', 'other'].filter(k => (Number(malData[k]) || 0) > 0)
      .map(k => T('deck.sig.mal.' + k, { n: Number(malData[k]) || 0 }));
    let malAdvText = malTotal > 0
      ? (malSources.length ? '• ' + T('deck.sig.malSource', { host: ceraShortLabel(destLabel(malSources[0].name), 30), n: malSources[0].count, total: malTotal }) : '• ' + T('deck.sig.malCount', { n: malTotal }))
      : '• ' + T('deck.sig.malNone');
    if (malTotal > 0 && malOutcome.length) malAdvText += '\n• ' + T('deck.sig.outcomes', { list: ceraJoinList(malOutcome, lang) });


    // Cover: what was read (log rows, and the user actions they were merged into when ingestion counts actions), the
    // people who sent data out against the people in the log, and every security signal (Safe Browsing warnings,
    // password reuse, potentially malicious files)
    const coverCov = (state && state.coverage) || {};
    const coverRows = Number(coverCov.rowsRead) || 0;
    const coverActions = typeof coverCov.actions === 'number' ? coverCov.actions : null;
    const coverPeopleOut = Object.keys((state && state.egress && state.egress.users) || {}).length;
    // People in the log: exact when ingestion counts them, otherwise at least the people the aggregates name
    const coverPeopleLog = ceraPeopleInLog(state);
    const unsafeSig = (state && state.vectors && state.vectors.securityRadar && state.vectors.securityRadar.signals && state.vectors.securityRadar.signals.unsafeSiteVisit) || {};
    const unsafeTotal = Number(unsafeSig.total) || Number(state && state.securityRadar && state.securityRadar.unsafeSiteVisit && state.securityRadar.unsafeSiteVisit.total) || 0;

    // Printing Analysis calculations
    const ps = (state && state.printStats) || {};
    const printEvents = ps.totalEvents || 0;
    const printUsers = Object.keys(ps.users || {}).length;
    const topPrintOUs = (typeof countMapToArray === 'function' && ps.ous) ? cleanArr(countMapToArray(ps.ous)).slice(0, 1) : [];
    const topPrintOUName = topPrintOUs.length ? topPrintOUs[0].name : NR;
    const topPrintArr = (typeof countMapToArray === 'function' && ps.originDomains) ? cleanArr(countMapToArray(ps.originDomains)).slice(0, 1) : [];
    const topPrintD = topPrintArr.length ? destLabel(topPrintArr[0].name) : NR;
    const topPrintCount = topPrintArr.length ? (topPrintArr[0].count || 0).toLocaleString() : '0';
    const printSens = (typeof formatSensitivityInfo === 'function') ? formatSensitivityInfo(ps.sensitivity) : { sensPct: '0.0%', sensitiveCount: 0 };
    // Detectors of the sensitive print jobs, named as on the vector slides (ceraDetectorListText)
    const printDetList = ceraDetectorListText(ceraSensitivityDetectorNames(ps.sensitivity, ps.sensitivity && ps.sensitivity.detectorNames), true, lang);
    // People who printed, of the people in the log, and the unit with the most print jobs. No concentration label:
    // the shares of print jobs per person are not measured.
    const printPeopleTitle = T('deck.print.peopleTitle', { n: printUsers });
    let printPeopleText = printUsers > 0 ? T('deck.print.peopleText', { n: printUsers }) : T('deck.print.peopleNone');
    if (topPrintOUs.length) printPeopleText += ' ' + T('deck.print.unit', { ou: topPrintOUName, n: Number(topPrintOUs[0].count) || 0, all: printEvents });

    // =========================================================================
    // Vector slides: every figure on the vector's outbound transfers (counts, people, sensitivity, detectors,
    // formats, destinations, units, busiest day). Downloads are not part of any of them.
    // =========================================================================
    const vRadar = (state && state.vectors && state.vectors.securityRadar) || {};


    // Everything a vector's slides say, on its outbound transfers
    const vectorDeck = key => {
      const vec = (state && state.vectors && state.vectors[key]) || {};
      const out = vec.egress || {};
      const count = Number(out.count) || 0;
      const bytes = Number(out.bytes) || 0;
      const byCount = !(bytes > 0) && count > 0;
      const amountOf = (b, c) => (byCount ? T('deck.transfers', { n: Number(c) || 0 }) : fmtB(b));
      const people = ceraOutboundPeople(vec);
      const sensitive = Number(out.sensitiveCount) || 0;
      // Detectors of the outbound transfers: with counts when exact, names only when the counts are lower bounds
      const od = ceraOutboundDetectors(vec);
      const detList = ceraDetectorListText(od.names, od.exact, lang);
      let sensText = count > 0 ? T('deck.v.cardSensText', { s: sensitive, n: count }) : T('deck.v.cardSensNone');
      if (count > 0 && detList) sensText += ' ' + T(od.exact ? 'deck.v.cardDetectors' : 'deck.v.cardDetectorsSome', { list: detList });
      const dests = outboundRows(vec.domains, 5, destLabel);
      const top = dests[0] || null;
      const ous = outboundRows(vec.ous, 3);
      const mix = ceraActionMixText(ceraActionMix(vec, state), lang);
      const peak = ceraVectorPeak(vec);
      // Concentration of this vector's outbound data over the people who sent it (ceraOutboundUsers)
      const outUsers = ceraOutboundUsers(vec);
      const vc = ceraConcentration(Object.keys(outUsers).map(u => byCount ? outUsers[u].count : outUsers[u].bytes));
      let primaryText = T('deck.v.primaryNone');
      if (top && enforced && top.outcomes) {
        // The largest destination by what was sent to it, with what happened to those transfers
        primaryText = T('deck.v.primaryOutcome', { dest: top.name, amount: amountOf(top.bytes, top.count), n: top.count, list: ceraOutcomeListText(top.outcomes, null, lang) });
      } else if (top && byCount) primaryText = T('deck.v.primaryCount', { dest: top.name, n: top.count });
      else if (top) primaryText = T('deck.v.primary', { dest: top.name, amount: fmtB(top.bytes), n: top.count });
      // What left and what was stopped of this channel's outbound transfers (enforced logs only)
      const oc = ceraOutcomeFacts(out);
      let volumeTitle = T('deck.v.cardVolume', { amount: amountOf(bytes, count) });
      if (enforced && count > 0) {
        const leftAmount = amountOf(oc.left.bytes, oc.left.count);
        const stoppedAmount = amountOf(oc.stopped.bytes, oc.stopped.count);
        if (oc.stopped.count <= 0) volumeTitle = T('deck.v.cardVolumeLeft', { left: leftAmount });
        else if (oc.left.count <= 0) volumeTitle = T('deck.v.cardVolumeAll', { stopped: stoppedAmount });
        else volumeTitle = T('deck.v.cardVolumeOutcome', { left: leftAmount, stopped: stoppedAmount });
      }
      return {
        key: key, vec: vec, count: count, bytes: bytes, byCount: byCount, people: people, sensitive: sensitive,
        amount: amountOf(bytes, count), amountOf: amountOf, dests: dests, top: top, ous: ous, out: oc,
        formats: ceraOutboundFormats(vec, lang, 5), mix: mix, peak: peak,
        volumeTitle: volumeTitle,
        transfersText: T('deck.v.cardTransfers', { n: count, people: P(people) }) + (mix ? ' ' + T('deck.v.cardMix', { mix: mix }) : '') +
          (enforced && count > 0 ? ' ' + T('deck.v.cardOutcomes', { list: ceraOutcomeListText(oc.outcomes, null, lang) }) : ''),
        sensTitle: T('deck.v.cardSens', { pct: pctStr(sensitive, count) }),
        sensText: sensText,
        primaryText: primaryText,
        peakTitle: ceraVectorPeakTitle(peak, lang),
        peakText: ceraVectorPeakSentence(peak, lang),
        ouList: ous.length ? ous.map((o, i) => `${i + 1}. ${o.name} (${amountOf(o.bytes, o.count)})`).join(', ') : NR,
        topOu: ous.length ? ous[0].name : NR,
        concTitle: concTitleOf(vc),
        concText: ceraConcentrationText(vc, null, lang) + (ous.length ? ' ' + T('deck.conc.unit', { ou: ous[0].name }) : '')
      };
    };
    // URL categories of the outbound transfers in the four vectors (per-action category maps; downloads excluded)
    const outboundCategories = (() => {
      const cats = {};
      ['personal', 'shadowAi', 'unmanaged', 'messaging'].forEach(k => {
        const acts = (state && state.vectors && state.vectors[k] && state.vectors[k].actions) || {};
        ['upload', 'paste', 'print'].forEach(a => {
          const m = (acts[a] && acts[a].cats) || {};
          Object.keys(m).forEach(c => {
            const e = m[c] || {};
            const name = e.name || c;
            if (!cats[name]) cats[name] = { name: name, count: 0, bytes: 0 };
            cats[name].count += Number(e.count) || 0;
            cats[name].bytes += Number(e.bytes) || 0;
          });
        });
      });
      return Object.keys(cats).map(k => cats[k]).filter(c => validName(c.name) && c.count > 0)
        .sort((a, b) => b.count - a.count || b.bytes - a.bytes || (a.name < b.name ? -1 : 1));
    })();
    const vecName = id => T('deck.vector.' + id);
    const vectorsDeck = {};
    ['personal', 'shadowAi', 'unmanaged', 'messaging'].forEach(k => { vectorsDeck[k] = vectorDeck(k); });
    // Outbound split of the personal-account vector between other organizations and personal mailboxes
    const split = ceraAccountSplit(vectorsDeck.personal.vec, state);
    const splitPart = (cls, range) => {
      if (range.min === range.max) return range.min > 0 ? T('deck.split.' + cls + 'Exact', { n: range.min }) + (range.domain ? ' (' + range.domain + ')' : '') : '';
      if (range.min > 0) return T('deck.split.' + cls + 'Min', { n: range.min }) + (range.domain ? ' (' + range.domain + ')' : '');
      return range.max > 0 ? T('deck.split.' + cls + 'Max', { n: range.max }) : '';
    };
    const splitParts = [splitPart('other', split.otherOrg), splitPart('consumer', split.consumer)].filter(Boolean);
    const splitText = split.total > 0 && splitParts.length ? T('deck.split.card', { n: split.total, parts: ceraJoinList(splitParts, lang) }) : T('deck.split.none');
    // What left and what was stopped of a channel, under its card on the matrix slide (enforced logs only)
    const channelOutcome = (vd, card) => {
      if (!enforced || !vd || vd.count <= 0) return '';
      const left = vd.amountOf(vd.out.left.bytes, vd.out.left.count);
      if (vd.out.stopped.count <= 0) return T(card ? 'deck.s2.cardOutcomeNone' : 'deck.s2.dominantOutcomeNone', { left: left });
      const stopped = vd.amountOf(vd.out.stopped.bytes, vd.out.stopped.count);
      const all = vd.out.left.count <= 0;
      if (card) return T(all ? 'deck.s2.cardOutcomeAll' : 'deck.s2.cardOutcome', { left: left, stopped: stopped });
      return T(all ? 'deck.s2.dominantOutcomeAll' : 'deck.s2.dominantOutcome', { left: left, stopped: stopped, list: ceraOutcomeListText(vd.out.outcomes, CeraConfig.OUTCOME_STOPPED, lang) });
    };
    // Line under a channel's card on the matrix slide: the measured account split for personal accounts, otherwise
    // the channel's largest outbound destination; then what left and what was stopped
    const channelLine = id => {
      const line = channelDestLine(id);
      const outcome = channelOutcome(vectorsDeck[id], true);
      return outcome ? line + '\n' + outcome : line;
    };
    const channelDestLine = id => {
      const vd = vectorsDeck[id];
      if (!vd || vd.count <= 0) return T('deck.s2.cardNone');
      // The account type most transfers to outside accounts went to (ceraAccountSplitLead), as on the channel's slide
      const lead = id === 'personal' ? ceraAccountSplitLead(split) : '';
      if (lead === 'otherOrg') {
        return T(split.otherOrg.min === split.otherOrg.max ? 'deck.s2.cardOther' : 'deck.s2.cardOtherMin', { n: split.total, other: split.otherOrg.min });
      }
      if (lead === 'consumer') {
        return T(split.consumer.min === split.consumer.max ? 'deck.s2.cardConsumer' : 'deck.s2.cardConsumerMin', { n: split.total, consumer: split.consumer.min });
      }
      return vd.top ? T('deck.s2.cardDest', { dest: vd.top.name }) : '';
    };

    // Deep-dive texts of a vector: its largest format and the units with the most outbound data
    Object.keys(vectorsDeck).forEach(k => {
      const vd = vectorsDeck[k];
      const f1 = vd.formats[0];
      vd.formatText = f1
        ? T('deck.v.formatPrimary', { type: f1.name, amount: vd.amountOf(f1.bytes, f1.count), pct: vd.byCount ? pctStr(f1.count, vd.count) : pctStr(f1.bytes, vd.bytes) })
        : T('deck.v.formatNone');
      vd.unitsTitle = vd.ous.length ? T('deck.v.unitsTitle', { ou: vd.topOu }) : T('deck.v.unitsTitleNone');
      vd.unitsText = vd.ous.length ? T('deck.v.unitsText', { list: vd.ouList }) : T('deck.v.unitsNone');
      // Destinations of an unmanaged-app channel: how many (ceraOutboundDestinations, the count of the channel's
      // headline as well), and the share of the three largest
      const destKeys = ceraOutboundDestinations(vd.vec);
      const destMap = {};
      destKeys.forEach(d => { destMap[d] = vd.vec.domains[d]; });
      const all = outboundRows(destMap, 100000);
      const sumOf = rows => rows.reduce((t, r) => t + (vd.byCount ? r.count : r.bytes), 0);
      vd.destCount = destKeys.length;
      vd.destsText = destKeys.length ? T('deck.v.destsText', { n: destKeys.length, pct: pctStr(sumOf(all.slice(0, 3)), sumOf(all)) }) : T('deck.v.primaryNone');
    });
    const vPersonalTypes = vectorsDeck.personal.formats;

    // --- Vector 02 Deep-Dive (Shadow AI) ---
    // The benchmark holds every outbound AI transfer, counted like the AI headline (transfers, not bytes); downloads
    // from AI tools are not part of it
    const gBench = (state && state.genAiBenchmark) || {};
    const sGemini = gBench.sanctioned || { bytes: 0, count: 0, users: {} };
    const sShadow = gBench.shadow || { bytes: 0, count: 0, users: {} };
    const sPersonalAi = gBench.personalSanctioned || { bytes: 0, count: 0, users: {} };
    const geminiBytes = sGemini.bytes || 0;
    const shadowBytes = sShadow.bytes || 0;
    const personalAiBytes = Number(sPersonalAi.bytes) || 0;
    const geminiCount = sGemini.count || 0;
    const shadowCount = sShadow.count || 0;
    const personalAiCount = Number(sPersonalAi.count) || 0;
    const otherAiCount = shadowCount + personalAiCount;
    const otherAiBytes = shadowBytes + personalAiBytes;
    const aiTotalCount = geminiCount + otherAiCount;
    const geminiUsers = Object.keys(sGemini.users || {}).length;
    const otherAiUsers = Object.keys(Object.assign({}, sShadow.users || {}, sPersonalAi.users || {})).length;
    const hasAi = aiTotalCount > 0;
    const pctInt = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
    const internalPctNum = pctInt(geminiCount, aiTotalCount);
    const shadowPctNum = hasAi ? (100 - internalPctNum) : 0;
    const personalAiPctNum = pctInt(personalAiCount, aiTotalCount);
    // When a policy stopped some AI transfers, the split is of what users sent: transfers "targeted" a tool
    const aiStopped = enforced && [sGemini, sShadow, sPersonalAi].some(b => b.leftCount !== undefined && (Number(b.leftCount) || 0) < (Number(b.count) || 0));
    let aiBenchmarkInsight;
    let aiPersonalBoldText = '';
    if (!hasAi) {
      aiBenchmarkInsight = T('deck.ai.splitNone');
    } else {
      aiBenchmarkInsight = T(aiStopped ? 'deck.ai.splitTargeted' : 'deck.ai.split', {
        n: aiTotalCount, sanctioned: geminiCount, sPct: internalPctNum, sAmount: fmtB(geminiBytes), sPeople: P(geminiUsers),
        other: otherAiCount, oPct: shadowPctNum, oAmount: fmtB(otherAiBytes), oPeople: P(otherAiUsers)
      });
      // Sanctioned AI tools used with non-corporate accounts fold into the other-tools share above so the two-part
      // percentage bar adds up to 100%, and are detailed (and bolded) in the explanation below the bar.
      if (personalAiCount > 0) {
        aiPersonalBoldText = ceraT('deck.ai.personalNote', { n: personalAiCount, pct: personalAiPctNum }, lang);
        aiBenchmarkInsight += ' ' + aiPersonalBoldText;
      }
      // Transfers to unsanctioned AI tools from accounts outside the organization are in the split but counted under
      // Personal accounts, not on this vector's slides
      const viaPersonal = Math.max(0, shadowCount - vectorsDeck.shadowAi.count);
      if (viaPersonal > 0) aiBenchmarkInsight += ' ' + T('deck.ai.splitPersonal', { n: viaPersonal });
      const otherLeft = (Number(sShadow.leftCount) || 0) + (Number(sPersonalAi.leftCount) || 0);
      if (aiStopped && otherAiCount > 0) aiBenchmarkInsight += ' ' + T('deck.ai.splitLeft', { left: otherLeft, n: otherAiCount });
      if (vectorsDeck.shadowAi.top) aiBenchmarkInsight += ' ' + T('deck.ai.splitTop', { dest: vectorsDeck.shadowAi.top.name, amount: vectorsDeck.shadowAi.amountOf(vectorsDeck.shadowAi.top.bytes, vectorsDeck.shadowAi.top.count) });
    }

    const vShadowAiBenchmark = [
      { name: 'Internal AI', bytes: geminiBytes, count: geminiCount, pct: internalPctNum },
      { name: 'Shadow AI', bytes: otherAiBytes, count: otherAiCount, pct: shadowPctNum }
    ];

    const vShadowAiTypes = vectorsDeck.shadowAi.formats;

    const vUnmanagedTypes = vectorsDeck.unmanaged.formats;
    const vMessagingTypes = vectorsDeck.messaging.formats;

    // --- Vector 05 Dedicated (Security Radar - Browsing Integrity) ---
    let radarBreakdown = null;
    if (typeof computeDetailedSecurityRadarBreakdown === 'function') {
      radarBreakdown = computeDetailedSecurityRadarBreakdown(vRadar.signals ? vRadar : ((state && state.securityRadar) || {}), lang);
    }
    const unsafeReasons = (radarBreakdown && radarBreakdown.unsafeReasons) || [];
    const unsafeEndpoints = cleanArr((radarBreakdown && radarBreakdown.unsafeEndpoints) || []);
    const unsafeOUs = ((radarBreakdown && radarBreakdown.unsafeOUs) || []).filter(o => o && validName(o.ou));
    // One basis on the whole Safe Browsing slide: events, a warning and the bypass logged after it being one event
    // (ceraAggregateRadarEvent_). Warnings shown are the heeded and the bypassed ones; the bypass rate is of them.
    const heededCount = Math.max(0, Number(radarBreakdown && radarBreakdown.warnedCount) || 0);
    const bypassedCount = Math.max(0, Number(radarBreakdown && radarBreakdown.bypassedCount) || 0);
    const blockedVisits = Math.max(0, Number(radarBreakdown && radarBreakdown.blockedCount) || 0);
    const warningTotal = heededCount + bypassedCount;
    const radarBypassRate = pctStr(bypassedCount, warningTotal);
    // Visits were recorded but none carried an Event Result: whether they were bypassed is unknown
    const bypassUnknown = !!radarBreakdown && !(Number(radarBreakdown.reportedCount) > 0) && Number(radarBreakdown.unreportedCount) > 0;
    let radarBypassNarrative;
    if (bypassUnknown) {
      radarBypassNarrative = ceraT('deck.radar.bypassUnknown', null, lang);
    } else if (warningTotal === 0 && blockedVisits > 0) {
      radarBypassNarrative = ceraT('deck.radar.allBlocked', { n: blockedVisits }, lang);
    } else if (warningTotal === 0) {
      radarBypassNarrative = T('deck.radar.noWarnings');
    } else if (bypassedCount === 0) {
      radarBypassNarrative = T('deck.radar.noneBypassed', { n: warningTotal });
    } else {
      radarBypassNarrative = T('deck.radar.bypassRate', { rate: radarBypassRate, bypassed: bypassedCount, n: warningTotal });
    }

    // Reasons of the Safe Browsing warnings: the most common one names the card; certificate errors count SSL reasons only
    const reasonKey = r => {
      const c = String(r || '').toUpperCase();
      if (c.indexOf('SSL') !== -1) return 'ssl';
      if (c.indexOf('SOCIAL_ENGINEERING') !== -1) return 'phishing';
      if (c.indexOf('MALWARE') !== -1) return 'malware';
      if (c.indexOf('UNWANTED') !== -1) return 'unwanted';
      if (c.indexOf('UNSPECIFIED') !== -1 || !c) return 'unspecified';
      return 'other';
    };
    const unsafeAll = unsafeReasons.reduce((t, r) => t + (Number(r && r.count) || 0), 0);
    const reasonShare = key => pctStr(unsafeReasons.filter(r => reasonKey(r && r.reason) === key).reduce((t, r) => t + (Number(r.count) || 0), 0), unsafeAll);
    const topReason = unsafeReasons[0] || null;
    const radarReasonTitle = topReason
      ? T('deck.sb.reasonTitle', { reason: T('deck.sb.reason.' + reasonKey(topReason.reason)), pct: pctStr(Number(topReason.count) || 0, unsafeAll) })
      : T('deck.sb.reasonTitleNone');
    const unsafeInternalCount = Object.keys((radar.unsafeSiteVisit && radar.unsafeSiteVisit.domains) || {}).filter(d => isInternalHost(d))
      .reduce((t, d) => { const e = radar.unsafeSiteVisit.domains[d]; return t + (Number(e && typeof e === 'object' ? e.total : e) || 0); }, 0);
    const radarRootCauseNarrative = unsafeAll > 0
      ? T(bypassUnknown ? 'deck.sb.reasonText' : 'deck.sb.reasonTextEvents', { n: unsafeAll, ssl: reasonShare('ssl'), phish: reasonShare('phishing'), internal: unsafeInternalCount })
      : T('deck.sb.reasonNone');

    // The host with the most events: the same figures as its bar (events, and bypassed of the warnings shown)
    const topDirectIp = unsafeEndpoints[0] || null;
    const topDirectIpHost1 = topDirectIp ? destLabel(topDirectIp.domain) : NR;
    const topDirectIpBypassRate1 = topDirectIp ? (topDirectIp.bypassRate || '0.0%') : '0.0%';
    let topDirectIpBypassLabel = ceraT('report.bypassNotReported', null, lang);
    if (!bypassUnknown) topDirectIpBypassLabel = topDirectIp && topDirectIp.shown > 0 ? T('deck.radar.endpointRate', { rate: topDirectIpBypassRate1 }) : T('deck.radar.endpointNoWarning');
    let radarEndpointNarrative;
    if (!topDirectIp) {
      radarEndpointNarrative = T('deck.radar.endpointNone');
    } else if (bypassUnknown) {
      radarEndpointNarrative = ceraT('deck.radar.endpoint', { n: Number(topDirectIp.total) || 0, host: topDirectIpHost1, kind: kindLabel(hostKind(topDirectIp.domain)) }, lang);
    } else {
      radarEndpointNarrative = T('deck.radar.endpointEvents', { n: Number(topDirectIp.total) || 0, host: topDirectIpHost1, kind: kindLabel(hostKind(topDirectIp.domain)) });
      if (topDirectIp.shown > 0) radarEndpointNarrative += ' ' + T('deck.radar.endpointBypassedOf', { bypassed: Number(topDirectIp.bypassed) || 0, n: topDirectIp.shown, rate: topDirectIpBypassRate1 });
    }

    const topUnsafeOU = unsafeOUs[0] || null;
    const radarTopOU1 = topUnsafeOU ? topUnsafeOU.ou : NR;
    const radarOUNarrative = topUnsafeOU
      ? T('deck.radar.unitEvents', { ou: radarTopOU1, n: Number(topUnsafeOU.count) || 0, total: unsafeAll, pct: topUnsafeOU.pct || '0.0%' })
      : T('deck.radar.unitNone');

    // Roadmap items: only name real entities
    const withTarget = (txt, name) => (validName(name) && name !== NR) ? `${txt} (${name})` : txt;

    return {
      '{{primaryDomain}}': domainLabel,
      '{{dateRange}}': validName(dateRangeString) ? dateRangeString : NR,
      '{{coverCount}}': ceraFormatNumber(coverActions !== null ? coverActions : coverRows, lang),
      '{{coverCountLabel}}': T(coverActions !== null ? 'deck.cover.actions' : 'deck.cover.rows'),
      '{{coverCountDef}}': coverActions !== null ? T('deck.cover.actionsDef', { n: coverRows }) : T('deck.cover.rowsDef'),
      '{{coverPeople}}': ceraFormatNumber(coverPeopleOut, lang),
      '{{coverPeopleLabel}}': T('deck.cover.people'),
      '{{coverPeopleDef}}': T(coverPeopleLog.exact ? 'deck.cover.peopleDef' : 'deck.cover.peopleDefMin', { n: Math.max(coverPeopleLog.n, coverPeopleOut) }),
      '{{coverSignals}}': ceraFormatNumber(pwTotal + malTotal + unsafeTotal, lang),
      '{{coverSignalsLabel}}': T('deck.cover.signals'),
      '{{coverSignalsDef}}': T('deck.cover.signalsDef', { sb: unsafeTotal, pw: pwTotal, mal: malTotal }),
      '{{malDownloads}}': T('deck.sig.malDownloads', { n: malTotal }),
      '{{malTotalLabel}}': T('deck.sig.malTotalLabel'),
      '{{radarEndpointTitle}}': T('deck.radar.endpointTitle', { host: topDirectIpHost1, label: topDirectIpBypassLabel }),
      '{{monitoredOUs}}': ouCount.toLocaleString(),
      '{{topOUName}}': topOUName,
      '{{topOUVol}}': topOUVol,
      '{{topOUPct}}': topOUPct,
      '{{topOUCount}}': topOUCount,
      '{{topOUNarrative}}': hasTopOU
        ? T('deck.s2.unitText', { ou: topOUName, n: Number(topGlobalOU[0].count) || 0, pct: topOUPct })
        : T('deck.s2.unitNone'),
      // The unit's share of outbound volume, or of all transfer volume when nothing was sent out
      '{{topOUActionNarrative}}': hasTopOU
        ? T(ouOutbound ? 'deck.s4.topUnit' : 'deck.s4.topUnitTransfer', { ou: topOUName, amount: topOUVol, pct: topOUPct })
        : T('deck.s4.topUnitNone'),
      '{{userConcTitle}}': conc.title,
      '{{userConcText}}': conc.text,
      '{{burstNarrative}}': burstNarrative,
      // Daily, weekly or monthly bars (buildVelocitySeries), of outbound volume or of all transfers
      '{{velocityTitle}}': T('deck.s3.velocity.' + (velocity.granularity || 'day') + (velocityIsEgress ? 'Outbound' : 'Transfer')),
      '{{funnelOU}}': funnelOU,
      '{{funnelNarrative}}': funnelNarrative,
      '{{scatterOU}}': scatterOU,
      '{{scatterNarrative}}': scatterNarrative,
      '{{skewOU}}': skewOU,
      '{{skewTitle}}': skewTitle,
      '{{skewNarrative}}': skewNarrative,
      '{{outlierNarrative}}': outlierNarrative,
      '{{directionText}}': directionText,
      '{{threatMatrixNarrative}}': hasDominant
        ? T('deck.s2.ranking', { list: vList.map(v => T('deck.s2.rankItem', { vector: vecName(v.id), amount: fmtB(v.bytes), pct: pctStr(v.bytes, rankTotal) })).join(', ') })
        : T('deck.s2.rankingNone'),
      '{{pwTotal}}': ceraFormatNumber(pwTotal, lang),
      _pwTotal: pwTotal,
      '{{pwUsers}}': Object.keys(pwData.users || {}).length.toLocaleString(),
      '{{pwAdvText}}': pwAdvText,
      '{{malTotal}}': malTotal.toLocaleString(),
      '{{malUsers}}': Object.keys(malData.users || {}).length.toLocaleString(),
      '{{malAdvText}}': malAdvText,
      '{{printEvents}}': ceraFormatNumber(printEvents, lang),
      _printEvents: printEvents,
      '{{printUsers}}': printUsers.toLocaleString(),
      '{{topPrintDomain}}': topPrintD,
      '{{topPrintCount}}': topPrintCount,
      '{{topPrintNarrative}}': topPrintArr.length
        ? T('deck.print.origin', { host: topPrintD, n: Number(topPrintArr[0].count) || 0 })
        : T('deck.print.originNone'),
      '{{topPrintOUName}}': topPrintOUName,
      '{{printSensPct}}': printSens.sensPct,
      '{{printSensCount}}': ceraFormatNumber(printSens.sensitiveCount || 0, lang),
      _printSensCount: printSens.sensitiveCount || 0,
      '{{printPeopleTitle}}': printPeopleTitle,
      '{{printPeopleText}}': printPeopleText,
      '{{printVol}}': fmtB(ps.totalBytes || 0),
      '{{dominantTitle}}': T('deck.s2.dominant', { vector: hasDominant ? vecName(vDominant.id) : NR }),
      '{{dominantVectorSummary}}': !hasDominant ? T('deck.s2.dominantNone')
        : (vectorsDeck[vDominant.id] && vectorsDeck[vDominant.id].top
          ? T('deck.s2.dominantText', { pct: dominantPct, dest: vectorsDeck[vDominant.id].top.name, amount: vectorsDeck[vDominant.id].amountOf(vectorsDeck[vDominant.id].top.bytes, vectorsDeck[vDominant.id].top.count) })
          : T('deck.s2.dominantTextNoDest', { pct: dominantPct })) + (channelOutcome(vectorsDeck[vDominant.id], false) ? ' ' + channelOutcome(vectorsDeck[vDominant.id], false) : ''),
      '{{dominantVectorVol}}': dominantVol,
      '{{dominantVectorPct}}': dominantPct,
      '{{dominantVectorEvents}}': (vDominant.count || 0).toLocaleString(),
      '{{dominantVectorUsers}}': (vDominant.users || 0).toLocaleString(),
      '{{dominantVectorCount}}': T('deck.v.sub', { n: vDominant.count || 0, people: P(vDominant.users || 0) }),
      '{{sub1Name}}': vSub1.id ? vecName(vSub1.id) : NR,
      '{{sub1Vol}}': fmtB(vSub1.bytes || 0),
      '{{sub1Events}}': (vSub1.count || 0).toLocaleString(),
      '{{sub1Users}}': (vSub1.users || 0).toLocaleString(),
      '{{sub1Count}}': T('deck.transfers', { n: vSub1.count || 0 }) + '\n' + P(vSub1.users || 0),
      '{{sub1Desc}}': channelLine(vSub1.id),
      '{{sub2Name}}': vSub2.id ? vecName(vSub2.id) : NR,
      '{{sub2Vol}}': fmtB(vSub2.bytes || 0),
      '{{sub2Events}}': (vSub2.count || 0).toLocaleString(),
      '{{sub2Users}}': (vSub2.users || 0).toLocaleString(),
      '{{sub2Count}}': T('deck.transfers', { n: vSub2.count || 0 }) + '\n' + P(vSub2.users || 0),
      '{{sub2Desc}}': channelLine(vSub2.id),
      '{{sub3Name}}': vSub3.id ? vecName(vSub3.id) : NR,
      '{{sub3Vol}}': fmtB(vSub3.bytes || 0),
      '{{sub3Events}}': (vSub3.count || 0).toLocaleString(),
      '{{sub3Users}}': (vSub3.users || 0).toLocaleString(),
      '{{sub3Count}}': T('deck.transfers', { n: vSub3.count || 0 }) + '\n' + P(vSub3.users || 0),
      '{{sub3Desc}}': channelLine(vSub3.id),
      '{{printOpsText}}': T('deck.print.sites', { n: Object.keys(ps.originDomains || {}).filter(validName).length }),
      '{{printDetectorsText}}': [(printSens.sensitiveCount || 0) > 0 ? (printDetList ? T('deck.print.detectors', { list: printDetList }) : '') : T('deck.print.detectorsNone'),
        enforced && (printSens.sensitiveCount || 0) > 0 ? T('deck.print.sensOutcome', { list: ceraOutcomeListText(ceraOutcomeFacts(ps.sensitivity).outcomes, null, lang) }) : '']
        .filter(Boolean).join(' '),
      // Vector slides (overview and deep-dive): ctx._vectors[key] from vectorDeck
      '{{aiBenchmarkInsight}}': aiBenchmarkInsight,
      '{{shadowTypeList}}': vShadowAiTypes.length ? vShadowAiTypes.slice(0, 2).map(t => `• ${t.name} (${vectorsDeck.shadowAi.amountOf(t.bytes, t.count)})`).join('\n') : T('deck.v.formatNone'),
      '{{shadowOUList}}': vectorsDeck.shadowAi.ous.length ? vectorsDeck.shadowAi.ous.map((o, i) => `${i + 1}. ${o.name} (${vectorsDeck.shadowAi.amountOf(o.bytes, o.count)})`).join('\n') : NR,

      // Vector 05 Dedicated (Slide 13)
      '{{radarWarnedTotal}}': warningTotal.toLocaleString(),
      '{{radarBypassTotal}}': bypassedCount.toLocaleString(),
      '{{radarBypassRate}}': radarBypassRate,
      '{{radarBypassNarrative}}': radarBypassNarrative,
      '{{radarReasonTitle}}': radarReasonTitle,
      '{{radarRootCauseNarrative}}': radarRootCauseNarrative,
      '{{topDirectIpHost1}}': topDirectIpHost1,
      '{{topDirectIpBypassRate1}}': topDirectIpBypassRate1,
      '{{topDirectIpBypassLabel}}': topDirectIpBypassLabel,
      '{{radarEndpointNarrative}}': radarEndpointNarrative,
      '{{radarTopOU1}}': radarTopOU1,
      '{{radarOUNarrative}}': radarOUNarrative,

      // Helper Data Arrays for Native Vector Charts
      _velocity: velocity,
      _vPersonalTypes: vPersonalTypes,
      _vShadowAiBenchmark: vShadowAiBenchmark,
      _aiPersonalBoldText: aiPersonalBoldText,
      _vUnmanagedTypes: vUnmanagedTypes,
      _vMessagingTypes: vMessagingTypes,
      _vectors: vectorsDeck,
      // Counts in chart value labels: transfers, print jobs, warnings, events (password reuse)
      _countTransfers: n => T('deck.transfers', { n: n }),
      _countJobs: n => T('deck.chart.jobs', { n: n }),
      _countWarnings: n => T('deck.chart.warnings', { n: n }),
      _countEvents: n => T('deck.chart.events', { n: n }),
      _outboundOUs: outboundRows(state && state.globalOUs, 5),
      _outboundCategories: outboundCategories,
      _splitText: splitText,
      // Outbound charts split their bars into uploads, pastes and prints (no downloads): file uploads apart from
      // pastes into a page once ingestion records the split (ceraRecordOutboundKind_)
      _legendOutbound: state && state.egress && state.egress.kinds ? T('deck.legend.outboundKinds')
        : T('deck.legend.outbound', { middle: T(ceraActionModel(state) ? 'deck.legend.paste' : 'deck.legend.copy') }),
      _unsafeEndpoints: unsafeEndpoints,
      // A host's bar is named by its label, and a direct IP says so ("192.168.1.10 [Direct IP]")
      _vRadarEnforcement: unsafeEndpoints.map(e => Object.assign({}, e, {
        name: e.domain ? destLabel(e.domain) + (ceraHostKind(e.domain) === 'ip' ? ' [' + kindLabel('ip') + ']' : '') : destLabel(e.name)
      })),
      _hostKind: hostKind,
      _kindLabel: kindLabel,
      _lang: lang,
      _radarBypassUnknown: bypassUnknown,
      // Warnings shown on the Safe Browsing slide, and the wording of one host's bar on the event basis
      _radarShown: warningTotal,
      _radarBarLabel: e => (e.shown > 0 ? T('deck.sb.barLabel', { n: Number(e.total) || 0, bypassed: Number(e.bypassed) || 0, shown: e.shown })
        : T('deck.sb.barLabelNoWarning', { n: Number(e.total) || 0 })),
      _radarChartTitle: T(bypassUnknown ? 'deck.sb.chartTitle' : 'deck.sb.chartTitleEvents'),
      _radarLegend: T('deck.sb.legend')
    };
  },

  // Slide 1: Executive Cover Briefing
  buildSlide_slide_01(presentation, ctx, p, w, h, state, outlierMetrics) {
    const slide = presentation.appendSlide(SlidesApp.PredefinedLayout.BLANK);
    slide.getBackground().setSolidFill('#EFF6FF');

    this.addCard(slide, 0, 0, 720, 4, '#2563EB', 'transparent', 0); // Header Accent Bar
    {
      let txt = 'Chrome Egress\nRisk Analysis';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 40, 62, 640, 78, 'Outfit', 28, 'bold', '#0F172A', 'left');
    }
    {
      let txt = '{{hl_cover}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 40, 140, 640, 30, 'Roboto', this.fitFont(txt, 640, 13, 9), 'bold', '#0F172A', 'left');
    }
    // What the logs say about policy outcomes: what was stopped, that nothing was, or that they carry no outcome
    this.addLineBox(slide, ctx['{{hl_coverNote}}'] || '', 40, 164, 640, 16, 'Roboto', 8, 'normal', '#475569', 'left');
    this.addLineBox(slide, this.t_(ctx, 'deck.cover.scopeLabel'), 52, 186, 181, 16, 'Roboto', 7, 'bold', '#64748B', 'left');
    {
      let txt = '{{primaryDomain}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 52, 202, 181, 32, 'Outfit', 13, 'bold', '#2563eb', 'left');
    }
    this.addLineBox(slide, this.t_(ctx, 'deck.cover.periodLabel'), 269, 186, 181, 16, 'Roboto', 7, 'bold', '#64748B', 'left');
    this.addLineBox(slide, ctx['{{dateRange}}'], 269, 202, 220, 32, 'Outfit', 12, 'bold', '#0F172A', 'left');
    this.addCard(slide, 40, 258, 151, 76, '#FFFFFF', '#E2E8F0', 4, 0.5); // KPI Card 1
    {
      let txt = '{{coverCount}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 50, 266, 131, 28, 'Outfit', 18, 'bold', '#2563EB', 'left');
    }
    this.addLineBox(slide, ctx['{{coverCountLabel}}'], 50, 292, 131, 16, 'Roboto', 8, 'bold', '#0F172A', 'left');
    this.addLineBox(slide, ctx['{{coverCountDef}}'], 50, 308, 131, 18, 'Roboto', 7, 'normal', '#64748B', 'left');
    this.addCard(slide, 203, 258, 151, 76, '#FFFFFF', '#E2E8F0', 4, 0.5); // KPI Card 2
    {
      let txt = '{{coverPeople}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 213, 266, 131, 28, 'Outfit', 18, 'bold', '#D97706', 'left');
    }
    this.addLineBox(slide, ctx['{{coverPeopleLabel}}'], 213, 292, 131, 16, 'Roboto', 8, 'bold', '#0F172A', 'left');
    this.addLineBox(slide, ctx['{{coverPeopleDef}}'], 213, 308, 131, 18, 'Roboto', 7, 'normal', '#64748B', 'left');
    this.addCard(slide, 366, 258, 151, 76, '#FFFFFF', '#E2E8F0', 4, 0.5); // KPI Card 3
    {
      let txt = '{{monitoredOUs}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 376, 266, 131, 28, 'Outfit', 18, 'bold', '#059669', 'left');
    }
    this.addLineBox(slide, this.t_(ctx, 'deck.cover.units'), 376, 292, 131, 16, 'Roboto', 8, 'bold', '#0F172A', 'left');
    this.addLineBox(slide, this.t_(ctx, 'deck.cover.unitsDef'), 376, 308, 131, 18, 'Roboto', 7, 'normal', '#64748B', 'left');
    this.addCard(slide, 529, 258, 151, 76, '#FFFFFF', '#E2E8F0', 4, 0.5); // KPI Card 4
    {
      let txt = '{{coverSignals}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 539, 266, 131, 28, 'Outfit', 18, 'bold', '#DC2626', 'left');
    }
    this.addLineBox(slide, ctx['{{coverSignalsLabel}}'], 539, 292, 131, 16, 'Roboto', 8, 'bold', '#0F172A', 'left');
    this.addLineBox(slide, ctx['{{coverSignalsDef}}'], 539, 308, 131, 18, 'Roboto', 7, 'normal', '#64748B', 'left');
    this.addLineBox(slide, this.t_(ctx, 'deck.cover.footer'), 40, 360, 640, 18, 'Roboto', 7.5, 'bold', '#64748B', 'left');
  },

  // Slide 2: Enterprise Threat Matrix: Cross-Channel Benchmark
  buildSlide_slide_02(presentation, ctx, p, w, h, state, outlierMetrics) {
    const slide = presentation.appendSlide(SlidesApp.PredefinedLayout.BLANK);
    slide.getBackground().setSolidFill('#EFF6FF');

    this.addCard(slide, 32, 219, 130, 123, '#7C3AED', 'transparent', 24); // Mini 1 Stripe
    this.addCard(slide, 166, 219, 130, 123, '#059669', 'transparent', 24); // Mini 2 Stripe
    this.addCard(slide, 300, 219, 130, 123, '#0284C7', 'transparent', 24); // Mini 3 Stripe
    this.addCard(slide, 32, 75, 133, 136, '#DC2626', 'transparent', 24); // Hero Rose Stripe
    this.addHeader_(slide, ctx, 'deck.header.matrix', null, '#2563EB');
    {
      let txt = '{{hl_s2}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 36, 26, 648, 26, 'Outfit', this.fitFont(txt, 648, 15, 10), 'bold', '#0F172A', 'left');
    }
    {
      let txt = '{{hl_s2sub}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 36, 50, 648, 16, 'Roboto', 8.5, 'normal', '#64748B', 'left');
    }
    const line_s2_hdr_sep = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 36, 66, 648, 1);
    line_s2_hdr_sep.getFill().setSolidFill('#E2E8F0');
    line_s2_hdr_sep.getBorder().setTransparent();
    this.addCard(slide, 36, 75, 394, 136, '#FFFFFF', '#E2E8F0', 4); // Dominant Vector Card
    {
      let txt = '{{dominantTitle}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 48, 83, 374, 20, 'Outfit', 12, 'bold', '#DC2626', 'left');
    }
    {
      let txt = '{{dominantVectorVol}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 48, 103, 374, 34, 'Outfit', 24, 'bold', '#0F172A', 'left');
    }
    {
      let txt = '{{dominantVectorCount}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 48, 137, 374, 18, 'Roboto', 8, 'normal', '#64748B', 'left');
    }
    {
      let txt = '{{dominantVectorSummary}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 48, 157, 374, 46, 'Roboto', 7.5, 'normal', '#334155', 'left');
    }
    this.addCard(slide, 36, 219, 126, 123, '#FFFFFF', '#E2E8F0', 4); // Sub-Vector Card 1
    {
      let txt = '{{sub1Name}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 48, 227, 106, 16, 'Outfit', 9, 'bold', '#7C3AED', 'left');
    }
    {
      let txt = '{{sub1Vol}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 48, 243, 106, 26, 'Outfit', 16, 'bold', '#7C3AED', 'left');
    }
    {
      let txt = '{{sub1Count}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 48, 269, 106, 28, 'Roboto', 7.5, 'normal', '#64748B', 'left');
    }
    {
      let txt = '{{sub1Desc}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 48, 299, 106, 38, 'Roboto', 7, 'normal', '#334155', 'left');
    }
    this.addCard(slide, 170, 219, 126, 123, '#FFFFFF', '#E2E8F0', 4); // Sub-Vector Card 2
    {
      let txt = '{{sub2Name}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 182, 227, 106, 16, 'Outfit', 9, 'bold', '#059669', 'left');
    }
    {
      let txt = '{{sub2Vol}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 182, 243, 106, 26, 'Outfit', 16, 'bold', '#059669', 'left');
    }
    {
      let txt = '{{sub2Count}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 182, 269, 106, 28, 'Roboto', 7.5, 'normal', '#64748B', 'left');
    }
    {
      let txt = '{{sub2Desc}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 182, 299, 106, 38, 'Roboto', 7, 'normal', '#334155', 'left');
    }
    this.addCard(slide, 304, 219, 126, 123, '#FFFFFF', '#E2E8F0', 4); // Sub-Vector Card 3
    {
      let txt = '{{sub3Name}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 316, 227, 106, 16, 'Outfit', 9, 'bold', '#0284C7', 'left');
    }
    {
      let txt = '{{sub3Vol}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 316, 243, 106, 26, 'Outfit', 16, 'bold', '#0284C7', 'left');
    }
    {
      let txt = '{{sub3Count}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 316, 269, 106, 28, 'Roboto', 7.5, 'normal', '#64748B', 'left');
    }
    {
      let txt = '{{sub3Desc}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 316, 299, 106, 38, 'Roboto', 7, 'normal', '#334155', 'left');
    }
    {
      let txt = this.t_(ctx, 'deck.s2.identityLabel');
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 448, 83, 226, 16, 'Roboto', 7, 'bold', '#D97706', 'left');
    }
    {
      let txt = '{{userConcTitle}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 448, 97, 226, 20, 'Outfit', 10.5, 'bold', '#0F172A', 'left');
    }
    {
      let txt = '{{userConcText}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 448, 127, 226, 54, 'Roboto', 7.5, 'normal', '#334155', 'left');
    }
    {
      let txt = this.t_(ctx, 'deck.s2.unitLabel');
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 448, 225, 226, 16, 'Roboto', 7, 'bold', '#0284C7', 'left');
    }
    {
      let txt = this.t_(ctx, 'deck.s2.unitTitle', { ou: ctx['{{topOUName}}'] });
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 448, 239, 226, 20, 'Outfit', 11, 'bold', '#0F172A', 'left');
    }
    {
      let txt = '{{topOUVol}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 448, 266, 226, 22, 'Outfit', 14, 'bold', '#0284C7', 'left');
    }
    {
      let txt = '{{topOUNarrative}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 448, 288, 226, 54, 'Roboto', 7.5, 'normal', '#334155', 'left');
    }
    this.addCard(slide, 36, 350, 648, 42, '#EFF6FF', '#BFDBFE', 4, 0.68); // Bottom Callout Card
    {
      let txt = '{{threatMatrixNarrative}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 48, 356, 624, 30, 'Roboto', 7.5, 'normal', '#334155', 'left');
    }
    {
      // Footnote: outbound transfers with no recorded destination, when they are a notable share (empty otherwise)
      let txt = '{{hl_s2note}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 36, 392, 648, 12, 'Roboto', 6.5, 'normal', '#64748B', 'left');
    }
  },

  // Slide 3: Behavioral Outliers: Velocity Bursts & Funneling
  buildSlide_slide_03(presentation, ctx, p, w, h, state, outlierMetrics) {
    const slide = presentation.appendSlide(SlidesApp.PredefinedLayout.BLANK);
    slide.getBackground().setSolidFill('#EFF6FF');

    this.addCard(slide, 364, 257, 133, 82, '#7C3AED', 'transparent', 24); // Card 3 Stripe
    this.addCard(slide, 364, 166, 133, 82, '#D97706', 'transparent', 24); // Card 2 Stripe
    this.addCard(slide, 364, 75, 133, 82, '#DC2626', 'transparent', 24); // Card 1 Stripe
    this.addHeader_(slide, ctx, 'deck.header.behavior', null, '#2563EB');
    {
      let txt = '{{hl_s3}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 36, 26, 648, 26, 'Outfit', this.fitFont(txt, 648, 15, 10), 'bold', '#0F172A', 'left');
    }
    {
      let txt = '{{hl_s3sub}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 36, 50, 648, 16, 'Roboto', 8.5, 'normal', '#64748B', 'left');
    }
    const line_s3_hdr_sep = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 36, 66, 648, 1);
    line_s3_hdr_sep.getFill().setSolidFill('#E2E8F0');
    line_s3_hdr_sep.getBorder().setTransparent();
    {
      let txt = '{{velocityTitle}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 48, 82, 296, 16, 'Outfit', 10, 'bold', '#D97706', 'left');
    }
    // Vector Chart: Velocity Line Chart (Daily Velocity Timeline)
    if (typeof VectorChartEngine !== 'undefined') {
      // Real series from state.outliers.dailyVolume: sorted, calendar-filled, weekly when > 60 days
      const series = (ctx && ctx._velocity) || this.buildVelocitySeries(state && state.outliers && state.outliers.dailyVolume);
      VectorChartEngine.renderDailyVelocityTimeline(slide, { dates: series.labels, bytes: series.bytes, counts: series.counts, peakIdx: series.peakIdx, lang: ctx._lang }, 44, 102, 304, 172, p);
    } else {
      this.addCard(slide, 44, 102, 304, 172, '#EFF6FF', '#BFDBFE', 4);
      this.addLineBox(slide, ctx['{{velocityTitle}}'], 44, 178, 304, 20, 'Outfit', 9.5, 'bold', '#D97706', 'center');
    }
    this.addCard(slide, 46, 282, 300, 48, '#FFFBEB', '#FDE68A', 4, 0.5); // Temporal Surge Card
    {
      let txt = '{{burstNarrative}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 56, 288, 280, 36, 'Roboto', 7.5, 'bold', '#D97706', 'left');
    }
    this.addCard(slide, 368, 75, 316, 82, '#FFFFFF', '#FECDD3', 4); // Funneling Card
    {
      let txt = this.t_(ctx, 'deck.s3.funnelTitle', { ou: ctx['{{funnelOU}}'] });
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 382, 81, 292, 18, 'Outfit', 9, 'bold', '#DC2626', 'left');
    }
    {
      let txt = '{{funnelNarrative}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 382, 99, 292, 54, 'Roboto', 7.5, 'normal', '#334155', 'left');
    }
    this.addCard(slide, 368, 166, 316, 82, '#FFFFFF', '#FDE68A', 4); // Dispersion Card
    {
      let txt = this.t_(ctx, 'deck.s3.scatterTitle', { ou: ctx['{{scatterOU}}'] });
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 382, 172, 292, 18, 'Outfit', 9, 'bold', '#D97706', 'left');
    }
    {
      let txt = '{{scatterNarrative}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 382, 190, 292, 54, 'Roboto', 7.5, 'normal', '#334155', 'left');
    }
    this.addCard(slide, 368, 257, 316, 82, '#FFFFFF', '#DDD6FE', 4); // Single-User Share Card
    {
      let txt = '{{skewTitle}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 382, 263, 292, 18, 'Outfit', 9, 'bold', '#7C3AED', 'left');
    }
    {
      let txt = '{{skewNarrative}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 382, 281, 292, 54, 'Roboto', 7.5, 'normal', '#334155', 'left');
    }
    this.addCard(slide, 36, 350, 648, 42, '#FFFBEB', '#FDE68A', 10, 0.67); // Bottom Callout Card
    {
      let txt = this.t_(ctx, 'deck.s3.assessment', { text: ctx['{{outlierNarrative}}'] });
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 48, 356, 624, 30, 'Roboto', 7.5, 'normal', '#334155', 'left');
    }
  },

  // Slide 4: Organizational & Endpoint Exposure
  buildSlide_slide_04(presentation, ctx, p, w, h, state, outlierMetrics) {
    const slide = presentation.appendSlide(SlidesApp.PredefinedLayout.BLANK);
    slide.getBackground().setSolidFill('#EFF6FF');

    this.addHeader_(slide, ctx, 'deck.header.units', null, '#2563EB');
    {
      let txt = '{{hl_s4}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 36, 26, 648, 26, 'Outfit', this.fitFont(txt, 648, 15, 10), 'bold', '#0F172A', 'left');
    }
    {
      let txt = '{{hl_s4sub}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 36, 50, 648, 16, 'Roboto', 8.5, 'normal', '#64748B', 'left');
    }
    {
      let txt = this.t_(ctx, 'deck.s4.unitsTitle');
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 48, 82, 150, 16, 'Outfit', 9.5, 'bold', '#2563EB', 'left');
    }
    // Vector Chart: Top OUs Stacked Bar (Top OUs Stacked Bars)
    if (typeof VectorChartEngine !== 'undefined') {
      VectorChartEngine.renderStackedHorizontalBars(slide, ctx._outboundOUs || [], 44, 102, 304, 172, { showLegend: true, legendStr: ctx._legendOutbound, palette: p, countLabel: ctx._countTransfers, lang: ctx._lang });
    } else {
      this.addCard(slide, 44, 102, 304, 172, '#EFF6FF', '#BFDBFE', 4);
      this.addLineBox(slide, this.t_(ctx, 'deck.s4.unitsTitle'), 44, 178, 304, 20, 'Outfit', 9.5, 'bold', '#2563EB', 'center');
    }
    this.addCard(slide, 46, 282, 300, 48, '#EFF6FF', '#BFDBFE', 4, 0.5); // Action Imbalance Card
    {
      let txt = '{{topOUActionNarrative}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 56, 288, 280, 36, 'Roboto', 7.5, 'bold', '#2563EB', 'left');
    }
    this.addLineBox(slide, ceraT('deck.s4.categoriesTitle', null, ctx._lang), 380, 80, 292, 16, 'Outfit', 9.5, 'bold', '#7C3AED', 'left');
    this.addLineBox(slide, ceraT('deck.s4.categoriesSub', null, ctx._lang), 380, 94, 292, 14, 'Roboto', 7, 'normal', '#64748B', 'left');
    // Vector Categories Table: URL categories of the outbound transfers (uploads, pastes, prints) in the four vectors
    {
      const topCats = ctx._outboundCategories || [];
      if (!topCats.length) {
        this.addTextBox(slide, ceraT('deck.s4.categoriesNone', null, ctx._lang), 376, 180, 300, 20, 'Roboto', 9, 'normal', p.textMuted, 'center');
      }
      const displayCats = topCats.slice(0, 10);
      displayCats.forEach((c, idx) => {
        const rowY = 111 + idx * 21.5;
        const isTop = idx === 0;
        this.addCard(slide, 376, rowY, 300, 19.5, isTop ? p.purpleLight : p.cardBgSub, isTop ? p.purpleBorder : p.border, 3);
        const rankPill = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 376 + 3, rowY + 2, 16, 14.5);
        rankPill.getFill().setSolidFill(isTop ? p.purple : p.cardBgSoft);
        rankPill.getBorder().setTransparent();
        this.addTextBox(slide, String(idx + 1), 376 - 1, rowY + 1, 24, 16, 'Roboto', 6.5, 'bold', isTop ? '#FFFFFF' : p.textMuted, 'center');
        // A category CERA named (internal apps, unspecified) in the report language; one of the log shortened
        const cDisplayName = ceraOwnCategory(c.name) ? ceraCategoryLabel(c.name, ctx._lang)
          : (typeof VectorChartEngine !== 'undefined' ? VectorChartEngine.cleanLabel(c.name, 30) : c.name);
        this.addLineBox(slide, cDisplayName, 376 + 22, rowY + 1.5, 165, 16, 'Outfit', 7, 'bold', p.textDark, 'left');
        const cVolStr = this.fmtBytes(c.bytes || 0);
        this.addLineBox(slide, `${ctx._countTransfers(c.count || 0)} • ${cVolStr}`, 376 + 185 - 30, rowY + 1.5, 300 - 189 + 30, 16, 'Outfit', 6.8, 'bold', isTop ? p.purple : p.textBody, 'right');
      });
    }
    this.addCard(slide, 36, 350, 648, 42, '#F0F9FF', '#BAE6FD', 4, 0.5); // Bottom Callout Card
    {
      let txt = '{{directionText}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 48, 356, 624, 30, 'Roboto', 7.5, 'normal', '#334155', 'left');
    }
  },

  // Slides 5, 7, 9 and 11: one overview per data-transfer vector, every figure on its outbound transfers
  buildSlide_slide_05(presentation, ctx, p, w, h) { this.buildVectorOverview_('personal', presentation, ctx, p, w, h); },
  buildSlide_slide_06(presentation, ctx, p, w, h) { this.buildVectorOverview_('shadowAi', presentation, ctx, p, w, h); },
  buildSlide_slide_07(presentation, ctx, p, w, h) { this.buildVectorOverview_('unmanaged', presentation, ctx, p, w, h); },
  buildSlide_slide_08(presentation, ctx, p, w, h) { this.buildVectorOverview_('messaging', presentation, ctx, p, w, h); },

  // Accent colour and chart title of each vector's slides
  VECTOR_STYLE: {
    personal: { no: '01', color: '#2563EB', light: '#EFF6FF', border: '#BFDBFE', chartColor: 'primary', chartTitleKey: 'deck.v.chartPersonal' },
    shadowAi: { no: '02', color: '#7C3AED', light: '#FAF5FF', border: '#DDD6FE', chartColor: 'purple', chartTitleKey: 'deck.v.chartAi' },
    unmanaged: { no: '03', color: '#D97706', light: '#FFFBEB', border: '#FDE68A', chartColor: 'amber', chartTitleKey: 'deck.v.chartUnmanaged' },
    messaging: { no: '04', color: '#059669', light: '#ECFDF5', border: '#A7F3D0', chartColor: 'emerald', chartTitleKey: 'deck.v.chartMessaging' }
  },

  /**
   * Closing line of a slide: the action CERA recommends for these findings (ctx._recByTopic), in its words, or nothing
   * when there is none. No other product capability is claimed.
   */
  addRecommendation_(slide, ctx, topics, bg, border) {
    const recs = [];
    (topics || []).forEach(t => ((ctx._recByTopic && ctx._recByTopic[t]) || []).forEach(r => recs.push(r)));
    if (!recs.length) return;
    this.addCard(slide, 36, 350, 648, 42, bg, border, 4, 0.5);
    const txt = recs.map(r => ceraT('deck.v.recommended', { rec: r }, ctx._lang)).join('\n');
    // Up to three lines fit the card at 7.5 pt; four (the browser launch policies) at 6.5 pt
    this.addTextBox(slide, txt, 48, 356, 624, 30, 'Roboto', recs.length > 3 ? 6.5 : 7.5, 'normal', '#334155', 'left');
  },

  /** Background image with its tint, or a plain fill when the image cannot be loaded. */
  addBackground_(slide, w, h) {
    slide.getBackground().setSolidFill('#EFF6FF');
  },

  /** Replaces the {{tokens}} of a template with their values from the runtime context. */
  fill_(txt, ctx) {
    let out = String(txt === null || txt === undefined ? '' : txt);
    for (let k in ctx) {
      if (typeof ctx[k] !== 'object' && typeof ctx[k] !== 'function' && out.includes(k)) out = out.split(k).join(String(ctx[k]));
    }
    return out;
  },

  /**
   * Overview of one data-transfer vector. Its counts, people, sensitivity, detectors, destinations and units are all
   * measured on the vector's outbound transfers (ctx._vectors[key]), so every card agrees with the headline.
   */
  buildVectorOverview_(key, presentation, ctx, p, w, h) {
    const st = this.VECTOR_STYLE[key];
    const vd = (ctx._vectors && ctx._vectors[key]) || {};
    const slide = presentation.appendSlide(SlidesApp.PredefinedLayout.BLANK);
    this.addBackground_(slide, w, h);
    this.addCard(slide, 364, 257, 133, 82, '#D97706', 'transparent', 24); // C3 Stripe
    this.addCard(slide, 364, 166, 133, 82, '#7C3AED', 'transparent', 24); // C2 Stripe
    this.addCard(slide, 364, 75, 133, 82, '#DC2626', 'transparent', 24); // C1 Stripe
    this.addHeader_(slide, ctx, 'deck.header.vector', { name: this.t_(ctx, 'report.sheet.' + key).toUpperCase() }, st.color);
    const hl = ctx['{{hl_' + key + '}}'] || '';
    this.addTextBox(slide, hl, 36, 26, 648, 26, 'Outfit', this.fitFont(hl, 648, 15, 10), 'bold', '#0F172A', 'left');
    this.addLineBox(slide, ctx['{{hl_' + key + 'Sub}}'], 36, 50, 648, 16, 'Roboto', 8.5, 'normal', '#64748B', 'left');
    const sep = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 36, 66, 648, 1);
    sep.getFill().setSolidFill('#E2E8F0');
    sep.getBorder().setTransparent();
    this.addLineBox(slide, ceraT(st.chartTitleKey, null, ctx._lang), 48, 82, 220, 16, 'Outfit', 9.5, 'bold', st.color, 'left');
    if (typeof VectorChartEngine !== 'undefined') {
      VectorChartEngine.renderStackedHorizontalBars(slide, vd.dests || [], 44, 102, 304, 172,
        { showLegend: true, legendStr: ctx._legendOutbound, palette: p, vectorColor: p[st.chartColor], countLabel: ctx._countTransfers, lang: ctx._lang });
    }
    this.addCard(slide, 46, 282, 300, 48, st.light, st.border, 4, 0.5); // Primary Target Card
    this.addTextBox(slide, vd.primaryText, 56, 288, 280, 36, 'Roboto', 7.5, 'bold', st.color, 'left');
    this.addCard(slide, 368, 75, 316, 82, '#FFFFFF', '#FECDD3', 4); // Outbound Volume Card
    this.addLineBox(slide, vd.volumeTitle, 382, 81, 292, 18, 'Outfit', 9, 'bold', '#DC2626', 'left');
    this.addTextBox(slide, vd.transfersText, 382, 99, 292, 54, 'Roboto', 7.5, 'normal', '#334155', 'left');
    this.addCard(slide, 368, 166, 316, 82, '#FFFFFF', '#DDD6FE', 4); // Sensitivity Card
    this.addLineBox(slide, vd.sensTitle, 382, 172, 292, 18, 'Outfit', 9, 'bold', '#7C3AED', 'left');
    this.addTextBox(slide, vd.sensText, 382, 190, 292, 54, 'Roboto', 7.5, 'normal', '#334155', 'left');
    this.addCard(slide, 368, 257, 316, 82, '#FFFFFF', '#FDE68A', 4); // Identity Card
    this.addLineBox(slide, vd.concTitle, 382, 263, 292, 18, 'Outfit', 9, 'bold', '#D97706', 'left');
    this.addTextBox(slide, vd.concText, 382, 281, 292, 54, 'Roboto', 7.5, 'normal', '#334155', 'left');
    this.addRecommendation_(slide, ctx, [key], st.light, st.border);
  },

  // Slides 6, 10 and 12: vector deep-dives (formats, units, busiest day and one vector-specific card)
  buildSlide_vector_01_deepdive(presentation, ctx, p, w, h) { this.buildVectorDeepDive_('personal', presentation, ctx, p, w, h); },
  buildSlide_vector_03_deepdive(presentation, ctx, p, w, h) { this.buildVectorDeepDive_('unmanaged', presentation, ctx, p, w, h); },
  buildSlide_vector_04_deepdive(presentation, ctx, p, w, h) { this.buildVectorDeepDive_('messaging', presentation, ctx, p, w, h); },

  /**
   * Deep-dive of a data-transfer vector, on its outbound transfers: the formats sent, the largest format, the units
   * with the most outbound data, the busiest day, and per vector the account split (personal accounts), the spread of
   * destinations (unmanaged apps) or the transfer types (web messaging).
   */
  buildVectorDeepDive_(key, presentation, ctx, p, w, h) {
    const st = this.VECTOR_STYLE[key];
    const vd = (ctx._vectors && ctx._vectors[key]) || {};
    const T = (k, params) => ceraT(k, params, ctx._lang);
    const slide = presentation.appendSlide(SlidesApp.PredefinedLayout.BLANK);
    this.addBackground_(slide, w, h);
    this.addCard(slide, 364, 257, 133, 82, '#D97706', 'transparent', 24); // C3 Stripe
    this.addCard(slide, 364, 166, 133, 82, '#7C3AED', 'transparent', 24); // C2 Stripe
    this.addCard(slide, 364, 75, 133, 82, '#DC2626', 'transparent', 24); // C1 Stripe
    this.addHeader_(slide, ctx, 'deck.header.vectorDeep', { name: this.t_(ctx, 'report.sheet.' + key).toUpperCase() }, st.color);
    const hl = ctx['{{hl_' + key + 'Deep}}'] || '';
    this.addTextBox(slide, hl, 36, 26, 648, 26, 'Outfit', this.fitFont(hl, 648, 15, 10), 'bold', '#0F172A', 'left');
    this.addLineBox(slide, ctx['{{hl_' + key + 'Sub}}'], 36, 50, 648, 16, 'Roboto', 8.5, 'normal', '#64748B', 'left');
    const sep = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 36, 66, 648, 1);
    sep.getFill().setSolidFill('#E2E8F0');
    sep.getBorder().setTransparent();

    this.addLineBox(slide, T('deck.v.formatsTitle'), 48, 82, 260, 16, 'Outfit', 9.5, 'bold', st.color, 'left');
    if (typeof VectorChartEngine !== 'undefined') {
      const light = st.chartColor + 'Light';
      const border = st.chartColor + 'Border';
      const items = vd.byCount ? (vd.formats || []).map(f => ({ name: f.name, count: f.count })) : (vd.formats || []);
      VectorChartEngine.renderRankedHorizontalBars(slide, items, 44, 102, 304, 172, Object.assign(
        { palette: p, barColor: p[st.chartColor], barLight: p[light], barBorder: p[border], lang: ctx._lang },
        vd.byCount ? { countLabel: ctx._countTransfers } : { valueSuffix: ' GB' }));
    }
    this.addCard(slide, 46, 282, 300, 48, st.light, st.border, 4, 0.5); // Largest format
    this.addTextBox(slide, vd.formatText, 56, 288, 280, 36, 'Roboto', 7.5, 'bold', st.color, 'left');

    this.addCard(slide, 368, 75, 316, 82, '#FFFFFF', '#FECDD3', 4); // Units
    this.addLineBox(slide, vd.unitsTitle, 382, 81, 292, 18, 'Outfit', 9, 'bold', '#DC2626', 'left');
    this.addTextBox(slide, vd.unitsText, 382, 99, 292, 54, 'Roboto', 7.5, 'normal', '#334155', 'left');

    this.addCard(slide, 368, 166, 316, 82, '#FFFFFF', '#DDD6FE', 4); // Busiest day (ceraVectorPeak)
    this.addLineBox(slide, vd.peakTitle, 382, 172, 292, 18, 'Outfit', 9, 'bold', '#7C3AED', 'left');
    this.addTextBox(slide, vd.peakText, 382, 190, 292, 54, 'Roboto', 7.5, 'normal', '#334155', 'left');

    this.addCard(slide, 368, 257, 316, 82, '#FFFFFF', '#FDE68A', 4); // Vector-specific card
    let title;
    let text;
    if (key === 'personal') {
      title = T('deck.split.title');
      text = ctx._splitText;
    } else if (key === 'unmanaged') {
      title = T('deck.v.destsTitle');
      text = vd.destsText;
    } else {
      title = T('deck.v.mixTitle');
      text = vd.mix ? T('deck.v.mixCard', { mix: vd.mix }) : vd.primaryText;
    }
    this.addLineBox(slide, title, 382, 263, 292, 18, 'Outfit', 9, 'bold', '#D97706', 'left');
    this.addTextBox(slide, text, 382, 281, 292, 54, 'Roboto', 7.5, 'normal', '#334155', 'left');

    this.addRecommendation_(slide, ctx, [key], st.light, st.border);
  },

  // Slide 8 [NEW]: Threat Vector 02 Deep-Dive: Shadow AI GenAI Benchmark & IP Ingestion
  buildSlide_vector_02_deepdive(presentation, ctx, p, w, h, state, outlierMetrics) {
    const slide = presentation.appendSlide(SlidesApp.PredefinedLayout.BLANK);
    slide.getBackground().setSolidFill('#EFF6FF');

    // Standard Header
    this.addHeader_(slide, ctx, 'deck.header.vectorDeep', { name: this.t_(ctx, 'report.sheet.shadowAi').toUpperCase() }, '#7C3AED');
    {
      let txt = '{{hl_shadowAiDeep}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 36, 26, 648, 26, 'Outfit', this.fitFont(txt, 648, 15, 10), 'bold', '#0F172A', 'left');
    }
    {
      let txt = '{{hl_shadowAiSub}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 36, 50, 648, 16, 'Roboto', 8.5, 'normal', '#64748B', 'left');
    }
    const line_hdr_sep = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 36, 66, 648, 1);
    line_hdr_sep.getFill().setSolidFill('#E2E8F0');
    line_hdr_sep.getBorder().setTransparent();

    // 1. Hero split: shares of outbound AI transfers, the basis of the slide headline (sanctioned AI vs other tools,
    // including sanctioned tools used with non-corporate accounts). No AI activity renders as 0% / 0%.
    const benchmark = ctx._vShadowAiBenchmark || [];
    const internalPct = (benchmark[0] && benchmark[0].pct) || 0;
    const shadowPct = (benchmark[1] && benchmark[1].pct) || 0;

    // Clamping dynamic width between 130pt and 518pt out of 648pt total
    const totalHeroW = 648;
    const minCardW = 130;
    const maxCardW = totalHeroW - minCardW; // 518
    const rawW = totalHeroW * (internalPct / 100);
    const dynamicW = Math.max(minCardW, Math.min(maxCardW, Math.round(rawW)));

    // Hero Base Card (Shadow AI Container)
    this.addCard(slide, 36, 72, totalHeroW, 92, '#F1F5F9', '#FF7B00', 16);
    // Hero Fill Card (Internal AI Dynamic Fill)
    this.addCard(slide, 36, 72, dynamicW, 92, '#FFFFFF', '#009DFF', 16);

    // Left Anchor: Internal AI
    this.addTextBox(slide, `${internalPct}%`, 48, 76, 110, 52, 'Outfit', 46, 'bold', '#009DFF', 'left');
    this.addLineBox(slide, ceraT('deck.ai.sanctionedLabel', null, ctx._lang), 50, 130, 160, 18, 'Outfit', 11, 'bold', '#0F172A', 'left');

    // Right Anchor: Shadow AI
    this.addTextBox(slide, `${shadowPct}%`, 480, 76, 192, 52, 'Outfit', 46, 'bold', '#FF7B00', 'right');
    this.addLineBox(slide, ceraT('deck.ai.otherLabel', null, ctx._lang), 480, 130, 192, 18, 'Outfit', 11, 'bold', '#0F172A', 'right');

    // Dynamic Executive Insight (Internal AI vs Shadow AI)
    {
      let txt = '{{aiBenchmarkInsight}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      const box = this.addTextBox(slide, txt, 36, 174, 648, 48, 'Outfit', 10, '500', '#0F172A', 'left');
      if (box && ctx._aiPersonalBoldText) {
        const idx = txt.indexOf(ctx._aiPersonalBoldText);
        if (idx !== -1) {
          try {
            box.getText().getRange(idx, idx + ctx._aiPersonalBoldText.length).getTextStyle().setBold(true);
          } catch (e) {}
        }
      }
    }

    // 2. Lower Forensic Triptych Grid (y = 233, h = 108, w = 208 each)
    // Pillar 1: Ingested File Formats (Purple)
    this.addCard(slide, 36, 233, 208, 108, '#FFFFFF', '#DDD6FE', 4);
    this.addLineBox(slide, ceraT('deck.ai.formatsTitle', null, ctx._lang), 48, 239, 190, 18, 'Outfit', 9, 'bold', '#7C3AED', 'left');
    this.addTextBox(slide, ceraT('deck.ai.formatsText', null, ctx._lang) + '\n' + this.fill_('{{shadowTypeList}}', ctx), 48, 258, 190, 78, 'Roboto', 7.2, 'normal', '#334155', 'left');

    // Pillar 2: Departmental Blast Radius (Rose)
    this.addCard(slide, 256, 233, 208, 108, '#FFFFFF', '#FECDD3', 4);
    this.addLineBox(slide, ceraT('deck.ai.unitsTitle', null, ctx._lang), 268, 239, 190, 18, 'Outfit', 9, 'bold', '#DC2626', 'left');
    this.addTextBox(slide, ceraT('deck.ai.unitsText', null, ctx._lang) + '\n' + this.fill_('{{shadowOUList}}', ctx), 268, 258, 190, 78, 'Roboto', 7.2, 'normal', '#334155', 'left');

    // Pillar 3: Platforms & Velocity Spikes (Amber)
    this.addCard(slide, 476, 233, 208, 108, '#FFFFFF', '#FDE68A', 4);
    // Busiest outbound day of the vector under the deck's peak rule (ceraVectorPeak)
    this.addLineBox(slide, ctx._vectors.shadowAi.peakTitle, 488, 239, 190, 18, 'Outfit', 9, 'bold', '#D97706', 'left');
    this.addTextBox(slide, ctx._vectors.shadowAi.peakText, 488, 258, 190, 78, 'Roboto', 7.2, 'normal', '#334155', 'left');

    this.addRecommendation_(slide, ctx, ['shadowAi'], '#FAF5FF', '#DDD6FE');
  },

  // Slide 13 [NEW]: Threat Vector 05 Dedicated: Security Signals Radar Browsing Integrity & Warning Bypasses
  buildSlide_vector_05_browsing_integrity(presentation, ctx, p, w, h, state, outlierMetrics) {
    const slide = presentation.appendSlide(SlidesApp.PredefinedLayout.BLANK);
    slide.getBackground().setSolidFill('#EFF6FF');

    this.addCard(slide, 364, 257, 133, 82, '#7C3AED', 'transparent', 24); // C3 Stripe
    this.addCard(slide, 364, 166, 133, 82, '#D97706', 'transparent', 24); // C2 Stripe
    this.addCard(slide, 364, 75, 133, 82, '#DC2626', 'transparent', 24); // C1 Stripe

    this.addHeader_(slide, ctx, 'deck.header.vector5Deep', null, '#2563EB');
    {
      let txt = '{{hl_signals}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 36, 26, 648, 26, 'Outfit', this.fitFont(txt, 648, 15, 10), 'bold', '#0F172A', 'left');
    }
    {
      let txt = '{{hl_signalsSub}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 36, 50, 648, 16, 'Roboto', 8.5, 'normal', '#64748B', 'left');
    }
    const line_hdr_sep = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 36, 66, 648, 1);
    line_hdr_sep.getFill().setSolidFill('#E2E8F0');
    line_hdr_sep.getBorder().setTransparent();

    {
      this.addLineBox(slide, ctx._radarChartTitle || ceraT('deck.sb.chartTitle', null, ctx._lang), 48, 82, 260, 16, 'Outfit', 9.5, 'bold', '#DC2626', 'left');
    }
    if (typeof VectorChartEngine !== 'undefined') {
      const items = ctx._vRadarEnforcement || ctx._unsafeEndpoints || [];
      if (ctx._radarBypassUnknown || !(ctx._radarShown > 0)) {
        // No Event Result in the logs, or no warning shown: events per endpoint, without a bypass / heeded split
        VectorChartEngine.renderRankedHorizontalBars(slide, items.map(i => ({ name: i.name, count: Number(i.total) || 0 })), 44, 102, 304, 172, {
          palette: p,
          countLabel: ctx._radarBypassUnknown ? ctx._countWarnings : ctx._countEvents,
          barColor: p.rose,
          barLight: p.roseLight,
          barBorder: p.roseBorder,
          lang: ctx._lang
        });
      } else {
        // Each host's events: clicked through, heeded, no warning shown; the label states the same figures
        VectorChartEngine.renderStackedHorizontalBars(slide, items, 44, 102, 304, 172, {
          palette: p,
          vectorColor: p.rose,
          vectorLight: p.roseLight,
          vectorBorder: p.roseBorder,
          showLegend: true,
          legendStr: ctx._radarLegend,
          bulletColor1: p.rose,
          bulletColor2: p.blue,
          valueLabel: ctx._radarBarLabel,
          lang: ctx._lang
        });
      }
    } else {
      this.addCard(slide, 44, 102, 304, 172, '#FFF1F2', '#FECDD3', 4);
      this.addLineBox(slide, ctx._radarChartTitle, 44, 178, 304, 20, 'Outfit', 9.5, 'bold', '#DC2626', 'center');
    }

    this.addCard(slide, 46, 282, 300, 48, '#FFF1F2', '#FECDD3', 4, 0.5); // Primary Target Card
    {
      let txt = '{{radarBypassNarrative}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 56, 288, 280, 36, 'Roboto', 7.5, 'bold', '#DC2626', 'left');
    }

    this.addCard(slide, 368, 75, 316, 82, '#FFFFFF', '#FECDD3', 4); // Card 1: Root Cause Analysis
    {
      let txt = '{{radarReasonTitle}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 382, 81, 292, 18, 'Outfit', 9, 'bold', '#DC2626', 'left');
    }
    {
      let txt = '{{radarRootCauseNarrative}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 382, 99, 292, 54, 'Roboto', 7.5, 'normal', '#334155', 'left');
    }

    this.addCard(slide, 368, 166, 316, 82, '#FFFFFF', '#FDE68A', 4); // Card 2: Top Endpoint & Direct IP
    {
      let txt = '{{radarEndpointTitle}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 382, 172, 292, 18, 'Outfit', 9, 'bold', '#D97706', 'left');
    }
    {
      let txt = '{{radarEndpointNarrative}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 382, 190, 292, 54, 'Roboto', 7.5, 'normal', '#334155', 'left');
    }

    this.addCard(slide, 368, 257, 316, 82, '#FFFFFF', '#DDD6FE', 4); // Card 3: unit with the most warnings
    {
      let txt = this.t_(ctx, 'deck.radar.unitTitle', { ou: ctx['{{radarTopOU1}}'] });
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 382, 263, 292, 18, 'Outfit', 9, 'bold', '#7C3AED', 'left');
    }
    {
      let txt = '{{radarOUNarrative}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 382, 281, 292, 54, 'Roboto', 7.5, 'normal', '#334155', 'left');
    }

    this.addRecommendation_(slide, ctx, ['certs', 'safeBrowsing'], '#FFF1F2', '#FECDD3');
    this.addLaunchNote_(slide, ctx, 'signals');
  },

  // Slide 14: Security Signals Radar: Passwords & Malware
  buildSlide_slide_09(presentation, ctx, p, w, h, state, outlierMetrics) {
    const slide = presentation.appendSlide(SlidesApp.PredefinedLayout.BLANK);
    slide.getBackground().setSolidFill('#EFF6FF');

    this.addCard(slide, 375, 248, 133, 84, '#D97706', 'transparent', 24); // Malware Advisory Stripe
    this.addCard(slide, 44, 248, 133, 84, '#DC2626', 'transparent', 24); // PW Advisory Stripe
    this.addHeader_(slide, ctx, 'deck.header.signals', null, '#2563EB');
    {
      let txt = '{{hl_signals2}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 36, 26, 648, 26, 'Outfit', this.fitFont(txt, 648, 15, 10), 'bold', '#0F172A', 'left');
    }
    {
      let txt = '{{hl_signals2Sub}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 36, 50, 648, 16, 'Roboto', 8.5, 'normal', '#64748B', 'left');
    }
    {
      let txt = this.t_(ctx, 'deck.sig.pwTitle');
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 48, 81, 195, 16, 'Outfit', 9.5, 'bold', '#DC2626', 'left');
    }
    {
      let txt = this.t_(ctx, 'deck.sig.pwIncidents', { n: ctx._pwTotal });
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 243, 81, 98, 16, 'Outfit', 7.5, 'bold', '#DC2626', 'right');
    }
    {
      let txt = ceraT('deck.sig.pwSub', null, ctx._lang);
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 48, 97, 293, 14, 'Roboto', 6.8, 'normal', '#64748B', 'left');
    }
    this.addCard(slide, 48, 113, 141, 42, '#FFF1F2', '#FECDD3', 4, 0.5); // PW Mini Card 1
    {
      let txt = '{{pwTotal}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 52, 115, 133, 20, 'Outfit', 13.5, 'bold', '#DC2626', 'left');
    }
    {
      let txt = this.t_(ctx, 'deck.sig.pwTotalLabel');
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 52, 136, 133, 15, 'Roboto', 6.5, 'bold', '#0F172A', 'left');
    }
    this.addCard(slide, 196, 113, 145, 42, '#FFFFFF', '#E2E8F0', 4, 0.5); // PW Mini Card 2
    {
      let txt = '{{pwUsers}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 200, 115, 137, 20, 'Outfit', 13.5, 'bold', '#0F172A', 'left');
    }
    {
      let txt = this.t_(ctx, 'deck.sig.pwPeople');
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 200, 136, 137, 15, 'Roboto', 6.5, 'bold', '#64748B', 'left');
    }
    {
      let txt = ceraT('deck.sig.pwList', null, ctx._lang);
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 48, 161, 293, 13, 'Outfit', 6.8, 'bold', '#64748B', 'left');
    }
    // Vector List: Password Target Domains List (Top Targeted Password Domains)
    {
      const radar = (state && state.securityRadar) || {};
      const pwData = radar.passwordReuse || {};
      const topPwDomains = (typeof countMapToArray === 'function' && pwData.domains) ? countMapToArray(pwData.domains).filter(d => this.isValidName(d.name)).slice(0, 3) : [];
      if (topPwDomains.length > 0) {
        topPwDomains.slice(0, 3).forEach((d, idx) => {
          const rowY = 177 + idx * 22.5;
          this.addCard(slide, 48, rowY, 293, 19.5, '#FFFFFF', p.border || '#E2E8F0', 3);
          const rPill = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 48 + 3, rowY + 3, 16, 13.5);
          rPill.getFill().setSolidFill(idx === 0 ? (p.rose || '#DC2626') : (p.cardBgSoft || '#EFF6FF'));
          rPill.getBorder().setTransparent();
          this.addTextBox(slide, String(idx + 1), 48 - 1, rowY + 1, 24, 16, 'Roboto', 6.5, 'bold', idx === 0 ? '#FFFFFF' : (p.textMuted || '#64748B'), 'center');
          // Tagged by what the destination is: a browser page or local file is never an outside app
          const kind = ctx._hostKind ? ctx._hostKind(d.name, pwData.internalDomains) : 'external';
          const displayName = this.destinationWithKind_(d.name, kind, ctx, 32);
          const isIp = kind === 'ip';
          const isInt = kind === 'corporate' || kind === 'internal' || kind === 'browser' || kind === 'local';
          this.addLineBox(slide, displayName, 48 + 23, rowY + 1.5, 175, 16, 'Outfit', 6.8, 'bold', isIp ? (p.amber || '#D97706') : (isInt ? (p.purple || '#7C3AED') : (p.textDark || '#0F172A')), 'left');
          this.addLineBox(slide, ctx._countEvents(d.count || 0), 48 + 198, rowY + 1.5, 90, 16, 'Outfit', 6.8, 'bold', p.rose || '#DC2626', 'right');
        });
      } else {
        this.addCard(slide, 48, 177, 293, 64, p.cardBgSub || '#FFFFFF', p.border || '#E2E8F0', 3);
        this.addTextBox(slide, this.t_(ctx, 'deck.sig.pwListNone'), 48 + 6, 177 + 7, 293 - 12, 48, 'Roboto', 7.5, 'normal', p.textMuted || '#64748B', 'left');
      }
    }
    this.addCard(slide, 48, 248, 293, 84, '#FFFFFF', '#FECDD3', 4); // PW Advisory Card
    {
      let txt = ceraT('deck.sig.findings', null, ctx._lang);
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 56, 252, 280, 13, 'Outfit', 6.5, 'bold', '#DC2626', 'left');
    }
    {
      let txt = '{{pwAdvText}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 56, 266, 280, 29, 'Roboto', 6.8, 'normal', '#0F172A', 'left');
    }
    {
      // The action the recommendations slide lists for password reuse, or nothing
      const rec = (ctx._recByTopic.password || [])[0];
      let txt = rec ? '• ' + ceraT('deck.v.recommended', { rec: rec }, ctx._lang) : '';
      this.addTextBox(slide, txt, 56, 296, 280, 32, 'Roboto', 6.8, 'normal', '#0F172A', 'left');
    }
    {
      let txt = this.t_(ctx, 'deck.sig.malTitle');
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 379, 81, 205, 16, 'Outfit', 9, 'bold', '#D97706', 'left');
    }
    {
      // Flagged downloads, one per download (a warning and its bypasses are one)
      let txt = '{{malDownloads}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 584, 81, 88, 16, 'Outfit', 7.5, 'bold', '#D97706', 'right');
    }
    {
      let txt = ceraT('deck.sig.malSub', null, ctx._lang);
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 379, 97, 293, 14, 'Roboto', 6.8, 'normal', '#64748B', 'left');
    }
    this.addCard(slide, 379, 113, 141, 42, '#FFFBEB', '#FDE68A', 4, 0.5); // Malware Mini Card 1
    {
      let txt = '{{malTotal}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 383, 115, 133, 20, 'Outfit', 13.5, 'bold', '#D97706', 'left');
    }
    {
      let txt = '{{malTotalLabel}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 383, 136, 133, 15, 'Roboto', 6.5, 'bold', '#0F172A', 'left');
    }
    this.addCard(slide, 527, 113, 145, 42, '#FFFFFF', '#E2E8F0', 4, 0.5); // Malware Mini Card 2
    {
      let txt = '{{malUsers}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 531, 115, 137, 20, 'Outfit', 13.5, 'bold', '#0F172A', 'left');
    }
    {
      let txt = ceraT('deck.sig.malPeople', null, ctx._lang);
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 531, 136, 137, 15, 'Roboto', 6.5, 'bold', '#64748B', 'left');
    }
    {
      let txt = this.t_(ctx, 'deck.sig.malList');
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 379, 161, 293, 13, 'Outfit', 6.8, 'bold', '#64748B', 'left');
    }
    // Vector List: potentially malicious files, most frequent first
    {
      const topMalFiles = ceraMalwareFileRows(state, (ctx && ctx._lang) || 'en').slice(0, 3);
      if (topMalFiles.length > 0) {
        topMalFiles.forEach((f, idx) => {
          const rowY = 177 + idx * 22.5;
          this.addCard(slide, 379, rowY, 293, 19.5, '#FFFFFF', p.border || '#E2E8F0', 3);
          const rPill = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 379 + 3, rowY + 3, 16, 13.5);
          rPill.getFill().setSolidFill(idx === 0 ? (p.amber || '#D97706') : (p.cardBgSoft || '#EFF6FF'));
          rPill.getBorder().setTransparent();
          this.addTextBox(slide, String(idx + 1), 379 - 1, rowY + 1, 24, 16, 'Roboto', 6.5, 'bold', idx === 0 ? '#FFFFFF' : (p.textMuted || '#64748B'), 'center');
          const fLabel = ceraShortLabel(f.name, 60);
          this.addTextBox(slide, fLabel, 379 + 23, rowY + 1.5, 175, 16, 'Outfit', this.fitFont(fLabel, 175, 6.8, 5), 'bold', p.textDark || '#0F172A', 'left');
          this.addLineBox(slide, ceraT('deck.sig.malDownloads', { n: f.count || 0 }, (ctx && ctx._lang) || 'en'), 379 + 198, rowY + 1.5, 90, 16, 'Outfit', 6.8, 'bold', p.amber || '#D97706', 'right');
        });
      } else {
        this.addCard(slide, 379, 177, 293, 64, p.cardBgSub || '#FFFFFF', p.border || '#E2E8F0', 3);
        this.addTextBox(slide, this.t_(ctx, 'deck.sig.malListNone'), 379 + 6, 177 + 7, 293 - 12, 48, 'Roboto', 7.5, 'normal', p.textMuted || '#64748B', 'left');
      }
    }
    this.addCard(slide, 379, 248, 293, 84, '#FFFFFF', '#FDE68A', 4); // Malware Advisory Card
    {
      let txt = ceraT('deck.sig.findings', null, ctx._lang);
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 387, 252, 280, 13, 'Outfit', 6.5, 'bold', '#D97706', 'left');
    }
    {
      let txt = '{{malAdvText}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 387, 266, 280, 29, 'Roboto', 6.8, 'normal', '#0F172A', 'left');
    }
    {
      // The action the recommendations slide lists for potentially malicious files, or nothing
      const rec = (ctx._recByTopic.malware || [])[0];
      let txt = rec ? '• ' + ceraT('deck.v.recommended', { rec: rec }, ctx._lang) : '';
      this.addTextBox(slide, txt, 387, 296, 280, 32, 'Roboto', 6.8, 'normal', '#0F172A', 'left');
    }
    this.addLaunchNote_(slide, ctx, 'signals2');
  },

  /**
   * The sentence on browser launches that used Chrome's own startup switches only, or whose switches the logs do not
   * report (headlines.launchNote), at the foot of the Security Radar slide `where` when it is the last one built.
   */
  addLaunchNote_(slide, ctx, where) {
    if (ctx._launchNoteOn !== where) return;
    this.addLineBox(slide, ctx['{{hl_launchNote}}'], 36, 392, 648, 12, 'Roboto', 6.5, 'normal', '#64748B', 'left');
  },

  /**
   * Browser launches with switches other than Chrome's own startup switches, on one basis (launches): launches per class
   * of switches (a launch can be in several), the launches with Chrome's own startup switches only, the switches, the
   * people and devices of these launches, what each class of switches allows, and the policy for each class present.
   */
  buildSlide_browser_launches(presentation, ctx, p, w, h) {
    const lf = ctx.insights.facts.launches;
    const T = (key, params) => ceraT(key, params, ctx._lang);
    const color = '#4338CA';
    const light = '#EEF2FF';
    const border = '#C7D2FE';
    const slide = presentation.appendSlide(SlidesApp.PredefinedLayout.BLANK);
    this.addBackground_(slide, w, h);
    this.addCard(slide, 364, 257, 133, 82, '#D97706', 'transparent', 24); // C3 Stripe
    this.addCard(slide, 364, 166, 133, 82, '#7C3AED', 'transparent', 24); // C2 Stripe
    this.addCard(slide, 364, 75, 133, 82, color, 'transparent', 24); // C1 Stripe
    this.addHeader_(slide, ctx, 'deck.header.launches', null, color);
    const hl = ctx['{{hl_launches}}'] || '';
    this.addTextBox(slide, hl, 36, 26, 648, 26, 'Outfit', this.fitFont(hl, 648, 15, 10), 'bold', '#0F172A', 'left');
    this.addLineBox(slide, ctx['{{hl_launchesSub}}'], 36, 50, 648, 16, 'Roboto', 8.5, 'normal', '#64748B', 'left');
    const sep = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 36, 66, 648, 1);
    sep.getFill().setSolidFill('#E2E8F0');
    sep.getBorder().setTransparent();

    this.addLineBox(slide, T('deck.launch.chartTitle'), 48, 82, 296, 16, 'Outfit', 9.5, 'bold', color, 'left');
    if (typeof VectorChartEngine !== 'undefined') {
      VectorChartEngine.renderRankedHorizontalBars(slide, lf.classes.map(c => ({ name: T('deck.launch.class.' + c.id), count: c.launches })),
        44, 102, 304, 172, { palette: p, barColor: color, barLight: light, barBorder: border, countLabel: n => T('deck.launch.count', { n: n }), lang: ctx._lang });
    }
    // The launches with Chrome's own startup switches only, and those whose switches the logs do not report
    let routineText = lf.routine > 0 ? T('deck.launch.routineText', { n: lf.routine, total: lf.launches })
      : T(lf.notReported > 0 ? 'deck.launch.routineNoneReported' : 'deck.launch.routineNone');
    if (lf.notReported > 0) routineText += ' ' + T('deck.launch.notReported', { n: lf.notReported });
    this.addCard(slide, 46, 282, 300, 48, light, border, 4, 0.5);
    this.addTextBox(slide, routineText, 56, 288, 280, 36, 'Roboto', 7.5, 'bold', color, 'left');

    // Card 1: the switches other than Chrome's own startup switches, most launches first
    const top = lf.switches.filter(sw => sw.cls !== 'routine').slice(0, 4).map(sw => T('deck.launch.switchItem', { name: sw.name, n: sw.launches }));
    this.addCard(slide, 368, 75, 316, 82, '#FFFFFF', border, 4);
    this.addLineBox(slide, T('deck.launch.switchesTitle'), 382, 81, 292, 18, 'Outfit', 9, 'bold', color, 'left');
    this.addTextBox(slide, ceraJoinList(top, ctx._lang), 382, 99, 292, 54, 'Roboto', 7.5, 'normal', '#334155', 'left');

    // Card 2: the people and devices of these launches; what the log does not carry is said to be missing, never zero
    const pc = lf.nonRoutinePeople;
    const dc = lf.nonRoutineDevices;
    const people = pc.n > 0 ? T(pc.exact ? 'deck.people' : 'deck.launch.peopleMin', { n: pc.n }) : '';
    const devices = dc.n > 0 ? T(dc.exact ? 'deck.launch.devices' : 'deck.launch.devicesMin', { n: dc.n }) : '';
    let peopleText;
    if (people && devices) peopleText = T('deck.launch.peopleText', { n: lf.nonRoutine, people: people, devices: devices });
    else if (people) peopleText = T('deck.launch.peopleTextNoDevice', { n: lf.nonRoutine, people: people });
    else if (devices) peopleText = T('deck.launch.peopleTextNoPeople', { n: lf.nonRoutine, devices: devices });
    else peopleText = T('deck.launch.peopleTextNone', { n: lf.nonRoutine });
    this.addCard(slide, 368, 166, 316, 82, '#FFFFFF', '#DDD6FE', 4);
    this.addLineBox(slide, T('deck.launch.peopleTitle'), 382, 172, 292, 18, 'Outfit', 9, 'bold', '#7C3AED', 'left');
    this.addTextBox(slide, peopleText, 382, 190, 292, 54, 'Roboto', 7.5, 'normal', '#334155', 'left');

    // Card 3: what the switches of the classes with the most launches allow, worded as what they allow, not as who
    // used them or why
    const what = lf.classes.slice(0, 3).map(c => T('deck.launch.whatItem', { class: T('deck.launch.class.' + c.id), what: T('deck.launch.what.' + c.id) }));
    this.addCard(slide, 368, 257, 316, 82, '#FFFFFF', '#FDE68A', 4);
    this.addLineBox(slide, T('deck.launch.whatTitle'), 382, 263, 292, 18, 'Outfit', 9, 'bold', '#D97706', 'left');
    this.addTextBox(slide, what.join('\n'), 382, 281, 292, 54, 'Roboto', 7.2, 'normal', '#334155', 'left');

    this.addRecommendation_(slide, ctx, ['launches'], light, border);
  },

  // Slide 10: Physical Egress: Printing Analysis
  buildSlide_slide_10(presentation, ctx, p, w, h, state, outlierMetrics) {
    const slide = presentation.appendSlide(SlidesApp.PredefinedLayout.BLANK);
    slide.getBackground().setSolidFill('#EFF6FF');

    this.addCard(slide, 364, 257, 133, 82, '#D97706', 'transparent', 24); // C3 Stripe
    this.addCard(slide, 364, 166, 133, 82, '#7C3AED', 'transparent', 24); // C2 Stripe
    this.addCard(slide, 364, 75, 133, 82, '#DC2626', 'transparent', 24); // C1 Stripe
    this.addHeader_(slide, ctx, 'deck.print.header', null, '#D97706');
    {
      let txt = '{{hl_printing}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 36, 26, 648, 26, 'Outfit', this.fitFont(txt, 648, 15, 10), 'bold', '#0F172A', 'left');
    }
    {
      let txt = '{{hl_printingSub}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 36, 50, 648, 16, 'Roboto', 8.5, 'normal', '#64748B', 'left');
    }
    {
      let txt = ceraT('deck.print.chartTitle', null, ctx._lang);
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 48, 82, 296, 16, 'Outfit', 9.5, 'bold', '#D97706', 'left');
    }
    // Vector Chart: Print Origin Domains Bar (Print Origin Domains)
    if (typeof VectorChartEngine !== 'undefined') {
      const ps = (state && state.printStats) || {};
      const items = this.labelDestinations_((typeof countMapToArray === 'function' && ps.originDomains) ? countMapToArray(ps.originDomains, 5) : [], ctx);
      VectorChartEngine.renderRankedHorizontalBars(slide, items, 44, 102, 304, 172, { palette: p, barColor: p.amber, valueSuffix: ' ev', countLabel: ctx._countJobs, lang: ctx._lang });
    } else {
      this.addCard(slide, 44, 102, 304, 172, '#EFF6FF', '#BFDBFE', 4);
      this.addLineBox(slide, this.t_(ctx, 'deck.print.chartTitle'), 44, 178, 304, 20, 'Outfit', 9.5, 'bold', '#D97706', 'center');
    }
    this.addCard(slide, 46, 282, 300, 48, '#FFFBEB', '#FDE68A', 4, 0.5); // Primary Origin Card
    {
      let txt = '{{topPrintNarrative}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 56, 288, 280, 36, 'Roboto', 7.5, 'bold', '#D97706', 'left');
    }
    this.addCard(slide, 368, 75, 316, 82, '#FFFFFF', '#FECDD3', 4); // Print Ops Card
    {
      let txt = this.t_(ctx, 'deck.print.jobsTitle', { n: ctx._printEvents });
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 382, 81, 292, 18, 'Outfit', 9, 'bold', '#DC2626', 'left');
    }
    {
      let txt = '{{printOpsText}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 382, 99, 292, 54, 'Roboto', 7.5, 'normal', '#334155', 'left');
    }
    this.addCard(slide, 368, 166, 316, 82, '#FFFFFF', '#DDD6FE', 4); // Print Sensitivity Card
    {
      let txt = this.t_(ctx, 'deck.print.sensTitle', { pct: ctx['{{printSensPct}}'], n: ctx._printSensCount });
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 382, 172, 292, 18, 'Outfit', 9, 'bold', '#7C3AED', 'left');
    }
    {
      let txt = '{{printDetectorsText}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 382, 190, 292, 54, 'Roboto', 7.5, 'normal', '#334155', 'left');
    }
    this.addCard(slide, 368, 257, 316, 82, '#FFFFFF', '#FDE68A', 4); // Print Identity Card
    {
      let txt = '{{printPeopleTitle}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addLineBox(slide, txt, 382, 263, 292, 18, 'Outfit', 9, 'bold', '#D97706', 'left');
    }
    {
      let txt = '{{printPeopleText}}';
      for (let k in ctx) { if (typeof ctx[k] !== 'object' && txt.includes(k)) txt = txt.split(k).join(String(ctx[k])); }
      this.addTextBox(slide, txt, 382, 281, 292, 54, 'Roboto', 7.5, 'normal', '#334155', 'left');
    }
    this.addRecommendation_(slide, ctx, ['print'], '#FFFBEB', '#FDE68A');
  },

  // Slide 11: 3-Horizon Remediation Roadmap. A fixed roadmap, as in the first release: the same three horizons and
  // twelve milestones for every tenant, in the report language. The actions drawn from the logs are on the channel,
  // radar and printing slides.
  buildSlide_slide_11(presentation, ctx, p, w, h, state, outlierMetrics) {
    const slide = presentation.appendSlide(SlidesApp.PredefinedLayout.BLANK);
    slide.getBackground().setSolidFill('#EFF6FF');

    this.addCard(slide, 476, 76, 208, 250, '#059669', 'transparent', 24); // HZ3 Emerald Accent
    this.addCard(slide, 256, 76, 208, 250, '#D97706', 'transparent', 24); // HZ2 Amber Accent
    this.addCard(slide, 36, 76, 208, 250, '#DC2626', 'transparent', 24); // HZ1 Rose Accent
    this.addHeader_(slide, ctx, 'deck.header.recs', null, '#2563EB');
    const title = this.t_(ctx, 'deck.roadmap.title');
    this.addTextBox(slide, title, 36, 26, 648, 26, 'Outfit', this.fitFont(title, 648, 15, 10), 'bold', '#0F172A', 'left');
    this.addLineBox(slide, this.t_(ctx, 'deck.roadmap.sub'), 36, 50, 648, 16, 'Roboto', 8.5, 'normal', '#64748B', 'left');

    // Three horizon cards, left to right: the horizon, its theme, a rule and its four milestones
    [['h1', 36, '#DC2626'], ['h2', 256, '#D97706'], ['h3', 476, '#059669']].forEach(([key, x, color]) => {
      this.addCard(slide, x, 80, 208, 295, '#FFFFFF', '#E2E8F0', 4);
      this.addLineBox(slide, this.t_(ctx, 'deck.roadmap.' + key), x + 22, 92, 184, 22, 'Outfit', 11, 'bold', color, 'left');
      this.addLineBox(slide, this.t_(ctx, 'deck.roadmap.' + key + 'sub'), x + 22, 112, 184, 18, 'Roboto', 8, 'bold', '#0F172A', 'left');
      const rule = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, x + 12, 132, 184, 1);
      rule.getFill().setSolidFill('#E2E8F0');
      rule.getBorder().setTransparent();
      [1, 2, 3, 4].forEach(i => {
        this.addTextBox(slide, this.t_(ctx, 'deck.roadmap.' + key + 'i' + i), x + 24, 140 + (i - 1) * 48, 172, 44, 'Roboto', 8, 'normal', '#334155', 'left');
      });
    });
  }
};
