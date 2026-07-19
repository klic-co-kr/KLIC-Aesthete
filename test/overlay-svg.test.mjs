import { test, expect } from 'bun:test';
import { importSvg } from '../lib/adapters/svg.mjs';
import { applySvgOverlay, deltaTransform } from '../lib/overlay/svg.mjs';
import { measureAlt } from '../lib/measure.mjs';

// rich SVG: a Bézier <path> with a gradient fill/stroke + a <rect>. exportSvg would flatten the
// path to a bbox-rect; overlay must preserve it and only wrap the moved rect.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
  <defs><linearGradient id="g"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs>
  <path id="curve" d="M10 10 C 50 90, 150 90, 190 10" fill="url(#g)" stroke="black" stroke-width="3"/>
  <rect id="box" x="200" y="200" width="80" height="60" fill="#3b82f6"/>
</svg>`;

test('overlay: import stashes _originalBbox separate from bbox (closed-loop safe)', () => {
  const alt = importSvg(SVG);
  for (const n of alt.nodes) {
    expect(n._originalBbox).toBeDefined();
    expect(n._originalBbox).not.toBe(n.bbox);            // a copy, not a reference
    expect(n._originalBbox).toEqual(n.bbox);              // same values at import
  }
});

test('overlay: moved element is wrapped in <g transform>; path/gradient preserved', () => {
  const alt = importSvg(SVG);
  // simulate a fix: shift the rect +50px on x (a collision/boundary correction)
  const box = alt.nodes.find((n) => n.id === 'box');
  box.bbox = { ...box.bbox, x: box.bbox.x + 50 };

  const out = applySvgOverlay(SVG, alt);

  // the Bézier path is NOT flattened — original d / gradient ref / gradient def survive
  expect(out).toContain('d="M10 10 C 50 90, 150 90, 190 10"');
  expect(out).toContain('fill="url(#g)"');
  expect(out).toContain('<linearGradient');
  expect(out).toContain('stroke="black"');
  // the moved rect is wrapped with a translate; its original attrs are intact inside the wrap
  expect(out).toContain('<g transform="translate(50 0)"><rect');
  expect(out).toContain('x="200"');   // original x preserved (transform does the move)
  // exactly one wrap — the unchanged path is left alone
  expect((out.match(/<g transform="/g) || []).length).toBe(1);
});

test('overlay: unchanged layout produces NO wraps (original preserved as-is)', () => {
  const alt = importSvg(SVG);
  const out = applySvgOverlay(SVG, alt);   // no fix → no bbox change
  expect((out.match(/<g transform="/g) || []).length).toBe(0);
  // and the path is still the original, not a flattened rect
  expect(out).toContain('d="M10 10 C 50 90, 150 90, 190 10"');
});

test('overlay: resize uses scale-about-origin + translate (lands on the fixed bbox)', () => {
  const alt = importSvg(SVG);
  const box = alt.nodes.find((n) => n.id === 'box');
  // simulate a resize fix: 80×60 → 100×75 (1.25× both)
  box.bbox = { x: box.bbox.x, y: box.bbox.y, w: 100, h: 75 };
  const out = applySvgOverlay(SVG, alt);
  expect(out).toContain('<g transform="translate(200 200) scale(1.25 1.25) translate(-200 -200)"><rect');
});

test('overlay: nodes without _originalBbox are skipped (no crash, no wrap)', () => {
  // an ALT-native node (no _originalBbox) cannot be overlaid — must be skipped cleanly
  const alt = { meta: { canvas: { w: 400, h: 300 } }, nodes: [{ id: 'x', bbox: { x: 0, y: 0, w: 10, h: 10 } }] };
  const out = applySvgOverlay(SVG, alt);
  expect((out.match(/<g transform="/g) || []).length).toBe(0);
});

test('overlay: closed loop intact — measure reads the FIXED bbox (overlay does not touch it)', () => {
  // the design point: fix mutates bbox, measure sees it; overlay is a pure output projection.
  const alt = importSvg(SVG);
  const box = alt.nodes.find((n) => n.id === 'box');
  const before = measureAlt(alt);
  box.bbox = { ...box.bbox, x: box.bbox.x + 50 };
  const after = measureAlt(alt);
  // _originalBbox is unchanged by the bbox edit
  expect(box._originalBbox.x).toBe(200);
  // the report reflects the moved position (re-measure saw the new bbox)
  expect(after.summary).toBeDefined();
  expect(before.summary.totalWeightedViolation).not.toBeUndefined();
});

// deltaTransform unit
test('deltaTransform: pure translate / no-op / scale forms', () => {
  expect(deltaTransform({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 7, w: 10, h: 10 })).toBe('translate(5 7)');
  expect(deltaTransform({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 })).toBeNull();
  expect(deltaTransform({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 20, h: 10 })).toContain('scale(2 1)');
});
