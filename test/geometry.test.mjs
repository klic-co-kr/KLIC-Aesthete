import { test, expect } from 'bun:test';
import {
  rectsOverlap, overlapArea, overlapDepth, overflow, clampToCanvas,
  shapeComplexity, area, center, dist, translate, scaleAround, isFiniteBox,
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
