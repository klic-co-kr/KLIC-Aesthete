import { test, expect } from 'bun:test';
import { scanAlt } from '../lib/vuln.mjs';

const node = (id, x, y, w, h, style = {}, category) => ({
  id, kind: 'box', category, bbox: { x, y, w, h },
  style: { opacity: 1, bg: '#3b82f6', color: '#111827', ...style },
});
const alt = (nodes, canvas = { w: 1000, h: 1000 }) => ({
  schema_version: 1, diagram_type: 'layout',
  meta: { title: 't', canvas, source: 'abstract' }, nodes,
});
const has = (report, id) => report.vulnerabilities.find((v) => v.id === id);

test('vuln: no-focal-point flagged when no element dominates', () => {
  // four identical-weight boxes → no optical dominance
  const r = scanAlt(alt([
    node('a', 100, 100, 100, 100), node('b', 300, 100, 100, 100),
    node('c', 100, 300, 100, 100), node('d', 300, 300, 100, 100),
  ]));
  expect(has(r, 'no-focal-point')).toBeTruthy();
  expect(r.summary.bySeverity.high).toBeGreaterThan(0);
});

test('vuln: type-scale-accident flagged at >5 distinct font sizes', () => {
  const r = scanAlt(alt([
    node('a', 0, 0, 100, 50, { fontSize: 10 }),
    node('b', 0, 0, 100, 50, { fontSize: 12 }),
    node('c', 0, 0, 100, 50, { fontSize: 14 }),
    node('d', 0, 0, 100, 50, { fontSize: 18 }),
    node('e', 0, 0, 100, 50, { fontSize: 24 }),
    node('f', 0, 0, 100, 50, { fontSize: 32 }),
  ]));
  const v = has(r, 'type-scale-accident');
  expect(v).toBeTruthy();
  expect(v.signal).toBe(6);
});

test('vuln: ai-cliche-palette flagged when color clusters in blue–purple', () => {
  // hues: #3b82f6(blue ~217), #6366f1(indigo ~239), #8b5cf6(violet ~258), #a855f7(purple ~271)
  const r = scanAlt(alt([
    node('a', 0, 0, 100, 100, { bg: '#3b82f6' }, 'x'),
    node('b', 200, 0, 100, 100, { bg: '#6366f1' }, 'y'),
    node('c', 400, 0, 100, 100, { bg: '#8b5cf6' }, 'z'),
    node('d', 600, 0, 100, 100, { bg: '#a855f7' }, 'w'),
  ]));
  expect(has(r, 'ai-cliche-palette')).toBeTruthy();
});

test('vuln: every finding is suggestionOnly (design-direction, not geometry-auto-fixable)', () => {
  const r = scanAlt(alt([
    node('a', 0, 0, 100, 100), node('b', 0, 0, 100, 100),
    node('c', 0, 0, 100, 100), node('d', 0, 0, 100, 100),
  ]));
  expect(r.vulnerabilities.length).toBeGreaterThan(0);
  for (const v of r.vulnerabilities) {
    expect(v.mode).toBe('suggestionOnly');
    expect(typeof v.remediation).toBe('string');
    expect(v.nodes).toBeInstanceOf(Array);
  }
});

test('vuln: coverage skips text/color signatures when input lacks them', () => {
  // boxes with bg color but NO fontSize, NO category → text coverage unmeasurable
  const r = scanAlt(alt([
    node('a', 0, 0, 100, 100), node('b', 200, 0, 100, 100), node('c', 400, 0, 100, 100),
  ]));
  expect(r.summary.coverage.text).toBe('unmeasurable');
  expect(has(r, 'type-scale-accident')).toBeUndefined(); // text signature not run
});

test('vuln: runs under measure-only profile (read-only)', () => {
  const r = scanAlt(alt([node('a', 0, 0, 100, 100)]));
  expect(r.summary.profile).toBe('measure-only');
});

test('vuln: deterministic — same ALT → byte-identical report', () => {
  const a = alt([node('a', 0, 0, 80, 80), node('b', 200, 0, 80, 80), node('c', 400, 0, 80, 80)]);
  expect(JSON.stringify(scanAlt(a))).toBe(JSON.stringify(scanAlt(JSON.parse(JSON.stringify(a)))));
});

