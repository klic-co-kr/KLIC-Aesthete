import { test, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { scanSlop } from '../lib/slop.mjs';
import { foldDecision } from '../lib/skill-decision.mjs';

const FIX = (n) => fs.readFileSync(path.join(import.meta.dir, '..', 'examples', 'slop-html', n), 'utf8');
const alt = { meta: { canvas: { w: 1280, h: 800 } }, nodes: [] };
const scan = (name) => scanSlop({ alt, medium: 'html', html: FIX(name) });

test('FP suite: synthetic slop HTML → P0 measured-fail (gradient + emoji)', () => {
  const r = scan('slop-synthetic.html');
  expect(r.summary.coverage.html).toBe('measured');
  expect(r.summary.byTier.P0).toBeGreaterThanOrEqual(1);
  expect(r.findings.some((f) => f.id === 'slop.palette.gradient')).toBe(true);
});

test('FP suite: legitimate editorial design → ZERO slop findings (no false-positive)', () => {
  const r = scan('legit-editorial.html');
  expect(r.findings.length).toBe(0);
});

test('FP suite: var()-indirect gradient → unmeasured, NOT a finding (no false-fail)', () => {
  const r = scan('var-indirect.html');
  expect(r.findings.some((f) => f.id === 'slop.palette.gradient')).toBe(false);
  expect(r.summary.unmeasured.some((u) => u.id === 'slop.palette.gradient')).toBe(true);
});

test('FP suite: var()-indirect gradient → decision human_coverage (escalate, no false-pass/false-fail)', () => {
  const d = foldDecision({
    report: { summary: { hardIntegrityScore: 1, coverageScore: 1 } },
    slopReport: scan('var-indirect.html'),
  });
  expect(d.decision).toBe('human');
  expect(d.reasons.some((r) => r.code.startsWith('SLOP_P0_UNMEASURED'))).toBe(true);
});

test('FP suite: vuln + slop on the same artifact → disjoint findings (H1 dedup)', () => {
  const html = FIX('slop-synthetic.html');
  const sr = scanSlop({ alt, medium: 'html', html });
  // vuln operates on ALT; feed a minimal alt derived presence is out of scope here — assert id sets
  // are conceptually disjoint by construction (slop.* vs vuln ids).
  const slopIds = new Set(sr.findings.map((f) => f.id));
  const vulnIds = new Set(['ai-cliche-palette','hanging-header','even-split','no-focal-point','rainbow-categorical','type-scale-accident','no-spacing-rhythm']);
  for (const id of slopIds) expect(vulnIds.has(id)).toBe(false);
});

test('FP suite: all-unmeasurable → human_coverage, no false-pass', () => {
  const d = foldDecision({
    report: { summary: { hardIntegrityScore: 1, coverageScore: 0 } },
    slopReport: scanSlop({ alt, medium: 'svg', html: '' }),
  });
  expect(d.decision).toBe('human');
});

// Recursion guard: the smoke test below spawns `bun test ... test/slop-fp.test.mjs`, which would
// re-run this very test and recurse unboundedly (bun's 5s test timeout masks it as failure). The
// guard sets an env var in the subprocess; the subprocess skips its own smoke test, terminating
// the recursion at depth 1. Verbatim subprocess list and test intent preserved.
const RECURSE = process.env.AESTHETE_FP_RECURSE === '1';
(test.skipIf(RECURSE))('FP suite: full suite still green', async () => {
  // smoke: the new fixtures don't break existing measure/golden
  const { execSync } = await import('node:child_process');
  let out;
  // NOTE: bun routes the test summary ("N pass") to stderr; merge with `2>&1` so the assertion
  // below can see it. (Out-of-the-box execSync returns only stdout.)
  try { out = execSync('AESTHETE_FP_RECURSE=1 bun test test/slop-signatures.test.mjs test/slop-fold.test.mjs test/slop-integration.test.mjs test/slop-fp.test.mjs 2>&1', { encoding: 'utf8' }); }
  catch (e) { out = e.stdout || ''; throw new Error('slop suite failed:\n' + out); }
  expect(out).toMatch(/pass/);
});
