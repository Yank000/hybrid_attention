import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../docs/share.js', import.meta.url), 'utf8');

async function openReader(fileType, replacementId) {
  const nodes = new Map();
  const requests = [];
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, { hidden: true, addEventListener() {} });
    return nodes.get(id);
  };
  vm.runInNewContext(source, {
    document: { getElementById: element },
    window: { addEventListener() {} },
    location: { search: '?id=4', protocol: 'https:' },
    URL, URLSearchParams, Blob,
    fetch: async path => {
      requests.push(path);
      return { ok: true, json: async () => path === 'data/shares.json' ? {
        version: 1, repository: 'owner/project', shares: [{
          id: 4, title: 'Title', description: 'Description', fileType, replacementId,
          author: 'editor', category: '调研', createdAt: '2026-11-18T11:00:00Z',
          externalUrl: 'https://example.com/document',
        }],
      } : { content: '<h1>New attachment</h1>' } };
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  return { element, requests };
}

test('attachment reader opens the active revision and targets the original share when replacing it', async () => {
  const html = await openReader('html', 7);
  assert.deepEqual(html.requests, ['data/shares.json', 'shared/4/7/document.json']);
  assert.match(html.element('document').srcdoc, /<h1>New attachment<\/h1>/);
  assert.match(html.element('share-meta').textContent, /editor.*2026\/11\/18 19:00 UTC\+8/);
  const replace = html.element('replace-attachment');
  const url = new URL(replace.href);
  assert.equal(replace.hidden, false);
  assert.equal(url.origin + url.pathname, 'https://github.com/owner/project/issues/new');
  assert.equal(url.searchParams.get('template'), 'replace-attachment.md');
  assert.equal(url.searchParams.get('title'), '[替换附件] #4');

  const pdf = await openReader('pdf', 8);
  assert.equal(pdf.element('document').src, 'shared/4/8/document.pdf');
  assert.equal(pdf.element('download').href, pdf.element('document').src);
  const original = await openReader('pdf');
  assert.equal(original.element('document').src, 'shared/4/document.pdf');
  const link = await openReader('link');
  assert.equal(link.element('replace-attachment').hidden, true);
});
