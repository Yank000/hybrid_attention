import { appendFile, cp, lstat, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { resolve, relative, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_SITE_BYTES = 800 * 1024 * 1024;
const MAX_SHARED_BYTES = 200 * 1024 * 1024;
const MAX_SHARES = 200;
const CATEGORIES = new Set(['调研', '实验', '工具', '其他']);
const FIELDS = ['文档标题', '文档简介', '文档分类', '文档标签（可选）', '文档附件'];

export class InvalidSubmission extends Error {}

export function validateRepository(repository) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '')) {
    throw new Error('GITHUB_REPOSITORY must be owner/repository.');
  }
  return repository;
}

function isAttachmentHost(host) {
  return ['github.com', 'objects.githubusercontent.com', 'user-images.githubusercontent.com'].includes(host) ||
    /^github-production-(?:user-asset|repository-file)-[a-z0-9]+\.s3\.amazonaws\.com$/.test(host);
}

export function validateAttachmentRedirect(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new InvalidSubmission('附件跳转地址不正确，请重新上传。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !isAttachmentHost(url.hostname)) {
    throw new InvalidSubmission('附件跳转地址不受支持，请重新在 GitHub 上传文件。');
  }
  return url;
}

export function parseAttachment(section) {
  const links = [...section.matchAll(/\[[^\]\r\n]*\]\((https?:\/\/[^\s)]+)\)/g)];
  if (links.length !== 1) throw new InvalidSubmission('请在“文档附件”中上传且仅上传一个 HTML 或 PDF 文件。');
  let url;
  try { url = new URL(links[0][1]); }
  catch { throw new InvalidSubmission('附件网址格式不正确，请重新上传。'); }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash ||
      !/^\/(?:user-attachments\/files|[\w.-]+\/[\w.-]+\/files)\/\d+\/[^/]+$/.test(url.pathname)) {
    throw new InvalidSubmission('仅支持 GitHub Issue 上传生成的公开附件链接。');
  }
  let name;
  try { name = decodeURIComponent(url.pathname.split('/').at(-1)); }
  catch { throw new InvalidSubmission('附件文件名编码不正确。'); }
  const extension = /\.(html?|pdf)$/i.exec(name)?.[1].toLowerCase();
  if (!extension) throw new InvalidSubmission('附件类型必须是 .html、.htm 或 .pdf。');
  return { url: url.href, fileType: extension === 'pdf' ? 'pdf' : 'html' };
}

