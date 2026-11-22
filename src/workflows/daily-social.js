'use strict';

const db = require('../db');
const { Projects } = require('../db/models');
const { getSocialProvider } = require('../providers/social');
const modelRouter = require('../providers/llm');
const logger = require('../utils/logger').child('DailySocialWorkflow');

/**
 * Stateful Daily Social Syndication Workflow (PRD Section 41)
 */
async function runDailySocial({ channel = 'bluesky', dryRun = false }) {
  await db.initialize();
  const projects = await Projects.getAll(true);
  if (projects.length === 0) {
    throw new Error('No active projects found in database');
  }

  // Select project (rotate based on day of year)
  const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 1000 / 60 / 60 / 24);
  const selectedProject = projects[dayOfYear % projects.length];

  logger.info(`Daily Social selected project: ${selectedProject.name} for channel: ${channel}`);

  const liveUrl = selectedProject.url || 'https://nevatal.id';
  const prompt = `Write a compelling, high-signal developer post about ${selectedProject.name}.
URL: ${liveUrl}
DESCRIPTION: ${selectedProject.description || ''}
KEY FEATURES: ${(selectedProject.key_features || []).join('; ')}
Channel: ${channel} (Limit to 280 chars, developer-focused, engaging hook).`;

  const messages = [
    { role: 'system', content: 'You are a tech developer copywriter. Write a single post text only.' },
    { role: 'user', content: prompt },
  ];

  const llmRes = await modelRouter.generate('social', messages);
  const postContent = llmRes.content.trim();

  if (dryRun) {
    logger.info(`[DRY RUN] Would publish to ${channel}:\n${postContent}`);
    return { dryRun: true, project: selectedProject.name, channel, content: postContent };
  }

  const provider = getSocialProvider(channel);
  const pub = await provider.publish({ text: postContent });

  return {
    project: selectedProject.name,
    channel,
    content: postContent,
    publication: pub,
  };
}

module.exports = {
  runDailySocial,
};
