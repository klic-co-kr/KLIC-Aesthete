// §12 Intent-Quality-Plane (Aesthete side): coverage + score split + fix.mode.
import { test, expect } from 'bun:test';
import { measureAlt } from '../lib/measure.mjs';
import { AUTO_FIXABLE_KINDS, fixMode } from '../lib/fixkind.mjs';
import { PATCH_KINDS } from '../lib/fix.mjs';

const box = (id, x, y, w, h, cat) => ({
  id, category: cat, kind: 'box', bbox: { x, y, w, h },
  style: { luminance: 0.1, opacity: 1, bg: '#3b82f6', color: '#111827' },
});
const alt = (nodes, canvas = { w: 400, h: 400 }) => ({
  schema_version: 1, diagram_type: 'layout',
  meta: { title: 't', canvas, source: 'abstract' }, nodes,
});

test('coverage: no grouping semantics → proximity/similarity unmeasurable, score not inflated', () => {
  // 4 nodes, NO category (no grouping semantics); 2 overlaps + overflow → P0 broken.
  const r = measureAlt(alt([
    box('a', 0, 0, 90, 90), box('b', 0, 0, 90, 90),
    box('c', 350, 350, 90, 90), box('d', 360, 360, 90, 90),
  ]));
  expect(r.skills.proximity.coverage).toBe('unmeasurable');
  expect(r.skills.similarity.coverage).toBe('unmeasurable');
  expect(r.skills.collision.coverage).toBe('measured');
  // honest score EXCLUDES the unmeasurable 1.0 axes → strictly lower than legacy overallScore
  expect(r.summary.measuredAestheticScore).toBeLessThan(r.summary.overallScore);
  expect(r.summary.coverageScore).toBeLessThan(1);
  expect(r.summary.hardIntegrityScore).toBe(0); // collision + boundary fully broken
});

test('coverage: full-featured nodes → all 9 axes measured, measuredAestheticScore == overallScore', () => {
  // category (proximity/similarity) + role+fontSize (hierarchy/fluency) + bg (harmony) + bbox (rest)
  const node = (id, x, role, fs) => ({
    id, category: 'card', kind: 'box', bbox: { x, y: 10, w: 50, h: 50 },
    style: { role, fontSize: fs, luminance: 0.1, opacity: 1, bg: '#3b82f6', color: '#111827' },
  });
  const r = measureAlt(alt([node('a', 10, 'body', 16), node('b', 70, 'heading', 24)]));
  expect(r.skills.proximity.coverage).toBe('measured');
  expect(r.skills.similarity.coverage).toBe('measured');
  expect(r.skills.hierarchy.coverage).toBe('measured');
  expect(r.skills.fluency.coverage).toBe('measured');
  expect(r.summary.coverageScore).toBe(1);
  expect(r.summary.measuredAestheticScore).toBe(r.summary.overallScore);
});

test('coverage: role-less/font-less boxes → hierarchy & fluency unmeasurable (no inflation)', () => {
  // 4 boxes with color+bbox but NO role/fontSize/category — hierarchy/fluency/proximity/similarity
  // all have nothing to judge; they must be unmeasurable, not score-1 'measured'.
  const r = measureAlt(alt([
    box('a', 10, 10, 80, 80), box('b', 110, 10, 80, 80),
    box('c', 10, 110, 80, 80), box('d', 110, 110, 80, 80),
  ]));
  expect(r.skills.hierarchy.coverage).toBe('unmeasurable');
  expect(r.skills.fluency.coverage).toBe('unmeasurable');
  expect(r.skills.proximity.coverage).toBe('unmeasurable');
  expect(r.skills.similarity.coverage).toBe('unmeasurable');
  // collision/boundary still measured (geometry always present)
  expect(r.skills.collision.coverage).toBe('measured');
  expect(r.skills.boundary.coverage).toBe('measured');
  expect(r.summary.coverageScore).toBeLessThan(1);
});

test('fix.mode: every violation fix is stamped autoFixable|suggestionOnly', () => {
  const r = measureAlt(alt([
    box('a', 0, 0, 90, 90, 'card'), box('b', 0, 0, 90, 90, 'card'),
  ]));
  const allFixes = Object.values(r.skills)
    .flatMap((s) => s.violations.map((v) => v.fix))
    .filter(Boolean);
  expect(allFixes.length).toBeGreaterThan(0);
  for (const f of allFixes) {
    expect(['autoFixable', 'suggestionOnly']).toContain(f.mode);
  }
});

test('fixMode: geometric kinds are autoFixable; font/color/semantic kinds are suggestionOnly', () => {
  for (const k of ['separate-overlap', 'clamp-overflow', 'scale-group-down', 'increase-gap', 'shift-heaviest-toward-center', 'shift-toward-cluster-centroid']) {
    expect(fixMode(k)).toBe('autoFixable');
  }
  for (const k of ['unify-group', 'strengthen-hierarchy-gradient', 'converge-palette', 'balance-color-weight', 'differentiate-scale', 'raise-contrast', 'reorder-reading-flow']) {
    expect(fixMode(k)).toBe('suggestionOnly');
  }
});

test('drift guard: AUTO_FIXABLE_KINDS matches fix.mjs PATCHES keys', () => {
  // if this fails, either fixkind.mjs or fix.mjs PATCHES was edited without the other
  expect([...PATCH_KINDS].sort()).toEqual([...AUTO_FIXABLE_KINDS].sort());
});

test('robustness: a skill that throws is failing (not passing), coverage unmeasurable', () => {
  const goodSkill = { id: 'good', tier: 'P2', weight: 1, effect: '', measure: () => ({ score: 1, coverage: 'measured', metrics: {}, violations: [] }) };
  const crashingSkill = { id: 'crashy', tier: 'P2', weight: 1, effect: '', measure: () => { throw new Error('boom'); } };
  const r = measureAlt(alt([box('a', 10, 10, 50, 50)]), {}, [goodSkill, crashingSkill]);
  expect(r.summary.passing).toEqual(['good']);
  expect(r.summary.failing).toContain('crashy');
  expect(r.skills.crashy.coverage).toBe('unmeasurable');
  expect(r.skills.crashy.metrics.error).toBe('boom');
});
