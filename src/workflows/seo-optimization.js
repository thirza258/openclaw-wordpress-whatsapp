'use strict';

const analyticsAgent = require('../agents/analytics-agent');
const optimizationAgent = require('../agents/optimization-agent');
const logger = require('../utils/logger').child('SeoOptimizationWorkflow');

/**
 * Closed-Loop SEO Optimization Workflow (PRD Section 36 & 37)
 */
async function runSeoOptimization(campaignId) {
  logger.info(`Running closed-loop SEO optimization for campaign ${campaignId}...`);
  const metricsReport = await analyticsAgent.collectMetrics(campaignId);
  const proposal = await optimizationAgent.analyzeAndPropose({ campaignId, metricsReport });
  return {
    campaignId,
    metrics: metricsReport,
    proposal,
  };
}

module.exports = {
  runSeoOptimization,
};
