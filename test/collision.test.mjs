import { test, expect } from 'bun:test';
import collision, { isThinConnector, strokeBand } from '../lib/skills/collision.mjs';
import { importSvg } from '../lib/adapters/svg.mjs';

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

// ---------------------------------------------------------------------------
// Gap B — thin stroke-only connector × text band check.
// A fill="none" <path>/<line> whose bbox IS the stroke line used to vanish into
// the blanket decor skip while its stroke painted straight through glyph ink.
// The band check fires only for (thin connector × opaque text) pairs; every
// other decor pairing keeps its old exemption.
// ---------------------------------------------------------------------------

// A thin stroke-only connector as the svg adapter emits it: kind=decor, shape
// path/line, unfilled, bbox a sliver along the stroke. strokeWidth defaults to 1.
const connector = (id, x, y, w, h, opts = {}) => ({
  id,
  kind: 'decor',
  shape: opts.shape || 'path',
  bbox: { x, y, w, h },
  style: { opacity: opts.opacity ?? 1, filled: false, ...(opts.strokeWidth !== undefined ? { strokeWidth: opts.strokeWidth } : {}) },
});

// A text label with the adapter's conservative ink bbox (y = baseline − 0.8em, h = fs).
const label = (id, x, y, w, h, fs, opts = {}) => ({
  id,
  kind: 'text',
  bbox: { x, y, w, h },
  style: { opacity: opts.opacity ?? 1, fontSize: fs, color: '#111827', bg: '#ffffff', role: 'body' },
});

test('collision: thin connector stroke band crossing text → collision (Gap B)', () => {
  // svg-lint fixture text-over-line.svg geometry: connector y=32, strokeWidth 1.5 → ink band
  // [31.25, 32.75]. Label ink estimate [24, 34] (baseline 32, fs 10), shrunk vertically by
  // TANGENCY_EPS = max(1, 0.15 × 10) = 1.5 → [25.5, 32.5] — still inside the band → fires.
  const r = collision.measure(alt([
    connector('edge', 22, 32, 228, 0, { strokeWidth: 1.5 }),
    label('t', 75.5, 24, 121, 10, 10),
  ]));
  expect(r.violations).toHaveLength(1);
  const v = r.violations[0];
  expect(v.severity).toBe('high');
  expect(v.metric).toBe('count');
  expect(v.fix.kind).toBe('separate-overlap');
  expect(v.fix.axis).toBe('Y');
  expect(v.nodes).toEqual(['edge', 't']);
  expect(r.score).toBe(0);
});

test('collision: label 6px above a thin connector → exempt (band miss)', () => {
  // strokeWidth defaults to 1 → band [99.5, 100.5]; label baseline 94 → ink [86, 96] →
  // shrunk [87, 95] — clear of the band.
  const r = collision.measure(alt([
    connector('edge', 20, 100, 160, 0),
    label('t', 60, 86, 80, 10, 10),
  ]));
  expect(r.metrics.count).toBe(0);
  expect(r.score).toBe(1);
});

test('collision: D3-style axis label 0.75em below the line → exempt (TANGENCY_EPS shrink)', () => {
  // fs=12, sw=1.5 → band bottom = axis + 0.75. Baseline at axis + 9 (the D3 0.75em offset):
  // ink top = 209 − 0.8 × 12 = 199.4; eps = max(1, 1.8) = 1.8 → shrunk top 201.2 > 200.75.
  const r = collision.measure(alt([
    connector('axis', 0, 200, 200, 0, { strokeWidth: 1.5 }),
    label('tick', 60, 199.4, 60, 12, 12),
  ]));
  expect(r.metrics.count).toBe(0);
});

test('collision: axis label at the exact 0.70em boundary → exempt; one tick closer → fires', () => {
  // fs=10, sw=1: fires iff baseline−line < 0.8em − eps(1.5) − sw/2(0.5) = 7px = 0.70em.
  // At exactly 0.70em the shrunk ink top (50.5) merely touches the band bottom (50.5) and
  // rectsOverlap is strict → exempt. 0.69em → the band meets glyph ink → real violation.
  const at = (delta) => collision.measure(alt([
    connector('axis', 0, 50, 160, 0),
    label('tick', 40, 50 + delta - 8, 80, 10, 10),
  ]));
  expect(at(7).violations).toHaveLength(0);
  expect(at(6.9).violations).toHaveLength(1);
});

