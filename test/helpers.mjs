import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { wordpressExport } from './fixtures.mjs';

export const project = dirname(dirname(fileURLToPath(import.meta.url)));
export async function fixture(t, cleanup = async () => {}) {
  const root = await mkdtemp(join(tmpdir(), 'zeropress-wxr-test-'));
  t.after(async () => { await cleanup(); await rm(root, { recursive: true, force: true }); });
  for (const path of ['package.json', 'scripts', 'theme', 'wrangler.jsonc', 'wxr-import-base.json']) {
    await cp(join(project, path), join(root, path), { recursive: true });
  }
  await symlink(join(project, 'node_modules'), join(root, 'node_modules'), 'junction');
  await mkdir(join(root, 'public'));
  await writeFile(join(root, 'wordpress-export.xml'), wordpressExport());
  return root;
}

export function command(root, args, env = {}) {
  const npm = process.env.npm_execpath;
  const child = spawn(npm ? process.execPath : 'npm', npm ? [npm, ...args] : args, {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
    env: {
      ...process.env, CI: 'true', NO_COLOR: '1', WRANGLER_SEND_METRICS: 'false',
      WRANGLER_LOG_PATH: join(root, '.wrangler/logs'), CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ACCOUNT_ID: '', ...env,
    },
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  return { child, done: once(child, 'close').then(([code]) => ({ code, output })), output: () => output };
}

export function build(root) {
  return command(root, ['run', 'build'], {
    NODE_OPTIONS: `--import=${new URL('./no-network.mjs', import.meta.url).href}`,
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
  }).done;
}

export async function waitFor(check, message, diagnostics = () => '') {
  const deadline = Date.now() + 20_000;
  do {
    if (await check()) return;
    await delay(100);
  } while (Date.now() < deadline);
  assert.fail(message + '\n' + diagnostics());
}

export async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

export async function stop({ child, done }) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
  } catch (error) { if (error.code !== 'ESRCH') throw error; }
  await done;
}
