import assert from 'node:assert/strict';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { fixture, command, freePort, stop, waitFor } from './helpers.mjs';
import { wordpressExport } from './fixtures.mjs';

test('watches atomic WXR replacements and settings, and recovers from import errors', { timeout: 60_000 }, async (t) => {
  let dev;
  const root = await fixture(t, () => dev && stop(dev));
  const port = await freePort();
  dev = command(root, ['run', 'dev', '--', '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', '0']);
  const origin = 'http://127.0.0.1:' + port;
  async function response(path) {
    try {
      const result = await fetch(origin + path, { signal: AbortSignal.timeout(1_000) });
      return { status: result.status, body: await result.text() };
    } catch { return { status: 0, body: '' }; }
  }
  async function contains(path, text) {
    assert.equal(dev.child.exitCode, null, dev.output());
    const result = await response(path);
    return result.status === 200 && result.body.includes(text);
  }
  await waitFor(() => contains('/', 'Try ZeroPress'), 'Local preview did not start.', dev.output);
  assert.equal((await response('/try-your-export/')).status, 200);
  assert.equal((await response('/wordpress-export.xml')).status, 404);
  assert.equal((await response('/.zeropress-wxr/preview-data.json')).status, 404);
  assert.equal((await response('/wxr-import-base.json')).status, 404);

  await writeFile(join(root, 'replacement.xml'), wordpressExport({ slug: 'updated' }));
  await rename(join(root, 'replacement.xml'), join(root, 'wordpress-export.xml'));
  await waitFor(() => contains('/', '/updated/'), 'The replaced export did not rebuild.', dev.output);
  assert.equal((await response('/updated/')).status, 200);
  assert.equal((await response('/try-your-export/')).status, 404);

  await writeFile(join(root, 'wordpress-export.xml'), '<rss><channel>');
  await waitFor(() => dev.output().includes('The preview keeps the last successful build.'), 'Import error was not reported.', dev.output);
  assert.equal(await contains('/', '/updated/'), true);
  await writeFile(join(root, 'wordpress-export.xml'), wordpressExport({ slug: 'recovered' }));
  await waitFor(() => contains('/', '/recovered/'), 'Preview did not recover.', dev.output);

  const base = JSON.parse(await readFile(join(root, 'wxr-import-base.json'), 'utf8'));
  base.site.title = 'Updated settings';
  await writeFile(join(root, 'wxr-import-base.json'), JSON.stringify(base));
  await waitFor(() => contains('/', 'Updated settings'), 'Import settings did not rebuild.', dev.output);
  await stop(dev);
  await waitFor(async () => (await response('/')).status === 0, 'Local preview did not stop.', dev.output);
});
