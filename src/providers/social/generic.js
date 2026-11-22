'use strict';

const BaseSocialProvider = require('./base');
const logger = require('../../utils/logger');

class GenericSocialProvider extends BaseSocialProvider {
  constructor(channelName, charLimit = 280) {
    super(channelName);
    this.charLimit = charLimit;
    this.logger = logger.child(`${channelName}Provider`);
  }

  async validate(content) {
    const issues = [];
    if (!content || !content.text) {
      issues.push(`${this.name} post text cannot be empty`);
    } else if (content.text.length > this.charLimit) {
      issues.push(`${this.name} post exceeds ${this.charLimit} characters limit (length: ${content.text.length})`);
    }
    return {
      valid: issues.length === 0,
      issues,
    };
  }

  async publish(content, options = {}) {
    this.logger.info(`Staged publication for ${this.name}`, {
      idempotencyKey: options.idempotencyKey,
      preview: content.text.slice(0, 80),
    });

    // Production adapter stub - returns structured publication record
    const id = `${this.name}_pub_${Date.now()}`;
    return {
      id,
      url: `https://${this.name}.com/post/${id}`,
      status: 'published',
      channel: this.name,
      timestamp: new Date().toISOString(),
    };
  }

  async delete(id) {
    this.logger.info(`Delete / rollback requested for ${this.name} post: ${id}`);
  }

  async metrics(id) {
    return {
      views: 0,
      likes: 0,
      shares: 0,
      comments: 0,
      engagementRate: 0.0,
    };
  }
}

module.exports = {
  GenericSocialProvider,
  XProvider: new GenericSocialProvider('x', 280),
  ThreadsProvider: new GenericSocialProvider('threads', 500),
  FacebookProvider: new GenericSocialProvider('facebook', 2000),
  InstagramProvider: new GenericSocialProvider('instagram', 2200),
  TikTokProvider: new GenericSocialProvider('tiktok', 2200),
};
