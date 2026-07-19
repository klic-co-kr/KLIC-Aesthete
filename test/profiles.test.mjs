import { test, expect } from 'bun:test';
import { PROFILES, PROFILE_NAMES, getProfile, assertAllowed, isAllowed, isEnforced } from '../lib/profiles.mjs';

test('profiles: the four execution layers exist', () => {
  expect(PROFILE_NAMES.sort()).toEqual(['fix-geometry', 'human-gate', 'llm-judge', 'measure-only']);
  for (const name of PROFILE_NAMES) {
    const p = getProfile(name);
    expect(p.allowed.length).toBeGreaterThan(0);
    expect(p.forbidden.length).toBeGreaterThan(0);
    expect(typeof p.successTruth).toBe('string');
    expect(p.autonomy).toMatch(/^L[0-5]$/);
  }
});

test('profiles: measure-only is read-only (forbids mutation/model/publish)', () => {
  expect(isAllowed('measure-only', 'vuln-scan')).toBe(true);
  expect(isAllowed('measure-only', 'mutate-alt')).toBe(false);
  expect(isAllowed('measure-only', 'apply-fix')).toBe(false);
  expect(isAllowed('measure-only', 'call-model')).toBe(false);
});

test('profiles: fix-geometry allows autoFixable but forbids suggestionOnly + semantics', () => {
  expect(isAllowed('fix-geometry', 'apply-autoFixable-patch')).toBe(true);
  expect(isAllowed('fix-geometry', 'apply-suggestionOnly')).toBe(false);
  expect(isAllowed('fix-geometry', 'mutate-semantics')).toBe(false);
});

test('profiles: no layer may publish/approve autonomously', () => {
  for (const name of PROFILE_NAMES) {
    expect(isAllowed(name, 'publish')).toBe(false);
    expect(isAllowed(name, 'approve')).toBe(false);
  }
});

test('assertAllowed: throws on forbidden action, silent on allowed', () => {
  expect(() => assertAllowed('measure-only', 'mutate-alt')).toThrow();
  expect(() => assertAllowed('fix-geometry', 'apply-suggestionOnly')).toThrow();
  expect(assertAllowed('measure-only', 'vuln-scan')).toBe(true);
});

test('assertAllowed: unknown profile throws', () => {
  expect(() => assertAllowed('nope', 'measure')).toThrow();
});

test('profiles: enforced flag is honest — only the two runtimes that actually bind a profile claim enforcement', () => {
  // measure-only (vuln) and fix-geometry (fix) are bound to real runtimes.
  expect(isEnforced('measure-only')).toBe(true);
  expect(isEnforced('fix-geometry')).toBe(true);
  // llm-judge / human-gate have NO runtime that asserts them yet — aspirational, not enforced.
  // (Guards against re-claiming enforcement for unbound layers — the realistic-review failure.)
  expect(isEnforced('llm-judge')).toBe(false);
  expect(isEnforced('human-gate')).toBe(false);
  // every profile declares an `enforced` boolean (no silent undefined)
  for (const name of PROFILE_NAMES) {
    expect(typeof getProfile(name).enforced).toBe('boolean');
  }
});
