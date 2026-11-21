import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const index = await readFile(new URL('../docs/index.html', import.meta.url), 'utf8');
const source = await readFile(new URL('../docs/knowledge.js', import.meta.url), 'utf8');
const authorNames = await readFile(new URL('../docs/author-names.js', import.meta.url), 'utf8');
const builtIn = JSON.parse(index.match(/<script id="knowledge-pages" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const shareInstructions = index.match(/<p id="share-status"[^>]*>([^<]+)<\/p>/)[1];

class Node {
  constructor(tag = '') { this.tag = tag; this.children = []; this.events = {}; this.dataset = {}; this.attributes = {}; this.value = ''; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return (this.text || '') + this.children.map(node => node.textContent).join(''); }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, listener) { this.events[name] = listener; }
  remove() { this.parent.children = this.parent.children.filter(node => node !== this); }
}
const link = { id: 10, fileType: 'link', externalUrl: 'https://example.com/notes?x=1#part',
  title: '共享调研链接', description: 'prefix 技术笔记', category: '调研', author: 'alice', tags: ['Link'],
  createdAt: '2026-11-05T07:32:01Z' };
const attachment = { id: 11, fileType: 'html', title: '共享工具附件', description: 'replay 工具',
  category: '工具', author: 'bob', createdAt: '2026-10-27T08:30:00Z', updatedAt: '2026-11-06T00:00:00Z' };
const tick = () => new Promise(done => setImmediate(done));

async function boot(shares = [link, attachment], protocol = 'https:') {
  const nodes = new Map(['knowledge-pages', 'search', 'filters', 'pages', 'share-status', 'share-refresh',
    'share-submit', 'count', 'empty'].map(id => [id, new Node()]));
  nodes.get('knowledge-pages').textContent = JSON.stringify(builtIn);
  nodes.get('share-status').textContent = shareInstructions;
  let current = shares;
  let failed = false;
  let requests = 0;
  const namesFixture = authorNames.replace(/const names = \{[\s\S]*?\};/, "const names = { ALICE: '测试姓名' };");
  vm.runInNewContext(namesFixture + '\n' + source, {
    document: { getElementById: id => nodes.get(id), createElement: tag => new Node(tag), querySelector: () => ({ content: 'Yank000/hybrid_attention' }) },
    location: { protocol }, URL,
    fetch: async () => { requests++; if (failed) throw new Error('outage'); return { ok: true, json: async () => ({ version: 1, shares: current }) }; },
  });
  await tick();
  return {
    nodes, get: id => nodes.get(id),
    cards: () => nodes.get('pages').children.map(row => row.children[0]),
    filter: name => nodes.get('filters').children.find(node => node.textContent === name).events.click(),
    search: query => { nodes.get('search').value = query; nodes.get('search').events.input(); },
    setShares: shares => { current = shares; }, fail: () => { failed = true; }, requests: () => requests,
    refresh: async () => { await nodes.get('share-refresh').events.click(); await tick(); },
  };
}

test('preserves the five built-in documents and has no separate sharing section', () => {
  assert.equal(builtIn.length, 5);
  assert.deepEqual(builtIn.map(item => item.href), ['mainstream_attention_arch.html', 'hybrid_VRAM_management.html',
    'cache_size_overview.html', 'continuous_pressure_1h.html', 'agentx_multi_session_replay.html']);
  assert.deepEqual(builtIn.map(item => item.category), ['调研', '调研', '调研', '实验', '工具']);
  assert.ok(!index.includes('id="community"'));
  assert.ok(!index.includes('community-pages'));
  assert.ok(index.includes('knowledge.js'));
});

test('one chronological list mixes local creation times and share submission times', async () => {
  const app = await boot();
  assert.equal(app.cards().length, 7);
  assert.equal(app.get('count').textContent, '7 / 7 篇内容');
  assert.ok(app.get('pages').children.every(row => row.tag === 'li' && row.children.length === 1));
  assert.deepEqual(app.cards().map(card => card.href), [
    link.externalUrl, 'continuous_pressure_1h.html', 'agentx_multi_session_replay.html',
    'share.html?id=11', 'cache_size_overview.html', 'mainstream_attention_arch.html',
    'hybrid_VRAM_management.html',
  ]);
  const metadata = app.cards().map(card => card.children[1]);
  const times = metadata.map(meta => meta.children[0]);
  assert.ok(times.every(time => time.tag === 'time' && time.attributes.datetime));
  assert.equal(times[0].textContent, '2026/11/05 15:32');
  assert.equal(times[3].attributes.datetime, attachment.createdAt);
  assert.deepEqual(metadata.map(meta => meta.children[1].textContent), [
    '测试姓名', 'Yank000', 'Yank000', 'bob', 'Yank000', 'Yank000', 'Yank000',
  ]);
  assert.deepEqual(app.cards().map(card => card.children[0].children[0].children[2].textContent), [
    '阅读文档 ↗', '阅读文档 ↗', '打开工具 ↗', '打开工具 ↗', '阅读文档 ↗', '阅读文档 ↗', '阅读文档 ↗',
  ]);
  assert.ok(app.cards().every(card => !/#\d+|HTML 附件|· 链接/.test(card.textContent)));
  const external = app.cards().find(card => card.href === link.externalUrl);
  assert.equal(external.target, '_blank');
  assert.equal(external.rel, 'noopener noreferrer');
  assert.ok(app.cards().some(card => card.href === 'share.html?id=11'));
  assert.ok(app.get('share-submit').href.endsWith('template=share.yml'));
});

test('a single category filter, search, count and empty state apply to every document', async () => {
  const app = await boot();
  app.filter('调研');
  assert.deepEqual(app.cards().map(card => card.href), [
    link.externalUrl, 'cache_size_overview.html', 'mainstream_attention_arch.html', 'hybrid_VRAM_management.html',
  ]);
  assert.equal(app.get('count').textContent, '4 / 7 篇内容');
  app.search('alice');
  assert.equal(app.cards().length, 1);
  assert.equal(app.cards()[0].href, link.externalUrl);
  app.search('测试姓名');
  assert.equal(app.cards()[0].href, link.externalUrl);
  app.search('Yank000');
  assert.equal(app.cards().length, 3);
  app.search('does-not-exist');
  assert.equal(app.cards().length, 0);
  assert.equal(app.get('empty').hidden, false);
  app.search(''); app.filter('全部');
  assert.equal(app.cards().length, 7);
  assert.equal(app.get('empty').hidden, true);
});

test('unsafe external links are excluded and untrusted titles remain literal text', async () => {
  const title = '<img src=x onerror=alert(1)>';
  const app = await boot([{ ...link, title }, { ...link, id: 99, externalUrl: 'javascript:alert(1)' }]);
  assert.equal(app.cards().length, 6);
  const heading = app.cards().find(card => card.href === link.externalUrl).children[0].children[0].children[0];
  assert.equal(heading.textContent, title);
  assert.equal(heading.children.length, 0);
});

test('refresh reconciles new/removed entries and optional categories without duplicates', async () => {
  const app = await boot();
  app.setShares([{ ...link, category: '其他' }]); await app.refresh();
  assert.equal(app.cards().length, 6);
  assert.equal(app.get('share-status').textContent, shareInstructions);
  app.filter('其他'); assert.equal(app.cards().length, 1);
  app.setShares([]); await app.refresh();
  assert.equal(app.cards().length, 5);
  assert.equal(app.get('count').textContent, '5 / 5 篇内容');
  assert.ok(!app.get('filters').children.some(node => node.textContent === '其他'));
});

test('network failure keeps displayed documents; file mode renders the original five offline', async () => {
  const app = await boot(); app.fail(); await app.refresh();
  assert.equal(app.cards().length, 7);
  assert.ok(app.get('share-status').textContent.includes('同步失败'));
  const offline = await boot([], 'file:');
  assert.equal(offline.requests(), 0);
  assert.equal(offline.cards().length, 5);
  assert.equal(offline.get('share-refresh').disabled, true);
});
