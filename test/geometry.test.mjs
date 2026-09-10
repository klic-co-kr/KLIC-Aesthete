import { test, expect } from 'bun:test';
import {
  rectsOverlap, overlapArea, overlapDepth, overflow, clampToCanvas,
  shapeComplexity, area, center, dist, translate, scaleAround, isFiniteBox, boundaryExit,
} from '../lib/geometry.mjs';

test('rectsOverlap detects overlap and respects gap', () => {
  const a = { x: 0, y: 0, w: 10, h: 10 };
  const b = { x: 8, y: 0, w: 10, h: 10 };
  expect(rectsOverlap(a, b, 0)).toBe(true);
  expect(rectsOverlap(a, b, 5)).toBe(true);   // need 5px gap, overlap 2 → still overlapping
  expect(rectsOverlap(a, b, 3)).toBe(true);    // need 3px → overlap 2 means 1 short → overlap
  const c = { x: 20, y: 0, w: 10, h: 10 };
  expect(rectsOverlap(a, c, 0)).toBe(false);
});

test('overlapArea and depth', () => {
  const a = { x: 0, y: 0, w: 10, h: 10 };
  const b = { x: 8, y: 0, w: 10, h: 10 };
  expect(overlapArea(a, b)).toBe(20);
  const d = overlapDepth(a, b);
  expect(d.x).toBe(2);
  expect(d.y).toBe(10);
});

test('shapeComplexity: square=4, sliver clamped to 8, zero-area=1', () => {
  expect(shapeComplexity({ x: 0, y: 0, w: 10, h: 10 })).toBe(4);
  expect(shapeComplexity({ x: 0, y: 0, w: 0, h: 0 })).toBe(1);
  const sliver = shapeComplexity({ x: 0, y: 0, w: 1, h: 100 });
  expect(sliver <= 8 && sliver > 4).toBeTruthy();
});

test('overflow and clampToCanvas', () => {
  const canvas = { w: 100, h: 100 };
  const b = { x: 90, y: -10, w: 50, h: 50 };
  const ov = overflow(b, canvas);
  expect(ov.right).toBe(40);
  expect(ov.top).toBe(10);
  expect(ov.total > 0).toBeTruthy();
  const clamped = clampToCanvas(b, canvas);
  expect(clamped.x >= 0 && clamped.y >= 0).toBeTruthy();
  expect(clamped.x + clamped.w <= canvas.w + 0.001).toBeTruthy();
});

test('isFiniteBox rejects NaN', () => {
  expect(isFiniteBox({ x: 0, y: 0, w: 1, h: 1 })).toBe(true);
  expect(isFiniteBox({ x: NaN, y: 0, w: 1, h: 1 })).toBe(false);
});

test('translate and scaleAround preserve finiteness', () => {
  const b = { x: 10, y: 10, w: 4, h: 4 };
  const t = translate(b, 5, -2);
  expect(t.x).toBe(15);
  expect(t.y).toBe(8);
  const s = scaleAround(b, 0, 0, 2);
  expect(s.x).toBe(20);
  expect(s.w).toBe(8);
});

// ---- boundaryExit — the boundary-clip primitive for vuln anchor-buried ----

test('boundaryExit: rect slab cut — side, diagonal, and off-centre approaches', () => {
  const b = { x: 0, y: 0, w: 100, h: 100 };
  expect(boundaryExit(b, 'rect', [50, 150])).toEqual([50, 100]);   // bottom edge
  expect(boundaryExit(b, 'rect', [50, -50])).toEqual([50, 0]);     // top edge
  expect(boundaryExit(b, 'rect', [150, 50])).toEqual([100, 50]);   // right edge
  expect(boundaryExit(b, 'rect', [-50, 50])).toEqual([0, 50]);     // left edge
  expect(boundaryExit(b, 'rect', [100, 100])).toEqual([100, 100]); // diagonal → corner
  // both axes offset: the nearer slab (x) wins; the y coordinate keeps the ray slope
  expect(boundaryExit(b, 'rect', [90, 70])).toEqual([100, 75]);
});

test('boundaryExit: rect with a degenerate centre ray falls back to the given direction', () => {
  const b = { x: 0, y: 0, w: 100, h: 100 };
  // inside === centre with no fallback direction → no answer (NaN must never escape)
  expect(boundaryExit(b, 'rect', [50, 50])).toBe(null);
  // a centre-connected stroke arrives along its own axis — that axis decides the crossing
  expect(boundaryExit(b, 'rect', [50, 50], [-1, 0])).toEqual([0, 50]);
  expect(boundaryExit(b, 'rect', [50, 50], [0, 2])).toEqual([50, 100]);
  expect(boundaryExit(b, 'rect', [50, 50], [0, 0])).toBe(null); // zero fallback dir → null
});

test('boundaryExit: ellipse exact solution — axis and diagonal approaches', () => {
  const b = { x: 0, y: 0, w: 100, h: 50 }; // centre (50,25), rx 50, ry 25
  expect(boundaryExit(b, 'ellipse', [150, 25])).toEqual([100, 25]);
  expect(boundaryExit(b, 'ellipse', [50, 125])).toEqual([50, 50]);
  const diag = boundaryExit(b, 'ellipse', [100, 75]);
  expect(diag[0]).toBeCloseTo(72.3607, 3);
  expect(diag[1]).toBeCloseTo(47.3607, 3);
  // circle takes the same path
  expect(boundaryExit({ x: 0, y: 0, w: 100, h: 100 }, 'circle', [125, 50])).toEqual([100, 50]);
  // ellipse + centre ray + approach direction
  expect(boundaryExit(b, 'ellipse', [50, 25], [1, 0])).toEqual([100, 25]);
});

test('boundaryExit: degenerate and non-finite inputs stay null (no NaN escape)', () => {
  expect(boundaryExit({ x: 50, y: 0, w: 0, h: 100 }, 'ellipse', [50, 80])).toBe(null); // rx=0
  expect(boundaryExit({ x: 50, y: 0, w: 0, h: 100 }, 'rect', [50, 80])).toEqual([50, 100]); // zero-width slab: y-axis still answers
  expect(boundaryExit({ x: 50, y: 0, w: 0, h: 100 }, 'rect', [60, 50])).toEqual([50, 50]); // t=0 → centre exit
  expect(boundaryExit({ x: NaN, y: 0, w: 10, h: 10 }, 'rect', [5, 5])).toBe(null);
  expect(boundaryExit({ x: 0, y: 0, w: 10, h: 10 }, 'rect', [Infinity, 5])).toBe(null);
  expect(boundaryExit({ x: 0, y: 0, w: 10, h: 10 }, 'rect', 'nope')).toBe(null);
});
