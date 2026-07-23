import { test, expect } from 'bun:test';
import { getRules } from '../lib/slop-rules.mjs';

test('slop-rules: html rules include universal + html-specific bullets', () => {
  const r = getRules('html');
  expect(r.bullets.length).toBeGreaterThanOrEqual(4);
  expect(r.bullets.some((b) => /gradient/i.test(b))).toBe(true);
  expect(r.bullets.some((b) => /emoji/i.test(b) && /heading/i.test(b))).toBe(true);
  expect(r.negation.palette).toBeInstanceOf(Array);
  expect(r.negation.palette.some((n) => /gradient/i.test(n))).toBe(true);
});

test('slop-rules: svg medium returns universal only (no html-only extras)', () => {
  const html = getRules('html');
  const svg = getRules('svg');
  // universal bullets present, html-only extras absent
  expect(svg.bullets.some((b) => /icon/i.test(b))).toBe(false);
  expect(svg.bullets.length).toBeLessThan(html.bullets.length);
  expect(svg.bullets.length).toBeGreaterThan(0);
});

test('slop-rules: unknown medium falls back to universal (deterministic)', () => {
  const a = getRules('???');
  const b = getRules('???');
  expect(a).toEqual(b);
  expect(a.bullets.length).toBeGreaterThan(0);
});

test('slop-rules: every bullet and negation is a non-empty string (no placeholders)', () => {
  const r = getRules('html');
  for (const b of r.bullets) expect(typeof b === 'string' && b.length > 0).toBe(true);
  for (const items of Object.values(r.negation)) {
    for (const n of items) expect(typeof n === 'string' && n.length > 0).toBe(true);
  }
});
