#!/usr/bin/env node

/**
 * OpenClaw ProductKit CLI Wrapper
 * 
 * Allows running shorthand commands like:
 *   node productkit.js list
 *   node productkit.js ragreader
 *   node productkit.js ragreader --dry-run
 * 
 * Directly invokes scripts/project-launch-kit.js
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const candidates = [
  path.join(__dirname, '../scripts/project-launch-kit.js'),
  path.join(__dirname, 'scripts/project-launch-kit.js'),
  path.join(process.cwd(), 'scripts/project-launch-kit.js'),
  path.join(process.cwd(), 'skills/wordpress/scripts/project-launch-kit.js'),
  path.join(process.env.HOME || '', '.openclaw/workspace/skills/wordpress/scripts/project-launch-kit.js')
];

const targetScript = candidates.find(c => fs.existsSync(c)) || candidates[0];
const args = process.argv.slice(2);

let finalArgs = [];
if (args.length === 0 || args[0] === 'list' || args[0] === '--list') {
  finalArgs = ['--list'];
} else if (args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
  finalArgs = ['--help'];
} else if (!args[0].startsWith('--')) {
  const isDryRun = args.includes('--dry-run') || args.includes('-n');
  finalArgs = ['--project', args[0]];
  if (!isDryRun) {
    finalArgs.push('--send');
  } else {
    finalArgs.push('--dry-run');
  }
  // forward any other flags
  args.slice(1).forEach(a => {
    if (a !== '--dry-run' && a !== '-n' && !finalArgs.includes(a)) {
      finalArgs.push(a);
    }
  });
} else {
  finalArgs = args;
}

const res = spawnSync(process.execPath, [targetScript, ...finalArgs], {
  stdio: 'inherit',
  env: process.env
});

process.exit(res.status || 0);
