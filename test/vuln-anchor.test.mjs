// anchor-buried FP suite — split into its own file per the label-baseline-off precedent (the
// parent test/vuln.test.mjs stays off the growth ladder). Self-contained: local copies of the
// shared fixture helpers, so test/vuln.test.mjs needs no import seam.
//
// The defect (fiv.co.kr diagram rules — "clip at the boundary"): a connector endpoint drawn
// INTO a node shape instead of stopping at its edge buries the arrowhead under the fill.
// Probe calibration (plan §2.4, /tmp/anchor-probe): bybit gallery 63 connectors — 0 endpoints
// inside boxes (legit joints ≤0.5px); line-cuts-box fail fixture — 5px each side; synthetic
// centre-connect target — 60.0px. Separation gap [5px, 60px] → minDepthPx 8.
import { test, expect } from 'bun:test';
import { scanAlt } from '../lib/vuln.mjs';
import { importSvg } from '../lib/adapters/svg.mjs';

const box = (id, x, y, w, h, style = {}) => ({
  id, kind: 'box', shape: 'rect', bbox: { x, y, w, h },
  style: { opacity: 1, bg: '#dbeafe', color: '#111827', ...style },
});
const edge = (id, ends, shape = 'line', bbox) => ({
  id, kind: 'decor', shape, bbox: bbox || { x: ends[0][0], y: Math.min(ends[0][1], ends[1][1]), w: 2, h: 2 },
  endpoints: ends,
  style: { opacity: 1, color: '#111827' },
});
const alt = (nodes, canvas = { w: 1000, h: 1000 }) => ({
  schema_version: 1, diagram_type: 'layout',
  meta: { title: 't', canvas, source: 'abstract' }, nodes,
});
const has = (report, id) => report.vulnerabilities.find((v) => v.id === id);

// ---------------------------------------------------------------------------
// target detection — centre-connected stroke buries both ends half a box deep
// ---------------------------------------------------------------------------

test('vuln: anchor-buried flagged on the centre-connect SVG (signal 60, path + rect ids)', () => {
  // markup mirrors /tmp/anchor-probe/center-connect.svg (plan §5): both endpoints sit EXACTLY
  // on the rect centres; the stroke's own axis decides the burial (60 = half box width).
  const a = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200">
    <rect x="20" y="80" width="120" height="60" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
    <rect x="260" y="80" width="120" height="60" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
    <text x="80" y="114" font-size="12" text-anchor="middle">A</text>
    <text x="320" y="114" font-size="12" text-anchor="middle">B</text>
    <path d="M80,110 L 320,110" fill="none" stroke="#3b82f6" stroke-width="1.5" marker-end="url(#arrow)"/>
  </svg>`);
  const v = has(scanAlt(a, { artifact_type: 'diagram' }), 'anchor-buried');
  expect(v).toBeTruthy();
  expect(v.signal).toBe(60);
  expect(v.severity).toBe('medium');
  expect(v.nodes).toEqual(expect.arrayContaining(['path-4', 'rect-0']));
});

test('vuln: anchor-buried fires on a hand-authored (abstract) ALT carrying schema-legal endpoints', () => {
  // the non-svg path into the detector: endpoints is an optional ALT node key, so abstract
  // authors get the same advisory without any adapter in the loop
  const a = alt([
    edge('edge', [[80, 110], [320, 110]], 'path', { x: 20, y: 109, w: 300, h: 2 }),
    box('a', 20, 80, 120, 60),
    box('b', 260, 80, 120, 60),
  ]);
  const v = has(scanAlt(a), 'anchor-buried');
  expect(v).toBeTruthy();
  expect(v.signal).toBe(60);
  expect(v.nodes).toEqual(['edge', 'a']); // first (stable-order) worst wins on the tie
});

// ---------------------------------------------------------------------------
// FP guards — each pins a real legitimate pattern the naive detector would bury
// ---------------------------------------------------------------------------

test('FP-guard: a 5px boundary joint is legitimate (bybit line-cuts-box measurement)', () => {
  // legit joints measure ≤5px (probe); minDepthPx 8 clears them. Both ends 5px inside one box.
  const a = alt([
    edge('edge', [[45, 100], [195, 100]]),
    box('big', 40, 60, 160, 80),
  ]);
  expect(has(scanAlt(a), 'anchor-buried')).toBeUndefined();
});

test('FP-guard: gutter stub between boxes (bybit house style) has no host — silent', () => {
  // arrow stub lives in the 12px gutter BETWEEN boxes; neither endpoint is inside any host
  const a = alt([
    box('l', 100, 100, 100, 60),
    box('r', 212, 100, 100, 60),
    edge('stub', [[203, 130], [209, 130]]),
  ]);
  expect(has(scanAlt(a), 'anchor-buried')).toBeUndefined();
});

test('FP-guard: a connector PASSING THROUGH a box (ends outside) is not an anchor finding', () => {
  // the endpoints-only view sees a through-passage at neither end — interior crossing is
  // collision's seam (thin-connector ink band), not anchor-buried's
  const a = alt([
    box('mid', 100, 100, 100, 60),
    edge('cross', [[50, 130], [250, 130]], 'line', { x: 50, y: 129, w: 200, h: 2 }),
  ]);
  expect(has(scanAlt(a), 'anchor-buried')).toBeUndefined();
});

test('FP-guard: both ends inside the SAME host is an internal leader, not a buried arrowhead', () => {
  const a = alt([
    box('a', 20, 80, 160, 80),
    edge('leader', [[80, 110], [120, 130]]),
  ]);
  expect(has(scanAlt(a), 'anchor-buried')).toBeUndefined();
});

test('FP-guard: a demoted pill (decor) is not a host — status badges invite connectors', () => {
  // pill (h≤16 + label) → classifySvgSemantics demotes pill+label to decor; without the
  // kind filter the centre-connected stub would fire depth 30 against the pill bbox.
  const a = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200">
    <rect id="n1" x="20" y="80" width="100" height="60" fill="#ffffff" stroke="#111111"/>
    <rect id="pill" x="150" y="90" width="60" height="16" rx="8" fill="#dbeafe" stroke="#3b82f6"/>
    <text x="180" y="101" font-size="10" text-anchor="middle">tag</text>
    <line id="e" x1="120" y1="98" x2="180" y2="98" stroke="#111111"/>
  </svg>`);
  expect(has(scanAlt(a), 'anchor-buried')).toBeUndefined();
});

