'use strict';

const BaseSocialProvider = require('./base');
const config = require('../../config');
const { spawnSync } = require('child_process');
const fs = require('fs');
const logger = require('../../utils/logger').child('BlueskyProvider');

class BlueskyProvider extends BaseSocialProvider {
  constructor() {
    super('bluesky');
    this.botCli = config.social.bluesky.botCli;
  }

  async validate(content) {
    const issues = [];
    if (!content || !content.text) {
      issues.push('Bluesky post content is missing');
    } else if (content.text.length > 300) {
      issues.push(`Bluesky post exceeds 300 characters limit (actual: ${content.text.length})`);
    }
    return {
      valid: issues.length === 0,
      issues,
    };
  }

  async publish(content, options = {}) {
    logger.info('Publishing to Bluesky...', { idempotencyKey: options.idempotencyKey });

    const validation = await this.validate(content);
    if (!validation.valid) {
      throw new Error(`Bluesky validation failed: ${validation.issues.join(', ')}`);
    }

    if (!fs.existsSync(this.botCli)) {
      logger.warn(`Bluesky CLI not found at ${this.botCli}. Simulating publication for dry-run/development.`);
      const mockId = `bsky_${Date.now()}`;
      return {
        id: mockId,
        url: `https://bsky.app/profile/mock/post/${mockId}`,
        status: 'published',
        mock: true,
      };
    }

    // Call bluesky bot CLI
    const args = ['post', content.text];
    if (content.mediaUrls && content.mediaUrls.length > 0) {
      args.push('--image', content.mediaUrls[0]);
    }

    const res = spawnSync(process.execPath, [this.botCli, ...args], {
      encoding: 'utf8',
      env: process.env,
      timeout: 30000,
    });

    if (res.status !== 0) {
      throw new Error(`Bluesky publish failed: ${res.stderr || res.stdout}`);
    }

    const output = (res.stdout || '').trim();
    const uriMatch = output.match(/at:\/\/([^\s]+)/) || output.match(/https?:\/\/[^\s]+/);
    const postUrl = uriMatch ? uriMatch[0] : `https://bsky.app/post/${Date.now()}`;

    return {
      id: `bsky_${Date.now()}`,
      url: postUrl,
      status: 'published',
      rawOutput: output,
    };
  }

  async delete(id) {
    logger.info(`Bluesky delete requested for: ${id}`);
    // If CLI supports delete, invoke it here
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

module.exports = new BlueskyProvider();
module.exports.BlueskyProvider = BlueskyProvider;
