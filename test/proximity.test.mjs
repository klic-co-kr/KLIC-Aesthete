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
