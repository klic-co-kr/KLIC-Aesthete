import { test, expect } from 'bun:test';
import harmony from '../lib/skills/harmony.mjs';

const alt = (nodes) => ({ meta: { canvas: { w: 100, h: 100 } }, nodes });
const c = (id, bg) => ({ id, category: id, bbox: { x: 0, y: 0, w: 40, h: 40 }, style: { bg, opacity: 1 } });

test('harmony: monochrome → score 1, distinct 1', () => {
  const r = harmony.measure(alt([c('a', '#1A73E8'), c('b', '#4A9BEF')]));
  expect(r.metrics.distinctHues).toBe(1);
  expect(r.score >= 0.95).toBeTruthy();
  expect(r.violations.length).toBe(0);
});

test('harmony: complementary pair → high momentBalance', () => {
  // ~blue (214°) + ~orange (30°) — near-complementary
  const r = harmony.measure(alt([c('a', '#1A73E8'), c('b', '#FFCE5C')]));
  expect(r.metrics.momentBalance > 0.4).toBeTruthy();
});

test('harmony: no colored fills → neutral, score 1, no throw', () => {
  const r = harmony.measure(alt([{ id: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 }, style: { bg: '#ffffff' } }]));
  expect(r.score).toBe(1);
  expect(JSON.stringify(r).includes('NaN')).toBe(false);
});

test('harmony: empty layout does not crash', () => {
  const r = harmony.measure(alt([]));
  expect(r.score).toBe(1);
});
