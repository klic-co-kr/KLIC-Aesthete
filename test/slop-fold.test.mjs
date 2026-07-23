import { test, expect } from 'bun:test';
import { scanSlop, DEFAULT_THRESHOLDS } from '../lib/slop.mjs';
import { scanAlt } from '../lib/vuln.mjs';

const alt = { meta: { canvas: { w: 1000, h: 600 } }, nodes: [] };

test('fold: synthetic slop HTML → P0 finding + coverage measured', () => {
  const html = `<style>.h{background:linear-gradient(135deg,#6366f1,#ec4899)}</style><h1>Launch 🚀</h1>`;
  const r = scanSlop({ alt, medium: 'html', html });
  expect(r.summary.coverage.html).toBe('measured');
  expect(r.summary.byTier.P0).toBeGreaterThanOrEqual(1);
  expect(r.findings.some((f) => f.id === 'slop.palette.gradient')).toBe(true);
  expect(r.summary.advisory).toBe(true);
  expect(r.summary.uncalibrated).toBe(true);
});

test('fold: var()-only gradient → unmeasured entry, NOT a finding (no false-fail)', () => {
  const html = `<style>.h{background:linear-gradient(var(--a),var(--b))}</style>`;
  const r = scanSlop({ alt, medium: 'html', html });
  expect(r.findings.some((f) => f.id === 'slop.palette.gradient')).toBe(false);
  expect(r.summary.unmeasured.some((u) => u.id === 'slop.palette.gradient')).toBe(true);
});

test('fold: empty html (svg/pptx in v1) → coverage unmeasurable, no findings', () => {
  const r = scanSlop({ alt, medium: 'svg', html: '' });
  expect(r.summary.coverage.html).toBe('unmeasurable');
  expect(r.findings).toEqual([]);
});

test('fold: threshold override is deep-merged (partial override keeps siblings)', () => {
  const html = `<style>.h{background:linear-gradient(90deg,#6366f1,#8b5cf6,#ec4899)}</style>`;
  const base = scanSlop({ alt, medium: 'html', html });
  expect(base.summary.byTier.P0).toBeGreaterThanOrEqual(1);
  // override minClichéStops so high it no longer fires; hueLo/hueHi stay defaulted
  const raised = scanSlop({ alt, medium: 'html', html, opts: { thresholds: { 'slop.palette.gradient': { minClichéStops: 99 } } } });
  expect(raised.findings.some((f) => f.id === 'slop.palette.gradient')).toBe(false);
});

test('fold: every finding is suggestionOnly + has remediation', () => {
  const html = `<style>.h{background:linear-gradient(135deg,#6366f1,#ec4899)}.g{backdrop-filter:blur(8px)}</style><h1>🚀</h1>`;
  const r = scanSlop({ alt, medium: 'html', html });
  expect(r.findings.length).toBeGreaterThan(0);
  for (const f of r.findings) {
    expect(f.mode).toBe('suggestionOnly');
    expect(typeof f.remediation).toBe('string');
  }
});

test('dedup: slop signature ids are DISJOINT from vuln ids (H1)', () => {
  const vulnIds = new Set(['no-focal-point','no-spacing-rhythm','type-scale-accident','rainbow-categorical','even-split','ai-cliche-palette','hanging-header']);
  const slopIds = new Set(Object.keys(DEFAULT_THRESHOLDS));
  for (const id of slopIds) expect(vulnIds.has(id)).toBe(false);
});
