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
 * Module: SheetsChartEngine.gs
 * Description: Transparent & Vector Chart Adapter for Google Slides & Sheets
 * ==============================================================================
 */

var TransparentChartEngine = {
  insertTransparentChart(slide, config, x, y, w, h, sheetChartRef) {
    // Tier 1 (V4 In-Tenant Engine): Native Slides Vector Chart (Zero Network Call)
    if (typeof VectorChartEngine !== 'undefined' && config) {
      try {
        if (config.type === 'line' && config.data) {
          const dates = config.data.labels || [];
          const ds = (config.data.datasets && config.data.datasets[0]) || {};
          const vols = ds.data || [];
          VectorChartEngine.renderDailyVelocityTimeline(slide, { dates: dates, volumes: vols }, x + 4, y + 2, w - 8, h - 4);
          return null;
        }
        if ((config.type === 'horizontalBar' || config.type === 'bar') && config.data) {
          const labels = config.data.labels || [];
          const datasets = config.data.datasets || [];
          if (datasets.length > 1) {
            const items = labels.map((lbl, idx) => ({
              name: lbl,
              uploadGb: (datasets[0] && datasets[0].data[idx]) || 0,
              downloadGb: (datasets[1] && datasets[1].data[idx]) || 0,
              printGb: (datasets[2] && datasets[2].data[idx]) || 0
            }));
            VectorChartEngine.renderStackedHorizontalBars(slide, items, x + 4, y + 2, w - 8, h - 4, { showLegend: true });
            return null;
          } else if (datasets.length === 1) {
            const items = labels.map((lbl, idx) => ({
              name: lbl,
              volumeGb: datasets[0].data[idx] || 0
            }));
            VectorChartEngine.renderRankedHorizontalBars(slide, items, x + 4, y + 2, w - 8, h - 4, { barColor: datasets[0].backgroundColor });
            return null;
          }
        }
      } catch (e) {
        console.warn('VectorChartEngine fallback: ' + e.message);
      }
    }

    // Tier 2: Native Google Sheets chart image if available
    if (sheetChartRef && typeof slide.insertSheetsChartAsImage === 'function') {
      try { return slide.insertSheetsChartAsImage(sheetChartRef, x, y, w, h); } catch (e) {}
    }

    // Tier 3: Native Slides Vector Fallback Box
    return this.insertNativeVectorChartFallback(slide, config, x, y, w, h);
  },

  insertNativeVectorChartFallback(slide, config, x, y, w, h) {
    try {
      const fallbackBox = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, x, y, w, h);
      fallbackBox.getFill().setSolidFill('#F8FAFC');
      fallbackBox.getBorder().getLineFill().setSolidFill('#E2E8F0');
      fallbackBox.getBorder().setWeight(1);

      const titleText = slide.insertTextBox('Data Visualization', x + 10, y + 10, w - 20, 16);
      titleText.getText().getTextStyle().setFontFamily('Outfit').setFontSize(10).setBold(true).setForegroundColor('#64748B');

      if (config && config.data && config.data.datasets && config.data.datasets.length > 0) {
        const labels = config.data.labels || [];
        const data = config.data.datasets[0].data || [];
        const colors = config.data.datasets[0].backgroundColor || [];
        
        let maxVal = Math.max(...data.filter(v => typeof v === 'number'));
        if (maxVal <= 0) maxVal = 1;

        const maxBars = Math.min(6, labels.length);
        const barH = 10;
        const spacing = 22;
        const startY = y + 36;
        const maxBarW = w - 100;

        for (let i = 0; i < maxBars; i++) {
          const val = data[i] || 0;
          const lbl = labels[i] || 'Item';
          const col = Array.isArray(colors) ? (colors[i] || '#2563EB') : (colors || '#2563EB');
          
          const barW = Math.max(2, (val / maxVal) * maxBarW);
          const barY = startY + (i * spacing);

          const lblBox = slide.insertTextBox(lbl.substring(0,15), x + 10, barY - 4, 80, 18);
          lblBox.getText().getTextStyle().setFontFamily('Outfit').setFontSize(9).setBold(true).setForegroundColor('#0F172A');

          const track = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, x + 90, barY, maxBarW, barH);
          track.getFill().setSolidFill('#F1F5F9');
          track.getBorder().setTransparent();

          if (val > 0) {
            const bar = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, x + 90, barY, barW, barH);
            bar.getFill().setSolidFill(col);
            bar.getBorder().setTransparent();
          }

          const valBox = slide.insertTextBox(val.toString(), x + 90 + maxBarW + 4, barY - 4, 40, 18);
          valBox.getText().getTextStyle().setFontFamily('Outfit').setFontSize(9).setBold(true).setForegroundColor('#475569');
        }
      }
      return fallbackBox;
    } catch (e) {
      return null;
    }
  }
};

/**
 * Engine for generating native interactive charts inside Google Sheets tabs
 */
