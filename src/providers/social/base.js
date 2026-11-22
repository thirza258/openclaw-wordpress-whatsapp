'use strict';

/**
 * SocialProvider Base Interface (PRD Section 22)
 *
 * interface SocialProvider {
 *   validate(content): Promise<ValidationResult>
 *   publish(content): Promise<Publication>
 *   delete(id): Promise<void>
 *   metrics(id): Promise<Metrics>
 * }
 */
class BaseSocialProvider {
  constructor(channelName) {
    this.name = channelName;
  }

  /**
   * Validate content constraints (character limits, media format, tags)
   * @param {Object} content
   * @param {string} content.text
   * @param {Array<string>} [content.mediaUrls]
   * @returns {Promise<{valid: boolean, issues: Array<string>}>}
   */
  async validate(content) {
    const issues = [];
    if (!content || !content.text) {
      issues.push('Content text is empty');
    }
    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Publish content to the social network
   * @param {Object} content
   * @param {Object} options
   * @param {string} options.idempotencyKey
   * @returns {Promise<{id: string, url: string, status: string}>}
   */
  async publish(content, options = {}) {
    throw new Error(`publish() not implemented for provider ${this.name}`);
  }

  /**
   * Delete or withdraw published post (Compensating rollback action - PRD Section 34)
   * @param {string} id
   * @returns {Promise<void>}
   */
  async delete(id) {
    throw new Error(`delete() not implemented for provider ${this.name}`);
  }

  /**
   * Fetch post metrics (impressions, likes, reposts, comments)
   * @param {string} id
   * @returns {Promise<{views: number, likes: number, shares: number, comments: number, engagementRate: number}>}
   */
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

module.exports = BaseSocialProvider;
