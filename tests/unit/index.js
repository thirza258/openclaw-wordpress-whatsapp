'use strict';

const assert = require('assert');
const config = require('../../src/config');
const { normalizeE164 } = require('../../src/config');
const { isSenderAuthorized } = require('../../src/utils/security');
const { Campaigns } = require('../../src/db/models');
const seoAgent = require('../../src/agents/seo-agent');
const { getSocialProvider } = require('../../src/providers/social');

async function runUnitTests() {
  console.log('🧪 Running Unit Tests...');
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

  console.log(`\nUnit Tests Result: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

if (require.main === module) {
  runUnitTests();
}

module.exports = runUnitTests;
