'use strict';

const logger = require('./logger').child('TokenTracker');

// Rough cost per 1M tokens estimates (USD) for typical openrouter/cloud models
const MODEL_PRICING = {
  'google/gemma-4-26b-a4b-it': { input: 0.15, output: 0.30 },
  'google/gemma-4-31b-it': { input: 0.20, output: 0.40 },
  'anthropic/claude-3.5-sonnet': { input: 3.00, output: 15.00 },
  'openai/gpt-4o': { input: 2.50, output: 10.00 },
  'openai/gpt-4o-mini': { input: 0.15, output: 0.60 },
  'meta-llama/llama-3.1-70b-instruct': { input: 0.35, output: 0.40 },
};

class TokenTracker {
  constructor() {
    this.sessionUsage = [];
  }

  calculateCost(model, inputTokens = 0, outputTokens = 0) {
    if (model && (model.endsWith(':free') || model === 'openrouter/free')) {
      return 0.0;
    }

    const price = MODEL_PRICING[model] || { input: 0.20, output: 0.40 };
    const inputCost = (inputTokens / 1_000_000) * price.input;
    const outputCost = (outputTokens / 1_000_000) * price.output;
    return parseFloat((inputCost + outputCost).toFixed(6));
  }

  recordUsage({ campaignId, jobId, provider, model, inputTokens = 0, outputTokens = 0, durationMs = 0 }) {
    const totalTokens = inputTokens + outputTokens;
    const estimatedCostUsd = this.calculateCost(model, inputTokens, outputTokens);

    const record = {
      timestamp: new Date().toISOString(),
      campaignId: campaignId || null,
      jobId: jobId || null,
      provider: provider || 'openrouter',
      model,
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCostUsd,
      durationMs,
    };

    this.sessionUsage.push(record);
    logger.info(`AI usage recorded: ${totalTokens} tokens ($${estimatedCostUsd.toFixed(4)}) on ${model}`, {
      campaignId,
      model,
      totalTokens,
      estimatedCostUsd,
    });

    return record;
  }

  getCampaignTotal(campaignId) {
    const matching = this.sessionUsage.filter((u) => u.campaignId === campaignId);
    const totalTokens = matching.reduce((sum, u) => sum + u.totalTokens, 0);
    const totalCostUsd = matching.reduce((sum, u) => sum + u.estimatedCostUsd, 0);
    return {
      campaignId,
      callsCount: matching.length,
      totalTokens,
      totalCostUsd: parseFloat(totalCostUsd.toFixed(4)),
    };
  }
}

module.exports = new TokenTracker();
