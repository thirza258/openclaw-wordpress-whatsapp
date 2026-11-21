#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Load .env file if present
function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env');
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

loadEnv();

const WP_BASE_URL = (process.env.WP_BASE_URL || 'http://localhost:8085').replace(/\/$/, '');
const WP_USER = process.env.WP_USER || 'admin';
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

// Primary preferred model when tokens/credits are available
const PRIMARY_MODEL = process.env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it';

// Verified active free models on OpenRouter (ordered by verified reliability & speed)
const FREE_MODELS_POOL = [
  'cohere/north-mini-code:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'xingchen-agi/xing4.0-29b-a4b:free',
  'dots-studio/dots-3-note-preview:free',
  'google/gemma-4-26b-a4b-it:free',
  'google/gemma-4-31b-it:free',
  'openrouter/free'
];

let globalCreditsDepleted = false;

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
  if (globalCreditsDepleted) {
    return FREE_MODELS_POOL;
  }

  const primary = PRIMARY_MODEL;
  const primaryFree = primary.endsWith(':free') ? primary : `${primary}:free`;
  const otherFree = FREE_MODELS_POOL.filter(m => m !== primary && m !== primaryFree);

  // If primary model is already a free model, just return free models
  if (primary.endsWith(':free') || primary === 'openrouter/free') {
    return [primary, ...otherFree];
  }

  // Primary paid model comes FIRST when credits are available;
  // followed immediately by its direct free version, then other active free models.
  return [primary, primaryFree, ...otherFree];
}

// Popular commercial/paid versions for each project to contrast against in non-architecture articles
const POPULAR_ALTERNATIVES_MAP = {
  'english-practice': 'Duolingo Super ($12.99/mo), Grammarly Premium ($30/mo), and Cambridge / IELTS paid prep platforms ($50–$200)',
  'interviewer': 'Interviewing.io ($100–$225/mock interview), Big Interview ($79/mo), and LeetCode Premium ($35/mo)',
  'uptime-medics': 'Better Stack ($29–$200/mo), PagerDuty ($21–$41/user/mo), and Pingdom ($15–$150/mo)',
  'nevatal': 'ChatPDF Pro ($20/mo), Humata AI ($15–$99/mo), Glean, and Microsoft Copilot for Enterprise ($30/user/mo)',
  'divinity-ai': 'Expensive proprietary religious research apps and commercial subscription-based theological tools',
  'crag-multihop': 'Proprietary enterprise RAG search engines and LangChain/LlamaIndex enterprise cloud tiers ($100+/mo)',
  'rag-reader': 'LangSmith / LangFuse paid evaluation tiers, hosted Ragas tooling, and closed RAG platforms like Vectara or Amazon Bedrock Knowledge Bases',
  'recommendica': 'Overleaf Premium ($15–$40/mo for LaTeX document compiling), Scite.ai ($20/mo) & Consensus.app for paper search, and paid course platforms like Coursera / edX ($40–$80/mo)',
  'chattydesk': 'TypingMind ($39–$79), Poe ($20/mo), and ChatGPT Plus ($20/mo)',
  'furina-ml': 'Weights & Biases ($50/user/mo), Comet ML ($19/user/mo), and commercial DataRobot platforms',
  'nevatal-url-shortener': 'Bitly ($35+/mo), Dub.co paid plans ($24+/mo), and Rebrandly ($13–$300/mo)',
  'webisaurus': 'Dash, DevDocs commercial hosted versions, and paid developer syntax lookup tools',
  'voltquest': 'Proteus Design Suite ($$$$), Multisim ($$$$), and commercial MCU circuit simulator software',
  'videotex': 'Descript ($24/mo), Otter.ai Pro ($17/mo), and Riverside.fm ($24/mo)',
  'literal-storyboard': 'Boords ($29–$120/mo), Storyboard That ($15/mo), and Milanote ($10/user/mo)',
  'gemini-japanese': 'Duolingo Super ($12.99/mo), WaniKani ($9/mo), and Rosetta Stone ($12/mo)',
  'genshinwallcraft': 'Wallpaper Engine (paid) and subscription-gated HD wallpaper galleries',
  'country-sdg': 'Corporate ESG tracking software and S&P Global / Refinitiv sustainability dashboards ($$$$)',
  'discord-server-bot': 'Statbot Premium, Carl-bot paid tiers, and commercial Discord bot subscriptions',
  'nevatal-cloud': 'DigitalOcean Droplets, AWS Lightsail, and commercial cloud VM portals',
  'ai-systems-portfolio': 'Proprietary enterprise AI defense suites and commercial LLM security firewalls',
  'whatsapp-api-channel': 'Twilio WhatsApp API ($$$ per conversation), MessageBird, and commercial WhatsApp Business BSP solutions',
  'decalove': 'NovelAI ($10–$25/mo), AI Dungeon ($15–$30/mo), Character.ai, and proprietary commercial visual novel game engines',
  'leetbug': 'LeetCode Premium ($35/mo), HackerRank, CodeSignal assessments, and proprietary developer screening portals',
  'quanta': 'Coursera / edX financial engineering courses ($40–$80/mo), Wall Street Prep ($499+), and Bloomberg Terminal / TradingView paid subscriptions ($15–$60/mo)',
  'wordpress-automation': 'Jasper AI ($49–$125/mo), SurferSEO ($89/mo), and commercial automated WordPress autoblogging tools'
};

function getPopularAlternatives(project) {
  if (project?.id && POPULAR_ALTERNATIVES_MAP[project.id]) {
    return POPULAR_ALTERNATIVES_MAP[project.id];
  }
  return `expensive commercial and subscription-based ${project?.category || 'software'} platforms`;
}

const ARTICLE_ANGLES = [
  'Architecture & Performance Benchmark',
  'Free Alternative to Popular Paid Platforms: Comprehensive Guide & Feature Breakdown',
  'Why Pay Subscriptions? A 100% Free Alternative Case Study & Deployment',
  'Comparison & Alternatives Breakdown: Free Alternative vs. Commercial Paid Tools',
  'Hands-on Tutorial: Getting Started with This Free Alternative'
];

function selectAngleForProject(existingCount) {
  return ARTICLE_ANGLES[existingCount % ARTICLE_ANGLES.length];
}

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
    .replace(/&#039;/g, "'");
}

