(() => {
  'use strict';
  const root = document.getElementById('community');
  if (!root) return;
  const repository = document.querySelector('meta[name="share-repository"]').content;
  const submit = document.getElementById('community-submit');
  submit.href = `https://github.com/${repository}/issues/new?template=share.yml`;
  const container = document.getElementById('community-pages');
  const status = document.getElementById('community-status');
  const refresh = document.getElementById('community-refresh');
  const search = document.getElementById('search');
  const category = document.getElementById('community-category');
  let shares = [];
  let loaded = false;
  let loading = false;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function render() {
    if (!loaded) return;
    const query = (search?.value || '').trim().toLocaleLowerCase();
    const visible = shares.filter(item => (!category.value || item.category === category.value) &&
      [item.title, item.description, item.category, item.author, ...item.tags].join(' ').toLocaleLowerCase().includes(query));
    container.replaceChildren();
    for (const item of visible) {
      const card = element('a', 'card community-card');
      // Only the validated numeric id is used as a navigation target.
      card.href = `share.html?id=${item.id}`;
      const top = element('div', 'card-top');
      top.append(element('span', 'number', `#${item.id}`), element('span', 'category', item.category));
      const tags = element('div', 'tags');
      for (const tag of item.tags) tags.append(element('span', 'tag', tag));
      const open = element('div', 'open');
      open.append(element('span', '', '阅读分享'), element('span', '', '↗'));
      const date = item.createdAt ? new Date(item.createdAt).toLocaleDateString('zh-CN') : '';
      card.append(top, element('h3', '', item.title), element('p', '', item.description),
        element('div', 'community-meta', `${item.author} · ${item.fileType.toUpperCase()}${date ? ` · ${date}` : ''}`), tags, open);
      container.append(card);
    }
    status.textContent = shares.length === 0 ? '还没有用户分享。欢迎上传第一篇文档。' :
      (visible.length === 0 ? '没有匹配的用户分享。' : `显示 ${visible.length} / ${shares.length} 条用户分享`);
  }

  async function load() {
    if (loading) return;
    if (location.protocol === 'file:') {
      status.textContent = '本地文件模式不加载社区分享。请访问 GitHub Pages，或启动本地 HTTP 服务。';
      return;
    }
    loading = true;
    refresh.disabled = true;
    status.textContent = '正在加载用户分享…';
    try {
      const response = await fetch('data/shares.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('无法读取分享清单');
      const data = await response.json();
      if (data.version !== 1 || !Array.isArray(data.shares)) throw new Error('分享清单格式不正确');
      shares = data.shares.filter(item => Number.isSafeInteger(item.id) && item.id > 0 &&
        ['html', 'pdf'].includes(item.fileType) && typeof item.title === 'string' &&
        typeof item.description === 'string' && typeof item.category === 'string' &&
        typeof item.author === 'string' && Array.isArray(item.tags) && item.tags.every(tag => typeof tag === 'string'));
      loaded = true;
      render();
    } catch {
      status.textContent = '用户分享暂时加载失败，请稍后点击刷新。原有知识库仍可使用。';
    } finally {
      loading = false;
      refresh.disabled = false;
    }
  }
  search?.addEventListener('input', render);
  category.addEventListener('change', render);
  refresh.addEventListener('click', load);
  load();
})();
