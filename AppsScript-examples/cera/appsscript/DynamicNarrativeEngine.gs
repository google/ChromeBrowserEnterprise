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
    const { egressPeak, topFunnelOU, topFunnelDomain, funnelHHI, topScatterOU, scatterDomainCount } = outliers || {};
    const statements = [];

    // Busiest outbound day under the deck's peak rule, in the deck's words (downloads are not outbound)
    statements.push(ceraPeakSentence(egressPeak, lang || 'en'));

    // One person's destinations (people above 50 MB of outbound data): an index of 0.75 or more means one destination
    // received most of that person's outbound data, since the largest share is at least the index
    if ((funnelHHI || 0) >= 0.75 && topFunnelDomain) {
      statements.push(ceraT('deck.narr.funnel', { ou: topFunnelOU, dest: ceraDestinationLabel(topFunnelDomain, lang || 'en'), hhi: (funnelHHI * 100).toFixed(0) + '%' }, lang || 'en'));
    } else if ((scatterDomainCount || 0) >= 4) {
      statements.push(ceraT('deck.narr.scatter', { ou: topScatterOU, n: scatterDomainCount }, lang || 'en'));
    }

    // One person's share of a unit, only for units with enough people for it to mean something (ceraUnitSkew)
    const skew = (typeof ceraUnitSkew === 'function') ? ceraUnitSkew(state) : null;
    if (skew && skew.ratio >= 0.80) {
      statements.push(ceraT('deck.skew.assess', { pct: (skew.ratio * 100).toFixed(0) + '%', ou: skew.ou }, lang || 'en'));
    }

    return statements.join(' ');
  }
};