export function parseSubmission(issue) {
  if (!/^\[分享\]/.test(issue.title || '')) return null;
  if (!Number.isSafeInteger(issue.number) || issue.number < 1) throw new InvalidSubmission('投稿编号不正确。');
  const body = issue.body || '';
  if (body.length > 20000) throw new InvalidSubmission('投稿表单内容过长。');
  const fields = new Map();
  const headings = [...body.matchAll(/^### (.+)\r?$/gm)];
  for (let i = 0; i < headings.length; i++) {
    const label = headings[i][1].trim();
    if (!FIELDS.includes(label)) continue;
    if (fields.has(label)) throw new InvalidSubmission('表单存在重复字段，请使用首页投稿入口重新填写。');
    fields.set(label, body.slice(headings[i].index + headings[i][0].length, headings[i + 1]?.index ?? body.length).trim());
  }
  const title = fields.get('文档标题') || '';
  const description = fields.get('文档简介') || '';
  const category = fields.get('文档分类') || '';
  if (!title || title === '_No response_' || title.length > 120 || /[\r\n]/.test(title)) {
    throw new InvalidSubmission('文档标题须为单行，长度为 1–120 字。');
  }
  if (!description || description === '_No response_' || description.length > 1000) {
    throw new InvalidSubmission('文档简介长度须为 1–1000 字。');
  }
  if (!CATEGORIES.has(category)) throw new InvalidSubmission('文档分类须为调研、实验、工具或其他。');
  const tagText = fields.get('文档标签（可选）') || '';
  const tags = tagText === '_No response_' ? [] : [...new Set(tagText.split(/[,，]/).map(tag => tag.trim()).filter(Boolean))];
  if (tags.length > 8 || tags.some(tag => tag.length > 30 || /[\r\n]/.test(tag))) {
    throw new InvalidSubmission('标签最多 8 个，每个最多 30 字，使用逗号分隔。');
  }
  return {
    id: issue.number, title, description, category, tags,
    author: String(issue.user?.login || 'unknown'),
    createdAt: issue.created_at || null,
    updatedAt: issue.updated_at || null,
    ...parseAttachment(fields.get('文档附件') || ''),
  };
}

export function decodeDocument(bytes, fileType) {
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new InvalidSubmission('文件为空或超过 20 MiB。');
  if (fileType === 'pdf') {
    if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new InvalidSubmission('PDF 文件签名不正确。');
    return bytes;
  }
  let content;
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new InvalidSubmission('HTML 必须使用 UTF-8 编码。'); }
  if (content.includes('\0') || !/<(?:!doctype\s+html|html|head|body|title|h[1-6]|p|div|main|article|script)\b/i.test(content)) {
    throw new InvalidSubmission('附件不是可识别的 HTML 文档。');
  }
  return JSON.stringify({ content });
}

// All attachment redirects are validated before fetching. The GitHub API token
// is used only for api.github.com requests, never for user attachments or CDN URLs.
export async function requestBytes(value, {
  token, api = false, maxBytes = MAX_FILE_BYTES, fetchImpl = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  let url = new URL(value);
  if (api && (url.origin !== 'https://api.github.com' || url.username || url.password)) throw new Error('Invalid API origin.');
  if (!api) validateAttachmentRedirect(url.href);
  for (let redirects = 0; redirects <= 5; redirects++) {
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const headers = { 'User-Agent': 'hybrid-attention-share-publisher' };
        if (api) {
          headers.Accept = 'application/vnd.github+json';
          headers['X-GitHub-Api-Version'] = '2022-11-28';
          if (token) headers.Authorization = `Bearer ${token}`;
        }
        response = await fetchImpl(url.href, { headers, redirect: 'manual', signal: AbortSignal.timeout(45000) });
        if (response.status === 429 || response.status >= 500) {
          await response.body?.cancel();
          response = undefined;
          if (attempt === 2) throw new Error('GitHub temporarily unavailable.');
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        break;
      } catch (error) {
        if (attempt === 2) throw new Error(`Network request failed (${api ? 'GitHub API' : 'attachment'}).`, { cause: error });
        await sleep(1000 * 2 ** attempt);
      }
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (api || !location || redirects === 5) throw new Error('Unsupported GitHub redirect.');
      url = validateAttachmentRedirect(new URL(location, url).href);
      continue;
    }
    if (!api && [404, 410].includes(response.status)) {
      await response.body?.cancel();
      throw new InvalidSubmission('附件不存在或已删除，请重新上传。');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`GitHub ${api ? 'API' : 'attachment'} request failed: HTTP ${response.status}.`);
    }
    const tooLarge = () => api ? new Error('GitHub API response too large.') : new InvalidSubmission('文件超过 20 MiB。');
    if (Number(response.headers.get('content-length')) > maxBytes) {
      await response.body?.cancel();
      throw tooLarge();
    }
    const chunks = [];
    let size = 0;
    if (response.body) {
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > maxBytes) throw tooLarge();
        chunks.push(Buffer.from(chunk));
      }
    }
    return Buffer.concat(chunks);
  }
  throw new Error('Too many attachment redirects.');
}

export async function listOpenIssues(repository, token, request = requestBytes) {
  validateRepository(repository);
  const issues = new Map();
  for (let page = 1; page <= 100; page++) {
    const url = `https://api.github.com/repos/${repository}/issues?state=open&sort=created&direction=asc&per_page=100&page=${page}`;
    const rows = JSON.parse((await request(url, { token, api: true, maxBytes: 16 * 1024 * 1024 })).toString('utf8'));
    if (!Array.isArray(rows)) throw new Error('Invalid issues API response.');
    for (const issue of rows) if (!issue.pull_request && issue.state === 'open') issues.set(issue.number, issue);
    if (rows.length < 100) return [...issues.values()];
  }
  throw new Error('Too many open issues; refusing an incomplete publication.');
}

async function directorySize(directory) {
  const { readdir } = await import('node:fs/promises');
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Site symlinks are not supported.');
    bytes += entry.isDirectory() ? await directorySize(path) : (await stat(path)).size;
  }
  return bytes;
}

