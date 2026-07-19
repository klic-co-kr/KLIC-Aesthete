import { test, expect } from 'bun:test';
import { classifyStructure, verifyStructure, structuralMetrics, inferStructure } from '../lib/structure.mjs';

// card = container + label sharing a category (so grouping counts it as ONE unit)
const card = (cat, x, y, w, h) => [
  { id: `${cat}-box`, category: cat, kind: 'container', bbox: { x, y, w, h }, style: {} },
  { id: `${cat}-lbl`, category: cat, kind: 'text', bbox: { x, y: y + h + 8, w, h: 30 }, style: { fontSize: 14 } },
];
const alt = (nodes, w = 1200, h = 800) => ({
  schema_version: 1, diagram_type: 'layout',
  meta: { title: 't', canvas: { w, h }, source: 'abstract' }, nodes,
});

test('structure: 2×2 equal grid → evidence-grid (high confidence)', () => {
  const a = alt([
    ...card('c1', 80, 80, 480, 200), ...card('c2', 640, 80, 480, 200),
    ...card('c3', 80, 360, 480, 200), ...card('c4', 640, 360, 480, 200),
  ]);
  const c = classifyStructure(a, 'dashboard');
  expect(c.id).toBe('evidence-grid');
  expect(c.confidence).toBe('high');
});

test('structure: grouping counts a card (box+label) as ONE unit, not two', () => {
  // 4 cards × 2 nodes each = 8 raw nodes; after category grouping n must be 4
  const a = alt([
    ...card('c1', 80, 80, 480, 200), ...card('c2', 640, 80, 480, 200),
    ...card('c3', 80, 360, 480, 200), ...card('c4', 640, 360, 480, 200),
  ]);
  expect(structuralMetrics(a).n).toBe(4); // not 8
});

test('structure: one hero cell among a grid → bento', () => {
  const a = alt([
    ...card('hero', 80, 80, 700, 460),
    ...card('c2', 820, 80, 300, 220), ...card('c3', 820, 320, 300, 220),
    ...card('c4', 80, 580, 1040, 120),
  ]);
  const c = classifyStructure(a, 'dashboard');
  expect(['bento', 'hero-led']).toContain(c.id); // hero-dominant; bento or hero-led both acceptable
});

test('structure: narrow rail + wide panel → split-pane', () => {
  // col 1 (rail) total width ≪ col 2 (panel) — rail ~160, panel ~860 → ratio ≪ 0.45
  const a = alt([
    ...card('rail1', 40, 80, 160, 600), ...card('rail2', 40, 700, 160, 60),
    ...card('panel', 300, 80, 860, 680),
  ]);
  const c = classifyStructure(a, 'dashboard');
  expect(c.id).toBe('split-pane');
});

test('structure: single row of 3 cards → unknown (honest, not forced)', () => {
  const a = alt([
    ...card('c1', 80, 300, 280, 200), ...card('c2', 460, 300, 280, 200), ...card('c3', 840, 300, 280, 200),
  ]);
  const c = classifyStructure(a, 'dashboard');
  expect(c.id).toBe('unknown');
  expect(c.metrics.n).toBe(3);
});

test('structure: empty ALT → unknown (no crash)', () => {
  const c = classifyStructure(alt([]));
  expect(c.id).toBe('unknown');
  expect(c.confidence).toBe('none');
});

test('verifyStructure: pass when the requested shape holds, fail when it does not', () => {
  const grid = alt([
    ...card('c1', 80, 80, 480, 200), ...card('c2', 640, 80, 480, 200),
    ...card('c3', 80, 360, 480, 200), ...card('c4', 640, 360, 480, 200),
  ]);
  expect(verifyStructure(grid, 'evidence-grid').verdict).toBe('pass');
  expect(verifyStructure(grid, 'split-pane').verdict).toBe('fail'); // equal cols, not a split
  expect(verifyStructure(grid, 'nonexistent-shape').verdict).toBe('unknown');
});

test('structure: deterministic — same ALT → byte-identical classification', () => {
  const a = alt([...card('c1', 80, 80, 480, 200), ...card('c2', 640, 80, 480, 200),
    ...card('c3', 80, 360, 480, 200), ...card('c4', 640, 360, 480, 200)]);
  expect(JSON.stringify(classifyStructure(a, 'dashboard'))).toBe(
    JSON.stringify(classifyStructure(JSON.parse(JSON.stringify(a)), 'dashboard')));
});

test('structure: does not mutate the input ALT (no leaked _ci / group markers)', () => {
  const a = alt([...card('c1', 80, 80, 480, 200), ...card('c2', 640, 80, 480, 200),
    ...card('c3', 80, 360, 480, 200), ...card('c4', 640, 360, 480, 200)]);
  const before = JSON.stringify(a);
  classifyStructure(a, 'dashboard');
  expect(JSON.stringify(a)).toBe(before);
});

// ---- inferStructure: brief text → structure id (the brief-fit step before diversification) ----

test('inferStructure: keyword in brief maps to the type-appropriate structure', () => {
  expect(inferStructure({ brief: 'a manifesto page' }, 'marketing')).toBe('manifesto');
  expect(inferStructure({ brief: 'proof with one big number' }, 'marketing')).toBe('stat-led');
  expect(inferStructure({ brief: 'bento of mixed cells' }, 'dashboard')).toBe('bento');
  expect(inferStructure({ brief: '계층형 아키텍처' }, 'diagram')).toBe('layered');
  expect(inferStructure({ brief: '방사형 hub' }, 'diagram')).toBe('radial');
});

test('inferStructure: no brief text / no signal → null (falls through to default/rotate)', () => {
  expect(inferStructure({}, 'marketing')).toBeNull();
  expect(inferStructure({ brief: 'a plain landing page' }, 'marketing')).toBeNull();
});

test('inferStructure: cross-type keyword does NOT fire (flow-graph is not a dashboard shape)', () => {
  // "flow" in a dashboard brief can't pull flow-graph (not in dashboard structures) → null
  expect(inferStructure({ brief: 'cash flow dashboard' }, 'dashboard')).toBeNull();
});
