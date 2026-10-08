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
 * Module: Utils.gs
 * Description: High-performance data sanitization, domain normalizers & formatters
 * ==============================================================================
 */

/**
 * Extracts Google Drive Folder ID from raw folder ID string or URL
 */
function extractFolderId(input) {
  if (!input) return '';
  const str = input.trim();

  // 1. Google Sheets URL: /spreadsheets/d/ID
  const sheetsMatch = str.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (sheetsMatch && sheetsMatch[1]) return sheetsMatch[1];

  // 2. Google Drive Folder URL: /folders/ID
  const folderMatch = str.match(/\/folders\/([a-zA-Z0-9-_]+)/);
  if (folderMatch && folderMatch[1]) return folderMatch[1];

  // 3. Google Drive File URL: /file/d/ID
  const fileMatch = str.match(/\/file\/d\/([a-zA-Z0-9-_]+)/);
  if (fileMatch && fileMatch[1]) return fileMatch[1];

  // 4. Direct ID query parameter: ?id=ID or &id=ID
  const idParamMatch = str.match(/[?&]id=([a-zA-Z0-9-_]+)/);
  if (idParamMatch && idParamMatch[1]) return idParamMatch[1];

  // 5. Raw alphanumeric resource ID (standard Google Drive IDs are 20-45 chars)
  const rawMatch = str.match(/[-\w]{20,}/);
  return rawMatch ? rawMatch[0] : str;
}

/**
 * Parses comma-separated domain string into lowercase trimmed array
 */
function parseDomains(csvString) {
  if (!csvString) return [];
  if (Array.isArray(csvString)) return csvString.map(d => String(d).trim().toLowerCase()).filter(Boolean);
  return String(csvString).split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
}

/**
 * Extracts clean domain name from arbitrary URL string
 */
