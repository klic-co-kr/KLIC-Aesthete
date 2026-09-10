import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fixAlt } from '../lib/fix.mjs';
import { defaultContract } from '../lib/contract.mjs';
import { importSvg } from '../lib/adapters/svg.mjs';
import collision, { isThinConnector } from '../lib/skills/collision.mjs';

const contract = JSON.parse(readFileSync(new URL('../examples/catalog.contract.json', import.meta.url), 'utf8'));

function loadExample(name) {
  return JSON.parse(readFileSync(new URL(`../examples/${name}`, import.meta.url), 'utf8'));
}

test('fixer resolves P0 (collision + boundary) on a fixable layout', () => {
  const alt = loadExample('catalog-fixable.layout.json');
  const result = fixAlt(alt, contract, 6);
  const r = result.report;
  expect(r.skills.collision.metrics.count).toBe(0);
  expect(r.skills.boundary.metrics.overflowCount).toBe(0);
});

test('fixer strictly reduces total weighted violation', () => {
  const alt = loadExample('catalog-bad.layout.json');
  const result = fixAlt(alt, contract, 6);
  expect(result.totalWeightedViolation.best < result.totalWeightedViolation.start).toBeTruthy();
});

test('fixer is deterministic — same input → byte-identical fixed ALT', () => {
  const alt = loadExample('catalog-bad.layout.json');
  const a = fixAlt(alt, contract, 6);
  const b = fixAlt(alt, contract, 6);
  expect(JSON.stringify(a.fixed)).toBe(JSON.stringify(b.fixed));
  expect(JSON.stringify(a.report)).toBe(JSON.stringify(b.report));
});

test('fix-geometry profile: suggestionOnly fixes are refused + recorded (governance enforced)', () => {
  // hierarchy with IRREGULAR font steps → stepReg<0.7 → clarity<0.7 → 'differentiate-scale'
  // violation, whose fix is suggestionOnly (font semantics — the geometry fixer cannot apply it).
  const alt = {
    schema_version: 1, diagram_type: 'layout',
    meta: { title: 't', canvas: { w: 800, h: 600 }, source: 'abstract' },
    nodes: [
      { id: 'n1', category: 'x', kind: 'box', bbox: { x: 40, y: 40, w: 200, h: 60 }, style: { role: 'heading', fontSize: 12, luminance: 0.1, opacity: 1, bg: '#ffffff', color: '#111827' } },
      { id: 'n2', category: 'x', kind: 'box', bbox: { x: 40, y: 120, w: 200, h: 60 }, style: { role: 'body', fontSize: 13, luminance: 0.1, opacity: 1, bg: '#ffffff', color: '#111827' } },
      { id: 'n3', category: 'x', kind: 'box', bbox: { x: 40, y: 200, w: 200, h: 60 }, style: { role: 'body', fontSize: 64, luminance: 0.1, opacity: 1, bg: '#ffffff', color: '#111827' } },
      { id: 'n4', category: 'x', kind: 'box', bbox: { x: 40, y: 280, w: 200, h: 60 }, style: { role: 'body', fontSize: 80, luminance: 0.1, opacity: 1, bg: '#ffffff', color: '#111827' } },
    ],
  };
  const c = { schema_version: 1, brief: '', criteria: [
    { skill: 'hierarchy', metric: 'clarity', op: '>=', threshold: 0.7, weight: 1.5 },
  ] };
  const result = fixAlt(alt, c, 3, { aesthetic: true }); // suggestionOnly gating lives in the (opt-in) aesthetic loop
  // the fixer declares its profile and refuses the suggestionOnly fix instead of applying it
  expect(result.profile).toBe('fix-geometry');
  const skipped = result.skippedFixes.find((s) => s.kind === 'differentiate-scale');
  expect(skipped).toBeTruthy();
  expect(skipped.mode).toBe('suggestionOnly');
  expect(skipped.reason).toContain('fix-geometry');
});