// ---- false-positive guards (realistic review: context-blind heuristics flagged correct designs) ----

const kpi = (id, x) => node(id, x, 40, 260, 160, { role: 'heading', fontSize: 32, bg: '#0f172a', color: '#fff' }, 'kpi');
const dashboard = alt([kpi('k1', 40), kpi('k2', 320), kpi('k3', 600), kpi('k4', 880)], { w: 1200, h: 800 });

test('FP-guard: a legitimate dashboard WITHOUT context is (correctly) flagged by generic scan', () => {
  // generic scan has no type → applies marketing/poster assumptions → fires. This is the known
  // FP surface; the fix is to scan WITH the artifact_type (next test).
  const r = scanAlt(dashboard);
  expect(r.summary.artifact_type).toBeNull();
  expect(has(r, 'no-focal-point')).toBeTruthy();
});

test('FP-guard: SAME dashboard WITH type=dashboard suppresses the type-intended patterns', () => {
  const r = scanAlt(dashboard, { artifact_type: 'dashboard' });
  // these patterns ARE a dashboard's intent (equal-weight grid, even spacing) → must not fire
  expect(has(r, 'no-focal-point')).toBeUndefined();
  expect(has(r, 'no-spacing-rhythm')).toBeUndefined();
  expect(has(r, 'even-split')).toBeUndefined();
  // and the suppression is transparent, not hidden
  const ids = r.summary.suppressed.map((s) => s.id);
  expect(ids).toEqual(expect.arrayContaining(['no-focal-point', 'no-spacing-rhythm', 'even-split']));
  expect(r.summary.advisory).toBe(true);
});

test('FP-guard: neutral dark brand color is NOT the “AI cliché” palette', () => {
  // #0f172a is near-black navy (l≈0.11) — a legitimate neutral, not the blue→purple cliché.
  // The l-floor must exclude it so dark brand palettes don't false-positive.
  const r = scanAlt(alt([
    node('a', 0, 0, 100, 100, { bg: '#0f172a' }),
    node('b', 200, 0, 100, 100, { bg: '#0f172a' }),
    node('c', 400, 0, 100, 100, { bg: '#0f172a' }),
  ]));
  expect(has(r, 'ai-cliche-palette')).toBeUndefined();
});

test('FP-guard: thresholds are configurable (override relaxes a signature)', () => {
  // 6 font sizes → type-scale-accident fires at default (5); raising the bar to 10 suppresses it
  const six = alt([
    node('a', 0, 0, 100, 50, { fontSize: 10 }), node('b', 0, 0, 100, 50, { fontSize: 12 }),
    node('c', 0, 0, 100, 50, { fontSize: 14 }), node('d', 0, 0, 100, 50, { fontSize: 18 }),
    node('e', 0, 0, 100, 50, { fontSize: 24 }), node('f', 0, 0, 100, 50, { fontSize: 32 }),
  ]);
  expect(has(scanAlt(six), 'type-scale-accident')).toBeTruthy();
  expect(has(scanAlt(six, { thresholds: { 'type-scale-accident': { sizes: 10 } } }), 'type-scale-accident')).toBeUndefined();
});

test('FP-guard: PARTIAL threshold override deep-merges (does not kill the signature)', () => {
  // overriding only `share` must keep the other ai-cliche defaults (hueLo/lMin/…) intact,
  // so the signature still functions instead of silently dying on undefined comparisons.
  const purple = alt([
    node('a', 0, 0, 100, 100, { bg: '#3b82f6' }, 'x'), node('b', 200, 0, 100, 100, { bg: '#6366f1' }, 'y'),
    node('c', 400, 0, 100, 100, { bg: '#8b5cf6' }, 'z'), node('d', 600, 0, 100, 100, { bg: '#a855f7' }, 'w'),
  ]);
  // default fires; a partial override lowering `share` still uses default hue band → still fires here
  expect(has(scanAlt(purple), 'ai-cliche-palette')).toBeTruthy();
  expect(has(scanAlt(purple, { thresholds: { 'ai-cliche-palette': { share: 0.5 } } }), 'ai-cliche-palette')).toBeTruthy();
});

