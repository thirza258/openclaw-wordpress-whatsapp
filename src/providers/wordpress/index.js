'use strict';

const config = require('../../config');
const logger = require('../../utils/logger').child('WordPressService');
const { execSync } = require('child_process');

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

class WordPressService {
  constructor() {
    this.baseUrl = config.wordpress.baseUrl;
    this.user = config.wordpress.user;
    this.appPassword = config.wordpress.appPassword;
    this.basicToken = config.wordpress.basicToken;
    this.jwtToken = config.wordpress.jwtToken;
    this.timeoutMs = config.wordpress.timeoutMs;
    this.categoryCache = new Map();
    this.tagCache = new Map();
  }

  getAuthHeader() {
    if (this.basicToken) {
      return { Authorization: `Basic ${this.basicToken}` };
    }
    if (this.user && this.appPassword) {
      const token = Buffer.from(`${this.user}:${this.appPassword}`).toString('base64');
      return { Authorization: `Basic ${token}` };
    }
    if (this.jwtToken) {
      return { Authorization: `Bearer ${this.jwtToken}` };
    }
    return {};
  }

  async request(endpoint, { method = 'GET', body = null, query = {}, timeoutMs = null } = {}) {
    const url = new URL(`${this.baseUrl}/wp-json/wp/v2${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`);
    Object.entries(query).forEach(([k, v]) => url.searchParams.append(k, v));

    const headers = {
      Accept: 'application/json',
      ...this.getAuthHeader(),
    };

    const options = {
      method,
      headers,
      signal: AbortSignal.timeout(timeoutMs || this.timeoutMs),
    };

    if (body) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    logger.debug(`WP Request: ${method} ${url.pathname}`);
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
  }

  async createPost(payload) {
    logger.info(`Creating WordPress post: "${payload.title}" (${payload.status || 'draft'})...`);
    const res = await this.request('/posts', {
      method: 'POST',
      body: payload,
    });
    return res;
  }

  async updatePost(id, payload) {
    logger.info(`Updating WordPress post #${id}...`);
    return this.request(`/posts/${id}`, {
      method: 'POST',
      body: payload,
    });
  }

  async deletePost(id, force = true) {
    logger.info(`Deleting WordPress post #${id} (force=${force})...`);
    return this.request(`/posts/${id}`, {
      method: 'DELETE',
      query: { force: String(force) },
    });
  }

  async getPost(id) {
    return this.request(`/posts/${id}`);
  }

  async listPosts(query = {}) {
    return this.request('/posts', { query });
  }

  async uploadMedia(fileBuffer, filename, { title = '', alt = '', caption = '', mimeType = 'image/png' } = {}) {
    logger.info(`Uploading media to WordPress: ${filename} (${(fileBuffer.length / 1024).toFixed(1)} KB)...`);
    const url = new URL(`${this.baseUrl}/wp-json/wp/v2/media`);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.getAuthHeader(),
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Type': mimeType,
      },
      body: fileBuffer,
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`WordPress media upload failed (${res.status}): ${errText}`);
    }

    const media = await res.json();
    const mediaId = media.id;

    if (title || alt || caption) {
      try {
        await this.request(`/media/${mediaId}`, {
          method: 'POST',
          body: {
            title: title || filename,
            alt_text: alt || title || '',
            caption: caption || '',
          },
        });
      } catch (e) {
        logger.warn(`Could not update metadata for media #${mediaId}: ${e.message}`);
      }
    }

    return media;
  }

  async attachFeaturedImage(postId, mediaId) {
    logger.info(`Attaching featured image #${mediaId} to post #${postId}...`);
    return this.updatePost(postId, { featured_media: mediaId });
  }

  async setSEO(postId, { focusKeyword, seoTitle, metaDescription }) {
    logger.info(`Setting SEO metadata for post #${postId}...`);
    return this.updatePost(postId, {
      meta: {
        _yoast_wpseo_focuskw: focusKeyword || '',
        _yoast_wpseo_title: seoTitle || '',
        _yoast_wpseo_metadesc: metaDescription || '',
      },
    });
  }

  async ensureCategory(name) {
    if (!name) return null;
    const normalized = decodeHtmlEntities(name).trim().toLowerCase();
    if (this.categoryCache.has(normalized)) {
      return this.categoryCache.get(normalized);
    }

    try {
      const existing = await this.request('/categories', { query: { search: name, per_page: 10 } });
      const match = existing.find((c) => decodeHtmlEntities(c.name).toLowerCase() === normalized);
      if (match) {
        this.categoryCache.set(normalized, match.id);
        return match.id;
      }

      const created = await this.request('/categories', {
        method: 'POST',
        body: { name, description: `Articles and guides for ${name}` },
      });
      this.categoryCache.set(normalized, created.id);
      return created.id;
    } catch (err) {
      const errStr = JSON.stringify(err.data || err.message || '');
      const match = errStr.match(/"term_id":\s*(\d+)/);
      if (match) {
        const tid = parseInt(match[1], 10);
        this.categoryCache.set(normalized, tid);
        return tid;
      }
      logger.warn(`Warning ensuring category "${name}": ${err.message}`);
      return null;
    }
  }

  async ensureTag(name) {
    if (!name) return null;
    const normalized = decodeHtmlEntities(name).trim().toLowerCase();
    if (this.tagCache.has(normalized)) {
      return this.tagCache.get(normalized);
    }

    try {
      const existing = await this.request('/tags', { query: { search: name, per_page: 10 } });
      const match = existing.find((t) => decodeHtmlEntities(t.name).toLowerCase() === normalized);
      if (match) {
        this.tagCache.set(normalized, match.id);
        return match.id;
      }

      const created = await this.request('/tags', {
        method: 'POST',
        body: { name },
      });
      this.tagCache.set(normalized, created.id);
      return created.id;
    } catch (err) {
      const errStr = JSON.stringify(err.data || err.message || '');
      const match = errStr.match(/"term_id":\s*(\d+)/);
      if (match) {
        const tid = parseInt(match[1], 10);
        this.tagCache.set(normalized, tid);
        return tid;
      }
      return null;
    }
  }

  async assignTaxonomy(postId, { categoryName, tags = [] }) {
    const categoryId = categoryName ? await this.ensureCategory(categoryName) : null;
    const tagIds = [];
    for (const tag of tags) {
      const tid = await this.ensureTag(tag);
      if (tid) tagIds.push(tid);
    }

    const payload = {};
    if (categoryId) payload.categories = [categoryId];
    if (tagIds.length > 0) payload.tags = tagIds;

    return this.updatePost(postId, payload);
  }

  async publish(postId) {
    logger.info(`Publishing post #${postId}...`);
    const res = await this.updatePost(postId, { status: 'publish' });
    this.syncYoastPost(postId);
    return res;
  }

  syncYoastPost(postId) {
    try {
      execSync(`docker exec wordpress php -d memory_limit=512M /var/www/html/resave-yoast-posts.php ${postId}`, {
        stdio: 'pipe',
        timeout: 15000,
      });
      logger.info(`Post #${postId} resaved and indexed in Yoast SEO`);
    } catch (e) {
      logger.warn(`Notice on Yoast SEO resave for post #${postId}: ${e.message}`);
    }
  }
}

module.exports = new WordPressService();
module.exports.WordPressService = WordPressService;
