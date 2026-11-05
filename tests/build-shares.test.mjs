import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  InvalidSubmission, MAX_FILE_BYTES, parseSubmission, parseAttachment,
  decodeDocument, validateAttachmentRedirect, requestBytes, listOpenIssues, buildSite,
} from '../scripts/build-shares.mjs';

const HTML_URL = 'https://github.com/user-attachments/files/12345/note.html';
const PDF_URL = 'https://github.com/user-attachments/files/12346/note.pdf';
function issue(number = 1, overrides = {}) {
  return {
    number, title: '[分享] 测试', state: 'open', user: { login: 'alice' },
    created_at: '2026-11-05T00:00:00Z', updated_at: '2026-11-05T00:00:00Z',
    body: `### 文档标题\n\n测试文档\n\n### 文档简介\n\n测试简介\n\n### 文档分类\n\n调研\n\n### 文档标签（可选）\n\nvLLM，KV Cache\n\n### 文档附件\n\n[note.html](${HTML_URL})`,
    ...overrides,
  };
}
function response(body, status = 200, headers = {}) { return new Response(body, { status, headers }); }
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'knowledge-share-test-'));
  t.after(async () => {
    assert.ok(root.startsWith(join(tmpdir(), 'knowledge-share-test-')));
    await rm(root, { recursive: true, force: true });
  });
  const docsDir = join(root, 'docs');
  await mkdir(docsDir);
  await writeFile(join(docsDir, 'index.html'), '<meta name="share-repository" content="old/repo"><h1>Original knowledge base</h1>');
  await writeFile(join(docsDir, 'original.html'), '<h1>Original</h1>');
  await writeFile(join(docsDir, 'private.log'), 'must not deploy');
  return { root, docsDir, outputDir: join(root, '_site'), repository: 'test/repo' };
}
const html = Buffer.from('<!doctype html><html><head><title>Demo</title></head><body><script>window.demo = true</script><h1>Hello</h1></body></html>');

test('parses the issue form and handles CRLF, optional tags and legacy attachments', () => {
  const parsed = parseSubmission(issue());
  assert.equal(parsed.id, 1);
  assert.equal(parsed.fileType, 'html');
  assert.deepEqual(parsed.tags, ['vLLM', 'KV Cache']);
  assert.equal(parseSubmission(issue(1, { title: 'ordinary bug' })), null);
  assert.equal(parseSubmission(issue(1, { body: issue().body.replace(/\n/g, '\r\n') })).title, '测试文档');
  assert.deepEqual(parseSubmission(issue(1, { body: issue().body.replace('vLLM，KV Cache', '_No response_') })).tags, []);
  assert.equal(parseAttachment('[file](https://github.com/owner/repo/files/123/file.PDF)').fileType, 'pdf');
});

test('rejects duplicate, incomplete, oversized and invalid metadata', () => {
  for (const body of [
    '', issue().body + '\n### 文档标题\nsecond',
    issue().body.replace('测试文档', 'x'.repeat(121)),
    issue().body.replace('调研', 'invalid'),
    issue().body.replace('vLLM，KV Cache', Array.from({ length: 9 }, (_, i) => `tag${i}`).join(',')),
    issue().body.replace('测试简介', '_No response_'),
  ]) assert.throws(() => parseSubmission(issue(1, { body })), InvalidSubmission);
});

test('attachment input cannot target external URLs, local services or repository source', () => {
  for (const url of [
    'http://github.com/user-attachments/files/123/x.html',
    'https://example.com/file.html', 'https://127.0.0.1/file.html',
    'https://github.com/owner/repo/raw/main/file.html',
    'https://github.com/user-attachments/files/123/x.zip',
    'https://github.com/user-attachments/files/123/x.html?token=bad',
    'https://evil@github.com/user-attachments/files/123/x.html',
    'https://[invalid/file.html',
  ]) assert.throws(() => parseAttachment(`[file](${url})`), InvalidSubmission);
  assert.throws(() => parseAttachment(`[a](${HTML_URL}) [b](${PDF_URL})`), InvalidSubmission);
  assert.throws(() => validateAttachmentRedirect('https://127.0.0.1/secret'), InvalidSubmission);
  assert.throws(() => validateAttachmentRedirect('https://evil.s3.amazonaws.com/secret'), InvalidSubmission);
});

test('validates file signatures, UTF-8 and byte limits; stores HTML as inert JSON', () => {
  assert.equal(JSON.parse(decodeDocument(html, 'html')).content, html.toString());
  assert.equal(decodeDocument(Buffer.from('%PDF-1.7\n'), 'pdf').toString(), '%PDF-1.7\n');
  assert.throws(() => decodeDocument(Buffer.from('<html>not pdf'), 'pdf'), InvalidSubmission);
  assert.throws(() => decodeDocument(Buffer.from([0xff, 0xfe]), 'html'), InvalidSubmission);
  assert.throws(() => decodeDocument(Buffer.from('<h1>\0'), 'html'), InvalidSubmission);
  assert.throws(() => decodeDocument(Buffer.alloc(MAX_FILE_BYTES + 1), 'html'), InvalidSubmission);
});

test('downloads follow only approved redirects and never send the API token to attachments', async () => {
  const requests = [];
  const download = await requestBytes(HTML_URL, {
    token: 'must-not-leak',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return requests.length === 1 ? response(null, 302, { location: 'https://github-production-user-asset-6210df.s3.amazonaws.com/document' }) : response(html);
    },
  });
  assert.deepEqual(download, html);
  assert.ok(requests.every(({ options }) => options.headers.Authorization === undefined));
  let calls = 0;
  await assert.rejects(requestBytes(HTML_URL, {
    fetchImpl: async () => { calls++; return response(null, 302, { location: 'http://169.254.169.254/latest/meta-data/' }); },
  }), InvalidSubmission);
  assert.equal(calls, 1);
});