test('FP-guard: a text node is not a host — labels of label-only diagrams anchor legitimately', () => {
  const a = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200">
    <text id="t" x="150" y="100" font-size="20" text-anchor="middle">Label</text>
    <line id="e" x1="150" y1="180" x2="150" y2="96" stroke="#111111"/>
  </svg>`);
  expect(has(scanAlt(a), 'anchor-buried')).toBeUndefined();
});

test('FP-guard: a decision diamond (path shape) is not a host — bbox corners would ghost-fire', () => {
  // diamond bbox is 160×120 around a rotated shape; a slab answer at (200,100) would invent
  // depth 80 at the bbox edge where the real diamond boundary is 80px away ONLY along the
  // axis, and the corner ghost is worse — path shapes stay out until port-fanout v2.
  const a = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">
    <path id="d" d="M200 40 L280 100 L200 160 L120 100 Z" fill="#ffffff" stroke="#111111"/>
    <line id="e" x1="60" y1="100" x2="200" y2="100" stroke="#111111"/>
  </svg>`);
  expect(has(scanAlt(a), 'anchor-buried')).toBeUndefined();
});

test('FP: bails past the maxNodes cap — dense imports scan nothing, fire nothing', () => {
  // 401 nodes > 400: one 60px-buried unit is planted inside, so dropping the cap fires on it.
  const ns = [box('a', 20, 80, 120, 60), edge('edge', [[80, 110], [400, 110]], 'line', { x: 80, y: 109, w: 320, h: 2 })];
  for (let i = 0; i < 399; i++) ns.push(box(`f${i}`, (i % 20) * 60, 300 + Math.floor(i / 20) * 40, 40, 20));
  const r = scanAlt(alt(ns, { w: 1200, h: 1200 }));
  expect(has(r, 'anchor-buried')).toBeUndefined();
});

test('bail: domains without endpoint capture (no endpoints key) never fire', () => {
  // html/pptx/image/abstract exports carry no endpoints — the key's absence IS the honest
  // coverage signal (graceful bail, not a meta.source gate)
  const a = alt([
    { id: 'edge', kind: 'decor', shape: 'path', bbox: { x: 20, y: 109, w: 300, h: 2 }, style: { opacity: 1 } },
    box('a', 20, 80, 120, 60),
    box('b', 260, 80, 120, 60),
  ]);
  expect(has(scanAlt(a), 'anchor-buried')).toBeUndefined();
});

test('bail: endpoints on a non-connector kind (box carrying the key) is ignored', () => {
  // the detector re-checks kind/shape — endpoints recorded on a host-kind node are not scanned
  const a = alt([
    { ...box('a', 20, 80, 120, 60), endpoints: [[80, 110], [400, 110]] },
    box('b', 260, 80, 120, 60),
  ]);
  expect(has(scanAlt(a), 'anchor-buried')).toBeUndefined();
});
