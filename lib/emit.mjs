#!/usr/bin/env node
// ALT → 도메인 export (독립 CLI). fix.mjs --emit 없이 ALT만 내보낼 때.
// usage: bun lib/emit.mjs <alt.json> [--to svg|html|pptx|alt] [output.ext]
import fs from 'node:fs';
import { exportAlt } from './adapters/index.mjs';
import { readJson, parseArgs, isMain } from './shared/cli.mjs';

function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const inputPath = positional[0];
  if (!inputPath) { console.error('usage: bun lib/emit.mjs <alt.json> [--to svg|html|pptx|alt] [output]'); process.exit(2); }
  const alt = readJson(inputPath);
  const to = flags.to || 'svg';
  const exported = exportAlt(alt, to);
  const outPath = positional[1] || inputPath.replace(/\.[^.]+$/, '') + '.' + exported.ext;
  if (exported.text != null) fs.writeFileSync(outPath, exported.text, 'utf8');
  else fs.writeFileSync(outPath, exported.buffer);
  console.log(outPath);
}

if (isMain(import.meta.url)) main();
