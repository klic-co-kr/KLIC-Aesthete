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

test('collision: class-styled text without an inline fill is not mistaken for line art', () => {
  const a = box('a', 10, 10, 50, 20, false);
  const b = box('b', 20, 15, 50, 20, false);
  a.kind = 'text';
  b.kind = 'text';
  expect(collision.measure(alt([a, b])).violations).toHaveLength(1);
});

test('collision: container may contain content but partially overlapping peer containers still fail', () => {
  const parent = box('panel', 0, 0, 200, 200, true);
  parent.kind = 'container';
  const child = box('label', 20, 20, 60, 20, true);
  child.kind = 'text';
  const peer = box('peer', 180, 20, 100, 100, true);
  peer.kind = 'container';

  expect(collision.measure(alt([parent, child])).violations).toHaveLength(0);
  expect(collision.measure(alt([parent, peer])).violations).toHaveLength(1);
});

test('collision: decorative connector bbox is not treated as a filled layout rectangle', () => {
  const card = box('card', 10, 10, 50, 50, true);
  const edge = box('edge', 30, 30, 50, 50, false);
  edge.kind = 'decor';
  edge.shape = 'path';
  const r = collision.measure(alt([card, edge]));
  expect(r.violations).toHaveLength(0);
  expect(r.score).toBe(1);
});

test('collision: overlapping raster images are flagged (an <image> is never line art)', () => {
  // <image> has no fill attribute, so the adapter records filled=false. Without the image
  // exclusion in the stroke-only check, two stacked photos would be misread as crossing strokes.
  const a = box('imgA', 10, 10, 200, 150, false);
  const b = box('imgB', 20, 20, 200, 150, false);
  a.kind = 'image';
  b.kind = 'image';
  expect(collision.measure(alt([a, b])).violations).toHaveLength(1);
});
