#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

// -------------------------------------------------------------
// Environment & Config Setup
// -------------------------------------------------------------
function loadEnv() {
  const envFiles = [
    path.resolve(__dirname, '../.env'),
    path.resolve(__dirname, '../../../../.env'),
    path.resolve('/home/thirzq/.openclaw/workspace/skills/wordpress/.env')
  ];

  for (const envPath of envFiles) {
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim();
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  }
}

loadEnv();

const WP_BASE_URL = (process.env.WP_BASE_URL || 'http://localhost:8085').replace(/\/$/, '');
const WP_USER = process.env.WP_USER || 'admin';
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const TARGET_PHONE_NUMBER = process.env.TARGET_PHONE_NUMBER || '';
const OPENCLAW_BIN = process.env.OPENCLAW_BIN || 'openclaw';

const CATALOG_PATH = path.resolve(__dirname, '../project_catalog.json');
const ARTICLES_LOG_PATH = path.resolve(__dirname, '../articles_log.json');
const LAUNCH_HISTORY_PATH = path.resolve(__dirname, '../launch_history.json');
const LOG_FILE_PATH = path.resolve(__dirname, '../launch-kit.log');
const GALLERY_CAPTURE_SCRIPT = path.resolve(__dirname, 'project-gallery-capture.js');
const CAPTURE_ACCOUNTS_PATH = path.resolve(__dirname, 'tiktok-accounts.json');
const CAPTURE_TARGETS_PATH = path.resolve(__dirname, 'project-capture-targets.json');
const PLAYWRIGHT_NODE_MODULES = path.resolve(__dirname, '../node_modules');
const PLAYWRIGHT_DOCKER_IMAGE = 'mcr.microsoft.com/playwright:v1.64.1-noble';

// Primary preferred model
const PRIMARY_MODEL = process.env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it';

// Verified active free models on OpenRouter
const FREE_MODELS_POOL = [
  'openrouter/free',
  'particle-ai/particle-1:free',
  'baidu/ernie-5.5-flash-preview:free',
  'recursive/flint-v1.0:free',
  'google/gemma-4-26b-a4b-it:free',
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free'
];

function logMessage(msg) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE_PATH, line + '\n', 'utf8');
  } catch (e) {}
}

function isCreditOr402Error(status, errText) {
  if (status === 402) return true;
  if (!errText) return false;
  const lower = String(errText).toLowerCase();
  return (
    lower.includes('402') ||
    lower.includes('requires more credits') ||
    lower.includes('credit balance is too low') ||
    lower.includes('insufficient credits') ||
    lower.includes('payment required') ||
    lower.includes('openrouter_credits') ||
    lower.includes('can only afford')
  );
}

function getCandidateModels() {
  const primary = PRIMARY_MODEL;
  const primaryFree = primary.endsWith(':free') ? primary : `${primary}:free`;
  const otherFree = FREE_MODELS_POOL.filter(m => m !== primary && m !== primaryFree);

  for (let i = otherFree.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [otherFree[i], otherFree[j]] = [otherFree[j], otherFree[i]];
  }

  if (primary.endsWith(':free') || primary === 'openrouter/free') {
    return [primary, ...otherFree];
  }

  return [primary, primaryFree, ...otherFree];
}

// -------------------------------------------------------------
// Known Commercial Competitors for Positioning
// -------------------------------------------------------------
const KNOWN_POPULAR_ALTERNATIVES = {
  'rag-reader': 'LangSmith / LangFuse paid evaluation tiers, hosted Ragas tooling, and closed RAG platforms like Vectara or Amazon Bedrock Knowledge Bases',
  'literal-storyboard': 'Boords ($29–$99/mo), Storyboard That ($14.99/mo), and Milanote ($10/user/mo)',
  'genshinwallcraft': 'Wallpaper Engine (paid) and subscription-gated HD wallpaper galleries',
  'country-sdg': 'S&P Global ESG Dashboards ($10,000+/yr), Corporate ESG platforms, and MSCI ESG Manager',
  'ai-systems-portfolio': 'Enterprise AI Defense Suites, commercial ML security platforms, and private defense consultants ($5,000+/mo)',
  'nevatal': 'Notion AI ($10/mo), Glean Enterprise Search ($100+/user/mo), and Pinecone commercial vector hosting',
  'uptime-medics': 'PagerDuty ($21–$41/user/mo), Better Stack ($29/mo), and Statuspage.io ($29–$399/mo)',
  'voltquest': 'Datadog Network Monitoring ($15+/host/mo), Dynatrace, and Cisco AppDynamics',
  'interviewer': 'Interviewing.io ($150–$250/mock interview), Exponent ($79/mo), and LeetCode Premium ($35/mo)',
  'webisaurus': 'BrowserStack ($29–$129/mo), Sauce Labs, and LambdaTest ($15–$50/mo)',
  'videotex': 'Rev.com ($1.50/min), Descript ($12–$24/mo), and Otter.ai ($10–$20/mo)',
  'adcontrol': 'Broadsign, Vistar Media, and expensive commercial DOOH CMS platforms ($50–$200/screen/mo)',
  'english-practice': 'Duolingo Super ($12.99/mo), Grammarly Premium ($30/mo), and Cambridge / IELTS paid prep platforms ($50–$200)',
  'recommendica': 'Overleaf Premium ($15–$40/mo), Scite.ai ($20/mo), and Coursera / edX paid certificates',
  'furina-ml': 'Weights & Biases ($50/user/mo), Comet ML ($19/user/mo), and DataRobot enterprise subscriptions',
  'divinity-ai': 'Expensive proprietary religious research apps and commercial subscription-based theological tools',
  'crag-multihop': 'Proprietary enterprise RAG search engines and LangChain/LlamaIndex enterprise cloud tiers ($100+/mo)',
  'chattydesk': 'TypingMind ($39–$79), Poe ($20/mo), and ChatGPT Plus ($20/mo)',
  'nevatal-url-shortener': 'Bitly ($35+/mo), Dub.co paid plans ($24+/mo), and Rebrandly ($13–$300/mo)',
  'decalove': 'NovelAI ($10–$25/mo), AI Dungeon ($15–$30/mo), Character.ai, and proprietary visual novel game engines',
  'leetbug': 'LeetCode Premium ($35/mo), HackerRank, CodeSignal assessments, and proprietary developer screening portals',
  'quanta': 'Coursera / edX financial engineering courses ($40–$80/mo) and Bloomberg Terminal / TradingView paid subscriptions ($15–$60/mo)',
  'discord-server-bot': 'Statbot Premium, Carl-bot paid tiers, and commercial Discord bot subscriptions',
  'nevatal-cloud': 'DigitalOcean Droplets, AWS Lightsail, and commercial cloud VM portals',
  'wordpress-automation': 'Jasper AI ($49–$125/mo), SurferSEO ($89/mo), and commercial automated WordPress autoblogging tools'
};

function getPopularAlternatives(project) {
  if (KNOWN_POPULAR_ALTERNATIVES[project.id]) {
    return KNOWN_POPULAR_ALTERNATIVES[project.id];
  }
  return `expensive commercial and subscription-based ${project?.category || 'software'} platforms`;
}

function getCleanProductName(project) {
  if (!project) return 'Product';
  if (project.id === 'rag-reader') return 'RAGReader';
  if (project.id === 'divinity-ai') return 'DivinityAI';
  if (project.id === 'crag-multihop') return 'CRAG MultiHop';
  if (project.id === 'english-practice') return 'English Practice Diagnostic';
  if (project.id === 'uptime-medics') return 'Uptime Medics';
  if (project.id === 'furina-ml') return 'Furina ML';
  if (project.id === 'genshinwallcraft') return 'GenshinWallCraft';
  if (project.id === 'literal-storyboard') return 'Literal Storyboard';
  if (project.id === 'country-sdg') return 'Country SDG Profiles';
  if (project.id === 'ai-systems-portfolio') return 'Nevatal AI Systems Suite';
  const base = (project.name || '').split(' - ')[0].replace(/\s*\(.*\)/, '').trim();
  return base || project.name || 'Product';
}