// ---- hanging-header (the templated-editorial tell) ----

test('vuln: hanging-header flagged — small label left of a larger heading at the same row', () => {
  // tag-left + heading-right two-column: "01" margin label beside a big "Features" heading
  const r = scanAlt(alt([
    node('tag', 40, 100, 60, 40, { fontSize: 14, role: 'eyebrow' }),
    node('head', 200, 95, 500, 60, { fontSize: 40, role: 'heading' }),
  ], { w: 800, h: 400 }));
  const v = has(r, 'hanging-header');
  expect(v).toBeTruthy();
  expect(v.nodes).toEqual(expect.arrayContaining(['tag', 'head']));
});

test('FP-guard: label stacked ABOVE the heading is NOT a hanging header', () => {
  // tag directly above heading in the same column — the recommended remediation, not the tell
  const r = scanAlt(alt([
    node('tag', 200, 40, 500, 30, { fontSize: 14, role: 'eyebrow' }),
    node('head', 200, 90, 500, 60, { fontSize: 40, role: 'heading' }),
  ], { w: 800, h: 400 }));
  expect(has(r, 'hanging-header')).toBeUndefined();
});

test('FP-guard: hanging-header suppressed for diagrams (left-margin layer labels are legitimate)', () => {
  // a layered architecture diagram legitimately labels tiers on the left margin
  const layered = alt([
    node('tag', 40, 100, 60, 40, { fontSize: 14 }, 'tier'),
    node('band', 200, 95, 500, 60, { fontSize: 24 }, 'tier'),
  ], { w: 800, h: 400 });
  expect(has(scanAlt(layered, { artifact_type: 'diagram' }), 'hanging-header')).toBeUndefined();
  // and the suppression is transparent
  expect(scanAlt(layered, { artifact_type: 'diagram' }).summary.suppressed.map((s) => s.id)).toContain('hanging-header');
});

// ---- hanging-header FP suite (each guard tied to a real false positive the probe surfaced) ----

test('FP: form label beside an input is NOT a hanging header (input has no display-scale font)', () => {
  const r = scanAlt(alt([
    node('lbl', 40, 100, 80, 30, { fontSize: 14, role: 'label' }),
    node('input', 140, 95, 300, 40, { role: 'input' }), // no fontSize → not a heading
  ], { w: 800, h: 400 }));
  expect(has(r, 'hanging-header')).toBeUndefined();
});

test('FP: key/value table row is NOT a hanging header (value is not display-scale)', () => {
  const r = scanAlt(alt([
    node('key', 40, 100, 100, 30, { fontSize: 13 }, 'row'),
    node('val', 160, 100, 200, 30, { fontSize: 14 }, 'row'), // 14 < displayMin 24
  ], { w: 800, h: 400 }));
  expect(has(r, 'hanging-header')).toBeUndefined();
});

test('FP: icon beside body text is NOT a hanging header (icon carries no fontSize)', () => {
  // the catalog-bad case the empirical probe caught (c2-icon ↔ c3-body) before the guard
  const r = scanAlt(alt([
    node('icon', 40, 100, 40, 40, { role: 'decor' }),        // no fontSize
    node('body', 200, 100, 400, 30, { fontSize: 16, role: 'body' }),
  ], { w: 800, h: 400 }));
  expect(has(r, 'hanging-header')).toBeUndefined();
});

test('FP: bails on dense input (maxNodes cap) — no explosion, no finding', () => {
  // real SVGs can import thousands of nodes; the O(n²) scan must bail, not fire on noise
  const many = [];
  for (let i = 0; i < 100; i++) many.push(node(`n${i}`, (i % 10) * 90, Math.floor(i / 10) * 50, 40, 20, { fontSize: 12 }));
  const r = scanAlt(alt(many, { w: 900, h: 500 }));
  expect(has(r, 'hanging-header')).toBeUndefined();
});

