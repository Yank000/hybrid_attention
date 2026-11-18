import { readFile } from 'node:fs/promises';
import { validateRepository } from './build-shares.mjs';

const marker = '<!-- knowledge-share-status -->';
const repository = validateRepository(process.env.GITHUB_REPOSITORY);
const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
const number = event.issue?.number;
if (!Number.isSafeInteger(number) || number < 1) throw new Error('Missing issue number.');
const isReplacement = event.issue.title?.startsWith('[替换附件]');
const status = process.env.SHARE_STATUS;
const reason = Buffer.from(process.env.SHARE_REASON_B64 || '', 'base64').toString('utf8');
const runUrl = `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;
let message;
if (process.env.DEPLOY_RESULT !== 'success') {
  message = `❌ 自动发布未成功完成。请查看 [Actions 运行记录](${runUrl}) 确认失败原因与线上状态，修复后重新运行。`;
} else if (status === 'published') {
  const base = new URL(process.env.PAGES_BASE_URL.replace(/\/?$/, '/'));
  const shareId = Number(process.env.SHARE_ID);
  if (!Number.isSafeInteger(shareId) || shareId < 1) throw new Error('Missing published share ID.');
  const url = new URL(`share.html?id=${shareId}`, base);
  const result = isReplacement ? '附件已替换，原分享地址继续有效。' : '分享已自动发布，无需人工审批。';
  message = `✅ ${result}\n\n[打开分享文档](${url.href}) · [知识库首页](${base.href})`;
} else if (status === 'rejected') {
  message = `⚠️ 投稿未发布：${reason}\n\n请修改本 Issue 后保存，系统会自动重试。支持文档链接，或一个 UTF-8 自包含 HTML / PDF 附件（最大 20 MiB），一次选择一种。`;
} else {
  message = isReplacement ? 'ℹ️ 这次替换当前未生效。该 Issue 可能已关闭，或已有更新的附件版本。' :
    'ℹ️ 此条目当前未发布（Issue 已关闭、已移除，或不再符合分享表单格式）。网站清单已更新。';
}

async function api(path, method = 'GET', body) {
  const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Issue notification failed: HTTP ${response.status}.`);
  return response.json();
}

let previous;
for (let page = 1; page <= 100; page++) {
  const comments = await api(`issues/${number}/comments?per_page=100&page=${page}`);
  previous = comments.find(comment => comment.user?.login === 'github-actions[bot]' && comment.body?.includes(marker));
  if (previous || comments.length < 100) break;
}
const body = `${marker}\n${message}`;
if (previous) await api(`issues/comments/${previous.id}`, 'PATCH', { body });
else await api(`issues/${number}/comments`, 'POST', { body });
console.log(`Updated publication status on issue #${number}.`);
