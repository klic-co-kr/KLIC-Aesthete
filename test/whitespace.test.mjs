import { test, expect } from 'bun:test';
import whitespace from '../lib/skills/whitespace.mjs';
import hierarchy from '../lib/skills/hierarchy.mjs';

function alt(nodes, canvas = { w: 1000, h: 1000 }) {
  return { meta: { title: 't', canvas }, nodes };
}
function box(id, x, y, w, h) {
  return { id, bbox: { x, y, w, h } };
}

test('small content → high freeRatio, score 1', () => {
  const r = whitespace.measure(alt([box('a', 450, 450, 100, 100)]));
  expect(r.metrics.freeRatio > 0.9).toBeTruthy();
  expect(r.score > 0.9).toBeTruthy();
  expect(r.violations.length).toBe(0);
});

test('content filling canvas → freeRatio low, cramped violation', () => {
  const r = whitespace.measure(alt([box('a', 0, 0, 1000, 1000)]));
  expect(r.metrics.freeRatio < 0.25).toBeTruthy();
  expect(r.violations.some((v) => v.metric === 'freeRatio')).toBeTruthy();
});

test('whitespace never emits NaN', () => {
  const r = whitespace.measure(alt([box('a', 0, 0, 0, 0)]));
  expect(JSON.stringify(r).includes('NaN')).toBe(false);
});

test('hierarchy: clear geometric scale + good contrast → clarity high', () => {
  const r = hierarchy.measure(alt([
    { id: 'h', bbox: { x: 0, y: 0, w: 100, h: 40 }, style: { role: 'heading', fontSize: 32, color: '#111111', bg: '#ffffff' } },
    { id: 'b', bbox: { x: 0, y: 50, w: 100, h: 20 }, style: { role: 'body', fontSize: 16, color: '#111111', bg: '#ffffff' } },
  ]));
  expect(r.metrics.clarity >= 0.7).toBeTruthy();
});

test('hierarchy: single uniform size → stepReg 1 (no division error)', () => {
  const r = hierarchy.measure(alt([
    { id: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 }, style: { role: 'body', fontSize: 16, color: '#111', bg: '#fff' } },
  ]));
  expect(r.metrics.stepRegularity).toBe(1);
  expect(JSON.stringify(r).includes('NaN')).toBe(false);
});
