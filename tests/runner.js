'use strict';

const runUnitTests = require('./unit');
const runIntegrationTests = require('./integration/db-workflow.test');
const runE2ETest = require('./e2e/campaign-lifecycle.test');

async function main() {
  console.log('\n======================================================');
  console.log('   OpenClaw Marketing Platform - Test Suite');
  console.log('======================================================\n');

  try {
    await runUnitTests();
    await runIntegrationTests();
    await runE2ETest();
    console.log('======================================================');
    console.log('   ALL TESTS COMPLETED SUCCESSFULLY! ✨');
    console.log('======================================================\n');
  } catch (err) {
    console.error('\n❌ Test Suite Failed:', err);
    process.exit(1);
  }
}

main();
