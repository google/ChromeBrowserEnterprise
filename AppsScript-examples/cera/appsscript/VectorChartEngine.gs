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
 *
 * ==============================================================================
 * CHROME EGRESS RISK ANALYSIS (CERA)
 * Module: VectorChartEngine.gs
 * Description: 100% In-Tenant Native Vector Charting Engine for Google Slides
 * 
 * Key Highlights:
 * - ZERO Network Egress: Eliminates all UrlFetchApp / QuickChart calls.
 * - 100% In-Tenant Security: Complies with strict enterprise banking & infosec policies.
 * - Ultra-Crisp Vector Resolution: Infinite scalability on 4K executive displays.
 * - Pixel-Perfect Coordinate Layout: Zero text/bar collisions or badge overlap.
 * - Individual Row Micro-Cards: Polished white cards with sleek 3.5px progress lines.
 * ==============================================================================
 */

var VectorChartEngine = {

  /**
   * Helper: true when a ranked-list label is a real name (not empty, "null" or "undefined")
   */
  isValidName(name) {
    if (name === null || name === undefined) return false;
    const str = String(name).trim().toLowerCase();
    return str !== '' && str !== 'null' && str !== 'undefined';
  },

  /**
   * Helper: drop rows whose name is empty, "null" or "undefined"
   */
  filterValidItems(items) {
    return (items || []).filter(i => i && this.isValidName(i.name));
  },

  /**
   * Helper: format a byte count with the shared formatBytes helper
   */
  fmtBytes(bytes) {
    if (typeof formatBytes === 'function') return formatBytes(bytes || 0);
    const gb = (Number(bytes) || 0) / (1024 ** 3);
    return gb.toFixed(2) + ' GB';
  },

  /**
   * Helper: short label of a destination, unit, format or category for tight card displays.
   * A URL shows its host and a host with a path its host; a unit path ("Parent/CISO") shows its last unit; a
   * spaced label ("Image / Graphic") and a MIME type ("text/plain") stay whole; a trailing qualifier in
   * parentheses and a port are dropped. Long labels are cut by ceraShortLabel.
   */
  cleanLabel(rawName, maxLen) {
    if (!rawName) return ceraT('deck.notRecorded');
    let str = rawName.toString().trim();
    if (str.startsWith('Unspecified')) {
      const match = str.match(/Unspecified\s*\(([^)]+)\)/i);
      if (match && match[1]) {
        const firstDom = match[1].split(',')[0].replace(/etc\.?/i, '').trim();
        const mainDom = typeof extractMainDomain === 'function' ? extractMainDomain(firstDom) : firstDom;
        str = 'Unspecified (' + mainDom + ')';
      }
      return str.substring(0, maxLen || 26);
    }
    try {
      if (str.includes('%')) str = decodeURIComponent(str);
    } catch (e) {}
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(str)) {
      str = str.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[\/?#;]/)[0];
    } else {
      str = str.replace(/\s+\([^()]*\)\s*$/, '');
      const spaced = /\s\/\s/.test(str);
      const mime = /^(application|audio|font|image|message|model|multipart|text|video)\/[\w.+-]+$/i.test(str);
      if (str.indexOf('/') !== -1 && !spaced && !mime) {
        const parts = str.split('/').map(s => s.trim()).filter(Boolean);
        const hostFirst = parts.length > 0 && /^[^\s]+\.[a-z]{2,}(:\d+)?$/i.test(parts[0]) && !/^\//.test(str);
        str = parts.length ? (hostFirst ? parts[0] : parts[parts.length - 1]) : str;
      }
    }
    if (/^[^\s:]+:\d+$/.test(str)) str = str.split(':')[0];
    const limit = maxLen || 22;
    if (typeof ceraShortLabel === 'function') return ceraShortLabel(str, limit);
    return str.length > limit ? str.substring(0, limit - 1) + '…' : str;
  },

  /**
   * Helper: a count in a value label, worded by the caller (options.countLabel(n), e.g. "346 transfers" in the report
   * language), or as events in the report language (options.lang) when the caller gives no wording.
   */
  countText_(n, options) {
    const v = Number(n) || 0;
    if (options && typeof options.countLabel === 'function') return options.countLabel(v);
    return ceraT('deck.chart.events', { n: v }, (options && options.lang) || 'en');
  },

  /**
   * Helper: font size at which a label fits one line of the given width (ExecutivePresentationEngine.fitFont), at
   * most size: names and values in a chart row run longer in some languages.
   */
  fitSize_(text, width, size) {
    if (typeof ExecutivePresentationEngine === 'undefined' || typeof ExecutivePresentationEngine.fitFont !== 'function') return size;
    return ExecutivePresentationEngine.fitFont(text, width, size, Math.max(5, Math.round(size * 0.6 * 2) / 2));
  },

  /**
   * Helper: a centred, italic note in place of a chart that has nothing to show, in the report language (options.lang).
   */
  emptyNote_(slide, key, x, y, w, h, options, color) {
    const box = slide.insertTextBox(ceraT(key, null, (options && options.lang) || 'en'), x, y + (h / 2) - 10, w, 20);
    box.getText().getTextStyle().setFontFamily('Roboto').setFontSize(9).setItalic(true).setForegroundColor(color);
    box.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
    return box;
  },

  /**
   * Helper: Calculate clean, executive round number for Y-axis scale with generous headroom (~1.35x)
   */
  niceGridMax(val) {
    if (!val || val <= 0) return 10;
    const target = val * 1.35;
    const pow10 = Math.pow(10, Math.floor(Math.log10(target)));
    const d = target / pow10;
    let mult;
    if (d <= 1.2) mult = 1.2;
    else if (d <= 1.5) mult = 1.5;
    else if (d <= 2.0) mult = 2.0;
    else if (d <= 2.5) mult = 2.5;
    else if (d <= 3.0) mult = 3.0;
    else if (d <= 4.0) mult = 4.0;
    else if (d <= 5.0) mult = 5.0;
    else if (d <= 6.0) mult = 6.0;
    else if (d <= 8.0) mult = 8.0;
    else mult = 10.0;
    return Math.round(mult * pow10);
  },

  /**
   * 1. Render Ranked Stacked Horizontal Bars (Slide 4: OUs, Slides 5-8: Threat Vector Destinations)
   * Micro-Card Design with 2-tier internal separation:
   * - Top Tier: Rank Pill + Domain/OU Name (Left) + Total Value (Right)
   * - Bottom Tier: Sleek 3.5px Multi-Segment Progress Line (Zero Overlap with Text)
   */
  renderStackedHorizontalBars(slide, items, x, y, w, h, options) {
    options = options || {};
    const p = options.palette || {
      primary: '#2563EB',
      primaryLight: '#EFF6FF',
      primaryBorder: '#BFDBFE',
      rose: '#DC2626',
      roseLight: '#FFF1F2',
      roseBorder: '#FECDD3',
      blue: '#0284C7',
      amber: '#D97706',
      textDark: '#0F172A',
      textBody: '#334155',
      textMuted: '#64748B',
      border: '#E2E8F0',
      borderSub: '#CBD5E1'
    };

    items = this.filterValidItems(items);
    if (items.length === 0) {
      this.emptyNote_(slide, 'deck.chart.empty', x, y, w, h, options, p.textMuted);
      return;
    }

    const displayItems = items.slice(0, 5);

    // Calculate maximum total for proportional scaling
    let maxTotal = 0;
    displayItems.forEach(i => {
      const up = Number(i.uploadGb || 0);
      const down = Number(i.downloadGb || 0);
      const prn = Number(i.printGb || 0);
      const total = Number(i.volumeGb || (up + down + prn) || i.count || 0);
      if (total > maxTotal) maxTotal = total;
    });
    if (maxTotal <= 0) maxTotal = 1.0;

    let currentY = y;

    // Optional Top Legend: the caller's (options.legendStr), else the outbound split in the report language
    if (options.showLegend) {
      const legendH = 13;
      const lang = options.lang || 'en';
      const legendStr = options.legendStr || ceraT('deck.legend.outbound', { middle: ceraT('deck.legend.paste', null, lang) }, lang);
      const legendBox = slide.insertTextBox(legendStr, x + 2, currentY, w - 4, legendH);
      const lt = legendBox.getText();
      lt.getTextStyle().setFontFamily('Roboto').setFontSize(this.fitSize_(legendStr, w - 4, 7.2)).setBold(true).setForegroundColor(p.textMuted);

      // Colorize legend bullets safely by exact char position
      try {
        const i1 = legendStr.indexOf('■');
        const i2 = legendStr.indexOf('■', i1 + 1);
        const i3 = legendStr.indexOf('■', i2 + 1);
        if (i1 >= 0) lt.getRange(i1, i1 + 1).getTextStyle().setForegroundColor(options.bulletColor1 || p.rose);
        if (i2 >= 0) lt.getRange(i2, i2 + 1).getTextStyle().setForegroundColor(options.bulletColor2 || p.blue);
        if (i3 >= 0) lt.getRange(i3, i3 + 1).getTextStyle().setForegroundColor(p.amber);
      } catch (e) {}
      legendBox.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.END);

      currentY += legendH + 5;
    }

    const rowH = 26.5;
    const rowGap = 3.5;
    const cardW = w - 4;

    displayItems.forEach((item, idx) => {
      const rowY = currentY + (idx * (rowH + rowGap));
      const isTop = (idx === 0);

      const up = Number(item.uploadGb || 0);
      const down = Number(item.downloadGb || 0);
      const prn = Number(item.printGb || 0);
      const total = Number(item.volumeGb || (up + down + prn) || 0);
      const count = Number(item.count || 0);

      // 1. Row Micro-Card Container
      const rowCard = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, x + 2, rowY, cardW, rowH);
      rowCard.getFill().setSolidFill(isTop ? (options.vectorLight || p.primaryLight || '#EFF6FF') : '#FFFFFF');
      rowCard.getBorder().getLineFill().setSolidFill(isTop ? (options.vectorBorder || p.primaryBorder || '#BFDBFE') : '#E2E8F0');
      rowCard.getBorder().setWeight(1);

      // 2. Rank Badge Pill (Wide and centered)
      const pillW = 18;
      const pillH = 15;
      const pillX = x + 6;
      const pillY = rowY + 3;
      const rankPill = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, pillX, pillY, pillW, pillH);
      rankPill.getFill().setSolidFill(isTop ? (options.vectorColor || p.primary) : '#F1F5F9');
      rankPill.getBorder().setTransparent();
      const rankTxt = slide.insertTextBox(String(idx + 1), pillX - 4, pillY - 1, pillW + 8, pillH + 2);
      rankTxt.getText().getTextStyle().setFontFamily('Roboto').setFontSize(6.8).setBold(true).setForegroundColor(isTop ? '#FFFFFF' : p.textMuted);
      rankTxt.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);

      // 3. Domain / Entity Name (Top tier left, x + 28)
      const cleanName = this.cleanLabel(item.name || ceraT('deck.notRecorded', null, options.lang), 30);
      const nameBox = slide.insertTextBox(cleanName, x + 28, rowY + 1.5, 138, 15);
      nameBox.getText().getTextStyle().setFontFamily('Roboto').setFontSize(this.fitSize_(cleanName, 138, 7.5)).setBold(true).setForegroundColor(p.textDark);

      // 4. Tabular Metrics (Top tier right, x + 168): the caller's wording of the row (options.valueLabel), when given
      let valStr;
      if (typeof options.valueLabel === 'function') {
        valStr = options.valueLabel(item);
      } else if (options.isEventCount) {
        const bpRate = (up + down > 0) ? (((up) / (up + down)) * 100).toFixed(0) + '%' : (item.bypassRate || '0%');
        valStr = `${(up + down || count).toLocaleString()} ev • ${bpRate} Byp`;
      } else {
        const totalStr = this.fmtBytes(total * (1024 ** 3));
        valStr = total > 0 ? totalStr : this.countText_(count, options);
        if (total > 0 && count > 0) {
          valStr = `${totalStr} • ${this.countText_(count, options)}`;
        }
      }
      const valBox = slide.insertTextBox(valStr, x + 168, rowY + 1.5, cardW - 172, 15);
      valBox.getText().getTextStyle().setFontFamily('Roboto').setFontSize(this.fitSize_(valStr, cardW - 172, 7)).setBold(true).setForegroundColor(isTop ? (options.vectorColor || p.primary) : p.textMuted);
      valBox.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.END);

      // 5. Sleek 3.5px Multi-Segment Progress Track (Bottom tier, rowY + 18.5)
      const barX = x + 28;
      const trackW = cardW - 34;
      const barY = rowY + 18.5;
      const barH = 3.5;

      const track = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, barX, barY, trackW, barH);
      track.getFill().setSolidFill('#F1F5F9');
      track.getBorder().setTransparent();

      // Proportional Segment Fills
      let segX = barX;
      const upW = Math.max(0, (up / maxTotal) * trackW);
      const downW = Math.max(0, (down / maxTotal) * trackW);
      const prnW = Math.max(0, (prn / maxTotal) * trackW);

      if (upW > 0.5) {
        const segUp = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, segX, barY, Math.min(upW, (barX + trackW) - segX), barH);
        segUp.getFill().setSolidFill(p.rose);
        segUp.getBorder().setTransparent();
        segX += upW;
      }
      if (downW > 0.5 && segX < (barX + trackW)) {
        const segDown = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, segX, barY, Math.min(downW, (barX + trackW) - segX), barH);
        segDown.getFill().setSolidFill(p.blue);
        segDown.getBorder().setTransparent();
        segX += downW;
      }
      if (prnW > 0.5 && segX < (barX + trackW)) {
        const segPrn = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, segX, barY, Math.min(prnW, (barX + trackW) - segX), barH);
        segPrn.getFill().setSolidFill(p.amber);
        segPrn.getBorder().setTransparent();
      }

      // Fallback single-segment if no vector action breakdown
      if (up === 0 && down === 0 && prn === 0 && total > 0) {
        const singleW = Math.max(2, (total / maxTotal) * trackW);
        const segSingle = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, barX, barY, singleW, barH);
        segSingle.getFill().setSolidFill(options.vectorColor || p.primary);
        segSingle.getBorder().setTransparent();
      }
    });
  },

  /**
   * 2. Render Ranked Single-Metric Horizontal Bars (Slide 10: Print Domains, General Fallbacks)
   */
  renderRankedHorizontalBars(slide, items, x, y, w, h, options) {
    options = options || {};
    const p = options.palette || {
      primary: '#2563EB',
      amber: '#D97706',
      amberLight: '#FFFBEB',
      amberBorder: '#FDE68A',
      textDark: '#0F172A',
      textBody: '#334155',
      textMuted: '#64748B',
      border: '#E2E8F0'
    };

    items = this.filterValidItems(items);
    if (items.length === 0) {
      this.emptyNote_(slide, 'deck.chart.emptyRanked', x, y, w, h, options, p.textMuted);
      return;
    }

    const displayItems = items.slice(0, 5);
    let maxVal = 0;
    displayItems.forEach(i => {
      const v = typeof i.volumeGb === 'number' ? i.volumeGb : (i.count || 0);
      if (v > maxVal) maxVal = v;
    });
    if (maxVal <= 0) maxVal = 1;

    const rowH = 26.5;
    const rowGap = 4;
    const cardW = w - 4;
    const barColor = options.barColor || p.amber || '#D97706';
    const barLight = options.barLight || p.amberLight || '#FFFBEB';
    const barBorder = options.barBorder || p.amberBorder || '#FDE68A';

    displayItems.forEach((item, idx) => {
      const rowY = y + (idx * (rowH + rowGap));
      const isTop = (idx === 0);
      const val = typeof item.volumeGb === 'number' ? item.volumeGb : (item.count || 0);

      // 1. Row Micro-Card Container
      const rowCard = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, x + 2, rowY, cardW, rowH);
      rowCard.getFill().setSolidFill(isTop ? barLight : '#FFFFFF');
      rowCard.getBorder().getLineFill().setSolidFill(isTop ? barBorder : '#E2E8F0');
      rowCard.getBorder().setWeight(1);

      // 2. Rank Badge Pill
      const pillW = 18;
      const pillH = 15;
      const pillX = x + 6;
      const pillY = rowY + 3;
      const rankPill = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, pillX, pillY, pillW, pillH);
      rankPill.getFill().setSolidFill(isTop ? barColor : '#F1F5F9');
      rankPill.getBorder().setTransparent();
      const rankTxt = slide.insertTextBox(String(idx + 1), pillX - 4, pillY - 1, pillW + 8, pillH + 2);
      rankTxt.getText().getTextStyle().setFontFamily('Roboto').setFontSize(6.8).setBold(true).setForegroundColor(isTop ? '#FFFFFF' : p.textMuted);
      rankTxt.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);

      // 3. Entity Label (Top tier left, x + 28)
      const cleanName = this.cleanLabel(item.name || ceraT('deck.notRecorded', null, options.lang), 30);
      const nameBox = slide.insertTextBox(cleanName, x + 28, rowY + 1.5, 138, 15);
      nameBox.getText().getTextStyle().setFontFamily('Roboto').setFontSize(this.fitSize_(cleanName, 138, 7.5)).setBold(true).setForegroundColor(p.textDark);

      // 4. Value Box (Top tier right, x + 168)
      const suffix = options.valueSuffix || (typeof item.volumeGb === 'number' ? ' GB' : ' ev');
      let valStr;
      if (typeof item.volumeGb === 'number' && suffix.trim() === 'GB') {
        valStr = this.fmtBytes(typeof item.bytes === 'number' ? item.bytes : item.volumeGb * (1024 ** 3));
      } else if (typeof options.countLabel === 'function') {
        valStr = options.countLabel(Number(item.count || val || 0));
      } else if (suffix === ' ev') {
        valStr = this.countText_(Number(item.count || val || 0), options);
      } else {
        valStr = (typeof val === 'number' && val % 1 !== 0 ? val.toFixed(2) : Number(val || 0).toLocaleString()) + suffix;
      }
      const valBox = slide.insertTextBox(valStr, x + 168, rowY + 1.5, cardW - 172, 15);
      valBox.getText().getTextStyle().setFontFamily('Roboto').setFontSize(this.fitSize_(valStr, cardW - 172, 7)).setBold(true).setForegroundColor(isTop ? barColor : p.textMuted);
      valBox.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.END);

      // 5. Track & Fill Bar (Underneath text at rowY + 18.5)
      const barX = x + 28;
      const trackW = cardW - 34;
      const barY = rowY + 18.5;
      const barH = 3.5;

      const track = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, barX, barY, trackW, barH);
      track.getFill().setSolidFill('#F1F5F9');
      track.getBorder().setTransparent();

      const fillW = Math.max(2, (val / maxVal) * trackW);
      const fillBar = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, barX, barY, fillW, barH);
      fillBar.getFill().setSolidFill(barColor);
      fillBar.getBorder().setTransparent();
    });
  },

  /**
   * 3. Render Daily Velocity Timeline / Sparkline Histogram (Slide 3: Behavioral Outliers)
   * Enhanced with:
   * - Smart column distribution (handles 3..30 days evenly without center bunching)
   * - Balanced Y-axis reference lines with proper headroom (niceGridMax ~1.35x)
   * - High-contrast peak surge tag positioned cleanly above the bar
   * - Non-overlapping centered X-axis date labels
   * data.lang: the report language of the texts (an empty chart, the unit of a chart counted in transfers).
   */
  renderDailyVelocityTimeline(slide, data, x, y, w, h, palette) {
    const p = palette || {
      primary: '#2563EB',
      rose: '#DC2626',
      amber: '#D97706',
      textDark: '#0F172A',
      textMuted: '#64748B',
      border: '#E2E8F0'
    };

    data = data || {};
    const dates = Array.isArray(data.dates) ? data.dates : [];
    // Raw byte series (preferred); legacy callers may pass GB values in data.volumes
    const rawBytes = Array.isArray(data.bytes)
      ? data.bytes.map(b => Number(b) || 0)
      : (Array.isArray(data.volumes) ? data.volumes.map(v => (Number(v) || 0) * (1024 ** 3)) : []);
    const rawCounts = Array.isArray(data.counts) ? data.counts.map(c => Number(c) || 0) : [];
    const hasBytes = rawBytes.some(b => b > 0);
    // Events without recorded sizes are charted by event count rather than shown as empty
    const countMode = !hasBytes && rawCounts.some(c => c > 0);

    const lang = data.lang || 'en';
    if (!hasBytes && !countMode) {
      this.emptyNote_(slide, 'deck.chart.emptyDaily', x, y, w, h, { lang: lang }, p.textMuted);
      return;
    }

    // Choose a display unit that keeps small tenants readable (B / KB / MB / GB)
    const maxBytes = Math.max(...rawBytes, 0);
    const units = [['GB', 1024 ** 3], ['MB', 1024 ** 2], ['KB', 1024], ['B', 1]];
    let unit = units[units.length - 1];
    for (let u = 0; u < units.length; u++) {
      if (maxBytes >= units[u][1]) { unit = units[u]; break; }
    }
    // A chart counted in transfers says so in the report language ("40 件", "40 ev")
    const unitLabel = countMode ? ceraT('deck.chart.countUnit', null, lang) : unit[0];
    const volumes = countMode ? rawCounts : rawBytes.map(b => b / unit[1]);
    const peakIdx = !countMode && typeof data.peakIdx === 'number' && data.peakIdx >= 0
      ? data.peakIdx
      : volumes.indexOf(Math.max(...volumes));

    const maxVol = Math.max(...volumes, 1.0);
    const topGridVal = this.niceGridMax(maxVol);

    // Plot Area Dimensions
    const plotY = y + 16;
    const plotH = h - 42;
    const plotX = x + 30; // left margin for Y-axis labels
    const plotW = w - 34;

    // 1. Horizontal Reference Gridlines (3 lines: Top, Mid, Baseline)
    const gridSteps = [
      { ratio: 1.0, val: topGridVal },
      { ratio: 0.5, val: Math.round(topGridVal / 2) },
      { ratio: 0.0, val: 0 }
    ];

    gridSteps.forEach(step => {
      const lineY = plotY + plotH - (step.ratio * plotH);

      // Y-axis label
      const lblText = `${step.val} ${unitLabel}`;
      const lbl = slide.insertTextBox(lblText, x, lineY - 6, 28, 12);
      lbl.getText().getTextStyle().setFontFamily('Roboto').setFontSize(this.fitSize_(lblText, 28, 6.5)).setBold(true).setForegroundColor(p.textMuted);
      lbl.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.END);

      // Gridline
      const line = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, plotX, lineY, plotW, 1);
      line.getFill().setSolidFill(step.ratio === 0.0 ? '#CBD5E1' : '#F1F5F9');
      line.getBorder().setTransparent();
    });

    // 2. Smart Column Spacing & Distribution
    const numPoints = volumes.length;
    let colW, colGap, startColX;

    if (numPoints <= 7) {
      // Generous bars for short timelines (e.g. 4..7 days)
      colW = Math.min(30, (plotW / numPoints) * 0.42);
      colGap = (plotW - (numPoints * colW)) / (numPoints + 1);
      startColX = plotX + colGap;
    } else {
      // High-density distribution for longer timelines (e.g. 14..30 days)
      colW = Math.max(3.5, Math.min(16, (plotW / numPoints) * 0.72));
      colGap = (plotW - (numPoints * colW)) / (numPoints + 1);
      startColX = plotX + colGap;
    }

    volumes.forEach((vol, idx) => {
      const isPeak = (idx === peakIdx && vol > 0);
      const colX = startColX + (idx * (colW + colGap));
      const colH = vol > 0 ? Math.max(2, (vol / topGridVal) * plotH) : 0;
      const colY = plotY + plotH - colH;

      // Calendar-filled zero days are drawn as gaps, not as stub bars
      if (colH > 0) {
        const bar = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, colX, colY, colW, colH);
        bar.getFill().setSolidFill(isPeak ? p.rose : (idx % 2 === 0 ? p.primary : '#60A5FA'));
        bar.getBorder().setTransparent();
      }

      // Peak Day Value Tag (Cleanly positioned above the bar with guaranteed clearance)
      if (isPeak) {
        const peakTagW = 46;
        const peakTagH = 13.5;
        const peakTagX = Math.max(plotX, Math.min(plotX + plotW - peakTagW, colX + (colW / 2) - (peakTagW / 2)));
        const peakTagY = Math.max(plotY + 2, colY - 16.5);

        const tagBox = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, peakTagX, peakTagY, peakTagW, peakTagH);
        tagBox.getFill().setSolidFill(p.rose);
        tagBox.getBorder().setTransparent();

        const tagText = countMode ? `${vol.toLocaleString()} ${unitLabel}` : this.fmtBytes(rawBytes[idx]);
        const tagTxt = slide.insertTextBox(tagText, peakTagX - 2, peakTagY - 1, peakTagW + 4, peakTagH + 2);
        tagTxt.getText().getTextStyle().setFontFamily('Roboto').setFontSize(this.fitSize_(tagText, peakTagW + 4, 6.5)).setBold(true).setForegroundColor('#FFFFFF');
        tagTxt.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
      }
    });

    // 3. X-Axis Date Labels (Downsampled if dense, centered under bars)
    const labelY = plotY + plotH + 4;
    const labelStep = numPoints <= 7 ? 1 : (numPoints <= 15 ? 2 : Math.ceil(numPoints / 6));

    for (let i = 0; i < numPoints; i += labelStep) {
      const colCenterX = startColX + (i * (colW + colGap)) + (colW / 2);
      const lblW = 44;
      const lblX = colCenterX - (lblW / 2);
      const rawDate = dates[i] || '';
      const isPeakDate = (i === peakIdx);

      const dateTxt = slide.insertTextBox(rawDate, lblX, labelY, lblW, 12);
      dateTxt.getText().getTextStyle().setFontFamily('Roboto').setFontSize(this.fitSize_(rawDate, lblW, 6.5)).setBold(isPeakDate).setForegroundColor(isPeakDate ? p.rose : p.textMuted);
      dateTxt.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
    }
  }
};
