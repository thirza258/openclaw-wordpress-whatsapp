'use strict';

const { getSocialProvider } = require('../../providers/social');
const { Publications } = require('../../db/models');
const logger = require('../../utils/logger').child('SocialTools');

/**
 * Typed Social Tool API (PRD Section 29)
 */
const SocialTools = {
  /**
   * Idempotent social post publisher
   */
  async publish({ campaignId, channel, content, mediaUrls = [] }) {
    const idempotencyKey = `${campaignId}:${channel}:post`;
    const existing = await Publications.findByIdempotencyKey(idempotencyKey);
    if (existing && existing.status === 'published') {
      logger.info(`Idempotency check: Social post already published on ${channel} for ${idempotencyKey}`, {
        url: existing.external_url,
      });
      return existing;
    }

    const provider = getSocialProvider(channel);
    const validation = await provider.validate({ text: content, mediaUrls });
    if (!validation.valid) {
      throw new Error(`Social validation error for ${channel}: ${validation.issues.join('; ')}`);
    }

    try {
      const pub = await provider.publish({ text: content, mediaUrls }, { idempotencyKey });
      await Publications.record({
        campaignId,
        channel,
        idempotencyKey,
        externalId: pub.id,
        externalUrl: pub.url,
        status: 'published',
        payload: pub,
      });
      return pub;
    } catch (err) {
      await Publications.record({
        campaignId,
        channel,
        idempotencyKey,
        status: 'failed',
        error: err.message,
      });
      throw err;
    }
  },

  /**
   * Compensating action: Delete or withdraw social post
   */
  async rollback({ campaignId, channel, externalId }) {
    const provider = getSocialProvider(channel);
    try {
      await provider.delete(externalId);
    } catch (e) {
      logger.warn(`Could not delete remote social post on ${channel}: ${e.message}`);
    }

    const idempotencyKey = `${campaignId}:${channel}:post`;
    await Publications.record({
      campaignId,
      channel,
      idempotencyKey,
      externalId,
      status: 'withdrawn',
      error: 'Compensating rollback action executed',
    });
    return { success: true, status: 'withdrawn' };
  },
};

module.exports = SocialTools;