test('fixer outcome is a valid enum and never NaN', () => {
  for (const name of ['catalog-fixable.layout.json', 'catalog-bad.layout.json']) {
    const result = fixAlt(loadExample(name), contract, 6);
    expect(['pass', 'best-effort', 'no-improvement', 'budget-exhausted'].includes(result.outcome)).toBeTruthy();
    const blob = JSON.stringify(result);
    expect(!/NaN|undefined/.test(blob)).toBeTruthy();
  }
});

test('fixer never mutates the input ALT (returns a cloned fixed copy)', () => {
  const alt = loadExample('catalog-fixable.layout.json');
  const before = JSON.stringify(alt);
  fixAlt(alt, contract, 4);
  expect(JSON.stringify(alt)).toBe(before);
});

test('fixer with a default contract runs without throwing', () => {
  const alt = loadExample('catalog-fixable.layout.json');
  const result = fixAlt(alt, defaultContract('test'), 4);
  expect(['pass', 'best-effort', 'no-improvement', 'budget-exhausted'].includes(result.outcome)).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Gap B Phase 1b — the fixer resolves (thin stroke-only connector × text) pairs
// with the SAME band geometry collision.mjs measures with, prefers moving the
// LABEL (moving a decor connector cuts the edge it draws), and discloses every
// label move in the fix log (semantic attachment is not measurable).
// ---------------------------------------------------------------------------

// Same shapes the svg adapter emits: a thin unfilled connector (strokeWidth defaults 1)
// and a text label whose ink estimate is y = baseline − 0.8em, h = fs.
const thinConn = (id, x, y, w, h, opts = {}) => ({
  id,
  kind: 'decor',
  shape: opts.shape || 'path',
  bbox: { x, y, w, h },
  style: { opacity: opts.opacity ?? 1, filled: false, ...(opts.strokeWidth !== undefined ? { strokeWidth: opts.strokeWidth } : {}) },
});
const gapLabel = (id, x, y, w, h, fs, opts = {}) => ({
  id,
  kind: 'text',
  bbox: { x, y, w, h },
  style: { opacity: opts.opacity ?? 1, fontSize: fs, color: '#111827', bg: '#ffffff', role: 'body' },
});
const svgAlt = (nodes) => ({
  schema_version: 1,
  diagram_type: 'layout',
  meta: { title: 't', canvas: { w: 300, h: 120 }, source: 'svg' },
  nodes,
});

test('fix: label-first SVG — (thin,text) resolution moves only the label, never the decor connector (Gap B 1b)', () => {
  // Document order is label-then-connector (the label precedes the path): the collision
  // violation pairs [text, connector]. Moving the line would cut the edge it draws — the
  // label is the mover. Fixture-like geometry: ink [24,34], line y=32, sw 1.5 → band
  // [31.25, 32.75] crosses the shrunk label ink → 1 violation.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120">
  <text x="80" y="32" font-size="10">edge label</text>
  <path d="M 22 32 H 250" fill="none" stroke="#333" stroke-width="1.5"/>
</svg>`;
  const imported = importSvg(svg);
  const beforeText = imported.nodes.find((n) => n.kind === 'text').bbox;
  const beforeConn = imported.nodes.find((n) => isThinConnector(n)).bbox;
  const result = fixAlt(imported, contract, 6);
  const afterText = result.fixed.nodes.find((n) => n.kind === 'text').bbox;
  const afterConn = result.fixed.nodes.find((n) => isThinConnector(n)).bbox;
  // the label moved out of the band, the connector stayed put
  expect(afterText).not.toEqual(beforeText);
  expect(afterText.y).toBeLessThan(beforeText.y); // escape direction: away from the line
  expect(afterConn).toEqual(beforeConn);
  // resolution agrees with the measurement: re-measure with the 1a collision → 0
  expect(collision.measure(result.fixed).metrics.count).toBe(0);
});

test('fix: band-consistent resolution — a raw-clear but band-overlap pair resolves to collision 0 (Gap B 1b)', () => {
  // sw=4 → band [30,34]; label ink [24,34] crosses the line so a raw-bbox push fires, but
  // after one sepGap push the RAW bboxes clear (bottom 31.6 < 32) while the shrunk ink
  // (bottom 30.1) still sits inside the band → the raw-bbox P0 loop used to strand the pair
  // at no-improvement with the violation unresolved. The band-based push must clear it in
  // the same terms the measurement uses.
  const alt = svgAlt([
    thinConn('edge', 22, 32, 228, 0, { strokeWidth: 4 }),
    gapLabel('t', 75.5, 24, 121, 10, 10),
  ]);
  const result = fixAlt(alt, contract, 6);
  const afterText = result.fixed.nodes.find((n) => n.id === 't').bbox;
  expect(afterText.y).toBeLessThan(24); // the label escaped upward, out of the band
  expect(collision.measure(result.fixed).metrics.count).toBe(0);
});

test('fix: label-move disclosure recorded in the fix log body (Gap B 1b)', () => {
  // The fix log (finalize result, written verbatim to *.fix-log.json by the CLI) must carry
  // a notice that the label move is a minimal geometric escape and that semantic attachment
  // (which edge the label belongs to) is not measurable by the engine.
  const alt = svgAlt([
    thinConn('edge', 22, 32, 228, 0, { strokeWidth: 4 }),
    gapLabel('t', 75.5, 24, 121, 10, 10),
  ]);
  const result = fixAlt(alt, contract, 6);
  expect(Array.isArray(result.labelMoves)).toBe(true);
  expect(result.labelMoves).toHaveLength(1);
  expect(result.labelMoves[0].node).toBe('t');
  expect(result.labelMoves[0].connector).toBe('edge');
  expect(result.labelMoves[0].disclosure).toContain('minimal');
  expect(result.labelMoves[0].disclosure).toContain('semantic attachment');
  expect(result.labelMoves[0].disclosure).toContain('cannot be measured');
});

test('fix: no labelMoves key when no label moved (golden fix-log byte contract)', () => {
  // Golden *.fix-log.json snapshots are byte-compared; layouts without thin connectors must
  // not gain a labelMoves key — the key is omitted entirely when empty.
  const result = fixAlt(loadExample('catalog-fixable.layout.json'), contract, 4);
  expect(result.labelMoves).toBeUndefined();
});

test('fix: aesthetic mode keeps the band-consistent label-only resolution (opt-in path)', () => {
  // --aesthetic skips collision violations in the patch loop (P0 owned by resolveP0) and
  // its terminal pSnapToMarginGrid translates the WHOLE layout by design, so assertions
  // here are translation-invariant: the pair is resolved in the measurement's own terms,
  // the label moved UP relative to the line (escape, not approach), and the move is
  // disclosed. Strict connector-immobility is pinned by the default-mode test above.
  const rel = (n) => n.bbox.y;
  const alt = svgAlt([
    thinConn('edge', 22, 32, 228, 0, { strokeWidth: 4 }),
    gapLabel('t', 75.5, 24, 121, 10, 10),
  ]);
  const collisionOnly = { schema_version: 1, brief: '', criteria: [
    { skill: 'collision', metric: 'count', op: '<=', threshold: 0, weight: 3 },
  ] };
  const result = fixAlt(alt, collisionOnly, 6, { aesthetic: true });
  const afterText = result.fixed.nodes.find((n) => n.id === 't');
  const afterConn = result.fixed.nodes.find((n) => n.id === 'edge');
  expect(collision.measure(result.fixed).metrics.count).toBe(0);
  // label-to-line relative offset: −8 (line inside ink) → strictly smaller after the escape
  expect(rel(afterText) - rel(afterConn)).toBeLessThan(-8);
  expect(Array.isArray(result.labelMoves)).toBe(true);
  expect(result.labelMoves).toHaveLength(1);
});
