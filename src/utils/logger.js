'use strict';

const fs = require('fs');
const path = require('path');

const LOG_FILE_PATH = path.resolve(__dirname, '../../platform.log');

/**
 * Mask sensitive values (passwords, tokens, keys) before logging
 */
function sanitizeForLogging(obj, depth = 0) {
  if (depth > 5) return '[Truncated]';
  if (!obj || typeof obj !== 'object') {
    if (typeof obj === 'string') {
      // Mask bearer tokens, app passwords, secret keys
      if (/sk-[a-zA-Z0-9_-]{20,}/.test(obj)) {
        return obj.replace(/sk-[a-zA-Z0-9_-]{20,}/g, 'sk-***[REDACTED]***');
      }
      if (/bearer\s+[a-zA-Z0-9._-]+/i.test(obj)) {
        return obj.replace(/bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer ***[REDACTED]***');
      }
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeForLogging(item, depth + 1));
  }

  const sanitized = {};
  const sensitiveKeys = new Set([
    'password',
    'apppassword',
    'wp_app_password',
    'openrouter_api_key',
    'apikey',
    'token',
    'secret',
    'authorization',
    'jwt',
  ]);

  for (const [key, val] of Object.entries(obj)) {
    if (sensitiveKeys.has(key.toLowerCase())) {
      sanitized[key] = '***[REDACTED]***';
    } else {
      sanitized[key] = sanitizeForLogging(val, depth + 1);
    }
  }
  return sanitized;
}

class Logger {
  constructor(context = 'App') {
    this.context = context;
  }

  format(level, message, meta = null) {
    const timestamp = new Date().toISOString();
    const cleanMeta = meta ? sanitizeForLogging(meta) : null;
    return {
      timestamp,
      level,
      context: this.context,
      message,
      ...(cleanMeta ? { meta: cleanMeta } : {}),
    };
  }

  _write(entry) {
    const jsonStr = JSON.stringify(entry);
    const textOut = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.context}] ${entry.message}${
      entry.meta ? ' ' + JSON.stringify(entry.meta) : ''
    }\n`;

    if (entry.level === 'error') {
      process.stderr.write(textOut);
    } else {
      process.stdout.write(textOut);
    }

    try {
      fs.appendFileSync(LOG_FILE_PATH, jsonStr + '\n', 'utf8');
    } catch (e) {
      // ignore file write errors
    }
  }

  info(msg, meta = null) {
    this._write(this.format('info', msg, meta));
  }

  warn(msg, meta = null) {
    this._write(this.format('warn', msg, meta));
  }

  error(msg, meta = null) {
    this._write(this.format('error', msg, meta));
  }

  debug(msg, meta = null) {
    if (process.env.DEBUG || process.env.NODE_ENV === 'development') {
      this._write(this.format('debug', msg, meta));
    }
  }

  child(subContext) {
    return new Logger(`${this.context}:${subContext}`);
  }
}

module.exports = new Logger('MarketingPlatform');
module.exports.Logger = Logger;
module.exports.sanitizeForLogging = sanitizeForLogging;
