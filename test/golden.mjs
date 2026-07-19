#!/usr/bin/env node
// Golden byte-stability harness (standalone script — uses console + exit code, not bun:test).
// Re-measures / re-fixes the reference examples and asserts the output byte-matches the
// checked-in snapshots. Any deterministic drift shows up as a diff — re-run measure/fix
// and commit if the change is intentional. Plus version-sync across package/lockfile/SKILL.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { measureAlt } from '../lib/measure.mjs';
import { fixAlt } from '../lib/fix.mjs';

const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const readText = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));

let failures = 0;
const check = (name, cond, msg) => {
  if (cond) console.log(`ok   ${name}`);
  else { console.error(`FAIL ${name} — ${msg}`); failures++; }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 1. measurement reports are byte-stable
for (const name of ['catalog-good', 'catalog-bad']) {
  const fresh = measureAlt(read(`examples/${name}.layout.json`));
  check(`${name}.report.json stable`, eq(fresh, read(`examples/${name}.report.json`)),
    're-measure differs — if intentional, re-run: node lib/measure.mjs examples/' + name + '.layout.json examples/' + name + '.report.json');
}

// 2. fixer output is byte-stable (fixed ALT + fix-log + report)
{
  const alt = read('examples/catalog-fixable.layout.json');
  const contract = read('examples/catalog.contract.json');
  const result = fixAlt(alt, contract, 6);
  const { fixed, report, ...log } = result;

  const checkedFixed = read('examples/catalog-fixable.layout.fixed.json');
  check('catalog-fixable.layout.fixed.json stable', eq(fixed, checkedFixed),
    'fixed ALT differs — re-run fix and commit');

  const checkedLog = read('examples/catalog-fixable.layout.fix-log.json');
  const { fixed: _f, report: _r, input: _i, contract: _c, output: _o, ...checkedLogBody } = checkedLog;
  check('catalog-fixable.layout.fix-log.json stable', eq(log, checkedLogBody),
    'fix-log differs — re-run fix and commit');

  const checkedReport = read('examples/catalog-fixable.layout.fixed.report.json');
  check('catalog-fixable.layout.fixed.report.json stable', eq(report, checkedReport),
    'fixed report differs — re-run fix and commit');
}

// 3. version sync: package.json ↔ bun.lock (↔ SKILL.md when present)
{
  const pkg = JSON.parse(readText('package.json'));
  if (exists('bun.lock')) {
    // bun.lock allows trailing commas (JSON5-ish) — strip them before JSON.parse
    const lock = JSON.parse(readText('bun.lock').replace(/,(\s*[}\]])/g, '$1'));
    const rootName = lock.workspaces?.['']?.name;
    check('bun.lock present, valid, workspace matches package', rootName === pkg.name, `${rootName} vs ${pkg.name}`);
  } else {
    console.log('skip lockfile check (no bun.lock — run bun install)');
  }
  if (exists('SKILL.md')) {
    const skill = readText('SKILL.md');
    const m = /version:\s*"(\d+\.\d+)"/.exec(skill);
    const prefix = m ? m[1] : null;
    check('SKILL.md metadata.version is a prefix of package.json version',
      !!prefix && pkg.version.startsWith(prefix), `${prefix} vs ${pkg.version}`);
  } else {
    console.log('skip SKILL.md version-sync (not created yet)');
  }
}

if (failures > 0) {
  console.error(`\n${failures} golden check(s) failed.`);
  process.exit(1);
}
console.log('\nall golden checks passed.');
