import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { fixture, build } from './helpers.mjs';
import { wordpressExport, sample } from './fixtures.mjs';

test('converts WordPress content offline and preserves original media, links, and comment IDs', async (t) => {
  const root = await fixture(t);
  const source = await readFile(join(root, 'wordpress-export.xml'), 'utf8');
  await writeFile(join(root, 'public/download.txt'), 'A public download.');
  const result = await build(root);
  assert.equal(result.code, 0, result.output);
  const html = await readFile(join(root, 'dist/try-your-export/index.html'), 'utf8');
  assert.match(html, /href="https:\/\/wordpress\.example\/blog\/original\/\?ref=trial#reading"/);
  assert.match(html, /src="https:\/\/wordpress\.example\/blog\/wp-content\/uploads\/2026\/09\/example\.jpg"/);
  assert.match(html, /data-zp-comments-api-base-url="https:\/\/wordpress\.example\/blog\/wp-json\/wp\/v2"/);
  assert.match(html, /data-zp-comments-target-public-id="101"/);
  const page = await readFile(join(root, 'dist/about/index.html'), 'utf8');
  assert.match(page, /data-zp-comments-target-type="page"/);
  assert.match(page, /data-zp-comments-target-public-id="201"/);
  const data = JSON.parse(await readFile(join(root, '.zeropress-wxr/preview-data.json'), 'utf8'));
  assert.equal(data.content.posts.length, 3);
  assert.equal(data.site.comments.provider, 'wordpress');
  assert.equal(data.site.url, '');
  assert.equal(await readFile(join(root, 'dist/download.txt'), 'utf8'), 'A public download.');
  assert.equal(await readFile(join(root, 'wordpress-export.xml'), 'utf8'), source);
  assert.match(await readFile(join(root, 'dist/robots.txt'), 'utf8'), /Disallow: \//);
  for (const path of await readdir(join(root, 'dist'), { recursive: true })) {
    assert.ok(!path.endsWith('.xml') && !path.endsWith('.json') && !path.endsWith('.jpg'), `Unexpected published file: ${path}`);
    if (path.endsWith('.html')) {
      const document = await readFile(join(root, 'dist', path), 'utf8');
      assert.doesNotMatch(document, /PRIVATE-DRAFT-CONTENT|PROTECTED-CONTENT|PRIVATE-EXPORTED-COMMENT|private@example\.com|synthetic-password/);
    }
  }
});

test('keeps the previous site on malformed exports and replaces old routes after a valid update', async (t) => {
  const root = await fixture(t);
  assert.equal((await build(root)).code, 0);
  const previous = await readFile(join(root, 'dist/index.html'), 'utf8');
  await writeFile(join(root, 'wordpress-export.xml'), '<rss><channel>');
  const failed = await build(root);
  assert.notEqual(failed.code, 0, failed.output);
  assert.equal(await readFile(join(root, 'dist/index.html'), 'utf8'), previous);
  await writeFile(join(root, 'wordpress-export.xml'), wordpressExport({ slug: 'new-export' }));
  const updated = await build(root);
  assert.equal(updated.code, 0, updated.output);
  assert.match(await readFile(join(root, 'dist/index.html'), 'utf8'), /href="\/new-export\/"/);
  await readFile(join(root, 'dist/new-export/index.html'));
  await assert.rejects(readFile(join(root, 'dist/try-your-export/index.html')), { code: 'ENOENT' });
});

test('builds the included sample with no account setup', async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, 'wordpress-export.xml'), sample);
  const result = await build(root);
  assert.equal(result.code, 0, result.output);
  assert.match(await readFile(join(root, 'dist/index.html'), 'utf8'), /Try ZeroPress/);
  assert.match(await readFile(join(root, 'dist/about/index.html'), 'utf8'), /About this preview/);
});
