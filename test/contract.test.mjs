import { test, expect } from 'bun:test';
import { defaultContract, evaluate } from '../lib/contract.mjs';

function report(skills) {
  return { schema_version: 1, summary: { overallScore: 1, totalWeightedViolation: 0, passing: [], failing: [] }, skills };
}

test('defaultContract has the 10 expected criteria', () => {
  const c = defaultContract('brief');
  expect(c.brief).toBe('brief');
  expect(c.criteria.length).toBe(10);
  expect(c.criteria[0]).toEqual({ skill: 'collision', metric: 'count', op: '==', threshold: 0, weight: 3 });
  expect(c.criteria.some((cr) => cr.skill === 'fluency' && cr.metric === 'fluency')).toBeTruthy();
});

test('evaluate: all criteria met → pass, score 1', () => {
  const c = defaultContract('');
  const r = report({
    collision: { score: 1, metrics: { count: 0 }, violations: [] },
    boundary: { score: 1, metrics: { overflowCount: 0 }, violations: [] },
    hierarchy: { score: 1, metrics: { clarity: 0.9 }, violations: [] },
    balance: { score: 1, metrics: { BM: 0.9 }, violations: [] },
    proximity: { score: 1, metrics: { fragmentedCount: 0, falseAdjacencyCount: 0 }, violations: [] },
    whitespace: { score: 1, metrics: { freeRatio: 0.5 }, violations: [] },
    harmony: { score: 1, metrics: { harmonyScore: 0.8 }, violations: [] },
    similarity: { score: 1, metrics: { inconsistentGroups: 0 }, violations: [] },
    fluency: { score: 0.9, metrics: { fluency: 0.9 }, violations: [] },
  });
  const e = evaluate(r, c);
  expect(e.verdict).toBe('pass');
  expect(e.score).toBe(1);
  expect(e.allPass).toBe(true);
});

test('evaluate: one P0 failure → fail, weighted score < 1', () => {
  const c = defaultContract('');
  const r = report({
    collision: { score: 0, metrics: { count: 2 }, violations: [] },
    boundary: { score: 1, metrics: { overflowCount: 0 }, violations: [] },
    hierarchy: { score: 1, metrics: { clarity: 0.9 }, violations: [] },
    balance: { score: 1, metrics: { BM: 0.9 }, violations: [] },
    proximity: { score: 1, metrics: { fragmentedCount: 0, falseAdjacencyCount: 0 }, violations: [] },
    whitespace: { score: 1, metrics: { freeRatio: 0.5 }, violations: [] },
  });
  const e = evaluate(r, c);
  expect(e.verdict).toBe('fail');
  // collision weight 3 of total 11.5 → score = (11.5-3)/11.5
  expect(e.score < 1 && e.score > 0.5).toBeTruthy();
});

test('evaluate: missing metric → that criterion fails (not crash)', () => {
  const c = defaultContract('');
  const r = report({ collision: { score: 1, metrics: {}, violations: [] } });
  const e = evaluate(r, c);
  expect(e.verdict).toBe('fail');
  expect(e.criteria[0].passed).toBe(false);
  expect(e.criteria[0].measured).toBe(null);
});

test('evaluate is deterministic (op ==, >=, <=)', () => {
  const c = { schema_version: 1, brief: '', criteria: [
    { skill: 'x', metric: 'm', op: '==', threshold: 5, weight: 1 },
    { skill: 'x', metric: 'm', op: '>=', threshold: 5, weight: 1 },
    { skill: 'x', metric: 'm', op: '<=', threshold: 5, weight: 1 },
  ] };
  const r = report({ x: { score: 1, metrics: { m: 5 }, violations: [] } });
  const e = evaluate(r, c);
  expect(e.criteria.every((cr) => cr.passed)).toBe(true);
});

test('evaluate: criterion on an unmeasurable skill is UNMEASURED, never a vacuous pass', () => {
  // hierarchy reports clarity=1 (default) but coverage='unmeasurable' — the criterion must
  // not pass on the unverified default. (§12)
  const c = { schema_version: 1, brief: '', criteria: [
    { skill: 'hierarchy', metric: 'clarity', op: '>=', threshold: 0.7, weight: 1 },
  ] };
  const r = report({ hierarchy: { score: 1, coverage: 'unmeasurable', metrics: { clarity: 1 }, violations: [] } });
  const e = evaluate(r, c);
  expect(e.criteria[0].status).toBe('unmeasured');
  expect(e.criteria[0].passed).toBe(false);
  expect(e.unmeasured).toContain('hierarchy.clarity>=0.7');
  expect(e.allPass).toBe(false);
});
