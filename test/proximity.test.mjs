import { test, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import proximity from '../lib/skills/proximity.mjs';
import { skillRoot } from '../lib/shared/cli.mjs';

function alt(nodes, canvas = { w: 1000, h: 1000 }) {
  return { meta: { title: 't', canvas }, nodes };
}
function node(id, x, y, w, h, category, label) {
  return { id, category, label, bbox: { x, y, w, h } };
}

test('measure(alt, { profile }) reads params from the profile file, not global', () => {
  const profile = 'prox-test-profile';
  const file = path.join(skillRoot(), `skill-params.${profile}.json`);
  fs.writeFileSync(file, JSON.stringify({
    proximity: { ALPHA: 4, RANG_RATIO: 1.5, FRAG_FACTOR: 2.5, SIM_THRESHOLD: 0.6 },
  }));
  try {
    const a = alt([
      node('a', 10, 10, 40, 40, 'card', 'card'),
      node('b', 60, 10, 40, 40, 'card', 'card'),
    ]);
    const def = proximity.measure(a);               // global ALPHA=1
    const prof = proximity.measure(a, { profile }); // profile ALPHA=4
    // P_group = exp(-α·d/dRef) → higher α → lower meanGroupP. Proves the profile is read.
    expect(prof.metrics.meanGroupP).toBeLessThan(def.metrics.meanGroupP);
    expect(prof.metrics.meanGroupP).toBeGreaterThanOrEqual(0);
  } finally {
    fs.unlinkSync(file);
  }
});

test('clustered related nodes → no fragmentation', () => {
  // two related items close together, one unrelated far away
  const a = alt([
    node('a', 10, 10, 40, 40, 'card', 'card'),
    node('b', 60, 10, 40, 40, 'card', 'card'),
    node('c', 800, 800, 40, 40, 'icon', 'icon'),
  ]);
  const r = proximity.measure(a);
  expect(r.metrics.fragmentedCount).toBe(0);
});

test('related cluster + far related outlier → fragmentation flagged', () => {
  // a,b form a tight card cluster; c is the same category but far away (needs 3+ nodes
  // so d_ref reflects the tight spacing and the outlier reads as split).
  const a = alt([
    node('a', 10, 10, 40, 40, 'card', 'card'),
    node('b', 60, 10, 40, 40, 'card', 'card'),
    node('c', 900, 900, 40, 40, 'card', 'card'),
  ]);
  const r = proximity.measure(a);
  expect(r.metrics.fragmentedCount >= 1).toBeTruthy();
  expect(r.violations.some((v) => v.metric === 'fragmentedCount')).toBeTruthy();
});

test('unrelated node too close to a cluster member → false adjacency flagged', () => {
  // grouping is declared (a,b same category) so proximity runs; x is unrelated but RANG-close
  const a = alt([
    node('a', 10, 10, 200, 200, 'card', 'cardA'),
    node('b', 60, 10, 200, 200, 'card', 'cardB'),
    node('x', 30, 30, 200, 200, 'icon', 'iconX'),
  ]);
  const r = proximity.measure(a);
  expect(r.metrics.falseAdjacencyCount >= 1).toBeTruthy();
});

test('no grouping declared (all unique categories) → proximity skips gracefully', () => {
  const a = alt([
    node('a', 10, 10, 40, 40, 'card-1', 'card-1'),
    node('b', 500, 500, 40, 40, 'card-2', 'card-2'),
  ]);
  const r = proximity.measure(a);
  expect(r.metrics.skipped).toBe(true);
  expect(r.score).toBe(1);
  expect(r.metrics.fragmentedCount).toBe(0);
});

test('fewer than 2 nodes → perfect score, no crash', () => {
  const r1 = proximity.measure(alt([node('a', 0, 0, 10, 10, 'x', 'x')]));
  expect(r1.score).toBe(1);
  const r0 = proximity.measure(alt([]));
  expect(r0.score).toBe(1);
});

test('coincident centers do not produce NaN', () => {
  const a = alt([
    node('a', 50, 50, 10, 10, 'card', 'card'),
    node('b', 50, 50, 10, 10, 'card', 'card'),
  ]);
  const r = proximity.measure(a);
  expect(JSON.stringify(r).includes('NaN')).toBe(false);
  expect(JSON.stringify(r).includes('null')).toBe(false);
});

// ---------------------------------------------------------------------------
// Gap A (diagram-gaps plan §2.1): structural relations for SVG-sourced ALTs.
// An SVG import carries grouping semantics property-based `related()` cannot see —
// a shape holding most of a label is its caption (containment), and a connector next
// to a label is its edge label. Both pairs are one perceptual unit. Gated on
// meta.source==='svg'; the skip gate still counts related() pairs only.

function svgAlt(nodes, canvas = { w: 1000, h: 1000 }) {
  return { meta: { title: 't', canvas, source: 'svg' }, nodes };
}
function sourcedAlt(source, nodes, canvas = { w: 1000, h: 1000 }) {
  return { meta: { title: 't', canvas, source }, nodes };
}
function snode(id, x, y, w, h, category, extra = {}) {
  return { id, category, bbox: { x, y, w, h }, ...extra };
}
// nodes shaped like lib/adapters/svg.mjs output
const panel = (id, x, y, w, h, cat) => snode(id, x, y, w, h, cat, { kind: 'box', shape: 'rect', style: { filled: true } });
const label = (id, x, y, w, h, cat, fs = 12) => snode(id, x, y, w, h, cat, { kind: 'text', style: { fontSize: fs, filled: true } });
const connector = (id, x, y, w, h, cat) => snode(id, x, y, w, h, cat, { kind: 'decor', shape: 'path', style: { filled: false } });
// an unrelated but related-DECLARED pair far away — passes the relatedPairs gate
// without touching the geometry under test
const gatePair = () => [panel('g1', 500, 500, 40, 40, 'grp'), panel('g2', 560, 500, 40, 40, 'grp')];

test('Gap A containment: rect ∋ text (svg) → no false adjacency', () => {
  const a = svgAlt([
    panel('r1', 0, 0, 200, 100, 'rect'),
    label('t1', 10, 10, 60, 14, 'text'),
    ...gatePair(),
  ]);
  const r = proximity.measure(a);
  expect(r.metrics.skipped).toBeUndefined();
  expect(r.metrics.falseAdjacencyCount).toBe(0);
  expect(r.metrics.fragmentedCount).toBe(0);
  expect(r.score).toBe(1);
});

test('Gap A edge label: connector near its label (bbox-gap ≤ threshold) → no false adjacency', () => {
  // connector bbox (0,50,100,0); label bbox (20,20,40,12) → bbox-gap = 18
  // ≤ max(16, 2.0×12) = 24 → structural relation
  const a = svgAlt([
    connector('c1', 0, 50, 100, 0, 'path'),
    label('t1', 20, 20, 40, 12, 'text'),
    ...gatePair(),
  ]);
  const r = proximity.measure(a);
  expect(r.metrics.skipped).toBeUndefined();
  expect(r.metrics.falseAdjacencyCount).toBe(0);
  expect(r.score).toBe(1);
});

test('Gap A edge label beyond threshold → false adjacency still fires', () => {
  // label bbox (20,0,40,12) → bbox-gap = 50 − 12 = 38 > 24 → not structural
  // (residual false adjacency is accepted by design — plan §2.1)
  const a = svgAlt([
    connector('c1', 0, 50, 100, 0, 'path'),
    label('t1', 20, 0, 40, 12, 'text'),
    ...gatePair(),
  ]);
  const r = proximity.measure(a);
  expect(r.metrics.falseAdjacencyCount).toBe(1);
  expect(r.violations[0].nodes).toEqual(['c1', 't1']);
});

test('Gap A gating: same geometry as abstract keeps the legacy result (structural off)', () => {
  const nodes = [
    panel('r1', 0, 0, 200, 100, 'rect'),
    label('t1', 10, 10, 60, 14, 'text'),
    ...gatePair(),
  ];
  const r = proximity.measure(sourcedAlt('abstract', nodes));
  // without svg gating the containment pair is still an unrelated adjacency
  expect(r.metrics.falseAdjacencyCount).toBe(1);
  expect(r.violations[0].nodes).toEqual(['r1', 't1']);
});

test('Gap A gating: html source with unique categories still skips', () => {
  const a = sourcedAlt('html', [
    panel('r1', 0, 0, 200, 100, 'rect-1'),
    label('t1', 10, 10, 60, 14, 'text-1'),
  ]);
  const r = proximity.measure(a);
  expect(r.metrics.skipped).toBe(true);
  expect(r.metrics.falseAdjacencyCount).toBe(0);
});

test('Gap A gating: pptx source (unique sp-N categories) still skips', () => {
  // pptx imports give every shape a unique sp-${idx} category and meta.source==='pptx'
  // (plan §1 Gap A) — no related() pair, no structural relation, legacy skip preserved
  const a = sourcedAlt('pptx', [
    panel('r1', 0, 0, 200, 100, 'sp-0'),
    label('t1', 10, 10, 60, 14, 'sp-1'),
  ]);
  const r = proximity.measure(a);
  expect(r.metrics.skipped).toBe(true);
  expect(r.metrics.falseAdjacencyCount).toBe(0);
});

test('Gap A gating: structural pairs never feed the relatedPairs gate (3-node svg → skipped)', () => {
  // rect ∋ text and connector ~ text would both be structural pairs, but no
  // category/label pair exists — the skip gate must stay closed
  const a = svgAlt([
    panel('r1', 0, 0, 200, 100, 'rect'),
    label('t1', 10, 10, 60, 14, 'text'),
    connector('c1', 0, 50, 100, 0, 'path'),
  ]);
  const r = proximity.measure(a);
  expect(r.metrics.skipped).toBe(true);
  expect(r.score).toBe(1);
  expect(r.metrics.falseAdjacencyCount).toBe(0);
});

test('Gap A multi-text panel: panel + two labels → one unit, no violations', () => {
  // both labels share the svg tag-fallback category 'text' (plan §1 Gap A)
  const a = svgAlt([
    panel('r1', 0, 0, 200, 100, 'rect'),
    label('t1', 10, 10, 60, 14, 'text'),
    label('t2', 110, 10, 60, 14, 'text'),
  ]);
  const r = proximity.measure(a);
  expect(r.metrics.falseAdjacencyCount).toBe(0);
  expect(r.metrics.fragmentedCount).toBe(0);
  expect(r.score).toBe(1);
});

test('Gap A nested panels: outer ∋ inner ∋ text → no violations', () => {
  const a = svgAlt([
    panel('p1', 0, 0, 200, 200, 'rect'),
    panel('q1', 20, 20, 100, 100, 'rect'),
    label('t1', 30, 30, 40, 12, 'text'),
  ]);
  const r = proximity.measure(a);
  expect(r.metrics.falseAdjacencyCount).toBe(0);
  expect(r.metrics.fragmentedCount).toBe(0);
  expect(r.score).toBe(1);
});