function extractDomain(urlStr) {
  if (!urlStr) return 'Unknown Origin';
  let str = urlStr.toString().trim().replace(/^blob:/i, '');
  if (str.startsWith('file:///')) {
    return 'Local File / PDF';
  }
  if (!str.startsWith('http://') && !str.startsWith('https://')) {
    str = 'https://' + str;
  }
  try {
    const matches = str.match(/^(?:https?:\/\/)?(?:[^@\/?#\n]+@)?(?:www\.)?([^:\/\n\?#]+)/im);
    return matches && matches[1] ? matches[1].toLowerCase() : 'Unknown Origin';
  } catch (e) {
    return 'Unknown Origin';
  }
}

/**
 * Exact-or-suffix domain match: true when host equals pattern or is a subdomain of it.
 * Never substring: box.com does not match dropbox.com.
 */
function domainMatches(host, pattern) {
  if (!host || !pattern) return false;
  const h = String(host).toLowerCase().trim().replace(/\.$/, '');
  const p = String(pattern).toLowerCase().trim().replace(/^\*?\./, '').replace(/\.$/, '');
  if (!h || !p) return false;
  return h === p || h.endsWith('.' + p);
}

/**
 * Returns the entry of list that host matches (exact or suffix), or ''.
 * The longest matching entry wins so that specific hosts beat their parents.
 */
function matchDomainList(host, list) {
  if (!host || !list || !list.length) return '';
  let best = '';
  for (let i = 0; i < list.length; i++) {
    const p = String(list[i] || '').toLowerCase().trim();
    if (p && domainMatches(host, p) && p.length > best.length) best = p;
  }
  return best;
}

/**
 * True when value is an empty, "null" or "undefined" host/URL placeholder.
 */
function isBlankDestination(value) {
  if (value === null || value === undefined) return true;
  const s = String(value).trim().toLowerCase();
  return s === '' || s === 'null' || s === 'undefined' || s === 'unknown origin' ||
    s === String(CeraConfig.UNKNOWN_DESTINATION || '').toLowerCase();
}

/**
 * Lowercase host (www. stripped) of a URL, or '' when there is none
 * (blank, "null" opaque origins such as blob:null/..., or browser-internal protocols).
 */
/**
 * Private or local destinations: RFC 1918, loopback and link-local IPv4, localhost, *.local, *.internal,
 * *.lan, *.corp, home.arpa, single-label hosts (intranet, jira:8443), chrome:// pages and local files.
 * Transfers to these stay inside the organization's network, so they are never counted as unmanaged SaaS.
 * A port is ignored.
 */
function isInternalHost(host) {
  const raw = String(host || '').toLowerCase().trim();
  const h = raw.split(' ')[0].replace(/:\d+$/, '');
  if (!h || isBlankDestination(raw)) return false;
  if (h === 'localhost' || h === 'local' || raw.indexOf('local file') === 0) return true;
  if (/^(10|127)\.\d+\.\d+\.\d+$/.test(h) || /^192\.168\.\d+\.\d+$/.test(h) || /^169\.254\.\d+\.\d+$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(h)) return true;
  if (/\.(local|internal|lan|corp|home\.arpa)$/.test(h)) return true;
  if (/^chrome(-untrusted)?:/.test(h)) return true;
  // A host without a dot resolves only through the organization's own name service
  if (raw.indexOf(' ') === -1 && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(h) && !/^\d+$/.test(h)) return true;
  return false;
}

/**
 * Readable name for a DLP detector. Chrome can report a custom rule by its resource id
 * (policies/aoajj264ap55fkemdy); show it as a custom rule with a short id instead of the raw path.
 */
function ceraDetectorLabel(name) {
  const n = String(name || '').trim();
  const m = n.match(/^policies\/([A-Za-z0-9]+)$/);
  if (m) return 'Custom rule (' + m[1].slice(-6) + ')';
  // Predefined detector ids such as CREDIT_CARD_NUMBER or GENDER read as "Credit card number", "Gender"; short
  // acronyms such as SSN or NIK stay as they are
  if (/^[A-Z0-9_]+$/.test(n) && (n.indexOf('_') !== -1 || n.length >= 5)) {
    const words = n.toLowerCase().split('_').filter(Boolean).join(' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  return n;
}

var _ceraHostCache_ = Object.create(null);
var _ceraHostCacheSize_ = 0;

function extractHost(urlStr) {
  if (urlStr === null || urlStr === undefined || urlStr === '') return '';
  const raw = typeof urlStr === 'string' ? urlStr.trim() : String(urlStr).trim();
  if (!raw || raw.charAt(0) === '/' || /^[a-z]:[\\/]/i.test(raw) || raw.indexOf('\\') !== -1) return '';
  const schemeEnd = raw.indexOf('://');
  const slashAfter = schemeEnd !== -1 ? raw.indexOf('/', schemeEnd + 3) : raw.indexOf('/');
  const qAfter = schemeEnd !== -1 ? raw.indexOf('?', schemeEnd + 3) : raw.indexOf('?');
  const hAfter = schemeEnd !== -1 ? raw.indexOf('#', schemeEnd + 3) : raw.indexOf('#');
  let cut = raw.length;
  if (slashAfter !== -1 && slashAfter < cut) cut = slashAfter + 1;
  if (qAfter !== -1 && qAfter < cut) cut = qAfter;
  if (hAfter !== -1 && hAfter < cut) cut = hAfter;
  const prefix = cut < raw.length ? raw.slice(0, cut) : raw;
  const hit = _ceraHostCache_[prefix];
  if (hit !== undefined) return hit;

  let result = '';
  if (!isBlankDestination(prefix)) {
    const s = prefix.replace(/^blob:/i, '');
    const authority = (schemeEnd !== -1 ? s.replace(/^[a-z0-9+.-]+:\/\//i, '') : s).split(/[\/?#]/)[0];
    if (authority && !/\s/.test(authority) &&
        !/^(file|data|chrome|chrome-untrusted|chrome-extension|devtools|edge|moz-extension|safari-extension|view-source|about|javascript|mailto|tel|urn|ws|wss):/i.test(s)) {
      const hasHttpScheme = /^https?:\/\//i.test(s);
      const d = extractDomain(s);
      if (d !== 'Local File / PDF' && !isBlankDestination(d) && !/[\s\\]/.test(d) &&
          (hasHttpScheme || d.indexOf('.') !== -1 || d === 'localhost')) {
        result = d;
      }
    }
  }
  if (_ceraHostCacheSize_ > 10000) {
    _ceraHostCache_ = Object.create(null);
    _ceraHostCacheSize_ = 0;
  }
  _ceraHostCache_[prefix] = result;
  _ceraHostCacheSize_++;
  return result;
}

/**
 * GenAI tool match for a host against CeraConfig.DEFAULT_DOMAINS.GENAI_TOOLS (exact or suffix).
 * Returns the canonical destination name, or '' when the host is not a GenAI tool.
 * Bare search portals (google.com, bing.com) are never GenAI.
 */
function matchGenAiHost(host) {
  if (!host) return '';
  const h = String(host).toLowerCase().trim();
  const cfg = CeraConfig.DEFAULT_DOMAINS;
  if (isGenAiExcludedHost(h)) return '';
  const hit = matchDomainList(h, cfg.GENAI_TOOLS || []);
  if (!hit) return '';
  return (cfg.GENAI_CANONICAL && cfg.GENAI_CANONICAL[hit]) || hit;
}

function isGenAiHost(host) {
  return !!matchGenAiHost(host);
}

/**
 * True for hosts that must never be counted as GenAI (bare google.com / bing.com).
 */
function isGenAiExcludedHost(host) {
  if (!host) return false;
  return (CeraConfig.DEFAULT_DOMAINS.GENAI_NEVER || []).indexOf(String(host).toLowerCase().trim()) !== -1;
}

var _ceraTimeZone_ = null;
var _ceraDayKeyTz_ = null;
var _ceraDayKeyCache_ = {};

/**
 * Time zone for day buckets and displayed dates. CERA runs in many customer domains from copies of one
 * project, so the script time zone (fixed in appsscript.json) is not the customer's. The customer's
 * spreadsheet time zone (File > Settings) is used first, then the script time zone, then the config default.
 */
function ceraTimeZone() {
  if (_ceraTimeZone_) return _ceraTimeZone_;
  let tz = '';
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss && typeof ss.getSpreadsheetTimeZone === 'function') tz = ss.getSpreadsheetTimeZone();
  } catch (e) {}
  if (typeof tz !== 'string') tz = '';
  if (!tz) {
    try { tz = Session.getScriptTimeZone(); } catch (e) {}
  }
  _ceraTimeZone_ = tz || CeraConfig.DEFAULT_TIMEZONE || 'UTC';
  return _ceraTimeZone_;
}

/**
 * Calendar-day key (yyyy-MM-dd) of a Date in the customer's time zone (ceraTimeZone), so day buckets
 * match the dates shown in the reports. Cached per 15-minute slot (every UTC offset is a
 * multiple of 15 minutes), which keeps the per-row cost low.
 */
var _ceraHourCacheTz_ = null;
var _ceraHourCache_ = {};

/**
 * Whether the time falls on a Saturday or Sunday in the report time zone.
 */
function ceraIsWeekendMs_(ms, tz) {
  return Number(Utilities.formatDate(new Date(ms), tz || ceraTimeZone(), 'u')) >= 6; // 6 = Saturday, 7 = Sunday
}

function ceraIsAfterHoursMs_(ms) {
  if (typeof ms !== 'number' || isNaN(ms)) return false;
  const tz = ceraTimeZone();
  const hours = CeraConfig.WORK_HOURS || { start: 8, end: 19 };
  const tzKey = tz + '|' + hours.start + '|' + hours.end;
  if (_ceraHourCacheTz_ !== tzKey) {
    _ceraHourCacheTz_ = tzKey;
    _ceraHourCache_ = {};
  }
  const slot = Math.floor(ms / 900000);
  if (_ceraHourCache_[slot] !== undefined) return _ceraHourCache_[slot];
  let after = false;
  try {
    const parts = Utilities.formatDate(new Date(ms), tz, 'H|u').split('|');
    const hour = Number(parts[0]);
    const isoDow = Number(parts[1]);
    after = isoDow >= 6 || hour < hours.start || hour >= hours.end;
  } catch (e) {}
  _ceraHourCache_[slot] = after;
  return after;
}

/**
 * True when a moment falls outside working hours (CeraConfig.WORK_HOURS, local time) or on a weekend,
 * in the customer's time zone. Cached per 15-minute slot like ceraDayKey.
 */
function ceraIsAfterHours(dt) {
  if (!(dt instanceof Date)) return false;
  return ceraIsAfterHoursMs_(dt.getTime());
}

function ceraDayKeyMs_(ms) {
  if (typeof ms !== 'number' || isNaN(ms)) return '';
  const tz = ceraTimeZone();
  if (_ceraDayKeyTz_ !== tz) {
    _ceraDayKeyTz_ = tz;
    _ceraDayKeyCache_ = {};
  }
  const slot = Math.floor(ms / 900000);
  const cached = _ceraDayKeyCache_[slot];
  if (cached) return cached;
  const dt = new Date(ms);
  let key = '';
  try {
    key = Utilities.formatDate(dt, tz, 'yyyy-MM-dd');
  } catch (e) {
    key = dt.toISOString().split('T')[0];
  }
  _ceraDayKeyCache_[slot] = key;
  return key;
}

function ceraDayKey(dt) {
  if (!(dt instanceof Date)) return '';
  return ceraDayKeyMs_(dt.getTime());
}

/**
 * Offset east of UTC, in minutes, that a timestamp was written with ("2026-09-01T10:32:07+08:00" gives 480): console
 * exports write local times with the offset of the console. null for a UTC time ("Z"), a time without an offset, or a
 * Date: those are bucketed in the report time zone (ceraTimeZone).
 */
function ceraTimestampOffset_(value) {
  if (typeof value !== 'string') return null;
  const len = value.length;
  if (len < 6) return null;
  const last = value.charCodeAt(len - 1);
  if (last === 90 || last === 122) return null;
  const m = value.trim().match(/\d:\d{2}(?::\d{2}(?:[.,]\d+)?)?\s*(?:GMT|UTC)?\s*([+-])(\d{2}):?(\d{2})$/i);
  if (!m) return null;
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  if (minutes > 14 * 60) return null;
  return m[1] === '-' ? -minutes : minutes;
}

var _ceraUtcDayCache_ = Object.create(null);

/**
 * Calendar day (yyyy-MM-dd) of a moment (ms) in the offset its timestamp was written with (offsetMin, from
 * ceraTimestampOffset_), so a day of the log is the day its rows show; without one, in the report time zone (ceraDayKey).
 */
function ceraLocalDayKey(ms, offsetMin) {
  if (typeof ms !== 'number' || isNaN(ms)) return '';
  if (typeof offsetMin !== 'number') return ceraDayKeyMs_(ms);
  const localMs = ms + offsetMin * 60000;
  const daySlot = Math.floor(localMs / 86400000);
  const hit = _ceraUtcDayCache_[daySlot];
  if (hit !== undefined) return hit;
  const key = new Date(localMs).toISOString().slice(0, 10);
  _ceraUtcDayCache_[daySlot] = key;
  return key;
}

/**
 * True when a moment (ms) falls outside working hours (CeraConfig.WORK_HOURS) or on a weekend, in the offset its
 * timestamp was written with (offsetMin); without one, in the report time zone (ceraIsAfterHours).
 */
function ceraLocalIsAfterHours(ms, offsetMin) {
  if (typeof ms !== 'number' || isNaN(ms)) return false;
  if (typeof offsetMin !== 'number') return ceraIsAfterHoursMs_(ms);
  const localMs = ms + offsetMin * 60000;
  const hours = CeraConfig.WORK_HOURS || { start: 8, end: 19 };
  const day = ((Math.floor(localMs / 86400000) + 4) % 7 + 7) % 7; // 0 = Sunday, 6 = Saturday
  const hour = ((Math.floor(localMs / 3600000) % 24) + 24) % 24;
  return day === 0 || day === 6 || hour < hours.start || hour >= hours.end;
}

/**
 * Lists every yyyy-MM-dd key from firstKey to lastKey inclusive (calendar-filled series).
 */
function ceraCalendarDayKeys(firstKey, lastKey) {
  const a = String(firstKey || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  const b = String(lastKey || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!a || !b) return [];
  const start = Date.UTC(+a[1], +a[2] - 1, +a[3]);
  const end = Date.UTC(+b[1], +b[2] - 1, +b[3]);
  const keys = [];
  for (let t = start; t <= end && keys.length < 3660; t += 86400000) {
    keys.push(new Date(t).toISOString().slice(0, 10));
  }
  return keys;
}

var _ceraCleanDomainCache_ = Object.create(null);
var _ceraCleanDomainCacheSize_ = 0;

/**
 * Normalizes a destination into a reporting domain using exact-or-suffix host matching
 * (never substring matching). Keeps distinct Google Workspace services, canonicalizes GenAI
 * tools, and returns the registrable (main) domain for other external services.
 * Empty / "null" / "undefined" destinations become CeraConfig.UNKNOWN_DESTINATION.
 */
function cleanAndNormalizeDomain(rawUrl, webAppAccount, corpDomains, rawTabUrl) {
  const UNKNOWN = CeraConfig.UNKNOWN_DESTINATION || 'Unknown destination';
  const target = isBlankDestination(rawUrl) ? '' : String(rawUrl).trim().replace(/^blob:/i, '');
  const tabTarget = isBlankDestination(rawTabUrl) ? '' : String(rawTabUrl).trim().replace(/^blob:/i, '');
  if (!target && !tabTarget) return UNKNOWN;

  if (/^file:\/\//i.test(target) || /^file:\/\//i.test(tabTarget)) {
    return 'Local File / PDF';
  }

  // Fallback to the tab URL when the URL is blank, an opaque origin or a browser-internal protocol
  const tabHost = extractHost(tabTarget);
  let host = extractHost(target);
  let usingTab = false;
  if (!host) {
    host = tabHost;
    usingTab = true;
  }
  if (!host) return UNKNOWN;

  const cacheKey = host + '|' + (usingTab ? '' : tabHost);
  const cached = _ceraCleanDomainCache_[cacheKey];
  if (cached !== undefined) return cached;

  let result = '';
  // 1. GenAI tools by destination host
  const genAi = matchGenAiHost(host);
  if (genAi) {
    result = genAi;
  } else {
    // 2. Google Workspace service-specific normalization (host based)
    const googleService = _googleServiceForHost_(host);
    if (googleService) {
      result = googleService;
    } else if (domainMatches(host, 'google.com') || domainMatches(host, 'googleusercontent.com')) {
      // Generic Google / googleusercontent host: attribute to the tab when it names a more specific service
      if (!usingTab && tabHost) {
        const tabDom = cleanAndNormalizeDomain(tabTarget, webAppAccount, corpDomains, '');
        if (tabDom && tabDom !== UNKNOWN && tabDom !== 'google.com' && tabDom !== 'Local File / PDF') result = tabDom;
      }
      if (!result) result = 'google.com';
    } else if (domainMatches(host, 'fbsbx.com') || domainMatches(tabHost, 'fbsbx.com')) {
      // 3. Facebook / Meta CDN
      result = 'facebook.com';
    } else {
      // 4. GenAI tools by tab host (e.g. a CDN upload made from a GenAI tab)
      const tabGenAi = matchGenAiHost(tabHost);
      if (tabGenAi) {
        result = tabGenAi;
      } else {
        // 5. Registrable (main) domain for other external hosts
        const mainD = extractMainDomain(host);
        result = isBlankDestination(mainD) ? UNKNOWN : mainD;
      }
    }
  }

  if (_ceraCleanDomainCacheSize_ > 10000) {
    _ceraCleanDomainCache_ = Object.create(null);
    _ceraCleanDomainCacheSize_ = 0;
  }
  _ceraCleanDomainCache_[cacheKey] = result;
  _ceraCleanDomainCacheSize_++;
  return result;
}

/**
 * Maps a Google host to its reporting service name, or '' when it is not a distinct service.
 */
function _googleServiceForHost_(h) {
  if (!h) return '';
  if (domainMatches(h, 'mail.google.com') || domainMatches(h, 'mail-attachment.googleusercontent.com') || domainMatches(h, 'gmail.com')) return 'gmail.com';
  if (domainMatches(h, 'drive.google.com') || domainMatches(h, 'drive.usercontent.google.com')) return 'drive.google.com';
  if (domainMatches(h, 'googleusercontent.com') && /(takeout-download-drive|drive-download)/i.test(h)) return 'drive.google.com';
  if (domainMatches(h, 'docs.google.com') || domainMatches(h, 'forms.google.com') ||
      domainMatches(h, 'sheets.googleusercontent.com') || domainMatches(h, 'docstext.googleusercontent.com') ||
      domainMatches(h, 'drawings.googleusercontent.com') ||
      (domainMatches(h, 'googleusercontent.com') && /^doc-[0-9a-z-]+-(sheets|docstext|drawings)\./i.test(h))) return 'docs.google.com';
  if (domainMatches(h, 'classroom.google.com')) return 'classroom.google.com';
  if (domainMatches(h, 'chat.google.com')) return 'chat.google.com';
  if (domainMatches(h, 'script.google.com')) return 'script.google.com';
  if (domainMatches(h, 'photos.google.com')) return 'photos.google.com';
  return '';
}

/**
 * Extracts origin tab domain for unspecified/ambiguous events
 */
function extractTabDomain(tabUrl, url) {
  if (tabUrl && tabUrl.toString().trim()) {
    return extractDomain(tabUrl);
  }
  if (url && url.toString().trim()) {
    return extractDomain(url);
  }
  return 'Direct Browser Protocol';
}

/**
 * Shared-hosting domains: every subdomain is a separate site with its own owner (testsafebrowsing.appspot.com is
 * not appspot.com), so a destination on one of them is named by its full host. The one list for every label.
 */
var CERA_SHARED_HOSTING_SUFFIXES = ['appspot.com', 'run.app', 'web.app', 'firebaseapp.com', 'github.io', 'vercel.app',
  'netlify.app', 'pages.dev', 'workers.dev', 'herokuapp.com', 'cloudfront.net', 'azurewebsites.net', 'ai.studio'];

/**
 * The shared-hosting domain a host is a site of, or '' (the bare shared-hosting domain is not a site of its own).
 */
function ceraSharedHostingSuffix(host) {
  const h = String(host || '').toLowerCase().trim().replace(/\.$/, '');
  for (let i = 0; i < CERA_SHARED_HOSTING_SUFFIXES.length; i++) {
    const s = CERA_SHARED_HOSTING_SUFFIXES[i];
    if (h.length > s.length + 1 && h.slice(-(s.length + 1)) === '.' + s) return s;
  }
  return '';
}

/**
 * Browser-internal and local schemes. A destination on one of them is a page of the browser or a file on the device,
 * never an outside app; ingestion can keep the bare scheme as the destination name ("chrome-untrusted").
 */
var CERA_LOCAL_SCHEMES = { 'chrome': 'browser', 'chrome-untrusted': 'browser', 'chrome-extension': 'browser', 'devtools': 'browser', 'file': 'local' };

/**
 * What a destination name, host or URL is, for its label: 'browser' (a browser page), 'local' (a local file),
 * 'ip' (a direct IP address), 'internal' (a private or single-label host) or 'external'.
 */
function ceraHostKind(name) {
  const s = String(name || '').trim().toLowerCase();
  const scheme = s.match(/^([a-z][a-z0-9+.-]*):/);
  if (scheme && CERA_LOCAL_SCHEMES[scheme[1]]) return CERA_LOCAL_SCHEMES[scheme[1]];
  if (CERA_LOCAL_SCHEMES[s]) return CERA_LOCAL_SCHEMES[s];
  if (s.indexOf('local file') === 0) return 'local';
  const host = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[\/?#]/)[0];
  if (/^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(host)) return 'ip';
  if (isInternalHost(host)) return 'internal';
  return 'external';
}

/**
 * Display label of a destination (a domain name from ingestion, a host or a URL). Browser pages and local files are
 * named as such; a URL is shown as its host; anything else is returned unchanged. lang: the report language.
 */
function ceraDestinationLabel(name, lang) {
  const raw = String(name === null || name === undefined ? '' : name).trim();
  const kind = ceraHostKind(raw);
  if (kind === 'browser') {
    const scheme = raw.toLowerCase().match(/^[a-z][a-z0-9+.-]*/);
    return ceraT('deck.host.browserPage', { scheme: (scheme ? scheme[0] : 'chrome') + '://' }, lang);
  }
  if (kind === 'local') return ceraT('deck.host.localFile', null, lang);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    const host = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[\/?#]/)[0].replace(/^www\./i, '');
    return host || raw;
  }
  return raw;
}

/**
 * Short label for a tight space: cut at max characters with an ellipsis. A site on a shared-hosting domain keeps its
 * suffix ("ais-dev-ebes2xuxnd….run.app"), so it still reads as the site it is.
 */
function ceraShortLabel(label, max) {
  const s = String(label === null || label === undefined ? '' : label);
  const limit = Math.max(4, Number(max) || 30);
  if (s.length <= limit) return s;
  const suffix = /\s/.test(s) ? '' : ceraSharedHostingSuffix(s);
  if (suffix) {
    const tail = '.' + suffix;
    const head = s.slice(0, limit - tail.length - 1);
    if (head.length >= 4) return head + '…' + tail;
  }
  return s.slice(0, limit - 1) + '…';
}

/**
 * True when a flagged file has no real name: a blob: download leaves only an opaque id (51351ed7-23f4-...),
 * and ingestion uses "Unknown Payload" when the log has neither a content name nor a URL.
 */
function ceraIsOpaqueFileName(fileName) {
  const n = String(fileName || '').trim();
  return !n || /^unknown payload$/i.test(n) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(n) || /^[0-9a-f]{24,}$/i.test(n);
}

/**
 * Display name of a flagged file: its name, or "Unnamed file from <host>" when the log has no real name.
 */
function ceraFileLabel(fileName, host, lang) {
  if (!ceraIsOpaqueFileName(fileName)) return String(fileName).trim();
  const h = host && !isBlankDestination(host) ? ceraDestinationLabel(host, lang) : '';
  return h ? ceraT('deck.file.unnamedFrom', { host: h }, lang) : ceraT('deck.file.unnamed', null, lang);
}

/**
 * Format families that ingestion can report per vector (vectors[v].families), each with a catalog label.
 */
var CERA_FORMAT_FAMILIES = ['pdf', 'spreadsheet', 'presentation', 'document', 'archive', 'image', 'video', 'audio', 'text', 'code', 'executable',
  'extension', 'other'];

function ceraFamilyLabel(familyId, lang) {
  const id = String(familyId || '').trim();
  return CERA_FORMAT_FAMILIES.indexOf(id) !== -1 ? ceraT('deck.family.' + id, null, lang) : id;
}

// The format names cleanMimeType stores in the state, by catalog id (report.mime.*): the English catalog holds the
// same names, other languages translate them. A MIME type kept as logged ("text/plain") has no entry.
var CERA_MIME_LABEL_IDS = {
  'PDF Document': 'pdf', 'Spreadsheet (XLS/CSV)': 'spreadsheet', 'Presentation (PPT/Keynote)': 'presentation',
  'Word / Text Document': 'document', 'Source Code / Script': 'code', 'Archive / Compressed': 'archive',
  'Executable / Binary Payload': 'executable', 'Image / Graphic': 'image', 'Video Recording': 'video',
  'Audio File': 'audio', 'Generic Binary Data': 'binary', 'Unspecified File Type': 'unspecified'
};

/** A format name of cleanMimeType in the report language; any other name as recorded. */
function ceraMimeLabel(name, lang) {
  const raw = String(name === null || name === undefined ? '' : name);
  const id = Object.prototype.hasOwnProperty.call(CERA_MIME_LABEL_IDS, raw.trim()) ? CERA_MIME_LABEL_IDS[raw.trim()] : '';
  return id ? ceraT('report.mime.' + id, null, lang) : raw;
}

/**
 * A URL category CERA names itself, as { id, host }: 'internalApps' (ingestion's name for a corporate host without a
 * category), 'unspecified' and 'uncategorized' (no category in the log), 'unspecifiedHost' (formatUnspecifiedCategoryLabel,
 * with the host most such transfers went to). null for a category of the log.
 */
function ceraOwnCategory(name) {
  const raw = String(name === null || name === undefined ? '' : name).trim();
  if (raw === 'Internal Apps') return { id: 'internalApps', host: '' };
  if (/^unspecified$/i.test(raw)) return { id: 'unspecified', host: '' };
  if (/^uncategorized$/i.test(raw)) return { id: 'uncategorized', host: '' };
  const m = raw.match(/^Unspecified\s*\((.+)\)$/);
  return m ? { id: 'unspecifiedHost', host: m[1].trim() } : null;
}

/** A URL category in the report language when CERA named it (ceraOwnCategory); a category of the log as recorded. */
function ceraCategoryLabel(name, lang) {
  const own = ceraOwnCategory(name);
  if (!own) return String(name === null || name === undefined ? '' : name);
  return ceraT('report.category.' + own.id, own.host ? { host: own.host } : null, lang);
}

/**
 * Extracts clean apex / main registered domain (e.g. subsub.sub.domain.com -> domain.com). A site on a
 * shared-hosting domain (CERA_SHARED_HOSTING_SUFFIXES) keeps its full host, and so does an internal or local host
 * (isInternalHost: private IPs, localhost, single-label hosts, *.local, *.internal, *.lan, *.corp): its name comes from
 * the organization's own network, where one.core.local and two.core.local are different machines, not one site.
 */
function extractMainDomain(domainStr) {
  if (!domainStr) return '';
  let d = domainStr.toString().trim().toLowerCase();
  if (d.includes('://')) d = d.split('://')[1];
  d = d.split('/')[0].split('?')[0].split(':')[0].split('#')[0].trim();
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(d)) return d;
  if (d.startsWith('www.')) d = d.substring(4);
  if (ceraSharedHostingSuffix(d) || isInternalHost(d)) return d;
  const parts = d.split('.');
  if (parts.length <= 2) return d;
  const secondLevelTlds = [
    'co.id', 'go.id', 'ac.id', 'or.id', 'net.id', 'sch.id', 'biz.id', 'my.id',
    'gov.ph', 'com.ph', 'edu.ph', 'org.ph', 'net.ph',
    'co.uk', 'gov.uk', 'ac.uk', 'org.uk',
    'com.au', 'gov.au', 'edu.au', 'org.au',
    'co.jp', 'ne.jp', 'or.jp', 'go.jp', 'ac.jp',
    'com.sg', 'gov.sg', 'edu.sg',
    'com.my', 'gov.my', 'edu.my',
    'co.th', 'go.th', 'ac.th'
  ];
  const lastTwo = parts.slice(-2).join('.');
  if (secondLevelTlds.includes(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

/**
 * Formats clean category label for unspecified URL categories using apex domain
 */
function formatUnspecifiedCategoryLabel(unspecifiedTabDomains) {
  if (!unspecifiedTabDomains || Object.keys(unspecifiedTabDomains).length === 0) {
    return 'Unspecified';
  }
  const sorted = Object.entries(unspecifiedTabDomains).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return 'Unspecified';
  const topDomain = extractMainDomain(sorted[0][0]);
  return 'Unspecified (' + topDomain + ')';
}

/**
 * Categorizes and sanitizes MIME types into human-readable business file classes
 */
function cleanMimeType(contentType, contentName) {
  const type = (contentType || '').toLowerCase().trim();
  const name = (contentName || '').toLowerCase().trim();

  // 1. PDF Documents
  if (type.includes('pdf') || name.endsWith('.pdf')) return 'PDF Document';

  // 2. Spreadsheets (Excel / CSV / ODS)
  if (type.includes('spreadsheet') || type.includes('excel') || type.includes('csv') ||
      name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv') || name.endsWith('.ods')) {
    return 'Spreadsheet (XLS/CSV)';
  }

  // 3. Presentations (PowerPoint / Keynote)
  if (type.includes('presentation') || type.includes('powerpoint') ||
      name.endsWith('.pptx') || name.endsWith('.ppt') || name.endsWith('.key')) {
    return 'Presentation (PPT/Keynote)';
  }

  // 4. Word / Rich Text Documents
  if (type.includes('word') || type.includes('document') || type.includes('rtf') ||
      name.endsWith('.docx') || name.endsWith('.doc') || name.endsWith('.rtf') || name.endsWith('.odt')) {
    return 'Word / Text Document';
  }

  // 5. Source Code & Scripts
  if (type.includes('json') || type.includes('javascript') || type.includes('xml') || type.includes('html') ||
      name.endsWith('.js') || name.endsWith('.py') || name.endsWith('.java') || name.endsWith('.cpp') ||
      name.endsWith('.c') || name.endsWith('.cs') || name.endsWith('.go') || name.endsWith('.ts') ||
      name.endsWith('.sh') || name.endsWith('.sql') || name.endsWith('.json') || name.endsWith('.yaml') || name.endsWith('.yml')) {
    return 'Source Code / Script';
  }

  // 6. Compressed Archives
  if (type.includes('zip') || type.includes('tar') || type.includes('gzip') || type.includes('7z') || type.includes('rar') ||
      name.endsWith('.zip') || name.endsWith('.rar') || name.endsWith('.7z') || name.endsWith('.tar') || name.endsWith('.gz')) {
    return 'Archive / Compressed';
  }

  // 7. Binary Executables & Installers
  if (type.includes('executable') || type.includes('octet-stream') && (name.endsWith('.exe') || name.endsWith('.dmg') || name.endsWith('.pkg') || name.endsWith('.msi')) ||
      name.endsWith('.exe') || name.endsWith('.msi') || name.endsWith('.dmg') || name.endsWith('.pkg') || name.endsWith('.deb') || name.endsWith('.rpm')) {
    return 'Executable / Binary Payload';
  }

  // 8. Media (Images / Audio / Video)
  if (type.startsWith('image/') || name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.webp') || name.endsWith('.gif')) {
    return 'Image / Graphic';
  }
  if (type.startsWith('video/') || name.endsWith('.mp4') || name.endsWith('.mov') || name.endsWith('.avi') || name.endsWith('.mkv')) {
    return 'Video Recording';
  }
  if (type.startsWith('audio/') || name.endsWith('.mp3') || name.endsWith('.wav') || name.endsWith('.aac') || name.endsWith('.m4a')) {
    return 'Audio File';
  }

  // 9. Fallback generic binary or unspecified
  if (type.includes('octet-stream') || type.includes('binary')) {
    return 'Generic Binary Data';
  }
  return type ? type.substring(0, 24) : 'Unspecified File Type';
}

/**
 * Formats byte values into executive-friendly strings (B, KB, MB, GB, TB)
 */
function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0.00 MB';
  const num = Number(bytes);
  if (isNaN(num)) return '0.00 MB';

  const gb = num / (1024 * 1024 * 1024);
  if (gb >= 1.0) {
    return gb.toFixed(2) + ' GB';
  }
  const mb = num / (1024 * 1024);
  if (mb >= 1.0) {
    return mb.toFixed(2) + ' MB';
  }
  const kb = num / 1024;
  if (kb >= 1.0) {
    return kb.toFixed(1) + ' KB';
  }
  return num + ' B';
}

/**
 * A calendar day in the way of a report language other than English: "2026年8月3日", "2026년 8월 3일", "3 Agu 2026"
 * (Intl, the locale of CERA_LOCALES), without the year when includeYear is false. null when the runtime cannot format
 * it, so the caller keeps its own format.
 */
function ceraLocaleDate_(year, month, day, includeYear, lang) {
  try {
    const opts = includeYear === false ? { month: 'short', day: 'numeric', timeZone: 'UTC' } : { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' };
    const text = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).toLocaleDateString(ceraLocale_(lang).intl, opts);
    return text && !/invalid/i.test(text) ? text : null;
  } catch (e) {
    return null;
  }
}

/**
 * A month of a year as a chart label ('2026-08'): "AUG 26" in English, "26年8月", "Agu 26" ... in the report language.
 */
function ceraMonthLabel(monthKey, lang) {
  const m = String(monthKey || '').match(/^(\d{4})-(\d{2})/);
  if (!m) return String(monthKey || '');
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const english = (months[Number(m[2]) - 1] || m[2]) + ' ' + m[1].slice(2);
  if (!lang || lang === 'en') return english;
  try {
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)).toLocaleDateString(ceraLocale_(lang).intl, { year: '2-digit', month: 'short', timeZone: 'UTC' }) || english;
  } catch (e) {
    return english;
  }
}

/**
 * Formats timestamp strings or Date objects into clean executive dates (e.g., '29 AUG 2026'). lang: the report
 * language; dates in other languages follow its calendar format (ceraLocaleDate_), English keeps '29 AUG 2026'.
 */
function formatDisplayDate(dateInput, includeYear, lang) {
  if (!dateInput) return '';
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const local = lang && lang !== 'en';
  // Day keys (yyyy-MM-dd) are already local calendar days: format them as-is, never through Date,
  // which would read them as UTC midnight and shift them a day in negative-offset time zones
  const key = typeof dateInput === 'string' && dateInput.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (key) {
    const localized = local ? ceraLocaleDate_(key[1], key[2], key[3], includeYear, lang) : null;
    if (localized) return localized;
    const label = key[3] + ' ' + months[Number(key[2]) - 1];
    return (includeYear !== false) ? (label + ' ' + key[1]) : label;
  }
  let d = null;
  if (dateInput instanceof Date) {
    d = dateInput;
  } else {
    try {
      d = new Date(dateInput);
    } catch (e) {
      return String(dateInput);
    }
  }
  if (isNaN(d.getTime())) return String(dateInput);

  let day, monthNum, yr;
  try {
    const parts = Utilities.formatDate(d, ceraTimeZone(), 'dd|M|yyyy').split('|');
    day = parts[0]; monthNum = Number(parts[1]); yr = parts[2];
  } catch (e) {
    day = ('0' + d.getDate()).slice(-2); monthNum = d.getMonth() + 1; yr = d.getFullYear();
  }
  const localized = local ? ceraLocaleDate_(yr, monthNum, day, includeYear, lang) : null;
  if (localized) return localized;
  const mon = months[monthNum - 1];
  return (includeYear !== false) ? (day + ' ' + mon + ' ' + yr) : (day + ' ' + mon);
}

/**
 * Resolves column index mappings flexibly across diverse Google Admin export formats
 */
function resolveColumnIndices(headers) {
  const normHeaders = (headers || []).map(h =>
    typeof ceraCanonConsoleHeader_ === 'function'
      ? ceraCanonConsoleHeader_(h)
      : String(h === null || h === undefined ? '' : h).normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
  );
  const col = {};

  const findExact = (aliases) => {
    for (let alias of aliases) {
      const idx = normHeaders.findIndex(h => h === alias);
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const findIdx = (aliases, exactOnlyAliases) => {
    // 1. Exact match pass (highest priority, in alias priority order)
    const exact = findExact(aliases);
    if (exact !== -1) return exact;
    if (exactOnlyAliases && exactOnlyAliases.length) {
      const exactFallback = findExact(exactOnlyAliases);
      if (exactFallback !== -1) return exactFallback;
    }
    // 2. Substring pass for aliases > 3 chars (prevents short tokens like 'ou' falsely matching 'source')
    for (let alias of aliases) {
      if (alias.length <= 3) continue;
      const idx = normHeaders.findIndex(h => h.includes(alias));
      if (idx !== -1) return idx;
    }
    // 3. Word token pass for short aliases (e.g. 'ou', 'org') on word boundaries
    for (let alias of aliases) {
      if (alias.length <= 3) {
        const idx = normHeaders.findIndex(h => h.split(/[\s_\-\/]+/).includes(alias));
        if (idx !== -1) return idx;
      }
    }
    return -1;
  };

  // Event & Action Directionality
  col.triggerType = findIdx(['trigger type', 'triggertype', 'action type', 'actiontype'], ['trigger']);
  col.event = findExact(['event', 'event name', 'event_name', 'eventname', 'action', 'type', 'activity']);
  col.eventReason = findIdx(['event reason', 'eventreason', 'policy action', 'chrome.event_reason'], ['reason']);
  col.eventResult = findIdx(['event result', 'eventresult', 'action taken', 'actiontaken', 'enforcement'], ['result', 'status']);

  // Organizational Unit (Supports US "Organizational unit", UK "Organisational unit", and Admin SDK headers)
  col.ou = findIdx([
    'organizational unit name',
    'organisational unit name',
    'organizational unit',
    'organisational unit',
    'org unit name',
    'org unit',
    'organizationalunitname',
    'organisationalunitname',
    'organizationalunit',
    'organisationalunit',
    'orgunitname',
    'orgunit',
    'orgunitpath',
    'org_unit_name',
    'ou name',
    'ou',
    'department'
  ]);
  col.orgUnit = col.ou;

  // File & Content Metrics
  col.contentSize = findIdx(['content size', 'contentsize', 'bytes', 'file size', 'filesize', 'transferredbytes'], ['size']);
  col.contentType = findIdx(['content type', 'contenttype', 'mime type', 'mimetype', 'filetype']);
  col.contentName = findIdx(['content name', 'contentname', 'file name', 'filename', 'document name', 'documentname', 'object name'], ['title']);

  // Network & Endpoints (strict exact matching so 'URL risk level', 'URL category', 'Iframe URL category' or 'Tab URL' never masquerade as 'URL')
  col.url = findExact(['url', 'request url', 'page url', 'target url', 'targeturl', 'destination url', 'destinationurl', 'domain']);
  col.tabUrl = findExact(['tab url', 'taburl', 'tab_url', 'referring url', 'source url', 'sourceurl', 'origin url']);
  col.urlCategory = findExact(['url category', 'urlcategory', 'destination category', 'site category', 'category']);
  col.destination = findExact(['destination', 'printer name', 'printername', 'printer', 'destination printer']);
  col.printerName = col.destination;

  // Identity & Accounts
  col.account = findExact(['web app account', 'web app signed-in account', 'signed-in account', 'webappaccount', 'targetaccount', 'consumeraccount', 'account']);
  col.webAppAccount = col.account;
  col.profileUser = findIdx(['user profile', 'profile user name', 'profile user', 'profileuser', 'trigger user', 'triggeruser', 'user email', 'useremail', 'username'], ['user', 'actor', 'email']);
  col.userAlt = findExact(['user', 'user email', 'useremail', 'email', 'actor', 'trigger user', 'triggeruser']);
  col.resource = findExact(['resource', 'resources']);
  col.userName = col.profileUser;

  // Timestamps
  col.date = findIdx(['date', 'timestamp', 'event time', 'eventtime', 'datetime'], ['time']);
  col.timestamp = col.date;

  // DLP Detectors & Policies
  col.detectorName = findIdx([
    'detector name',
    'detectorname',
    'detectors',
    'sensitive detector',
    'detector id',
    'detectorid',
    'detector category',
    'detectorcategory',
    'matched detectors',
    'matched_detectors',
    'triggered rule name',
    'triggered rules',
    'triggered rule ids',
    'triggered rule id',
    'dlp rule',
    'chrome.matched_detectors.detector_name',
    'chrome.matched_detectors'
  ], ['policy', 'rule']);
  col.detectorCategory = col.detectorName;

  // Browser launches (BrowserLaunches.gs): the device and the device user, matched on the whole header so that "Device
  // user" is never taken for the device, and the command-line switches ("Command Line Switches" in partitions,
  // "Command line flags" in Admin Console exports)
  const findRe = re => normHeaders.findIndex(h => re.test(h));
  col.deviceName = findRe(/^(device[\s_-]*name|device|device[\s_-]*fqdn|machine[\s_-]*name|host[\s_-]*name)$/);
  col.deviceUser = findRe(/^device[\s_-]*user(name)?$/);
  col.switches = findRe(/command[\s_-]*line|switch/);

  return col;
}

/**
 * Outcome of a Chrome event as reported in its Event Result column, as one upper-case code: ALLOWED, BLOCKED,
 * BYPASSED, CANCELLED_BY_USER, DATA_MASKED, DATA_UNMASKED, DETECTED, REPORTED, WARNED, or any other value Chrome
 * writes (an 'other' outcome, ceraOutcomeClass_). '' when the column is missing or blank, or reads UNSPECIFIED.
 * Admin SDK partitions write EVENT_RESULT_BLOCKED, manual exports write Blocked or "Cancelled by user"; case,
 * spaces and the US spelling CANCELED are ignored.
 */
var _ceraEventResultCache_ = Object.create(null);
function normalizeEventResult(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') {
    const hit = _ceraEventResultCache_[value];
    if (hit !== undefined) return hit;
  }
  const canon = typeof ceraCanonConsoleResult_ === 'function' ? ceraCanonConsoleResult_(value) : value;
  const s = String(canon).trim().toUpperCase().replace(/^EVENT_RESULT_/, '').replace(/[\s-]+/g, '_').replace(/^CANCELED/, 'CANCELLED');
  const res = !s || /^(UNSPECIFIED|UNKNOWN|NONE|NULL|UNDEFINED|_+)$/.test(s) ? '' : s;
  if (typeof value === 'string' && value.length <= 80) _ceraEventResultCache_[value] = res;
  return res;
}

/**
 * Outcome class of one normalized Event Result (CeraConfig.EVENT_RESULT_CLASSES): blocked, cancelled, bypassed, warned,
 * unmasked, masked or detected; notReported for no result; other for a value of none of the classes.
 */
function ceraOutcomeClass_(result) {
  if (!result) return 'notReported';
  const classes = CeraConfig.EVENT_RESULT_CLASSES || {};
  const keys = Object.keys(classes);
  for (let i = 0; i < keys.length; i++) {
    if (classes[keys[i]].indexOf(result) !== -1) return keys[i];
  }
  return 'other';
}

/**
 * One outcome for the results of an action's rows: the class that comes first in CeraConfig.OUTCOME_PRECEDENCE, so a
 * warned action with a bypass logged is bypassed and a blocked one stays blocked whatever else its rows report.
 */
function ceraActionOutcome_(results) {
  const order = CeraConfig.OUTCOME_PRECEDENCE;
  let best = 'notReported';
  (results || []).forEach(r => {
    const c = ceraOutcomeClass_(r);
    if (order.indexOf(c) < order.indexOf(best)) best = c;
  });
  return best;
}

/** True when an outcome kept the data from leaving (CeraConfig.OUTCOME_STOPPED). */
function ceraOutcomeStopped_(outcome) {
  return CeraConfig.OUTCOME_STOPPED.indexOf(outcome) !== -1;
}

/**
 * Transforms simple frequency map to sorted array with limit
 */
function mapToSortedArray(map, limit, sortByCount) {
  const arr = Object.values(map || {}).map(item => ({
    name: item.name,
    count: item.count || 0,
    bytes: item.bytes || 0,
    volumeGb: item.bytes ? (item.bytes / (1024 ** 3)) : 0
  }));
  if (sortByCount) {
    arr.sort((a, b) => (b.count || 0) - (a.count || 0) || (b.volumeGb || 0) - (a.volumeGb || 0));
  } else {
    arr.sort((a, b) => (b.volumeGb || 0) - (a.volumeGb || 0) || (b.count || 0) - (a.count || 0));
  }
  return limit ? arr.slice(0, limit) : arr;
}

function subMapToStackedArray(map, limit) {
  const arr = Object.values(map || {}).map(k => ({
    name: k.name,
    count: k.count || 0,
    totalBytes: k.totalBytes || 0,
    bytes: k.totalBytes || 0,
    volumeGb: (k.totalBytes || 0) / (1024 ** 3),
    uploadGb: (k.uploadBytes || 0) / (1024 ** 3),
    downloadGb: (k.downloadBytes || 0) / (1024 ** 3),
    printGb: (k.printBytes || 0) / (1024 ** 3)
  }));
  arr.sort((a, b) => b.volumeGb - a.volumeGb || b.count - a.count);
  return limit ? arr.slice(0, limit) : arr;
}

function countMapToArray(map, limit) {
  if (!map) return [];
  const arr = Object.keys(map).map(k => {
    const val = map[k];
    const count = (typeof val === 'object' && val !== null)
      ? (Number(val.total || val.count || val.events || val.bytes) || 0)
      : (Number(val) || 0);
    return {
      name: k,
      count: count
    };
  });
  arr.sort((a, b) => b.count - a.count);
  return limit ? arr.slice(0, limit) : arr;
}

/**
 * Sensitive share of a sensitivity tally: { sensPct, nonSensPct, sensitiveCount }. Its detectors are named by
 * ceraDetectorListText, like everywhere in the deck and the workbook.
 */
function formatSensitivityInfo(sens) {
  if (!sens) {
    return {
      sensPct: '0.0%',
      nonSensPct: '100.0%',
      sensitiveCount: 0
    };
  }
  const sensitiveCount = Number(sens.sensitiveCount) || 0;
  const nonSensitiveCount = Number(sens.nonSensitiveCount) || 0;
  const total = (sens.totalCount !== undefined && sens.totalCount !== null)
    ? Number(sens.totalCount)
    : (sensitiveCount + nonSensitiveCount);

  if (total === 0) {
    return {
      sensPct: '0.0%',
      nonSensPct: '100.0%',
      sensitiveCount: 0
    };
  }

  const sPctNum = (sensitiveCount / total) * 100;
  return {
    sensPct: sPctNum.toFixed(1) + '%',
    nonSensPct: (100 - sPctNum).toFixed(1) + '%',
    sensitiveCount: sensitiveCount
  };
}

/**
 * ==============================================================================
 * CHROME ENTERPRISE URL CATEGORY NORMALIZER (OFFICIAL GOOGLE WORKSPACE HELP SPEC)
 * Grounded in /admin/reports/chrome-log-events URL category taxonomy
 * Handles chrome.localized_url_category, API representations & manual CSV exports
 * ==============================================================================
 */
var URL_CATEGORY_API_MAP = {
  // Adult
  'ADULT': 'Adult',

  // Arts & Entertainment
  'ARTS_AND_ENTERTAINMENT': 'Arts & Entertainment',
  'ARTS_AND_ENTERTAINMENT__CELEBRITIES_AND_ENTERTAINMENT_NEWS': 'Celebrities & Entertainment News',
  'ARTS_AND_ENTERTAINMENT__COMICS_AND_ANIMATION': 'Comics & Animation',
  'ARTS_AND_ENTERTAINMENT__ENTERTAINMENT_INDUSTRY': 'Entertainment Industry',
  'ARTS_AND_ENTERTAINMENT__EVENTS_AND_LISTINGS': 'Events & Listings',
  'ARTS_AND_ENTERTAINMENT__FUN_AND_TRIVIA': 'Fun & Trivia',
  'ARTS_AND_ENTERTAINMENT__HUMOR': 'Humor',
  'ARTS_AND_ENTERTAINMENT__MOVIES': 'Movies',
  'ARTS_AND_ENTERTAINMENT__MUSIC_AND_AUDIO': 'Music & Audio',
  'ARTS_AND_ENTERTAINMENT__OFFBEAT': 'Offbeat',
  'ARTS_AND_ENTERTAINMENT__ONLINE_MEDIA': 'Online Media',
  'ARTS_AND_ENTERTAINMENT__PERFORMING_ARTS': 'Performing Arts',
  'ARTS_AND_ENTERTAINMENT__TV_AND_VIDEO': 'TV & Video',
  'ARTS_AND_ENTERTAINMENT__VISUAL_ART_AND_DESIGN': 'Visual Art & Design',

  // Autos & Vehicles
  'AUTOS_AND_VEHICLES': 'Autos & Vehicles',
  'AUTOS_AND_VEHICLES__BICYCLES_AND_ACCESSORIES': 'Bicycles & Accessories',
  'AUTOS_AND_VEHICLES__BOATS_AND_WATERCRAFT': 'Boats & Watercraft',
  'AUTOS_AND_VEHICLES__CAMPERS_AND_RVS': 'Campers & RVs',
  'AUTOS_AND_VEHICLES__CLASSIC_VEHICLES': 'Classic Vehicles',
  'AUTOS_AND_VEHICLES__COMMERCIAL_VEHICLES': 'Commercial Vehicles',
  'AUTOS_AND_VEHICLES__CUSTOM_AND_PERFORMANCE_VEHICLES': 'Custom & Performance Vehicles',
  'AUTOS_AND_VEHICLES__MOTOR_VEHICLES': 'Motor Vehicles',
  'AUTOS_AND_VEHICLES__PERSONAL_AIRCRAFT': 'Personal Aircraft',
  'AUTOS_AND_VEHICLES__VEHICLE_CODES_AND_DRIVING_LAWS': 'Vehicle Codes & Driving Laws',
  'AUTOS_AND_VEHICLES__VEHICLE_PARTS_AND_SERVICES': 'Vehicle Parts & Services',
  'AUTOS_AND_VEHICLES__VEHICLE_SHOPPING': 'Vehicle Shopping',
  'AUTOS_AND_VEHICLES__VEHICLE_SHOWS': 'Vehicle Shows',

  // Beauty & Fitness
  'BEAUTY_AND_FITNESS': 'Beauty & Fitness',
  'BEAUTY_AND_FITNESS__BEAUTY_PAGEANTS': 'Beauty Pageants',
  'BEAUTY_AND_FITNESS__BEAUTY_SERVICES_AND_SPAS': 'Beauty Services & Spas',
  'BEAUTY_AND_FITNESS__BODY_ART': 'Body Art',
  'BEAUTY_AND_FITNESS__COSMETOLOGY_AND_BEAUTY_PROFESSIONALS': 'Cosmetology & Beauty Professionals',
  'BEAUTY_AND_FITNESS__FACE_AND_BODY_CARE': 'Face & Body Care',
  'BEAUTY_AND_FITNESS__FASHION_AND_STYLE': 'Fashion & Style',
  'BEAUTY_AND_FITNESS__FITNESS': 'Fitness',
  'BEAUTY_AND_FITNESS__HAIR_CARE': 'Hair Care',
  'BEAUTY_AND_FITNESS__WEIGHT_LOSS': 'Weight Loss',

  // Books & Literature
  'BOOKS_AND_LITERATURE': 'Books & Literature',
  'BOOKS_AND_LITERATURE__AUDIOBOOKS': 'Audiobooks',
  'BOOKS_AND_LITERATURE__BOOK_RETAILERS': 'Book Retailers',
  'BOOKS_AND_LITERATURE__CHILDRENS_LITERATURE': 'Children\'s Literature',
  'BOOKS_AND_LITERATURE__E_BOOKS': 'E-Books',
  'BOOKS_AND_LITERATURE__FAN_FICTION': 'Fan Fiction',
  'BOOKS_AND_LITERATURE__LITERARY_CLASSICS': 'Literary Classics',
  'BOOKS_AND_LITERATURE__MAGAZINES': 'Magazines',
  'BOOKS_AND_LITERATURE__POETRY': 'Poetry',
  'BOOKS_AND_LITERATURE__WRITERS_RESOURCES': 'Writers Resources',

  // Business & Industrial
  'BUSINESS_AND_INDUSTRIAL': 'Business & Industrial',
  'BUSINESS_AND_INDUSTRIAL__ADVERTISING_AND_MARKETING': 'Advertising & Marketing',
  'BUSINESS_AND_INDUSTRIAL__AEROSPACE_AND_DEFENSE': 'Aerospace & Defense',
  'BUSINESS_AND_INDUSTRIAL__AGRICULTURE_AND_FORESTRY': 'Agriculture & Forestry',
  'BUSINESS_AND_INDUSTRIAL__AUTOMOTIVE_INDUSTRY': 'Automotive Industry',
  'BUSINESS_AND_INDUSTRIAL__BUSINESS_EDUCATION': 'Business Education',
  'BUSINESS_AND_INDUSTRIAL__BUSINESS_FINANCE': 'Business Finance',
  'BUSINESS_AND_INDUSTRIAL__BUSINESS_OPERATIONS': 'Business Operations',
  'BUSINESS_AND_INDUSTRIAL__BUSINESS_SERVICES': 'Business Services',
  'BUSINESS_AND_INDUSTRIAL__CHEMICALS_INDUSTRY': 'Chemicals Industry',
  'BUSINESS_AND_INDUSTRIAL__CONSTRUCTION_AND_MAINTENANCE': 'Construction & Maintenance',
  'BUSINESS_AND_INDUSTRIAL__ENERGY_AND_UTILITIES': 'Energy & Utilities',
  'BUSINESS_AND_INDUSTRIAL__HOSPITALITY_INDUSTRY': 'Hospitality Industry',
  'BUSINESS_AND_INDUSTRIAL__INDUSTRIAL_MATERIALS_AND_EQUIPMENT': 'Industrial Materials & Equipment',
  'BUSINESS_AND_INDUSTRIAL__MANUFACTURING': 'Manufacturing',
  'BUSINESS_AND_INDUSTRIAL__METALS_AND_MINING': 'Metals & Mining',
  'BUSINESS_AND_INDUSTRIAL__PHARMACEUTICALS_AND_BIOTECH': 'Pharmaceuticals & Biotech',
  'BUSINESS_AND_INDUSTRIAL__PRINTING_AND_PUBLISHING': 'Printing & Publishing',
  'BUSINESS_AND_INDUSTRIAL__PROFESSIONAL_AND_TRADE_ASSOCIATIONS': 'Professional & Trade Associations',
  'BUSINESS_AND_INDUSTRIAL__RETAIL_TRADE': 'Retail Trade',
  'BUSINESS_AND_INDUSTRIAL__SHIPPING_AND_LOGISTICS': 'Shipping & Logistics',
  'BUSINESS_AND_INDUSTRIAL__SMALL_BUSINESS': 'Small Business',
  'BUSINESS_AND_INDUSTRIAL__TEXTILES_AND_NONWOVENS': 'Textiles & Nonwovens',

  // Finance
  'FINANCE': 'Finance',
  'FINANCE__ACCOUNTING_AND_AUDITING': 'Accounting & Auditing',
  'FINANCE__BANKING': 'Banking',
  'FINANCE__CREDIT_AND_LENDING': 'Credit & Lending',
  'FINANCE__CROWDFUNDING': 'Crowdfunding',
  'FINANCE__DIGITAL_CURRENCIES': 'Digital Currencies',
  'FINANCE__FINANCIAL_PLANNING_AND_MANAGEMENT': 'Financial Planning & Management',
  'FINANCE__GRANTS_SCHOLARSHIPS_AND_FINANCIAL_AID': 'Grants, Scholarships & Financial Aid',
  'FINANCE__INSURANCE': 'Insurance',
  'FINANCE__INVESTING': 'Investing',

  // Food & Drink
  'FOOD_AND_DRINK': 'Food & Drink',
  'FOOD_AND_DRINK__ALCOHOLIC_BEVERAGES': 'Alcoholic Beverages',
  'FOOD_AND_DRINK__BEVERAGES': 'Beverages',
  'FOOD_AND_DRINK__COOKING_AND_RECIPES': 'Cooking & Recipes',
  'FOOD_AND_DRINK__FOOD': 'Food',
  'FOOD_AND_DRINK__FOOD_AND_GROCERY_DELIVERY': 'Food & Grocery Delivery',
  'FOOD_AND_DRINK__FOOD_AND_GROCERY_RETAILERS': 'Food & Grocery Retailers',
  'FOOD_AND_DRINK__RESTAURANTS': 'Restaurants',

  // Games
  'GAMES': 'Games',
  'GAMES__ARCADE_AND_COIN_OP_GAMES': 'Arcade & Coin-Op Games',
  'GAMES__BOARD_GAMES': 'Board Games',
  'GAMES__CARD_GAMES': 'Card Games',
  'GAMES__COMPUTER_AND_VIDEO_GAMES': 'Computer & Video Games',
  'GAMES__DICE_GAMES': 'Dice Games',
  'GAMES__EDUCATIONAL_GAMES': 'Educational Games',
  'GAMES__FAMILY_ORIENTED_GAMES_AND_ACTIVITIES': 'Family-Oriented Games & Activities',
  'GAMES__GAMBLING': 'Gambling',
  'GAMES__PARTY_GAMES': 'Party Games',
  'GAMES__PUZZLES_AND_BRAINTEASERS': 'Puzzles & Brainteasers',
  'GAMES__ROLEPLAYING_GAMES': 'Roleplaying Games',
  'GAMES__TABLE_GAMES': 'Table Games',
  'GAMES__TILE_GAMES': 'Tile Games',
  'GAMES__WORD_GAMES': 'Word Games',

  // Health
  'HEALTH': 'Health',
  'HEALTH__AGING_AND_GERIATRICS': 'Aging & Geriatrics',
  'HEALTH__ALTERNATIVE_AND_NATURAL_MEDICINE': 'Alternative & Natural Medicine',
  'HEALTH__HEALTH_CONDITIONS': 'Health Conditions',
  'HEALTH__HEALTH_EDUCATION_AND_MEDICAL_TRAINING': 'Health Education & Medical Training',
  'HEALTH__HEALTH_FOUNDATIONS_AND_MEDICAL_RESEARCH': 'Health Foundations & Medical Research',
  'HEALTH__MEDICAL_DEVICES_AND_EQUIPMENT': 'Medical Devices & Equipment',
  'HEALTH__MEDICAL_FACILITIES_AND_SERVICES': 'Medical Facilities & Services',
  'HEALTH__MEDICAL_LITERATURE_AND_RESOURCES': 'Medical Literature & Resources',
  'HEALTH__MENS_HEALTH': 'Men\'s Health',
  'HEALTH__MENTAL_HEALTH': 'Mental Health',
  'HEALTH__NURSING': 'Nursing',
  'HEALTH__NUTRITION': 'Nutrition',
  'HEALTH__ORAL_AND_DENTAL_CARE': 'Oral & Dental Care',
  'HEALTH__PEDIATRICS': 'Pediatrics',
  'HEALTH__PHARMACY': 'Pharmacy',
  'HEALTH__PUBLIC_HEALTH': 'Public Health',
  'HEALTH__REPRODUCTIVE_HEALTH': 'Reproductive Health',
  'HEALTH__SUBSTANCE_ABUSE': 'Substance Abuse',
  'HEALTH__VISION_CARE': 'Vision Care',
  'HEALTH__WOMENS_HEALTH': 'Women\'s Health',

  // Hobbies & Leisure
  'HOBBIES_AND_LEISURE': 'Hobbies & Leisure',
  'HOBBIES_AND_LEISURE__CLUBS_AND_ORGANIZATIONS': 'Clubs & Organizations',
  'HOBBIES_AND_LEISURE__CRAFTS': 'Crafts',
  'HOBBIES_AND_LEISURE__MERIT_PRIZES_AND_CONTESTS': 'Merit Prizes & Contests',
  'HOBBIES_AND_LEISURE__OUTDOORS': 'Outdoors',
  'HOBBIES_AND_LEISURE__PAINTBALL': 'Paintball',
  'HOBBIES_AND_LEISURE__RADIO_CONTROL_AND_MODELING': 'Radio Control & Modeling',
  'HOBBIES_AND_LEISURE__RECREATIONAL_AVIATION': 'Recreational Aviation',
  'HOBBIES_AND_LEISURE__SPECIAL_OCCASIONS': 'Special Occasions',
  'HOBBIES_AND_LEISURE__SWEEPSTAKES_AND_PROMOTIONAL_GIVEAWAYS': 'Sweepstakes & Promotional Giveaways',
  'HOBBIES_AND_LEISURE__WATER_ACTIVITIES': 'Water Activities',

  // Home & Garden
  'HOME_AND_GARDEN': 'Home & Garden',
  'HOME_AND_GARDEN__BED_AND_BATH': 'Bed & Bath',
  'HOME_AND_GARDEN__DOMESTIC_SERVICES': 'Domestic Services',
  'HOME_AND_GARDEN__HOME_AND_INTERIOR_DECOR': 'Home & Interior Decor',
  'HOME_AND_GARDEN__HOME_APPLIANCES': 'Home Appliances',
  'HOME_AND_GARDEN__HOME_FURNISHINGS': 'Home Furnishings',
  'HOME_AND_GARDEN__HOME_IMPROVEMENT': 'Home Improvement',
  'HOME_AND_GARDEN__HOME_SAFETY_AND_SECURITY': 'Home Safety & Security',
  'HOME_AND_GARDEN__HOME_STORAGE_AND_SHELVING': 'Home Storage & Shelving',
  'HOME_AND_GARDEN__HOME_SWIMMING_POOLS_SAUNAS_AND_SPAS': 'Swimming Pools, Saunas & Spas',
  'HOME_AND_GARDEN__HOUSEHOLD_SUPPLIES': 'Household Supplies',
  'HOME_AND_GARDEN__HVAC_AND_CLIMATE_CONTROL': 'HVAC & Climate Control',
  'HOME_AND_GARDEN__KITCHEN_AND_DINING': 'Kitchen & Dining',
  'HOME_AND_GARDEN__LAUNDRY': 'Laundry',
  'HOME_AND_GARDEN__PATIO_LAWN_AND_GARDEN': 'Patio, Lawn & Garden',
  'HOME_AND_GARDEN__PEST_CONTROL': 'Pest Control',

  // Internet & Technology
  'INTERNET_AND_TECHNOLOGY': 'Internet & Technology',
  'INTERNET_AND_TECHNOLOGY__AFFILIATE_PROGRAMS': 'Affiliate Programs',
  'INTERNET_AND_TECHNOLOGY__BUSINESS_AND_PRODUCTIVITY_SOFTWARE': 'Business & Productivity Software',
  'INTERNET_AND_TECHNOLOGY__CLOUD_STORAGE': 'Cloud Storage',
  'INTERNET_AND_TECHNOLOGY__COLLABORATION_AND_CONFERENCING_SOFTWARE': 'Collaboration & Conferencing',
  'INTERNET_AND_TECHNOLOGY__COMMUNICATIONS_EQUIPMENT': 'Communications Equipment',
  'INTERNET_AND_TECHNOLOGY__COMPUTER_HARDWARE': 'Computer Hardware',
  'INTERNET_AND_TECHNOLOGY__COMPUTER_SECURITY': 'Computer Security',
  'INTERNET_AND_TECHNOLOGY__CONSUMER_ELECTRONICS': 'Consumer Electronics',
  'INTERNET_AND_TECHNOLOGY__CONTENT_MANAGEMENT': 'Content Management',
  'INTERNET_AND_TECHNOLOGY__EDUCATIONAL_SOFTWARE': 'Educational Software',
  'INTERNET_AND_TECHNOLOGY__ELECTRONIC_SPAM': 'Electronic Spam',
  'INTERNET_AND_TECHNOLOGY__ELECTRONICS_AND_ELECTRICAL': 'Electronics & Electrical',
  'INTERNET_AND_TECHNOLOGY__EMAIL': 'Email',
  'INTERNET_AND_TECHNOLOGY__EMAIL_AND_MESSAGING': 'Email & Messaging',
  'INTERNET_AND_TECHNOLOGY__ENTERPRISE_TECHNOLOGY': 'Enterprise Technology',
  'INTERNET_AND_TECHNOLOGY__FREEWARE_AND_SHAREWARE': 'Freeware & Shareware',
  'INTERNET_AND_TECHNOLOGY__GENERATIVE_AI': 'Generative AI',
  'INTERNET_AND_TECHNOLOGY__HACKING_AND_CRACKING': 'Hacking & Cracking',
  'INTERNET_AND_TECHNOLOGY__MOBILE_AND_WIRELESS': 'Mobile & Wireless',
  'INTERNET_AND_TECHNOLOGY__NETWORKING': 'Networking',
  'INTERNET_AND_TECHNOLOGY__OPEN_SOURCE': 'Open Source',
  'INTERNET_AND_TECHNOLOGY__PROGRAMMING': 'Programming',
  'INTERNET_AND_TECHNOLOGY__PROXYING_AND_FILTERING': 'Proxying & Filtering',
  'INTERNET_AND_TECHNOLOGY__SEARCH_ENGINE_OPTIMIZATION_AND_MARKETING': 'Search Engine Optimization',
  'INTERNET_AND_TECHNOLOGY__SEARCH_ENGINES': 'Search Engines',
  'INTERNET_AND_TECHNOLOGY__SERVICE_PROVIDERS': 'Service Providers',
  'INTERNET_AND_TECHNOLOGY__SOFTWARE': 'Software',
  'INTERNET_AND_TECHNOLOGY__TELECONFERENCING': 'Teleconferencing',
  'INTERNET_AND_TECHNOLOGY__TEXT_AND_INSTANT_MESSAGING': 'Text & Instant Messaging',
  'INTERNET_AND_TECHNOLOGY__VOICE_AND_VIDEO_CHAT': 'Voice & Video Chat',
  'INTERNET_AND_TECHNOLOGY__VPN_AND_REMOTE_ACCESS': 'VPN & Remote Access',
  'INTERNET_AND_TECHNOLOGY__WEB_APPS_AND_ONLINE_TOOLS': 'Web Apps & Online Tools',
  'INTERNET_AND_TECHNOLOGY__WEB_DESIGN_AND_DEVELOPMENT': 'Web Design & Development',
  'INTERNET_AND_TECHNOLOGY__WEB_HOSTING_AND_DOMAIN_REGISTRATION': 'Web Hosting & Domain Registration',
  'INTERNET_AND_TECHNOLOGY__WEB_PORTALS': 'Web Portals',
  'INTERNET_AND_TECHNOLOGY__WEB_STATS_AND_ANALYTICS': 'Web Stats & Analytics',

  // Jobs & Education
  'JOBS_AND_EDUCATION': 'Jobs & Education',
  'JOBS_AND_EDUCATION__EDUCATION': 'Education',
  'JOBS_AND_EDUCATION__INTERNSHIPS': 'Internships',
  'JOBS_AND_EDUCATION__JOBS': 'Jobs',

  // Law & Government
  'LAW_AND_GOVERNMENT': 'Law & Government',
  'LAW_AND_GOVERNMENT__GOVERNMENT': 'Government',
  'LAW_AND_GOVERNMENT__LEGAL': 'Legal',
  'LAW_AND_GOVERNMENT__MILITARY': 'Military',
  'LAW_AND_GOVERNMENT__PUBLIC_SAFETY': 'Public Safety',
  'LAW_AND_GOVERNMENT__SOCIAL_SERVICES': 'Social Services',

  // News
  'NEWS': 'News',
  'NEWS__BROADCAST_AND_NETWORK_NEWS': 'Broadcast & Network News',
  'NEWS__BUSINESS_NEWS': 'Business News',
  'NEWS__GOSSIP_AND_TABLOID_NEWS': 'Gossip & Tabloid News',
  'NEWS__HEALTH_NEWS': 'Health News',
  'NEWS__JOURNALISM_AND_NEWS_INDUSTRY': 'Journalism & News Industry',
  'NEWS__LOCAL_NEWS': 'Local News',
  'NEWS__NEWSPAPERS': 'Newspapers',
  'NEWS__POLITICS': 'Politics',
  'NEWS__SPORTS_NEWS': 'Sports News',
  'NEWS__TECHNOLOGY_NEWS': 'Technology News',
  'NEWS__WEATHER': 'Weather',
  'NEWS__WORLD_NEWS': 'World News',

  // Online Communities
  'ONLINE_COMMUNITIES': 'Online Communities',
  'ONLINE_COMMUNITIES__BLOGGING_RESOURCES_AND_SERVICES': 'Blogging',
  'ONLINE_COMMUNITIES__DATING_AND_PERSONALS': 'Dating & Personals',
  'ONLINE_COMMUNITIES__FEED_AGGREGATION_AND_SOCIAL_BOOKMARKING': 'Social Bookmarking',
  'ONLINE_COMMUNITIES__FILE_SHARING_AND_HOSTING': 'File Sharing & Hosting',
  'ONLINE_COMMUNITIES__FORUM_AND_CHAT_PROVIDERS': 'Forum & Chat Providers',
  'ONLINE_COMMUNITIES__ONLINE_GOODIES': 'Online Goodies',
  'ONLINE_COMMUNITIES__ONLINE_JOURNALS_AND_PERSONAL_SITES': 'Online Journals & Personal Sites',
  'ONLINE_COMMUNITIES__PHOTO_AND_VIDEO_SHARING': 'Photo & Video Sharing',
  'ONLINE_COMMUNITIES__SOCIAL_NETWORKS': 'Social Networks',
  'ONLINE_COMMUNITIES__VIRTUAL_WORLDS': 'Virtual Worlds',

  // People & Society
  'PEOPLE_AND_SOCIETY': 'People & Society',
  'PEOPLE_AND_SOCIETY__DISABLED_AND_SPECIAL_NEEDS': 'Disabled & Special Needs',
  'PEOPLE_AND_SOCIETY__ETHNIC_AND_IDENTITY_GROUPS': 'Ethnic & Identity Groups',
  'PEOPLE_AND_SOCIETY__FAMILY_AND_RELATIONSHIPS': 'Family & Relationships',
  'PEOPLE_AND_SOCIETY__KIDS_AND_TEENS': 'Kids & Teens',
  'PEOPLE_AND_SOCIETY__RELIGION_AND_BELIEF': 'Religion & Belief',
  'PEOPLE_AND_SOCIETY__SELF_HELP_AND_MOTIVATIONAL': 'Self-Help & Motivational',
  'PEOPLE_AND_SOCIETY__SENIORS_AND_RETIREMENT': 'Seniors & Retirement',
  'PEOPLE_AND_SOCIETY__SOCIAL_ISSUES_AND_ADVOCACY': 'Social Issues & Advocacy',
  'PEOPLE_AND_SOCIETY__SOCIAL_SCIENCES': 'Social Sciences',
  'PEOPLE_AND_SOCIETY__SUBCULTURES_AND_NICHE_INTERESTS': 'Subcultures & Niche Interests',

  // Pets & Animals
  'PETS_AND_ANIMALS': 'Pets & Animals',
  'PETS_AND_ANIMALS__ANIMAL_PRODUCTS_AND_SERVICES': 'Animal Products & Services',
  'PETS_AND_ANIMALS__PETS': 'Pets',
  'PETS_AND_ANIMALS__WILDLIFE': 'Wildlife',

  // Real Estate
  'REAL_ESTATE': 'Real Estate',
  'REAL_ESTATE__PROPERTY_DEVELOPMENT': 'Property Development',
  'REAL_ESTATE__REAL_ESTATE_LISTINGS': 'Real Estate Listings',
  'REAL_ESTATE__REAL_ESTATE_SERVICES': 'Real Estate Services',

  // Reference
  'REFERENCE': 'Reference',
  'REFERENCE__DIRECTORIES_AND_LISTINGS': 'Directories & Listings',
  'REFERENCE__GENERAL_REFERENCE': 'General Reference',
  'REFERENCE__GEOGRAPHIC_REFERENCE': 'Geographic Reference',
  'REFERENCE__HUMANITIES': 'Humanities',
  'REFERENCE__LANGUAGE_RESOURCES': 'Language Resources',
  'REFERENCE__LIBRARIES_AND_MUSEUMS': 'Libraries & Museums',
  'REFERENCE__TECHNICAL_REFERENCE': 'Technical Reference',

  // Science
  'SCIENCE': 'Science',
  'SCIENCE__ASTRONOMY': 'Astronomy',
  'SCIENCE__BIOLOGICAL_SCIENCES': 'Biological Sciences',
  'SCIENCE__CHEMISTRY': 'Chemistry',
  'SCIENCE__COMPUTER_SCIENCE': 'Computer Science',
  'SCIENCE__EARTH_SCIENCES': 'Earth Sciences',
  'SCIENCE__ECOLOGY_AND_ENVIRONMENT': 'Ecology & Environment',
  'SCIENCE__ENGINEERING_AND_TECHNOLOGY': 'Engineering & Technology',
  'SCIENCE__MATHEMATICS': 'Mathematics',
  'SCIENCE__PHYSICS': 'Physics',
  'SCIENCE__SCIENTIFIC_EQUIPMENT': 'Scientific Equipment',
  'SCIENCE__SCIENTIFIC_INSTITUTIONS': 'Scientific Institutions',

  // Sensitive Subjects
  'SENSITIVE_SUBJECTS': 'Sensitive Subjects',
  'SENSITIVE_SUBJECTS__ACCIDENTS_AND_DISASTERS': 'Accidents & Disasters',
  'SENSITIVE_SUBJECTS__DEATH_AND_TRAGEDY': 'Death & Tragedy',
  'SENSITIVE_SUBJECTS__FIREARMS_AND_WEAPONS': 'Firearms & Weapons',
  'SENSITIVE_SUBJECTS__MISSING_PERSONS_AND_ABDUCTIONS': 'Missing Persons & Abductions',
  'SENSITIVE_SUBJECTS__RECREATIONAL_DRUGS': 'Recreational Drugs',
  'SENSITIVE_SUBJECTS__SELF_HARM': 'Self-Harm',
  'SENSITIVE_SUBJECTS__VIOLENCE_AND_ABUSE': 'Violence & Abuse',
  'SENSITIVE_SUBJECTS__WAR_AND_CONFLICT': 'War & Conflict',

  // Shopping
  'SHOPPING': 'Shopping',
  'SHOPPING__ANTIQUES_AND_COLLECTIBLES': 'Antiques & Collectibles',
  'SHOPPING__APPAREL': 'Apparel',
  'SHOPPING__AUCTIONS': 'Auctions',
  'SHOPPING__CLASSIFIEDS': 'Classifieds',
  'SHOPPING__CONSUMER_RESOURCES': 'Consumer Resources',
  'SHOPPING__DISCOUNT_AND_OUTLET_STORES': 'Discount & Outlet Stores',
  'SHOPPING__ENTERTAINMENT_MEDIA': 'Entertainment Media',
  'SHOPPING__GIFTS_AND_SPECIAL_EVENT_ITEMS': 'Gifts & Special Event Items',
  'SHOPPING__GREEN_AND_ECO_FRIENDLY_SHOPPING': 'Green & Eco-Friendly Shopping',
  'SHOPPING__LUXURY_GOODS': 'Luxury Goods',
  'SHOPPING__MASS_MERCHANTS_AND_DEPARTMENT_STORES': 'Mass Merchants & Department Stores',
  'SHOPPING__PHOTO_AND_VIDEO_SERVICES': 'Photo & Video Services',
  'SHOPPING__SHOPPING_PORTALS': 'Shopping Portals',
  'SHOPPING__SWAP_MEETS_AND_OUTDOOR_MARKETS': 'Swap Meets & Outdoor Markets',
  'SHOPPING__TOBACCO_AND_VAPING_PRODUCTS': 'Tobacco & Vaping Products',
  'SHOPPING__TOYS': 'Toys',
  'SHOPPING__WHOLESALERS_AND_LIQUIDATORS': 'Wholesalers & Liquidators',

  // Sports
  'SPORTS': 'Sports',
  'SPORTS__ANIMAL_SPORTS': 'Animal Sports',
  'SPORTS__COLLEGE_SPORTS': 'College Sports',
  'SPORTS__COMBAT_SPORTS': 'Combat Sports',
  'SPORTS__EXTREME_SPORTS': 'Extreme Sports',
  'SPORTS__FANTASY_SPORTS': 'Fantasy Sports',
  'SPORTS__INDIVIDUAL_SPORTS': 'Individual Sports',
  'SPORTS__INTERNATIONAL_SPORTS_COMPETITIONS': 'International Sports Competitions',
  'SPORTS__MOTOR_SPORTS': 'Motor Sports',
  'SPORTS__SPORT_SCORES_AND_STATISTICS': 'Sport Scores & Statistics',
  'SPORTS__SPORTING_GOODS': 'Sporting Goods',
  'SPORTS__SPORTS_COACHING_AND_TRAINING': 'Sports Coaching & Training',
  'SPORTS__SPORTS_FAN_GEAR_AND_APPAREL': 'Sports Fan Gear & Apparel',
  'SPORTS__TEAM_SPORTS': 'Team Sports',
  'SPORTS__WATER_SPORTS': 'Water Sports',
  'SPORTS__WINTER_SPORTS': 'Winter Sports',

  // Travel & Transportation
  'TRAVEL_AND_TRANSPORTATION': 'Travel & Transportation',
  'TRAVEL_AND_TRANSPORTATION__HOTELS_AND_ACCOMMODATIONS': 'Hotels & Accommodations',
  'TRAVEL_AND_TRANSPORTATION__LUGGAGE_AND_TRAVEL_ACCESSORIES': 'Luggage & Travel Accessories',
  'TRAVEL_AND_TRANSPORTATION__SPECIALTY_TRAVEL': 'Specialty Travel',
  'TRAVEL_AND_TRANSPORTATION__TOURIST_DESTINATIONS': 'Tourist Destinations',
  'TRAVEL_AND_TRANSPORTATION__TRANSPORTATION': 'Transportation',
  'TRAVEL_AND_TRANSPORTATION__TRAVEL_AGENCIES_AND_SERVICES': 'Travel Agencies & Services',
  'TRAVEL_AND_TRANSPORTATION__TRAVEL_GUIDES_AND_TRAVELOGUES': 'Travel Guides & Travelogues'
};

/**
 * Dynamically normalizes any URL category input (API code, slash-delimited path, or plain text)
 * Supports direct Google Admin Reports API extraction as well as manual CSV exports.
 */
var _ceraUrlCategoryCache_ = Object.create(null);
function normalizeUrlCategory(input) {
  if (!input) return 'Uncategorized';
  if (typeof input === 'string') {
    const hit = _ceraUrlCategoryCache_[input];
    if (hit !== undefined) return hit;
  }
  let str = input.toString().trim();
  if (typeof ceraCanonConsoleCategory_ === 'function') {
    str = ceraCanonConsoleCategory_(str);
  }
  let res = '';
  if (!str || str.toLowerCase() === 'unspecified' || str.toLowerCase() === 'none' || str.toLowerCase() === 'uncategorized') {
    res = 'Uncategorized';
  } else {
    // 1. Direct API code match (e.g. "INTERNET_AND_TECHNOLOGY__GENERATIVE_AI")
    const upper = str.toUpperCase().replace(/\s+/g, '_');
    if (URL_CATEGORY_API_MAP[upper]) {
      res = URL_CATEGORY_API_MAP[upper];
    } else if (str.startsWith('/')) {
      // 2. Slash-delimited path (e.g. "/Internet & Technology/Generative AI")
      const parts = str.split('/').map(p => p.trim()).filter(Boolean);
      if (parts.length > 0) {
        res = parts[parts.length - 1]; // Return leaf category (e.g. "Generative AI")
      }
    } else if (str.includes('__')) {
      // 3. Fallback for subcategory double-underscore syntax (e.g. "CUSTOM_CATEGORY__AI_TOOLS")
      const segments = str.split('__');
      const leaf = segments[segments.length - 1];
      res = leaf
        .toLowerCase()
        .split('_')
        .map(w => (w === 'and' ? '&' : w.charAt(0).toUpperCase() + w.slice(1)))
        .join(' ');
    }
    if (!res) res = str;
  }
  if (typeof input === 'string' && input.length <= 120) _ceraUrlCategoryCache_[input] = res;
  return res;
}
