#!/usr/bin/env node
// Download N random free SVG images from a jsDelivr-CDN npm package (no rate limit, unlike
// Wikimedia upload). Default: OpenMoji (CC BY-SA 4.0) — thousands of diverse emoji SVGs.
//
//   node scripts/fetch-svg-corpus-jsdelivr.mjs [outDir] [N] [pkg=openmoji@15.1.50] [subdir=color/svg]
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || 'examples/validation-svg/corpus';
const N = Number(process.argv[3]) || 100;
const PKG = process.argv[4] || 'openmoji@15.1.50';
const SUB = process.argv[5] || 'color/svg';
fs.mkdirSync(OUT, { recursive: true });

const listing = await (await fetch(`https://data.jsdelivr.com/v1/packages/npm/${PKG}?structure=flat`)).json();
const svgs = (listing.files || [])
  .filter((f) => f.name.startsWith('/' + SUB + '/') && f.name.endsWith('.svg'))
  .map((f) => f.name.replace('/' + SUB + '/', ''));
console.log(`${PKG}/${SUB}: ${svgs.length} SVGs available`);

if (svgs.length === 0) { console.error('no SVGs found — check pkg/subdir'); process.exit(1); }

for (let i = svgs.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [svgs[i], svgs[j]] = [svgs[j], svgs[i]];
}
const pick = svgs.slice(0, Math.min(N, svgs.length));

let ok = 0;
const manifest = [];
for (const name of pick) {
  try {
    const r = await fetch(`https://cdn.jsdelivr.net/npm/${PKG}/${SUB}/${name}`);
    if (!r.ok) { console.log(`  ${name} http ${r.status}`); continue; }
    const text = await r.text();
    fs.writeFileSync(path.join(OUT, name), text);
    manifest.push({ file: name, source: `https://www.npmjs.com/package/${PKG.split('@')[0]}`, license: 'CC BY-SA 4.0 (OpenMoji)', bytes: text.length });
    ok++;
  } catch (e) { console.log(`  fail ${name}: ${e.message}`); }
}
fs.writeFileSync(path.join(OUT, '_manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`downloaded ${ok}/${pick.length} SVGs → ${OUT}`);