// -------------------------------------------------------------
// WordPress Article Discovery
// -------------------------------------------------------------
function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&#8211;/g, '-')
    .replace(/&#8212;/g, '--')
    .replace(/&#038;/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

async function fetchWpPostById(postId) {
  const credentials = Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString('base64');
  try {
    const res = await fetch(`${WP_BASE_URL}/wp-json/wp/v2/posts/${postId}?_fields=id,date,title,link,excerpt,slug`, {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json'
      }
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    logMessage(`[WP API] Warning fetching post ${postId}: ${err.message}`);
  }
  return null;
}

async function searchWpPostForProject(projectName, projectId) {
  const credentials = Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString('base64');
  try {
    const query = encodeURIComponent(projectName.split(' ')[0]);
    const res = await fetch(`${WP_BASE_URL}/wp-json/wp/v2/posts?search=${query}&per_page=3&_fields=id,date,title,link,excerpt,slug`, {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json'
      }
    });
    if (res.ok) {
      const posts = await res.json();
      if (Array.isArray(posts) && posts.length > 0) {
        return posts[0];
      }
    }
  } catch (err) {
    logMessage(`[WP API] Warning searching posts for ${projectId}: ${err.message}`);
  }
  return null;
}

async function getArticleForProject(projectId, projectName) {
  if (fs.existsSync(ARTICLES_LOG_PATH)) {
    try {
      const articlesLog = JSON.parse(fs.readFileSync(ARTICLES_LOG_PATH, 'utf8'));
      if (Array.isArray(articlesLog)) {
        for (let i = articlesLog.length - 1; i >= 0; i--) {
          const run = articlesLog[i];
          if (run && Array.isArray(run.results)) {
            const match = run.results.find(r => r.project === projectId && r.post_id && !r.dryRun);
            if (match && match.post_id) {
              const post = await fetchWpPostById(match.post_id);
              if (post) return post;
              return {
                id: match.post_id,
                title: { rendered: match.title },
                link: match.link,
                excerpt: { rendered: '' }
              };
            }
          }
        }
      }
    } catch (e) {
      logMessage(`[Articles Log] Warning reading articles_log: ${e.message}`);
    }
  }
  return await searchWpPostForProject(projectName, projectId);
}

// -------------------------------------------------------------
// Catalog & History Management
// -------------------------------------------------------------
function loadCatalog() {
  if (!fs.existsSync(CATALOG_PATH)) {
    throw new Error(`Project catalog not found at ${CATALOG_PATH}`);
  }
  const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
  return JSON.parse(raw).projects || [];
}

function loadLaunchHistory() {
  if (!fs.existsSync(LAUNCH_HISTORY_PATH)) {
    return {
      launches: []
    };
  }
  try {
    return JSON.parse(fs.readFileSync(LAUNCH_HISTORY_PATH, 'utf8'));
  } catch (e) {
    return { launches: [] };
  }
}

function saveLaunchHistory(historyObj) {
  fs.writeFileSync(LAUNCH_HISTORY_PATH, JSON.stringify(historyObj, null, 2), 'utf8');
}

// -------------------------------------------------------------
// Archive PRD Grounding
// -------------------------------------------------------------
function getArchiveContextForProject(project) {
  const possibleArchiveDirs = [
    path.resolve(__dirname, '../../../../archive'),
    path.resolve(process.env.HOME || '/home/thirzq', '.openclaw/archive'),
    path.resolve(__dirname, '../archive'),
  ];
  const archiveDir = possibleArchiveDirs.find((d) => fs.existsSync(d));
  if (!archiveDir) return '';

  const filesToRead = new Set();
  const checkAndAdd = (ref) => {
    if (!ref) return;
    const base = path.basename(ref);
    const candidate = path.resolve(archiveDir, base);
    if (fs.existsSync(candidate)) {
      filesToRead.add(candidate);
      return;
    }
    if (fs.existsSync(ref)) {
      filesToRead.add(path.resolve(ref));
    }
  };

  checkAndAdd(project.archive_reference);
  checkAndAdd(project.architecture_reference);

  if (filesToRead.size === 0 && project.id) {
    try {
      const allFiles = fs.readdirSync(archiveDir);
      const projClean = project.id.toLowerCase().replace(/[^a-z0-9]/g, '');

      const matchedPrd = allFiles.find((f) => {
        if (!f.toLowerCase().endsWith('_prd.md') && !f.toLowerCase().endsWith('-prd.md')) return false;
        const fileClean = f.replace(/[_.-]prd\.md$/i, '').toLowerCase().replace(/[^a-z0-9]/g, '');
        return fileClean === projClean || fileClean.replace(/app$/i, '') === projClean;
      });

      if (matchedPrd) {
        filesToRead.add(path.resolve(archiveDir, matchedPrd));
        const archName = matchedPrd.replace(/_PRD\.md$/i, '_Architecture.md').replace(/-prd\.md$/i, '-architecture.md');
        if (fs.existsSync(path.resolve(archiveDir, archName))) {
          filesToRead.add(path.resolve(archiveDir, archName));
        }
      }
    } catch (e) {}
  }

  let combined = '';
  for (const fpath of filesToRead) {
    try {
      let content = fs.readFileSync(fpath, 'utf8');
      const filename = path.basename(fpath);
      const isPrd = filename.toLowerCase().includes('prd');
      const docHeader = isPrd
        ? `AUTHORITATIVE PRODUCT REQUIREMENTS DOCUMENT (PRD: ${filename})`
        : `SYSTEM ARCHITECTURE SPECIFICATION (${filename})`;

      if (content.length > 35000) {
        content = content.slice(0, 35000) + '\n\n[... Truncated for token optimization ...]';
      }

      combined += `\n\n================================================================================\n${docHeader}\n================================================================================\n${content}\n`;
    } catch (err) {
      logMessage(`[Archive] Could not read ${fpath}: ${err.message}`);
    }
  }
  return combined;
}

// -------------------------------------------------------------
// JSON Sanitizer & Robust Key Extractor
// -------------------------------------------------------------
function cleanJsonString(str) {
  let inString = false;
  let escaped = false;
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (inString) {
      if (escaped) {
        out += c;
        escaped = false;
      } else if (c === '\\') {
        out += c;
        escaped = true;
      } else if (c === '"') {
        out += c;
        inString = false;
      } else if (c === '\n') {
        out += '\\n';
      } else if (c === '\r') {
        out += '\\r';
      } else if (c === '\t') {
        out += '\\t';
      } else if (c.charCodeAt(0) < 32) {
        out += ' ';
      } else {
        out += c;
      }
    } else {
      if (c === '"') {
        inString = true;
      }
      out += c;
    }
  }
  // Strip trailing commas before closing braces/brackets
  out = out.replace(/,\s*([\}\]])/g, '$1');
  return out;
}

// -------------------------------------------------------------
// Unicode, Emoticon & Entity Decoding
// -------------------------------------------------------------
function decodeUnicodeAndEmoticons(str) {
  if (!str || typeof str !== 'string') return str;

  let decoded = str;

  // 0. Normalize double-escaped unicode \\uXXXX -> \uXXXX and \\xXX -> \xXX
  decoded = decoded.replace(/\\\\u([0-9a-fA-F]{4})/g, '\\u$1');
  decoded = decoded.replace(/\\\\u\{([0-9a-fA-F]+)\}/g, '\\u{$1}');
  decoded = decoded.replace(/\\\\x([0-9a-fA-F]{2})/g, '\\x$1');

  // 1. Decode surrogate pairs (e.g. \ud83d\udca1 -> 💡, \ud83d\ude80 -> 🚀)
  decoded = decoded.replace(/\\u([dD][89abAB][0-9a-fA-F]{2})\\u([dD][c-fC-F][0-9a-fA-F]{2})/g, (match, hi, lo) => {
    try {
      const highCode = parseInt(hi, 16);
      const lowCode = parseInt(lo, 16);
      const codePoint = ((highCode - 0xD800) * 0x400) + (lowCode - 0xDC00) + 0x10000;
      return String.fromCodePoint(codePoint);
    } catch (e) {
      return match;
    }
  });

  // 2. Decode ES6 style unicode escapes: \u{1F4A1}
  decoded = decoded.replace(/\\u\{([0-9a-fA-F]+)\}/g, (match, hex) => {
    try {
      return String.fromCodePoint(parseInt(hex, 16));
    } catch (e) {
      return match;
    }
  });

  // 3. Decode standard 4-hex unicode escapes \uXXXX
  decoded = decoded.replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) => {
    try {
      const code = parseInt(hex, 16);
      if (code === 0x2011) return '-';
      if (code === 0x00A0) return ' ';
      if (code >= 0x200B && code <= 0x200D) return '';
      if (code === 0x200E || code === 0x200F) return '';
      return String.fromCharCode(code);
    } catch (e) {
      return match;
    }
  });

  // 4. Decode 2-hex ascii escapes \xXX
  decoded = decoded.replace(/\\x([0-9a-fA-F]{2})/g, (match, hex) => {
    try {
      return String.fromCharCode(parseInt(hex, 16));
    } catch (e) {
      return match;
    }
  });

  // 5. Decode escaped quotes and slashes
  decoded = decoded
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\//g, '/');

  // 6. Decode HTML numeric & named entities
  decoded = decoded
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return m; }
    })
    .replace(/&#([0-9]+);/g, (m, d) => {
      try { return String.fromCodePoint(parseInt(d, 10)); } catch (e) { return m; }
    })
    .replace(/&amp;/g, '&')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#038;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');

  return decoded;
}

function cleanExtracted(val) {
  if (!val) return '';
  return decodeUnicodeAndEmoticons(
    val
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '')
      .replace(/\\t/g, '\t')
      .trim()
  );
}

function deepCleanStrings(obj) {
  if (!obj) return obj;
  if (typeof obj === 'string') {
    return decodeUnicodeAndEmoticons(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(deepCleanStrings);
  }
  if (typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      obj[key] = deepCleanStrings(obj[key]);
    }
  }
  return obj;
}

