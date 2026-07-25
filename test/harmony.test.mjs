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

// Chromatic vs NEUTRAL. Once text nodes contribute their glyph color to the palette (ownColor),
// ordinary near-black body copy like #111827 clears the 0.08 saturation floor and would register
// as a faint blue hue — inflating distinctHues and skewing the hue moment on layouts that are
// visually achromatic. vuln's ai-cliche-palette already excludes near-black/near-white neutrals
// via lMin/lMax for the same reason; harmony now applies the same lightness window.
// Empirical: without this, the ground-truth corpus correlation fell from ρ 0.327 to 0.307.

const textNode = (id, color) => ({
  id, kind: 'text', label: id, bbox: { x: 0, y: 0, w: 100, h: 20 },
  style: { fontSize: 16, color, bg: '#ffffff', opacity: 1, role: 'body' },
});
const altOf = (nodes) => ({
  schema_version: 1, diagram_type: 'layout',
  meta: { title: 't', canvas: { w: 500, h: 500 }, source: 'abstract' }, nodes,
});

test('harmony: near-black body copy is a NEUTRAL, not a chromatic hue', () => {
  const r = harmony.measure(altOf([textNode('a', '#111827'), textNode('b', '#0f172a')]));
  expect(r.metrics.distinctHues).toBe(0);
  expect(r.score).toBe(1);
});

test('harmony: near-white text on a dark field is also a neutral', () => {
  const r = harmony.measure(altOf([textNode('a', '#f8fafc')]));
  expect(r.metrics.distinctHues).toBe(0);
});

test('harmony: a genuinely saturated mid-lightness text color DOES count', () => {
  const r = harmony.measure(altOf([textNode('a', '#dc2626'), textNode('b', '#1d4ed8')]));
  expect(r.metrics.distinctHues).toBeGreaterThan(0);
});
