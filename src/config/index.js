'use strict';

const fs = require('fs');
const path = require('path');

function loadEnvFiles() {
  const envCandidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../../../../.env'),
    path.resolve('/home/thirzq/.openclaw/workspace/skills/wordpress/.env'),
    path.resolve(process.env.HOME || '', '.openclaw/workspace/skills/wordpress/.env'),
    path.resolve(process.env.HOME || '', '.openclaw/.env'),
  ];

  for (const envPath of envCandidates) {
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx !== -1) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"](.*)['"]$/, '$1');
            if (process.env[key] === undefined) {
              process.env[key] = val;
            }
          }
        }
      } catch (err) {
        // ignore unreadable env files
      }
    }
  }
}

loadEnvFiles();

/**
 * Normalizes phone numbers to standard E.164-like format (e.g. +6281290765711)
 * Strips non-digits except leading +
 */
function normalizeE164(phone) {
  if (!phone || typeof phone !== 'string') return '';
  let cleaned = phone.trim().replace(/[^\d+]/g, '');
  if (!cleaned) return '';
  if (!cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;
  }
  return cleaned;
}

function parseAuthorizedNumbers(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((s) => normalizeE164(s))
    .filter(Boolean);
}

const config = {
  env: process.env.NODE_ENV || 'production',
  
  // WordPress REST API
  wordpress: {
    baseUrl: (process.env.WP_BASE_URL || 'http://localhost:8085').replace(/\/$/, ''),
    user: process.env.WP_USER || 'admin',
    appPassword: process.env.WP_APP_PASSWORD || '',
    basicToken: process.env.WP_BASIC_TOKEN || '',
    jwtToken: process.env.WP_JWT_TOKEN || '',
    timeoutMs: parseInt(process.env.WP_TIMEOUT_MS || '60000', 10),
  },

  // OpenRouter & LLMs
  llm: {
    openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
    defaultProvider: process.env.LLM_PROVIDER || 'openrouter',
    primaryModel: process.env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it',
    models: {
      research: process.env.MODEL_RESEARCH || 'google/gemma-4-26b-a4b-it',
      article: process.env.MODEL_ARTICLE || 'google/gemma-4-26b-a4b-it',
      social: process.env.MODEL_SOCIAL || 'google/gemma-4-26b-a4b-it',
      scoring: process.env.MODEL_SCORING || 'cohere/north-mini-code:free',
      review: process.env.MODEL_REVIEW || 'google/gemma-4-26b-a4b-it',
    },
    freeModelsPool: [
      'openrouter/free',
      'google/gemma-4-26b-a4b-it:free',
      'google/gemma-4-31b-it:free',
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'nvidia/nemotron-3.5-lightning:free',
    ],
    maxTokens: parseInt(process.env.MAX_AI_TOKENS_PER_CAMPAIGN || '150000', 10),
    maxCostUsd: parseFloat(process.env.MAX_AI_COST_PER_CAMPAIGN || '2.00'),
  },

  // WhatsApp & Authorization
  whatsapp: {
    targetPhoneNumber: normalizeE164(process.env.TARGET_PHONE_NUMBER || ''),
    authorizedNumbers: parseAuthorizedNumbers(
      process.env.AUTHORIZED_NUMBERS || process.env.TARGET_PHONE_NUMBER || ''
    ),
    openclawBin: process.env.OPENCLAW_BIN || 'openclaw',
  },

  // Social Providers
  social: {
    bluesky: {
      botCli: process.env.BLUESKY_BOT_CLI || '/home/thirzq/bluesky-bot/src/cli.js',
      autoPost: process.env.BLUESKY_AUTO_POST === 'true',
    },
  },

  // Database
  database: {
    postgresUrl: process.env.DATABASE_URL || process.env.POSTGRES_URL || '',
    sqlitePath: process.env.SQLITE_PATH || path.resolve(__dirname, '../../marketing.sqlite'),
  },

  // Queue & Concurrency
  queue: {
    redisUrl: process.env.REDIS_URL || '',
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || '5', 10),
  },

  // Catalog & Directories
  paths: {
    root: path.resolve(__dirname, '../..'),
    catalog: path.resolve(__dirname, '../../scripts/project_catalog.json'),
    screenshots: path.resolve(__dirname, '../../screenshots'),
    archive: [
      path.resolve(process.env.HOME || '', '.openclaw/archive'),
      path.resolve(__dirname, '../../archive'),
      path.resolve(__dirname, '../../../../archive'),
    ],
  },
};

module.exports = config;
module.exports.normalizeE164 = normalizeE164;
module.exports.loadEnvFiles = loadEnvFiles;
