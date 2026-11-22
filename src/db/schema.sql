-- PostgreSQL & SQLite compatible Initial Schema for OpenClaw Marketing Operations Platform

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  url TEXT,
  repository TEXT,
  wordpress_category TEXT,
  target_audience TEXT, -- JSON array
  keywords TEXT,        -- JSON array
  competitors TEXT,     -- JSON array
  brand_voice TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  status TEXT NOT NULL, -- DRAFT, RESEARCHING, PLANNED, CONTENT_GENERATING, QUALITY_REVIEW, ASSETS_GENERATING, READY_FOR_APPROVAL, APPROVED, SCHEDULED, PUBLISHING, PUBLISHED, ANALYZING, OPTIMIZATION_PROPOSED, OPTIMIZATION_APPROVED, OPTIMIZING, FAILED, CANCELLED
  current_step TEXT,
  plan_mode INTEGER DEFAULT 0,
  total_ai_cost REAL DEFAULT 0.0,
  total_tokens INTEGER DEFAULT 0,
  metadata TEXT, -- JSON details
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS campaign_briefs (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  objective TEXT NOT NULL,
  primary_message TEXT NOT NULL,
  target_audience TEXT, -- JSON array
  target_keywords TEXT, -- JSON array
  channels TEXT,        -- JSON array: ["wordpress", "x", "bluesky", "threads", "tiktok", "whatsapp"]
  call_to_action TEXT,
  constraints TEXT,     -- JSON array
  created_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS research_sources (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  url TEXT,
  title TEXT,
  content_snippet TEXT,
  retrieved_at TEXT NOT NULL,
  confidence REAL DEFAULT 1.0,
  raw_metadata TEXT,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS research_facts (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  source_id TEXT,
  fact TEXT NOT NULL,
  source_url TEXT,
  category TEXT,
  confidence REAL DEFAULT 1.0,
  retrieved_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES research_sources(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS content (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  title TEXT NOT NULL,
  focus_keyphrase TEXT,
  meta_description TEXT,
  slug TEXT,
  excerpt TEXT,
  content_html TEXT NOT NULL,
  word_count INTEGER DEFAULT 0,
  reading_time INTEGER DEFAULT 1,
  internal_links TEXT, -- JSON
  citations TEXT,      -- JSON
  status TEXT DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS content_variants (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  content_id TEXT,
  channel TEXT NOT NULL, -- x, threads, bluesky, facebook, instagram, tiktok, whatsapp
  variant_type TEXT,
  text_content TEXT NOT NULL,
  media_refs TEXT, -- JSON array of asset paths/urls
  metadata TEXT,   -- JSON
  status TEXT DEFAULT 'draft',
  created_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (content_id) REFERENCES content(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quality_reviews (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  content_id TEXT,
  factuality REAL DEFAULT 0.0,
  technical_accuracy REAL DEFAULT 0.0,
  seo REAL DEFAULT 0.0,
  readability REAL DEFAULT 0.0,
  originality REAL DEFAULT 0.0,
  brand_alignment REAL DEFAULT 0.0,
  passed INTEGER DEFAULT 0,
  feedback TEXT, -- JSON list of issues & recommendations
  created_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (content_id) REFERENCES content(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  asset_type TEXT NOT NULL, -- desktop_screenshot, feature_screenshot, mobile_screenshot, featured_image, tiktok_slideshow
  file_path TEXT,
  remote_url TEXT,
  wp_media_id INTEGER,
  mime_type TEXT,
  file_size INTEGER,
  metadata TEXT, -- JSON
  created_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  status TEXT NOT NULL, -- pending, approved, rejected, cancelled
  requested_at TEXT NOT NULL,
  responded_at TEXT,
  responder_id TEXT,
  channel TEXT DEFAULT 'whatsapp',
  notes TEXT,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS publications (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  idempotency_key TEXT UNIQUE NOT NULL, -- campaign_id:channel:content_type
  external_id TEXT,
  external_url TEXT,
  status TEXT NOT NULL, -- pending, published, failed, withdrawn
  payload TEXT,         -- JSON
  published_at TEXT,
  error TEXT,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS publication_metrics (
  id TEXT PRIMARY KEY,
  publication_id TEXT,
  campaign_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  views INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  ctr REAL DEFAULT 0.0,
  likes INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  reposts INTEGER DEFAULT 0,
  engagement_rate REAL DEFAULT 0.0,
  position REAL DEFAULT 0.0,
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (publication_id) REFERENCES publications(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS optimization_proposals (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  diagnosis TEXT NOT NULL,
  recommendations TEXT NOT NULL, -- JSON
  metrics_summary TEXT,          -- JSON
  confidence REAL DEFAULT 0.0,
  status TEXT DEFAULT 'proposed', -- proposed, approved, rejected, applied
  created_at TEXT NOT NULL,
  applied_at TEXT,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  campaign_id TEXT,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL, -- queued, running, completed, failed, cancelled
  priority INTEGER DEFAULT 10,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  payload TEXT, -- JSON
  result TEXT,  -- JSON
  error TEXT,
  idempotency_key TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS execution_logs (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  campaign_id TEXT,
  tool TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  error TEXT,
  metadata TEXT -- JSON
);

CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_publications_idem ON publications(idempotency_key);
