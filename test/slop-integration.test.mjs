import { test, expect } from 'bun:test';
import { foldDecision } from '../lib/skill-decision.mjs';

const slopP0 = { summary: { coverage: { html: 'measured' } }, findings: [
  { id: 'slop.palette.gradient', tier: 'P0', severity: 'high', title: 'cliché gradient', signal: 2, threshold: 2 },
] };
const slopP1 = { summary: { coverage: { html: 'measured' } }, findings: [
  { id: 'slop.palette.glass', tier: 'P1', severity: 'medium', title: 'glass', signal: 1, threshold: 1 },
] };
const base = (extra = {}) => foldDecision({ report: { summary: { hardIntegrityScore: 1, coverageScore: 1 } }, ...extra });

test('decision: P0 slop measured-fail → regenerate (priority 60, unconditional)', () => {
  const d = base({ slopReport: slopP0 });
  expect(d.decision).toBe('regenerate');
  expect(d.reasons.some((r) => r.code.startsWith('SLOP_P0'))).toBe(true);
});

test('decision: P1 slop → regenerate only under --slop-gate', () => {
  expect(base({ slopReport: slopP1 }).decision).toBe('pass');          // advisory by default
  expect(base({ slopReport: slopP1, slopGate: true }).decision).toBe('regenerate');
});

test('decision: P0 slop unmeasured (var()-gradient) → human_coverage, NOT pass/regenerate (spec §4 C1)', () => {
  const slopVar = { summary: { coverage: { html: 'measured' }, unmeasured: [{ id: 'slop.palette.gradient', tier: 'P0', reason: 'var() indirect' }] }, findings: [] };
  const d = base({ slopReport: slopVar });
  expect(d.decision).toBe('human');
  expect(d.reasons.some((r) => r.code.startsWith('SLOP_P0_UNMEASURED'))).toBe(true);
});

test('decision: non-P0 slop unmeasured → NOT human (advisory only, no escalation)', () => {
  const slopGlassVar = { summary: { coverage: { html: 'measured' }, unmeasured: [{ id: 'slop.palette.glass', tier: 'P1', reason: 'var() indirect' }] }, findings: [] };
  const d = base({ slopReport: slopGlassVar });
  expect(d.decision).toBe('pass');
});

test('decision: slop priority 60 ties stably with vuln (config order, not random)', () => {
  const vuln = { vulnerabilities: [{ id: 'ai-cliche-palette', severity: 'high', title: 'ai palette' }] };
  const a = foldDecision({ report: { summary: { hardIntegrityScore: 1, coverageScore: 1 } }, vulnReport: vuln, vulnGate: true, slopReport: slopP0 });
  const b = foldDecision({ report: { summary: { hardIntegrityScore: 1, coverageScore: 1 } }, vulnReport: vuln, vulnGate: true, slopReport: slopP0 });
  expect(a.decision).toBe('regenerate');
  expect(a.decision).toBe(b.decision); // byte-stable
  expect(a.reasons).toEqual(b.reasons);
});

import { runPost } from '../lib/skill-post.mjs';
import fs from 'node:fs';
import path from 'node:path';

const tmp = (name) => {
  const d = path.join(import.meta.dir, '.tmp-slop-it');
  fs.mkdirSync(d, { recursive: true });
  return path.join(d, name);
};

test('skill-post: html slop → slop.json written + decision=regenerate', async () => {
  const htmlPath = tmp('bad.html');
  fs.writeFileSync(htmlPath, `<style>.h{background:linear-gradient(135deg,#6366f1,#ec4899)}</style><h1>🚀</h1>`);
  const outDir = tmp('out-bad');
  const r = await runPost(htmlPath, { flags: { 'slop-gate': true }, outDir });
  expect(r.slopReport.findings.some((f) => f.id === 'slop.palette.gradient')).toBe(true);
  expect(r.decision.decision).toBe('regenerate');
  expect(fs.existsSync(path.join(outDir, 'slop.json'))).toBe(true);
});

test('skill-post: non-destructive — input bytes unchanged', async () => {
  const htmlPath = tmp('nd.html');
  const before = `<style>.g{backdrop-filter:blur(8px)}</style><p>ok</p>`;
  fs.writeFileSync(htmlPath, before);
  await runPost(htmlPath, { flags: { slop: true }, outDir: tmp('out-nd') });
  expect(fs.readFileSync(htmlPath, 'utf8')).toBe(before);
});

test('skill-post: alt-only input (svg/pptx v1) → slop unmeasurable, no crash', async () => {
  const altPath = tmp('clean.alt.json');
  fs.writeFileSync(altPath, JSON.stringify({ schema_version: 1, meta: { canvas: { w: 1000, h: 600 }, source: 'abstract' }, nodes: [] }));
  const r = await runPost(altPath, { flags: { slop: true }, outDir: tmp('out-alt') });
  expect(r.slopReport.summary.coverage.html).toBe('unmeasurable');
});
