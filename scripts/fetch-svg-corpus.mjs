#!/usr/bin/env node
// Download N random free SVG images from Wikimedia Commons (various free licenses; PD/CC/...).
// Records a _manifest.json with source + license per file. Polite: batches + small delays + UA.
//
//   node scripts/fetch-svg-corpus.mjs [outDir=examples/validation-svg/corpus] [N=100]
import fs from 'node:fs';
import path from 'node:path';

const UA = 'aesthete-validation-corpus/1.0 (educational layout-aesthetics test; local script)';
const OUT = process.argv[2] || 'examples/validation-svg/corpus';
const N = Number(process.argv[3]) || 100;
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(params) {
  const url = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({ format: 'json', ...params });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (r.ok) return r.json();
    } catch {}
    await sleep(800);
  }
  return {};
}

// 1) collect N random SVG File: titles
const titles = new Set();
let guard = 0;
while (titles.size < N && guard++ < 60) {
  const j = await api({ action: 'query', list: 'random', rnnamespace: 6, rnlimit: 500 });
  for (const it of (j.query?.random || [])) {
    if (/\.svg$/i.test(it.title)) titles.add(it.title);
    if (titles.size >= N) break;
  }
  await sleep(300);
}
console.log(`collected ${titles.size} SVG titles`);

// 2) imageinfo (url + license) in batches of 25 (titles pipe-separated)
const arr = [...titles].slice(0, N);
const info = [];
for (let i = 0; i < arr.length; i += 25) {
  const j = await api({
    action: 'query', titles: arr.slice(i, i + 25).join('|'),
    prop: 'imageinfo', iiprop: 'url|mime|extmetadata',
  });
  for (const p of Object.values(j.query?.pages || {})) {
    const ii = p.imageinfo?.[0];
    if (ii?.url && /svg/i.test(ii.mime || '')) {
      info.push({
        title: p.title,
        url: ii.url,
        license: (ii.extmetadata?.LicenseShortName?.value || '').replace(/<[^>]+>/g, '') || 'unknown',
      });
    }
  }
  await sleep(300);
}
console.log(`resolved ${info.length} SVG urls`);

// 3) download (skip >500KB; sanitize filename) — Wikimedia upload throttles hard (429),
// so go SLOW: 2.5s between files, exponential backoff on 429/503. Let any active throttle clear.
let ok = 0; const manifest = [];
await sleep(15000);
for (let idx = 0; idx < info.length; idx++) {
  const f = info[idx];
  const file = f.title.replace(/^File:/, '').replace(/[/\\]/g, '_');
  let done = false;
  for (let attempt = 0; attempt < 4 && !done; attempt++) {
    try {
      const r = await fetch(f.url, { headers: { 'User-Agent': UA } });
      if (r.status === 429 || r.status === 503) { console.log(`  429 ${file} — backoff ${15 * (attempt + 1)}s`); await sleep(15000 * (attempt + 1)); continue; }
      if (!r.ok) { console.log(`  ${file} http ${r.status}`); break; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 500_000) { console.log(`  skip large ${file} ${(buf.length / 1024).toFixed(0)}KB`); break; }
      fs.writeFileSync(path.join(OUT, file), buf);
      manifest.push({ file, source: 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(f.title), license: f.license, bytes: buf.length });
      ok++; done = true;
    } catch (e) { console.log(`  fail ${file}: ${e.message}`); break; }
  }
  process.stdout.write(`[${ok}/${info.length}] ${done ? '✓' : '·'} ${file}\n`);
  await sleep(2500);
}
fs.writeFileSync(path.join(OUT, '_manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const licenses = {};
for (const m of manifest) licenses[m.license] = (licenses[m.license] || 0) + 1;
console.log(`\ndownloaded ${ok} SVGs → ${OUT}`);
console.log('licenses:', JSON.stringify(licenses));
