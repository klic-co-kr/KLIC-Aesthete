import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { rank, pearson, spearman, validateCorpus } from '../lib/validate.mjs';

const demoCorpus = JSON.parse(readFileSync(new URL('../examples/validation-corpus.json', import.meta.url), 'utf8'));

test('rank: ties share the average rank', () => {
  expect(rank([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  expect(rank([5])).toEqual([1]);
});

test('pearson/spearman: perfect monotonic agreement → 1.0; inverse → -1.0', () => {
  expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 6);
  expect(spearman([1, 2, 3], [10, 20, 30])).toBeCloseTo(1, 6);
  expect(spearman([1, 2, 3], [30, 20, 10])).toBeCloseTo(-1, 6);
});

test('pearson: constant array → 0 (guarded against divide-by-zero, never NaN)', () => {
  expect(pearson([5, 5, 5], [1, 2, 3])).toBe(0);
  expect(Number.isFinite(pearson([1, 2, 3], [1, 2, 3]))).toBe(true);
});

test('validateCorpus: A/B/C/D + baseline + winner on the demo corpus', () => {
  const r = validateCorpus(demoCorpus);
  expect(r.n).toBe(10);
  expect(r.variants.map((v) => v.id).sort()).toEqual(['A', 'B', 'C', 'D']);
  expect(r.baseline.spearman).toBe(0);
  expect(['A', 'B', 'C', 'D']).toContain(r.winner);
  for (const v of r.variants) {
    expect(Number.isFinite(v.spearman)).toBe(true);
    expect(Number.isFinite(v.pearson)).toBe(true);
  }
  expect(r.demo).toBe(true);
  expect(r.note).toContain('SYNTHETIC'); // must scream "not a real validation"
});

test('validateCorpus: skips entries lacking a humanScore or a measurable alt (paired only)', () => {
  const r = validateCorpus({ demo: false, entries: [
    { id: 'ok', humanScore: 5, alt: { schema_version: 1, diagram_type: 'layout', meta: { canvas: { w: 100, h: 100 }, source: 'abstract' }, nodes: [] } },
    { id: 'no-human', alt: { meta: { canvas: { w: 100, h: 100 } }, nodes: [] } },
  ] });
  expect(r.n).toBe(1);
});

test('validateCorpus: deterministic — same corpus → byte-identical result', () => {
  const a = validateCorpus(demoCorpus);
  const b = validateCorpus(JSON.parse(JSON.stringify(demoCorpus)));
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});