export async function buildSite({
  docsDir, outputDir, repository, siteUrl = null, issues,
  download = url => requestBytes(url), now = new Date().toISOString(),
}) {
  validateRepository(repository);
  const source = resolve(docsDir);
  const output = resolve(outputDir);
  if (source === output || source.startsWith(output + sep) || output.startsWith(source + sep)) throw new Error('Source and output must be separate directories.');
  try { await lstat(output); throw new Error('Output already exists; choose a fresh output directory.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  // A failed build never replaces the current site or a previous output.
  const staging = `${output}.staging-${randomUUID()}`;
  const shares = [];
  const rejected = [];
  const seen = new Set();
  let total = 0;
  await mkdir(dirname(staging), { recursive: true });
  await cp(source, staging, {
    recursive: true,
    filter: async path => {
      if (/(?:^|[\\/])(?:\.git|__pycache__|\.DS_Store)(?:[\\/]|$)|\.log$/i.test(relative(source, path))) return false;
      if ((await lstat(path)).isSymbolicLink()) throw new Error('Source docs may not contain symlinks.');
      return true;
    },
  });
  for (const issue of issues) {
    if (issue.pull_request || issue.state !== 'open' || seen.has(issue.number)) continue;
    seen.add(issue.number);
    let item;
    let document;
    try {
      item = parseSubmission(issue);
      if (!item) continue;
      const bytes = await download(item.url);
      document = decodeDocument(bytes, item.fileType);
    } catch (error) {
      if (!(error instanceof InvalidSubmission)) throw error;
      rejected.push({ id: issue.number, reason: error.message });
      continue;
    }
    if (shares.length >= MAX_SHARES) throw new Error('More than 200 shares; increase capacity before publishing.');
    total += Buffer.byteLength(document);
    if (total > MAX_SHARED_BYTES) throw new Error('Shared documents exceed 200 MiB; refusing a partial publication.');
    const directory = join(staging, 'shared', String(item.id));
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, item.fileType === 'html' ? 'document.json' : 'document.pdf'), document);
    const { url, ...record } = item;
    shares.push({ ...record, href: `share.html?id=${item.id}` });
  }
  shares.sort((a, b) => b.id - a.id);
  const manifest = { version: 1, repository, siteUrl, generatedAt: now, shares, rejected };
  await mkdir(join(staging, 'data'), { recursive: true });
  await writeFile(join(staging, 'data', 'shares.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(join(staging, '.nojekyll'), '');
  // Keep the upload link correct when this project is forked or renamed.
  const indexPath = join(staging, 'index.html');
  const index = await readFile(indexPath, 'utf8');
  if (!index.includes('name="share-repository"')) throw new Error('Missing index share integration.');
  await writeFile(indexPath, index.replace(/(<meta name="share-repository" content=")[^"]*(">)/, `$1${repository}$2`));
  if (await directorySize(staging) > MAX_SITE_BYTES) throw new Error('Site exceeds the configured 800 MiB deployment budget.');
  await rename(staging, output);
  return manifest;
}

async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const repository = validateRepository(process.env.GITHUB_REPOSITORY || 'Yank000/hybrid_attention');
  const issues = await listOpenIssues(repository, process.env.GITHUB_TOKEN);
  const manifest = await buildSite({
    docsDir: join(root, 'docs'), outputDir: process.env.SHARE_OUTPUT_DIR || join(root, '_site'),
    repository, siteUrl: process.env.PAGES_BASE_URL || null, issues,
  });
  console.log(`Built ${manifest.shares.length} shares; ${manifest.rejected.length} invalid submissions.`);
  for (const item of manifest.rejected) console.log(`Issue #${item.id}: ${item.reason}`);
  if (process.env.GITHUB_OUTPUT && process.env.GITHUB_EVENT_PATH) {
    const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const id = event.issue?.number;
    const rejected = manifest.rejected.find(item => item.id === id);
    const status = manifest.shares.some(item => item.id === id) ? 'published' : rejected ? 'rejected' : 'removed';
    await appendFile(process.env.GITHUB_OUTPUT,
      `target_status=${status}\ntarget_reason_b64=${Buffer.from(rejected?.reason || '').toString('base64')}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
