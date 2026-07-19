import { test, expect } from 'bun:test';
import { pickStructureIndex, appendEntry, fingerprint } from '../lib/diversify.mjs';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { readLog, writeLog, defaultLogPath } from '../lib/diversify.mjs';

const structs = (ids) => ids.map((id) => ({ id, shape: `${id}-shape` }));

test('diversify: no log → index 0 (first structure, deterministic default)', () => {
  expect(pickStructureIndex(structs(['a', 'b', 'c']), [], 'dashboard')).toBe(0);
  expect(pickStructureIndex(structs(['a', 'b', 'c']), undefined, 'dashboard')).toBe(0);
});

test('diversify: no prior entry for THIS type → index 0 (unconstrained)', () => {
  const log = [{ seq: 1, artifact_type: 'marketing', structure: 'stat-led' }];
  expect(pickStructureIndex(structs(['a', 'b', 'c']), log, 'dashboard')).toBe(0);
});

test('diversify: rotates to the NEXT index after the last-used one (mod len)', () => {
  const log = [{ seq: 1, artifact_type: 'dashboard', structure: 'a' }];
  expect(pickStructureIndex(structs(['a', 'b', 'c']), log, 'dashboard')).toBe(1);
  const log2 = [{ seq: 2, artifact_type: 'dashboard', structure: 'c' }];
  expect(pickStructureIndex(structs(['a', 'b', 'c']), log2, 'dashboard')).toBe(0); // wraps
});

test('diversify: last-used id no longer in catalog → restart at 0 (no crash)', () => {
  const log = [{ seq: 1, artifact_type: 'dashboard', structure: 'retired' }];
  expect(pickStructureIndex(structs(['a', 'b', 'c']), log, 'dashboard')).toBe(0);
});

test('diversify: appendEntry increments seq off the max (no Date), newest-first', () => {
  const e1 = appendEntry([], { artifact_type: 'dashboard', structure: 'a' });
  expect(e1[0].seq).toBe(1);
  const e2 = appendEntry(e1, { artifact_type: 'dashboard', structure: 'b' });
  expect(e2[0].seq).toBe(2);
  expect(e2[1].seq).toBe(1);
});

test('diversify: appendEntry caps the rolling window', () => {
  let log = [];
  for (let i = 0; i < 25; i++) log = appendEntry(log, { artifact_type: 'dashboard', structure: 'a' });
  expect(log.length).toBeLessThanOrEqual(20);
});

test('diversify: fingerprint captures the rotation axes', () => {
  const fp = fingerprint({
    artifact_type: 'dashboard',
    structure: { id: 'bento' },
    budget: { freeRatio: { target: 0.22 }, typeScale: { id: 'tight' }, posture: 'stable' },
  });
  expect(fp).toEqual({ artifact_type: 'dashboard', structure: 'bento', freeRatio: 0.22, typeScale: 'tight', posture: 'stable' });
});

test('diversify: readLog/writeLog round-trip; missing file → []', async () => {
  const tmp = path.join(os.tmpdir(), `aesthete-diversify-${process.pid}-${Math.floor(Math.random() * 1e9)}.json`);
  expect(readLog(tmp)).toEqual([]); // missing → []
  writeLog([{ seq: 1, artifact_type: 'dashboard', structure: 'a' }], tmp);
  expect(readLog(tmp).length).toBe(1);
  expect(readLog(tmp)[0].seq).toBe(1);
  fs.rmSync(tmp, { force: true });
  expect(defaultLogPath()).toBe('.aesthete/log.json');
});
