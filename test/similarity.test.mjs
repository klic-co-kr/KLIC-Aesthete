import { test, expect } from 'bun:test';
import similarity from '../lib/skills/similarity.mjs';

const alt = (nodes) => ({ meta: { canvas: { w: 100, h: 100 } }, nodes });
const n = (id, category, kind, style) => ({ id, category, kind, bbox: { x: 0, y: 0, w: 10, h: 10 }, style });

test('similarity: single-element groups → nothing to compare, score 1', () => {
  const r = similarity.measure(alt([
    n('a', 'card-1', 'box', { bg: '#F47974' }),
    n('b', 'card-1', 'text', { fontSize: 24, luminance: 0.1 }),
  ]));
  expect(r.score).toBe(1);
  expect(r.metrics.groupsMeasured).toBe(0);
});

test('similarity: same group+kind with uniform size/lightness → high consistency', () => {
  const r = similarity.measure(alt([
    n('a', 'btn', 'text', { fontSize: 16, luminance: 0.1, bg: '#1A73E8' }),
    n('b', 'btn', 'text', { fontSize: 16, luminance: 0.1, bg: '#1A73E8' }),
  ]));
  expect(r.metrics.meanConsistency).toBeGreaterThan(0.9);
  expect(r.metrics.inconsistentGroups).toBe(0);
});

test('similarity: same group+kind with divergent sizes → inconsistency flagged', () => {
  const r = similarity.measure(alt([
    n('a', 'btn', 'text', { fontSize: 14, luminance: 0.1 }),
    n('b', 'btn', 'text', { fontSize: 48, luminance: 0.1 }),
  ]));
  expect(r.metrics.inconsistentGroups).toBeGreaterThanOrEqual(1);
});

test('similarity: different kind (box vs text) in same category is NOT compared', () => {
  // card = box + label; kind differs → no false inconsistency
  const r = similarity.measure(alt([
    n('box', 'card', 'box', { luminance: 0.15 }),
    n('lbl', 'card', 'text', { fontSize: 24, luminance: 0.1 }),
  ]));
  expect(r.score).toBe(1);
  expect(r.violations.length).toBe(0);
});

test('similarity: empty / no-category layouts do not crash', () => {
  expect(similarity.measure(alt([])).score).toBe(1);
  expect(similarity.measure(alt([n('a', '', 'box', {})])).score).toBe(1);
});
