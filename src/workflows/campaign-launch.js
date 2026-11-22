'use strict';

const campaignAgent = require('../agents/campaign-agent');
const logger = require('../utils/logger').child('CampaignLaunchWorkflow');

/**
 * End-to-end Campaign Launch Workflow (PRD Section 41, 52)
 */
async function runCampaignLaunch({ projectId, planMode = false, channels = ['wordpress', 'bluesky', 'x'] }) {
  logger.info(`Starting Campaign Launch Workflow for ${projectId}...`);
  const result = await campaignAgent.createCampaign({
    projectId,
    planMode,
    channels,
  });
  return result;
}

module.exports = {
  runCampaignLaunch,
};
