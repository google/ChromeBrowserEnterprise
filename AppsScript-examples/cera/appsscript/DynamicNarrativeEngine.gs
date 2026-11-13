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
 * Module: DynamicNarrativeEngine.gs
 * Description: 100% Dynamic Natural Language Generation (NLG) Synthesizer
 * ==============================================================================
 */

/**
 * Wording rules: describe what the data shows, never intent. Words such as "exfiltration", "rogue",
 * "evasion" or "data dump" are not used, because audit events record transfers, not motives.
 * Every sentence comes from the message catalogs and states a measured value.
 */
var DynamicNarrativeEngine = {
  getOutlierNarrative(outliers, lang, state) {
    const l = (typeof ceraNormalizeLang_ === 'function') ? ceraNormalizeLang_(lang || 'en') : (lang || 'en');
    const { egressPeak, topFunnelOU, topFunnelDomain, funnelHHI, topScatterOU, scatterDomainCount } = outliers || {};
    const statements = [];
    const hasName = s => {
      const v = String(s || '').trim().toLowerCase();
      return !!v && v !== 'n/a' && v !== 'null' && v !== 'undefined' && v !== '-';
    };
    const fmtOu = s => (typeof ceraFormatOuDisplay_ === 'function') ? ceraFormatOuDisplay_(s, l) : String(s || '');

    // Busiest outbound day under the deck's peak rule, in the deck's words (downloads are not outbound)
    statements.push(ceraPeakSentence(egressPeak, l));

    // One person's destinations (people above 50 MB of outbound data): an index of 0.75 or more means one destination
    // received most of that person's outbound data, since the largest share is at least the index
    const hhi = Number(funnelHHI) || 0;
    const scCount = Math.floor(Number(scatterDomainCount) || 0);
    if (isFinite(hhi) && hhi >= 0.75 && hasName(topFunnelDomain) && hasName(topFunnelOU)) {
      statements.push(ceraT('deck.narr.funnel', { ou: fmtOu(topFunnelOU), dest: ceraDestinationLabel(topFunnelDomain, l), hhi: (hhi * 100).toFixed(0) + '%' }, l));
    } else if (scCount >= 4 && hasName(topScatterOU)) {
      statements.push(ceraT('deck.narr.scatter', { ou: fmtOu(topScatterOU), n: scCount }, l));
    }

    // One person's share of a unit, only for units with enough people for it to mean something (ceraUnitSkew)
    const skew = (typeof ceraUnitSkew === 'function') ? ceraUnitSkew(state) : null;
    if (skew && isFinite(skew.ratio) && skew.ratio >= 0.80) {
      statements.push(ceraT('deck.skew.assess', { pct: (skew.ratio * 100).toFixed(0) + '%', ou: fmtOu(skew.ou) }, l));
    }

    return statements.join(' ');
  }
};
