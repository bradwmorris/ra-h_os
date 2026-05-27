#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

// Quote a token that contains whitespace or cmd.exe metacharacters.
function quoteArg(a) {
  return /[\s"&|<>^()]/.test(a) ? `"${String(a).replace(/"/g, '\\"')}"` : a;
}

function run(command, args) {
  // On Windows, npm/npx are .cmd shims that need a shell to launch (spawning a
  // .cmd without shell throws EINVAL on patched Node), but Node 24 emits DEP0190
  // when shell:true is combined with an args array. So on Windows we pass a
  // single pre-quoted command line (no args array); elsewhere we spawn the
  // binary directly with the args array and no shell.
  const result = process.platform === 'win32'
    ? spawnSync([command, ...args].map(quoteArg).join(' '), {
        stdio: 'inherit',
        env: process.env,
        shell: true,
      })
    : spawnSync(command, args, {
        stdio: 'inherit',
        env: process.env,
      });

  if (result.error) {
    console.error(`[setup-local] Failed to run ${command}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log('[setup-local] Rebuilding better-sqlite3 native bindings');
run('npm', ['rebuild', 'better-sqlite3']);

console.log('[setup-local] Bootstrapping local RA-H database');
run('npm', ['run', 'bootstrap:local', '--', ...process.argv.slice(2)]);

console.log('');
console.log('[setup-local] Local app setup complete.');
console.log('[setup-local] Next: npm run dev');
console.log('[setup-local] Optional MCP setup: npx -y ra-h-mcp-server@latest setup --client claude-code');
