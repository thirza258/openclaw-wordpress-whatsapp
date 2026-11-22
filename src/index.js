'use strict';

const config = require('./config');
const db = require('./db');
const queue = require('./queue');
const logger = require('./utils/logger');
const security = require('./utils/security');
const tokenTracker = require('./utils/token-tracker');

// Models
const models = require('./db/models');

// Agents
const campaignAgent = require('./agents/campaign-agent');
const researchAgent = require('./agents/research-agent');
const contentAgent = require('./agents/content-agent');
const seoAgent = require('./agents/seo-agent');
const qualityAgent = require('./agents/quality-agent');
const analyticsAgent = require('./agents/analytics-agent');
const optimizationAgent = require('./agents/optimization-agent');

// Tools
const wpTools = require('./tools/wordpress');
const socialTools = require('./tools/social');
const screenshotTools = require('./tools/screenshots');
const whatsAppTools = require('./tools/whatsapp');

// Providers
const llmProvider = require('./providers/llm');
const wpService = require('./providers/wordpress');
const socialProviders = require('./providers/social');

// Workflows
const { runCampaignLaunch } = require('./workflows/campaign-launch');
const { runSeoOptimization } = require('./workflows/seo-optimization');
const { runDailySocial } = require('./workflows/daily-social');

module.exports = {
  config,
  db,
  queue,
  logger,
  security,
  tokenTracker,
  models,
  agents: {
    campaign: campaignAgent,
    research: researchAgent,
    content: contentAgent,
    seo: seoAgent,
    quality: qualityAgent,
    analytics: analyticsAgent,
    optimization: optimizationAgent,
  },
  tools: {
    wordpress: wpTools,
    social: socialTools,
    screenshots: screenshotTools,
    whatsapp: whatsAppTools,
  },
  providers: {
    llm: llmProvider,
    wordpress: wpService,
    social: socialProviders,
  },
  workflows: {
    campaignLaunch: runCampaignLaunch,
    seoOptimization: runSeoOptimization,
    dailySocial: runDailySocial,
  },
};
