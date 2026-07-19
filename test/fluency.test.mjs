import { test, expect } from 'bun:test';
import fluency from '../lib/skills/fluency.mjs';

const alt = (nodes) => ({ meta: { canvas: { w: 100, h: 100 } }, nodes });
const t = (id, role, fontSize, x, y) => ({
  id, bbox: { x, y, w: 50, h: 20 }, style: { role, fontSize },
});

test('fluency: single role + uniform size → fluency 1, no violations', () => {
  const r = fluency.measure(alt([t('a', 'heading', 24, 10, 10), t('b', 'heading', 24, 10, 50)]));
  expect(r.score).toBe(1);
  expect(r.metrics.flowInversions).toBe(0);
  expect(r.violations.length).toBe(0);
});

test('fluency: heading above body (top-down) → flow clean, gradient strong', () => {
  const r = fluency.measure(alt([t('h', 'heading', 32, 10, 5), t('b', 'body', 16, 10, 50)]));
  expect(r.metrics.flowInversions).toBe(0);
  expect(r.metrics.gradientScore).toBeGreaterThan(0.9);
  expect(r.score).toBeGreaterThan(0.9);
});

test('fluency: body ABOVE heading → reading-flow inversion flagged', () => {
  const r = fluency.measure(alt([t('b', 'body', 16, 10, 5), t('h', 'heading', 32, 10, 50)]));
  expect(r.metrics.flowInversions).toBeGreaterThanOrEqual(1);
  expect(r.violations.some((v) => v.metric === 'flowInversions')).toBe(true);
});

test('fluency: inverted size gradient (small heading, big body) → weak gradient', () => {
  const r = fluency.measure(alt([t('h', 'heading', 12, 10, 5), t('b', 'body', 40, 10, 50)]));
  // heading on top (flow ok), but smaller font on heading → gradient inverted
  expect(r.metrics.gradientScore).toBeLessThan(0.2);
  expect(r.violations.some((v) => v.metric === 'gradientScore')).toBe(true);
});

test('fluency: no roles / empty → score 1, no crash', () => {
  expect(fluency.measure(alt([])).score).toBe(1);
  expect(fluency.measure(alt([{ id: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 } }])).score).toBe(1);
});
