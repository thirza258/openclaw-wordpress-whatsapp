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
const HISTORY_PATH = path.resolve(__dirname, '../daily_social_history.json');
const LOG_FILE_PATH = path.resolve(__dirname, '../daily-social.log');

// Primary preferred model when tokens/credits are available
const PRIMARY_MODEL = process.env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it';

// Verified active free models on OpenRouter
const FREE_MODELS_POOL = [
  'cohere/north-mini-code:free',
  'nvidia/nemotron-3.5-lightning:free',
  'dots-studio/dots-3-note-preview:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'xingchen-agi/xing4.0-29b-a4b:free',
  'google/gemma-4-26b-a4b-it:free',
  'google/gemma-4-31b-it:free',
  'openrouter/free'
];

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
  
  // Shuffle secondary free models to distribute load
  for (let i = otherFree.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [otherFree[i], otherFree[j]] = [otherFree[j], otherFree[i]];
  }

  // If primary model is already a free model, just return free models
  if (primary.endsWith(':free') || primary === 'openrouter/free') {
    return [primary, ...otherFree];
  }

  // Primary paid model comes FIRST when credits are available;
  // followed immediately by its direct free version, then other active free models.
  return [primary, primaryFree, ...otherFree];
}

// Popular commercial/paid versions for each project to contrast against in non-architecture posts
const POPULAR_ALTERNATIVES_MAP = {
  'english-practice': 'Duolingo Super ($12.99/mo), Grammarly Premium ($30/mo), and Cambridge / IELTS paid prep platforms ($50–$200)',
  'interviewer': 'Interviewing.io ($100–$225/mock interview), Big Interview ($79/mo), and LeetCode Premium ($35/mo)',
  'uptime-medics': 'Better Stack ($29–$200/mo), PagerDuty ($21–$41/user/mo), and Pingdom ($15–$150/mo)',
  'nevatal': 'ChatPDF Pro ($20/mo), Humata AI ($15–$99/mo), Glean, and Microsoft Copilot for Enterprise ($30/user/mo)',
  'divinity-ai': 'Expensive proprietary religious research apps and commercial subscription-based theological tools',
  'crag-multihop': 'Proprietary enterprise RAG search engines and LangChain/LlamaIndex enterprise cloud tiers ($100+/mo)',
  'rag-reader': 'LangSmith / LangFuse paid evaluation tiers, hosted Ragas tooling, and closed RAG platforms like Vectara or Amazon Bedrock Knowledge Bases',
  'recommendica': 'Overleaf Premium ($15–$40/mo for LaTeX compiling), Scite.ai ($20/mo) for paper search, and paid course platforms like Coursera / edX ($40–$80/mo)',
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

function logMessage(msg) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}\n`;
  process.stdout.write(line);
  try {
    fs.appendFileSync(LOG_FILE_PATH, line, 'utf8');
  } catch (err) {
    // Ignore logging write errors
  }
}

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
  // Strip illegal trailing commas before closing braces/brackets
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
      // Non-breaking hyphen \u2011 -> standard '-' (cleaner for mobile & social text)
      if (code === 0x2011) return '-';
      // Non-breaking space \u00A0 -> regular space ' '
      if (code === 0x00A0) return ' ';
      // Zero-width space \u200B, \u200C, \u200D -> remove
      if (code >= 0x200B && code <= 0x200D) return '';
      // LTR/RTL marks \u200E, \u200F -> remove
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

function extractFieldsRegex(raw) {
  const fields = [
    'x_post', 'threads', 'facebook_post', 'bluesky_post', 'quora_post', 'tiktok_post',
    'reddit_post', 'substack_post', 'producthunt_post', 'alternativeto_post', 'saashub_post',
    'betalist_post', 'taaft_post', 'futurepedia_post', 'devhunt_post', 'peerlist_post'
  ];
  const res = {};
  for (const key of fields) {
    const re = new RegExp(`["']?${key}["']?\\s*:\\s*["']([\\s\\S]*?)(?=["']\\s*,\\s*["']?[a-zA-Z0-9_]+["']?|["']\\s*\\})`, 'i');
    const m = raw.match(re);
    if (m && m[1]) {
      res[key] = cleanExtracted(m[1]);
    }
  }
  const igCaptionMatch = raw.match(/"caption"\s*:\s*"([\\s\\S]*?)(?="\\s*,\\s*"visual_idea"|"[\\s\\S]*?$)/i);
  const igVisualMatch = raw.match(/"visual_idea"\s*:\s*"([\\s\\S]*?)(?="\\s*\}|"[\\s\\S]*?$)/i);
  res.instagram = {
    caption: igCaptionMatch ? cleanExtracted(igCaptionMatch[1]) : (res.facebook_post || ''),
    visual_idea: igVisualMatch ? cleanExtracted(igVisualMatch[1]) : 'UI screenshot or architecture slide breakdown'
  };

  // If tiktok_post is an object in raw, extract nested fields
  if (!res.tiktok_post) {
    const ttHook = raw.match(/"hook"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
    const ttScript = raw.match(/"script"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
    const ttCaption = raw.match(/"caption"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
    const ttTags = raw.match(/"hashtags"\s*:\s*"([\\s\\S]*?)(?="\\s*\}|"[\\s\\S]*?$)/i);
    if (ttHook || ttScript) {
      res.tiktok_post = {
        hook: ttHook ? cleanExtracted(ttHook[1]) : '',
        script: ttScript ? cleanExtracted(ttScript[1]) : '',
        caption: ttCaption ? cleanExtracted(ttCaption[1]) : '',
        hashtags: ttTags ? cleanExtracted(ttTags[1]) : '#TechTok #Coding #OpenSource'
      };
    }
  }

  // If reddit_post is an object in raw, extract nested fields
  if (!res.reddit_post) {
    const rdSubs = raw.match(/"subreddits"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
    const rdTitle = raw.match(/"title"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
    const rdContent = raw.match(/"content"\s*:\s*"([\\s\\S]*?)(?="\\s*\}|"[\\s\\S]*?$)/i);
    if (rdSubs || rdTitle || rdContent) {
      res.reddit_post = {
        subreddits: rdSubs ? cleanExtracted(rdSubs[1]) : 'r/SideProject, r/selfhosted, r/OpenSource',
        title: rdTitle ? cleanExtracted(rdTitle[1]) : '',
        content: rdContent ? cleanExtracted(rdContent[1]) : ''
      };
    }
  }

  // If substack_post is an object in raw, extract nested fields
  if (!res.substack_post) {
    const sbTitle = raw.match(/"title"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
    const sbSubtitle = raw.match(/"subtitle"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
    const sbBody = raw.match(/"body"\s*:\s*"([\\s\\S]*?)(?="\\s*\}|"[\\s\\S]*?$)/i);
    if (sbTitle || sbSubtitle || sbBody) {
      res.substack_post = {
        title: sbTitle ? cleanExtracted(sbTitle[1]) : '',
        subtitle: sbSubtitle ? cleanExtracted(sbSubtitle[1]) : '',
        body: sbBody ? cleanExtracted(sbBody[1]) : ''
      };
    }
  }

  // If producthunt_post is an object in raw, extract nested fields
  if (!res.producthunt_post) {
    const phTag = raw.match(/"tagline"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
    const phDesc = raw.match(/"description"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
    const phMaker = raw.match(/"maker_comment"\s*:\s*"([\\s\\S]*?)(?="\\s*\}|"[\\s\\S]*?$)/i);
    if (phTag || phDesc || phMaker) {
      res.producthunt_post = {
        tagline: phTag ? cleanExtracted(phTag[1]) : '',
        description: phDesc ? cleanExtracted(phDesc[1]) : '',
        maker_comment: phMaker ? cleanExtracted(phMaker[1]) : ''
      };
    }
  }

  // If alternativeto_post is an object in raw, extract nested fields
  if (!res.alternativeto_post) {
    const altSum = raw.match(/"summary"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
    const altRep = raw.match(/"replaces"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
    const altFeat = raw.match(/"features"\s*:\s*"([\\s\\S]*?)(?="\\s*\}|"[\\s\\S]*?$)/i);
    if (altSum || altRep || altFeat) {
      res.alternativeto_post = {
        summary: altSum ? cleanExtracted(altSum[1]) : '',
        replaces: altRep ? cleanExtracted(altRep[1]) : '',
        features: altFeat ? cleanExtracted(altFeat[1]) : ''
      };
    }
  }

  // If saashub_post is an object in raw, extract nested fields
  if (!res.saashub_post) {
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
  }

  // If betalist_post is an object in raw, extract nested fields
  if (!res.betalist_post) {
    const blTag = raw.match(/"tagline"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
    const blPitch = raw.match(/"pitch"\s*:\s*"([\\s\\S]*?)(?="\\s*,|"[\\s\\S]*?$)/i);
    const blVal = raw.match(/"early_adopter_value"\s*:\s*"([\\s\\S]*?)(?="\\s*\}|"[\\s\\S]*?$)/i);
    if (blTag || blPitch || blVal) {
      res.betalist_post = {
        tagline: blTag ? cleanExtracted(blTag[1]) : '',
        pitch: blPitch ? cleanExtracted(blPitch[1]) : '',
        early_adopter_value: blVal ? cleanExtracted(blVal[1]) : ''
      };
    }
  }

  // If taaft_post is an object in raw, extract nested fields
  if (!res.taaft_post) {
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
  }

  // If futurepedia_post is an object in raw, extract nested fields
  if (!res.futurepedia_post) {
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
  }

  // If devhunt_post is an object in raw, extract nested fields
  if (!res.devhunt_post) {
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
  }

  // If peerlist_post is an object in raw, extract nested fields
  if (!res.peerlist_post) {
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
  }

  return res;
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
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, '')
    .trim();
}

// -------------------------------------------------------------
// WordPress REST API Helpers
// -------------------------------------------------------------
async function fetchLatestWpPosts(limit = 10) {
  const credentials = Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString('base64');
  try {
    const res = await fetch(`${WP_BASE_URL}/wp-json/wp/v2/posts?per_page=${limit}&_fields=id,date,title,link,excerpt,slug`, {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json'
      }
    });
    if (!res.ok) {
      logMessage(`[WP API] Warning: fetch posts returned ${res.status}`);
      return [];
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    logMessage(`[WP API] Error fetching posts: ${err.message}`);
    return [];
  }
}

async function searchWpPostForProject(projectName, projectId) {
  const credentials = Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString('base64');
  try {
    const searchTerm = encodeURIComponent(projectId.replace(/-/g, ' '));
    const res = await fetch(`${WP_BASE_URL}/wp-json/wp/v2/posts?search=${searchTerm}&per_page=5&_fields=id,date,title,link,excerpt,slug`, {
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
  // 1. Try finding in articles_log.json first for exact mapping
  if (fs.existsSync(ARTICLES_LOG_PATH)) {
    try {
      const articlesLog = JSON.parse(fs.readFileSync(ARTICLES_LOG_PATH, 'utf8'));
      if (Array.isArray(articlesLog)) {
        for (let i = articlesLog.length - 1; i >= 0; i--) {
          const run = articlesLog[i];
          if (run && Array.isArray(run.results)) {
            const match = run.results.find(r => r.project === projectId && r.post_id && !r.dryRun);
            if (match && match.post_id) {
              logMessage(`[Articles Log] Found recorded article for ${projectId}: ID ${match.post_id}`);
              // Try fetching full post from WP REST API to get excerpt
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

  // 2. Fallback to search WP REST API
  return await searchWpPostForProject(projectName, projectId);
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

function loadHistory() {
  if (!fs.existsSync(HISTORY_PATH)) {
    return {
      last_run_timestamp: null,
      last_project_id: null,
      history: []
    };
  }
  try {
    return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
  } catch (e) {
    return {
      last_run_timestamp: null,
      last_project_id: null,
      history: []
    };
  }
}

function saveHistory(historyObj) {
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(historyObj, null, 2), 'utf8');
}

// Select project in rotation
function selectNextProject(projects, history, forcedProjectId) {
  if (forcedProjectId) {
    const found = projects.find(p => p.id === forcedProjectId || p.id.toLowerCase() === forcedProjectId.toLowerCase());
    if (found) return found;
    logMessage(`[Catalog] Forced project "${forcedProjectId}" not found, picking from rotation.`);
  }

  if (!projects || projects.length === 0) {
    throw new Error('No projects found in catalog.');
  }

  const lastId = history.last_project_id;
  if (!lastId) {
    return projects[0];
  }

  const lastIdx = projects.findIndex(p => p.id === lastId);
  if (lastIdx === -1 || lastIdx >= projects.length - 1) {
    return projects[0];
  }

  return projects[lastIdx + 1];
}

// -------------------------------------------------------------
// Robust helper to dynamically load PRD from archive folder
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
      // Ignore directory read error
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

      // Cap exceptionally large documents at 40KB for social post token efficiency while preserving all core specs
      if (content.length > 40000) {
        content = content.slice(0, 40000) + '\n\n[... Remaining sections truncated for LLM context window optimization; core PRD specifications preserved above ...]';
      }

      combined += `\n\n================================================================================\n${docHeader}\n================================================================================\n${content}\n`;
    } catch (err) {
      logMessage(`[Archive] Could not read ${fpath}: ${err.message}`);
    }
  }
  return combined;
}

// -------------------------------------------------------------
// Grapheme Utilities (Bluesky 300-grapheme compliance)
// -------------------------------------------------------------
const graphemeSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

function countGraphemes(str) {
  let count = 0;
  for (const _ of graphemeSegmenter.segment(str)) count += 1;
  return count;
}

function truncateToGraphemes(str, max = 295) {
  const trimmed = (str || '').trim();
  if (countGraphemes(trimmed) <= max) return trimmed;
  const segments = [...graphemeSegmenter.segment(trimmed)].map(s => s.segment);
  return segments.slice(0, max - 3).join('') + '...';
}

function truncateText(str, max = 90) {
  const text = String(str || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

function asText(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(' ').trim();
  }
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function estimateSpeechDuration(text, fallback = 4) {
  const words = String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  if (!words) return fallback;
  return Math.max(2, Math.min(12, Math.round(words / 2.6)));
}

// -------------------------------------------------------------
// Lightweight OpenRouter JSON helper (used by the TikTok storyboard)
// -------------------------------------------------------------
async function callOpenRouterJson(prompt, { maxTokens = 2400, temperature = 0.8, timeoutMs = 45000 } = {}) {
  let lastError = null;
  let creditsDepleted = false;

  // Keep the storyboard fallback fast: try the primary model plus a few free models.
  for (const model of getCandidateModels().slice(0, 4)) {
    const isFreeModel = model.endsWith(':free') || model === 'openrouter/free';
    if (creditsDepleted && !isFreeModel) continue;

    try {
      logMessage(`[AI] TikTok storyboard using model: ${model}...`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://wordpress.nevatal.id',
          'X-Title': 'OpenClaw TikTok Slideshow Kit'
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content:
                'You are a senior short-form video scriptwriter. Output ONLY valid JSON. No markdown fences, no reasoning, no commentary. Use literal emoji characters sparingly.'
            },
            { role: 'user', content: prompt }
          ],
          temperature,
          max_tokens: maxTokens,
          reasoning: { effort: 'none' }
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const text = await res.text();
        if (isCreditOr402Error(res.status, text)) {
          creditsDepleted = true;
          logMessage(`[AI] 402 for ${model}; falling back to free models.`);
        }
        throw new Error(`OpenRouter API error (${res.status}): ${text}`);
      }

      const json = await res.json();
      if (json.error) {
        const errMsg = json.error.message || JSON.stringify(json.error);
        if (isCreditOr402Error(json.error.code, errMsg)) {
          creditsDepleted = true;
          logMessage(`[AI] 402 for ${model}; falling back to free models.`);
        }
        throw new Error(`OpenRouter Provider Error (${json.error.code || 'unknown'}): ${errMsg}`);
      }

      const rawContent = json.choices?.[0]?.message?.content?.trim();
      if (!rawContent) throw new Error('Empty response from model');

      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON object found in model output');

      let parsed;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (parseErr) {
        parsed = JSON.parse(cleanJsonString(jsonMatch[0]));
      }

      return deepCleanStrings(parsed);
    } catch (err) {
      logMessage(`[AI] TikTok storyboard error with ${model}: ${err.message}. Trying fallback...`);
      lastError = err;
    }
  }

  throw lastError || new Error('All AI models failed to generate the TikTok storyboard.');
}

// -------------------------------------------------------------
// AI Social Media Post Generator via OpenRouter
// -------------------------------------------------------------
async function generateSocialPosts(project, article) {
  const articleTitle = article?.title?.rendered ? decodeHtmlEntities(article.title.rendered) : `${project.name} Architecture & Overview`;
  const articleUrl = article?.link || `https://wordpress.nevatal.id`;
  const articleExcerpt = article?.excerpt?.rendered ? decodeHtmlEntities(article.excerpt.rendered) : project.short_description;

  // Dynamically load fresh archive markdown context (PRD + Architecture) directly from archive folder
  const archiveContext = getArchiveContextForProject(project);
  if (archiveContext) {
    logMessage(`[Archive] Ingested authoritative PRD specification from archive folder for "${project.id}".`);
  }

  const isArchitectureArticle = (articleTitle + ' ' + (article?.slug || '')).toLowerCase().includes('architecture');
  const popularAlternatives = getPopularAlternatives(project);

  const prompt = `You are a world-class tech developer, developer advocate, and social media copywriter.
You are drafting daily social media posts for Thirza, an innovative software engineer and builder who has created several open-source and self-hosted server projects.

CRITICAL ARCHIVE PRD GROUNDING REQUIREMENT:
The project specification provided below from the archive folder is the newly updated, authoritative single source of truth for ${project.name}.
You MUST ground all social media posts (hooks, key features, technical highlights, problem statements, and visual scene suggestions) strictly in this PRD.
Do NOT use outdated assumptions, do not invent fictional capabilities, and do not omit key innovations documented in the PRD.

EDITORIAL FOCUS:
${isArchitectureArticle ? `
- TOPIC: Deep Technical Architecture & Performance Benchmarks.
- Focus on the engineering challenges, decoupled system architecture, benchmarks, and data flows of ${project.name}.
` : `
- TOPIC: 100% FREE ALTERNATIVE TO POPULAR COMMERCIAL TOOLS.
- This article highlights ${project.name} as a powerful, 100% FREE alternative to expensive commercial tools in this niche (such as ${popularAlternatives}).
- Emphasize in the social posts: why pay $20–$100+/mo for commercial SaaS subscriptions when ${project.name} provides this completely free with zero paywalls, no credit cards, and full privacy/control?
${project.id === 'recommendica' ? `
- SPECIAL HIGHLIGHT FOR RECOMMENDICA:
  Make sure the social hooks highlight that Recommendica is NOT just an arXiv paper searcher—it features a built-in 100% FREE LaTeX document compiler (Overleaf alternative without timeouts or subscriptions) AND integrated free academic courses!
` : ''}
`}

PROJECT DETAILS:
- Name: ${project.name}
- ID: ${project.id}
- Live URL: ${project.url}
- Category: ${project.category || 'Software Engineering'}
- Tech Stack: ${Array.isArray(project.tech_stack) ? project.tech_stack.join(', ') : (project.tech_stack || 'Modern Stack')}
- Short Description: ${project.short_description}
- Key Features: ${Array.isArray(project.key_features) ? project.key_features.slice(0, 4).join('; ') : ''}

WORDPRESS DEEP-DIVE ARTICLE:
- Title: ${articleTitle}
- URL: ${articleUrl}
- Excerpt: ${articleExcerpt}${archiveContext ? `\n\nAUTHORITATIVE PROJECT SPECIFICATION & ARCHITECTURE (FROM ARCHIVE PRD):\n${archiveContext}` : ''}

YOUR TASK:
Draft 9 separate, ready-to-post daily social media updates tailored specifically for the user to post themselves:

1. "x_post":
   - STRICT CONSTRAINT: Must be under 270 characters total (including link and hashtags).
   - Scroll-stopping technical hook.
   - Mention what problem the project solves or what makes it fast/unique.
   - Include the link: ${articleUrl}
   - Include 2-3 focused hashtags (e.g. #BuildInPublic #OpenSource).

2. "instagram":
   - "caption":
     * Catchy headline / first sentence that hooks before the "...more" fold.
     * Well-spaced body with emojis and bullet points highlighting 3 key technical features or architecture breakthroughs.
     * Clear Call to Action directing to read full breakdown and explore live project ("🔗 Link in bio").
     * 10-15 strategic hashtags at the very end.
   - "visual_idea":
     * A concise, actionable suggestion for the visual asset (e.g., carousel slide breakdown: Slide 1: Hook, Slide 2: Architecture diagram / UI preview, Slide 3: Performance benchmark / Key takeaway).

3. "threads":
   - STRICT CONSTRAINT: Under 480 characters total.
   - Conversational, authentic developer tone (building in public, lessons learned, or architectural design choice).
   - Mention why this approach matters or ask an engaging engineering question to spark replies.
   - Include link: ${articleUrl}

4. "facebook_post":
   - High-quality, professional post for a Facebook Developer / Tech Page.
   - Engaging opening paragraph introducing the challenge.
   - Bulleted breakdown of key architectural features and use cases.
   - Clear call to action with both the Live Demo link (${project.url}) and the WordPress Article link (${articleUrl}).
   - 3-5 relevant hashtags.

5. "bluesky_post":
   - STRICT CONSTRAINT: Must be under 290 characters total (including link and hashtags).
   - Conversational, open-web, developer-first tone for the Bluesky AT Protocol community.
   - Mention the core architecture highlight or technical problem solved.
   - Include the link: ${articleUrl}
   - Include 2-3 focused hashtags (e.g. #OpenSource #DevCommunity).

6. "quora_post":
   - Educational, authoritative Question & Answer style post for Quora tech/programming spaces.
   - Starts with a realistic, high-intent question relevant to the topic (e.g. "Q: How do you solve [core problem] in production?" or "Q: Why do standard architectures fail at [problem], and what is the optimal pattern?").
   - Followed by a direct, authoritative, no-fluff technical answer explaining the root engineering challenge, the architectural paradigm used, and practical implementation tips.
   - Naturally cites the full architectural benchmark case study (${articleUrl}) and live deployment (${project.url}) as empirical reference.

7. "tiktok_post":
   - Engaging short-form video concept and script for tech TikTok / developer community.
   - "hook": Punchy on-screen visual and verbal hook (0-3s) to stop scrolling.
   - "script": 15-30 second spoken breakdown of the engineering problem, solution, and live demo takeaway.
   - "caption": 1-2 sentence catchy caption with Call to Action ("Link in bio to read full breakdown!").
   - "hashtags": 4-6 targeted tech tags (e.g. #TechTok #Coding #SoftwareEngineering #OpenSource #DevLife).

8. "reddit_post":
   - Tailored specifically for builder and developer communities on Reddit (e.g. r/selfhosted, r/SideProject, r/webdev, r/MachineLearning, r/OpenSource).
   - "subreddits": 2-4 recommended target subreddits for this specific project.
   - "title": Authentic, high-interest, non-clickbait title (e.g. "I built an open-source [X] to solve [Y] — architecture & benchmarks inside").
   - "content": Detailed Reddit post formatted in standard Markdown:
     * Problem & motivation (why existing tools/commercial SaaS fell short).
     * Technical architecture & tech stack highlights.
     * Key benchmarks, performance wins, or engineering hurdles overcome.
     * Direct links to live app (${project.url}) and full architecture case study (${articleUrl}).
     * Welcoming call for feedback, questions, or discussion from the community.

9. "substack_post":
   - Compelling newsletter edition / deep dive for an engineering & builder publication on Substack.
   - "title": High-open-rate, authoritative headline (e.g., "Architecture Deep Dive: How I Engineered [Project] to [Outcome]").
   - "subtitle": 1 punchy sentence summarizing the core engineering takeaway for inbox preview.
   - "body": Structured newsletter essay in Markdown:
     * Personal Introduction: Context on why this project was built and the status quo problems.
     * The Decoupled Blueprint: Architectural decisions, data flow, and tech stack choices.
     * Benchmarks & Key Insights: Real-world latency/metrics and engineering trade-offs.
     * Practical Takeaway: Lessons other engineers can apply to their systems.
     * Links: [Live Deployment](${project.url}) and [Full Benchmark Case Study](${articleUrl}).
     * Thoughtful sign-off and call for reader perspectives.

CRITICAL JSON FORMATTING:
- Do NOT use unescaped double quotes inside post strings. Use single quotes or escape as \".
- Return ONLY a raw, valid JSON object with the following structure (no markdown code blocks, no backticks):
{
  "x_post": "...",
  "instagram": {
    "caption": "...",
    "visual_idea": "..."
  },
  "threads": "...",
  "facebook_post": "...",
  "bluesky_post": "...",
  "quora_post": "...",
  "tiktok_post": {
    "hook": "...",
    "script": "...",
    "caption": "...",
    "hashtags": "..."
  },
  "reddit_post": {
    "subreddits": "r/...",
    "title": "...",
    "content": "..."
  },
  "substack_post": {
    "title": "...",
    "subtitle": "...",
    "body": "..."
  }
}`;

  let lastError = null;
  const modelsToTry = getCandidateModels();
  let creditsDepleted = false;

  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];
    const isFreeModel = model.endsWith(':free') || model === 'openrouter/free';

    // If credits/tokens are depleted (402 received), skip any remaining paid models
    if (creditsDepleted && !isFreeModel) {
      logMessage(`[AI] Skipping paid model ${model} because credits are depleted.`);
      continue;
    }

    try {
      logMessage(`[AI] Generating social media drafts with model: ${model}...`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://wordpress.nevatal.id',
          'X-Title': 'OpenClaw Daily Social Media Post Generator'
        },
        body: JSON.stringify({
          model: model,
          messages: [
            {
              role: 'system',
              content: 'You are an expert tech social media copywriter. Do NOT output reasoning or thinking tokens. Output strictly valid JSON without any markdown formatting wrappers. Use literal emoji characters (e.g. 🚀, 💡, 🔥, •, -) directly instead of escaped unicode sequences (do NOT output \\uXXXX).'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.7,
          max_tokens: 5000,
          reasoning: { effort: 'none' }
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const text = await res.text();
        if (isCreditOr402Error(res.status, text)) {
          creditsDepleted = true;
          logMessage(`[AI] Error 402 (Payment Required / Credits exhausted) for model ${model}. Automatically falling back to free models pool...`);
        }
        throw new Error(`OpenRouter API error (${res.status}): ${text}`);
      }

      const json = await res.json();
      if (json.error) {
        const errMsg = json.error.message || JSON.stringify(json.error);
        if (isCreditOr402Error(json.error.code, errMsg)) {
          creditsDepleted = true;
          logMessage(`[AI] Error 402 (Payment Required / Credits exhausted) for model ${model}. Automatically falling back to free models pool...`);
        }
        throw new Error(`OpenRouter Provider Error (${json.error.code || 'unknown'}): ${errMsg}`);
      }

      const rawContent = json.choices?.[0]?.message?.content?.trim();
      if (!rawContent) {
        throw new Error('Empty response from model');
      }

      // Robust JSON extraction supporting all LLM formats
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
          logMessage(`[AI] JSON parsing failed (${cleanErr.message}), applying regex key extractor...`);
          parsed = extractFieldsRegex(rawContent);
        }
      }

      // Unescape all unicode sequences, surrogate emoticons and HTML entities recursively
      parsed = deepCleanStrings(parsed);

      // Verify required fields
      if (!parsed.x_post || !parsed.threads || !parsed.facebook_post) {
        throw new Error('Incomplete JSON structure returned from model');
      }

      if (!parsed.bluesky_post && parsed.x_post) {
        parsed.bluesky_post = parsed.x_post;
      }
      parsed.bluesky_post = truncateToGraphemes(toCleanString(parsed.bluesky_post), 295);

      if (!parsed.quora_post) {
        parsed.quora_post = `Q: How do you solve architectural challenges in ${project.name}?\n\n` +
          `A: In engineering ${project.name}, the core priority was building a robust, high-performance system without relying on brittle abstractions or expensive SaaS lock-in.\n\n` +
          `Key Architectural Pillars:\n` +
          (parsed.facebook_post ? toCleanString(parsed.facebook_post) : project.short_description) +
          `\n\nFull case study & benchmarks: ${articleUrl}`;
      }

      if (!parsed.tiktok_post) {
        parsed.tiktok_post = `🎬 *Visual Hook (0-3s):* Stop building ${project.name} the old way.\n\n` +
          `🎙️ *Script / Voiceover:*\nMost engineers hit scaling bottlenecks fast with ${project.name}. Here is the exact decoupled architecture I used to achieve high performance with zero paywalls.\n\n` +
          `📱 *Caption:* Building in public! Full architecture breakdown link in bio.\n\n` +
          `#TechTok #SoftwareEngineering #Coding #OpenSource #DevCommunity`;
      }

      if (!parsed.reddit_post) {
        parsed.reddit_post = {
          subreddits: 'r/SideProject, r/selfhosted, r/OpenSource',
          title: `I built ${project.name} — a high-performance open-source alternative to commercial platforms`,
          content: `Hey everyone!\n\n` +
            `I built **${project.name}** to solve the limitations and subscription lock-in of existing commercial platforms in this space.\n\n` +
            `### What it does\n${project.short_description}\n\n` +
            `### Key Architecture & Tech Stack\n` +
            `- **Stack:** ${Array.isArray(project.tech_stack) ? project.tech_stack.join(', ') : project.tech_stack}\n` +
            `- **Features:** ${Array.isArray(project.key_features) ? project.key_features.join('; ') : project.short_description}\n\n` +
            `### Live Demo & Full Benchmark\n` +
            `- **Live App:** ${project.url}\n` +
            `- **Technical Benchmark & Architecture Write-up:** ${articleUrl}\n\n` +
            `I'd love to get feedback on the design decisions and hear what features you'd like to see next!`
        };
      }

      if (!parsed.substack_post) {
        parsed.substack_post = {
          title: `Architecture Deep Dive: Why and How I Built ${project.name}`,
          subtitle: `Eliminating complexity and SaaS subscription fatigue with a modern, decoupled architecture.`,
          body: `Hi everyone,\n\n` +
            `This week, I want to unpack the engineering decisions behind **${project.name}**.\n\n` +
            `### The Problem & Motivation\n${project.short_description}\n\n` +
            `### System Architecture\n` +
            `- **Tech Stack:** ${Array.isArray(project.tech_stack) ? project.tech_stack.join(', ') : project.tech_stack}\n` +
            `- **Core Engineering Pillars:** ${Array.isArray(project.key_features) ? project.key_features.join('; ') : project.short_description}\n\n` +
            `### Performance & Benchmarks\n` +
            `I documented the full system walkthrough, data flows, and benchmark latencies in this article:\n` +
            `👉 [Read the Technical Benchmark](${articleUrl})\n` +
            `👉 [Explore the Live Demo](${project.url})\n\n` +
            `What architectural patterns are you currently experimenting with in your projects? Let me know in the comments below!`
        };
      }

      if (!parsed.producthunt_post) {
        parsed.producthunt_post = {
          tagline: `${project.name} — 100% Free Open-Source Alternative to Commercial Tools`,
          description: `${project.name} gives developers and builders a powerful, self-hostable solution for ${project.short_description} with zero paywalls.`,
          maker_comment: `Hey Product Hunt community! 👋 I'm Thirza, maker of ${project.name}.\n\n` +
            `I built this project to solve the limitations and subscription fatigue of existing commercial platforms.\n\n` +
            `🚀 Highlights:\n` +
            `- 100% Free & Open-Source\n` +
            `- Modern Stack: ${Array.isArray(project.tech_stack) ? project.tech_stack.join(', ') : project.tech_stack}\n` +
            `- Live Demo: ${project.url}\n` +
            `- Technical Benchmark: ${articleUrl}\n\n` +
            `I'd love to hear your feedback, thoughts, and feature ideas!`
        };
      }

      if (!parsed.alternativeto_post) {
        parsed.alternativeto_post = {
          summary: `${project.name} is a high-performance, 100% free alternative to commercial tools in this space.`,
          replaces: popularAlternatives,
          features: `- 100% Free with zero paywalls or subscription lock-in\n- Self-hostable and privacy-first\n- Built with ${Array.isArray(project.tech_stack) ? project.tech_stack.slice(0, 3).join(', ') : project.tech_stack}\n- Live at ${project.url}`
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
          tagline: `Next-gen ${project.category || 'developer tool'} with zero subscription fees`,
          pitch: `${project.name} provides ${project.short_description}. Designed for builders and developers looking for high efficiency and total control without recurring fees.`,
          early_adopter_value: `100% free access to all features, direct line to the builder for feature requests, and self-hosting documentation.`
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

function formatProductHunt(val) {
  if (!val) return '';
  if (typeof val === 'string') return val.trim();
  return [
    val.tagline ? `🏷️ *Tagline:* ${val.tagline}` : '',
    val.description ? `📝 *Description:*\n${val.description}` : '',
    val.maker_comment ? `💬 *Maker / First Comment:*\n${val.maker_comment}` : ''
  ].filter(Boolean).join('\n\n').trim();
}

function formatAlternativeTo(val) {
  if (!val) return '';
  if (typeof val === 'string') return val.trim();
  return [
    val.summary ? `📝 *Summary:* ${val.summary}` : '',
    val.replaces ? `🔄 *Alternative To / Replaces:* ${val.replaces}` : '',
    val.features ? `⭐ *Key Features & Advantages:*\n${val.features}` : ''
  ].filter(Boolean).join('\n\n').trim();
}

function formatSaaSHub(val) {
  if (!val) return '';
  if (typeof val === 'string') return val.trim();
  return [
    val.summary ? `📝 *Summary:* ${val.summary}` : '',
    val.replaces ? `🔄 *Competitors Replaced:* ${val.replaces}` : '',
    val.key_features ? `✨ *Key Highlights:*\n${val.key_features}` : ''
  ].filter(Boolean).join('\n\n').trim();
}

function formatBetaList(val) {
  if (!val) return '';
  if (typeof val === 'string') return val.trim();
  return [
    val.tagline ? `🏷️ *Tagline:* ${val.tagline}` : '',
    val.pitch ? `🚀 *Startup Pitch:*\n${val.pitch}` : '',
    val.early_adopter_value ? `🎁 *Early Adopter Benefit:*\n${val.early_adopter_value}` : ''
  ].filter(Boolean).join('\n\n').trim();
}

function formatTaaft(val) {
  if (!val) return '';
  if (typeof val === 'string') return val.trim();
  return [
    val.task ? `🤖 *AI Category / Task:* ${val.task}` : '',
    val.one_liner ? `⚡ *One-Liner:* ${val.one_liner}` : '',
    val.capabilities ? `🛠️ *Core Capabilities:*\n${val.capabilities}` : ''
  ].filter(Boolean).join('\n\n').trim();
}

function formatFuturepedia(val) {
  if (!val) return '';
  if (typeof val === 'string') return val.trim();
  return [
    val.summary ? `📝 *Tool Summary:* ${val.summary}` : '',
    val.best_for ? `🎯 *Best For:* ${val.best_for}` : '',
    val.features ? `✨ *Features & Pricing:*\n${val.features}` : ''
  ].filter(Boolean).join('\n\n').trim();
}

function formatDevHunt(val) {
  if (!val) return '';
  if (typeof val === 'string') return val.trim();
  return [
    val.pitch ? `💻 *Developer Pitch:*\n${val.pitch}` : '',
    val.tech_stack ? `🛠️ *Tech Stack:* ${val.tech_stack}` : '',
    val.maker_note ? `🚀 *Maker Note:*\n${val.maker_note}` : ''
  ].filter(Boolean).join('\n\n').trim();
}

function formatPeerlist(val) {
  if (!val) return '';
  if (typeof val === 'string') return val.trim();
  return [
    val.headline ? `📌 *Headline:* ${val.headline}` : '',
    val.what_built ? `🛠️ *What I Built:*\n${val.what_built}` : '',
    val.call_to_action ? `💬 *Discussion / CTA:*\n${val.call_to_action}` : ''
  ].filter(Boolean).join('\n\n').trim();
}

function toCleanString(val) {
  if (typeof val === 'string') return decodeUnicodeAndEmoticons(val).trim();
  if (Array.isArray(val)) {
    return val.map((v) => (typeof v === 'string' ? decodeUnicodeAndEmoticons(v).trim() : decodeUnicodeAndEmoticons(v?.threads || v?.text || v?.content || JSON.stringify(v)))).join('\n\n').trim();
  }
  if (val && typeof val === 'object') {
    if (val.hook || val.script) {
      return decodeUnicodeAndEmoticons([
        val.hook ? `🎬 *Visual Hook (0-3s):* ${val.hook}` : '',
        val.script ? `🎙️ *Script / Voiceover:*\n${val.script}` : '',
        val.caption ? `📱 *Caption:* ${val.caption}` : '',
        val.hashtags ? `${val.hashtags}` : ''
      ].filter(Boolean).join('\n\n').trim());
    }
    if (val.subtitle || (val.body && !val.threads && !val.post)) {
      return decodeUnicodeAndEmoticons([
        val.title ? `📌 *Title:* ${val.title}` : '',
        val.subtitle ? `✉️ *Subtitle / Preview:* ${val.subtitle}` : '',
        val.body ? `📝 *Newsletter Body:*\n${val.body}` : ''
      ].filter(Boolean).join('\n\n').trim());
    }
    if (val.subreddits || val.title || (val.content && !val.threads)) {
      return decodeUnicodeAndEmoticons([
        val.subreddits ? `📍 *Suggested Subreddits:* ${val.subreddits}` : '',
        val.title ? `📌 *Title:* ${val.title}` : '',
        val.content ? `📝 *Post Body:*\n${val.content}` : ''
      ].filter(Boolean).join('\n\n').trim());
    }
    if (val.maker_comment || (val.tagline && val.description && !val.pitch)) {
      return decodeUnicodeAndEmoticons(formatProductHunt(val));
    }
    if (val.early_adopter_value) {
      return decodeUnicodeAndEmoticons(formatBetaList(val));
    }
    if (val.task || val.one_liner || val.capabilities) {
      return decodeUnicodeAndEmoticons(formatTaaft(val));
    }
    if (val.best_for) {
      return decodeUnicodeAndEmoticons(formatFuturepedia(val));
    }
    if (val.tech_stack && (val.pitch || val.maker_note)) {
      return decodeUnicodeAndEmoticons(formatDevHunt(val));
    }
    if (val.headline || val.what_built) {
      return decodeUnicodeAndEmoticons(formatPeerlist(val));
    }
    if (val.features) {
      return decodeUnicodeAndEmoticons(formatAlternativeTo(val));
    }
    if (val.key_features) {
      return decodeUnicodeAndEmoticons(formatSaaSHub(val));
    }
    return decodeUnicodeAndEmoticons(val.threads || val.text || val.content || val.caption || val.post || val.body || JSON.stringify(val)).trim();
  }
  return decodeUnicodeAndEmoticons(String(val || '')).trim();
}

// -------------------------------------------------------------
// Message Formatting for WhatsApp
// -------------------------------------------------------------
function buildWhatsAppMessage(project, article, posts, tiktokKit = null) {
  const articleTitle = article?.title?.rendered ? decodeHtmlEntities(article.title.rendered) : `${project.name} Architecture`;
  const articleUrl = article?.link || 'https://wordpress.nevatal.id';
  const today = new Date().toISOString().split('T')[0];

  // Enforce X post character limit <= 280
  let xPost = toCleanString(posts.x_post);
  if (xPost.length > 280) {
    xPost = xPost.slice(0, 277) + '...';
  }

  // Enforce Threads limit <= 500
  let threadsPost = toCleanString(posts.threads);
  if (threadsPost.length > 500) {
    threadsPost = threadsPost.slice(0, 497) + '...';
  }

  const igCaption = toCleanString(posts.instagram?.caption || posts.instagram);
  const igVisual = toCleanString(posts.instagram?.visual_idea || 'UI screenshot or architecture slide breakdown');
  const fbPost = toCleanString(posts.facebook_post);

  // Enforce Bluesky limit <= 295 graphemes
  const blueskyPost = truncateToGraphemes(toCleanString(posts.bluesky_post || posts.x_post), 295);

  const quoraPost = toCleanString(posts.quora_post);
  const tiktokPost = toCleanString(posts.tiktok_post);
  const tiktokKitText = tiktokKit ? formatTikTokKit(tiktokKit, project) : '';
  const redditPost = toCleanString(posts.reddit_post);
  const substackPost = toCleanString(posts.substack_post);

  const finalMessage = `🚀 *DAILY SOCIAL MEDIA POST DRAFTS* 🚀
📅 *Date:* ${today}
🏷️ *Project:* ${project.name}
🌐 *Live App:* ${project.url}
📝 *WordPress Article:* ${articleUrl}
📌 *Topic:* ${articleTitle}

━━━━━━━━━━━━━━━━━━━━━━━━━━
𝕏 *1. X (TWITTER)* [Tap to Copy]
━━━━━━━━━━━━━━━━━━━━━━━━━━
${xPost}

━━━━━━━━━━━━━━━━━━━━━━━━━━
🧵 *2. THREADS* [Tap to Copy]
━━━━━━━━━━━━━━━━━━━━━━━━━━
${threadsPost}

━━━━━━━━━━━━━━━━━━━━━━━━━━
📸 *3. INSTAGRAM* [Tap to Copy]
━━━━━━━━━━━━━━━━━━━━━━━━━━
${igCaption}

💡 *Visual Concept Suggestion:*
${igVisual}

━━━━━━━━━━━━━━━━━━━━━━━━━━
📘 *4. FACEBOOK PAGE* [Tap to Copy]
━━━━━━━━━━━━━━━━━━━━━━━━━━
${fbPost}

━━━━━━━━━━━━━━━━━━━━━━━━━━
🦋 *5. BLUESKY* [Tap to Copy]
━━━━━━━━━━━━━━━━━━━━━━━━━━
${blueskyPost}

━━━━━━━━━━━━━━━━━━━━━━━━━━
❓ *6. QUORA (Q&A ANSWER)* [Tap to Copy]
━━━━━━━━━━━━━━━━━━━━━━━━━━
${quoraPost}

━━━━━━━━━━━━━━━━━━━━━━━━━━
🎵 *7. TIKTOK* [Tap to Copy]
━━━━━━━━━━━━━━━━━━━━━━━━━━
${tiktokKitText || tiktokPost}

━━━━━━━━━━━━━━━━━━━━━━━━━━
👽 *8. REDDIT* [Tap to Copy]
━━━━━━━━━━━━━━━━━━━━━━━━━━
${redditPost}

━━━━━━━━━━━━━━━━━━━━━━━━━━
💌 *9. SUBSTACK (NEWSLETTER)* [Tap to Copy]
━━━━━━━━━━━━━━━━━━━━━━━━━━
${substackPost}

━━━━━━━━━━━━━━━━━━━━━━━━━━
✨ *Daily post kit prepared!* Copy and publish each platform whenever you're ready.`;

  return decodeUnicodeAndEmoticons(finalMessage);
}

// -------------------------------------------------------------
// Delivery via OpenClaw Gateway
// -------------------------------------------------------------
async function sendToWhatsApp(messageText, targetPhone, mediaItems = []) {
  const target = targetPhone || TARGET_PHONE_NUMBER;
  const cleanMessage = decodeUnicodeAndEmoticons(messageText);

  // Support single string mediaPath or array of media objects [{ path, caption }]
  let items = [];
  if (Array.isArray(mediaItems)) {
    items = mediaItems;
  } else if (typeof mediaItems === 'string' && mediaItems.trim()) {
    items = [{ path: mediaItems, caption: '' }];
  } else if (mediaItems && typeof mediaItems === 'object' && mediaItems.path) {
    items = [mediaItems];
  }

  // 1. Send all visual screenshot assets (e.g. 3 images for Product Hunt / directories & social feeds)
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
      // Brief pause between media messages to maintain order in WhatsApp
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  // 2. Send complete copy kit text
  if (cleanMessage && cleanMessage.trim()) {
    logMessage(`[WhatsApp] Sending post draft kit to ${target}...`);
    const tmpFile = path.resolve(__dirname, `../tmp_social_msg_${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, cleanMessage, 'utf8');

    try {
      const cmd = `PATH="/home/thirzq/.nvm/versions/node/v26.13.0/bin:$PATH" ${OPENCLAW_BIN} message send --channel whatsapp --target "${target}" --message "$(cat '${tmpFile}')"`;
      const output = execSync(cmd, { encoding: 'utf8', timeout: 30000 });
      logMessage(`[WhatsApp] Text message successfully sent! Output: ${output.trim()}`);
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
// Multi-Image Project Screenshot Generator (Product Hunt, Galleries, Feeds)
// -------------------------------------------------------------
async function captureProjectScreenshots(url, project) {
  const screenshotsDir = path.resolve(__dirname, '../screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const timestamp = Date.now();
  const projectId = project?.id || 'project';
  const projectName = project?.name || 'Project';

  const configs = [
    {
      id: 'desktop',
      label: 'Desktop Hero Showcase (Product Hunt Image 1 / Web)',
      caption: `📸 *[1/3] Desktop Showcase - ${projectName}*\n(Product Hunt Image 1 / Web Listing)\n🔗 Live Demo: ${url}`,
      filename: `${projectId}_desktop_${timestamp}.png`,
      args: ['--viewport-size=1280,800']
    },
    {
      id: 'feature',
      label: 'Workspace & Feature View (Product Hunt Image 2 / Gallery)',
      caption: `📸 *[2/3] Workspace & Feature View - ${projectName}*\n(Product Hunt Image 2 / Directory Gallery)\n🔗 Live Demo: ${url}`,
      filename: `${projectId}_feature_${timestamp}.png`,
      args: ['--viewport-size=1440,900']
    },
    {
      id: 'mobile',
      label: 'Mobile Responsive View (Product Hunt Image 3 / Instagram & TikTok)',
      caption: `📸 *[3/3] Mobile Responsive View - ${projectName}*\n(Product Hunt Image 3 / Social Feeds)\n🔗 Live Demo: ${url}`,
      filename: `${projectId}_mobile_${timestamp}.png`,
      args: ['--viewport-size=390,844']
    }
  ];

  const results = [];
  logMessage(`[Screenshot] Generating 3-image project gallery for ${projectName} (${url})...`);

  for (const cfg of configs) {
    const outputPath = path.resolve(screenshotsDir, cfg.filename);
    let captured = false;

    // Strategy 1: Local Docker Playwright container with exact matching version & host network
    try {
      const tmpHost = `/tmp/snap_${cfg.id}_${timestamp}.png`;
      const dockerCmd = `docker run --rm --network host --user 1000:1000 -v /tmp:/tmp mcr.microsoft.com/playwright:v1.64.1-noble npx -y playwright@1.64.1 screenshot ${cfg.args.join(' ')} "${url}" "${tmpHost}"`;
      execSync(dockerCmd, { encoding: 'utf8', timeout: 35000 });
      if (fs.existsSync(tmpHost) && fs.statSync(tmpHost).size > 1000) {
        fs.copyFileSync(tmpHost, outputPath);
        try { fs.unlinkSync(tmpHost); } catch (e) {}
        logMessage(`[Screenshot] Playwright captured ${cfg.label}: ${outputPath}`);
        results.push({ path: outputPath, caption: cfg.caption, id: cfg.id, label: cfg.label });
        captured = true;
      }
    } catch (err) {
      logMessage(`[Screenshot] Playwright attempt failed for ${cfg.id}: ${err.message}. Trying cloud API fallback...`);
    }

    // Strategy 2: Fast Cloud Screenshot via Microlink API fallback
    if (!captured) {
      try {
        const extraParam = cfg.id === 'mobile'
          ? '&viewport.isMobile=true&viewport.width=390&viewport.height=844'
          : (cfg.id === 'feature' ? '&viewport.width=1440&viewport.height=900' : '&viewport.width=1280&viewport.height=800');
        const apiUrl = `https://api.microlink.io/?url=${encodeURIComponent(url)}&screenshot=true&embed=screenshot.url${extraParam}`;
        const res = await fetch(apiUrl);
        if (res.ok) {
          const buffer = Buffer.from(await res.arrayBuffer());
          if (buffer.length > 1000) {
            fs.writeFileSync(outputPath, buffer);
            logMessage(`[Screenshot] Microlink captured ${cfg.label}: ${outputPath}`);
            results.push({ path: outputPath, caption: cfg.caption, id: cfg.id, label: cfg.label });
            captured = true;
          }
        }
      } catch (err) {
        logMessage(`[Screenshot] Microlink fallback failed for ${cfg.id}: ${err.message}`);
      }
    }
  }

  return results;
}

// Backward-compatible single screenshot helper
async function capturePageScreenshot(url, targetFilename) {
  const screenshots = await captureProjectScreenshots(url, { id: 'single', name: 'Project' });
  return screenshots.length > 0 ? screenshots[0].path : null;
}

// -------------------------------------------------------------
// TikTok Interactive Slideshow Capture (9:16 mobile frames)
// -------------------------------------------------------------
const TIKTOK_CAPTURE_SCRIPT = path.resolve(__dirname, 'tiktok-slideshow-capture.js');
const TIKTOK_SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots/tiktok');
const TIKTOK_ACCOUNTS_FILE = path.resolve(__dirname, 'tiktok-accounts.json');
const PLAYWRIGHT_DOCKER_IMAGE = 'mcr.microsoft.com/playwright:v1.64.1-noble';

async function captureTikTokSlideshow(project, article, opts = {}) {
  const maxSlides = Math.max(3, Math.min(10, Number(opts.maxSlides) || 6));
  const projectUrl = project?.url || 'https://wordpress.nevatal.id';
  const articleUrl = article?.link || '';
  const outDir = TIKTOK_SCREENSHOTS_DIR;

  fs.mkdirSync(outDir, { recursive: true });

  const nodeModulesDir = path.resolve(__dirname, '../node_modules');
  if (!fs.existsSync(path.join(nodeModulesDir, 'playwright-core'))) {
    throw new Error(`playwright-core is missing. Run: npm install --prefix ${path.resolve(__dirname, '..')}`);
  }
  if (!fs.existsSync(TIKTOK_CAPTURE_SCRIPT)) {
    throw new Error(`TikTok capture script not found at ${TIKTOK_CAPTURE_SCRIPT}`);
  }

  let tiktokAccounts = null;
  if (opts.login !== false && fs.existsSync(TIKTOK_ACCOUNTS_FILE)) {
    try {
      tiktokAccounts = JSON.parse(fs.readFileSync(TIKTOK_ACCOUNTS_FILE, 'utf8'));
    } catch (err) {
      logMessage(`[TikTok] Warning: could not read tiktok-accounts.json (${err.message}).`);
    }
  }
  const useLogin = Boolean(tiktokAccounts && tiktokAccounts[project?.id]);
  if (useLogin) {
    try {
      fs.chmodSync(TIKTOK_ACCOUNTS_FILE, 0o600);
    } catch (err) {}
  }

  const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
  const gid = typeof process.getgid === 'function' ? process.getgid() : 1000;

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
    `${TIKTOK_CAPTURE_SCRIPT}:/opt/tiktok-slideshow-capture.js:ro`,
    '-v',
    `${nodeModulesDir}:/opt/pw/node_modules:ro`,
    '-v',
    `${outDir}:/out`
  ];

  if (useLogin) {
    dockerArgs.push('-v', `${TIKTOK_ACCOUNTS_FILE}:/opt/tiktok-accounts.json:ro`);
  }

  dockerArgs.push(
    PLAYWRIGHT_DOCKER_IMAGE,
    'node',
    '/opt/tiktok-slideshow-capture.js',
    '--url',
    projectUrl,
    '--out-dir',
    '/out',
    '--project-id',
    project?.id || 'project',
    '--project-name',
    project?.name || 'Project',
    '--max-slides',
    String(maxSlides)
  );

  if (useLogin) {
    dockerArgs.push('--login-config', '/opt/tiktok-accounts.json', '--account', project?.id || 'project');
    if (opts.requireLogin) dockerArgs.push('--require-login');
  }

  if (articleUrl) {
    dockerArgs.push('--fallback-url', articleUrl);
  }

  try {
    fs.unlinkSync(path.join(outDir, 'meta.json'));
  } catch (err) {}

  logMessage(
    `[TikTok] Capturing up to ${maxSlides} vertical 9:16 slideshow frames for ${project?.name || 'project'}${
      useLogin ? ' with OpenClaw account login' : ''
    }...`
  );

  const output = execFileSync('docker', dockerArgs, {
    encoding: 'utf8',
    timeout: 300000,
    maxBuffer: 10 * 1024 * 1024
  });

  if (output.trim()) {
    const lastLine = output.trim().split('\n').slice(-1)[0];
    logMessage(`[TikTok] Capture finished: ${lastLine}`);
  }

  const metaPath = path.join(outDir, 'meta.json');
  if (!fs.existsSync(metaPath)) {
    throw new Error('TikTok capture did not produce meta.json');
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const frames = (meta.frames || [])
    .map((frame, index) => ({
      ...frame,
      order: index + 1,
      path: path.resolve(outDir, frame.filename)
    }))
    .filter((frame) => fs.existsSync(frame.path));

  if (!frames.length) {
    throw new Error('TikTok capture produced no usable frames');
  }

  logMessage(`[TikTok] Captured ${frames.length} ordered slideshow frame(s).`);
  return { frames, meta, outDir };
}

function buildFallbackTikTokStoryboard(frames, project, article) {
  const projectName = project?.name || 'this project';
  const features = Array.isArray(project?.key_features) ? project.key_features.filter(Boolean) : [];
  const articleUrl = article?.link || project?.url || '';

  const slides = frames.map((frame, index) => {
    const heading = (frame.headings && frame.headings[0]) || '';
    let onScreenText = heading;
    let voiceover = '';

    if (index === 0) {
      onScreenText = `I let OpenClaw try ${projectName}`;
      voiceover = `I'm OpenClaw, and I just opened ${projectName}. ${truncateText(project?.short_description || '', 150)}`;
    } else if (index === frames.length - 1) {
      onScreenText = '100% free. No paywall.';
      voiceover =
        'Everything I just showed you is completely free, with no credit card and no paywall. Full breakdown is linked in my bio.';
    } else {
      const feature = features[index - 1] || project?.short_description || '';
      const featureText = truncateText(feature, 140);
      const cleanHeading = truncateText(heading, 100);
      onScreenText = heading || feature;
      const headingAlreadyInFeature =
        cleanHeading &&
        featureText &&
        featureText.toLowerCase().includes(cleanHeading.toLowerCase().slice(0, 30));
      voiceover = headingAlreadyInFeature
        ? featureText
        : `${cleanHeading ? `${cleanHeading}. ` : ''}${featureText}`.trim();
    }

    return {
      order: index + 1,
      path: frame.path,
      filename: frame.filename,
      source: frame.source || 'project',
      url: frame.url,
      on_screen_text: truncateText(onScreenText, 70),
      voiceover,
      duration_seconds: estimateSpeechDuration(voiceover),
      transition: index === 0 ? 'hard cut' : 'swipe up',
      interaction: ''
    };
  });

  const totalDuration = slides.reduce((sum, slide) => sum + slide.duration_seconds, 0);

  return {
    title: `OpenClaw tries ${projectName}`,
    hook: slides[0]?.voiceover || '',
    persona: 'OpenClaw (AI agent, first-time user)',
    slides,
    total_duration_seconds: totalDuration,
    poll: {
      question: `Would you use ${projectName}?`,
      options: ['Yes, instantly', 'I need to try it first']
    },
    comment_prompt: 'Comment OPENCLAW and I will share the full breakdown.',
    caption: `OpenClaw tries ${projectName} for the first time. Full breakdown in bio.`,
    hashtags: '#TechTok #OpenSource #BuildInPublic #FreeAlternative #DevLife',
    article_url: articleUrl,
    fallback: true
  };
}

function normalizeTikTokStoryboard(parsed, frames, project, article, captureMeta = null) {
  const fallback = buildFallbackTikTokStoryboard(frames, project, article);
  const authenticated = Boolean(captureMeta && captureMeta.authenticated);
  const rawSlidesSource = parsed?.slides || parsed?.storyboard || parsed?.shots;
  const rawSlides = Array.isArray(rawSlidesSource)
    ? rawSlidesSource
    : rawSlidesSource && typeof rawSlidesSource === 'object'
      ? Object.values(rawSlidesSource)
      : [];

  const slides = frames.map((frame, index) => {
    const raw = rawSlides[index] || {};
    const fallbackSlide = fallback.slides[index];
    const voiceover = asText(raw.voiceover) || fallbackSlide.voiceover;
    const onScreenText =
      asText(raw.on_screen_text) || asText(raw.text) || fallbackSlide.on_screen_text;
    const duration = Number(raw.duration_seconds);

    return {
      order: index + 1,
      path: frame.path,
      filename: frame.filename,
      source: frame.source || 'project',
      url: frame.url,
      on_screen_text: truncateText(onScreenText, 70),
      voiceover,
      duration_seconds: Number.isFinite(duration)
        ? Math.max(2, Math.min(12, Math.round(duration)))
        : estimateSpeechDuration(voiceover),
      transition:
        typeof raw.transition === 'string' && raw.transition.trim()
          ? raw.transition.trim()
          : fallbackSlide.transition,
      interaction: typeof raw.interaction === 'string' ? raw.interaction.trim() : ''
    };
  });

  if (slides[0] && !/openclaw/i.test(slides[0].voiceover)) {
    slides[0].voiceover = `I'm OpenClaw. ${slides[0].voiceover}`;
    slides[0].duration_seconds = estimateSpeechDuration(slides[0].voiceover);
  }

  const lastSlide = slides[slides.length - 1];
  if (lastSlide && !/bio/i.test(lastSlide.voiceover)) {
    lastSlide.voiceover = `${lastSlide.voiceover.replace(/\s+$/, '')} Full breakdown linked in bio.`;
    lastSlide.duration_seconds = estimateSpeechDuration(lastSlide.voiceover);
  }

  const totalDuration = slides.reduce((sum, slide) => sum + slide.duration_seconds, 0);
  const pollRaw = parsed?.poll && typeof parsed.poll === 'object' ? parsed.poll : {};
  const pollOptions =
    Array.isArray(pollRaw.options) && pollRaw.options.length >= 2
      ? pollRaw.options.map(String).slice(0, 4)
      : fallback.poll.options;

  return {
    title: asText(parsed?.title) || fallback.title,
    hook: asText(parsed?.hook) || slides[0]?.voiceover || fallback.hook,
    persona: authenticated
      ? 'OpenClaw (AI agent, signed in with its own account)'
      : 'OpenClaw (AI agent, first-time visitor)',
    authenticated,
    auth_error: authenticated ? null : captureMeta?.auth?.error || null,
    slides,
    total_duration_seconds: totalDuration,
    poll: {
      question: asText(pollRaw.question) || fallback.poll.question,
      options: pollOptions
    },
    comment_prompt: asText(parsed?.comment_prompt) || fallback.comment_prompt,
    caption: asText(parsed?.caption) || fallback.caption,
    hashtags: asText(parsed?.hashtags) || fallback.hashtags,
    article_url: article?.link || project?.url || '',
    fallback: false
  };
}

async function generateTikTokStoryboard(project, article, frames, captureMeta = null) {
  const authenticated = Boolean(captureMeta && captureMeta.authenticated);
  const projectName = project?.name || 'this project';
  const articleTitle = article?.title?.rendered
    ? decodeHtmlEntities(article.title.rendered)
    : `${projectName} deep dive`;
  const articleUrl = article?.link || project?.url || '';
  const features = Array.isArray(project?.key_features) ? project.key_features.filter(Boolean) : [];
  const useCases = Array.isArray(project?.use_cases) ? project.use_cases.filter(Boolean) : [];

  const frameLines = frames
    .map((frame, index) => {
      const headings = (frame.headings || []).slice(0, 4).join(' | ') || '(none)';
      return `Slide ${index + 1} [${frame.source || 'project'}] — visible headings: ${headings}; visible text: ${truncateText(
        frame.text || '',
        420
      )}`;
    })
    .join('\n');

  const prompt = `You are writing an interactive TikTok photo-carousel (slideshow) for a developer audience.
The creator is "OpenClaw" — an AI agent ${
    authenticated
      ? `using ${projectName} with its own signed-in account`
      : `trying ${projectName} for the first time as a public visitor`
  }. The narration must sound like a real first-person walkthrough, not a corporate ad.

AUTHENTICATED SESSION: ${
    authenticated
      ? 'Yes. The screenshots were captured after OpenClaw signed in with its own account (username "crestodian"). The UI may show the account name or a sign-out control. You may say "I signed in with my OpenClaw account", but only if that account state is visible in the slide.'
      : 'No. The screenshots were captured as a public visitor. Do not claim to have signed in, registered, or created an account.'
  }

PROJECT:
- Name: ${projectName}
- Live URL: ${project?.url || ''}
- One-liner: ${project?.short_description || ''}
- Category: ${project?.category || 'Software'}
- Key features: ${features.slice(0, 6).join('; ') || 'N/A'}
- Use cases: ${useCases.slice(0, 4).join('; ') || 'N/A'}

WORDPRESS DEEP DIVE:
- Title: ${articleTitle}
- URL: ${articleUrl}

CAPTURED SLIDES (already screenshotted, in this exact posting order):
${frameLines}

TASK:
Write a tight 25–40 second voice-over, one short segment per captured slide. Each segment must match what is actually visible in that specific screenshot. Do not describe features that are not in the visible text unless they are in the project details. Keep the language spoken, first-person, and simple.

Rules:
- Slide 1 must be a scroll-stopping hook in 2 seconds. Start with "I'm OpenClaw" and name ${projectName} in the first sentence.
- Use first person ("I opened...", "I tried...") throughout. You are OpenClaw, an AI agent, not a marketer.
- Final slide must say the full breakdown is linked in the bio.
- Do not claim you clicked, selected, typed, or completed an action unless that state is visibly shown in the screenshot.
- Do not use corporate phrases like "leverage", "seamless", or "revolutionary".
- Do not invent benchmark numbers or features.

There are exactly ${frames.length} slides. Return exactly ${frames.length} slide objects, in the same order. Do not add, remove, or reorder slides.

Return ONLY this JSON shape:
{
  "title": "short TikTok title",
  "hook": "the first 1-2 spoken sentences",
  "slides": [
    {
      "order": 1,
      "on_screen_text": "max 8 words of text to overlay",
      "voiceover": "1-2 spoken sentences, max 24 words",
      "duration_seconds": 4,
      "transition": "hard cut | swipe up | zoom",
      "interaction": "optional tiny prompt, e.g. Tap if you'd use this"
    }
  ],
  "poll": {
    "question": "one interactive poll question",
    "options": ["short option 1", "short option 2"]
  },
  "comment_prompt": "one short comment prompt",
  "caption": "1-2 sentence TikTok caption with CTA",
  "hashtags": "#TechTok #OpenSource #BuildInPublic #FreeAlternative #DevLife"
}`;

  try {
    const parsed = await callOpenRouterJson(prompt, { maxTokens: 2600, temperature: 0.8 });
    logMessage('[TikTok] AI storyboard generated successfully.');
    return normalizeTikTokStoryboard(parsed, frames, project, article, captureMeta);
  } catch (err) {
    logMessage(`[TikTok] AI storyboard failed: ${err.message}. Using deterministic fallback.`);
    const fallback = buildFallbackTikTokStoryboard(frames, project, article);
    fallback.authenticated = authenticated;
    fallback.auth_error = authenticated ? null : captureMeta?.auth?.error || null;
    fallback.persona = authenticated
      ? 'OpenClaw (AI agent, signed in with its own account)'
      : 'OpenClaw (AI agent, first-time visitor)';
    return fallback;
  }
}

function formatTikTokKit(kit, project) {
  if (!kit || !Array.isArray(kit.slides) || kit.slides.length === 0) return '';

  const totalSeconds =
    kit.total_duration_seconds ||
    kit.slides.reduce((sum, slide) => sum + (slide.duration_seconds || 0), 0);
  const lines = [];

  lines.push('🎵 *TIKTOK INTERACTIVE SLIDESHOW KIT*');
  lines.push(`👤 *Persona:* ${kit.persona || 'OpenClaw (AI agent, first-time visitor)'}`);
  if (kit.authenticated) {
    lines.push('🔐 *Session:* Signed in with OpenClaw\'s own account');
  } else if (kit.auth_error) {
    lines.push(`⚠️ *Session:* Account login failed (${truncateText(kit.auth_error, 60)}); captured as public visitor.`);
  }
  lines.push(`🎬 *Title:* ${kit.title}`);
  lines.push(
    `📐 *Format:* 9:16 photo carousel • ${kit.slides.length} slides • ~${totalSeconds}s`
  );
  lines.push(
    '📲 *How to post:* TikTok → + → Photo → select the slides in numeric order → add the voice-over → add the poll sticker → post.'
  );
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('🖼️ *PHOTO ORDER — post in this exact order*');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━');

  for (const slide of kit.slides) {
    lines.push(`*${slide.order}/${kit.slides.length}* — ${slide.filename}`);
    if (slide.on_screen_text) {
      lines.push(`   📝 On-screen: ${slide.on_screen_text}`);
    }
    lines.push(`   🎙️ Voice-over: ${slide.voiceover}`);
    lines.push(
      `   ⏱️ ~${slide.duration_seconds}s • ${slide.transition || 'swipe up'}`
    );
    if (slide.interaction) {
      lines.push(`   👆 ${slide.interaction}`);
    }
    lines.push('');
  }

  const fullVoiceover = kit.slides.map((slide) => slide.voiceover).join(' ');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('🎙️ *FULL VOICE-OVER — record it or paste into TikTok TTS*');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(fullVoiceover);
  lines.push('');

  if (kit.poll && kit.poll.question) {
    lines.push('🗳️ *INTERACTIVE STICKER — poll*');
    lines.push(`Q: ${kit.poll.question}`);
    if (Array.isArray(kit.poll.options) && kit.poll.options.length) {
      lines.push(`Options: ${kit.poll.options.join(' / ')}`);
    }
    lines.push('');
  }

  if (kit.comment_prompt) {
    lines.push(`💬 *Comment prompt:* ${kit.comment_prompt}`);
    lines.push('');
  }

  lines.push('📱 *Caption:*');
  lines.push(kit.caption || '');
  lines.push(kit.hashtags || '');
  if (kit.article_url) {
    lines.push('');
    lines.push(`🔗 *Full breakdown:* ${kit.article_url}`);
  }

  return lines.join('\n').trim();
}

function buildTikTokOnlyMessage(project, article, kit) {
  const articleTitle = article?.title?.rendered
    ? decodeHtmlEntities(article.title.rendered)
    : `${project.name} deep dive`;
  const articleUrl = article?.link || project.url;
  const today = new Date().toISOString().split('T')[0];

  return `🎵 *TIKTOK SLIDESHOW KIT* 🎵
📅 *Date:* ${today}
🏷️ *Project:* ${project.name}
🌐 *Live App:* ${project.url}
📝 *Article:* ${articleUrl}
📌 *Topic:* ${articleTitle}

${formatTikTokKit(kit, project)}`.trim();
}

// -------------------------------------------------------------
// Bluesky Bot Integration
// -------------------------------------------------------------
const BLUESKY_BOT_CLI = process.env.BLUESKY_BOT_CLI || '/home/thirzq/bluesky-bot/src/cli.js';

function sendToBluesky(text, { schedule = null, dryRun = false } = {}) {
  if (!fs.existsSync(BLUESKY_BOT_CLI)) {
    logMessage(`[Bluesky] CLI not found at ${BLUESKY_BOT_CLI}, skipping Bluesky action.`);
    return null;
  }

  const sanitizedText = truncateToGraphemes(decodeUnicodeAndEmoticons(text), 295);
  const args = [BLUESKY_BOT_CLI];
  if (schedule) {
    args.push('schedule', '-', '--in', schedule);
  } else {
    args.push('post', '-');
  }
  if (dryRun) {
    args.push('--dry-run');
  }
  args.push('--json');

  logMessage(`[Bluesky] ${dryRun ? 'Validating (dry-run)' : (schedule ? `Scheduling in ${schedule}` : 'Publishing post')} via Bluesky bot...`);
  try {
    const stdout = execFileSync(process.execPath, args, {
      input: sanitizedText,
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH || ''}` }
    });
    const res = JSON.parse(stdout);
    if (res.ok) {
      if (res.uri) {
        logMessage(`[Bluesky] Post successfully published! URI: ${res.uri}`);
      } else if (res.id) {
        logMessage(`[Bluesky] Post successfully queued! Item ID: ${res.id}, Due: ${res.dueAt}`);
      } else if (res.dryRun) {
        const graphemes = res.posts?.[0]?.graphemes ?? 0;
        logMessage(`[Bluesky] Dry-run validation passed (${graphemes}/300 graphemes).`);
      }
    }
    return res;
  } catch (err) {
    logMessage(`[Bluesky] Error interacting with Bluesky bot: ${err.message}`);
    if (err.stdout) logMessage(`[Bluesky stdout] ${err.stdout}`);
    if (err.stderr) logMessage(`[Bluesky stderr] ${err.stderr}`);
    return null;
  }
}

// -------------------------------------------------------------
// Process Lock to Prevent Concurrent Execution & Duplicates
// -------------------------------------------------------------
const PROCESS_LOCK_FILE = path.resolve(__dirname, '../daily_social_process.lock');

function acquireProcessLock() {
  try {
    if (fs.existsSync(PROCESS_LOCK_FILE)) {
      const pidStr = fs.readFileSync(PROCESS_LOCK_FILE, 'utf8').trim();
      const pid = parseInt(pidStr, 10);
      if (!isNaN(pid)) {
        try {
          process.kill(pid, 0);
          return false; // Active process exists
        } catch (e) {
          // Stale lockfile
        }
      }
    }
    fs.writeFileSync(PROCESS_LOCK_FILE, String(process.pid), 'utf8');
    return true;
  } catch (err) {
    return true;
  }
}

function releaseProcessLock() {
  try {
    if (fs.existsSync(PROCESS_LOCK_FILE)) {
      const pidStr = fs.readFileSync(PROCESS_LOCK_FILE, 'utf8').trim();
      if (parseInt(pidStr, 10) === process.pid) {
        fs.unlinkSync(PROCESS_LOCK_FILE);
      }
    }
  } catch (err) {}
}

process.on('exit', releaseProcessLock);
process.on('SIGINT', () => { releaseProcessLock(); process.exit(130); });
process.on('SIGTERM', () => { releaseProcessLock(); process.exit(143); });

// -------------------------------------------------------------
// Main Orchestrator
// -------------------------------------------------------------
async function run() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run') || args.includes('-n');
  const isSend = args.includes('--send');
  const isForce = args.includes('--force');
  const isList = args.includes('--list');
  const isHelp = args.includes('--help') || args.includes('-h');
  const isBlueskyPost = args.includes('--bluesky') || args.includes('--bluesky-post');
  const isScreenshotsOnly = args.includes('--screenshots-only') || args.includes('--screenshots');
  const isTikTokOnly = args.includes('--tiktok-only') || args.includes('--slideshow-only');
  const withGallery = args.includes('--with-gallery');
  const skipTikTok = args.includes('--no-tiktok');
  const skipLogin = args.includes('--no-login');

  let maxSlides = 6;
  const maxSlidesIdx = args.indexOf('--max-slides');
  if (maxSlidesIdx !== -1 && args[maxSlidesIdx + 1]) {
    const parsedMaxSlides = parseInt(args[maxSlidesIdx + 1], 10);
    if (!isNaN(parsedMaxSlides)) {
      maxSlides = Math.max(3, Math.min(10, parsedMaxSlides));
    }
  }

  let blueskySchedule = null;
  const blueskyScheduleIdx = args.indexOf('--bluesky-schedule');
  if (blueskyScheduleIdx !== -1 && args[blueskyScheduleIdx + 1]) {
    blueskySchedule = args[blueskyScheduleIdx + 1];
  } else if (process.env.BLUESKY_AUTO_SCHEDULE) {
    blueskySchedule = process.env.BLUESKY_AUTO_SCHEDULE;
  }

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
Usage: node daily-social-post.js [options]

Options:
  --dry-run, -n              Generate drafted posts and print to stdout without sending
  --send                     Generate and send to WhatsApp (${TARGET_PHONE_NUMBER})
  --force                    Bypass the same-day (6h) delivery deduplication guard
  --project <id>             Force a specific project by id (e.g. literal-storyboard, uptime-medics)
  --screenshots-only         Capture and deliver 3 gallery screenshots (Product Hunt, directories)
  --tiktok-only              Capture the ordered 9:16 TikTok slideshow + voice-over kit only
  --max-slides <n>           Number of TikTok slideshow frames (default: 6, min 3, max 10)
  --with-gallery             Also send the 3-image Product Hunt/directory gallery
  --no-tiktok                Skip TikTok slideshow capture in the daily run
  --no-login                 Capture public pages only; skip OpenClaw account sign-in
  --target <phone>           Override WhatsApp recipient (default: ${TARGET_PHONE_NUMBER})
  --bluesky, --bluesky-post  Publish drafted Bluesky post immediately via bluesky-bot
  --bluesky-schedule <in>    Schedule drafted Bluesky post via bluesky-bot queue (e.g. 1h, 30m)
  --list                     List all projects and history status
  --help, -h                 Show this help text
`);
    process.exit(0);
  }

  // Prevent multiple concurrent instances from running simultaneously
  if (!acquireProcessLock()) {
    logMessage('[Daily Social] Another instance of daily-social-post is already running. Skipping execution to prevent duplicate messages.');
    return;
  }

  const projects = loadCatalog();
  const history = loadHistory();

  // Deduplication Guard: If sending to WhatsApp without --force, --screenshots-only, or --tiktok-only, prevent duplicate delivery if already sent within 6 hours
  if (isSend && !isForce && !isScreenshotsOnly && !isTikTokOnly) {
    const lastRunTime = history.last_run_timestamp ? new Date(history.last_run_timestamp).getTime() : 0;
    const hoursSinceLastRun = (Date.now() - lastRunTime) / (1000 * 60 * 60);
    if (hoursSinceLastRun < 6) {
      logMessage(`[Daily Social] Dedup Guard: Post kit was already delivered to WhatsApp ${hoursSinceLastRun.toFixed(1)}h ago at ${history.last_run_timestamp}. Skipping to prevent duplicate messages. (Pass --force to override)`);
      releaseProcessLock();
      return;
    }
  }

  if (isList) {
    console.log('\n=== REGISTERED PROJECTS IN CATALOG ===');
    projects.forEach((p, i) => {
      const isLast = p.id === history.last_project_id ? ' (LAST POSTED)' : '';
      console.log(`${(i + 1).toString().padStart(2, ' ')}. [${p.id}] ${p.name}${isLast}`);
    });
    console.log('\n=== RECENT POSTING HISTORY ===');
    if (history.history && history.history.length > 0) {
      history.history.slice(-5).forEach(h => {
        console.log(`- ${h.date}: [${h.project_id}] ${h.title} (${h.link})`);
      });
    } else {
      console.log('No prior runs recorded.');
    }
    process.exit(0);
  }

  logMessage('====================================================');
  logMessage(`[Daily Social] Starting post generation at ${new Date().toISOString()}`);
  logMessage('====================================================');

  // 1. Select project
  const project = selectNextProject(projects, history, forcedProjectId);
  logMessage(`[Daily Social] Selected project: [${project.id}] ${project.name}`);

  const targetScreenshotUrl = project.url || 'https://wordpress.nevatal.id';

  // If running in screenshots-only mode, capture and deliver the 3 images directly
  if (isScreenshotsOnly) {
    logMessage(`[Daily Social] Running in screenshots-only mode for ${project.name}...`);
    const screenshots = await captureProjectScreenshots(targetScreenshotUrl, project);

    if (isSend) {
      logMessage(`[WhatsApp] Delivering ${screenshots.length} visual assets for ${project.name} to ${forcedTarget || TARGET_PHONE_NUMBER}...`);
      await sendToWhatsApp(null, forcedTarget || TARGET_PHONE_NUMBER, screenshots);
      logMessage(`[Daily Social] Successfully sent ${screenshots.length} screenshots to WhatsApp for ${project.id}.`);
    } else {
      console.log(`\n=== SCREENSHOTS CAPTURED (${screenshots.length} IMAGES) ===`);
      screenshots.forEach((s, idx) => {
        console.log(`[${idx + 1}/3] ${s.label}: ${s.path}`);
      });
      console.log('(Dry-run mode: Pass --send to deliver these to WhatsApp)');
    }
    releaseProcessLock();
    return;
  }

  // 2. Locate corresponding WordPress post
  logMessage(`[Daily Social] Locating WordPress article for ${project.name} (${project.id})...`);
  let article = await getArticleForProject(project.id, project.name);

  if (!article) {
    logMessage(`[Daily Social] No exact search match found, fetching recent published posts...`);
    const recentPosts = await fetchLatestWpPosts(1);
    if (recentPosts.length > 0) {
      article = recentPosts[0];
      logMessage(`[Daily Social] Using recent post: "${article.title.rendered}"`);
    }
  } else {
    logMessage(`[Daily Social] Found matching article: "${article.title.rendered}" (${article.link})`);
  }

  // TikTok-only mode: capture and deliver just the ordered slideshow + voice-over kit
  if (isTikTokOnly) {
    logMessage(`[Daily Social] Running in TikTok slideshow mode for ${project.name}...`);

    const capture = await captureTikTokSlideshow(project, article, { maxSlides, login: !skipLogin });
    const tiktokKit = await generateTikTokStoryboard(project, article, capture.frames, capture.meta);
    const tiktokMessage = buildTikTokOnlyMessage(project, article, tiktokKit);

    console.log('\n================ TIKTOK SLIDESHOW KIT ================');
    console.log(tiktokMessage);
    console.log('=======================================================\n');

    if (isSend) {
      const mediaItems = tiktokKit.slides.map((slide) => ({
        path: slide.path,
        caption:
          `🎵 *TikTok Slide ${slide.order}/${tiktokKit.slides.length}* — ${slide.on_screen_text}\n` +
          `🎙️ VO: ${slide.voiceover}\n` +
          `⏱️ ~${slide.duration_seconds}s • 9:16 • Post in this exact order\n` +
          `🌐 ${project.url}`
      }));

      logMessage(
        `[WhatsApp] Delivering ${mediaItems.length} TikTok slideshow frames for ${project.name} to ${forcedTarget || TARGET_PHONE_NUMBER}...`
      );
      await sendToWhatsApp(tiktokMessage, forcedTarget || TARGET_PHONE_NUMBER, mediaItems);
      logMessage(`[Daily Social] TikTok slideshow kit delivered for ${project.id}.`);
    } else {
      logMessage('[Daily Social] TikTok slideshow dry-run completed. No WhatsApp message was sent.');
    }

    releaseProcessLock();
    return;
  }

  // 3. Generate social media posts via OpenRouter
  const posts = await generateSocialPosts(project, article);

  // 4. Capture the TikTok slideshow + optional 3-image gallery when sending
  let tiktokKit = null;
  let galleryScreenshots = [];

  if (isSend) {
    if (!skipTikTok) {
      try {
        const capture = await captureTikTokSlideshow(project, article, { maxSlides, login: !skipLogin });
        tiktokKit = await generateTikTokStoryboard(project, article, capture.frames, capture.meta);
      } catch (err) {
        logMessage(`[TikTok] Warning: slideshow capture failed: ${err.message}`);
      }
    }

    if (withGallery || !tiktokKit) {
      try {
        galleryScreenshots = await captureProjectScreenshots(targetScreenshotUrl, project);
      } catch (e) {
        logMessage(`[Daily Social] Warning: gallery screenshot generation failed: ${e.message}`);
      }
    }
  }

  // 5. Build formatted WhatsApp message (includes the TikTok storyboard when available)
  const whatsappMessage = buildWhatsAppMessage(project, article, posts, tiktokKit);

  console.log('\n================ PREVIEW OF WHATSAPP MESSAGE ================');
  console.log(whatsappMessage);
  console.log('=============================================================\n');

  // 6. Send or Dry-Run
  if (isDryRun && !isSend) {
    logMessage('[Daily Social] Dry-run mode completed. Message was NOT sent to WhatsApp.');
    logMessage(`[Daily Social] Feed screenshot target identified: ${targetScreenshotUrl}`);
    if (!skipTikTok) {
      logMessage('[Daily Social] Tip: use --tiktok-only to capture the ordered 9:16 slideshow kit and voice-over.');
    }
    // Dry-run validate against Bluesky bot limits
    sendToBluesky(posts.bluesky_post, { dryRun: true });
  } else {
    const mediaItems = [];

    if (tiktokKit) {
      mediaItems.push(
        ...tiktokKit.slides.map((slide) => ({
          path: slide.path,
          caption:
            `🎵 *TikTok Slide ${slide.order}/${tiktokKit.slides.length}* — ${slide.on_screen_text}\n` +
            `🎙️ VO: ${slide.voiceover}\n` +
            `⏱️ ~${slide.duration_seconds}s • 9:16 • Post in this exact order\n` +
            `🌐 ${project.url}`
        }))
      );
    }

    if (withGallery || !tiktokKit) {
      mediaItems.push(...galleryScreenshots);
    }

    // Deliver the ordered TikTok slideshow (and optional gallery) + complete post kit
    logMessage(`[WhatsApp] Delivering ${mediaItems.length} visual asset(s) + post kit to ${forcedTarget || TARGET_PHONE_NUMBER}...`);
    await sendToWhatsApp(whatsappMessage, forcedTarget || TARGET_PHONE_NUMBER, mediaItems);

    // Optional direct Bluesky integration
    let blueskyResult = null;
    if (isBlueskyPost || (process.env.BLUESKY_AUTO_POST === 'true' && isSend)) {
      blueskyResult = sendToBluesky(posts.bluesky_post);
    } else if (blueskySchedule) {
      blueskyResult = sendToBluesky(posts.bluesky_post, { schedule: blueskySchedule });
    }

    // Update history
    history.last_run_timestamp = new Date().toISOString();
    history.last_project_id = project.id;
    history.history.push({
      date: new Date().toISOString().split('T')[0],
      project_id: project.id,
      project_name: project.name,
      title: article ? decodeHtmlEntities(article.title.rendered) : project.name,
      link: article ? article.link : project.url,
      sent_to: forcedTarget || TARGET_PHONE_NUMBER,
      screenshots: galleryScreenshots.map(s => path.basename(s.path)),
      tiktok_slides: tiktokKit ? tiktokKit.slides.map(s => path.basename(s.path)) : [],
      tiktok_duration_seconds: tiktokKit ? tiktokKit.total_duration_seconds : null,
      tiktok_persona: tiktokKit ? tiktokKit.persona : null,
      tiktok_authenticated: tiktokKit ? Boolean(tiktokKit.authenticated) : null,
      bluesky: blueskyResult ? (blueskyResult.uri || blueskyResult.id || 'dispatched') : null
    });
    // Keep last 100 history items
    if (history.history.length > 100) {
      history.history = history.history.slice(-100);
    }
    saveHistory(history);
    logMessage(`[Daily Social] Successfully finished and logged run for ${project.id}.`);
  }
  releaseProcessLock();
}

if (require.main === module) {
  run().catch(err => {
    logMessage(`[FATAL] Error in daily social script: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  run,
  generateSocialPosts,
  buildWhatsAppMessage,
  selectNextProject,
  sendToBluesky,
  capturePageScreenshot,
  captureProjectScreenshots,
  captureTikTokSlideshow,
  generateTikTokStoryboard,
  buildTikTokOnlyMessage,
  formatTikTokKit,
  buildFallbackTikTokStoryboard,
  sendToWhatsApp,
  decodeUnicodeAndEmoticons,
  cleanJsonString
};
