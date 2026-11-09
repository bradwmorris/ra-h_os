#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';

// `npm run setup:local` sets npm_execpath to npm's own CLI script. Running it with the
// current Node binary avoids a shell entirely, so no argument is ever re-parsed by cmd.exe.
const npmCli = process.env.npm_execpath && /^npm-cli\.c?js$/.test(path.basename(process.env.npm_execpath))
  ? process.env.npm_execpath
  : null;

// Fallback quoting for cmd.exe. cmd has no reliable escape for `"` inside a quoted
// token and expands %VAR% even inside quotes, so refuse such arguments rather than
// build a command line they could break out of.
function quoteArg(a) {
  const s = String(a);
  if (/["%]/.test(s)) {
    console.error(`[setup-local] Unsupported character in argument for the Windows shell fallback: ${s}`);
    process.exit(1);
  }
  return /[\s&|<>^()!]/.test(s) ? `"${s}"` : s;
}

function run(command, args) {
  let result;
  if (command === 'npm' && npmCli) {
    result = spawnSync(process.execPath, [npmCli, ...args], { stdio: 'inherit', env: process.env });
  } else if (process.platform === 'win32') {
    // Not launched via npm: npm is a .cmd shim that needs a shell (spawning a .cmd
    // without one throws EINVAL on patched Node), and Node 24 emits DEP0190 for
    // shell:true with an args array, so pass a single pre-quoted command line.
    result = spawnSync([command, ...args].map(quoteArg).join(' '), {
      stdio: 'inherit',
      env: process.env,
      shell: true,
    });
  } else {
    result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
  }

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
