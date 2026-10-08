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
 * Module: I18n.gs
 * Description: Locale registry, per-user language preference and message lookup
 *              shared by the setup dialog, menus, alerts and reports.
 *              Message catalogs are pre-compiled into I18nMessages.gs.
 * ==============================================================================
 */

var CERA_LOCALES = [
  { code: 'en', label: 'English', intl: 'en-US' },
  { code: 'id', label: 'Bahasa Indonesia', intl: 'id-ID' },
  { code: 'ja', label: '日本語', intl: 'ja-JP' },
  { code: 'ko', label: '한국어', intl: 'ko-KR' },
  { code: 'zh-CN', label: '简体中文', intl: 'zh-CN' }
];
var CERA_DEFAULT_LANG = 'en';
var CERA_LANG_PROPERTY = 'CERA_LANG';

function ceraNormalizeLang_(code) {
  return CERA_LOCALES.some(l => l.code === code) ? code : CERA_DEFAULT_LANG;
}

function ceraLocale_(lang) {
  return CERA_LOCALES.find(l => l.code === lang) || CERA_LOCALES[0];
}

/**
 * Maps a Google locale ("id", "ja", "ko_KR", "zh_CN", "en_US") to a supported language, or '' when none fits.
 * Traditional Chinese (zh_TW, zh_HK) is not supported and does not fall back to Simplified.
 */
function ceraLangFromLocale_(locale) {
  const l = String(locale || '').toLowerCase().replace('-', '_');
  if (!l) return '';
  if (l === 'zh_cn' || l === 'zh_sg' || l === 'zh_hans' || l === 'zh') return 'zh-CN';
  if (l.indexOf('zh') === 0) return '';
  if (l === 'in' || l.indexOf('id') === 0 || l.indexOf('in_') === 0) return 'id';
  const base = l.split('_')[0];
  return ['en', 'ja', 'ko'].indexOf(base) !== -1 ? base : '';
}

/**
 * Language for this user: the one they picked in the dialog (per user, so collaborators on one spreadsheet
 * can differ); otherwise their Google account language; otherwise the spreadsheet locale; otherwise English.
 */
function ceraGetLanguage() {
  try {
    const saved = PropertiesService.getUserProperties().getProperty(CERA_LANG_PROPERTY);
    if (saved) return ceraNormalizeLang_(saved);
  } catch (e) {}
  try {
    const fromUser = ceraLangFromLocale_(Session.getActiveUserLocale());
    if (fromUser) return fromUser;
  } catch (e) {}
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const fromSheet = ss ? ceraLangFromLocale_(ss.getSpreadsheetLocale()) : '';
    if (fromSheet) return fromSheet;
  } catch (e) {}
  return CERA_DEFAULT_LANG;
}

/**
 * Called from the dialog's language picker. Returns the new state so the dialog can re-render without a reload,
 * and rebuilds the CERA menu, which otherwise keeps the language it was built in until the spreadsheet reloads.
 */
function setCeraLanguage(code) {
  const props = PropertiesService.getUserProperties();
  let lang;
  if (code === 'auto') {
    // Back to automatic: follow the Google account language again
    props.deleteProperty(CERA_LANG_PROPERTY);
  } else {
    lang = ceraNormalizeLang_(code);
    props.setProperty(CERA_LANG_PROPERTY, lang);
  }
  try {
    buildCeraMenu_();
  } catch (e) {
    // getUi() throws where there is no UI (triggers); the language is saved and the next open uses it
    Logger.log('CERA menu not rebuilt: ' + e.message);
  }
  return getCeraI18nState(lang);
}

/**
 * Everything the dialog needs to translate itself: the locale list and the English catalog
 * overlaid with the chosen language, so a key missing from a translation falls back to English.
 */
function getCeraI18nState(lang) {
  const code = lang ? ceraNormalizeLang_(lang) : ceraGetLanguage();
  const messages = Object.assign({}, CERA_I18N_MESSAGES[CERA_DEFAULT_LANG], CERA_I18N_MESSAGES[code] || {});
  let isAuto = !lang;
  if (isAuto) {
    try { isAuto = !PropertiesService.getUserProperties().getProperty(CERA_LANG_PROPERTY); } catch (e) {}
  }
  const version = (typeof CeraConfig !== 'undefined' && CeraConfig.VERSION) ? String(CeraConfig.VERSION) : '2.0.0';
  return { lang: code, auto: isAuto, intl: ceraLocale_(code).intl, version: version, locales: CERA_LOCALES, messages: messages };
}

/**
 * Translates a key. Unknown keys return the key itself so a missing string is visible, never blank.
 * Plural messages are objects { one, other } chosen by params.n.
 */
function ceraT(key, params, lang) {
  const code = lang ? ceraNormalizeLang_(lang) : ceraGetLanguage();
  const table = CERA_I18N_MESSAGES[code] || {};
  const msg = table[key] !== undefined ? table[key] : CERA_I18N_MESSAGES[CERA_DEFAULT_LANG][key];
  if (msg === undefined) return key;
  return ceraFormatMessage_(msg, params, code);
}

function ceraFormatMessage_(msg, params, lang) {
  let text = msg;
  if (text && typeof text === 'object') {
    const n = params ? Number(params.n) : NaN;
    text = (n === 1 && text.one !== undefined) ? text.one : text.other;
  }
  return String(text).replace(/\{(\w+)\}/g, (match, name) => {
    if (!params || params[name] === undefined || params[name] === null) return match;
    const value = params[name];
    return typeof value === 'number' ? ceraFormatNumber(value, lang) : String(value);
  });
}

function ceraFormatNumber(n, lang) {
  try {
    return Number(n).toLocaleString(ceraLocale_(lang || ceraGetLanguage()).intl);
  } catch (e) {
    return String(n);
  }
}

function ceraEscapeHtml_(text) {
  return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
