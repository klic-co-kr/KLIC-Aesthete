import { test, expect } from 'bun:test';
import balance from '../lib/skills/balance.mjs';

function alt(nodes, canvas = { w: 1000, h: 1000 }) {
  return { meta: { title: 't', canvas }, nodes };
}
function node(id, x, y, w, h, luminance) {
  return { id, bbox: { x, y, w, h }, style: { luminance } };
}

test('symmetric layout → BM near 1.0', () => {
  const a = alt([
    node('a', 100, 100, 200, 200, 0.1),
    node('b', 700, 700, 200, 200, 0.1),
  ]);
  const r = balance.measure(a);
  expect(r.metrics.BM > 0.95).toBeTruthy();
  expect(r.violations.length).toBe(0);
});

test('lopsided single heavy node → BM < 1', () => {
  const a = alt([node('a', 850, 850, 100, 100, 1.0)]); // bottom-right corner
  const r = balance.measure(a);
  expect(r.metrics.BM < 0.95).toBeTruthy();
});

test('luminance asymmetry: dark-left + light-right (same area/distance) → imbalanced', () => {
  // BM is a per-side ratio, so it only moves when relative weights differ across the axis.
  // dark (≈1.0) on the left vs light (≈0.36) on the right must read as imbalanced.
  const r = balance.measure(alt([
    node('dark', 100, 450, 100, 100, 1.0),
    node('light', 800, 450, 100, 100, 0.0),
  ]));
  expect(r.metrics.BM < 0.99).toBeTruthy();
});

test('empty canvas → BM=1, no NaN', () => {
  const r = balance.measure(alt([]));
  expect(r.metrics.BM).toBe(1);
  expect(JSON.stringify(r).includes('NaN')).toBe(false);
});