var NativeSheetsChartEngine = {
  /** An axis title in the report language */
  axisTitle_: function(name, lang) {
    return ceraT('report.axis.' + name, null, lang || 'en');
  },

  /**
   * Embeds a multi-directional stacked combo timeline chart
   * (Stacked Upload and Download bars + Total Events line overlay)
   */
  buildTimelineComboChart: function(sheet, dataRange, startRow, startCol, width, height, title, lang) {
    if (!sheet || !dataRange || typeof sheet.newChart !== 'function') return null;
    try {
      const chartType = (typeof Charts !== 'undefined' && Charts.ChartType && Charts.ChartType.COMBO)
        ? Charts.ChartType.COMBO
        : 'COMBO';
      const chart = sheet.newChart()
        .setChartType(chartType)
        .addRange(dataRange)
        .setPosition(startRow, startCol, 0, 0)
        .setOption('title', title || '')
        .setOption('titleTextStyle', { fontName: 'Outfit', fontSize: 11, bold: true, color: '#0F172A' })
        .setOption('seriesType', 'bars')
        .setOption('isStacked', true)
        .setOption('series', {
          0: { type: 'bars', targetAxisIndex: 0, color: '#DC2626' }, // Upload GB
          1: { type: 'bars', targetAxisIndex: 0, color: '#059669' }, // Download GB
          2: { type: 'line', targetAxisIndex: 1, color: '#2563EB', lineWidth: 3, pointSize: 5 } // Total Events
        })
        .setOption('vAxes', {
          0: { title: NativeSheetsChartEngine.axisTitle_('volumeGb', lang), textStyle: { fontSize: 9 } },
          1: { title: NativeSheetsChartEngine.axisTitle_('events', lang), textStyle: { fontSize: 9 } }
        })
        .setOption('hAxis', { textStyle: { fontSize: 9 } })
        .setOption('legend', { position: 'top', textStyle: { fontSize: 9 } })
        .setOption('width', width || 630)
        .setOption('height', height || 290)
        .build();
      sheet.insertChart(chart);
      return chart;
    } catch (e) {
      console.warn('NativeSheetsChartEngine.buildTimelineComboChart failed (chart "' + (title || '') + '" at row ' + startRow + ', col ' + startCol + '): ' + (e && e.message ? e.message : e));
      return null;
    }
  },

  /**
   * Embeds a ranked horizontal bar chart for File Format / MIME distribution
   */
  buildMimeDistributionChart: function(sheet, dataRange, startRow, startCol, width, height, title, barColor, lang) {
    if (!sheet || !dataRange || typeof sheet.newChart !== 'function') return null;
    try {
      const chartType = (typeof Charts !== 'undefined' && Charts.ChartType && Charts.ChartType.BAR)
        ? Charts.ChartType.BAR
        : 'BAR';
      const chart = sheet.newChart()
        .setChartType(chartType)
        .addRange(dataRange)
        .setPosition(startRow, startCol, 0, 0)
        .setOption('title', title || '')
        .setOption('titleTextStyle', { fontName: 'Outfit', fontSize: 11, bold: true, color: '#0F172A' })
        .setOption('colors', [barColor || '#2563EB'])
        .setOption('legend', { position: 'none' })
        .setOption('hAxis', { title: NativeSheetsChartEngine.axisTitle_('volumeGb', lang), textStyle: { fontSize: 9 } })
        .setOption('vAxis', { textStyle: { fontSize: 9 } })
        .setOption('width', width || 440)
        .setOption('height', height || 290)
        .build();
      sheet.insertChart(chart);
      return chart;
    } catch (e) {
      console.warn('NativeSheetsChartEngine.buildMimeDistributionChart failed (chart "' + (title || '') + '" at row ' + startRow + ', col ' + startCol + '): ' + (e && e.message ? e.message : e));
      return null;
    }
  },

  /**
   * Embeds a multi-threat security incidents combo timeline chart
   * (Stacked Unsafe Visit, Password Reuse, Malware bars + Warning Bypasses line overlay)
   */
  buildSecurityIncidentComboChart: function(sheet, dataRange, startRow, startCol, width, height, title, lang) {
    if (!sheet || !dataRange || typeof sheet.newChart !== 'function') return null;
    try {
      const chartType = (typeof Charts !== 'undefined' && Charts.ChartType && Charts.ChartType.COMBO)
        ? Charts.ChartType.COMBO
        : 'COMBO';
      const chart = sheet.newChart()
        .setChartType(chartType)
        .addRange(dataRange)
        .setPosition(startRow, startCol, 0, 0)
        .setOption('title', title || '')
        .setOption('titleTextStyle', { fontName: 'Outfit', fontSize: 11, bold: true, color: '#0F172A' })
        .setOption('seriesType', 'bars')
        .setOption('isStacked', true)
        .setOption('series', {
          0: { type: 'bars', targetAxisIndex: 0, color: '#2563EB' }, // Unsafe Browsing
          1: { type: 'bars', targetAxisIndex: 0, color: '#7C3AED' }, // Password Reuse
          2: { type: 'bars', targetAxisIndex: 0, color: '#DC2626' }, // Malware Transfer
          3: { type: 'line', targetAxisIndex: 1, color: '#D97706', lineWidth: 3, pointSize: 5 } // Bypassed Warnings
        })
        .setOption('vAxes', {
          0: { title: NativeSheetsChartEngine.axisTitle_('totalIncidents', lang), textStyle: { fontSize: 9 } },
          1: { title: NativeSheetsChartEngine.axisTitle_('bypassed', lang), textStyle: { fontSize: 9 } }
        })
        .setOption('hAxis', { textStyle: { fontSize: 9 } })
        .setOption('legend', { position: 'top', textStyle: { fontSize: 9 } })
        .setOption('width', width || 630)
        .setOption('height', height || 290)
        .build();
      sheet.insertChart(chart);
      return chart;
    } catch (e) {
      console.warn('NativeSheetsChartEngine.buildSecurityIncidentComboChart failed (chart "' + (title || '') + '" at row ' + startRow + ', col ' + startCol + '): ' + (e && e.message ? e.message : e));
      return null;
    }
  },

  /**
   * Embeds a horizontal enforcement breakdown bar chart (Warned, Bypassed, Detected)
   */
  buildEnforcementBarChart: function(sheet, dataRange, startRow, startCol, width, height, title, lang) {
    if (!sheet || !dataRange || typeof sheet.newChart !== 'function') return null;
    try {
      const chartType = (typeof Charts !== 'undefined' && Charts.ChartType && Charts.ChartType.BAR)
        ? Charts.ChartType.BAR
        : 'BAR';
      const chart = sheet.newChart()
        .setChartType(chartType)
        .addRange(dataRange)
        .setPosition(startRow, startCol, 0, 0)
        .setOption('title', title || '')
        .setOption('titleTextStyle', { fontName: 'Outfit', fontSize: 11, bold: true, color: '#0F172A' })
        .setOption('colors', ['#4338CA'])
        .setOption('legend', { position: 'none' })
        .setOption('hAxis', { title: NativeSheetsChartEngine.axisTitle_('incidentCount', lang), textStyle: { fontSize: 9 } })
        .setOption('vAxis', { textStyle: { fontSize: 9 } })
        .setOption('width', width || 440)
        .setOption('height', height || 290)
        .build();
      sheet.insertChart(chart);
      return chart;
    } catch (e) {
      console.warn('NativeSheetsChartEngine.buildEnforcementBarChart failed (chart "' + (title || '') + '" at row ' + startRow + ', col ' + startCol + '): ' + (e && e.message ? e.message : e));
      return null;
    }
  },

  /**
   * Embeds a centralized multi-vector outlier combo timeline chart for Executive Overview
   * (Stacked DLP Transfer Volume bars: Personal, Shadow AI, Unmanaged, Messaging + Security Radar line overlay)
   */
  buildMultiVectorOutlierComboChart: function(sheet, dataRange, startRow, startCol, width, height, title, lang) {
    if (!sheet || !dataRange || typeof sheet.newChart !== 'function') return null;
    try {
      const chartType = (typeof Charts !== 'undefined' && Charts.ChartType && Charts.ChartType.COMBO)
        ? Charts.ChartType.COMBO
        : 'COMBO';
      const chart = sheet.newChart()
        .setChartType(chartType)
        .addRange(dataRange)
        .setPosition(startRow, startCol, 0, 0)
        .setOption('title', title || '')
        .setOption('titleTextStyle', { fontName: 'Outfit', fontSize: 11, bold: true, color: '#0F172A' })
        .setOption('seriesType', 'bars')
        .setOption('isStacked', true)
        .setOption('series', {
          0: { type: 'bars', targetAxisIndex: 0, color: '#1D4ED8' }, // Personal Accounts (Blue)
          1: { type: 'bars', targetAxisIndex: 0, color: '#DC2626' }, // Shadow AI (Red)
          2: { type: 'bars', targetAxisIndex: 0, color: '#D97706' }, // Unmanaged Apps (Amber)
          3: { type: 'bars', targetAxisIndex: 0, color: '#059669' }, // Web Messaging (Green)
          4: { type: 'line', targetAxisIndex: 1, color: '#7C3AED', lineWidth: 3, pointSize: 5 } // Security Radar Incidents (Purple)
        })
        .setOption('vAxes', {
          0: { title: NativeSheetsChartEngine.axisTitle_('dlpVolume', lang), textStyle: { fontSize: 9 } },
          1: { title: NativeSheetsChartEngine.axisTitle_('incidents', lang), textStyle: { fontSize: 9 } }
        })
        .setOption('hAxis', { textStyle: { fontSize: 9 } })
        .setOption('legend', { position: 'top', textStyle: { fontSize: 9 } })
        .setOption('width', width || 680)
        .setOption('height', height || 310)
        .build();
      sheet.insertChart(chart);
      return chart;
    } catch (e) {
      console.warn('NativeSheetsChartEngine.buildMultiVectorOutlierComboChart failed (chart "' + (title || '') + '" at row ' + startRow + ', col ' + startCol + '): ' + (e && e.message ? e.message : e));
      return null;
    }
  }
};

