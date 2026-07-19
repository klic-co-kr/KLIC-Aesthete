import { test, expect } from 'bun:test';
import {
  GRAPH, CONFLICT_EDGES, INFLUENCE_EDGES, conflicts, influenceWeight,
  compensationFactor, orderViolations,
} from '../lib/graph.mjs';

test('GRAPH is declarative: nodes + conflict + influence edges', () => {
  expect(GRAPH.nodes.length >= 6).toBeTruthy();
  expect(GRAPH.edges.some((e) => e.type === 'conflict')).toBeTruthy();
  expect(GRAPH.edges.some((e) => e.type === 'influence')).toBeTruthy();
});

test('conflicts: proximity↔whitespace and balance↔proximity declared', () => {
  expect(conflicts('proximity', 'whitespace')).toBe(true);
  expect(conflicts('balance', 'proximity')).toBe(true);
  expect(conflicts('collision', 'balance')).toBe(false);
});

test('influence: hierarchy→proximity weight 0.3', () => {
  expect(influenceWeight('hierarchy', 'proximity')).toBe(0.3);
  expect(influenceWeight('proximity', 'hierarchy')).toBe(0);
});

test('compensationFactor: proximity suppressed when cramped, free when spacious', () => {
  expect(compensationFactor('proximity', { freeRatio: 0.1 }) <= 0.01).toBeTruthy();
  expect(compensationFactor('proximity', { freeRatio: 0.5 }) >= 0.99).toBeTruthy();
  expect(compensationFactor('balance', { freeRatio: 0.1 })).toBe(1); // non-conflict skills unaffected
});

test('orderViolations: deterministic + tier-first', () => {
  const viols = [
    { skill: 'balance', severity: 'high', nodes: ['a'] },
    { skill: 'collision', severity: 'low', nodes: ['a', 'b'] },
  ];
  const ordered = orderViolations(viols);
  expect(ordered[0].skill).toBe('collision'); // P0 first regardless of severity
  // determinism: same input → same output
  expect(orderViolations(viols)).toEqual(ordered);
});