test('collision: thin connector crossing a box stays exempt (band check is text-only)', () => {
  // Connectors legitimately cross boxes and icons in diagrams — only the text pairing is
  // band-checked. Existing 64-row exemption behavior mirrored for a THIN connector.
  const r = collision.measure(alt([
    connector('edge', 50, 0, 2, 100),
    box('b', 30, 30, 40, 40, true),
  ]));
  expect(r.metrics.count).toBe(0);
});

test('collision: stroke-only rect border around its label stays exempt (shape guard)', () => {
  // As imported, an unfilled shell rect is reclassified to a container (svg adapter semantics)
  // so the border↔label pair resolves through the container containment exemption. The band
  // check must never add a violation for rect-shaped strokes — isThinConnector demands
  // shape path/line — pinned here on a synthetic thin rect-shaped decor node.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120">
    <rect x="10" y="10" width="100" height="60" fill="none" stroke="#111"/>
    <text x="30" y="45" font-size="12">label</text>
  </svg>`;
  const imported = importSvg(svg);
  expect(imported.nodes.find((n) => n.id === 'rect-0')?.kind).toBe('container');
  expect(collision.measure(imported).violations).toHaveLength(0);
  expect(collision.measure(alt([
    connector('r', 30, 30, 40, 20, { shape: 'rect' }),
    label('t', 34, 32, 32, 12, 12),
  ])).violations).toHaveLength(0);
});

test('collision: translucent thin guideline × text stays exempt (opacity guard in band branch)', () => {
  // Same geometry as the Gap B firing case; only opacity (<0.5) differs → exempt on either
  // side, same rule as the generic opacity exemption. Mutating ONLY the opacity away from the
  // firing case makes this pair guard-verified: remove the in-branch opacity guard and it fires.
  const pair = (tOp, cOp) => [
    connector('guide', 22, 32, 228, 0, { strokeWidth: 1.5, opacity: cOp }),
    label('t', 75.5, 24, 121, 10, 10, { opacity: tOp }),
  ];
  expect(collision.measure(alt(pair(1, 0.3))).violations).toHaveLength(0);
  expect(collision.measure(alt(pair(0.3, 1))).violations).toHaveLength(0);
});

test('collision: isThinConnector / strokeBand are the named reuse surface (Phase 1b import contract)', () => {
  const n = { kind: 'decor', shape: 'path', bbox: { x: 22, y: 32, w: 228, h: 0 }, style: { filled: false, strokeWidth: 1.5 } };
  expect(isThinConnector(n)).toBe(true);
  expect(strokeBand(n)).toEqual({ x: 21.25, y: 31.25, w: 229.5, h: 1.5 });
  // rect-shaped strokes are never connectors (stroke-only box outlines are intentional)
  expect(isThinConnector({ kind: 'decor', shape: 'rect', bbox: { x: 0, y: 0, w: 2, h: 2 }, style: { filled: false } })).toBe(false);
  // thick paths (icon outlines) stay exempt — bbox is not a sliver
  expect(isThinConnector({ kind: 'decor', shape: 'path', bbox: { x: 0, y: 0, w: 50, h: 50 }, style: { filled: false } })).toBe(false);
  // filled shapes, non-decor kinds and missing bboxes are not thin connectors
  expect(isThinConnector({ kind: 'decor', shape: 'path', bbox: { x: 0, y: 0, w: 2, h: 2 }, style: { filled: true } })).toBe(false);
  expect(isThinConnector({ kind: 'box', shape: 'path', bbox: { x: 0, y: 0, w: 2, h: 2 }, style: { filled: false } })).toBe(false);
  expect(isThinConnector({ kind: 'decor', shape: 'path', style: { filled: false } })).toBe(false);
  // strokeWidth absent → fallback 1 → half-width 0.5 inflate on every side
  expect(strokeBand({ kind: 'decor', shape: 'path', bbox: { x: 10, y: 20, w: 30, h: 0 }, style: {} })).toEqual({ x: 9.5, y: 19.5, w: 31, h: 1 });
});
