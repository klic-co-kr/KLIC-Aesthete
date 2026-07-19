import { test, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { analyzeDiff, tune } from '../lib/tune.mjs';
import { loadParams } from '../lib/skill-params.mjs';
import { skillRoot } from '../lib/shared/cli.mjs';

const alt = (nodes) => ({ schema_version: 1, diagram_type: 'layout', meta: { title: 't', canvas: { w: 1000, h: 1000 } }, nodes });
const card = (id, x) => ({ id, category: 'card', bbox: { x, y: 100, w: 100, h: 100 } });
const PROFILE = 'unit-test-tune';
const profileFile = () => path.join(skillRoot(), `skill-params.${PROFILE}.json`);

test('analyzeDiff: tightened spacing → medianRatio < 1, tightened true', () => {
  const before = alt([card('a', 100), card('b', 600)]); // dist 500
  const after = alt([card('a', 100), card('b', 250)]);  // dist 250 → ratio 0.5
  const a = analyzeDiff(before, after);
  expect(a.analyzedPairs).toBe(1);
  expect(a.medianRatio < 1).toBeTruthy();
  expect(a.tightened).toBe(true);
});

test('analyzeDiff: unrelated (different category) pairs are ignored', () => {
  const before = alt([{ id: 'a', category: 'x', bbox: { x: 0, y: 0, w: 10, h: 10 } }, { id: 'b', category: 'y', bbox: { x: 500, y: 0, w: 10, h: 10 } }]);
  const a = analyzeDiff(before, before);
  expect(a.analyzedPairs).toBe(0);
  expect(a.medianRatio).toBe(null);
});

test('tune: tightened → FRAG_FACTOR reduced (dry-run, no file write)', () => {
  const before = alt([card('a', 100), card('b', 600)]);
  const after = alt([card('a', 100), card('b', 250)]);
  const r = tune(before, after); // no apply → no skill-params.json
  expect(r.changes.FRAG_FACTOR.to < r.changes.FRAG_FACTOR.from).toBeTruthy();
  expect(r.applied).toBe(false);
  expect(/타이트/.test(r.recommendation)).toBeTruthy();
});

test('tune: no related pairs → params unchanged', () => {
  const before = alt([{ id: 'a', category: 'x', bbox: { x: 0, y: 0, w: 10, h: 10 } }]);
  const r = tune(before, before);
  expect(r.changes).toEqual({});
});

test('governance: apply with too few pairs is BLOCKED (no params mutated)', () => {
  // 2 same-category cards → 1 pair (< MIN_PAIRS=3)
  const before = alt([card('a', 100), card('b', 600)]);
  const after = alt([card('a', 100), card('b', 250)]);
  const r = tune(before, after, { apply: true });
  expect(r.applied).toBe(false);
  expect(r.blocked).toBe(true);
  expect(r.blockedReason).toContain('최소 표본');
});

test('governance: --force overrides the min-sample gate', () => {
  const before = alt([card('a', 100), card('b', 600)]); // 1 pair
  const after = alt([card('a', 100), card('b', 250)]);
  if (fs.existsSync(profileFile())) fs.unlinkSync(profileFile());
  const r = tune(before, after, { apply: true, force: true, profile: PROFILE });
  expect(r.applied).toBe(true);
  expect(r.blocked).toBeUndefined();
  expect(fs.existsSync(profileFile())).toBe(true);
  fs.unlinkSync(profileFile());
});

test('governance: enough pairs → apply writes to profile file, not global', () => {
  // 4 same-category cards → C(4,2)=6 pairs (>= MIN_PAIRS)
  const before = alt([card('a', 100), card('b', 300), card('c', 500), card('d', 700)]);
  const after = alt([card('a', 100), card('b', 200), card('c', 300), card('d', 400)]);
  if (fs.existsSync(profileFile())) fs.unlinkSync(profileFile());
  const r = tune(before, after, { apply: true, profile: PROFILE });
  expect(r.applied).toBe(true);
  expect(r.writtenTo).toBe(`skill-params.${PROFILE}.json`);
  expect(fs.existsSync(profileFile())).toBe(true);
  fs.unlinkSync(profileFile());
});

test('governance: blocked apply does NOT mutate the in-memory params (cache stays clean)', () => {
  // loadParams() returns a shared cached object — tune must clone before mutating, else a
  // BLOCKED apply still pollutes every later measurement in the process.
  const beforeParams = JSON.parse(JSON.stringify(loadParams()));
  const before = alt([card('a', 100), card('b', 600)]); // 1 pair < MIN_PAIRS
  const after = alt([card('a', 100), card('b', 250)]);
  const r = tune(before, after, { apply: true });
  expect(r.blocked).toBe(true);
  expect(loadParams()).toEqual(beforeParams);
});

test('governance: dry-run does NOT mutate the in-memory params either', () => {
  const beforeParams = JSON.parse(JSON.stringify(loadParams()));
  const before = alt([card('a', 100), card('b', 300), card('c', 500), card('d', 700)]);
  const after = alt([card('a', 100), card('b', 200), card('c', 300), card('d', 400)]);
  const r = tune(before, after); // dry-run (no apply)
  expect(r.applied).toBe(false);
  expect(loadParams()).toEqual(beforeParams);
});

test('governance: apply WITHOUT --profile/--global is BLOCKED (no silent global mutation)', () => {
  // 6 related pairs (>= MIN_PAIRS) but no write target → must refuse, not write global.
  const beforeParams = JSON.parse(JSON.stringify(loadParams()));
  const before = alt([card('a', 100), card('b', 300), card('c', 500), card('d', 700)]);
  const after = alt([card('a', 100), card('b', 200), card('c', 300), card('d', 400)]);
  const r = tune(before, after, { apply: true });
  expect(r.applied).toBe(false);
  expect(r.blocked).toBe(true);
  expect(r.blockedReason).toContain('글로벌');
  expect(loadParams()).toEqual(beforeParams); // nothing mutated
});

test('governance: --global explicitly opts in to writing the global file', () => {
  const before = alt([card('a', 100), card('b', 300), card('c', 500), card('d', 700)]);
  const after = alt([card('a', 100), card('b', 200), card('c', 300), card('d', 400)]);
  const globalFile = path.join(skillRoot(), 'skill-params.json');
  const hadPre = fs.existsSync(globalFile);
  try {
    const r = tune(before, after, { apply: true, global: true });
    expect(r.applied).toBe(true);
    expect(r.writtenTo).toBe('skill-params.json');
    expect(fs.existsSync(globalFile)).toBe(true);
  } finally {
    if (!hadPre && fs.existsSync(globalFile)) fs.unlinkSync(globalFile);
    for (const f of fs.readdirSync(skillRoot())) {
      if (/^skill-params\.json\.backup-\d+$/.test(f)) fs.unlinkSync(path.join(skillRoot(), f));
    }
  }
});
