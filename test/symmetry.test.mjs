import { test, expect } from 'bun:test';
import symmetry from '../lib/skills/symmetry.mjs';

const alt = (nodes, canvas = { w: 240, h: 240 }) => ({
  schema_version: 1, diagram_type: 'layout',
  meta: { title: 't', canvas, source: 'abstract' }, nodes,
});
const box = (id, x, y, w, h, bg) => ({ id, kind: 'box', bbox: { x, y, w, h }, style: { bg, opacity: 1 } });

test('symmetry: mirrored pair across vertical axis → score 1, no violation', () => {
  const r = symmetry.measure(alt([
    box('a', 40, 100, 40, 40, '#2563eb'),
    box('b', 160, 100, 40, 40, '#2563eb'), // mirror of a across x=120
  ]));
  expect(r.metrics.symmetryScore).toBe(1);
  expect(r.violations.length).toBe(0);
});

test('symmetry: corner-clustered (asymmetric) → score 0, ASYMMETRIC violation', () => {
  const r = symmetry.measure(alt([
    box('a', 20, 20, 50, 50, '#1d4ed8'),
    box('b', 80, 20, 50, 50, '#1d4ed8'),
    box('c', 20, 80, 50, 50, '#1d4ed8'),
    box('d', 80, 80, 50, 50, '#1d4ed8'),
  ]));
  expect(r.metrics.symmetryScore).toBe(0);
  expect(r.violations.length).toBeGreaterThan(0);
  expect(r.metrics.reflectiveV).toBe(0);
});

test('symmetry: positions mirror but COLORS differ → not a true mirror (color-aware)', () => {
  // 4 corners: positions are 180°-symmetric, but colors clash → no true mirror partner
  const r = symmetry.measure(alt([
    box('a', 40, 40, 40, 40, '#ef4444'),
    box('b', 160, 40, 40, 40, '#06b6d4'),
    box('c', 40, 160, 40, 40, '#eab308'),
    box('d', 160, 160, 40, 40, '#a855f7'),
  ]));
  expect(r.metrics.symmetryScore).toBeLessThan(0.5);
});

test('symmetry: a node on the center axis self-mirrors (counts as symmetric)', () => {
  const r = symmetry.measure(alt([
    box('c', 100, 100, 40, 40, '#000'), // center node at (120,120) → on both axes + rotation center
  ]));
  // single node → unmeasurable (n<2), but a centered node among others self-mirrors:
  const r2 = symmetry.measure(alt([
    box('c', 100, 100, 40, 40, '#000'),
    box('a', 40, 100, 40, 40, '#2563eb'),
    box('b', 160, 100, 40, 40, '#2563eb'),
  ]));
  expect(r.coverage).toBe('unmeasurable');
  expect(r2.metrics.symmetryScore).toBe(1);
});

test('symmetry: rotational 180° (not reflective) still scores high', () => {
  // two nodes that are 180° partners but NOT axis-mirrored
  const r = symmetry.measure(alt([
    box('a', 40, 40, 40, 40, '#2563eb'),
    box('b', 160, 160, 40, 40, '#2563eb'), // 180° of a about (120,120)
  ]));
  expect(r.metrics.rotational).toBe(1);
  expect(r.metrics.symmetryScore).toBe(1);
});

test('symmetry: <2 nodes → unmeasurable', () => {
  const r = symmetry.measure(alt([box('a', 0, 0, 40, 40, '#000')]));
  expect(r.coverage).toBe('unmeasurable');
});
