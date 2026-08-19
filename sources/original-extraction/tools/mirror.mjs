import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const TARGET = new URL('https://davidwhyte.com/experience/');
const DOCUMENT_BASE = new URL('/', TARGET);
const ROOT = path.resolve(import.meta.dirname, '..');
const RAW_ROOT = path.join(ROOT, 'raw');
const MAX_CONCURRENCY = 8;

const queued = new Set();
const queue = [];
const records = [];

function safeSegment(value) {
  return decodeURIComponent(value).replace(/[<>:"\\|?*\x00-\x1F]/g, '_');
}

function localPath(url, contentType = '') {
  let pathname = url.pathname;
  if (pathname.endsWith('/')) pathname += 'index.html';
  if (!path.posix.extname(pathname)) {
    if (contentType.includes('text/html')) pathname += '/index.html';
    else pathname += '.bin';
  }
  const segments = pathname.split('/').filter(Boolean).map(safeSegment);
  let filePath = path.join(RAW_ROOT, url.hostname, ...segments);
  if (url.search) {
    const ext = path.extname(filePath);
    const stem = ext ? filePath.slice(0, -ext.length) : filePath;
    const digest = crypto.createHash('sha1').update(url.search).digest('hex').slice(0, 10);
    filePath = `${stem}__q-${digest}${ext}`;
  }
  return filePath;
}

function normalize(candidate, base) {
  try {
    const url = new URL(candidate.replace(/&amp;/g, '&'), base);
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function shouldDownload(url) {
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  return url.hostname === TARGET.hostname;
}

function enqueue(candidate, base, reason) {
  const url = normalize(candidate, base);
  if (!url || !shouldDownload(url) || queued.has(url.href)) return;
  queued.add(url.href);
  queue.push({ url, reason });
}

function discoverHtml(text, base) {
  const declaredBase = text.match(/<base\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
  const resolutionBase = declaredBase ? normalize(declaredBase, base) || base : base;
  const attrPattern = /\b(?:src|href|poster|data-src|data-bg|data-background(?:-image)?|data-video)\s*=\s*["']([^"']+)["']/gi;
  for (const match of text.matchAll(attrPattern)) enqueue(match[1], resolutionBase, 'html-attribute');

  const srcsetPattern = /\b(?:srcset|data-srcset)\s*=\s*["']([^"']+)["']/gi;
  for (const match of text.matchAll(srcsetPattern)) {
    for (const part of match[1].split(',')) enqueue(part.trim().split(/\s+/)[0], resolutionBase, 'html-srcset');
  }

  discoverCss(text, resolutionBase, 'html-inline-css');
}

function discoverCss(text, base, reason = 'css-url') {
  const urlPattern = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  for (const match of text.matchAll(urlPattern)) {
    if (!match[1].startsWith('data:')) enqueue(match[1], base, reason);
  }
  const importPattern = /@import\s+(?:url\()?\s*["']([^"']+)["']/gi;
  for (const match of text.matchAll(importPattern)) enqueue(match[1], base, 'css-import');
}

function discoverJs(text, base) {
  const sourceMapPattern = /\/\/[#@]\s*sourceMappingURL=([^\s]+)/g;
  for (const match of text.matchAll(sourceMapPattern)) enqueue(match[1], base, 'js-source-map');

  const assetPattern = /["'`]((?:https?:\/\/|\.?\/|wp-content\/)[^"'`\s]+?\.(?:js|css|json|wasm|woff2?|ttf|otf|png|jpe?g|webp|avif|svg|gif|mp4|webm|mp3|wav|m4a|glb|3dl|ktx2)(?:\?[^"'`\s]*)?)["'`]/gi;
  for (const match of text.matchAll(assetPattern)) {
    enqueue(match[1], base, 'js-asset-string');
    // app.js is loaded as a classic script; runtime fetches resolve path strings
    // against the document's <base>, not against the JavaScript file itself.
    enqueue(match[1], DOCUMENT_BASE, 'js-runtime-asset-string');
    if (match[1].startsWith('/xp/')) {
      enqueue(`wp-content/themes/davidwhyte/resources/assets${match[1]}`, DOCUMENT_BASE, 'js-resource-loader-asset');
    }
  }
}

async function fetchOne(item) {
  const startedAt = Date.now();
  try {
    const response = await fetch(item.url, {
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; educational-source-study/1.0)',
        accept: '*/*',
      },
    });
    const contentType = response.headers.get('content-type') || '';
    const body = Buffer.from(await response.arrayBuffer());
    const finalUrl = new URL(response.url);
    const destination = localPath(item.url, contentType);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, body);

    const textLike = /(?:text\/|javascript|json|xml|svg)/i.test(contentType) || /\.(?:html?|css|js|mjs|json|xml|svg)$/i.test(item.url.pathname);
    if (response.ok && textLike) {
      const text = body.toString('utf8');
      if (/html/i.test(contentType) && item.url.href === TARGET.href) discoverHtml(text, finalUrl);
      if (/css/i.test(contentType) || /\.css$/i.test(item.url.pathname)) discoverCss(text, finalUrl);
      if (/javascript/i.test(contentType) || /\.(?:m?js)$/i.test(item.url.pathname)) discoverJs(text, finalUrl);
    }

    records.push({
      url: item.url.href,
      finalUrl: response.url,
      status: response.status,
      contentType,
      bytes: body.byteLength,
      reason: item.reason,
      localPath: path.relative(ROOT, destination).replaceAll('\\', '/'),
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    records.push({
      url: item.url.href,
      status: 0,
      reason: item.reason,
      error: String(error),
      durationMs: Date.now() - startedAt,
    });
  }
}

enqueue(TARGET.href, TARGET, 'entry-document');
enqueue('wp-content/themes/davidwhyte/app/427.js', DOCUMENT_BASE, 'webpack-dynamic-chunk');
enqueue('wp-content/themes/davidwhyte/resources/assets/xp/libs/basis/basis_transcoder.js', DOCUMENT_BASE, 'known-ktx2-runtime');
enqueue('wp-content/themes/davidwhyte/resources/assets/xp/libs/basis/basis_transcoder.wasm', DOCUMENT_BASE, 'known-ktx2-runtime');
for (const device of ['desktop', 'mobile']) {
  for (const layer of ['base', 'over']) {
    for (let index = 1; index <= 6; index += 1) {
      enqueue(`wp-content/themes/davidwhyte/resources/assets/xp/videos/${device}/${layer}/${index}.mp4`, DOCUMENT_BASE, 'generated-video-url');
    }
  }
}

while (queue.length) {
  const batch = queue.splice(0, MAX_CONCURRENCY);
  await Promise.all(batch.map(fetchOne));
}

records.sort((a, b) => a.url.localeCompare(b.url));
await writeFile(path.join(ROOT, 'manifest.json'), JSON.stringify({ target: TARGET.href, fetchedAt: new Date().toISOString(), records }, null, 2));

const ok = records.filter((record) => record.status >= 200 && record.status < 400);
const failed = records.filter((record) => record.status < 200 || record.status >= 400);
console.log(`Downloaded ${ok.length} resources (${ok.reduce((sum, item) => sum + (item.bytes || 0), 0)} bytes).`);
console.log(`Failed/skipped responses: ${failed.length}.`);
for (const item of failed) console.log(`${item.status} ${item.url} ${item.error || ''}`);
