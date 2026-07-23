import { test, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { foldDecision, stableDecision, decisionExitCode, isPhysicallyInfeasible, p0Fixable } from '../lib/skill-decision.mjs';
import { buildPreBundle, renderPromptBullets, runPre, resolveOutDir, negationBundle } from '../lib/skill-pre.mjs';
import { runPost } from '../lib/skill-post.mjs';
import { measureAlt } from '../lib/measure.mjs';
import { readJson } from '../lib/shared/cli.mjs';
import { skillRoot } from '../lib/shared/cli.mjs';

const root = skillRoot();
const badPath = path.join(root, 'examples', 'catalog-bad.layout.json');
const goodPath = path.join(root, 'examples', 'catalog-good.layout.json');
const dashBriefPath = path.join(root, 'examples', 'dashboard-brief.json');

test('resolveOutDir: relative jail + absolute opt-in', () => {
  expect(() => resolveOutDir('../escape-aesthete', root)).toThrow(/escapes cwd/);
  const ok = resolveOutDir('tmp-out', root);
  expect(ok.startsWith(path.resolve(root))).toBe(true);
  const abs = resolveOutDir('/tmp/ae-allowed', root);
  expect(abs).toBe(path.resolve('/tmp/ae-allowed'));
});

test('pre: dashboard brief → prompt_bullets ≥ 3 + contract', () => {
  const brief = readJson(dashBriefPath);
  const { bundle } = runPre(brief, { outDir: path.join(root, '.aesthete-skill-test-pre') });
  expect(bundle.schema).toBe('aesthete.pre/v1');
  expect(bundle.recognized).toBe(true);
  expect(bundle.structure.id).toBeTruthy();
  expect(bundle.prompt_bullets.length).toBeGreaterThanOrEqual(3);
  expect(bundle.contract?.criteria?.length).toBeGreaterThan(0);
  expect(bundle.optional?.keyhole?.max_visible_chunks).toBe(4);
});

test('pre: deterministic without diversify', () => {
  const brief = readJson(dashBriefPath);
  const a = buildPreBundle(runPre(brief).spec);
  const b = buildPreBundle(runPre(brief).spec);
  // strip nothing — full bundle should match (no paths)
  expect(JSON.stringify(a.prompt_bullets)).toBe(JSON.stringify(b.prompt_bullets));
  expect(a.structure.id).toBe(b.structure.id);
  expect(JSON.stringify(a.contract)).toBe(JSON.stringify(b.contract));
});

test('post: catalog-bad → fix_geometry (P0)', async () => {
  const altBytesBefore = fs.readFileSync(badPath);
  const { decision } = await runPost(badPath, { flags: {}, outDir: undefined });
  expect(decision.decision).toBe('fix_geometry');
  expect(decision.reasons.some((r) => r.code === 'P0_COLLISION' || r.code === 'P0_BOUNDARY')).toBe(true);
  expect(decision.next.action).toBe('run_fix_p0');
  const altBytesAfter = fs.readFileSync(badPath);
  expect(Buffer.compare(altBytesBefore, altBytesAfter)).toBe(0);
});

test('post: catalog-good → pass', async () => {
  const { decision } = await runPost(goodPath, { flags: {} });
  expect(decision.decision).toBe('pass');
  expect(decision.next.action).toBe('stop');
  expect(decision.scores.hardIntegrityScore).toBe(1);
});

test('post: decision deterministic (stable strip)', async () => {
  const a = stableDecision((await runPost(badPath, { flags: {} })).decision);
  const b = stableDecision((await runPost(badPath, { flags: {} })).decision);
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});

test('gate exit codes', () => {
  expect(decisionExitCode('pass')).toBe(0);
  expect(decisionExitCode('fix_geometry')).toBe(1);
  expect(decisionExitCode('regenerate')).toBe(1);
  expect(decisionExitCode('human')).toBe(2);
  expect(decisionExitCode('pass', true)).toBe(2);
});

test('fold: structure fail → regenerate beats pass', () => {
  const good = measureAlt(readJson(goodPath));
  const d = foldDecision({
    report: good,
    alt: readJson(goodPath),
    structureRequested: true,
    structureResult: { verdict: 'fail', expected: 'evidence-grid' },
  });
  expect(d.decision).toBe('regenerate');
  expect(d.reasons.some((r) => r.code === 'STRUCTURE_FAIL')).toBe(true);
});

test('fold: vuln advisory does not force regenerate without --vuln-gate', () => {
  const good = measureAlt(readJson(goodPath));
  const d = foldDecision({
    report: good,
    alt: readJson(goodPath),
    vulnGate: false,
    vulnReport: {
      vulnerabilities: [{ id: 'no-focal', title: 'x', severity: 'high' }],
    },
  });
  expect(d.decision).toBe('pass');
  expect(d.reasons.some((r) => String(r.code).startsWith('VULN_ADVISORY_'))).toBe(true);
});

test('fold: vuln-gate high → regenerate', () => {
  const good = measureAlt(readJson(goodPath));
  const d = foldDecision({
    report: good,
    alt: readJson(goodPath),
    vulnGate: true,
    vulnReport: {
      vulnerabilities: [{ id: 'no-focal', title: 'x', severity: 'high' }],
    },
  });
  expect(d.decision).toBe('regenerate');
});

test('physically infeasible area sum', () => {
  const alt = {
    meta: { canvas: { w: 100, h: 100 } },
    nodes: [
      { id: 'a', bbox: { x: 0, y: 0, w: 80, h: 80 } },
      { id: 'b', bbox: { x: 0, y: 0, w: 80, h: 80 } },
    ],
  };
  expect(isPhysicallyInfeasible(alt)).toBe(true);
  expect(isPhysicallyInfeasible({ meta: { canvas: { w: 1000, h: 1000 } }, nodes: alt.nodes })).toBe(false);
});

test('negationBundle + renderPromptBullets non-empty', () => {
  const bullets = renderPromptBullets({
    directive: 'test directive',
    structure: { id: 'hero-led', shape: 'one hero' },
    budget: { freeRatio: { min: 0.3, target: 0.4 }, focal: 1 },
    negation: { color: ['rainbow palette'] },
  });
  expect(bullets[0]).toBe('test directive');
  expect(bullets.some((b) => b.includes('Structure:'))).toBe(true);
  expect(bullets.some((b) => b.includes('freeRatio'))).toBe(true);
  expect(negationBundle({ color: ['rainbow'] }).bullets.length).toBe(1);
});

// ---- slop-pre (Task 11) ----
const slopTmpDir = () => { const d = path.join(import.meta.dir, '.tmp-slop-pre'); fs.mkdirSync(d, { recursive: true }); return d; };

test('skill-pre: html brief → prompt_bullets include slop constraints + slop-test.md emitted', () => {
  const outDir = path.join(slopTmpDir(), 'out');
  const brief = { artifact_type: 'marketing', format: 'html', brief: 'hero landing' };
  const { bundle } = runPre(brief, { outDir });
  expect(bundle.prompt_bullets.some((b) => /gradient|emoji|glass/i.test(b))).toBe(true);
  expect(fs.existsSync(path.join(outDir, 'slop-test.md'))).toBe(true);
});

test('skill-pre: same brief twice (no diversify) → byte-identical slop bullets (deterministic)', () => {
  const a = runPre({ artifact_type: 'report', format: 'html' }, {}).bundle.prompt_bullets;
  const b = runPre({ artifact_type: 'report', format: 'html' }, {}).bundle.prompt_bullets;
  expect(a).toEqual(b);
});

test('skill-pre: non-html brief → slop universal bullets only (no html-only extras)', () => {
  const { bundle } = runPre({ artifact_type: 'report', format: 'svg' }, {});
  expect(bundle.prompt_bullets.some((b) => /icon/i.test(b))).toBe(false);
  expect(bundle.prompt_bullets.some((b) => /gradient|emoji/i.test(b))).toBe(true); // universal present
});
