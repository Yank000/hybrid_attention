import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const index = await readFile(new URL('../docs/index.html', import.meta.url), 'utf8');
const source = await readFile(new URL('../docs/knowledge.js', import.meta.url), 'utf8');
const builtIn = JSON.parse(index.match(/<script id="knowledge-pages" type="application\/json">([\s\S]*?)<\/script>/)[1]);

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
  title: '共享调研链接', description: 'prefix 技术笔记', category: '调研', author: 'alice', tags: ['Link'] };
const attachment = { id: 11, fileType: 'html', title: '共享工具附件', description: 'replay 工具', category: '工具', author: 'bob', tags: ['HTML'] };
const tick = () => new Promise(done => setImmediate(done));

async function boot(shares = [link, attachment], protocol = 'https:') {
  const nodes = new Map(['knowledge-pages', 'search', 'filters', 'pages', 'share-status', 'share-refresh',
    'share-submit', 'count', 'empty'].map(id => [id, new Node()]));
  nodes.get('knowledge-pages').textContent = JSON.stringify(builtIn);
  let current = shares;
  let failed = false;
  let requests = 0;
  vm.runInNewContext(source, {
    document: { getElementById: id => nodes.get(id), createElement: tag => new Node(tag), querySelector: () => ({ content: 'Yank000/hybrid_attention' }) },
    location: { protocol }, URL,
    fetch: async () => { requests++; if (failed) throw new Error('outage'); return { ok: true, json: async () => ({ version: 1, shares: current }) }; },
  });
  await tick();
  return {
    nodes, get: id => nodes.get(id),
    cards: () => nodes.get('pages').children.flatMap(section => section.children[1].children),
    filter: name => nodes.get('filters').children.find(node => node.textContent === name).events.click(),
    search: query => { nodes.get('search').value = query; nodes.get('search').events.input(); },
    setShares: shares => { current = shares; }, fail: () => { failed = true; }, requests: () => requests,
    refresh: async () => { await nodes.get('share-refresh').events.click(); await tick(); },
  };
}

test('preserves the uncommitted five-document baseline and has no separate sharing section', () => {
  assert.equal(builtIn.length, 5);
  assert.deepEqual(builtIn.map(item => item.href), ['mainstream_attention_arch.html', 'hybrid_VRAM_management.html',
    'cache_size_overview.html', 'continuous_pressure_1h.html', 'agentx_multi_session_replay.html']);
  assert.deepEqual(builtIn.map(item => item.category), ['调研', '调研', '调研', '实验', '工具']);
  assert.ok(!index.includes('id="community"'));
  assert.ok(!index.includes('community-pages'));
  assert.ok(index.includes('knowledge.js'));
});

test('original documents and both sharing types join the same category grids and count', async () => {
  const app = await boot();
  assert.equal(app.cards().length, 7);
  assert.equal(app.get('count').textContent, '7 / 7 篇内容');
  assert.deepEqual(app.get('pages').children.map(section => section.attributes['aria-label']), ['调研', '实验', '工具']);
  assert.deepEqual(app.get('pages').children.map(section => section.children[1].children.length), [4, 1, 2]);
  const external = app.cards().find(card => card.href === link.externalUrl);
  assert.equal(external.target, '_blank');
  assert.equal(external.rel, 'noopener noreferrer');
  assert.ok(app.cards().some(card => card.href === 'share.html?id=11'));
  assert.ok(app.get('share-submit').href.endsWith('template=share.yml'));
});

test('a single category filter, search, count and empty state apply to every document', async () => {
  const app = await boot();
  app.filter('调研');
  assert.equal(app.cards().length, 4);
  assert.equal(app.get('count').textContent, '4 / 7 篇内容');
  app.search('alice');
  assert.equal(app.cards().length, 1);
  assert.equal(app.cards()[0].href, link.externalUrl);
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
  const card = app.cards().find(card => card.href === link.externalUrl);
  assert.equal(card.children[1].textContent, title);
  assert.equal(card.children[1].children.length, 0);
});

test('refresh reconciles new/removed entries and optional categories without duplicates', async () => {
  const app = await boot();
  app.setShares([{ ...link, category: '其他' }]); await app.refresh();
  assert.equal(app.cards().length, 6);
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
