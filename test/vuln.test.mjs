import { test, expect } from 'bun:test';
import { scanAlt } from '../lib/vuln.mjs';
import { importSvg } from '../lib/adapters/svg.mjs';

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


// ---------------------------------------------------------------------------
// Screen-UI signatures (logic-driven UI guidelines, Dannaway 2026; WCAG 2.1 AA
// contrast ratios are W3C). Each is medium-scoped to screen UI and type-suppressed
// where the flagged pattern is the artifact type's intent.
// ---------------------------------------------------------------------------

const icon = (id, x, y, filled, style = {}) => ({
  id, kind: 'icon', bbox: { x, y, w: 24, h: 24 },
  style: { opacity: 1, bg: '#111827', color: '#111827', filled, ...style },
});
const label = (id, text, fontSize = 14, style = {}) => ({
  id, kind: 'text', label: text, bbox: { x: 0, y: 0, w: text.length * fontSize * 0.6, h: fontSize },
  style: { opacity: 1, fontSize, color: '#374151', bg: '#ffffff', role: 'body', ...style },
});

test('vuln: icon-fill-mix flagged when filled and outline icons are mixed', () => {
  const r = scanAlt(alt([
    icon('i1', 0, 0, true), icon('i2', 40, 0, true),
    icon('i3', 80, 0, false), icon('i4', 120, 0, true),
  ]));
  const v = has(r, 'icon-fill-mix');
  expect(v).toBeTruthy();
  expect(v.nodes).toContain('i3');
});

test('FP-guard: a consistently outlined icon set is NOT an icon-fill mix', () => {
  const r = scanAlt(alt([icon('i1', 0, 0, false), icon('i2', 40, 0, false), icon('i3', 80, 0, false)]));
  expect(has(r, 'icon-fill-mix')).toBeUndefined();
});

test('FP-guard: icon-fill-mix needs filled DECLARED on every icon (undeclared defaults to true)', () => {
  // collision.mjs defaults an unfilled node to filled:true for back-compat, so an ALT that
  // declares `filled` on only some icons would read as a mix that the source never had.
  const partial = [icon('i1', 0, 0, false), icon('i2', 40, 0, true)];
  delete partial[1].style.filled;
  expect(has(scanAlt(alt(partial.concat([icon('i3', 80, 0, false)]))), 'icon-fill-mix')).toBeUndefined();
});

test('vuln: all-caps-text flagged on a long uppercase string', () => {
  const r = scanAlt(alt([label('loc', 'SYDNEY, AUSTRALIA')]));
  const v = has(r, 'all-caps-text');
  expect(v).toBeTruthy();
  expect(v.nodes).toContain('loc');
});

test('FP-guard: a short uppercase acronym / eyebrow is NOT all-caps body text', () => {
  const r = scanAlt(alt([label('a', 'API'), label('b', 'NEW'), label('c', 'KPI')]));
  expect(has(r, 'all-caps-text')).toBeUndefined();
});

test('FP-guard: sentence case is NOT all-caps', () => {
  expect(has(scanAlt(alt([label('a', 'Sydney, Australia')])), 'all-caps-text')).toBeUndefined();
});

test('FP-guard: all-caps suppressed for posters (display uppercase is the intent)', () => {
  const r = scanAlt(alt([label('t', 'SUMMER EXHIBITION', 64)]), { artifact_type: 'poster' });
  expect(has(r, 'all-caps-text')).toBeUndefined();
  expect(r.summary.suppressed.map((s) => s.id)).toContain('all-caps-text');
});

test('FP-guard: non-Latin text (no case distinction) is NOT all-caps', () => {
  expect(has(scanAlt(alt([label('ko', '제품 카탈로그 대시보드')])), 'all-caps-text')).toBeUndefined();
});

test('vuln: pure-black-text flagged for #000000 on a light backdrop', () => {
  const r = scanAlt(alt([label('t', 'Body copy in pure black', 16, { color: '#000000' })]));
  const v = has(r, 'pure-black-text');
  expect(v).toBeTruthy();
  expect(v.nodes).toContain('t');
});

test('FP-guard: near-black (#111827) text is NOT pure black', () => {
  expect(has(scanAlt(alt([label('t', 'Body copy', 16, { color: '#111827' })])), 'pure-black-text')).toBeUndefined();
});

test('FP-guard: black text on a DARK backdrop is a contrast problem, not the pure-black tell', () => {
  const r = scanAlt(alt([label('t', 'Body copy', 16, { color: '#000000', bg: '#0b1120' })]));
  expect(has(r, 'pure-black-text')).toBeUndefined();
});

test('vuln: low-contrast-ui flagged for an icon below 3:1 against its backdrop', () => {
  const r = scanAlt(alt([
    node('panel', 0, 0, 400, 300, { bg: '#ffffff' }),
    icon('ico', 40, 40, true, { bg: '#e8e8e8' }), // ~1.3:1 on white
  ], { w: 1000, h: 1000 }));
  const v = has(r, 'low-contrast-ui');
  expect(v).toBeTruthy();
  expect(v.nodes).toContain('ico');
});

test('FP-guard: an icon above 3:1 against its backdrop is NOT low-contrast', () => {
  const r = scanAlt(alt([
    node('panel', 0, 0, 400, 300, { bg: '#ffffff' }),
    icon('ico', 40, 40, true, { bg: '#767676' }), // ~4.5:1 on white
  ], { w: 1000, h: 1000 }));
  expect(has(r, 'low-contrast-ui')).toBeUndefined();
});

