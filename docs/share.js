(() => {
  'use strict';
  const status = document.getElementById('status');
  const frame = document.getElementById('document');
  const download = document.getElementById('download');
  const copy = document.getElementById('copy-link');
  let downloadUrl;
  const idText = new URLSearchParams(location.search).get('id') || '';
  const id = Number(idText);
  const CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; media-src data: blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

  async function readJson(path) {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) throw new Error('文档读取失败，请稍后刷新。');
    return response.json();
  }

  async function load() {
    if (!/^\d+$/.test(idText) || !Number.isSafeInteger(id) || id < 1) {
      status.textContent = '分享链接缺少有效的文档 ID。';
      return;
    }
    if (location.protocol === 'file:') {
      status.textContent = '请通过网站或本地 HTTP 服务访问分享页面。';
      return;
    }
    try {
      const data = await readJson('data/shares.json');
      if (data.version !== 1 || !Array.isArray(data.shares) || !/^[\w.-]+\/[\w.-]+$/.test(data.repository)) {
        throw new Error('分享清单格式不正确。');
      }
      const item = data.shares.find(entry => entry.id === id);
      if (!item) {
        const rejected = Array.isArray(data.rejected) && data.rejected.find(entry => entry.id === id);
        status.textContent = rejected ? `投稿尚未发布：${rejected.reason}` :
          '该分享不存在、已撤下，或尚未部署完成。请等待投稿下的机器人发布结果后刷新。';
        return;
      }
      if (!['html', 'pdf', 'link'].includes(item.fileType)) throw new Error('不支持的文档类型。');
      document.title = `${item.title} · 用户分享`;
      document.getElementById('share-title').textContent = item.title;
      document.getElementById('share-description').textContent = item.description;
      document.getElementById('share-meta').textContent = `#${id} · ${item.author} · ${item.category} · ${item.fileType === 'link' ? '文档链接' : item.fileType.toUpperCase()}`;
      const source = document.getElementById('source');
      source.href = `https://github.com/${data.repository}/issues/${id}`;
      source.hidden = false;
      if (item.fileType === 'link') {
        const url = new URL(item.externalUrl);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('文档链接格式不正确。');
        const external = document.getElementById('external-link');
        external.href = url.href;
        external.hidden = false;
        copy.hidden = false;
        document.getElementById('share-notice').textContent = '此条目为外部文档链接。内容和访问权限由原网站管理，本知识库不托管其正文。';
        status.textContent = `原文网站：${url.hostname}。点击“打开原文”访问文档。`;
        return;
      }
      if (item.fileType === 'html') {
        const documentData = await readJson(`shared/${id}/document.json`);
        if (typeof documentData.content !== 'string') throw new Error('HTML 文档数据不正确。');
        // This prefix is parsed before all untrusted markup. The iframe has an
        // opaque origin: never add allow-same-origin to its sandbox.
        const content = documentData.content.replace(/^\s*<!doctype[^>]*>/i, '');
        frame.srcdoc = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}">${content}`;
        downloadUrl = URL.createObjectURL(new Blob([documentData.content], { type: 'text/html;charset=utf-8' }));
        download.href = downloadUrl;
        download.download = `share-${id}.html`;
      } else {
        frame.src = `shared/${id}/document.pdf`;
        download.href = frame.src;
        download.download = `share-${id}.pdf`;
      }
      frame.hidden = false;
      download.hidden = false;
      copy.hidden = false;
      status.textContent = item.fileType === 'pdf' ? '若浏览器未显示 PDF，请点击“下载文档”。' : '文档已加载。';
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : '分享暂时无法加载，请稍后刷新。';
    }
  }
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(new URL(`share.html?id=${id}`, location.href).href);
      status.textContent = '分享链接已复制。';
    } catch {
      status.textContent = '无法自动复制，请复制浏览器地址栏中的网址。';
    }
  });
  window.addEventListener('pagehide', () => { if (downloadUrl) URL.revokeObjectURL(downloadUrl); });
  load();
})();
