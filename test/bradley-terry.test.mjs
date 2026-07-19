import { test, expect } from 'bun:test';
import { bradleyTerry, rankByStrength } from '../lib/bradley-terry.mjs';

test('bradleyTerry: a clear win order produces the right ranking (A > B > C)', () => {
  const s = bradleyTerry([
    { winner: 'A', loser: 'B' }, { winner: 'B', loser: 'C' }, { winner: 'A', loser: 'C' },
  ]);
  expect(rankByStrength(s)).toEqual(['A', 'B', 'C']);
  expect(s.get('A')).toBeGreaterThan(s.get('B'));
  expect(s.get('B')).toBeGreaterThan(s.get('C'));
});

test('bradleyTerry: strengths normalize to sum 1', () => {
  const s = bradleyTerry([{ winner: 'A', loser: 'B' }, { winner: 'B', loser: 'C' }]);
  const sum = [...s.values()].reduce((a, b) => a + b, 0);
  expect(sum).toBeCloseTo(1, 5);
});

test('bradleyTerry: count field = repeated matchups', () => {
  // A beats B 3× , B beats C 3× — same ordering as three discrete pairs
  const a = bradleyTerry([{ winner: 'A', loser: 'B', count: 3 }, { winner: 'B', loser: 'C', count: 3 }]);
  const b = bradleyTerry([
    { winner: 'A', loser: 'B' }, { winner: 'A', loser: 'B' }, { winner: 'A', loser: 'B' },
    { winner: 'B', loser: 'C' }, { winner: 'B', loser: 'C' }, { winner: 'B', loser: 'C' },
  ]);
  expect(rankByStrength(a)).toEqual(['A', 'B', 'C']);
  expect(a.get('A')).toBeCloseTo(b.get('A'), 4);
});

test('bradleyTerry: an item that never wins converges toward 0', () => {
  const s = bradleyTerry([{ winner: 'A', loser: 'B' }, { winner: 'A', loser: 'B' }, { winner: 'B', loser: 'C' }]);
  expect(s.get('C')).toBeLessThan(s.get('B'));
  expect(s.get('C')).toBeLessThan(0.01); // lost its only matchup
});

test('bradleyTerry: deterministic — same input → identical output', () => {
  const votes = [{ winner: 'A', loser: 'B' }, { winner: 'B', loser: 'C' }, { winner: 'C', loser: 'D' }];
  expect(JSON.stringify(bradleyTerry(votes))).toBe(JSON.stringify(bradleyTerry(votes)));
});

test('bradleyTerry: skips null/self pairs without crashing', () => {
  const s = bradleyTerry([{ winner: 'A', loser: 'B' }, { winner: null, loser: 'X' }, { winner: 'A', loser: 'A' }]);
  expect(s.has('X')).toBe(false);
  expect(rankByStrength(s)).toEqual(['A', 'B']);
});
