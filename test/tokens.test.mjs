import { test, expect } from 'bun:test';
import { lint, normHex } from '../lib/tokens.mjs';

const alt = (nodes) => ({ schema_version: 1, diagram_type: 'layout', meta: { title: 't', canvas: { w: 100, h: 100 } }, nodes });

test('lint: approved tokens only → passes', () => {
  const r = lint(alt([
    { id: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 }, style: { bg: '#1A73E8', fontSize: 16 } },
    { id: 'b', bbox: { x: 0, y: 0, w: 10, h: 10 }, style: { bg: '#FFCE5C', fontSize: 24 } },
  ]));
  expect(r.passed).toBe(true);
  expect(r.violations.length).toBe(0);
});

test('lint: arbitrary hex (#FF3B30) → rejected (escape hatch)', () => {
  const r = lint(alt([{ id: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 }, style: { bg: '#FF3B30' } }]));
  expect(r.passed).toBe(false);
  expect(r.violations.some((v) => v.kind === 'color' && v.value === '#FF3B30')).toBeTruthy();
});

test('lint: off-scale fontSize → rejected', () => {
  const r = lint(alt([{ id: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 }, style: { bg: '#1A73E8', fontSize: 17 } }]));
  expect(r.passed).toBe(false);
  expect(r.violations.some((v) => v.kind === 'fontSize')).toBeTruthy();
});

test('lint: "none"/"transparent" backgrounds are allowed', () => {
  const r = lint(alt([{ id: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 }, style: { bg: 'none', color: 'transparent' } }]));
  expect(r.passed).toBe(true);
});

test('tokens: short hex is normalized for comparison', () => {
  expect(normHex('#FFF')).toBe(normHex('#ffffff'));
});
