(() => {
  'use strict';
  const builtIn = JSON.parse(document.getElementById('knowledge-pages').textContent);
  const sections = [
    { name: '调研', description: '理解注意力架构、引擎实现与缓存尺寸。' },
    { name: '实验', description: '查看真实工作负载下的显存分析与实验结果。' },
    { name: '工具', description: '导入真实会话，调整配置并交互回放。' },
    { name: '其他', description: '更多文档与参考资料。' },
  ];
  const search = document.getElementById('search');
  const filters = document.getElementById('filters');
  const container = document.getElementById('pages');
  const status = document.getElementById('share-status');
  const refresh = document.getElementById('share-refresh');
  const repository = document.querySelector('meta[name="share-repository"]').content;
  document.getElementById('share-submit').href = `https://github.com/${repository}/issues/new?template=share.yml`;
  let shared = [];
  let selected = null;
  let loading = false;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function safeExternal(value) {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  }

  function card(page, pages) {
    const node = element('a', 'card');
    const external = page.fileType === 'link' ? safeExternal(page.externalUrl) : null;
    node.href = page.id ? (external || `share.html?id=${page.id}`) : page.href;
    if (external) {
      node.target = '_blank';
      node.rel = 'noopener noreferrer';
    }
    const top = element('div', 'card-top');
    top.append(element('span', 'number', String(pages.indexOf(page) + 1).padStart(2, '0') + ' /'), element('span', 'category', page.category));
    const tags = element('div', 'tags');
    for (const tag of page.tags) tags.append(element('span', 'tag', tag));
    const open = element('div', 'open');
    const action = external ? '访问文档链接' : page.id ? '阅读文档附件' : page.category === '工具' ? '打开工具' : '阅读文档';
    open.append(element('span', '', action), element('span', '', '↗'));
    node.append(top, element('h3', '', page.title), element('p', '', page.description));
    if (page.id) node.append(element('div', 'share-meta', `${page.author} · ${external ? '链接' : page.fileType.toUpperCase() + ' 附件'} · #${page.id}`));
    node.append(tags, open);
    return node;
  }

  function render() {
    // Keep the original five entries and their order; submissions join the same
    // category grids, search, filter controls, count and empty state.
    const pages = [...builtIn, ...shared];
    const activeSections = sections.filter(section => section.name !== '其他' || pages.some(page => page.category === section.name));
    if (selected && !activeSections.some(section => section.name === selected)) selected = null;
    const query = search.value.trim().toLocaleLowerCase();
    const visible = pages.filter(page => (!selected || page.category === selected) &&
      [page.title, page.description, page.category, page.author || '', ...page.tags].join(' ').toLocaleLowerCase().includes(query));
    container.replaceChildren();
    for (const section of activeSections) {
      const items = visible.filter(page => page.category === section.name);
      if ((selected && selected !== section.name) || (query && !items.length)) continue;
      const group = element('section', 'section');
      group.setAttribute('aria-label', section.name);
      const heading = element('div', 'section-heading');
      heading.append(element('h2', '', section.name), element('p', '', section.description), element('span', 'section-count', `${items.length} 篇`));
      const grid = element('div', 'grid');
      for (const page of items) grid.append(card(page, pages));
      group.append(heading, grid);
      container.append(group);
    }
    // Reconcile controls without replacing a focused button during typing.
    const names = ['全部', ...activeSections.map(section => section.name)];
    for (const button of [...filters.children]) if (!names.includes(button.textContent)) button.remove();
    for (const name of names) {
      let button = [...filters.children].find(node => node.textContent === name);
      if (!button) {
        button = element('button', '', name);
        button.type = 'button';
        button.dataset.category = name === '全部' ? '' : name;
        button.addEventListener('click', () => { selected = button.dataset.category || null; render(); });
        filters.append(button);
      }
      button.setAttribute('aria-pressed', String((button.dataset.category || null) === selected));
    }
    document.getElementById('count').textContent = `${visible.length} / ${pages.length} 篇内容`;
    document.getElementById('empty').hidden = visible.length !== 0;
  }

  async function load() {
    if (loading) return;
    if (location.protocol === 'file:') {
      status.textContent = '本地文件模式展示原有文档。在线分享请访问网站，或启动本地 HTTP 服务。';
      refresh.disabled = true;
      return;
    }
    loading = true;
    refresh.disabled = true;
    status.textContent = '正在同步分享文档…';
    try {
      const response = await fetch('data/shares.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('无法读取分享清单');
      const data = await response.json();
      if (data.version !== 1 || !Array.isArray(data.shares)) throw new Error('分享清单格式不正确');
      shared = data.shares.filter(item => Number.isSafeInteger(item.id) && item.id > 0 &&
        ['html', 'pdf', 'link'].includes(item.fileType) && typeof item.title === 'string' &&
        typeof item.description === 'string' && sections.some(section => section.name === item.category) &&
        typeof item.author === 'string' && Array.isArray(item.tags) && item.tags.every(tag => typeof tag === 'string') &&
        (item.fileType !== 'link' || safeExternal(item.externalUrl)));
      render();
      status.textContent = shared.length ? `已同步 ${shared.length} 篇分享，与原有文档统一展示。` : '可分享链接或上传 HTML/PDF；投稿时请保留 Issue 标题的 [分享] 前缀。';
    } catch {
      status.textContent = '分享文档暂时同步失败，请稍后刷新。已显示的文档仍可使用。';
    } finally {
      loading = false;
      refresh.disabled = false;
    }
  }
  search.addEventListener('input', render);
  refresh.addEventListener('click', load);
  render();
  load();
})();
