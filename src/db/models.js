'use strict';

const db = require('./index');
const crypto = require('crypto');

function genId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

const Projects = {
  async getById(id) {
    const row = await db.get('SELECT * FROM projects WHERE id = ?', [id]);
    if (!row) return null;
    return {
      ...row,
      target_audience: row.target_audience ? JSON.parse(row.target_audience) : [],
      keywords: row.keywords ? JSON.parse(row.keywords) : [],
      competitors: row.competitors ? JSON.parse(row.competitors) : [],
    };
  },

  async getAll(activeOnly = true) {
    const sql = activeOnly ? 'SELECT * FROM projects WHERE active = 1 ORDER BY name ASC' : 'SELECT * FROM projects ORDER BY name ASC';
    const rows = await db.all(sql);
    return rows.map((r) => ({
      ...r,
      target_audience: r.target_audience ? JSON.parse(r.target_audience) : [],
      keywords: r.keywords ? JSON.parse(r.keywords) : [],
      competitors: r.competitors ? JSON.parse(r.competitors) : [],
    }));
  },

  async upsert(proj) {
    const now = new Date().toISOString();
    const existing = await db.get('SELECT id FROM projects WHERE id = ?', [proj.id]);
    if (existing) {
      await db.run(
        `UPDATE projects SET
          name = ?, description = ?, url = ?, repository = ?, wordpress_category = ?,
          target_audience = ?, keywords = ?, competitors = ?, brand_voice = ?, active = ?, updated_at = ?
         WHERE id = ?`,
        [
          proj.name,
          proj.description || '',
          proj.url || '',
          proj.repository || '',
          proj.wordpress_category || 'Software Architecture & Engineering',
          JSON.stringify(proj.target_audience || []),
          JSON.stringify(proj.keywords || []),
          JSON.stringify(proj.competitors || []),
          proj.brand_voice || '',
          proj.active !== undefined ? (proj.active ? 1 : 0) : 1,
          now,
          proj.id,
        ]
      );
    } else {
      await db.run(
        `INSERT INTO projects (
          id, name, description, url, repository, wordpress_category,
          target_audience, keywords, competitors, brand_voice, active,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          proj.id,
          proj.name,
          proj.description || '',
          proj.url || '',
          proj.repository || '',
          proj.wordpress_category || 'Software Architecture & Engineering',
          JSON.stringify(proj.target_audience || []),
          JSON.stringify(proj.keywords || []),
          JSON.stringify(proj.competitors || []),
          proj.brand_voice || '',
          proj.active !== undefined ? (proj.active ? 1 : 0) : 1,
          now,
          now,
        ]
      );
    }
    return this.getById(proj.id);
  },
};

const Campaigns = {
  // Campaign Lifecycle State Machine
  STATES: {
    DRAFT: 'DRAFT',
    RESEARCHING: 'RESEARCHING',
    PLANNED: 'PLANNED',
    CONTENT_GENERATING: 'CONTENT_GENERATING',
    QUALITY_REVIEW: 'QUALITY_REVIEW',
    ASSETS_GENERATING: 'ASSETS_GENERATING',
    READY_FOR_APPROVAL: 'READY_FOR_APPROVAL',
    APPROVED: 'APPROVED',
    SCHEDULED: 'SCHEDULED',
    PUBLISHING: 'PUBLISHING',
    PUBLISHED: 'PUBLISHED',
    ANALYZING: 'ANALYZING',
    OPTIMIZATION_PROPOSED: 'OPTIMIZATION_PROPOSED',
    OPTIMIZATION_APPROVED: 'OPTIMIZATION_APPROVED',
    OPTIMIZING: 'OPTIMIZING',
    FAILED: 'FAILED',
    CANCELLED: 'CANCELLED',
  },

  async create({ projectId, planMode = false, metadata = {} }) {
    const id = genId('cmp');
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO campaigns (id, project_id, status, current_step, plan_mode, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        projectId,
        'DRAFT',
        'INITIALIZED',
        planMode ? 1 : 0,
        JSON.stringify(metadata),
        now,
        now,
      ]
    );
    return this.getById(id);
  },

  async getById(id) {
    const row = await db.get('SELECT * FROM campaigns WHERE id = ?', [id]);
    if (!row) return null;
    return {
      ...row,
      plan_mode: Boolean(row.plan_mode),
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
    };
  },

  async updateStatus(id, status, step = null) {
    const now = new Date().toISOString();
    await db.run(
      `UPDATE campaigns SET status = ?, current_step = COALESCE(?, current_step), updated_at = ? WHERE id = ?`,
      [status, step, now, id]
    );
    return this.getById(id);
  },

  async recordCost(id, costUsd, tokens) {
    const now = new Date().toISOString();
    await db.run(
      `UPDATE campaigns SET total_ai_cost = total_ai_cost + ?, total_tokens = total_tokens + ?, updated_at = ? WHERE id = ?`,
      [costUsd, tokens, now, id]
    );
  },

  async list(limit = 20) {
    const rows = await db.all('SELECT * FROM campaigns ORDER BY created_at DESC LIMIT ?', [limit]);
    return rows.map((r) => ({
      ...r,
      plan_mode: Boolean(r.plan_mode),
      metadata: r.metadata ? JSON.parse(r.metadata) : {},
    }));
  },
};

const CampaignBriefs = {
  async create({ campaignId, objective, primaryMessage, targetAudience = [], targetKeywords = [], channels = ['wordpress', 'bluesky'], callToAction = '', constraints = [] }) {
    const id = genId('brf');
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO campaign_briefs (
        id, campaign_id, objective, primary_message, target_audience,
        target_keywords, channels, call_to_action, constraints, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        campaignId,
        objective,
        primaryMessage,
        JSON.stringify(targetAudience),
        JSON.stringify(targetKeywords),
        JSON.stringify(channels),
        callToAction,
        JSON.stringify(constraints),
        now,
      ]
    );
    return this.getByCampaignId(campaignId);
  },

  async getByCampaignId(campaignId) {
    const row = await db.get('SELECT * FROM campaign_briefs WHERE campaign_id = ? ORDER BY created_at DESC LIMIT 1', [campaignId]);
    if (!row) return null;
    return {
      ...row,
      target_audience: row.target_audience ? JSON.parse(row.target_audience) : [],
      target_keywords: row.target_keywords ? JSON.parse(row.target_keywords) : [],
      channels: row.channels ? JSON.parse(row.channels) : [],
      constraints: row.constraints ? JSON.parse(row.constraints) : [],
    };
  },
};

const Research = {
  async addSource({ campaignId, url, title, snippet, confidence = 1.0, metadata = {} }) {
    const id = genId('src');
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO research_sources (id, campaign_id, url, title, content_snippet, retrieved_at, confidence, raw_metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, campaignId, url || '', title || '', snippet || '', now, confidence, JSON.stringify(metadata)]
    );
    return id;
  },

  async addFact({ campaignId, sourceId, fact, sourceUrl, category = 'feature', confidence = 1.0 }) {
    const id = genId('fct');
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO research_facts (id, campaign_id, source_id, fact, source_url, category, confidence, retrieved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, campaignId, sourceId || null, fact, sourceUrl || '', category, confidence, now]
    );
    return id;
  },

  async getPack(campaignId) {
    const sources = await db.all('SELECT * FROM research_sources WHERE campaign_id = ?', [campaignId]);
    const facts = await db.all('SELECT * FROM research_facts WHERE campaign_id = ?', [campaignId]);
    return {
      sources: sources.map((s) => ({ ...s, raw_metadata: s.raw_metadata ? JSON.parse(s.raw_metadata) : {} })),
      facts,
    };
  },
};

const Content = {
  async create({ campaignId, title, focusKeyphrase, metaDescription, slug, excerpt, contentHtml, wordCount = 0, readingTime = 1, internalLinks = [], citations = [] }) {
    const id = genId('cnt');
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO content (
        id, campaign_id, title, focus_keyphrase, meta_description, slug,
        excerpt, content_html, word_count, reading_time, internal_links,
        citations, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      [
        id,
        campaignId,
        title,
        focusKeyphrase || '',
        metaDescription || '',
        slug || '',
        excerpt || '',
        contentHtml,
        wordCount,
        readingTime,
        JSON.stringify(internalLinks),
        JSON.stringify(citations),
        now,
        now,
      ]
    );
    return this.getById(id);
  },

  async getById(id) {
    const row = await db.get('SELECT * FROM content WHERE id = ?', [id]);
    if (!row) return null;
    return {
      ...row,
      internal_links: row.internal_links ? JSON.parse(row.internal_links) : [],
      citations: row.citations ? JSON.parse(row.citations) : [],
    };
  },

  async getByCampaignId(campaignId) {
    const row = await db.get('SELECT * FROM content WHERE campaign_id = ? ORDER BY created_at DESC LIMIT 1', [campaignId]);
    if (!row) return null;
    return {
      ...row,
      internal_links: row.internal_links ? JSON.parse(row.internal_links) : [],
      citations: row.citations ? JSON.parse(row.citations) : [],
    };
  },

  async updateHtml(id, newHtml, newWordCount) {
    const now = new Date().toISOString();
    await db.run('UPDATE content SET content_html = ?, word_count = ?, updated_at = ? WHERE id = ?', [newHtml, newWordCount, now, id]);
  },

  async addVariant({ campaignId, contentId, channel, variantType, textContent, mediaRefs = [], metadata = {} }) {
    const id = genId('var');
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO content_variants (id, campaign_id, content_id, channel, variant_type, text_content, media_refs, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, campaignId, contentId || null, channel, variantType || 'post', textContent, JSON.stringify(mediaRefs), JSON.stringify(metadata), now]
    );
    return id;
  },

  async getVariants(campaignId) {
    const rows = await db.all('SELECT * FROM content_variants WHERE campaign_id = ?', [campaignId]);
    return rows.map((r) => ({
      ...r,
      media_refs: r.media_refs ? JSON.parse(r.media_refs) : [],
      metadata: r.metadata ? JSON.parse(r.metadata) : {},
    }));
  },
};

const QualityReviews = {
  async record({ campaignId, contentId, factuality, technicalAccuracy, seo, readability, originality, brandAlignment, passed, feedback = [] }) {
    const id = genId('rev');
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO quality_reviews (
        id, campaign_id, content_id, factuality, technical_accuracy, seo,
        readability, originality, brand_alignment, passed, feedback, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        campaignId,
        contentId,
        factuality,
        technicalAccuracy,
        seo,
        readability,
        originality,
        brandAlignment,
        passed ? 1 : 0,
        JSON.stringify(feedback),
        now,
      ]
    );
    return id;
  },

  async getLatestForCampaign(campaignId) {
    const row = await db.get('SELECT * FROM quality_reviews WHERE campaign_id = ? ORDER BY created_at DESC LIMIT 1', [campaignId]);
    if (!row) return null;
    return {
      ...row,
      passed: Boolean(row.passed),
      feedback: row.feedback ? JSON.parse(row.feedback) : [],
    };
  },
};

const Assets = {
  async add({ campaignId, assetType, filePath, remoteUrl = '', wpMediaId = null, mimeType = 'image/png', fileSize = 0, metadata = {} }) {
    const id = genId('ast');
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO assets (id, campaign_id, asset_type, file_path, remote_url, wp_media_id, mime_type, file_size, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, campaignId, assetType, filePath, remoteUrl, wpMediaId, mimeType, fileSize, JSON.stringify(metadata), now]
    );
    return id;
  },

  async getByCampaignId(campaignId) {
    const rows = await db.all('SELECT * FROM assets WHERE campaign_id = ?', [campaignId]);
    return rows.map((r) => ({
      ...r,
      metadata: r.metadata ? JSON.parse(r.metadata) : {},
    }));
  },
};

const Approvals = {
  async request({ campaignId, channel = 'whatsapp', notes = '' }) {
    const id = genId('appr');
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO approvals (id, campaign_id, status, requested_at, channel, notes)
       VALUES (?, ?, 'pending', ?, ?, ?)`,
      [id, campaignId, now, channel, notes]
    );
    return id;
  },

  async respond({ campaignId, status, responderId = null, notes = '' }) {
    const now = new Date().toISOString();
    await db.run(
      `UPDATE approvals SET status = ?, responded_at = ?, responder_id = ?, notes = ?
       WHERE campaign_id = ? AND status = 'pending'`,
      [status, now, responderId, notes, campaignId]
    );
  },

  async getLatest(campaignId) {
    return db.get('SELECT * FROM approvals WHERE campaign_id = ? ORDER BY requested_at DESC LIMIT 1', [campaignId]);
  },
};

const Publications = {
  async findByIdempotencyKey(key) {
    const row = await db.get('SELECT * FROM publications WHERE idempotency_key = ?', [key]);
    if (!row) return null;
    return {
      ...row,
      payload: row.payload ? JSON.parse(row.payload) : {},
    };
  },

  async record({ campaignId, channel, idempotencyKey, externalId = null, externalUrl = null, status, payload = {}, error = null }) {
    const existing = await this.findByIdempotencyKey(idempotencyKey);
    const now = new Date().toISOString();
    if (existing) {
      await db.run(
        `UPDATE publications SET
          status = ?,
          external_id = COALESCE(?, external_id),
          external_url = COALESCE(?, external_url),
          payload = ?,
          error = ?,
          published_at = CASE WHEN ? = 'published' THEN ? ELSE published_at END
         WHERE idempotency_key = ?`,
        [
          status,
          externalId,
          externalUrl,
          JSON.stringify(payload),
          error ? String(error) : null,
          status,
          now,
          idempotencyKey,
        ]
      );
      return existing.id;
    }

    const id = genId('pub');
    await db.run(
      `INSERT INTO publications (id, campaign_id, channel, idempotency_key, external_id, external_url, status, payload, published_at, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        campaignId,
        channel,
        idempotencyKey,
        externalId,
        externalUrl,
        status,
        JSON.stringify(payload),
        status === 'published' ? now : null,
        error ? String(error) : null,
      ]
    );
    return id;
  },

  async getByCampaignId(campaignId) {
    const rows = await db.all('SELECT * FROM publications WHERE campaign_id = ?', [campaignId]);
    return rows.map((r) => ({
      ...r,
      payload: r.payload ? JSON.parse(r.payload) : {},
    }));
  },
};

const ExecutionLogs = {
  async log({ jobId = null, campaignId = null, tool, status, durationMs = 0, startedAt, finishedAt, error = null, metadata = {} }) {
    const id = genId('log');
    await db.run(
      `INSERT INTO execution_logs (id, job_id, campaign_id, tool, status, duration_ms, started_at, finished_at, error, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        jobId,
        campaignId,
        tool,
        status,
        durationMs,
        startedAt || new Date().toISOString(),
        finishedAt || new Date().toISOString(),
        error ? String(error) : null,
        JSON.stringify(metadata),
      ]
    );
    return id;
  },
};

module.exports = {
  genId,
  Projects,
  Campaigns,
  CampaignBriefs,
  Research,
  Content,
  QualityReviews,
  Assets,
  Approvals,
  Publications,
  ExecutionLogs,
};
