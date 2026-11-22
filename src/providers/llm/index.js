'use strict';

const openrouter = require('./openrouter');
const config = require('../../config');

/**
 * AI Model Router (PRD Section 48)
 * Routes different tasks to specialized models:
 * - Research: High reasoning
 * - Article generation: Balanced model
 * - Classification/Scoring: Small/cheap model
 * - Final review: High-quality model
 */
class ModelRouter {
  constructor() {
    this.providers = {
      openrouter,
    };
  }

  getProvider(providerName = null) {
    const key = providerName || config.llm.defaultProvider || 'openrouter';
    const provider = this.providers[key];
    if (!provider) {
      throw new Error(`LLM provider [${key}] is not registered`);
    }
    return provider;
  }

  async generate(taskType, messages, { campaignId = null, jobId = null, maxTokens = 2500, temperature = 0.7 } = {}) {
    const provider = this.getProvider();
    const model = config.llm.models[taskType] || config.llm.primaryModel;

    return provider.complete({
      model,
      messages,
      maxTokens,
      temperature,
      campaignId,
      jobId,
    });
  }

  async generateJson(taskType, messages, { campaignId = null, jobId = null, maxTokens = 2500, temperature = 0.7 } = {}) {
    const provider = this.getProvider();
    const model = config.llm.models[taskType] || config.llm.primaryModel;

    return provider.completeJson({
      model,
      messages,
      maxTokens,
      temperature,
      campaignId,
      jobId,
    });
  }
}

module.exports = new ModelRouter();
module.exports.ModelRouter = ModelRouter;
