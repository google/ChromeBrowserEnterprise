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
 * Module: Config.gs
 * Description: Global configuration, design tokens, palettes & threshold constants
 * ==============================================================================
 */

var CeraConfig = {
  VERSION: '2.0.10',
  SUITE_NAME: 'Chrome Egress Risk Analysis (CERA)',
  SHORT_NAME: 'CERA v2.0.10',
  FEEDBACK_URL: 'https://goo.gle/cera-feedback',
  DIAG_LOG_FOLDER_NAME: 'logs',
  DIAG_LOG_FILE_NAME: 'cera-diagnostic-log.txt',
  DIAG_LOG_MAX_BYTES: 1000000,
  DEFAULT_TIMEZONE: 'Etc/UTC',

  // Multi-batch analysis execution budgets (executeDlpAnalysis in IngestionPipeline.gs):
  // When running from the setup dialog (allowContinuation: true), each batch reads partitions up to
  // ANALYSIS_BATCH_BUDGET_MS (3 minutes) and checkpoints to CacheService so the next google.script.run
  // call continues seamlessly with a fresh 6-minute Apps Script limit. If reading the final partition took
  // longer than ANALYSIS_RENDER_HANDOFF_MS, deck and workbook rendering run in a dedicated final call.
  ANALYSIS_BATCH_BUDGET_MS: 180000,
  ANALYSIS_RENDER_HANDOFF_MS: 140000,

  // Destination label for rows whose URL/host is empty, "null" or "undefined"
  UNKNOWN_DESTINATION: 'Unknown destination',
  // Local working hours used for the after-hours share of outbound transfers (start inclusive, end exclusive)
  WORK_HOURS: { start: 8, end: 19 },
  // Slides per data-transfer vector by outbound volume: 2 slides at >= fullEvents transfers by >= fullUsers
  // people, 1 slide at >= compactEvents, otherwise only its row on the threat matrix
  VECTOR_GATE: { fullEvents: 50, fullUsers: 3, compactEvents: 10 },
  // Consumer email providers: a web app account on these is a personal account. Accounts on any other
  // non-corporate domain belong to another organization unless the customer lists it as a partner.
  CONSUMER_EMAIL_DOMAINS: ['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.id', 'yahoo.co.jp', 'outlook.com',
    'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com',
    'gmx.com', 'yandex.com', 'mail.com', 'qq.com', '163.com', '126.com', 'naver.com', 'daum.net'],

  // Outbound (egress) actions: data leaving the browser toward a destination.
  // upload = FILE_UPLOAD and WEB_CONTENT_UPLOAD (paste into a page), paste = paste events, print = PAGE_PRINT.
  // Downloads are inbound, and CLIPBOARD_COPY (copied from a page) is counted apart: neither is egress.
  // Rows of one user action are assembled first (ACTION_* below, ActionAssembler.gs).
  EGRESS_ACTIONS: ['upload', 'paste', 'print'],

  // Design Tokens: Modern Executive MD3 Palette (High Contrast & Zero Overlap)
  PALETTE: {
    navy: '#0F172A',         // Slate 900
    surface: '#F8FAFC',      // Slate 50
    cardBg: '#FFFFFF',       // Pure White
    border: '#E2E8F0',       // Slate 200
    borderLight: '#F1F5F9',  // Slate 100
    textMain: '#0F172A',     // Slate 900
    textMuted: '#64748B',    // Slate 500
    textSubtle: '#94A3B8',   // Slate 400

    // Semantic Threat Vector Accents
    rose: '#DC2626',         // Red 600 (Upload / High Risk / Personal)
    roseLight: '#FEF2F2',    // Red 50
    roseBorder: '#FECACA',   // Red 200

    blue: '#0284C7',         // Sky 600 (Download / Shadow AI)
    blueLight: '#F0F9FF',    // Sky 50
    blueBorder: '#BAE6FD',   // Sky 200

    amber: '#D97706',        // Amber 600 (Print / Unmanaged / Alert)
    amberLight: '#FFFBEB',   // Amber 50
    amberBorder: '#FDE68A',  // Amber 200

    purple: '#7C3AED',       // Violet 600 (Messaging / Special Channels)
    purpleLight: '#F5F3FF',  // Violet 50
    purpleBorder: '#DDD6FE', // Violet 200

    green: '#16A34A',        // Green 600 (Sanctioned / Success)
    greenLight: '#F0FDF4',   // Green 50
    greenBorder: '#BBF7D0',  // Green 200

    slate: '#475569',        // Slate 600
    slateLight: '#F8FAFC',
    slateBorder: '#CBD5E1'
  },

  // Standard Fonts (Google Slides Built-in)
  FONTS: {
    HEADING: 'Outfit',
    BODY: 'Outfit',
    MONO: 'Consolas'
  },

  // Default Domain Registries
  DEFAULT_DOMAINS: {
    AUTHORIZED_GENAI: [
      'gemini.google.com',
      'bard.google.com',
      'aistudio.google.com',
      'vertexai.google.com',
      'notebooklm.google.com'
    ],
    SANCTIONED_PRODUCTIVITY: [
      'All Registered Domains',
      'drive.google.com',
      'docs.google.com',
      'sheets.google.com',
      'slides.google.com',
      'workspace.google.com',
      'mail.google.com',
      'gmail.com'
    ],
    WEB_MESSAGING: [
      'web.whatsapp.com',
      'whatsapp.com',
      'web.telegram.org',
      'telegram.org',
      'discord.com',
      'messenger.com',
      'web.facebook.com',
      'teams.microsoft.com',
      'slack.com'
    ],
    SHADOW_AI_KNOWN: [
      'chatgpt.com',
      'openai.com',
      'claude.ai',
      'anthropic.com',
      'deepseek.com',
      'perplexity.ai',
      'poe.com',
      'cohere.com',
      'mistral.ai',
      'replicate.com',
      'jasper.ai',
      'copy.ai'
    ],
    // Single source of truth for GenAI tool detection. A host is GenAI when it equals an entry
    // or ends with "." + entry (registrable-domain suffix). Never add bare search portals here
    // (google.com, bing.com): see GENAI_NEVER.
    GENAI_TOOLS: [
      'chatgpt.com',
      'openai.com',
      'oaiusercontent.com',
      'claude.ai',
      'anthropic.com',
      'deepseek.com',
      'perplexity.ai',
      'gemini.google.com',
      'bard.google.com',
      'aistudio.google.com',
      'ai.studio',
      'notebooklm.google.com',
      'vertexai.google.com',
      'copilot.microsoft.com',
      'copilot.cloud.microsoft',
      'poe.com',
      'cohere.com',
      'mistral.ai',
      'replicate.com',
      'jasper.ai',
      'copy.ai',
      'character.ai',
      'grok.com',
      'meta.ai',
      'you.com'
    ],
    // Hosts that must never be classified as GenAI, whatever the URL category column says.
    GENAI_NEVER: ['google.com', 'www.google.com', 'bing.com', 'www.bing.com'],
    // Canonical destination names for GenAI hosts that are the same product.
    GENAI_CANONICAL: {
      'openai.com': 'chatgpt.com',
      'oaiusercontent.com': 'chatgpt.com',
      'anthropic.com': 'claude.ai',
      'ai.studio': 'aistudio.google.com',
      'bard.google.com': 'gemini.google.com'
    },
    UNMANAGED_CONVERTERS: [
      'ilovepdf.com',
      'smallpdf.com',
      'pdf2go.com',
      'freepdfconvert.com',
      'canva.com',
      'wetransfer.com',
      'mega.nz',
      'mediafire.com',
      'dropbox.com',
      'box.com'
    ]
  },

  // Behavioral Anomaly Detection Thresholds
  THRESHOLDS: {
    OUTLIER_SIGMA_MULTIPLIER: 3.0,   // Baseline mean + 3x stddev for daily velocity surge
    HHI_CONCENTRATION_LIMIT: 0.70,   // Herfindahl-Hirschman Index > 70% for monolithic funneling
    ROGUE_ACTOR_VOLUME_PCT: 0.75,    // Single user accounts for >75% of unit transfer volume
    SCATTER_MIN_DOMAINS: 5,          // Scatter egress: >5 unapproved SaaS endpoints
    SCATTER_PER_DOMAIN_MAX_MB: 50    // Scatter egress: keeping per-domain volume < 50MB
  },

  // Slide Deck Dimensions (Google Slides 16:9 Standard)
  SLIDE_GEOMETRY: {
    WIDTH: 720,
    HEIGHT: 405,
    MARGIN_LEFT: 36,
    MARGIN_RIGHT: 36,
    CONTENT_WIDTH: 648
  },

  // User actions (ActionAssembler.gs): rows with the same user, trigger type, URL and size belong to one action when
  // they are within ACTION_WINDOW_MS of its first row. Rows wait until the row being read is more than ACTION_HOLD_MS
  // away; at most ACTION_PENDING_MAX rows wait at once.
  ACTION_WINDOW_MS: 10000,
  ACTION_HOLD_MS: 2 * 86400000,
  ACTION_PENDING_MAX: 50000,
  // Rows of one download whose sizes differ by at most this many bytes are one file (verdict rows report ~1 KB more)
  ACTION_SIZE_TOLERANCE_BYTES: 2048,
  // A clipboard copy writes one row per format within milliseconds; rows further apart are separate copies
  ACTION_COPY_GAP_MS: 1000,

  // Event Result values (normalizeEventResult) by outcome class. DATA_MASKED, DATA_UNMASKED and CANCELLED_BY_USER are
  // written by Chrome although Google does not document them. A value in none of these lists is an 'other' outcome:
  // reported as logged, never counted as stopped.
  EVENT_RESULT_CLASSES: {
    blocked: ['BLOCKED'],
    cancelled: ['CANCELLED_BY_USER'],
    bypassed: ['BYPASSED'],
    warned: ['WARNED'],
    unmasked: ['DATA_UNMASKED'],
    masked: ['DATA_MASKED'],
    detected: ['ALLOWED', 'DETECTED', 'REPORTED']
  },
  // One outcome per user action: the first class of this list among the results of its rows (notReported: no result)
  OUTCOME_PRECEDENCE: ['blocked', 'cancelled', 'bypassed', 'warned', 'unmasked', 'masked', 'other', 'detected', 'notReported'],
  // Outcomes that kept the data from leaving: a block, a cancel by the user, a warning with no bypass logged. Every
  // other outcome (an unknown or unreported one included) counts as data that left.
  OUTCOME_STOPPED: ['blocked', 'cancelled', 'warned'],
  // Outcomes only a policy that enforces writes. Any of them on a data-protection row (a transfer, print, paste, copy,
  // unscanned content or page masking; not a Safe Browsing, dangerous-file or password reuse warning) puts the report in
  // 'enforced' mode; results of the 'detected' class alone mean 'audit' mode (a policy that only listens); no result at
  // all, 'not_reported'.
  OUTCOME_ENFORCED: ['blocked', 'cancelled', 'bypassed', 'warned', 'unmasked', 'masked'],
  // A bypass is logged as a WARNED row, then a BYPASSED row for the same user and URL (a median of 5.5 s later on a
  // live tenant, up to 40 s for a download): a BYPASSED row joins the warning it follows within this window
  OUTCOME_BYPASS_WINDOW_MS: 10 * 60000,
  // One Safe Browsing visit or flagged download can be logged as several rows for the same user and URL, e.g. a
  // DETECTED row with an unspecified reason 40-90 ms before the WARNED row: a row within this window of a WARNED,
  // BLOCKED or BYPASSED row of the same user and URL is part of that event
  RADAR_EVENT_WINDOW_MS: 2000,
  // Content Name values that name no file: Chrome logs a paste as "Text data"
  GENERIC_CONTENT_NAMES: ['text data', 'image data'],

  // Browser launches with command-line switches (BrowserLaunches.gs). Chrome logs one launch once at browser level and
  // once per open profile, all with the same time, device and switches: events of one device with the same switches
  // within this window of the first one are one launch (Chrome does not start twice on one device within a second)
  LAUNCH_FOLD_WINDOW_MS: 1000,
  // Command-line switches by what they allow. A switch matches on its name: lower case, without its leading dashes and
  // its =value or :value. A 'name=Value' entry matches a switch whose comma-separated values hold Value (case ignored)
  // and decides before the name alone; 'prefix-*' matches every name with that prefix. A switch in no list is 'other',
  // listed by name. A launch is routine only when every one of its switches is routine.
  LAUNCH_SWITCH_CLASSES: {
    // Another program can drive the browser, as test tools, scripts and AI agents do: remote debugging over the DevTools
    // protocol, headless mode, automation mode, and the switches automation tools add with them
    automation: ['remote-debugging-port', 'remote-debugging-pipe', 'remote-debugging-address', 'remote-allow-origins',
      'headless', 'enable-automation', 'test-type', 'auto-open-devtools-for-tabs',
      'disable-blink-features=AutomationControlled'],
    // A protection is turned off: the sandbox, the same-origin policy, certificate checks, site isolation (also through
    // disable-features), blocking of insecure content, the camera and microphone prompt, phishing and download checks.
    // Most of them are on the list Chrome warns about when it starts (CommandLineFlagSecurityWarningsEnabled).
    protectionsOff: ['no-sandbox', 'disable-web-security', 'ignore-certificate-errors', 'ignore-certificate-errors-spki-list',
      'disable-site-isolation-trials', 'disable-features=IsolateOrigins', 'disable-features=site-per-process',
      'unsafely-treat-insecure-origin-as-secure', 'allow-running-insecure-content', 'disable-gpu-sandbox',
      'disable-setuid-sandbox', 'disable-seccomp-filter-sandbox', 'single-process', 'use-fake-ui-for-media-stream',
      'disable-client-side-phishing-detection', 'safebrowsing-disable-download-protection', 'disable-webrtc-encryption'],
    // An unpacked extension is loaded from a folder on disk. Google Chrome ignores these switches since versions 137 and
    // 139; a launch that carries them is listed all the same, by what the switches are for.
    extensionsFromDisk: ['load-extension', 'disable-extensions-except'],
    // Traffic goes through another proxy, or host names resolve to other addresses
    trafficRedirected: ['proxy-server', 'proxy-pac-url', 'host-resolver-rules', 'host-rules'],
    // Switches Chrome passes itself: a start in the background at sign-in (no-startup-window with the Windows prefetch
    // argument), a start in the foreground at sign-in, a profile shortcut, a restart after an update, and the experiments
    // chosen on chrome://flags (between flag-switches-begin and flag-switches-end, as features and field trials).
    // no-first-run, no-default-browser-check, user-data-dir and lang are left out: launchers, scripts and test tools set
    // them, Chrome does not.
    routine: ['no-startup-window', 'prefetch', 'startup-foreground-launch', 'profile-directory', 'restore-last-session',
      'flag-switches-*', 'enable-features', 'disable-features', 'force-fieldtrials', 'force-fieldtrial-params']
  },
  // Classes of the switches that are not routine, in the order the deck and the workbook list them when tied
  LAUNCH_CLASS_ORDER: ['automation', 'protectionsOff', 'extensionsFromDisk', 'trafficRedirected', 'other']
};
