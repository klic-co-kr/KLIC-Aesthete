#!/usr/bin/env node
// Token-sandbox CI gate. exit 0 = clean, exit 1 = escape-hatch violations (CI rejects).
// usage: node lib/lint.mjs <layout-or-domain.json> [--tokens tokens.json]

import { readJson, parseArgs, isMain } from './shared/cli.mjs';
import { importPath, detectDomain } from './adapters/index.mjs';
import { lint } from './tokens.mjs';

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const inputPath = positional[0];
  if (!inputPath) {
    console.error('usage: node lib/lint.mjs <layout-or-domain.json>');
    process.exit(2);
  }
  const domain = detectDomain(inputPath, flags.domain);
  const alt = domain === 'alt' ? readJson(inputPath) : importPath(inputPath, { domain });
  const result = lint(alt);

  if (result.passed) {
    console.log(`tokens: PASS — ${alt.nodes.length} nodes, 모두 승인된 토큰 사용`);
    process.exit(0);
  }
  console.error(`tokens: REJECT — ${result.violations.length} escape-hatch 위반 (color ${result.counts.color}, fontSize ${result.counts.fontSize})`);
  for (const v of result.violations) console.error('  - ' + v.message);
  process.exit(1);
}

if (isMain(import.meta.url)) {
  main();
}