test('FP-guard: a large card on a near-white panel is NOT a low-contrast UI element', () => {
  // flat design legitimately stacks #ffffff cards on #f9fafb surfaces; only small controls/icons
  // carry the "can't see the shape" risk this signature is about.
  const r = scanAlt(alt([
    node('surface', 0, 0, 900, 900, { bg: '#f9fafb' }),
    node('card', 40, 40, 500, 400, { bg: '#ffffff' }),
  ], { w: 1000, h: 1000 }));
  expect(has(r, 'low-contrast-ui')).toBeUndefined();
});

test('FP-guard: an element with no resolvable backdrop is not flagged (never guess a surface)', () => {
  const r = scanAlt(alt([icon('ico', 40, 40, true, { bg: '#e8e8e8' })], { w: 1000, h: 1000 }));
  expect(has(r, 'low-contrast-ui')).toBeUndefined();
});

test('vuln: new screen-UI signatures are advisory suggestionOnly like the rest', () => {
  const r = scanAlt(alt([
    label('loc', 'SYDNEY, AUSTRALIA', 14, { color: '#000000' }),
    icon('i1', 0, 0, true), icon('i2', 40, 0, false), icon('i3', 80, 0, true),
  ]));
  for (const id of ['all-caps-text', 'pure-black-text', 'icon-fill-mix']) {
    expect(has(r, id).mode).toBe('suggestionOnly');
  }
  expect(r.summary.advisory).toBe(true);
});

test('vuln: low-contrast-ui catches a low-contrast BUTTON, not just tiny icons', () => {
  // empirical gap: a 140×44 primary button on a 390×700 phone canvas is 2.3% of the area, so an
  // area-share cap excluded the exact case the guideline is about (button shape invisible at 1.3:1).
  // PRECONDITION: the ALT carries an explicit page-surface node. Hand-authored ALTs and html
  // imports do; an SVG import does NOT — see the import-path scope tests below.
  const r = scanAlt(alt([
    node('page', 0, 0, 390, 700, { bg: '#ffffff' }),
    node('cta', 16, 640, 140, 44, { bg: '#dce8fa' }), // ~1.3:1 on white
  ], { w: 390, h: 700 }));
  const v = has(r, 'low-contrast-ui');
  expect(v).toBeTruthy();
  expect(v.nodes).toContain('cta');
});

test('FP-guard: a tall panel/section is not a control (height guard), even at low contrast', () => {
  const r = scanAlt(alt([
    node('page', 0, 0, 1000, 1000, { bg: '#ffffff' }),
    node('sidebar', 0, 0, 240, 900, { bg: '#fafafa' }),
  ], { w: 1000, h: 1000 }));
  expect(has(r, 'low-contrast-ui')).toBeUndefined();
});

test('FP-guard: a repeated tile pattern is a field, not a UI control (WCAG 1.4.11 exempts decoration)', () => {
  // caught on examples/ground-truth-svg/*--whitespace--severe.svg: 96 identical 96×96 #cbd5e1
  // clutter tiles on white (1.7:1). Low contrast, but a background pattern — not a control whose
  // shape someone must perceive.
  const tiles = [node('page', 0, 0, 1000, 1000, { bg: '#ffffff' })];
  for (let i = 0; i < 12; i++) tiles.push(node(`t${i}`, (i % 4) * 100 + 10, Math.floor(i / 4) * 100 + 10, 96, 96, { bg: '#cbd5e1' }));
  expect(has(scanAlt(alt(tiles, { w: 1000, h: 1000 })), 'low-contrast-ui')).toBeUndefined();
});

test('vuln: a small icon row (few siblings) at low contrast IS still flagged', () => {
  const r = scanAlt(alt([
    node('page', 0, 0, 1000, 1000, { bg: '#ffffff' }),
    icon('i1', 40, 40, true, { bg: '#e8e8e8' }),
    icon('i2', 80, 40, true, { bg: '#e8e8e8' }),
    icon('i3', 120, 40, true, { bg: '#e8e8e8' }),
  ], { w: 1000, h: 1000 }));
  expect(has(r, 'low-contrast-ui')).toBeTruthy();
});

// --- low-contrast-ui: real scope on the SVG import path --------------------
// parseSvgLeaves DROPS full-canvas backdrops (≥90% of the canvas) from the leaf list, so an
// element sitting directly on the page has NO resolvable surface after import. The signature
// refuses to guess one, which means its SVG coverage is elements inside a RETAINED container
// (card, panel, section) — not "any UI element". Pinned here so the limitation can't drift into
// an assumed capability; the honest-limitations section in README.md states it.

test('low-contrast-ui (svg import): a control inside a retained panel IS flagged', () => {
  const alt = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="390" height="700" viewBox="0 0 390 700">
    <rect width="390" height="700" fill="#ffffff"/>
    <rect x="16" y="16" width="358" height="240" fill="#ffffff"/>
    <circle cx="346" cy="44" r="14" fill="#f4f6f8"/>
  </svg>`);
  const v = has(scanAlt(alt), 'low-contrast-ui');
  expect(v).toBeTruthy();
  expect(v.nodes).toContain('circle-2');
});

test('low-contrast-ui (svg import): a control directly on the page is NOT flagged (page rect dropped)', () => {
  const alt = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="390" height="700" viewBox="0 0 390 700">
    <rect width="390" height="700" fill="#ffffff"/>
    <rect x="16" y="640" width="140" height="44" fill="#dce8fa"/>
  </svg>`);
  // the full-canvas page rect is not a leaf: only the CTA survives, so it has no surface to
  // be compared against
  expect(alt.nodes.length).toBe(1);
  expect(alt.nodes[0].style.bg).toBe('#dce8fa');
  expect(has(scanAlt(alt), 'low-contrast-ui')).toBeUndefined();
});
