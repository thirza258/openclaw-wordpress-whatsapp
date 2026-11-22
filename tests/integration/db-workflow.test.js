'use strict';

const assert = require('assert');
const db = require('../../src/db');
const { Projects, Campaigns, CampaignBriefs, Content, Publications, Approvals } = require('../../src/db/models');

async function runIntegrationTests() {
  console.log('🧪 Running Integration Tests (Database & Persistence)...');

  await db.initialize();

  // 1. Projects loaded from catalog
  const projects = await Projects.getAll(true);
  assert.ok(projects.length > 0, 'Database should contain projects synced from catalog');
  console.log(`  ✅ Synced projects in DB: ${projects.length}`);

  // 2. Campaign persistence
  const testProj = projects[0];
  const campaign = await Campaigns.create({
    projectId: testProj.id,
    planMode: false,
    metadata: { test: true },
  });
  assert.ok(campaign.id.startsWith('cmp_'));
  assert.strictEqual(campaign.status, 'DRAFT');
  console.log(`  ✅ Campaign created in DRAFT: ${campaign.id}`);

  // 3. State transition
  const updated = await Campaigns.updateStatus(campaign.id, 'RESEARCHING', 'STEP_1');
  assert.strictEqual(updated.status, 'RESEARCHING');
  console.log(`  ✅ Campaign state transition verified: ${updated.status}`);

  // 4. Brief creation
  const brief = await CampaignBriefs.create({
    campaignId: campaign.id,
    objective: 'Integration Test Launch',
    primaryMessage: 'Testing DB persistence',
    targetAudience: ['Engineers'],
    targetKeywords: ['TestKeyword'],
    channels: ['wordpress', 'bluesky'],
  });
  assert.strictEqual(brief.campaign_id, campaign.id);
  assert.deepStrictEqual(brief.channels, ['wordpress', 'bluesky']);
  console.log('  ✅ Canonical brief created and persisted');

  // 5. Idempotent publication check
  const idempotencyKey = `${campaign.id}:wordpress:article`;
  await Publications.record({
    campaignId: campaign.id,
    channel: 'wordpress',
    idempotencyKey,
    externalId: '101',
    externalUrl: 'http://localhost:8085/?p=101',
    status: 'published',
  });

  const found = await Publications.findByIdempotencyKey(idempotencyKey);
  assert.ok(found);
  assert.strictEqual(found.external_id, '101');
  assert.strictEqual(found.status, 'published');
  console.log('  ✅ Idempotency lookup verified (duplicate prevention)');

  console.log('\nIntegration Tests Passed Successfully!\n');
}

if (require.main === module) {
  runIntegrationTests().catch((e) => {
    console.error('Integration test failed:', e);
    process.exit(1);
  });
}

module.exports = runIntegrationTests;
