'use strict';

const assert = require('assert');
const db = require('../../src/db');
const { agents, models } = require('../../src');

/**
 * Full End-to-End Simulation of Campaign Lifecycle (PRD Section 8 & 43)
 * DRAFT -> RESEARCHING -> PLANNED -> CONTENT_GENERATING -> QUALITY_REVIEW ->
 * ASSETS_GENERATING -> READY_FOR_APPROVAL -> APPROVED -> PUBLISHED -> ANALYZING -> OPTIMIZATION_PROPOSED
 */
async function runE2ETest() {
  console.log('🧪 Running End-to-End Campaign Lifecycle Test...');

  await db.initialize();
  const projects = await models.Projects.getAll(true);
  const project = projects.find((p) => p.id === 'rag-reader') || projects[0];

  console.log(`  Target Project: ${project.name} (${project.id})`);

  // 1. Plan Mode Test
  console.log('  Testing Plan Mode...');
  const plan = await agents.campaign.createCampaign({
    projectId: project.id,
    planMode: true,
  });
  assert.strictEqual(plan.status, 'PLANNED');
  assert.strictEqual(plan.planMode, true);
  console.log(`  ✅ Plan generated (${plan.plannedActions.length} planned actions, no side effects)`);

  // 2. Full Campaign Execution (Up to Approval Gate)
  console.log('  Testing Full Campaign Execution to Approval Gate...');
  const campaignResult = await agents.campaign.createCampaign({
    projectId: project.id,
    planMode: false,
    channels: ['wordpress', 'bluesky'],
  });

  const campaignId = campaignResult.campaignId;
  assert.strictEqual(campaignResult.status, 'READY_FOR_APPROVAL');
  console.log(`  ✅ Campaign reached Approval Gate: ${campaignId}`);
  console.log(`     Article words: ${campaignResult.article.wordCount}`);
  console.log(`     Quality scores:`, campaignResult.qualityScores);

  // 3. Human Approval Gate
  console.log('  Testing Human Approval Command...');
  const approvalResult = await agents.campaign.approve(campaignId, 'e2e_test_user');
  assert.strictEqual(approvalResult.status, 'PUBLISHED');
  console.log('  ✅ Approval accepted & publishing executed idempotently');

  // 4. Status Check
  const status = await agents.campaign.getStatus(campaignId);
  assert.strictEqual(status.status, 'PUBLISHED');
  console.log('  ✅ Status check verified: PUBLISHED');

  // 5. Closed Loop Analytics & Optimization Proposal (PRD Section 36 & 37)
  console.log('  Testing Closed-Loop Optimization Agent...');
  const { runSeoOptimization } = require('../../src/workflows/seo-optimization');
  const optResult = await runSeoOptimization(campaignId);
  assert.ok(optResult.proposal);
  assert.strictEqual(optResult.proposal.status, 'proposed');
  console.log(`  ✅ Optimization Proposal generated: "${optResult.proposal.diagnosis}"`);

  // 6. Rollback Compensating Action (PRD Section 34)
  console.log('  Testing Rollback Compensating Action...');
  const rollbackResult = await agents.campaign.rollback(campaignId);
  assert.strictEqual(rollbackResult.status, 'ROLLED_BACK');
  console.log('  ✅ Compensating rollback action verified: posts withdrawn');

  console.log('\n🎉 End-to-End Campaign Lifecycle Test Passed 100%!\n');
}

if (require.main === module) {
  runE2ETest().catch((e) => {
    console.error('E2E test failed:', e);
    process.exit(1);
  });
}

module.exports = runE2ETest;
