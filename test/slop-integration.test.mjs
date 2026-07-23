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