test('download limits apply to content-length and chunked responses', async () => {
  await assert.rejects(requestBytes(HTML_URL, { maxBytes: 4, fetchImpl: async () => response('12345') }), InvalidSubmission);
  await assert.rejects(requestBytes(HTML_URL, {
    maxBytes: 4, fetchImpl: async () => response('', 200, { 'content-length': '5' }),
  }), InvalidSubmission);
});

test('transient errors retry; missing attachments reject only that submission', async () => {
  let calls = 0;
  const bytes = await requestBytes(HTML_URL, {
    sleep: async () => {}, fetchImpl: async () => ++calls === 1 ? response('', 503) : response(html),
  });
  assert.equal(bytes.toString(), html.toString());
  assert.equal(calls, 2);
  await assert.rejects(requestBytes(HTML_URL, { fetchImpl: async () => response('', 404) }), InvalidSubmission);
});

test('paginates all open issues, excludes pull requests, and fails rather than truncates API errors', async () => {
  let calls = 0;
  const rows = await listOpenIssues('test/repo', 'token', async (url, options) => {
    assert.equal(options.api, true);
    assert.equal(options.token, 'token');
    calls++;
    assert.ok(url.endsWith(`page=${calls}`));
    return Buffer.from(JSON.stringify(calls === 1 ? Array.from({ length: 100 }, (_, i) => issue(i + 1)) :
      [issue(101), issue(102, { pull_request: {} }), issue(103, { state: 'closed' })]));
  });
  assert.equal(calls, 2);
  assert.equal(rows.length, 101);
  await assert.rejects(listOpenIssues('test/repo', 'token', async () => { throw new Error('API outage'); }), /API outage/);
});

test('build includes every valid issue, preserves docs, escapes HTML as JSON, and skips invalid issues', async t => {
  const config = await fixture(t);
  const manifest = await buildSite({ ...config, issues: [
    issue(1), issue(2, { body: issue().body.replace(HTML_URL, PDF_URL) }),
    issue(3, { body: '' }), issue(4, { title: 'normal issue' }), issue(5, { state: 'closed' }),
  ], download: async url => url === PDF_URL ? Buffer.from('%PDF-1.7\n') : html });
  assert.deepEqual(manifest.shares.map(item => item.id), [2, 1]);
  assert.equal(manifest.rejected[0].id, 3);
  assert.equal(manifest.repository, 'test/repo');
  assert.ok(!(await readdir(config.outputDir)).includes('private.log'));
  assert.equal(await readFile(join(config.outputDir, 'original.html'), 'utf8'), '<h1>Original</h1>');
  assert.ok((await readFile(join(config.outputDir, 'index.html'), 'utf8')).includes('content="test/repo"'));
  const stored = JSON.parse(await readFile(join(config.outputDir, 'shared/1/document.json'), 'utf8'));
  assert.equal(stored.content, html.toString());
  await assert.rejects(access(join(config.outputDir, 'shared/1/document.html')));
  assert.ok(manifest.shares.every(item => !('url' in item)));
});

test('full rebuild removes closed entries and keeps stable links across edits', async t => {
  const config = await fixture(t);
  const first = await buildSite({ ...config, issues: [issue(1), issue(2)], download: async () => html });
  const secondOutput = join(config.root, 'next-site');
  const second = await buildSite({ ...config, outputDir: secondOutput,
    issues: [issue(1, { body: issue().body.replace('测试文档', '新标题') }), issue(2, { state: 'closed' })], download: async () => html });
  assert.equal(first.shares.find(item => item.id === 1).href, second.shares[0].href);
  assert.equal(second.shares[0].title, '新标题');
  assert.equal(second.shares.length, 1);
  await assert.rejects(access(join(secondOutput, 'shared/2')));
});

test('network failures do not publish partial output or overwrite previous output', async t => {
  const config = await fixture(t);
  await assert.rejects(buildSite({ ...config, issues: [issue(1), issue(2)], download: async () => { throw new Error('outage'); } }), /outage/);
  await assert.rejects(access(config.outputDir));
  await mkdir(config.outputDir);
  await writeFile(join(config.outputDir, 'keep.txt'), 'existing');
  await assert.rejects(buildSite({ ...config, issues: [], download: async () => html }), /already exists/);
  assert.equal(await readFile(join(config.outputDir, 'keep.txt'), 'utf8'), 'existing');
});

test('200-share capacity is enforced without deploying an incomplete list', async t => {
  const config = await fixture(t);
  await assert.rejects(buildSite({ ...config, issues: Array.from({ length: 201 }, (_, i) => issue(i + 1)), download: async () => html }), /200 shares/);
  await assert.rejects(access(config.outputDir));
});

test('a malformed attachment URL rejects only its issue and does not block others', async t => {
  const config = await fixture(t);
  const manifest = await buildSite({ ...config, issues: [
    issue(1, { body: issue().body.replace(HTML_URL, 'https://[invalid/file.html') }), issue(2),
  ], download: async () => html });
  assert.deepEqual(manifest.shares.map(item => item.id), [2]);
  assert.equal(manifest.rejected[0].id, 1);
});

test('API redirects cannot forward authentication and attachment redirect loops stop', async () => {
  let calls = 0;
  await assert.rejects(requestBytes('https://api.github.com/repos/test/repo/issues', {
    api: true, token: 'secret', fetchImpl: async () => { calls++; return response(null, 302, { location: 'https://example.com' }); },
  }), /redirect/);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(requestBytes(HTML_URL, {
    fetchImpl: async () => { calls++; return response(null, 302, { location: HTML_URL }); },
  }), /redirect/);
  assert.equal(calls, 6);
});
