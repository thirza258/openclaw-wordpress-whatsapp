'use strict';

const wpService = require('../../providers/wordpress');
const { Publications } = require('../../db/models');
const logger = require('../../utils/logger').child('WordPressTools');

/**
 * Typed WordPress Tool API (PRD Section 29)
 */
const WordPressTools = {
  /**
   * Create an article draft or publish on WordPress with idempotency checks
   */
  async createDraft({ campaignId, title, contentHtml, slug, excerpt, focusKeyphrase, metaDescription, category, tags = [], featuredMediaId = 0 }) {
    logger.info(`Creating WordPress post draft for campaign ${campaignId}...`);

    const categoryId = category ? await wpService.ensureCategory(category) : null;
    const tagIds = [];
    for (const tag of tags) {
      const tid = await wpService.ensureTag(tag);
      if (tid) tagIds.push(tid);
    }

    const postPayload = {
      title,
      content: contentHtml,
      status: 'draft',
      slug,
      excerpt,
      categories: categoryId ? [categoryId] : [],
      tags: tagIds,
      featured_media: featuredMediaId || 0,
      meta: {
        _yoast_wpseo_focuskw: focusKeyphrase || '',
        _yoast_wpseo_metadesc: metaDescription || '',
        _yoast_wpseo_title: title,
      },
    };

    const post = await wpService.createPost(postPayload);
    return post;
  },

  /**
   * Idempotent WordPress publication
   */
  async publish({ campaignId, postId }) {
    const idempotencyKey = `${campaignId}:wordpress:article`;
    const existing = await Publications.findByIdempotencyKey(idempotencyKey);
    if (existing && existing.status === 'published') {
      logger.info(`Idempotency check: Post already published for key ${idempotencyKey}`, {
        externalUrl: existing.external_url,
      });
      return existing;
    }

    logger.info(`Publishing WordPress post #${postId}...`);
    try {
      const published = await wpService.publish(postId);
      const postUrl = published.link || `${wpService.baseUrl}/?p=${postId}`;

      await Publications.record({
        campaignId,
        channel: 'wordpress',
        idempotencyKey,
        externalId: String(postId),
        externalUrl: postUrl,
        status: 'published',
        payload: { postId, link: postUrl },
      });

      return {
        id: postId,
        url: postUrl,
        status: 'published',
      };
    } catch (err) {
      await Publications.record({
        campaignId,
        channel: 'wordpress',
        idempotencyKey,
        externalId: String(postId),
        status: 'failed',
        error: err.message,
      });
      throw err;
    }
  },

  /**
   * Rollback / unpublish WordPress article
   */
  async rollback({ campaignId, postId }) {
    logger.info(`Compensating rollback action for WordPress post #${postId}...`);
    await wpService.updatePost(postId, { status: 'draft' });
    const idempotencyKey = `${campaignId}:wordpress:article`;
    const pub = await Publications.findByIdempotencyKey(idempotencyKey);
    if (pub) {
      await Publications.record({
        campaignId,
        channel: 'wordpress',
        idempotencyKey,
        externalId: String(postId),
        status: 'withdrawn',
        error: 'Compensating rollback: post status returned to draft',
      });
    }
    return { success: true, status: 'withdrawn' };
  },
};

module.exports = WordPressTools;
