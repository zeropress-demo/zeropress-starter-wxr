import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../theme/assets/comment-data.js', import.meta.url), 'utf8');
const config = {
  provider: 'wordpress', apiBaseUrl: 'https://wordpress.example/blog/wp-json/wp/v2',
  targetPublicId: 101, targetType: 'post', perPage: 2, order: 'desc',
};
// Transport tests use plain text. Browser QA exercises HTML decoding in a real template element.
function documentStub() {
  return {
    createElement() {
      const content = { textContent: '', querySelectorAll: () => [] };
      return { content, set innerHTML(value) {
        assert.doesNotMatch(value, /[<>]/);
        content.textContent = value;
      } };
    },
  };
}
function runtime(handler, overrides = {}) {
  const window = { location: { origin: 'https://preview.example' } };
  vm.runInNewContext(source, {
    window, document: documentStub(), URL, FormData, AbortController,
    setTimeout, clearTimeout, fetch: handler ?? (() => { throw new Error('Unexpected request'); }), ...overrides,
  });
  return window.ZeroPressCommentData;
}
function response(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}
function comment(id, parent = 0) {
  return { id, post: 101, parent, author_name: 'Example Reader', date_gmt: '2026-09-20T12:30:00', content: { rendered: 'A sample comment.' } };
}

test('uses the original WordPress post ID and paginates on demand', async () => {
  const calls = [];
  const api = runtime(async (url, options) => {
    calls.push({ url: new URL(url), options });
    return calls.length === 1
      ? response([comment(1), comment(2, 1)], 200, { 'X-WP-Total': '3', 'X-WP-TotalPages': '2' })
      : response([comment(3)], 200, { 'X-WP-Total': '3', 'X-WP-TotalPages': '2' });
  });
  const data = api.create(config);
  const first = await data.load();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.origin, 'https://wordpress.example');
  assert.equal(calls[0].url.pathname, '/blog/wp-json/wp/v2/comments');
  assert.equal(calls[0].url.searchParams.get('post'), '101');
  assert.equal(calls[0].url.searchParams.get('page'), '1');
  assert.equal(calls[0].url.searchParams.get('per_page'), '2');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(first.pagination.totalPages, 2);
  assert.equal(first.pagination.totalComments, 3);
  assert.equal(first.comments[1].parentId, '1');
  assert.equal(first.comments[0].createdAt, '2026-09-20T12:30:00Z');
  assert.equal(data.originalUrl, 'https://wordpress.example/blog/?p=101#comments');
  const second = await data.load(2);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url.searchParams.get('page'), '2');
  assert.equal(second.comments[0].id, '3');
  assert.equal(api.create({ ...config, targetType: 'page', targetPublicId: 201 }).originalUrl,
    'https://wordpress.example/blog/?page_id=201#comments');
});

test('handles empty comments and unavailable pagination headers', async () => {
  const api = runtime(async (_url) => response([]));
  const empty = await api.create(config).load();
  assert.equal(empty.comments.length, 0);
  assert.equal(empty.pagination.totalPages, 1);
  let call = 0;
  const limited = runtime(async () => ++call === 1
    ? response([comment(1), comment(2)])
    : response({ code: 'rest_comment_invalid_page_number' }, 400)).create(config);
  assert.equal((await limited.load()).pagination.totalPages, 2);
  assert.equal((await limited.load(2)).pagination.totalPages, 2);
});

test('submits guest replies to WordPress and distinguishes approval from moderation', async () => {
  const statuses = ['hold', 'approved'];
  const data = runtime(async (url, options) => {
    assert.equal(new URL(url).searchParams.get('post'), '101');
    assert.equal(options.method, 'POST');
    assert.equal(options.body.get('parent'), '7');
    assert.equal(options.body.get('author_name'), 'Example Reader');
    assert.equal(options.body.get('author_email'), 'reader@example.com');
    assert.equal(options.body.get('content'), 'A reply.');
    assert.equal(options.credentials, 'omit');
    return response({ ...comment(10), status: statuses.shift() }, 201);
  }).create(config);
  const input = { parentId: '7', authorName: 'Example Reader', authorEmail: 'reader@example.com', content: 'A reply.' };
  assert.equal((await data.submit(input)).publication, 'pending_moderation');
  assert.equal((await data.submit(input)).publication, 'published');
});

test('reports WordPress permissions, rate limits, and malformed replies as failures', async () => {
  for (const status of [401, 403]) {
    const data = runtime(async () => response({}, status)).create(config);
    await assert.rejects(data.load(), /not allowing.*read comments/);
    await assert.rejects(data.submit({}), /does not allow comments/);
  }
  await assert.rejects(runtime(async () => response({}, 429)).create(config).load(), /too many requests/);
  await assert.rejects(runtime(async () => response({})).create(config).load(), /temporarily unavailable/);
  await assert.rejects(runtime(async () => response([{}])).create(config).load(), /unreadable comment/);
  await assert.rejects(runtime(async () => response({ ...comment(1), post: 999 }, 201)).create(config).submit({}), /could not confirm/);
});

test('does not retry an unconfirmed submission and enforces a request timeout', async () => {
  let calls = 0;
  const data = runtime(async () => { calls++; throw new TypeError('Network failure'); }).create(config);
  await assert.rejects(data.submit({}), /could not be confirmed.*original WordPress page/);
  assert.equal(calls, 1);
  const timedOut = runtime(async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }), { setTimeout: (fn, ms) => { assert.equal(ms, 15_000); queueMicrotask(fn); return 1; }, clearTimeout: () => {} });
  await assert.rejects(timedOut.create(config).load(), /Cannot reach WordPress comments/);
});

test('rejects unsafe endpoints before sending a request', () => {
  const api = runtime();
  for (const apiBaseUrl of ['javascript:alert(1)', 'https://user:password@wordpress.example/wp-json/wp/v2', 'https://wordpress.example/wp-json/wp/v2?token=secret']) {
    assert.throws(() => api.create({ ...config, apiBaseUrl }), /connection is invalid/);
  }
});
