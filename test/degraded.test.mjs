import { test, expect } from 'bun:test';
import { fixAlt } from '../lib/fix.mjs';
import { defaultContract } from '../lib/contract.mjs';

const contract = defaultContract('degraded');
const CANVAS = { w: 1000, h: 1000 };
const alt = (nodes) => ({ schema_version: 1, diagram_type: 'layout', meta: { title: 't', canvas: CANVAS }, nodes });
const box = (id, x, y, w, h) => ({ id, category: id, kind: 'box', bbox: { x, y, w, h } });

// Contract: under any pathological input the fixer MUST NOT throw, MUST NOT emit NaN,
// and MUST return a valid outcome enum with a parseable report. (pateo degraded philosophy.)
const PATHOLOGICAL = [
  ['empty canvas', alt([])],
  ['single node', alt([box('a', 50, 50, 10, 10)])],
  ['all coincident', alt([box('a', 50, 50, 100, 100), box('b', 50, 50, 100, 100), box('c', 50, 50, 100, 100)])],
  ['zero-area node', alt([box('a', 50, 50, 0, 0), box('b', 200, 200, 100, 100)])],
  ['huge overflow', alt([box('a', 5000, -3000, 100, 100)])],
  ['ring of overlaps', alt([box('a', 0, 0, 200, 200), box('b', 100, 0, 200, 200), box('c', 50, 100, 200, 200), box('d', 0, 50, 200, 200), box('e', 100, 100, 200, 200)])],
  ['nodes outside canvas on all sides', alt([box('l', -500, 400, 100, 100), box('r', 1400, 400, 100, 100), box('t', 400, -500, 100, 100), box('b', 400, 1400, 100, 100)])],
];

for (const [label, input] of PATHOLOGICAL) {
  test(`degraded: ${label} → finite score, no throw, no NaN, valid outcome`, () => {
    const result = fixAlt(input, contract, 5);
    const blob = JSON.stringify(result);
    expect(['pass', 'best-effort', 'no-improvement', 'budget-exhausted'].includes(result.outcome)).toBeTruthy();
    expect(Number.isFinite(result.report.summary.overallScore)).toBeTruthy();
    expect(blob).not.toMatch(/NaN|undefined|TypeError/);
    // every node bbox in the fixed output is finite (NaN backstop)
    for (const n of result.fixed.nodes) {
      expect(Number.isFinite(n.bbox.x) && Number.isFinite(n.bbox.y)).toBeTruthy();
    }
  });
}

test('degraded: every fixed node ends inside the canvas (P0 clamp holds)', () => {
  const input = alt([box('a', 5000, -3000, 100, 100), box('b', 50, 50, 100, 100)]);
  const result = fixAlt(input, contract, 5);
  for (const n of result.fixed.nodes) {
    expect(n.bbox.x >= -0.01 && n.bbox.y >= -0.01).toBeTruthy();
    expect(n.bbox.x + n.bbox.w <= CANVAS.w + 0.01).toBeTruthy();
    expect(n.bbox.y + n.bbox.h <= CANVAS.h + 0.01).toBeTruthy();
  }
});