function extractLaunchFieldsRegex(raw) {
  const res = {};

  // Product Hunt
  const phName = raw.match(/"name"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const phTag = raw.match(/"tagline"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const phDesc = raw.match(/"description"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const phLaunchTags = raw.match(/"launch_tags"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const phMakers = raw.match(/"makers"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const phFirstComm = raw.match(/"first_comment"\s*:\s*"([\\s\\S]*?)(?="\\s*\}|"[\\s\\S]*?$)/i);
  const phMaker = raw.match(/"maker_comment"\s*:\s*"([\\s\\S]*?)(?="\\s*\}|"[\\s\\S]*?$)/i);
  if (phTag || phDesc || phFirstComm || phMaker) {
    res.producthunt_post = {
      name: phName ? cleanExtracted(phName[1]) : '',
      tagline: phTag ? cleanExtracted(phTag[1]) : '',
      description: phDesc ? cleanExtracted(phDesc[1]) : '',
      launch_tags: phLaunchTags ? cleanExtracted(phLaunchTags[1]) : 'Tech • Open Source',
      makers: phMakers ? cleanExtracted(phMakers[1]) : 'Nevatal (@nevatalapp)',
      first_comment: (phFirstComm || phMaker) ? cleanExtracted((phFirstComm || phMaker)[1]) : ''
    };
  }

  // AlternativeTo
  const altName = raw.match(/"app_name"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const altWeb = raw.match(/"website"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const altShort = raw.match(/"short_description"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const altSum = raw.match(/"summary"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const altFull = raw.match(/"full_description"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const altLang = raw.match(/"supported_languages"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const altPrice = raw.match(/"pricing"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const altSrc = raw.match(/"source_code"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const altTags = raw.match(/"tags"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const altFeat = raw.match(/"features"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const altPlat = raw.match(/"platforms"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const altAuthor = raw.match(/"author"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const altRel = raw.match(/"release_date"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const altRep = raw.match(/"replaces"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const altNote = raw.match(/"admin_note"\s*:\s*"([\\s\\S]*?)(?="\\s*\}|"[\\s\\S]*?$)/i);
  if (altShort || altSum || altFull || altFeat) {
    res.alternativeto_post = {
      app_name: altName ? cleanExtracted(altName[1]) : '',
      website: altWeb ? cleanExtracted(altWeb[1]) : '',
      short_description: (altShort || altSum) ? cleanExtracted((altShort || altSum)[1]) : '',
      full_description: altFull ? cleanExtracted(altFull[1]) : '',
      supported_languages: altLang ? cleanExtracted(altLang[1]) : 'English',
      pricing: altPrice ? cleanExtracted(altPrice[1]) : 'Free / Open Source',
      source_code: altSrc ? cleanExtracted(altSrc[1]) : 'Open source (OSI-approved)',
      tags: altTags ? cleanExtracted(altTags[1]) : '',
      features: altFeat ? cleanExtracted(altFeat[1]) : '',
      platforms: altPlat ? cleanExtracted(altPlat[1]) : 'Online / SaaS / Self-Hosted',
      author: altAuthor ? cleanExtracted(altAuthor[1]) : 'Nevatal (@nevatalapp)',
      release_date: altRel ? cleanExtracted(altRel[1]) : '',
      replaces: altRep ? cleanExtracted(altRep[1]) : '',
      admin_note: altNote ? cleanExtracted(altNote[1]) : ''
    };
  }

  // SaaSHub
  const shSum = raw.match(/"summary"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const shRep = raw.match(/"replaces"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const shFeat = raw.match(/"key_features"\s*:\s*"([\\s\\S]*?)(?="\\s*\}|"[\\s\\S]*?$)/i);
  if (shSum || shRep || shFeat) {
    res.saashub_post = {
      summary: shSum ? cleanExtracted(shSum[1]) : '',
      replaces: shRep ? cleanExtracted(shRep[1]) : '',
      key_features: shFeat ? cleanExtracted(shFeat[1]) : ''
    };
  }

  // BetaList
  const blProd = raw.match(/"product_name"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const blPitch = raw.match(/"pitch"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const blWeb = raw.match(/"website"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const blDesc = raw.match(/"description"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const blTopics = raw.match(/"topics"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const blMakers = raw.match(/"makers"\s*:\s*"([\\s\\S]*?)(?="\\s*\}|"[\\s\\S]*?$)/i);
  const blTag = raw.match(/"tagline"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const blVal = raw.match(/"early_adopter_value"\s*:\s*"([\\s\\S]*?)(?="\\s*\}|"[\\s\\S]*?$)/i);
  if (blPitch || blTag || blDesc) {
    res.betalist_post = {
      product_name: blProd ? cleanExtracted(blProd[1]) : '',
      pitch: blPitch ? cleanExtracted(blPitch[1]) : (blTag ? cleanExtracted(blTag[1]) : ''),
      website: blWeb ? cleanExtracted(blWeb[1]) : '',
      description: blDesc ? cleanExtracted(blDesc[1]) : (blVal ? cleanExtracted(blVal[1]) : ''),
      topics: blTopics ? cleanExtracted(blTopics[1]) : 'Artificial Intelligence, Developer Tools, Open Source',
      makers: blMakers ? cleanExtracted(blMakers[1]) : '@nevatalapp'
    };
  }

  // There's An AI For That
  const tfTask = raw.match(/"task"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const tfOne = raw.match(/"one_liner"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const tfCap = raw.match(/"capabilities"\s*:\s*"([\\s\\S]*?)(?="\\s*\}|"[\\s\\S]*?$)/i);
  if (tfTask || tfOne || tfCap) {
    res.taaft_post = {
      task: tfTask ? cleanExtracted(tfTask[1]) : '',
      one_liner: tfOne ? cleanExtracted(tfOne[1]) : '',
      capabilities: tfCap ? cleanExtracted(tfCap[1]) : ''
    };
  }

  // Futurepedia
  const fpSum = raw.match(/"summary"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const fpBest = raw.match(/"best_for"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const fpFeat = raw.match(/"features"\s*:\s*"([\\s\\S]*?)(?="\\s*\}|"[\\s\\S]*?$)/i);
  if (fpSum || fpBest || fpFeat) {
    res.futurepedia_post = {
      summary: fpSum ? cleanExtracted(fpSum[1]) : '',
      best_for: fpBest ? cleanExtracted(fpBest[1]) : '',
      features: fpFeat ? cleanExtracted(fpFeat[1]) : ''
    };
  }

  // DevHunt
  const dhPitch = raw.match(/"pitch"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const dhStack = raw.match(/"tech_stack"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const dhMaker = raw.match(/"maker_note"\s*:\s*"([\\s\\S]*?)(?="\\s*\}|"[\\s\\S]*?$)/i);
  if (dhPitch || dhStack || dhMaker) {
    res.devhunt_post = {
      pitch: dhPitch ? cleanExtracted(dhPitch[1]) : '',
      tech_stack: dhStack ? cleanExtracted(dhStack[1]) : '',
      maker_note: dhMaker ? cleanExtracted(dhMaker[1]) : ''
    };
  }

  // Peerlist
  const plHead = raw.match(/"headline"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const plBuilt = raw.match(/"what_built"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
  const plCta = raw.match(/"call_to_action"\s*:\s*"([\\s\\S]*?)(?="\\s*\}|"[\\s\\S]*?$)/i);
  if (plHead || plBuilt || plCta) {
    res.peerlist_post = {
      headline: plHead ? cleanExtracted(plHead[1]) : '',
      what_built: plBuilt ? cleanExtracted(plBuilt[1]) : '',
      call_to_action: plCta ? cleanExtracted(plCta[1]) : ''
    };
  }

  return res;
}

// -------------------------------------------------------------
// AI Directory Launch Kit Generator
// -------------------------------------------------------------
async function generateLaunchKit(project, article) {
  const articleTitle = article?.title?.rendered ? decodeHtmlEntities(article.title.rendered) : `${project.name} Architecture & Overview`;
  const articleUrl = article?.link || `https://wordpress.nevatal.id`;
  const articleExcerpt = article?.excerpt?.rendered ? decodeHtmlEntities(article.excerpt.rendered) : project.short_description;

  const archiveContext = getArchiveContextForProject(project);
  const popularAlternatives = getPopularAlternatives(project);

  const cleanName = getCleanProductName(project);
  const today = new Date().toISOString().split('T')[0];

  const prompt = `You are an expert product marketer, developer advocate, and launch strategist.
You are drafting a complete, ready-to-copy ONE-TIME DIRECTORY SUBMISSION & LAUNCH KIT for Thirza's open-source/self-hosted project: "${cleanName}".

CONTEXT:
- Unlike daily social media posts, this is a ONE-TIME product launch and directory submission kit.
- These submissions will be published once to top startup, software alternative, and developer launch directories.
- Thirza / Nevatal (@nevatalapp) is the creator and lead engineer.
- Every directory submission must be grounded strictly in the project's real features and architecture without marketing fluff or false promises.

PROJECT DETAILS:
- Name: ${cleanName} (Full Title: ${project.name})
- ID: ${project.id}
- Live URL: ${project.url}
- Category: ${project.category || 'Software Engineering'}
- Tech Stack: ${Array.isArray(project.tech_stack) ? project.tech_stack.join(', ') : (project.tech_stack || 'Modern Stack')}
- Short Description: ${project.short_description}
- Key Features: ${Array.isArray(project.key_features) ? project.key_features.join('; ') : project.short_description}
- Commercial Alternatives Replaced: ${popularAlternatives}
- WordPress Deep-Dive Article: ${articleTitle} (${articleUrl})
${archiveContext ? `\nAUTHORITATIVE PRD SPECIFICATION & ARCHITECTURE:\n${archiveContext}` : ''}

YOUR TASK:
Draft high-converting, polished one-time launch submissions for all 8 directories adhering strictly to each platform's real submission specifications:

1. "producthunt_post" (Product Hunt Submission Specification):
   - "name": Clean product name ONLY ("${cleanName}"). No taglines, no emoji, no domain.
   - "tagline": Say exactly what it does (< 60 chars). Skip hype like "the best" or "#1" (e.g. for RAGReader: "Compose & benchmark 13 advanced RAG modules").
   - "description": Lead with the core value proposition, then list the specific technical features that deliver it. (Clear, factual, zero buzzwords).
   - "launch_tags": 2-3 focused launch tags (e.g. "Tech • Open Source", "Developer Tools • Artificial Intelligence").
   - "makers": "Nevatal (@nevatalapp)".
   - "first_comment": Pinned first maker comment from Nevatal (@nevatalapp) (up to 5000 chars). Share why you built it, the technical challenge it solves, who it is for, and explicitly ask for specific technical feedback and feature ideas (NOT asking for upvotes).

2. "alternativeto_post" (AlternativeTo Submission Specification):
   - "app_name": Official application name ONLY ("${cleanName}"). No tagline, no domain. Correct spelling and letter case.
   - "website": Official website URL (${project.url}).
   - "short_description": Exactly ONE concise sentence stating the main purpose of the app.
   - "full_description": In-depth, comprehensive description of the application, architecture, and value proposition.
   - "supported_languages": "English".
   - "pricing": "Free / Open Source".
   - "source_code": "Open source (OSI-approved)".
   - "tags": Categories & tags describing what the app is and does (e.g. "Document QA, RAG, Information Retrieval, Benchmarking, Developer Tools, Open Source").
   - "features": 4-6 concise bullet points of concrete supported features.
   - "platforms": Supported platforms: "Online / SaaS / Self-Hosted".
   - "author": "Nevatal (@nevatalapp)".
   - "release_date": "${today}".
   - "replaces": Direct list of commercial/proprietary SaaS competitors it replaces (${popularAlternatives}).
   - "admin_note": Short note about the submission for AlternativeTo review moderators explaining why it qualifies for listing.

3. "saashub_post":
   - "summary": Concise overview of what ${cleanName} does and why choose it over commercial tools.
   - "replaces": Commercial tools it provides an alternative to.
   - "key_features": 3 bullet points highlighting zero subscription cost, high performance, and architecture.

4. "betalist_post" (BetaList / Betatest Submission Specification):
   - "product_name": Clean product name only ("${cleanName}").
   - "pitch": Pitch product in ONE sentence. STRICT RULE: No slogans, no buzzwords, be descriptive, and DO NOT include the product name!
   - "website": Official website URL (${project.url}).
   - "description": Conversational, clear product description. Talk like a person, no buzzwords. Focus on product features and value proposition for early adopters.
   - "topics": 3-5 relevant topics (e.g. "Artificial Intelligence, Developer Tools, Open Source, Machine Learning").
   - "makers": "@nevatalapp".

5. "taaft_post" (There's An AI For That):
   - "task": Primary task / AI category (e.g., AI Document Processing, Task Automation, System Profiling, etc.).
   - "one_liner": Direct one-sentence description of the task it solves.
   - "capabilities": 2-3 key automated capabilities and explicit note: "100% Free & Open-Source".

6. "futurepedia_post":
   - "summary": Concise 2-sentence summary of the tool.
   - "best_for": Target personas (e.g., Developers, Engineers, Students, Indie Hackers, Self-Hosters).
   - "features": Bullet points highlighting features and pricing: "100% Free / Open Source".

7. "devhunt_post":
   - "pitch": Direct developer-to-developer hook explaining what pain point it eliminates.
   - "tech_stack": Stack highlights (${Array.isArray(project.tech_stack) ? project.tech_stack.join(', ') : project.tech_stack}).
   - "maker_note": Authentic maker note from Thirza inviting developers to test the live demo (${project.url}) and give feedback.

8. "peerlist_post":
   - "headline": Engaging headline (e.g., "🚀 Just launched ${cleanName} on Peerlist Spotlight!").
   - "what_built": Concise breakdown of the problem, the solution, the architecture, and links to live app (${project.url}) and benchmarks (${articleUrl}).
   - "call_to_action": Friendly call asking fellow builders for feedback and connecting.

CRITICAL JSON FORMATTING:
- Keep all texts crisp, punchy, and direct. Use literal emoji characters (e.g. 🚀, 💡, 🔥, •, -) directly instead of escaped unicode sequences.
- Do NOT use unescaped double quotes inside post strings.
- Return ONLY a raw, valid JSON object with the following structure (no markdown wrappers):
{
  "producthunt_post": {
    "name": "...",
    "tagline": "...",
    "description": "...",
    "launch_tags": "...",
    "makers": "...",
    "first_comment": "..."
  },
  "alternativeto_post": {
    "app_name": "...",
    "website": "...",
    "short_description": "...",
    "full_description": "...",
    "supported_languages": "English",
    "pricing": "Free / Open Source",
    "source_code": "Open source (OSI-approved)",
    "tags": "...",
    "features": "...",
    "platforms": "Online / SaaS / Self-Hosted",
    "author": "Nevatal (@nevatalapp)",
    "release_date": "${today}",
    "replaces": "...",
    "admin_note": "..."
  },
  "saashub_post": {
    "summary": "...",
    "replaces": "...",
    "key_features": "..."
  },
  "betalist_post": {
    "product_name": "...",
    "pitch": "...",
    "website": "...",
    "description": "...",
    "topics": "...",
    "makers": "@nevatalapp"
  },
  "taaft_post": {
    "task": "...",
    "one_liner": "...",
    "capabilities": "..."
  },
  "futurepedia_post": {
    "summary": "...",
    "best_for": "...",
    "features": "..."
  },
  "devhunt_post": {
    "pitch": "...",
    "tech_stack": "...",
    "maker_note": "..."
  },
  "peerlist_post": {
    "headline": "...",
    "what_built": "...",
    "call_to_action": "..."
  }
}`;

  let lastError = null;
  const modelsToTry = getCandidateModels();
  let creditsDepleted = false;

  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];
    const isFreeModel = model.endsWith(':free') || model === 'openrouter/free';

    if (creditsDepleted && !isFreeModel) {
      continue;
    }

    try {
      logMessage(`[AI] Generating Launch Kit submissions with model: ${model}...`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://wordpress.nevatal.id',
          'X-Title': 'OpenClaw One-Time Project Launch Kit'
        },
        body: JSON.stringify({
          model: model,
          messages: [
            {
              role: 'system',
              content: 'You are an expert product launch copywriter. Output strictly valid JSON without any markdown formatting wrappers.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.7,
          max_tokens: 3500
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const text = await res.text();
        if (isCreditOr402Error(res.status, text)) {
          creditsDepleted = true;
        }
        throw new Error(`OpenRouter API error (${res.status}): ${text}`);
      }

      const json = await res.json();
      if (json.error) {
        const errMsg = json.error.message || JSON.stringify(json.error);
        if (isCreditOr402Error(json.error.code, errMsg)) {
          creditsDepleted = true;
        }
        throw new Error(`OpenRouter Provider Error: ${errMsg}`);
      }

      const rawContent = (json.choices?.[0]?.message?.content || json.choices?.[0]?.message?.reasoning || '').trim();
      if (!rawContent) {
        throw new Error('Empty response from model');
      }

      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON object found in model output');
      }

      let parsed;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (parseErr) {
        try {
          parsed = JSON.parse(cleanJsonString(jsonMatch[0]));
        } catch (cleanErr) {
          logMessage(`[AI] JSON parsing failed, applying regex key extractor...`);
          parsed = extractLaunchFieldsRegex(rawContent);
        }
      }

      parsed = deepCleanStrings(parsed);

      // Robust fallbacks for all 8 directories
      if (!parsed.producthunt_post) {
        parsed.producthunt_post = {
          name: cleanName,
          tagline: `Compose & benchmark 13 advanced RAG modules`,
          description: `${project.short_description}. Compare every retrieval method × model variant with auditable ground truth, module traces and Ragas scores — without notebooks or SaaS lock-in.`,
          launch_tags: 'Tech • Open Source',
          makers: 'Nevatal (@nevatalapp)',
          first_comment: `Hey Product Hunt! 👋 I'm from Nevatal, creator of ${cleanName}.\n\n` +
            `We built this project because RAG comparison usually stops at Dense, Sparse and Hybrid. Real answer quality also depends on query transformation, routing, evidence refinement and context construction — so RagReader makes those techniques composable and measurable on your own documents.\n\n` +
            `🚀 Highlights:\n` +
            `- 13 composable RAG modules: HyDE, RAG Fusion, Step Back, MemoRAG, RAPTOR, CRAG, Adaptive RAG and more\n` +
            `- Cited document workspace for PDF, DOCX, TXT, Markdown, web pages and pasted text\n` +
            `- Retrieval Precision@K / Recall@K / F1@K plus Ragas answer metrics\n` +
            `- 100% Free & Open-Source\n` +
            `- Modern Stack: ${Array.isArray(project.tech_stack) ? project.tech_stack.join(', ') : project.tech_stack}\n` +
            `- Live Demo: ${project.url}\n` +
            `- Technical Benchmark & PRD: ${articleUrl}\n\n` +
            `Who it's for: AI engineers and researchers evaluating retrieval methods, models and advanced RAG modules who need empirical metrics before deciding on architecture.\n\n` +
            `We would love to get your specific technical feedback on module composition, the evaluation metrics, and which pipelines you'd like benchmarked next!`
        };
      }

      if (!parsed.alternativeto_post) {
        parsed.alternativeto_post = {
          app_name: cleanName,
          website: project.url,
          short_description: project.short_description,
          full_description: `${cleanName} is a high-performance, 100% free and open-source platform designed for ${project.short_description}.\n\n` +
            `Built with ${Array.isArray(project.tech_stack) ? project.tech_stack.join(', ') : project.tech_stack}, it eliminates expensive subscription lock-in from ${popularAlternatives} by offering full self-hosting, reproducible benchmarks, and complete architectural transparency.`,
          supported_languages: 'English',
          pricing: 'Free / Open Source',
          source_code: 'Open source (OSI-approved)',
          tags: Array.isArray(project.tags) ? project.tags.join(', ') : (project.category || 'Developer Tools, AI, Open Source'),
          features: Array.isArray(project.key_features)
            ? project.key_features.map(f => `- ${f}`).join('\n')
            : `- 100% Free with zero paywalls\n- Self-hostable architecture\n- Live demo at ${project.url}`,
          platforms: 'Online / SaaS / Self-Hosted',
          author: 'Nevatal (@nevatalapp)',
          release_date: today,
          replaces: popularAlternatives,
          admin_note: `${cleanName} is an open-source, publicly accessible web platform with full architectural documentation, live demo, and reproducible metrics.`
        };
      }

      if (!parsed.saashub_post) {
        parsed.saashub_post = {
          summary: `Cost-effective, modern open-source alternative to ${popularAlternatives}.`,
          replaces: popularAlternatives,
          key_features: `- Zero monthly subscription fees\n- High reliability and modern architecture\n- Benchmarks and full walkthrough at ${articleUrl}`
        };
      }

      if (!parsed.betalist_post) {
        parsed.betalist_post = {
          product_name: cleanName,
          pitch: `Compose 13 advanced RAG modules, benchmark every retrieval × model combination, and evaluate answers with Precision@K and Ragas metrics.`,
          website: project.url,
          description: `${project.short_description}. Designed for AI engineers and researchers who want to test composable RAG pipelines with cited answers and reproducible metrics, without vendor lock-in or recurring SaaS subscriptions.`,
          topics: 'Artificial Intelligence, Developer Tools, Open Source, Machine Learning',
          makers: '@nevatalapp'
        };
      }

      if (!parsed.taaft_post) {
        parsed.taaft_post = {
          task: project.category || 'Developer Automation & AI Workflows',
          one_liner: `${project.name} delivers ${project.short_description} with zero paywalls.`,
          capabilities: `- Automated high-performance workflows\n- Stack: ${Array.isArray(project.tech_stack) ? project.tech_stack.slice(0, 3).join(', ') : project.tech_stack}\n- 100% Free & Open-Source`
        };
      }

      if (!parsed.futurepedia_post) {
        parsed.futurepedia_post = {
          summary: `${project.name} is a developer-friendly platform for ${project.short_description}.`,
          best_for: 'Developers, engineers, indie hackers, and self-hosters.',
          features: `- Pricing: 100% Free / Open-Source\n- Key Features: ${Array.isArray(project.key_features) ? project.key_features.slice(0, 3).join('; ') : project.short_description}\n- Live Demo: ${project.url}`
        };
      }

      if (!parsed.devhunt_post) {
        parsed.devhunt_post = {
          pitch: `I built ${project.name} — a decoupled, high-performance tool for ${project.short_description}.`,
          tech_stack: Array.isArray(project.tech_stack) ? project.tech_stack.join(', ') : project.tech_stack,
          maker_note: `Hey devs! Check out ${project.name} live at ${project.url}. Built with ${Array.isArray(project.tech_stack) ? project.tech_stack.slice(0, 3).join(', ') : project.tech_stack}. Check out the benchmarks at ${articleUrl} and share your thoughts!`
        };
      }

      if (!parsed.peerlist_post) {
        parsed.peerlist_post = {
          headline: `🚀 Project Spotlight: ${project.name}`,
          what_built: `I just launched ${project.name}!\n\n${project.short_description}\n\nBuilt with: ${Array.isArray(project.tech_stack) ? project.tech_stack.join(', ') : project.tech_stack}.\n\nLive Demo: ${project.url}\nCase Study: ${articleUrl}`,
          call_to_action: `Check it out and let me know your thoughts on the architecture!`
        };
      }

      logMessage(`[AI] Generation succeeded with model ${model}.`);
      return parsed;
    } catch (err) {
      logMessage(`[AI] Error with ${model}: ${err.message}. Trying fallback...`);
      lastError = err;
    }
  }

  throw new Error(`All AI models failed to generate content. Last error: ${lastError?.message}`);
}

// -------------------------------------------------------------
// Formatters for Each Directory
// -------------------------------------------------------------
function formatProductHunt(val, project) {
  if (!val) return '';
  if (typeof val === 'string') return decodeUnicodeAndEmoticons(val).trim();
  const name = val.name || getCleanProductName(project);
  const firstComment = val.first_comment || val.maker_comment || '';
  return decodeUnicodeAndEmoticons([
    `🏷️ *Product Name (No tagline/emoji):* ${name}`,
    val.tagline ? `📢 *Tagline (No hype/buzzwords):* ${val.tagline}` : '',
    val.description ? `📝 *Description (Lead with value, then features):*\n${val.description}` : '',
    `🏷️ *Launch Tags:* ${val.launch_tags || 'Tech • Open Source'}`,
    `👥 *Launch Team / Makers:* ${val.makers || 'Nevatal (@nevatalapp)'}`,
    firstComment ? `💬 *First Comment (Pinned Discussion - Why built, who it's for, asking feedback):*\n${firstComment}` : ''
  ].filter(Boolean).join('\n\n').trim());
}

function formatAlternativeTo(val, project) {
  if (!val) return '';
  if (typeof val === 'string') return decodeUnicodeAndEmoticons(val).trim();
  const appName = val.app_name || getCleanProductName(project);
  const website = val.website || project?.url || 'https://nevatal.id';
  const today = new Date().toISOString().split('T')[0];
  return decodeUnicodeAndEmoticons([
    `🏷️ *App Name (Name only, no tagline/domain):* ${appName}`,
    `🌐 *Website:* ${website}`,
    (val.short_description || val.summary) ? `⚡ *Short Description (One concise sentence):* ${val.short_description || val.summary}` : '',
    val.full_description ? `📝 *Full Description:*\n${val.full_description}` : '',
    `🌐 *Supported Languages:* ${val.supported_languages || 'English'}`,
    `💰 *Pricing:* ${val.pricing || 'Free / Open Source'}`,
    `🔓 *Source Code:* ${val.source_code || 'Open source (OSI-approved)'}`,
    val.tags ? `🏷️ *Tags / Categories:* ${val.tags}` : '',
    val.features ? `⭐ *Features:*\n${val.features}` : '',
    `💻 *Platforms:* ${val.platforms || 'Online / SaaS / Self-Hosted'}`,
    `👤 *Company / Author:* ${val.author || 'Nevatal (@nevatalapp)'}`,
    `📅 *Release Date:* ${val.release_date || today}`,
    val.replaces ? `🔄 *Alternative To / Replaces:* ${val.replaces}` : '',
    val.admin_note ? `📋 *Note About Your Changes (Meta for Admin Approval):*\n${val.admin_note}` : ''
  ].filter(Boolean).join('\n\n').trim());
}

function formatSaaSHub(val) {
  if (!val) return '';
  if (typeof val === 'string') return decodeUnicodeAndEmoticons(val).trim();
  return decodeUnicodeAndEmoticons([
    val.summary ? `📝 *Summary:* ${val.summary}` : '',
    val.replaces ? `🔄 *Competitors Replaced:* ${val.replaces}` : '',
    val.key_features ? `✨ *Key Highlights:*\n${val.key_features}` : ''
  ].filter(Boolean).join('\n\n').trim());
}

function formatBetaList(val, project) {
  if (!val) return '';
  if (typeof val === 'string') return decodeUnicodeAndEmoticons(val).trim();
  const prodName = val.product_name || getCleanProductName(project);
  const website = val.website || project?.url || 'https://nevatal.id';
  return decodeUnicodeAndEmoticons([
    `🏷️ *Product Name:* ${prodName}`,
    (val.pitch || val.tagline) ? `⚡ *Pitch (1 sentence, no buzzwords, NO product name):* ${val.pitch || val.tagline}` : '',
    `🌐 *Website:* ${website}`,
    (val.description || val.early_adopter_value) ? `📝 *Description (Conversational, no buzzwords):*\n${val.description || val.early_adopter_value}` : '',
    `🏷️ *Topics:* ${val.topics || 'Artificial Intelligence, Developer Tools, Open Source, Machine Learning'}`,
    `👥 *Makers:* ${val.makers || '@nevatalapp'}`
  ].filter(Boolean).join('\n\n').trim());
}

function formatTaaft(val) {
  if (!val) return '';
  if (typeof val === 'string') return decodeUnicodeAndEmoticons(val).trim();
  return decodeUnicodeAndEmoticons([
    val.task ? `🤖 *AI Category / Task:* ${val.task}` : '',
    val.one_liner ? `⚡ *One-Liner:* ${val.one_liner}` : '',
    val.capabilities ? `🛠️ *Core Capabilities:*\n${val.capabilities}` : ''
  ].filter(Boolean).join('\n\n').trim());
}

function formatFuturepedia(val) {
  if (!val) return '';
  if (typeof val === 'string') return decodeUnicodeAndEmoticons(val).trim();
  return decodeUnicodeAndEmoticons([
    val.summary ? `📝 *Tool Summary:* ${val.summary}` : '',
    val.best_for ? `🎯 *Best For:* ${val.best_for}` : '',
    val.features ? `✨ *Features & Pricing:*\n${val.features}` : ''
  ].filter(Boolean).join('\n\n').trim());
}

function formatDevHunt(val) {
  if (!val) return '';
  if (typeof val === 'string') return decodeUnicodeAndEmoticons(val).trim();
  return decodeUnicodeAndEmoticons([
    val.pitch ? `💻 *Developer Pitch:*\n${val.pitch}` : '',
    val.tech_stack ? `🛠️ *Tech Stack:* ${val.tech_stack}` : '',
    val.maker_note ? `🚀 *Maker Note:*\n${val.maker_note}` : ''
  ].filter(Boolean).join('\n\n').trim());
}

function formatPeerlist(val) {
  if (!val) return '';
  if (typeof val === 'string') return decodeUnicodeAndEmoticons(val).trim();
  return decodeUnicodeAndEmoticons([
    val.headline ? `📌 *Headline:* ${val.headline}` : '',
    val.what_built ? `🛠️ *What I Built:*\n${val.what_built}` : '',
    val.call_to_action ? `💬 *Discussion / CTA:*\n${val.call_to_action}` : ''
  ].filter(Boolean).join('\n\n').trim());
}

// -------------------------------------------------------------
// WhatsApp Message Builder for One-Time Launch Kit
// -------------------------------------------------------------
function buildLaunchWhatsAppMessage(project, article, posts) {
  const articleTitle = article?.title?.rendered ? decodeHtmlEntities(article.title.rendered) : `${project.name} Architecture & Benchmarks`;
  const articleUrl = article?.link || 'https://wordpress.nevatal.id';
  const today = new Date().toISOString().split('T')[0];

  const productHuntPost = formatProductHunt(posts.producthunt_post, project);
  const alternativeToPost = formatAlternativeTo(posts.alternativeto_post, project);
  const saasHubPost = formatSaaSHub(posts.saashub_post);
  const betaListPost = formatBetaList(posts.betalist_post, project);
  const taaftPost = formatTaaft(posts.taaft_post);
  const futurepediaPost = formatFuturepedia(posts.futurepedia_post);
  const devHuntPost = formatDevHunt(posts.devhunt_post);
  const peerlistPost = formatPeerlist(posts.peerlist_post);

  const finalMsg = `🚀 *PROJECT LAUNCH & DIRECTORY SUBMISSION KIT* 🚀
*(One-Time Platform Submissions)*
📅 *Prepared:* ${today}
🏷️ *Project:* ${project.name}
🌐 *Live App:* ${project.url}
📝 *Case Study & Architecture:* ${articleUrl}
📌 *Topic:* ${articleTitle}

📸 *Visual Assets Attached (3 In-App Images):*
1️⃣ Desktop App Workspace (1280x800 — Product Hunt Image 1 / Web)
2️⃣ Feature / Deep Workspace View (1440x900 — Product Hunt Image 2 / Gallery)
3️⃣ Mobile In-App View (390x844 — Product Hunt Image 3 / Feeds)
(Signed in with the project's OpenClaw account when credentials are configured.)

━━━━━━━━━━━━━━━━━━━━━━━━━━
😸 *1. PRODUCT HUNT* [Tap to Copy]
━━━━━━━━━━━━━━━━━━━━━━━━━━
${productHuntPost}

━━━━━━━━━━━━━━━━━━━━━━━━━━
🔄 *2. ALTERNATIVETO* [Tap to Copy]
━━━━━━━━━━━━━━━━━━━━━━━━━━
${alternativeToPost}

━━━━━━━━━━━━━━━━━━━━━━━━━━
🌐 *3. SAASHUB* [Tap to Copy]
━━━━━━━━━━━━━━━━━━━━━━━━━━
${saasHubPost}

━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 *4. BETALIST* [Tap to Copy]
━━━━━━━━━━━━━━━━━━━━━━━━━━
${betaListPost}

━━━━━━━━━━━━━━━━━━━━━━━━━━
🤖 *5. THERE'S AN AI FOR THAT* [Tap to Copy]
━━━━━━━━━━━━━━━━━━━━━━━━━━
${taaftPost}

━━━━━━━━━━━━━━━━━━━━━━━━━━
🔮 *6. FUTUREPEDIA* [Tap to Copy]
━━━━━━━━━━━━━━━━━━━━━━━━━━
${futurepediaPost}

━━━━━━━━━━━━━━━━━━━━━━━━━━
🏹 *7. DEVHUNT* [Tap to Copy]
━━━━━━━━━━━━━━━━━━━━━━━━━━
${devHuntPost}

━━━━━━━━━━━━━━━━━━━━━━━━━━
🅿️ *8. PEERLIST* [Tap to Copy]
━━━━━━━━━━━━━━━━━━━━━━━━━━
${peerlistPost}

━━━━━━━━━━━━━━━━━━━━━━━━━━
✨ *One-Time Launch Kit ready!* Copy and submit to each directory whenever you launch ${project.name}.`;

  return decodeUnicodeAndEmoticons(finalMsg);
}

// -------------------------------------------------------------
// Multi-Image Project Screenshot Generator (Product Hunt, Galleries, Feeds)
// -------------------------------------------------------------
function loadCaptureAccount(projectId) {
  try {
    if (!fs.existsSync(CAPTURE_ACCOUNTS_PATH)) return null;
    const accounts = JSON.parse(fs.readFileSync(CAPTURE_ACCOUNTS_PATH, 'utf8'));
    return accounts?.[projectId] || null;
  } catch (err) {
    logMessage(`[Screenshot] Warning: could not read capture accounts (${err.message}).`);
    return null;
  }
}

function loadCaptureTarget(projectId) {
  try {
    if (!fs.existsSync(CAPTURE_TARGETS_PATH)) return null;
    const targets = JSON.parse(fs.readFileSync(CAPTURE_TARGETS_PATH, 'utf8'));
    const value = targets?.[projectId];
    return typeof value === 'string' && value ? value : null;
  } catch (err) {
    return null;
  }
}

function buildGalleryCaption(viewId, projectName, appUrl, authenticated) {
  const meta = {
    desktop: { index: 1, title: 'Desktop Showcase', where: 'Product Hunt Image 1 / Web Listing' },
    feature: { index: 2, title: 'Workspace & Feature View', where: 'Product Hunt Image 2 / Directory Gallery' },
    mobile: { index: 3, title: 'Mobile Responsive View', where: 'Product Hunt Image 3 / Social Feeds' }
  }[viewId] || { index: 1, title: 'Desktop Showcase', where: 'Product Hunt Image 1 / Web Listing' };
  const viewType = authenticated ? 'Signed-in app view' : 'Live app view';
  return `📸 *[${meta.index}/3] ${meta.title} - ${projectName}*\n(${viewType} · ${meta.where})\n🔗 ${appUrl}`;
}

function runSignedInGalleryCapture(url, project, screenshotsDir, timestamp, configs) {
  const projectId = project?.id || 'project';
  const projectName = project?.name || 'Project';
  const account = loadCaptureAccount(projectId);
  const publicTarget = loadCaptureTarget(projectId);
  const captureUrl = account ? null : (publicTarget || url);
  const displayUrl = account?.capture_url || publicTarget || url;

  if (!fs.existsSync(GALLERY_CAPTURE_SCRIPT)) {
    logMessage(`[Screenshot] Gallery capture script missing at ${GALLERY_CAPTURE_SCRIPT}.`);
    return null;
  }
  if (!fs.existsSync(path.join(PLAYWRIGHT_NODE_MODULES, 'playwright-core'))) {
    logMessage(`[Screenshot] playwright-core missing; run npm install in the wordpress skill.`);
    return null;
  }

  const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
  const gid = typeof process.getgid === 'function' ? process.getgid() : 1000;
  const metaPath = path.join(screenshotsDir, 'meta.json');
  try { fs.unlinkSync(metaPath); } catch (e) {}

  const dockerArgs = [
    'run',
    '--rm',
    '--network',
    'host',
    '--user',
    `${uid}:${gid}`,
    '-e',
    'HOME=/tmp',
    '-e',
    'NODE_PATH=/opt/pw/node_modules',
    '-v',
    `${GALLERY_CAPTURE_SCRIPT}:/opt/project-gallery-capture.js:ro`,
    '-v',
    `${PLAYWRIGHT_NODE_MODULES}:/opt/pw/node_modules:ro`,
    '-v',
    `${screenshotsDir}:/out`
  ];

  if (account) {
    dockerArgs.push('-v', `${CAPTURE_ACCOUNTS_PATH}:/opt/project-accounts.json:ro`);
  }

  dockerArgs.push(
    PLAYWRIGHT_DOCKER_IMAGE,
    'node',
    '/opt/project-gallery-capture.js',
    '--url',
    url
  );

  // Account projects resolve their own capture_url (and public fallback)
  // inside the capture script; public projects get an explicit inside URL.
  if (captureUrl) {
    dockerArgs.push('--capture-url', captureUrl);
  }

  dockerArgs.push(
    '--out-dir',
    '/out',
    '--project-id',
    projectId,
    '--project-name',
    projectName,
    '--timestamp',
    String(timestamp)
  );

  if (account) {
    dockerArgs.push('--login-config', '/opt/project-accounts.json', '--account', projectId);
  }

  logMessage(
    `[Screenshot] Capturing in-app gallery for ${projectName}${account ? ' as the OpenClaw account' : ''} (${displayUrl})...`
  );

  try {
    const output = execFileSync('docker', dockerArgs, {
      encoding: 'utf8',
      timeout: 300000,
      maxBuffer: 10 * 1024 * 1024
    });
    output
      .split('\n')
      .filter((line) => line.includes('[Gallery Capture]'))
      .slice(-10)
      .forEach((line) => logMessage(line.replace('[Gallery Capture] ', '[Screenshot] ')));
  } catch (err) {
    logMessage(`[Screenshot] In-app gallery capture failed: ${err.message.split('\n')[0]}`);
    const stderr = String(err.stderr || '').trim();
    if (stderr) {
      stderr
        .split('\n')
        .filter((line) => line.includes('[Gallery Capture]'))
        .slice(-6)
        .forEach((line) => logMessage(line.replace('[Gallery Capture] ', '[Screenshot] ')));
    }
    return null;
  }

  if (!fs.existsSync(metaPath)) {
    logMessage('[Screenshot] In-app gallery capture produced no meta.json.');
    return null;
  }

  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch (err) {
    logMessage(`[Screenshot] Could not parse gallery meta.json (${err.message}).`);
    return null;
  }

  const views = Array.isArray(meta.views) ? meta.views : [];
  const authenticated = Boolean(meta.authenticated);
  const results = [];

  for (const cfg of configs) {
    const view = views.find((v) => v.id === cfg.id);
    if (!view?.filename) continue;
    const filePath = path.join(screenshotsDir, view.filename);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size <= 1000) continue;
    results.push({
      path: filePath,
      id: cfg.id,
      label: cfg.label,
      caption: buildGalleryCaption(cfg.id, projectName, view.url || meta.capture_start_url || url, authenticated)
    });
  }

  logMessage(
    `[Screenshot] In-app gallery captured ${results.length}/3 view(s)${
      authenticated ? ' from a signed-in session' : ' from the public app'
    }.`
  );

  return results.length ? results : null;
}

async function captureProjectScreenshots(url, project) {
  const screenshotsDir = path.resolve(__dirname, '../screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const timestamp = Date.now();
  const projectId = project?.id || 'project';
  const projectName = project?.name || 'Project';
  const account = loadCaptureAccount(projectId);
  const publicTarget = loadCaptureTarget(projectId);

  const configs = [
    {
      id: 'desktop',
      label: 'Desktop Hero Showcase (Product Hunt Image 1 / Web)',
      filename: `${projectId}_desktop_${timestamp}.png`,
      args: ['--viewport-size=1280,800']
    },
    {
      id: 'feature',
      label: 'Workspace & Feature View (Product Hunt Image 2 / Gallery)',
      filename: `${projectId}_feature_${timestamp}.png`,
      args: ['--viewport-size=1440,900']
    },
    {
      id: 'mobile',
      label: 'Mobile Responsive View (Product Hunt Image 3 / Instagram & TikTok)',
      filename: `${projectId}_mobile_${timestamp}.png`,
      args: ['--viewport-size=390,844']
    }
  ];

  logMessage(`[Screenshot] Generating 3-image project gallery for ${projectName} (${url})...`);

  // Strategy 1: sign in through the real UI, then capture the inside of the app.
  const galleryResults = runSignedInGalleryCapture(url, project, screenshotsDir, timestamp, configs) || [];
  const capturedIds = new Set(galleryResults.map((r) => r.id));

  // Plain Playwright can't sign in; for account projects fall back to the
  // public landing URL, for public apps keep the inside-the-app target.
  const fallbackUrl = account ? url : (publicTarget || url);
  const results = [...galleryResults];

  for (const cfg of configs) {
    if (capturedIds.has(cfg.id)) continue;

    const outputPath = path.resolve(screenshotsDir, cfg.filename);
    let captured = false;

    // Strategy 2: Local Docker Playwright container with exact matching version & host network
    try {
      const tmpHost = `/tmp/snap_${cfg.id}_${timestamp}.png`;
      const dockerCmd = `docker run --rm --network host --user 1000:1000 -v /tmp:/tmp ${PLAYWRIGHT_DOCKER_IMAGE} npx -y playwright@1.64.1 screenshot ${cfg.args.join(' ')} "${fallbackUrl}" "${tmpHost}"`;
      execSync(dockerCmd, { encoding: 'utf8', timeout: 60000 });
      if (fs.existsSync(tmpHost) && fs.statSync(tmpHost).size > 1000) {
        fs.copyFileSync(tmpHost, outputPath);
        try { fs.unlinkSync(tmpHost); } catch (e) {}
        logMessage(`[Screenshot] Playwright captured ${cfg.label}: ${outputPath}`);
        results.push({
          path: outputPath,
          caption: buildGalleryCaption(cfg.id, projectName, fallbackUrl, false),
          id: cfg.id,
          label: cfg.label
        });
        captured = true;
      }
    } catch (err) {
      logMessage(`[Screenshot] Playwright attempt failed for ${cfg.id}: ${err.message}. Trying cloud API fallback...`);
    }

    // Strategy 3: Fast Cloud Screenshot via Microlink API fallback
    if (!captured) {
      try {
        const extraParam = cfg.id === 'mobile'
          ? '&viewport.isMobile=true&viewport.width=390&viewport.height=844'
          : (cfg.id === 'feature' ? '&viewport.width=1440&viewport.height=900' : '&viewport.width=1280&viewport.height=800');
        const apiUrl = `https://api.microlink.io/?url=${encodeURIComponent(fallbackUrl)}&screenshot=true&embed=screenshot.url${extraParam}`;
        const res = await fetch(apiUrl);
        if (res.ok) {
          const buffer = Buffer.from(await res.arrayBuffer());
          if (buffer.length > 1000) {
            fs.writeFileSync(outputPath, buffer);
            logMessage(`[Screenshot] Microlink captured ${cfg.label}: ${outputPath}`);
            results.push({
              path: outputPath,
              caption: buildGalleryCaption(cfg.id, projectName, fallbackUrl, false),
              id: cfg.id,
              label: cfg.label
            });
            captured = true;
          }
        }
      } catch (err) {
        logMessage(`[Screenshot] Microlink fallback failed for ${cfg.id}: ${err.message}`);
      }
    }
  }

  const order = { desktop: 0, feature: 1, mobile: 2 };
  return results.sort((a, b) => (order[a.id] ?? 9) - (order[b.id] ?? 9));
}

// -------------------------------------------------------------
// Delivery via OpenClaw Gateway to WhatsApp
// -------------------------------------------------------------
async function sendToWhatsApp(messageText, targetPhone, mediaItems = []) {
  const target = targetPhone || TARGET_PHONE_NUMBER;
  const cleanMessage = decodeUnicodeAndEmoticons(messageText);

  let items = [];
  if (Array.isArray(mediaItems)) {
    items = mediaItems;
  } else if (typeof mediaItems === 'string' && mediaItems.trim()) {
    items = [{ path: mediaItems, caption: '' }];
  } else if (mediaItems && typeof mediaItems === 'object' && mediaItems.path) {
    items = [mediaItems];
  }

  // 1. Send all visual screenshot assets
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const mPath = typeof item === 'string' ? item : item?.path;
    const mCaption = typeof item === 'object' ? item?.caption : '';

    if (mPath && fs.existsSync(mPath)) {
      logMessage(`[WhatsApp] Sending visual asset [${i + 1}/${items.length}] to ${target}...`);
      const tmpCaptionFile = path.resolve(__dirname, `../tmp_caption_${Date.now()}_${i}.txt`);
      try {
        const caption = decodeUnicodeAndEmoticons(mCaption || `📸 *Project Visual Asset [${i + 1}/${items.length}]*`);
        fs.writeFileSync(tmpCaptionFile, caption, 'utf8');
        const mediaCmd = `PATH="/home/thirzq/.nvm/versions/node/v26.13.0/bin:$PATH" ${OPENCLAW_BIN} message send --channel whatsapp --target "${target}" --media "${mPath}" --message "$(cat '${tmpCaptionFile}')"`;
        const mediaOut = execSync(mediaCmd, { encoding: 'utf8', timeout: 45000 });
        logMessage(`[WhatsApp] Visual asset [${i + 1}/${items.length}] delivered! Output: ${mediaOut.trim()}`);
      } catch (mediaErr) {
        logMessage(`[WhatsApp] Warning: Failed to send media [${i + 1}/${items.length}]: ${mediaErr.message}`);
      } finally {
        try { if (fs.existsSync(tmpCaptionFile)) fs.unlinkSync(tmpCaptionFile); } catch (e) {}
      }
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  // 2. Send complete copy kit text
  if (cleanMessage && cleanMessage.trim()) {
    logMessage(`[WhatsApp] Sending one-time launch kit to ${target}...`);
    const tmpFile = path.resolve(__dirname, `../tmp_launch_msg_${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, cleanMessage, 'utf8');

    try {
      const cmd = `PATH="/home/thirzq/.nvm/versions/node/v26.13.0/bin:$PATH" ${OPENCLAW_BIN} message send --channel whatsapp --target "${target}" --message "$(cat '${tmpFile}')"`;
      const output = execSync(cmd, { encoding: 'utf8', timeout: 30000 });
      logMessage(`[WhatsApp] Launch kit message successfully sent! Output: ${output.trim()}`);
      return true;
    } catch (err) {
      logMessage(`[WhatsApp] Error sending message via OpenClaw: ${err.message}`);
      throw err;
    } finally {
      try {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      } catch (e) {}
    }
  }
}

// -------------------------------------------------------------
// Main CLI
// -------------------------------------------------------------
async function run() {
  const args = process.argv.slice(2);
  const isSend = args.includes('--send');
  const isDryRun = args.includes('--dry-run') || args.includes('-n') || !isSend;
  const isList = args.includes('--list');
  const isHelp = args.includes('--help') || args.includes('-h');
  const isScreenshotsOnly = args.includes('--screenshots-only') || args.includes('--screenshots');

  let forcedProjectId = null;
  const projectIdx = args.indexOf('--project');
  if (projectIdx !== -1 && args[projectIdx + 1]) {
    forcedProjectId = args[projectIdx + 1];
  }

  let forcedTarget = null;
  const targetIdx = args.indexOf('--target');
  if (targetIdx !== -1 && args[targetIdx + 1]) {
    forcedTarget = args[targetIdx + 1];
  }

  if (isHelp) {
    console.log(`
OpenClaw One-Time Project Launch Kit Dispatcher
Generates directory submissions & 3-image screenshot galleries for:
Product Hunt, AlternativeTo, SaaSHub, BetaList, There's An AI For That, Futurepedia, DevHunt, and Peerlist.

Usage: node project-launch-kit.js [options]

Options:
  --project <id>       Target project ID (e.g. literal-storyboard, genshinwallcraft, uptime-medics)
  --send               Deliver 3 gallery images + Launch Kit to WhatsApp (${TARGET_PHONE_NUMBER})
  --dry-run, -n        Generate and print preview to stdout without sending (default if --send not passed)
  --screenshots-only   Capture and deliver only the 3 screenshots (Product Hunt 3-image set)
  --target <phone>     Override recipient phone number (default: ${TARGET_PHONE_NUMBER})
  --list               List all catalog projects and launch history
  --help, -h           Show this help text
`);
    process.exit(0);
  }

  const projects = loadCatalog();
  const launchHistory = loadLaunchHistory();

  if (isList) {
    console.log('\n=== REGISTERED PROJECTS IN CATALOG ===');
    projects.forEach((p, i) => {
      const launched = launchHistory.launches.find(l => l.project_id === p.id);
      const status = launched ? ` [LAUNCHED on ${launched.date}]` : ' [NOT YET LAUNCHED]';
      console.log(`${(i + 1).toString().padStart(2, ' ')}. [${p.id}] ${p.name}${status}`);
    });
    console.log('');
    process.exit(0);
  }

  // Determine project
  let project = null;
  if (forcedProjectId) {
    project = projects.find(p => p.id === forcedProjectId || p.id.toLowerCase() === forcedProjectId.toLowerCase());
    if (!project) {
      throw new Error(`Project "${forcedProjectId}" not found in catalog.`);
    }
  } else {
    // Pick the first unlaunched project, or default to the first project
    project = projects.find(p => !launchHistory.launches.some(l => l.project_id === p.id)) || projects[0];
  }

  logMessage('====================================================');
  logMessage(`[Launch Kit] Generating One-Time Launch Submissions for: [${project.id}] ${project.name}`);
  logMessage('====================================================');

  const targetUrl = project.url || 'https://wordpress.nevatal.id';

  // 1. Capture 3 gallery screenshots (Product Hunt requires 3 images)
  const screenshots = await captureProjectScreenshots(targetUrl, project);

  if (isScreenshotsOnly) {
    if (isSend) {
      await sendToWhatsApp(null, forcedTarget || TARGET_PHONE_NUMBER, screenshots);
      logMessage(`[Launch Kit] 3 screenshots delivered to WhatsApp!`);
    } else {
      console.log(`\n=== 3 SCREENSHOTS CAPTURED ===`);
      screenshots.forEach((s, idx) => console.log(`[${idx + 1}/3] ${s.label}: ${s.path}`));
      console.log('(Dry-run mode: Pass --send to deliver these to WhatsApp)');
    }
    return;
  }

  // 2. Find WordPress case study / architecture post
  logMessage(`[Launch Kit] Locating article for ${project.name}...`);
  let article = await getArticleForProject(project.id, project.name);

  // 3. Generate One-Time Directory Submissions
  const posts = await generateLaunchKit(project, article);

  // 4. Format WhatsApp message
  const whatsappMessage = buildLaunchWhatsAppMessage(project, article, posts);

  console.log('\n================ PREVIEW OF ONE-TIME LAUNCH KIT ================');
  console.log(whatsappMessage);
  console.log('===============================================================\n');

  // 5. Send or Dry-Run
  if (isSend) {
    logMessage(`[WhatsApp] Delivering 3 gallery screenshots + Launch Kit to ${forcedTarget || TARGET_PHONE_NUMBER}...`);
    await sendToWhatsApp(whatsappMessage, forcedTarget || TARGET_PHONE_NUMBER, screenshots);

    // Record in launch history
    launchHistory.launches.push({
      date: new Date().toISOString().split('T')[0],
      project_id: project.id,
      project_name: project.name,
      article_link: article?.link || project.url,
      sent_to: forcedTarget || TARGET_PHONE_NUMBER,
      screenshots: screenshots.map(s => path.basename(s.path)),
      timestamp: new Date().toISOString()
    });
    saveLaunchHistory(launchHistory);
    logMessage(`[Launch Kit] Successfully delivered and recorded one-time launch for ${project.id}.`);
  } else {
    logMessage(`[Launch Kit] Dry-run completed. Pass --send to deliver this kit + 3 screenshots to WhatsApp.`);
  }
}

if (require.main === module) {
  run().catch(err => {
    logMessage(`[FATAL] Error in launch kit script: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  run,
  generateLaunchKit,
  buildLaunchWhatsAppMessage,
  captureProjectScreenshots,
  sendToWhatsApp
};
