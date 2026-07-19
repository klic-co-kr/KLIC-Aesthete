import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fixAlt } from '../lib/fix.mjs';
import { defaultContract } from '../lib/contract.mjs';

const contract = JSON.parse(readFileSync(new URL('../examples/catalog.contract.json', import.meta.url), 'utf8'));

function loadExample(name) {
  return JSON.parse(readFileSync(new URL(`../examples/${name}`, import.meta.url), 'utf8'));
}

test('fixer resolves P0 (collision + boundary) on a fixable layout', () => {
  const alt = loadExample('catalog-fixable.layout.json');
  const result = fixAlt(alt, contract, 6);
  const r = result.report;
  expect(r.skills.collision.metrics.count).toBe(0);
  expect(r.skills.boundary.metrics.overflowCount).toBe(0);
});

test('fixer strictly reduces total weighted violation', () => {
  const alt = loadExample('catalog-bad.layout.json');
  const result = fixAlt(alt, contract, 6);
  expect(result.totalWeightedViolation.best < result.totalWeightedViolation.start).toBeTruthy();
});

test('fixer is deterministic — same input → byte-identical fixed ALT', () => {
  const alt = loadExample('catalog-bad.layout.json');
  const a = fixAlt(alt, contract, 6);
  const b = fixAlt(alt, contract, 6);
  expect(JSON.stringify(a.fixed)).toBe(JSON.stringify(b.fixed));
  expect(JSON.stringify(a.report)).toBe(JSON.stringify(b.report));
});

test('fix-geometry profile: suggestionOnly fixes are refused + recorded (governance enforced)', () => {
  // hierarchy with IRREGULAR font steps → stepReg<0.7 → clarity<0.7 → 'differentiate-scale'
  // violation, whose fix is suggestionOnly (font semantics — the geometry fixer cannot apply it).
  const alt = {
    schema_version: 1, diagram_type: 'layout',
    meta: { title: 't', canvas: { w: 800, h: 600 }, source: 'abstract' },
    nodes: [
      { id: 'n1', category: 'x', kind: 'box', bbox: { x: 40, y: 40, w: 200, h: 60 }, style: { role: 'heading', fontSize: 12, luminance: 0.1, opacity: 1, bg: '#ffffff', color: '#111827' } },
      { id: 'n2', category: 'x', kind: 'box', bbox: { x: 40, y: 120, w: 200, h: 60 }, style: { role: 'body', fontSize: 13, luminance: 0.1, opacity: 1, bg: '#ffffff', color: '#111827' } },
      { id: 'n3', category: 'x', kind: 'box', bbox: { x: 40, y: 200, w: 200, h: 60 }, style: { role: 'body', fontSize: 64, luminance: 0.1, opacity: 1, bg: '#ffffff', color: '#111827' } },
      { id: 'n4', category: 'x', kind: 'box', bbox: { x: 40, y: 280, w: 200, h: 60 }, style: { role: 'body', fontSize: 80, luminance: 0.1, opacity: 1, bg: '#ffffff', color: '#111827' } },
    ],
  };
  const c = { schema_version: 1, brief: '', criteria: [
    { skill: 'hierarchy', metric: 'clarity', op: '>=', threshold: 0.7, weight: 1.5 },
  ] };
  const result = fixAlt(alt, c, 3, { aesthetic: true }); // suggestionOnly gating lives in the (opt-in) aesthetic loop
  // the fixer declares its profile and refuses the suggestionOnly fix instead of applying it
  expect(result.profile).toBe('fix-geometry');
  const skipped = result.skippedFixes.find((s) => s.kind === 'differentiate-scale');
  expect(skipped).toBeTruthy();
  expect(skipped.mode).toBe('suggestionOnly');
  expect(skipped.reason).toContain('fix-geometry');
});

test('fixer outcome is a valid enum and never NaN', () => {
  for (const name of ['catalog-fixable.layout.json', 'catalog-bad.layout.json']) {
    const result = fixAlt(loadExample(name), contract, 6);
    expect(['pass', 'best-effort', 'no-improvement', 'budget-exhausted'].includes(result.outcome)).toBeTruthy();
    const blob = JSON.stringify(result);
    expect(!/NaN|undefined/.test(blob)).toBeTruthy();
  }
});

test('fixer never mutates the input ALT (returns a cloned fixed copy)', () => {
  const alt = loadExample('catalog-fixable.layout.json');
  const before = JSON.stringify(alt);
  fixAlt(alt, contract, 4);
  expect(JSON.stringify(alt)).toBe(before);
});

test('fixer with a default contract runs without throwing', () => {
  const alt = loadExample('catalog-fixable.layout.json');
  const result = fixAlt(alt, defaultContract('test'), 4);
  expect(['pass', 'best-effort', 'no-improvement', 'budget-exhausted'].includes(result.outcome)).toBeTruthy();
});
