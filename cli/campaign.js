#!/usr/bin/env node
'use strict';

const path = require('path');
const { agents, db, models } = require('../src');

function printUsage() {
  console.log(`
OpenClaw Marketing Platform - Campaign CLI

Usage:
  npm run campaign -- <command> [args] [flags]

Commands:
  create <project_id>       Create and run a full campaign (stops at approval gate)
  plan <project_id>         Plan mode: preview planned actions & estimated usage (no publishing)
  approve <campaign_id>     Approve campaign for external multi-channel publishing
  reject <campaign_id>      Reject campaign
  status <campaign_id>      Show campaign lifecycle status & performance
  preview <campaign_id>     Preview generated article & social variants
  rollback <campaign_id>    Compensating action: withdraw/unpublish external posts
  cancel <campaign_id>      Cancel campaign
  list                      List all active projects in the registry
  campaigns                 List all campaigns and their status

Options:
  --channels <c1,c2>        Comma-separated channels (e.g. wordpress,bluesky,x)
  --plan                    Equivalent to 'plan' command
`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const command = argv[0].toLowerCase();
  const arg1 = argv[1];

  await db.initialize();

  try {
    switch (command) {
      case 'create': {
        if (!arg1) {
          console.error('Error: Missing project ID. Example: npm run campaign -- create rag-reader');
          process.exit(1);
        }
        const planMode = argv.includes('--plan');
        const channelFlagIdx = argv.indexOf('--channels');
        const channels = channelFlagIdx !== -1 && argv[channelFlagIdx + 1]
          ? argv[channelFlagIdx + 1].split(',').map((s) => s.trim())
          : ['wordpress', 'bluesky', 'x'];

        const res = await agents.campaign.createCampaign({
          projectId: arg1,
          planMode,
          channels,
        });

        console.log('\n======================================================');
        console.log(`🚀 Campaign Created: ${res.campaignId} [${res.status}]`);
        console.log('======================================================');
        console.log(JSON.stringify(res, null, 2));
        break;
      }

      case 'plan': {
        if (!arg1) {
          console.error('Error: Missing project ID. Example: npm run campaign -- plan rag-reader');
          process.exit(1);
        }
        const res = await agents.campaign.createCampaign({
          projectId: arg1,
          planMode: true,
        });
        console.log('\n======================================================');
        console.log(`📋 PLAN ONLY: ${res.project}`);
        console.log('======================================================');
        console.log(res.plannedActions.join('\n'));
        console.log(`\nEstimated usage: ~${res.estimatedTokens} tokens ($${res.estimatedCostUsd})`);
        console.log(`\n${res.note}\n`);
        break;
      }

      case 'approve': {
        if (!arg1) {
          console.error('Error: Missing campaign ID. Example: npm run campaign -- approve cmp_123');
          process.exit(1);
        }
        console.log(`Approving campaign ${arg1}...`);
        const res = await agents.campaign.approve(arg1, 'cli');
        console.log('\n✅ Campaign Approved & Published:');
        console.log(JSON.stringify(res, null, 2));
        break;
      }

      case 'reject': {
        if (!arg1) {
          console.error('Error: Missing campaign ID. Example: npm run campaign -- reject cmp_123');
          process.exit(1);
        }
        const res = await agents.campaign.reject(arg1, 'cli', argv.slice(2).join(' ') || 'Rejected via CLI');
        console.log('\n❌ Campaign Rejected:');
        console.log(JSON.stringify(res, null, 2));
        break;
      }

      case 'status': {
        if (!arg1) {
          console.error('Error: Missing campaign ID. Example: npm run campaign -- status cmp_123');
          process.exit(1);
        }
        const res = await agents.campaign.getStatus(arg1);
        console.log('\n======================================================');
        console.log(`📊 Campaign Status: ${res.campaignId} [${res.status}]`);
        console.log('======================================================');
        console.log(JSON.stringify(res, null, 2));
        break;
      }

      case 'preview': {
        if (!arg1) {
          console.error('Error: Missing campaign ID. Example: npm run campaign -- preview cmp_123');
          process.exit(1);
        }
        const res = await agents.campaign.preview(arg1);
        console.log('\n======================================================');
        console.log(`📄 Campaign Preview: ${res.campaignId}`);
        console.log('======================================================');
        console.log(JSON.stringify(res, null, 2));
        break;
      }

      case 'rollback': {
        if (!arg1) {
          console.error('Error: Missing campaign ID. Example: npm run campaign -- rollback cmp_123');
          process.exit(1);
        }
        console.log(`Executing compensating rollback for campaign ${arg1}...`);
        const res = await agents.campaign.rollback(arg1);
        console.log('\n🔄 Campaign Rolled Back:');
        console.log(JSON.stringify(res, null, 2));
        break;
      }

      case 'cancel': {
        if (!arg1) {
          console.error('Error: Missing campaign ID. Example: npm run campaign -- cancel cmp_123');
          process.exit(1);
        }
        const res = await agents.campaign.cancel(arg1);
        console.log('\nCampaign Cancelled:', res);
        break;
      }

      case 'list': {
        const projects = await models.Projects.getAll(true);
        console.log(`\n=== Registered Projects in Catalog (${projects.length}) ===\n`);
        projects.forEach((p, idx) => {
          console.log(`${(idx + 1).toString().padStart(2, '0')}. ${p.name} (id: ${p.id})`);
          console.log(`    URL: ${p.url || 'None'} | Category: ${p.wordpress_category}`);
        });
        console.log('');
        break;
      }

      case 'campaigns': {
        const campaigns = await models.Campaigns.list(20);
        console.log(`\n=== Recent Campaigns (${campaigns.length}) ===\n`);
        campaigns.forEach((c) => {
          console.log(`• [${c.id}] Project: ${c.project_id} | Status: ${c.status} | Step: ${c.current_step || '-'} | Created: ${c.created_at}`);
        });
        console.log('');
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}\n`);
    process.exit(1);
  }
}

main();