function cleanJsonString(str) {
  let inString = false;
  let escaped = false;
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (inString) {
      if (escaped) {
        if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u'].includes(c)) {
          // Drop the invalid backslash if it's not a legal JSON escape sequence
          out = out.slice(0, -1) + c;
        } else {
          out += c;
        }
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
  // Strip illegal trailing commas
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

function closeOpenHtmlTags(html) {
  if (!html) return '';
  let clean = html.replace(/<[^>]*$/, '').trim();
  const tagStack = [];
  const tagRegex = /<\/?([a-zA-Z0-9]+)[^>]*>/g;
  let match;
  const selfClosing = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  while ((match = tagRegex.exec(clean)) !== null) {
    const fullTag = match[0];
    const tagName = match[1].toLowerCase();
    if (selfClosing.has(tagName) || fullTag.endsWith('/>')) continue;
    if (fullTag.startsWith('</')) {
      if (tagStack.length > 0 && tagStack[tagStack.length - 1] === tagName) {
        tagStack.pop();
      }
    } else {
      tagStack.push(tagName);
    }
  }
  while (tagStack.length > 0) {
    const t = tagStack.pop();
    clean += `</${t}>`;
  }
  return clean;
}

function extractArticleFieldsRegex(raw) {
  const fields = ['title', 'focus_keyphrase', 'meta_description', 'slug', 'excerpt'];
  const res = {};
  for (const key of fields) {
    const re = new RegExp(`"${key}"\\s*:\\s*"([\\s\\S]*?)(?="\\s*,\\s*"[a-zA-Z0-9_]+"|"\\s*\\})`, 'i');
    const m = raw.match(re);
    if (m && m[1]) {
      res[key] = cleanExtracted(m[1]);
    }
  }

  const chKey = '"content_html"';
  const chIdx = raw.indexOf(chKey);
  if (chIdx !== -1) {
    const afterKey = raw.slice(chIdx + chKey.length);
    const firstQuote = afterKey.indexOf('"');
    if (firstQuote !== -1) {
      let html = afterKey.slice(firstQuote + 1);
      html = html.replace(/"\s*\}?\s*(```)?\s*$/, '');
      html = cleanExtracted(html);
      res.content_html = closeOpenHtmlTags(html);
    }
  }

  return res;
}

function getAuthHeader() {
  if (WP_USER && WP_APP_PASSWORD) {
    const token = Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString('base64');
    return { Authorization: `Basic ${token}` };
  }
  return {};
}

// In-memory caches to prevent redundant API queries and term_exists 400 errors
const categoryCache = new Map();
const tagCache = new Map();

// REST helper with timeout and detailed error encapsulation
async function wpRequest(endpoint, { method = 'GET', body = null, query = {}, timeoutMs = 60000 } = {}) {
  const url = new URL(`${WP_BASE_URL}/wp-json/wp/v2${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`);
  Object.entries(query).forEach(([k, v]) => url.searchParams.append(k, v));

  const headers = {
    Accept: 'application/json',
    ...getAuthHeader(),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const options = { method, headers, signal: controller.signal };
  if (body) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(url, options);
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (e) {
      json = { raw: text };
    }

    if (!res.ok) {
      const err = new Error(`WordPress API Error (${res.status}): ${JSON.stringify(json)}`);
      err.status = res.status;
      err.data = json;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

// Preload existing categories to avoid redundant POSTs and 400 term_exists collisions
async function preloadCategories() {
  try {
    const categories = await wpRequest('/categories', { query: { per_page: 100 } });
    if (Array.isArray(categories)) {
      for (const cat of categories) {
        const decodedName = decodeHtmlEntities(cat.name).trim().toLowerCase();
        categoryCache.set(decodedName, cat.id);
        categoryCache.set(cat.slug.toLowerCase(), cat.id);
      }
    }
  } catch (err) {
    console.warn('[Category Cache] Warning preloading categories:', err.message);
  }
}

// Get or create category with term_id extraction on 400 conflict
async function ensureCategory(name) {
  if (!name) return null;
  const normalized = decodeHtmlEntities(name).trim().toLowerCase();
  if (categoryCache.has(normalized)) {
    return categoryCache.get(normalized);
  }

  try {
    const existing = await wpRequest('/categories', { query: { search: name, per_page: 20 } });
    const match = existing.find((c) => decodeHtmlEntities(c.name).toLowerCase() === normalized);
    if (match) {
      categoryCache.set(normalized, match.id);
      return match.id;
    }

    const created = await wpRequest('/categories', {
      method: 'POST',
      body: { name, description: `Articles and technical guides related to ${name}` },
    });
    categoryCache.set(normalized, created.id);
    return created.id;
  } catch (err) {
    const errStr = JSON.stringify(err.data || err.message || '');
    const match = errStr.match(/"term_id":\s*(\d+)/);
    if (match) {
      const termId = parseInt(match[1], 10);
      categoryCache.set(normalized, termId);
      return termId;
    }
    console.warn(`[Category] Warning ensuring category "${name}":`, err.message);
    return null;
  }
}

// Get or create tag with term_id extraction on 400 conflict
async function ensureTag(name) {
  if (!name) return null;
  const normalized = decodeHtmlEntities(name).trim().toLowerCase();
  if (tagCache.has(normalized)) {
    return tagCache.get(normalized);
  }

  try {
    const existing = await wpRequest('/tags', { query: { search: name, per_page: 20 } });
    const match = existing.find((t) => decodeHtmlEntities(t.name).toLowerCase() === normalized);
    if (match) {
      tagCache.set(normalized, match.id);
      return match.id;
    }

    const created = await wpRequest('/tags', {
      method: 'POST',
      body: { name },
    });
    tagCache.set(normalized, created.id);
    return created.id;
  } catch (err) {
    const errStr = JSON.stringify(err.data || err.message || '');
    const match = errStr.match(/"term_id":\s*(\d+)/);
    if (match) {
      const termId = parseInt(match[1], 10);
      tagCache.set(normalized, termId);
      return termId;
    }
    console.warn(`[Tag] Warning ensuring tag "${name}":`, err.message);
    return null;
  }
}

// Fetch all existing posts across all pagination pages
async function fetchExistingPosts() {
  const allPosts = [];
  let page = 1;
  while (true) {
    try {
      const posts = await wpRequest('/posts', {
        query: { per_page: 100, page: page, status: 'publish,draft,pending,future' }
      });
      if (!Array.isArray(posts) || posts.length === 0) break;
      allPosts.push(...posts);
      if (posts.length < 100) break;
      page++;
    } catch (err) {
      if (err.status === 400) break; // Out of pages
      console.warn(`[Posts] Warning fetching posts page ${page}:`, err.message);
      break;
    }
  }
  return allPosts;
}

// Comprehensive matching function checking title, slug, project ID, and Yoast focus keywords
function isPostMatchingProject(post, project) {
  const decodedTitle = decodeHtmlEntities(post.title?.rendered || '').toLowerCase();
  const slug = (post.slug || '').toLowerCase();
  const projName = project.name.toLowerCase();
  const projId = project.id.toLowerCase();
  const projIdNoHyphen = projId.replace(/-/g, '');

  if (project.id === 'nevatal') {
    if (
      slug.includes('cloud') ||
      slug.includes('url') ||
      slug.includes('defense') ||
      decodedTitle.includes('nevatal cloud') ||
      decodedTitle.includes('url shortener') ||
      decodedTitle.includes('defense-in-depth')
    ) {
      return false;
    }
  }

  if (decodedTitle.includes(projName)) return true;
  if (slug.includes(projId) || slug.includes(projIdNoHyphen)) return true;

  const mainIdentifier = project.name.split(/[-–—:]/)[0].trim().toLowerCase();
  if (mainIdentifier.length > 3 && decodedTitle.includes(mainIdentifier)) return true;

  if (post.meta && post.meta._yoast_wpseo_focuskw) {
    const focusKw = post.meta._yoast_wpseo_focuskw.toLowerCase();
    if (project.focus_keywords && project.focus_keywords.some((k) => k.toLowerCase() === focusKw)) {
      return true;
    }
  }

  if (project.focus_keywords && project.focus_keywords.some((k) => decodedTitle.includes(k.toLowerCase()))) {
    return true;
  }

  return false;
}

function buildInternalLinksBox(projectId) {
  try {
    const logPath = path.resolve(__dirname, '../articles_log.json');
    if (!fs.existsSync(logPath)) return '';
    const log = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    const candidates = [];
    for (const entry of log) {
      for (const item of entry.results || []) {
        if (item.post_id && item.link && item.title) {
          candidates.push(item);
        }
      }
    }
    if (candidates.length === 0) return '';

    const sameProj = candidates.filter((c) => c.project === projectId);
    const selected = [];
    if (sameProj.length > 0) {
      selected.push(sameProj[Math.floor(Math.random() * sameProj.length)]);
      if (sameProj.length > 1) {
        const remaining = sameProj.filter((s) => s.post_id !== selected[0].post_id);
        if (remaining.length > 0) {
          selected.push(remaining[Math.floor(Math.random() * remaining.length)]);
        }
      }
    }

    const other = candidates.filter((c) => c.project !== projectId && !selected.some((s) => s.post_id === c.post_id));
    while (selected.length < 3 && other.length > 0) {
      const idx = Math.floor(Math.random() * other.length);
      selected.push(other.splice(idx, 1)[0]);
    }

    if (selected.length === 0) return '';

    const items = selected
      .map((s) => {
        const cleanTitle = (s.title || '')
          .replace(/&#038;/g, '&')
          .replace(/&#8211;/g, '–')
          .replace(/&#8217;/g, "'")
          .replace(/&#8220;/g, '"')
          .replace(/&#8221;/g, '"')
          .replace(/&amp;/g, '&');
        return `    <li><a href="${s.link}">${cleanTitle}</a></li>`;
      })
      .join('\n');

    return `\n<div class="related-articles-box" style="background:#f8fafc; border:1px solid #e2e8f0; border-left:4px solid #0284c7; padding:16px 20px; margin:28px 0; border-radius:6px;">
  <h3 style="margin-top:0; color:#0f172a; font-size:1.15rem;">Related Technical Guides & Platform Architecture</h3>
  <p style="margin-bottom:12px; color:#475569; font-size:0.95rem;">Explore related articles, system benchmarks, and hands-on tutorials across the Nevatal platform:</p>
  <ul style="margin:0; padding-left:20px; line-height:1.7;">
${items}
  </ul>
</div>\n`;
  } catch (e) {
    return '';
  }
}

// Robust helper to dynamically load PRD and Architecture markdown specifications from archive folder
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

  // If no files found from explicit references, attempt exact/fuzzy discovery in archiveDir
  if (filesToRead.size === 0 && project.id) {
    try {
      const allFiles = fs.readdirSync(archiveDir);
      const projClean = project.id.toLowerCase().replace(/[^a-z0-9]/g, '');

      // Check for exact matching PRD
      const matchedPrd = allFiles.find((f) => {
        if (!f.toLowerCase().endsWith('_prd.md') && !f.toLowerCase().endsWith('-prd.md')) return false;
        const fileClean = f.replace(/[_.-]prd\.md$/i, '').toLowerCase().replace(/[^a-z0-9]/g, '');
        return fileClean === projClean;
      }) || allFiles.find((f) => {
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
    } catch (e) {
      // Ignore directory read errors
    }
  }

  let combined = '';
  for (const fpath of filesToRead) {
    try {
      let content = fs.readFileSync(fpath, 'utf8');
      const filename = path.basename(fpath);
      const isPrd = filename.toLowerCase().includes('prd');
      const docHeader = isPrd
        ? `AUTHORITATIVE PRODUCT REQUIREMENTS DOCUMENT (PRD - UPDATED SOURCE OF TRUTH: ${filename})`
        : `SYSTEM ARCHITECTURE SPECIFICATION (FROM ARCHIVE: ${filename})`;

      // Cap exceptionally large documents at 2,500 chars for LLM context window & token efficiency while preserving core specs
      if (content.length > 2500) {
        content = content.slice(0, 2500) + '\n\n[... Remaining sections truncated for LLM context window optimization; core PRD specifications preserved above ...]';
      }

      combined += `\n\n================================================================================\n${docHeader}\n================================================================================\n${content}\n`;
    } catch (err) {
      console.warn(`[Archive] Could not read ${fpath}:`, err.message);
    }
  }
  if (combined.length > 5000) {
    combined = combined.slice(0, 5000) + '\n\n[... Remaining PRD context truncated ...]';
  }
  return combined;
}

// Safely get valid project live URL, fallback to nevatal.id
function getValidProjectUrl(project) {
  if (project && typeof project.url === 'string' && /^https?:\/\//i.test(project.url.trim())) {
    return project.url.trim();
  }
  return 'https://nevatal.id';
}

// Sanitize HTML content to fix malformed URLs, LLM hallucinations, and placeholder links
function sanitizeArticleHtml(html, project) {
  if (!html || typeof html !== 'string') return html;
  const validTargetUrl = getValidProjectUrl(project);

  // 1. Fix common full-width and hallucinated characters in URLs (e.g., https，和cloud... or https：//)
  let cleaned = html.replace(/href=["']https?(?:[，,和\s]+|：\/?\/?)([^"'>\s]+)["']/gi, (match, domain) => {
    const cleanDomain = domain.replace(/^[，,和：:\s/]+/, '');
    return `href="https://${cleanDomain}"`;
  });

  // 2. Fix placeholders like href="Internal Deployment", href="Internal OpenClaw Gateway", href="[...]"
  cleaned = cleaned.replace(/href=["'](?:Internal\s+[^"'>]+|\[[^"'>]+\])["']/gi, `href="${validTargetUrl}"`);

  // 3. Fix empty anchors: <a href=""[^>]*>\s*<\/a> -> fill anchor text
  cleaned = cleaned.replace(/<a\s+([^>]*?)href=["'](?:#|\s*)["']([^>]*?)>\s*<\/a>/gi, `<a $1href="${validTargetUrl}"$2>${validTargetUrl}</a>`);

  // 4. Fix remaining empty hrefs
  cleaned = cleaned.replace(/href=["'](?:#|\s*)["']/gi, `href="${validTargetUrl}"`);

  // 5. Catch any relative href that is neither an anchor hash nor a root-relative path
  cleaned = cleaned.replace(/<a\s+([^>]*?)href=["']([^"'>]+)["']([^>]*)>/gi, (match, pre, href, post) => {
    const trimmedHref = href.trim();
    if (/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(trimmedHref)) {
      return match;
    }
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(trimmedHref)) {
      return `<a ${pre}href="https://${trimmedHref}"${post}>`;
    }
    return `<a ${pre}href="${validTargetUrl}"${post}>`;
  });

  return cleaned;
}

// Call OpenRouter LLM with fallback models
async function generateArticleWithAI(project, angle = 'Comprehensive Guide & Technical Deep-Dive') {
  console.log(`\n[AI] Generating SEO article for "${project.name}" (Angle: ${angle})...`);

  // Dynamically load fresh archive markdown context (PRD + Architecture) directly from archive folder
  const archiveContext = getArchiveContextForProject(project);
  if (archiveContext) {
    console.log(`[Archive] Ingested authoritative PRD/Architecture specification from archive folder for "${project.id}".`);
  }

  const isArchitecturePost = angle.toLowerCase().includes('architecture');
  const popularAlternatives = getPopularAlternatives(project);
  const liveProjectUrl = getValidProjectUrl(project);

  const prompt = `You are a world-class senior technical copywriter, software architect, and SEO content strategist.
Write a comprehensive, authoritative, engaging, and search-engine-optimized article about the following software project.

CRITICAL ARCHIVE PRD GROUNDING REQUIREMENT:
The project specification provided below from the archive folder is the newly updated, authoritative single source of truth for ${project.name}.
You MUST ground every section of your article (all technical architecture, core features, latest modules, real-world use cases, problems solved, workflows, and performance metrics) strictly in this PRD.
Do NOT rely on outdated assumptions, generic boilerplate, or invent features not documented in the PRD. Every key capability and innovation described in the PRD must be accurately reflected.
Write a comprehensive, authoritative, engaging, and search-engine-optimized article about the following software project.

EDITORIAL ANGLE / FOCUS FOR THIS ARTICLE:
"${angle}"
${isArchitecturePost ? `
CORE THEME: ARCHITECTURAL BLUEPRINT & PERFORMANCE BENCHMARKS
- This article is dedicated to the deep technical architecture, system design, data flows, database/cache layers, and performance benchmarks of ${project.name}.
` : `
CORE THEME: 100% FREE ALTERNATIVE TO EXPENSIVE COMMERCIAL / POPULAR TOOLS
- This article MUST prominently position and celebrate ${project.name} as a premier, 100% FREE alternative to the popular commercial/proprietary paid software in this category (specifically contrasting against ${popularAlternatives}).
- Emphasize the massive cost savings ($0 vs $20–$100+/month subscription fees), absence of paywalls, no credit card required, full data privacy/ownership, and developer control.
- Highlight the "Why Pay?" value proposition: why developers and teams don't need to pay hundreds of dollars per year for closed SaaS when ${project.name} delivers production-grade capabilities completely free.
${project.id === 'recommendica' ? `
CRITICAL FOCUS FOR RECOMMENDICA:
- Recommendica is an all-in-one free academic workstation, NOT just an arXiv paper search engine.
- You MUST prominently feature and explain its three core pillars:
  1. BUILT-IN FREE LATEX DOCUMENT COMPILER: Highlight it as a premier 100% free alternative to Overleaf Premium ($15–$40/month). Users can write, paste, and compile LaTeX research papers online into production-ready PDFs with instant preview, no compilation timeout limits, and zero paywalled exports.
  2. INTEGRATED FREE ACADEMIC COURSES: Feature the structured educational courses and curriculum for computer science, AI, and mathematics, saving users from expensive platforms like Coursera or edX ($40–$80/month).
  3. AGENTIC ARXIV PAPER DISCOVERY: Explain how its multi-turn Relevance Agent and live arXiv API fallback find and grade papers without hallucinations, replacing paid research tools like Scite.ai or Consensus.
- In the Head-to-Head Comparison table, include rows comparing: "Built-in Online LaTeX Compiler", "Academic Courses & Study Modules", "Live arXiv Research Paper Recommender", and "Monthly Cost ($0 Free vs $15–$80/mo Overleaf/Coursera/Scite)".
` : ''}
`}

PROJECT DETAILS:
- Name: ${project.name}
- Tagline/Description: ${project.short_description}
- Category: ${project.category}
- Tech Stack: ${project.tech_stack.join(', ')}
- Key Features:
${project.key_features.map((f) => `  * ${f}`).join('\n')}
- Real-World Use Cases:
${project.use_cases.map((u) => `  * ${u}`).join('\n')}
- Live URL: ${liveProjectUrl}
- GitHub: ${project.github || 'Private / Internal'}
- Primary Focus Keywords: ${project.focus_keywords.join(', ')}${archiveContext ? `\n\nARCHITECTURAL SPECIFICATIONS & PRD CONTEXT (FROM ARCHIVE):\n${archiveContext}` : ''}

ARTICLE GOALS & SEO REQUIREMENTS:
1. Length: Comprehensive article (~700 to 1,000 words). Must be punchy and complete. Ensure your output is complete, valid JSON that terminates cleanly with the closing brace '}' without truncation.
2. Tone: Authoritative, engaging, technical yet accessible to developers, architects, and tech enthusiasts.
3. Structure:
${isArchitecturePost ? `   - High-impact H1 Title reflecting the chosen editorial angle ("${angle}") and containing the primary focus keyword.
   - Compelling Introduction with a Key Takeaways Callout box (<div class="callout" style="background:#f0f9ff; border-left:4px solid #0284c7; padding:15px; margin:20px 0; border-radius:4px;">...</div>).
   - "The Engineering Challenge: Why ${project.name} Was Architected" (H2)
   - "Core Architecture & Technical Stack Deep-Dive" (H2 & H3s)
   - "Key Features Breakdown & Practical Benefits" (H2 & H3s)
   - "Real-World Deployment & Production Topology" (H2)
   - "Data Flow & How It Works: Step-by-Step Workflow" (H2)
   - "Architectural Comparison: ${project.name} vs Traditional Approaches" (H2, with a clean HTML <table>)
   - "Frequently Asked Questions (FAQ)" (H2, with 4-5 high-value questions and answers formatted for FAQ schema)
   - "Conclusion & Next Steps" (H2 with clear Call to Action and explicit live project URL)` : `   - High-impact H1 Title clearly positioning ${project.name} as a premier Free Alternative to popular commercial tools (e.g. "${project.name}: The Best Free Alternative to [Popular Tool]", "Why Pay for [Popular Tool]? Try ${project.name} for Free", or "${project.name}: A Powerful 100% Free Alternative to Expensive [Category] Software") containing the primary focus keyword.
   - Compelling Introduction calling out the pain of expensive subscriptions, vendor lock-in, and tiered paywalls in commercial tools (${popularAlternatives}), with a Key Takeaways Callout box (<div class="callout" style="background:#f0f9ff; border-left:4px solid #0284c7; padding:15px; margin:20px 0; border-radius:4px;">...</div>) highlighting that ${project.name} is 100% free with zero paywalls.
   - "The Problem with Popular Commercial Tools: Expensive Subscriptions & Paywalls" (H2 - breaking down the high monthly costs and restrictions of ${popularAlternatives})
   - "Introducing ${project.name}: A Production-Grade Free Alternative" (H2 - why it was built to democratize access without subscription fees)
   - "Head-to-Head Comparison: ${project.name} vs. Popular Commercial Paid Tools" (H2, with a comprehensive, clean HTML <table> comparing ${project.name} [$0 / 100% Free / Full Ownership] against ${popularAlternatives} [$XX/month / Proprietary / Locked Features]. Compare: Pricing, Key Capabilities, Paywalls/Limits, and Data Privacy)
   - "Core Features You Get Completely Free" (H2 & H3s - practical breakdown of capabilities available at zero cost)
   - "Real-World Use Cases: How Users Save Money with This Free Alternative" (H2)
   - "Step-by-Step Guide: How to Get Started with This Free Alternative" (H2 - step-by-step instructions for using the live platform at ${liveProjectUrl})
   - "Frequently Asked Questions (FAQ)" (H2, with 4-5 high-value questions and answers formatted for FAQ schema addressing: Is it really 100% free? Are there hidden paywalls? How does it compare to paid alternatives? What about performance?)
   - "Conclusion & Next Steps" (H2 with clear Call to Action to explore and use the free tool, with explicit live project URL)`}
4. MANDATORY EXPLICIT PROJECT URL REQUIREMENT:
   - You MUST explicitly include the live project URL (${liveProjectUrl}) as an explicit, clickable anchor link (<a href="${liveProjectUrl}">${liveProjectUrl}</a>) in BOTH:
     (1) The introductory section (or inside/immediately following the Key Takeaways callout box), e.g. <div class="project-access-box" style="background:#f0f9ff; border:1px solid #bae6fd; border-left:4px solid #0284c7; padding:12px 18px; margin:20px 0; border-radius:4px;"><strong>Live Project Access:</strong> <a href="${liveProjectUrl}" target="_blank" rel="noopener noreferrer">${liveProjectUrl}</a></div>
     (2) The "Conclusion & Next Steps" section with an explicit link to <a href="${liveProjectUrl}">${liveProjectUrl}</a>.
   - CRITICAL URL INTEGRITY: You MUST ONLY use valid, absolute "https://" URLs. Never output placeholder strings, internal notes, fullwidth punctuation, or relative paths in href attributes.
5. Format: Semantic HTML (using <h2>, <h3>, <p>, <ul>, <li>, <code>, <pre>, <blockquote>, <table>). Do NOT include <html>, <head>, or <body> tags.
6. Yoast SEO fields:
   - Focus Keyphrase (3-5 words, exact phrase from project keywords)
   - SEO Title (Catchy, 50-60 characters, with keyword)
   - Meta Description (145-158 characters, active voice, high CTR with call to action)

OUTPUT FORMAT:
Return ONLY valid JSON matching this schema:
{
  "title": "Article Title with Focus Keyword",
  "focus_keyphrase": "exact primary keyword",
  "meta_description": "150-char meta description for Google SERP snippet.",
  "slug": "seo-friendly-url-slug",
  "excerpt": "2-3 sentence summary excerpt.",
  "content_html": "<p>Article HTML content...</p>"
}`;

  let lastError = null;
  const modelsToTry = getCandidateModels();

  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];
    const isFreeModel = model.endsWith(':free') || model === 'openrouter/free';

    // If credits/tokens are depleted (402 received), skip any remaining paid models
    if (globalCreditsDepleted && !isFreeModel) {
      console.warn(`[AI] Skipping paid model ${model} because credits are depleted.`);
      continue;
    }

    try {
      console.log(`[AI] Attempting generation with model: ${model}...`);
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://wordpress.nevatal.id',
          'X-Title': 'Nevatal WordPress SEO Auto-Publisher',
        },
        body: JSON.stringify({
          model: model,
          messages: [
            {
              role: 'system',
              content: 'You are an expert technical SEO author. Do NOT output reasoning or thinking tokens. Output only valid, parseable JSON with no Markdown backtick wrappers.',
            },
            { role: 'user', content: prompt },
          ],
          max_tokens: 2500,
          temperature: 0.7,
          reasoning: { effort: 'none' },
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        const errText = await response.text();
        if (isCreditOr402Error(response.status, errText)) {
          globalCreditsDepleted = true;
          console.warn(`[AI] Error 402 (Payment Required / Credits exhausted) on ${model}. Automatically falling back to free models pool...`);
        }
        throw new Error(`OpenRouter Error (${response.status}): ${errText}`);
      }

      const data = await response.json();
      if (data.error) {
        const errMsg = data.error.message || JSON.stringify(data.error);
        if (isCreditOr402Error(data.error.code, errMsg)) {
          globalCreditsDepleted = true;
          console.warn(`[AI] Error 402 (Payment Required / Credits exhausted) for model ${model}. Automatically falling back to free models pool...`);
        }
        throw new Error(`OpenRouter Provider Error (${data.error.code || 'unknown'}): ${errMsg}`);
      }
      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error(`Invalid OpenRouter response format: ${JSON.stringify(data)}`);
      }
      const contentStr = data.choices[0].message.content;
      if (!contentStr || typeof contentStr !== 'string') {
        console.warn(`[AI Debug] Choice[0] content missing! Full choice:`, JSON.stringify(data.choices[0]));
        throw new Error('Empty or non-string response content from model');
      }
      const rawContent = contentStr.trim();
      const unescapedFence = rawContent.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      console.log(`[AI] Response length: ${rawContent.length} chars. Start: ${rawContent.slice(0, 100)}... End: ...${rawContent.slice(-100)}`);
      
      let parsed = null;
      const jsonMatch = unescapedFence.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch (parseErr) {
          try {
            parsed = JSON.parse(cleanJsonString(jsonMatch[0]));
          } catch (cleanErr) {
            console.log(`[AI] JSON parse failed (${cleanErr.message}), trying regex extraction...`);
            parsed = extractArticleFieldsRegex(rawContent);
          }
        }
      } else {
        console.log(`[AI] No complete JSON object brace match, trying regex extraction...`);
        parsed = extractArticleFieldsRegex(rawContent);
      }
      parsed = deepCleanStrings(parsed);
      console.log(`[AI] Parsed fields:`, Object.keys(parsed || {}).filter(k => parsed[k]));

      if (!parsed || !parsed.title || !parsed.content_html) {
        throw new Error('Incomplete JSON returned from model');
      }

      // Sanitize all anchor links and URLs in content_html to prevent broken relative links or LLM hallucinations
      parsed.content_html = sanitizeArticleHtml(parsed.content_html, project);

      // Safeguard: Ensure the explicit project URL is present in content_html
      if (liveProjectUrl && !parsed.content_html.includes(liveProjectUrl)) {
        const liveBox = `\n<div class="project-access-box" style="background:#f0f9ff; border:1px solid #bae6fd; border-left:4px solid #0284c7; padding:12px 18px; margin:20px 0; border-radius:4px;"><strong>Live Project Access:</strong> <a href="${liveProjectUrl}" target="_blank" rel="noopener noreferrer">${liveProjectUrl}</a></div>\n`;
        if (parsed.content_html.includes('</div>')) {
          parsed.content_html = parsed.content_html.replace('</div>', `</div>${liveBox}`);
        } else {
          parsed.content_html = `${liveBox}${parsed.content_html}`;
        }
      }

      // Safeguard: Ensure outgoing internal links (backlinks) are present in content_html
      if (!parsed.content_html.includes('related-articles-box')) {
        const relatedBox = buildInternalLinksBox(project.id);
        if (relatedBox) {
          const conclusionRegex = /(<h2[^>]*>\s*(?:Conclusion|Next Steps|Summary)[\s\S]*?<\/h2>)/i;
          if (conclusionRegex.test(parsed.content_html)) {
            parsed.content_html = parsed.content_html.replace(conclusionRegex, `${relatedBox}$1`);
          } else {
            parsed.content_html = `${parsed.content_html}\n${relatedBox}`;
          }
        }
      }

      console.log(`[AI] Successfully generated article using ${model}!`);
      return parsed;
    } catch (err) {
      console.warn(`[AI] Model ${model} failed (${err.message}), trying next model...`);
      lastError = err;
    }
  }

  throw new Error(`All fallback models failed. Last error: ${lastError ? lastError.message : 'Unknown'}`);
}

// -------------------------------------------------------------
// Live Web Screenshot Capture & WordPress Media Upload Engine
// -------------------------------------------------------------

// Capture live web screenshot of the project URL with multi-layer fallback
async function captureProjectWebScreenshot(project) {
  const screenshotsDir = path.resolve(__dirname, '../screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const targetUrl = getValidProjectUrl(project);
  const projectId = (project?.id || 'project').toLowerCase();
  const projectName = project?.name || projectId;
  const timestamp = Date.now();
  const filename = `${projectId}_web_${timestamp}.png`;
  const outputPath = path.resolve(screenshotsDir, filename);

  console.log(`[Screenshot] Capturing live web screenshot for "${projectName}" (${targetUrl})...`);

  // Layer 1: Headless Chromium via Playwright in official Docker container with host network
  try {
    const tmpHost = `/tmp/snap_wp_${projectId}_${timestamp}.png`;
    const nodeModules = path.resolve(__dirname, '../node_modules');
    const captureScript = path.resolve(__dirname, 'web-screenshot-capture.js');

    const dockerCmd = `docker run --rm --network host --user 1000:1000 -v /tmp:/tmp -e HOME=/tmp -e NODE_PATH=/opt/pw/node_modules -v "${nodeModules}:/opt/pw/node_modules:ro" -v "${captureScript}:/opt/capture.js:ro" mcr.microsoft.com/playwright:v1.64.1-noble node /opt/capture.js "${targetUrl}" "${tmpHost}"`;

    execSync(dockerCmd, { encoding: 'utf8', timeout: 50000 });

    if (fs.existsSync(tmpHost) && fs.statSync(tmpHost).size > 1000) {
      fs.copyFileSync(tmpHost, outputPath);
      try { fs.unlinkSync(tmpHost); } catch (e) {}
      const sizeKb = (fs.statSync(outputPath).size / 1024).toFixed(1);
      console.log(`[Screenshot] ✅ Captured via Playwright: ${outputPath} (${sizeKb} KB)`);
      return { path: outputPath, filename, url: targetUrl };
    }
  } catch (err) {
    console.warn(`[Screenshot] Playwright capture notice (${err.message.split('\n')[0]}). Trying cloud Microlink API...`);
  }

  // Layer 2: Fast cloud screenshot API fallback (Microlink)
  try {
    const apiUrl = `https://api.microlink.io/?url=${encodeURIComponent(targetUrl)}&screenshot=true&embed=screenshot.url&viewport.width=1280&viewport.height=800`;
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(20000) });
    if (res.ok) {
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > 1000) {
        fs.writeFileSync(outputPath, buffer);
        const sizeKb = (buffer.length / 1024).toFixed(1);
        console.log(`[Screenshot] ✅ Captured via Microlink cloud API: ${outputPath} (${sizeKb} KB)`);
        return { path: outputPath, filename, url: targetUrl };
      }
    }
  } catch (err) {
    console.warn(`[Screenshot] Microlink fallback failed: ${err.message}`);
  }

  // Layer 3: Cache lookup from existing screenshots directory
  try {
    const existingFiles = fs.readdirSync(screenshotsDir);
    const cachedFile = existingFiles.find(
      (f) => f.startsWith(`${projectId}_`) && (f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg'))
    );
    if (cachedFile) {
      const cachedPath = path.resolve(screenshotsDir, cachedFile);
      console.log(`[Screenshot] ℹ️ Using existing cached screenshot: ${cachedPath}`);
      return { path: cachedPath, filename: cachedFile, url: targetUrl };
    }
  } catch (err) {
    console.warn(`[Screenshot] Cache search failed: ${err.message}`);
  }

  console.warn(`[Screenshot] ⚠️ Could not capture or find screenshot for ${projectName} (${targetUrl}).`);
  return null;
}

// Upload screenshot buffer to WordPress Media Library via REST API
async function uploadScreenshotToWordPress(screenshotPath, project, articleData = {}) {
  if (!fs.existsSync(screenshotPath)) {
    throw new Error(`Screenshot file not found: ${screenshotPath}`);
  }

  const fileBuffer = fs.readFileSync(screenshotPath);
  const ext = path.extname(screenshotPath).toLowerCase();
  const contentType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
  const cleanId = (project?.id || 'project').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const uploadFilename = `${cleanId}-screenshot-${Date.now()}${ext || '.png'}`;

  const projectName = project?.name || cleanId;
  const validUrl = getValidProjectUrl(project);

  console.log(`[WordPress Media] Uploading screenshot to WordPress library (${(fileBuffer.length / 1024).toFixed(1)} KB)...`);

  const uploadUrl = new URL(`${WP_BASE_URL}/wp-json/wp/v2/media`);
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      ...getAuthHeader(),
      'Content-Disposition': `attachment; filename="${uploadFilename}"`,
      'Content-Type': contentType,
    },
    body: fileBuffer,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`WordPress media upload failed (${uploadRes.status}): ${errText}`);
  }

  const media = await uploadRes.json();
  const mediaId = media.id;
  const sourceUrl = media.source_url || media.guid?.rendered || '';

  // Update media SEO attributes (title, alt_text, caption, description)
  const mediaTitle = `${projectName} - Live Web Platform Screenshot`;
  const altText = `Live web application screenshot and interface of ${projectName}`;
  const caption = `Live screenshot of ${projectName} accessible at ${validUrl}`;
  const description = `Live web platform screenshot of ${projectName} (${validUrl}) for technical documentation, architecture analysis, and platform overview.`;

  try {
    const updateUrl = new URL(`${WP_BASE_URL}/wp-json/wp/v2/media/${mediaId}`);
    await fetch(updateUrl, {
      method: 'POST',
      headers: {
        ...getAuthHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: mediaTitle,
        alt_text: altText,
        caption: caption,
        description: description,
      }),
    });
  } catch (metaErr) {
    console.warn(`[WordPress Media] Warning updating metadata for Media #${mediaId}: ${metaErr.message}`);
  }

  return {
    id: mediaId,
    source_url: sourceUrl,
    alt: altText,
    caption: caption,
  };
}

// Embed the captured screenshot into the article's HTML content
function embedScreenshotInHtml(html, mediaUpload, project) {
  if (!html || !mediaUpload || !mediaUpload.source_url) return html;

  // Avoid duplicate injection
  if (html.includes(mediaUpload.source_url) || html.includes('project-web-screenshot')) {
    return html;
  }

  const validUrl = getValidProjectUrl(project);
  const altText = mediaUpload.alt || `Live screenshot of ${project.name || 'Project'}`;
  const figureHtml = `
<figure class="wp-block-image size-large project-web-screenshot" style="margin:28px 0; text-align:center;">
  <a href="${validUrl}" target="_blank" rel="noopener noreferrer">
    <img src="${mediaUpload.source_url}" alt="${altText}" class="wp-image-${mediaUpload.id}" style="border-radius:8px; border:1px solid #cbd5e1; box-shadow:0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1); max-width:100%; height:auto;" />
  </a>
  <figcaption style="margin-top:10px; font-size:0.92rem; color:#64748b; font-style:italic;">Live web application interface of <strong>${project.name || 'the platform'}</strong> (<a href="${validUrl}" target="_blank" rel="noopener noreferrer">${validUrl}</a>)</figcaption>
</figure>
`;

  // 1. Insert directly after .project-access-box if present
  const accessBoxRegex = /(<div[^>]*class=["'][^"']*project-access-box[^"']*["'][^>]*>[\s\S]*?<\/div>)/i;
  if (accessBoxRegex.test(html)) {
    return html.replace(accessBoxRegex, `$1\n${figureHtml}`);
  }

  // 2. Insert directly after .callout box if present
  const calloutRegex = /(<div[^>]*class=["'][^"']*callout[^"']*["'][^>]*>[\s\S]*?<\/div>)/i;
  if (calloutRegex.test(html)) {
    return html.replace(calloutRegex, `$1\n${figureHtml}`);
  }

  // 3. Insert after the first H2's introductory paragraph
  const firstH2ParaRegex = /(<h2[^>]*>[\s\S]*?<\/h2>\s*<p>[\s\S]*?<\/p>)/i;
  if (firstH2ParaRegex.test(html)) {
    return html.replace(firstH2ParaRegex, `$1\n${figureHtml}`);
  }

  // 4. Prepend before the first H2
  const firstH2Regex = /(<h2[^>]*>)/i;
  if (firstH2Regex.test(html)) {
    return html.replace(firstH2Regex, `${figureHtml}\n$1`);
  }

  return `${figureHtml}\n${html}`;
}

// Publish article to WordPress with automatic web screenshot attachment
async function publishArticle(project, articleData, status = 'publish', options = {}) {
  console.log(`[WordPress] Publishing article "${articleData.title}"...`);

  // Final URL sanitization before sending to WordPress
  articleData.content_html = sanitizeArticleHtml(articleData.content_html, project);

  // 1. Automatic Live Web Screenshot Capture & Upload
  let mediaUpload = null;
  if (!options.skipScreenshot) {
    try {
      console.log(`[Screenshot] Initiating live web screenshot capture for ${project.name || project.id}...`);
      const screenshot = await captureProjectWebScreenshot(project);
      if (screenshot && fs.existsSync(screenshot.path)) {
        mediaUpload = await uploadScreenshotToWordPress(screenshot.path, project, articleData);
        if (mediaUpload && mediaUpload.id) {
          console.log(`[WordPress Media] ✅ Screenshot uploaded! Media ID: ${mediaUpload.id} | URL: ${mediaUpload.source_url}`);
          // Embed screenshot into article HTML
          articleData.content_html = embedScreenshotInHtml(articleData.content_html, mediaUpload, project);
        }
      }
    } catch (shotErr) {
      console.warn(`[Screenshot] Notice: screenshot capture/upload skipped: ${shotErr.message}`);
    }
  } else {
    console.log(`[Screenshot] Screenshot capture skipped via flag.`);
  }

  const categoryId = await ensureCategory(project.category);
  const tagIds = [];
  for (const tag of project.tags || []) {
    const tid = await ensureTag(tag);
    if (tid) tagIds.push(tid);
  }

  const cleanText = (articleData.content_html || '').replace(/<[^>]*>/g, ' ');
  const wordCount = cleanText.split(/\s+/).filter(Boolean).length;
  const readingTime = Math.max(1, Math.ceil(wordCount / 220));

  const postPayload = {
    title: articleData.title,
    content: articleData.content_html,
    status: status,
    slug: articleData.slug,
    excerpt: articleData.excerpt,
    categories: categoryId ? [categoryId] : [],
    tags: tagIds,
    featured_media: mediaUpload ? mediaUpload.id : 0,
    meta: {
      _yoast_wpseo_focuskw: articleData.focus_keyphrase,
      _yoast_wpseo_metadesc: articleData.meta_description,
      _yoast_wpseo_title: articleData.title,
      _yoast_wpseo_linkdex: '72',
      _yoast_wpseo_content_score: '90',
      '_yoast_wpseo_estimated-reading-time-minutes': String(readingTime),
      _yoast_wpseo_primary_category: categoryId ? String(categoryId) : '',
    },
  };

  const createdPost = await wpRequest('/posts', {
    method: 'POST',
    body: postPayload,
  });

  if (mediaUpload && mediaUpload.id) {
    createdPost.screenshot_url = mediaUpload.source_url;
    createdPost.featured_media = mediaUpload.id;
  }

  console.log(`[Success] Post created successfully! ID: ${createdPost.id} | URL: ${createdPost.link}${createdPost.featured_media ? ` | Featured Media ID: ${createdPost.featured_media}` : ''}`);

  // Operating Rule: Every created post must automatically resave and sync with Yoast SEO immediately
  if (createdPost && createdPost.id) {
    console.log(`[Yoast SEO] Automatically resaving and syncing Post #${createdPost.id} with Yoast SEO...`);
    try {
      execSync(`docker exec wordpress php -d memory_limit=512M /var/www/html/resave-yoast-posts.php ${createdPost.id}`, { stdio: 'pipe' });
      console.log(`[Yoast SEO] ✅ Post #${createdPost.id} successfully resaved and indexed in Yoast SEO.`);
    } catch (yoastErr) {
      console.warn(`[Yoast SEO] Notice on automatic resave for Post #${createdPost.id}: ${yoastErr.message}`);
    }
  }

  return createdPost;
}

// Check Docker status for active projects
function getRunningDockerContainers() {
  try {
    const output = execSync('docker ps --format "{{.Names}}"', { encoding: 'utf8' });
    return output.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (err) {
    return [];
  }
}

// Scan archive directory for any PRD files not currently in the catalog
function autoDiscoverArchivePrds(catalog) {
  const possibleArchiveDirs = [
    path.resolve(__dirname, '../../../../archive'),
    path.resolve(process.env.HOME || '/home/thirzq', '.openclaw/archive'),
    path.resolve(__dirname, '../archive'),
  ];

  const archiveDir = possibleArchiveDirs.find((d) => fs.existsSync(d));
  if (!archiveDir) return [];

  const discovered = [];
  try {
    const files = fs.readdirSync(archiveDir);
    const prdFiles = files.filter(
      (f) => (f.endsWith('_PRD.md') || f.endsWith('-prd.md') || f.endsWith('_prd.md')) && !f.startsWith('.')
    );

    for (const prdFile of prdFiles) {
      const prdSlug = prdFile.replace(/[_.-]prd\.md$/i, '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const alreadyCataloged = catalog.projects.some((p) => {
        if (p.archive_reference && path.basename(p.archive_reference).toLowerCase() === prdFile.toLowerCase()) return true;
        const projSlug = p.id.toLowerCase().replace(/[^a-z0-9]/g, '');
        return projSlug === prdSlug || projSlug.replace(/-/g, '') === prdSlug;
      });

      if (!alreadyCataloged) {
        const fullPath = path.resolve(archiveDir, prdFile);
        const content = fs.readFileSync(fullPath, 'utf8');

        // Extract Title
        const titleMatch = content.match(/^#\s+(?:Product Requirements Document\s*(?:\(PRD\))?:\s*)?([^\n\r]+)/im);
        const rawTitle = titleMatch ? titleMatch[1].trim() : prdFile.replace(/[_.-]prd\.md$/i, '');
        const id = prdFile.replace(/[_.-]prd\.md$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');

        // Extract Live URL
        const urlMatch = content.match(/(?:Live Project URL|Live URL|URL):\s*\*?\*?\[?(https?:\/\/[^\s\)\*\]]+)/i);
        const url = urlMatch ? urlMatch[1] : '';

        // Extract GitHub
        const ghMatch = content.match(/(?:GitHub Repository|GitHub):\s*\*?\*?\[?(https?:\/\/[^\s\)\*\]]+)/i);
        const github = ghMatch ? ghMatch[1] : '';

        // Extract summary / problem / solution
        const solutionMatch = content.match(/###?\s*(?:1\.2\s*)?Solution[^\n]*\n+([\s\S]*?)(?=\n##|$)/i);
        const shortDesc = solutionMatch
          ? solutionMatch[1].replace(/[*#]/g, '').trim().split('\n')[0].slice(0, 250)
          : `${rawTitle} - discovered from ${prdFile}`;

        // Architecture counterpart
        const archFile = prdFile.replace(/_PRD\.md$/i, '_Architecture.md').replace(/-prd\.md$/i, '-architecture.md');
        const archExists = fs.existsSync(path.resolve(archiveDir, archFile));

        const newProj = {
          id: id,
          name: rawTitle,
          container_names: [],
          short_description: shortDesc,
          category: 'Software Architecture & Engineering',
          tags: [rawTitle, 'System Architecture', 'PRD Specification', 'OpenClaw'],
          focus_keywords: [rawTitle, `${rawTitle} architecture`, `${rawTitle} overview`],
          url: url,
          github: github,
          tech_stack: ['Modern Architecture', 'Docker'],
          archive_reference: `archive/${prdFile}`,
          architecture_reference: archExists ? `archive/${archFile}` : undefined,
          key_features: [
            `Detailed PRD specification in ${prdFile}`,
            archExists ? `Architectural blueprint in ${archFile}` : 'Complete production design specification'
          ],
          use_cases: ['Enterprise system design', 'Production reference implementation']
        };

        catalog.projects.push(newProj);
        discovered.push(newProj);
      }
    }
  } catch (err) {
    console.warn('[Archive Discovery] Warning scanning PRDs:', err.message);
  }

  if (discovered.length > 0) {
    const catalogPath = path.resolve(__dirname, '../project_catalog.json');
    try {
      fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2), 'utf8');
      console.log(`[Archive Discovery] Persisted ${discovered.length} newly discovered PRD project(s) to project_catalog.json.`);
    } catch (err) {
      console.warn('[Archive Discovery] Could not persist catalog:', err.message);
    }
  }

  return discovered;
}

// Main CLI logic
async function main() {
  const args = process.argv.slice(2);
  const catalogPath = path.resolve(__dirname, '../project_catalog.json');
  if (!fs.existsSync(catalogPath)) {
    console.error('Error: project_catalog.json not found!');
    process.exit(1);
  }

  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const runningContainers = getRunningDockerContainers();

  // Dynamically auto-discover any uncataloged PRDs from archive directory
  const newlyDiscovered = autoDiscoverArchivePrds(catalog);
  if (newlyDiscovered.length > 0) {
    console.log(`[Archive Discovery] Discovered ${newlyDiscovered.length} uncataloged PRD(s): ${newlyDiscovered.map((p) => p.id).join(', ')}`);
  }

  // Pre-load categories into cache
  await preloadCategories();

  if (args.includes('--resave-only') || args.includes('--resave-yoast-only')) {
    console.log('\n==========================================');
    console.log('   Executing Yoast SEO Resave Rule...');
    console.log('==========================================');
    try {
      const { execSync } = require('child_process');
      execSync('npm run resave-yoast', {
        cwd: path.resolve(__dirname, '..'),
        stdio: 'inherit'
      });
      console.log('✅ Yoast SEO resave and re-index completed successfully.');
    } catch (err) {
      console.error('❌ Yoast SEO resave error:', err.message);
      process.exit(1);
    }
    return;
  }

  if (args.includes('--list')) {
    console.log('\n=== Projects & WordPress Publication Status ===');
    const existingPosts = await fetchExistingPosts();

    catalog.projects.forEach((proj) => {
      const isRunning = proj.container_names && proj.container_names.some((c) => runningContainers.includes(c));
      const matchingPosts = existingPosts.filter((p) => isPostMatchingProject(p, proj));

      console.log(`\n• [${proj.id}] ${proj.name}`);
      console.log(`  Live URL: ${proj.url || (proj.port ? `http://localhost:${proj.port}` : 'Internal')}`);
      console.log(`  Docker status: ${isRunning ? '🟢 Running' : (proj.container_names && proj.container_names.length > 0 ? '⚪ Offline' : '☁️ Standalone / Hosted')}`);
      if (proj.archive_reference) {
        console.log(`  Archive context: 📄 ${proj.archive_reference}`);
      }
      console.log(`  Category: ${proj.category}`);
      console.log(`  Tags: ${proj.tags.join(', ')}`);
      console.log(`  Published posts: ${matchingPosts.length}`);
      matchingPosts.forEach((p) => {
        console.log(`    - ID ${p.id}: "${decodeHtmlEntities(p.title?.rendered)}" (${p.link}) [${p.status}]`);
      });
    });
    return;
  }

  let targetProjectId = null;
  const projectFlagIdx = args.indexOf('--project');
  if (projectFlagIdx !== -1 && args[projectFlagIdx + 1]) {
    targetProjectId = args[projectFlagIdx + 1];
  } else if (args[0] && !args[0].startsWith('--')) {
    targetProjectId = args[0];
  }

  const isRecentPrds = args.includes('--recent-prds') || args.includes('--new-prds') || args.includes('--new') || args.includes('--recently-added');
  const isArchiveOnly = args.includes('--archive') || args.includes('--prds');
  const publishStatus = args.find((a, i) => args[i - 1] === '--status') || 'publish';
  const isDryRun = args.includes('--dry-run');
  const isAllFlag = args.includes('--all');
  const isForceFlag = args.includes('--force');
  const forceAll = isAllFlag || isForceFlag;
  const skipScreenshot = args.includes('--no-screenshot') || args.includes('--skip-screenshot');

  let forcedAngle = null;
  const angleFlagIdx = args.indexOf('--angle');
  if (angleFlagIdx !== -1 && args[angleFlagIdx + 1]) {
    forcedAngle = args[angleFlagIdx + 1];
  } else if (args.includes('--alternative') || args.includes('--alternatives') || args.includes('--free-alternative')) {
    forcedAngle = 'Free Alternative to Popular Paid Platforms: Comprehensive Guide & Feature Breakdown';
  }

  const existingPosts = await fetchExistingPosts();

  // Handler for standalone backfill / attach screenshots to existing published posts
  if (args.includes('--attach-screenshots') || args.includes('--backfill-screenshots')) {
    console.log('\n======================================================');
    console.log('   Backfilling Screenshots on Existing WordPress Posts');
    console.log('======================================================');
    let updatedCount = 0;
    const forceReshoot = args.includes('--force-screenshots');
    const limitFlagIdx = args.indexOf('--limit');
    const maxLimit = limitFlagIdx !== -1 && args[limitFlagIdx + 1] ? parseInt(args[limitFlagIdx + 1], 10) : Infinity;
    const targetPostId = args.find((a, i) => args[i - 1] === '--post-id') || null;

    for (const post of existingPosts) {
      if (updatedCount >= maxLimit) {
        console.log(`[Limit] Reached maximum requested limit of ${maxLimit} post(s).`);
        break;
      }

      if (targetPostId && String(post.id) !== String(targetPostId)) {
        continue;
      }

      if (post.featured_media && post.featured_media !== 0 && !forceReshoot) {
        console.log(`[Skip] Post #${post.id} ("${decodeHtmlEntities(post.title?.rendered)}") already has featured_media: ${post.featured_media}`);
        continue;
      }

      // Find matching project
      const matchedProject = catalog.projects.find((p) => isPostMatchingProject(post, p));
      if (!matchedProject) {
        console.log(`[Skip] Post #${post.id} ("${decodeHtmlEntities(post.title?.rendered)}") has no matching project in catalog.`);
        continue;
      }

      if (targetProjectId && matchedProject.id !== targetProjectId) {
        continue;
      }

      console.log(`\nProcessing Post #${post.id} for "${matchedProject.name}" (${getValidProjectUrl(matchedProject)})...`);
      try {
        const screenshot = await captureProjectWebScreenshot(matchedProject);
        if (screenshot && fs.existsSync(screenshot.path)) {
          const media = await uploadScreenshotToWordPress(screenshot.path, matchedProject, { title: post.title?.rendered });
          if (media && media.id) {
            let updatedContent = post.content?.rendered || '';
            updatedContent = embedScreenshotInHtml(updatedContent, media, matchedProject);

            await wpRequest(`/posts/${post.id}`, {
              method: 'POST',
              body: {
                featured_media: media.id,
                content: updatedContent,
              },
            });

            console.log(`[Success] ✅ Post #${post.id} updated with featured_media #${media.id} (${media.source_url})!`);

            // Resave Yoast SEO immediately
            try {
              execSync(`docker exec wordpress php -d memory_limit=512M /var/www/html/resave-yoast-posts.php ${post.id}`, { stdio: 'pipe' });
              console.log(`[Yoast SEO] ✅ Post #${post.id} resaved and indexed.`);
            } catch (yErr) {
              console.warn(`[Yoast SEO] Notice: ${yErr.message}`);
            }

            updatedCount++;
          }
        }
      } catch (err) {
        console.error(`[Error] Failed attaching screenshot for Post #${post.id}:`, err.message);
      }
    }

    console.log(`\nBackfill complete! Updated ${updatedCount} post(s).\n`);
    return;
  }

  let projectsToProcess = [];

  if (targetProjectId) {
    projectsToProcess = catalog.projects.filter(
      (p) => p.id === targetProjectId || p.name.toLowerCase() === targetProjectId.toLowerCase()
    );
    if (projectsToProcess.length === 0) {
      projectsToProcess = catalog.projects.filter((p) => p.name.toLowerCase().includes(targetProjectId.toLowerCase()));
    }
  } else if (isRecentPrds) {
    // Specifically target projects that have 0 published posts and are archive PRD-backed
    projectsToProcess = catalog.projects.filter((p) => {
      const existing = existingPosts.filter((post) => isPostMatchingProject(post, p));
      return existing.length === 0 && (p.archive_reference || p.architecture_reference);
    });
    if (projectsToProcess.length === 0) {
      // Fallback: any project with 0 published posts
      projectsToProcess = catalog.projects.filter((p) => {
        const existing = existingPosts.filter((post) => isPostMatchingProject(post, p));
        return existing.length === 0;
      });
    }
  } else if (isArchiveOnly) {
    projectsToProcess = catalog.projects.filter((p) => p.archive_reference || p.architecture_reference);
  } else {
    projectsToProcess = catalog.projects;
  }

  if (projectsToProcess.length === 0) {
    console.error(`No matching projects found for: ${targetProjectId || 'all'}`);
    process.exit(1);
  }

  console.log(`\nStarting automated SEO article workflow for ${projectsToProcess.length} project(s)...`);
  if (forceAll) {
    console.log(`[Mode] Processing all projects (forceAll = true)${forcedAngle ? ` with forced angle: "${forcedAngle}"` : ' with dynamic editorial angle rotation'}.`);
  }

  const results = [];
  let publishedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < projectsToProcess.length; i++) {
    const project = projectsToProcess[i];
    const existingForProject = existingPosts.filter((p) => isPostMatchingProject(p, project));

    // If not forcing all and no specific target project, skip projects that already have articles
    if (existingForProject.length > 0 && !forceAll && !targetProjectId) {
      console.log(`[Skip] Project "${project.name}" already has ${existingForProject.length} article(s). Use --all or --force or --project ${project.id} to generate another.`);
      skippedCount++;
      continue;
    }

    // Avoid creating duplicate alternative articles if one was already published today or matches the alternative slug
    if (forcedAngle && forcedAngle.includes('Alternative') && !targetProjectId && !args.includes('--force-duplicates')) {
      const today = new Date().toISOString().slice(0, 10);
      const alreadyPublishedAlternativeToday = existingForProject.some((p) => {
        const postDate = (p.date || '').slice(0, 10);
        const slug = (p.slug || '').toLowerCase();
        const title = decodeHtmlEntities(p.title?.rendered || '').toLowerCase();
        return postDate === today && (slug.includes('alternative') || title.includes('alternative'));
      });
      if (alreadyPublishedAlternativeToday) {
        console.log(`[Skip] Project "${project.name}" already has a Free Alternative article published today. Skipping duplicate.`);
        skippedCount++;
        continue;
      }
    }

    // Use forced angle if provided, otherwise dynamic angle rotation based on existing articles count
    const angle = forcedAngle || selectAngleForProject(existingForProject.length);

    try {
      const article = await generateArticleWithAI(project, angle);

      console.log(`\nGenerated Article Metadata:`);
      console.log(`- Title: ${article.title}`);
      console.log(`- Focus Keyword: ${article.focus_keyphrase}`);
      console.log(`- Meta Description: ${article.meta_description}`);
      console.log(`- Slug: ${article.slug}`);

      if (isDryRun) {
        console.log(`[Dry Run] Skipping WordPress API publish.`);
        results.push({ project: project.id, article, dryRun: true });
        publishedCount++;
      } else {
        const post = await publishArticle(project, article, publishStatus, { skipScreenshot });
        results.push({
          project: project.id,
          post_id: post.id,
          link: post.link,
          title: post.title.rendered,
          featured_media: post.featured_media || 0,
          screenshot_url: post.screenshot_url || null,
        });
        publishedCount++;
      }
    } catch (err) {
      console.error(`[Error] Failed to process project "${project.name}":`, err.message);
      failedCount++;
    }

    // Pause 3 seconds between successive projects to respect OpenRouter rate limits
    if (i < projectsToProcess.length - 1 && (forceAll || existingForProject.length === 0)) {
      console.log('[Delay] Waiting 3 seconds before next project...');
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  // Save execution log
  const logPath = path.resolve(__dirname, '../articles_log.json');
  let history = [];
  if (fs.existsSync(logPath)) {
    try {
      history = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    } catch (e) {}
  }
  history.push({
    timestamp: new Date().toISOString(),
    publishedCount,
    skippedCount,
    failedCount,
    results,
  });
  fs.writeFileSync(logPath, JSON.stringify(history, null, 2));

  console.log('\n==========================================');
  console.log('       SEO Article Workflow Summary');
  console.log('==========================================');
  console.log(`Total projects examined:   ${projectsToProcess.length}`);
  console.log(`Successfully published:    ${publishedCount}`);
  console.log(`Skipped (already exists):  ${skippedCount}`);
  console.log(`Failed / Errors:           ${failedCount}`);
  console.log('==========================================\n');

  if (skippedCount > 0 && publishedCount === 0 && !forceAll) {
    console.log('💡 All projects already had published articles and were skipped.');
    console.log('👉 To generate a new round of articles across ALL projects, run:');
    console.log('   npm run generate-all');
    console.log('   or: node scripts/generate-articles.js --all\n');
  }

  // Operating Rule: Automatically resave and sync Yoast SEO if new articles were published
  const shouldResave = (publishedCount > 0 && !isDryRun) || args.includes('--resave-yoast');
  if (shouldResave) {
    console.log('\n==========================================');
    console.log('   Rule Enforcement: Resaving to Yoast SEO');
    console.log('==========================================');
    try {
      const { execSync } = require('child_process');
      execSync('npm run resave-yoast', {
        cwd: path.resolve(__dirname, '..'),
        stdio: 'inherit'
      });
      console.log('✅ Yoast SEO resave and re-indexing completed successfully.\n');
    } catch (err) {
      console.warn('⚠️ Yoast SEO resave warning:', err.message);
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = {
  generateArticleWithAI,
  publishArticle,
  captureProjectWebScreenshot,
  uploadScreenshotToWordPress,
  embedScreenshotInHtml,
  fetchExistingPosts,
  wpRequest,
  ensureCategory,
  ensureTag,
  isPostMatchingProject,
  decodeHtmlEntities,
  getValidProjectUrl
};
