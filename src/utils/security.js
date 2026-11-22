'use strict';

const config = require('../config');
const { normalizeE164 } = require('../config');

/**
 * FR-009 — Fail-Closed Authorization
 * If authorized numbers are not configured: DENY, not ALLOW.
 * Authorization must strictly use normalized E.164 phone numbers.
 */
function isSenderAuthorized(senderId) {
  // If invoked internally via CLI or automated system call without external sender
  if (!senderId || typeof senderId !== 'string') {
    return {
      authorized: false,
      reason: 'Missing sender ID (fail-closed)',
    };
  }

  const normalized = normalizeE164(senderId);
  const authorizedList = config.whatsapp.authorizedNumbers;

  // FAIL-CLOSED: If no authorized numbers configured, DENY ALL
  if (!authorizedList || authorizedList.length === 0) {
    return {
      authorized: false,
      reason: 'No authorized numbers configured on system (fail-closed rule FR-009 enforced)',
    };
  }

  const matches = authorizedList.some((authNum) => {
    return normalized === authNum || normalized.endsWith(authNum.replace(/^\+/, ''));
  });

  if (!matches) {
    return {
      authorized: false,
      reason: `Sender ${senderId} (${normalized}) is not in authorized allowlist`,
    };
  }

  return {
    authorized: true,
    normalizedSender: normalized,
  };
}

/**
 * Prompt injection defense: Wrap untrusted external content into isolated data tags.
 * Retain provenance and ensure LLM instructions cannot be hijacked.
 */
function sanitizeUntrustedData(content, label = 'UNTRUSTED_EXTERNAL_DATA') {
  if (!content || typeof content !== 'string') return '';
  // Strip control sequences that might mimic system delimiters
  const clean = content
    .replace(/<system>/gi, '&lt;system&gt;')
    .replace(/<\/system>/gi, '&lt;/system&gt;')
    .replace(/<\|im_start\|>/gi, '')
    .replace(/<\|im_end\|>/gi, '');

  return `\n<${label}>\n${clean}\n</${label}>\n`;
}

module.exports = {
  isSenderAuthorized,
  sanitizeUntrustedData,
};
