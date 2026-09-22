import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const npm = process.env.npm_execpath;
const children = new Set();
const watchers = [];
let preview;
let timer;
let building = false;
let dirty = true;
let stopping = false;

function signalChildren(signal) {
  for (const child of children) {
    try {
      if (process.platform === 'win32') child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') console.error(error.message);
    }
  }
}

function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  clearTimeout(timer);
  for (const watcher of watchers) watcher.close();
  signalChildren('SIGTERM');
  setTimeout(() => signalChildren('SIGKILL'), 2_000).unref();
}

function start(args) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  });
  children.add(child);
  child.once('error', (error) => {
    console.error(`Cannot start local development: ${error.message}`);
    children.delete(child);
    stop(1);
  });
  child.once('close', () => children.delete(child));
  return child;
}

async function rebuild() {
  if (building || stopping) return;
  building = true;
  try {
    while (dirty && !stopping) {
      dirty = false;
      const build = start([npm, 'run', 'build']);
      const code = await new Promise((resolve) => {
        build.once('close', (code) => resolve(code ?? 1));
      });
      if (stopping) break;
      if (code !== 0) {
        if (!preview) {
          stop(code);
          break;
        }
        console.error('Build failed. Fix the source and save again. The preview keeps the last successful build.');
        continue;
      }
      if (!preview) {
        preview = start([
          join(dirname(require.resolve('wrangler/package.json')), require('wrangler/package.json').bin.wrangler),
          'dev', '--local', '--live-reload', ...process.argv.slice(2),
        ]);
        preview.once('close', (code) => stop(code ?? 1));
      }
    }
  } catch (error) {
    console.error(`Cannot start local development: ${error.message}`);
    stop(1);
  } finally {
    building = false;
  }
}

function changed() {
  dirty = true;
  clearTimeout(timer);
  timer = setTimeout(rebuild, 150);
}

process.on('SIGINT', () => stop(130));
process.on('SIGTERM', () => stop(143));

if (!npm) {
  console.error('Run npm run dev to start local development.');
  process.exitCode = 1;
} else {
  try {
    const inputs = new Set(['wordpress-export.xml', 'wxr-import-base.json']);
    const inputWatcher = watch(root, (_event, filename) => {
      if (!filename || inputs.has(String(filename))) changed();
    });
    watchers.push(inputWatcher);
    inputWatcher.on('error', (error) => {
      console.error(`Cannot watch the WXR export: ${error.message}`);
      stop(1);
    });
    for (const directory of ['public', 'theme']) {
      const watcher = watch(join(root, directory), { recursive: true }, changed);
      watchers.push(watcher);
      watcher.on('error', (error) => {
        console.error(`Cannot watch ${directory}: ${error.message}`);
        stop(1);
      });
    }
    await rebuild();
  } catch (error) {
    console.error(`Cannot start local development: ${error.message}`);
    stop(1);
  }
}
