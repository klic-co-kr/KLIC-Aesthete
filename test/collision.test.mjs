import { test, expect } from 'bun:test';
import collision from '../lib/skills/collision.mjs';

const box = (id, x, y, w, h, filled) => ({ id, kind: 'box', bbox: { x, y, w, h }, style: { opacity: 1, filled } });
const alt = (nodes, canvas = { w: 100, h: 100 }) => ({
  schema_version: 1, diagram_type: 'layout', meta: { title: 't', canvas, source: 'abstract' }, nodes,
});

test('collision: two crossing STROKES (filled:false) → no collision (intentional line-art/icon)', () => {
  // a vertical and a horizontal stroke crossing at center — like asterisk/snowflake
  const r = collision.measure(alt([
    box('v', 50, 0, 0, 100, false),
    box('h', 0, 50, 100, 0, false),
  ]));
  expect(r.metrics.count).toBe(0);
  expect(r.score).toBe(1);
});

test('collision: two overlapping FILLED rects → collision detected (the layout case)', () => {
  const r = collision.measure(alt([
    box('a', 10, 10, 50, 50, true),
    box('b', 30, 30, 50, 50, true),
  ]));
  expect(r.metrics.count).toBe(1);
  expect(r.score).toBe(0);
});

test('collision: `filled` defaults true — pre-existing ALTs without the flag still collide (backward-compat)', () => {
  const r = collision.measure(alt([
    { id: 'a', bbox: { x: 10, y: 10, w: 50, h: 50 }, style: { opacity: 1 } },
    { id: 'b', bbox: { x: 30, y: 30, w: 50, h: 50 }, style: { opacity: 1 } },
  ]));
  expect(r.metrics.count).toBe(1);
});

test('collision: mixed (one filled, one stroke) overlapping → still flagged (only stroke–stroke is skipped)', () => {
  const r = collision.measure(alt([
    box('fill', 10, 10, 50, 50, true),
    box('stroke', 30, 30, 50, 50, false),
  ]));
  expect(r.metrics.count).toBe(1);
});
