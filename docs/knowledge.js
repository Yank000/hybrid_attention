(() => {
  'use strict';
  const builtIn = JSON.parse(document.getElementById('knowledge-pages').textContent)
    .map(page => ({ ...page, author: 'Yank000' }));
  const categories = ['调研', '实验', '工具', '其他'];
  const search = document.getElementById('search');
  const filters = document.getElementById('filters');
  const container = document.getElementById('pages');
  const status = document.getElementById('share-status');
  const shareInstructions = status.textContent;
  const refresh = document.getElementById('share-refresh');
  const repository = document.querySelector('meta[name="share-repository"]').content;
  document.getElementById('share-submit').href = `https://github.com/${repository}/issues/new?template=share.yml`;
  let shared = [];
  let selected = null;
  let loading = false;
  const dateFormat = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });

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

  function timestamp(page) {
    return Date.parse(page.createdAt) || 0;
  }

  function card(page) {
    const node = element('a', 'card');
    const external = page.fileType === 'link' ? safeExternal(page.externalUrl) : null;
    node.href = page.id ? (external || `share.html?id=${page.id}`) : page.href;
    if (external) {
      node.target = '_blank';
      node.rel = 'noopener noreferrer';
    }
    const content = element('div', 'card-content');
    const heading = element('div', 'card-heading');
    const action = page.category === '工具' ? '打开工具' : '阅读文档';
    heading.append(element('h2', '', page.title), element('span', 'category', page.category),
      element('span', 'open', action + ' ↗'));
    content.append(heading, element('p', '', page.description));
    const date = timestamp(page);
    const time = date ? element('time', 'card-time', dateFormat.format(date)) :
      element('span', 'card-time', '时间未知');
    if (date) {
      time.setAttribute('datetime', page.createdAt);
      time.title = page.id ? '投稿时间' : '文档创建时间';
    }
    const meta = element('div', 'card-meta');
    meta.append(time, element('span', '', authorName(page.author)));
    node.append(content, meta);
    const row = element('li', '');
    row.append(node);
    return row;
  }

  function render() {
    const pages = [...builtIn, ...shared].sort((a, b) => timestamp(b) - timestamp(a));
    const activeCategories = categories.filter(category => category !== '其他' || pages.some(page => page.category === category));
    if (selected && !activeCategories.includes(selected)) selected = null;
    const query = search.value.trim().toLocaleLowerCase();
    const visible = pages.filter(page => (!selected || page.category === selected) &&
      [page.title, page.description, page.category, page.author, authorName(page.author)].join(' ').toLocaleLowerCase().includes(query));
    container.replaceChildren(...visible.map(card));
    // Reconcile controls without replacing a focused button during typing.
    const names = ['全部', ...activeCategories];
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
        typeof item.description === 'string' && categories.includes(item.category) &&
        typeof item.author === 'string' &&
        (item.fileType !== 'link' || safeExternal(item.externalUrl)));
      render();
      status.textContent = shareInstructions;
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
