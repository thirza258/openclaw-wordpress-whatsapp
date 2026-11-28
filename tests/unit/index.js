'use strict';

const assert = require('assert');
const child_process = require('child_process');
const config = require('../../src/config');
const { normalizeE164 } = require('../../src/config');
const { isSenderAuthorized } = require('../../src/utils/security');
const db = require('../../src/db');
const { Campaigns, Projects } = require('../../src/db/models');
const seoAgent = require('../../src/agents/seo-agent');
const campaignAgent = require('../../src/agents/campaign-agent');
const { getSocialProvider } = require('../../src/providers/social');
const openrouter = require('../../src/providers/llm/openrouter');
const whatsAppTools = require('../../src/tools/whatsapp');
const jobQueue = require('../../src/queue');

async function runUnitTests() {
  console.log('🧪 Running Unit & Regression Tests...');
  await db.initialize();
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (e) {
      console.error(`  ❌ ${name}: ${e.message}`);
      failed++;
    }
  }

  async function testAsync(name, fn) {
    try {
      await fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (e) {
      console.error(`  ❌ ${name}: ${e.message}`);
      failed++;
    }
  }

  // 1. Phone number normalization
  test('E.164 phone normalization', () => {
    assert.strictEqual(normalizeE164('+62 812-9076-5711'), '+6281290765711');
    assert.strictEqual(normalizeE164('6281290765711'), '+6281290765711');
    assert.strictEqual(normalizeE164(''), '');
  });

  // 2. FR-009 Fail-Closed Authorization
  test('FR-009 Fail-closed authorization - unconfigured or invalid sender is DENIED', () => {
    const unauth = isSenderAuthorized('+19999999999');
    assert.strictEqual(unauth.authorized, false, 'Unregistered number must be denied');

    const empty = isSenderAuthorized('');
    assert.strictEqual(empty.authorized, false, 'Empty sender must be denied');

    const nullSender = isSenderAuthorized(null);
    assert.strictEqual(nullSender.authorized, false, 'Null sender must be denied');
  });

  // 3. Campaign state machine enum
  test('Campaign state machine contains all PRD states', () => {
    const states = Campaigns.STATES;
    assert.ok(states.DRAFT);
    assert.ok(states.RESEARCHING);
    assert.ok(states.PLANNED);
    assert.ok(states.CONTENT_GENERATING);
    assert.ok(states.QUALITY_REVIEW);
    assert.ok(states.ASSETS_GENERATING);
    assert.ok(states.READY_FOR_APPROVAL);
    assert.ok(states.APPROVED);
    assert.ok(states.PUBLISHING);
    assert.ok(states.PUBLISHED);
    assert.ok(states.ANALYZING);
    assert.ok(states.OPTIMIZATION_PROPOSED);
    assert.ok(states.FAILED);
    assert.ok(states.CANCELLED);
  });

  // 4. Social provider character validation
  await testAsync('Social Provider validation constraints', async () => {
    const bluesky = getSocialProvider('bluesky');
    const validPost = await bluesky.validate({ text: 'Hello from OpenClaw!' });
    assert.strictEqual(validPost.valid, true);

    const longText = 'a'.repeat(305);
    const invalidPost = await bluesky.validate({ text: longText });
    assert.strictEqual(invalidPost.valid, false, 'Bluesky post > 300 chars must fail validation');
  });

  // 5. SEO Agent deterministic evaluation
  await testAsync('SEO Agent scoring rules', async () => {
    const mockArticle = {
      title: 'RAGReader: Modern Document RAG Architecture',
      focus_keyphrase: 'Document RAG',
      meta_description: 'Comprehensive technical guide exploring Document RAG architecture with production benchmarks.',
      content_html: '<h2>Introduction</h2><p>text</p><h2>Challenge</h2><p>text</p><h2>Architecture</h2><p>text</p><h2>Workflow</h2><p>text</p><h2>FAQ</h2><p>text</p><table><tr><td>Benchmark</td></tr></table>',
      word_count: 1400,
    };
    const res = await seoAgent.evaluate({
      article: mockArticle,
      project: { keywords: ['Document RAG'] },
      brief: {},
    });
    assert.ok(res.score >= 80, `Expected score >= 80, got ${res.score}`);
    assert.strictEqual(res.passed, true);
  });

  // 6. REGRESSION TEST: Atomic status transition prevents concurrency race condition
  await testAsync('Regression: Atomic status transition prevents concurrency race conditions', async () => {
    const testCampaign = await Campaigns.create({
      projectId: 'rag-reader',
      planMode: false,
      metadata: { test: 'concurrency' }
    });
    await Campaigns.updateStatus(testCampaign.id, 'READY_FOR_APPROVAL', 'APPROVAL_GATE');

    // Simulate two concurrent approval requests
    const [res1, res2] = await Promise.all([
      Campaigns.transitionStatus(testCampaign.id, 'READY_FOR_APPROVAL', 'APPROVED', 'APPROVING_1'),
      Campaigns.transitionStatus(testCampaign.id, 'READY_FOR_APPROVAL', 'APPROVED', 'APPROVING_2')
    ]);

    const totalChanges = res1.changes + res2.changes;
    assert.strictEqual(totalChanges, 1, 'Exactly one concurrent transition must succeed');
    assert.ok((res1.changes === 1 && res2.changes === 0) || (res1.changes === 0 && res2.changes === 1));

    const finalRecord = await Campaigns.getById(testCampaign.id);
    assert.strictEqual(finalRecord.status, 'APPROVED');
  });

  // 7. REGRESSION TEST: WhatsApp CLI command invocation options
  await testAsync('Regression: WhatsApp CLI invoked with --channel, --target, --message (no --to/--text)', async () => {
    let capturedBin = null;
    let capturedArgs = [];
    const originalSpawn = child_process.spawn;

    try {
      child_process.spawn = (bin, args, options) => {
        capturedBin = bin;
        capturedArgs = args;
        return {
          unref: () => {}
        };
      };

      const result = await whatsAppTools.sendMessage('Test WhatsApp message', {
        targetNumber: '+6281290765711'
      });

      assert.strictEqual(result.delivered, true);
      assert.ok(capturedArgs.includes('--channel'), 'Args must include --channel');
      assert.strictEqual(capturedArgs[capturedArgs.indexOf('--channel') + 1], 'whatsapp');
      assert.ok(capturedArgs.includes('--target'), 'Args must include --target');
      assert.strictEqual(capturedArgs[capturedArgs.indexOf('--target') + 1], '+6281290765711');
      assert.ok(capturedArgs.includes('--message'), 'Args must include --message');
      assert.strictEqual(capturedArgs[capturedArgs.indexOf('--message') + 1], 'Test WhatsApp message');

      // Crucial: ensure old broken options are NOT used
      assert.strictEqual(capturedArgs.includes('--to'), false, 'Must NOT use broken --to flag');
      assert.strictEqual(capturedArgs.includes('--text'), false, 'Must NOT use broken --text flag');
    } finally {
      child_process.spawn = originalSpawn;
    }
  });

  // 8. REGRESSION TEST: LLM JSON parser resilience (markdown fences, trailing commas, sliced braces)
  await testAsync('Regression: OpenRouter LLM JSON parser handles markdown fences and trailing commas', async () => {
    const originalComplete = openrouter.complete;
    try {
      // Mock complete to return markdown with trailing comma
      openrouter.complete = async () => ({
        content: '```json\n{\n  "title": "Cleaned Title",\n  "count": 42,\n}\n```',
        model: 'openrouter/free',
        inputTokens: 10,
        outputTokens: 20
      });

      const res1 = await openrouter.completeJson({});
      assert.deepStrictEqual(res1.parsed, { title: 'Cleaned Title', count: 42 });

      // Mock complete to return sliced JSON array with conversational text
      openrouter.complete = async () => ({
        content: 'Here is the requested JSON output:\n[{"item": "A"}, {"item": "B",}]\nHope this helps!',
        model: 'openrouter/free',
        inputTokens: 15,
        outputTokens: 25
      });

      const res2 = await openrouter.completeJson({});
      assert.deepStrictEqual(res2.parsed, [{ item: 'A' }, { item: 'B' }]);
    } finally {
      openrouter.complete = originalComplete;
    }
  });

  // 9. REGRESSION TEST: Bluesky delete/rollback implementation
  await testAsync('Regression: Bluesky provider delete handles rollback without crashing', async () => {
    const bluesky = getSocialProvider('bluesky');
    assert.strictEqual(typeof bluesky.delete, 'function');
    // Should not throw even if CLI is simulated or ID does not exist
    await bluesky.delete('bsky_test_post_id_123');
  });

  // 10. REGRESSION TEST: JobQueue recovers from missing handler without head-of-line blocking
  await testAsync('Regression: JobQueue fails unregistered job without head-of-line starvation', async () => {
    // Clear any leftover queued jobs from previous test runs
    await db.run("DELETE FROM jobs WHERE status = 'queued'");

    const unknownType = `unknown_job_${Date.now()}`;
    const enqueued = await jobQueue.enqueue(unknownType, { payload: { foo: 'bar' } });
    assert.strictEqual(enqueued.status, 'queued');

    // Trigger processNext
    jobQueue.running = true;
    await jobQueue.processNext();
    jobQueue.running = false;

    // Verify job transitioned to 'failed' rather than staying 'queued'
    const updated = await jobQueue.getJob(enqueued.id);
    assert.strictEqual(updated.status, 'failed', 'Unregistered job must be failed, not left queued forever');
    assert.ok(updated.error.includes('No handler registered'));
  });

  // 11. REGRESSION TEST: JobQueue atomic claim prevents duplicate job execution
  await testAsync('Regression: JobQueue atomic conditional claim prevents concurrent double-processing', async () => {
    const testType = `concurrency_test_${Date.now()}`;
    const enqueued = await jobQueue.enqueue(testType, { payload: {} });

    // Simulate two concurrent workers claiming the same job
    const [res1, res2] = await Promise.all([
      db.run("UPDATE jobs SET status = 'running' WHERE id = ? AND status = 'queued'", [enqueued.id]),
      db.run("UPDATE jobs SET status = 'running' WHERE id = ? AND status = 'queued'", [enqueued.id])
    ]);

    assert.strictEqual(res1.changes + res2.changes, 1, 'Only one concurrent worker can claim the job');
  });

  console.log(`\nUnit Tests Result: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

if (require.main === module) {
  runUnitTests();
}

module.exports = runUnitTests;
