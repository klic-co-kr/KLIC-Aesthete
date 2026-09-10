// label-baseline-off FP suite — split out of test/vuln.test.mjs per the repo's file-size rule
// (650-line action trigger; the parent file had grown past it). Self-contained: local copies of
// the shared fixture helpers, so test/vuln.test.mjs needs no import seam.
import { test, expect } from 'bun:test';
import { scanAlt } from '../lib/vuln.mjs';
import { importSvg } from '../lib/adapters/svg.mjs';

const node = (id, x, y, w, h, style = {}, category) => ({
  id, kind: 'box', category, bbox: { x, y, w, h },
  style: { opacity: 1, bg: '#3b82f6', color: '#111827', ...style },
});
const line = (id, text, x, y, fontSize = 16, style = {}) => ({
  id, kind: 'text', label: text, bbox: { x, y, w: text.length * fontSize * 0.6, h: fontSize * 1.25 },
  style: { opacity: 1, fontSize, color: '#374151', bg: '#ffffff', role: 'body', ...style },
});
const alt = (nodes, canvas = { w: 1000, h: 1000 }) => ({
  schema_version: 1, diagram_type: 'layout',
  meta: { title: 't', canvas, source: 'abstract' }, nodes,
});
const has = (report, id) => report.vulnerabilities.find((v) => v.id === id);

// ---------------------------------------------------------------------------
// label-baseline-off — the ABSOLUTE baseline tell sibling-misalign can't see:
// a SOLE label mis-centered vertically in its own box. Sibling comparison needs
// a second text in the row; a text-in-box unit has none, so the box centre is
// the only reference. Guards mirror sibling-misalign's (see its FP suite).
// NO diagram suppression: the diagram domain is where this defect lives (the
// target fixture is a diagram; measured 1 fire across the full fixture set).
// ---------------------------------------------------------------------------

test('vuln: label-baseline-off flagged — sole label rides high in its box', () => {
  // target-fixture geometry (baseline-off.svg): rect centre y=80, text baseline y=80 →
  // ink centre 76.4, Δ=−3.6 ≥ max(2, 0.08×36=2.88). The correct baseline is 84.2 (Δ=0.6).
  const a = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="272" viewBox="0 0 272 120">
    <rect x="22" y="62" width="228" height="36" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
    <text x="136" y="80" font-size="12" fill="#1e40af" text-anchor="middle">Ingest</text>
  </svg>`);
  const v = has(scanAlt(a), 'label-baseline-off');
  expect(v).toBeTruthy();
  expect(v.nodes).toEqual(expect.arrayContaining(['text-1', 'rect-0']));
});

test('FP-guard: a label on the correct baseline (box centre ±0.6px) is NOT baseline-off', () => {
  // baseline 84.2 puts the ink centre at 80.6 — Δ=0.6 sits inside the 2px measurement floor
  // (ink estimates carry ±~0.2em of font-metric error; the floor absorbs it). Removing the
  // |Δ| threshold check fires here.
  const a = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="272" viewBox="0 0 272 120">
    <rect x="22" y="62" width="228" height="36" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
    <text x="136" y="84.2" font-size="12" fill="#1e40af" text-anchor="middle">Ingest</text>
  </svg>`);
  expect(has(scanAlt(a), 'label-baseline-off')).toBeUndefined();
});

test('FP-guard: a small label at the top of a tall panel is intent, not baseline drift', () => {
  // panel headers sit high ON PURPOSE: share 12/200 = 0.06 < textShareMin 0.2 → the label is
  // not judged against the panel centre at all. Removing the share guard fires (Δ=−86).
  const a = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="360" viewBox="0 0 360 240">
    <rect width="360" height="240" fill="#ffffff"/>
    <rect x="20" y="20" width="300" height="200" rx="8" fill="#f8fafc" stroke="#cbd5e1"/>
    <text x="32" y="40" font-size="12" fill="#334155">Panel header</text>
  </svg>`);
  expect(has(scanAlt(a), 'label-baseline-off')).toBeUndefined();
});

test('FP-guard: a two-text box (label + value) is intent — single-text guard', () => {
  // key/value and multi-line labels place each text deliberately; only a SOLE label can be
  // mis-centred against its own box. The "Key" text is 21.6px off centre — removing the
  // single-text guard fires here.
  const a = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="300" viewBox="0 0 300 120">
    <rect width="300" height="120" fill="#ffffff"/>
    <rect x="20" y="20" width="200" height="80" fill="#f8fafc" stroke="#cbd5e1"/>
    <text x="32" y="42" font-size="12" fill="#334155">Key</text>
    <text x="32" y="80" font-size="12" fill="#64748b">A longer value string</text>
  </svg>`);
  expect(has(scanAlt(a), 'label-baseline-off')).toBeUndefined();
});

test('FP-guard: card-row pass fixture — centred labels are NOT baseline-off', () => {
  // Source/Target labels: baseline 67 in a y=45 h=36 box → ink centre 63.4 vs box centre 63
  // (Δ=0.4, inside the floor). Markup mirrors fixtures/pass/card-row.svg.
  const a = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="338" viewBox="0 0 338 126">
    <defs>
      <marker id="arrow" markerWidth="8" markerHeight="8" refX="2" refY="4" orient="auto" markerUnits="userSpaceOnUse">
        <path d="M0,0 L8,4 L0,8 L2,4 z" fill="#64748b"/>
      </marker>
    </defs>
    <rect x="0" y="0" width="338" height="126" fill="#ffffff"/>
    <rect x="25" y="25" width="288" height="76" rx="10" fill="#ffffff" stroke="#94a3b8"/>
    <rect x="45" y="45" width="110" height="36" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
    <text x="100" y="67" font-size="12" fill="#1e40af" text-anchor="middle">Source</text>
    <rect x="183" y="45" width="110" height="36" rx="6" fill="#d1fae5" stroke="#22c55e"/>
    <text x="238" y="67" font-size="12" fill="#166534" text-anchor="middle">Target</text>
    <path d="M160,63 L172,63" fill="none" stroke="#64748b" marker-end="url(#arrow)"/>
  </svg>`);
  expect(has(scanAlt(a), 'label-baseline-off')).toBeUndefined();
});

test('FP-guard: minimal pass fixture — centred node labels and a bare title are NOT baseline-off', () => {
  // "Two step flow" sits directly on the page: the full-canvas page rect is dropped at import,
  // so the title has NO containing box → no candidate. Ingest/Store: baseline 84 in a y=62 h=36
  // box → Δ=0.4, inside the floor. Markup mirrors fixtures/pass/minimal.svg.
  const a = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="272" viewBox="0 0 272 120">
    <defs>
      <marker id="arrow-blue" markerWidth="8" markerHeight="8" refX="2" refY="4" orient="auto" markerUnits="userSpaceOnUse">
        <path d="M0,0 L8,4 L0,8 L2,4 z" fill="#3b82f6"/>
      </marker>
    </defs>
    <rect x="0" y="0" width="272" height="120" fill="#ffffff"/>
    <text x="136" y="32" font-size="16" fill="#1e293b" text-anchor="middle">Two step flow</text>
    <path d="M117,80 L 129,80" fill="none" stroke="#3b82f6" stroke-width="1.5" marker-end="url(#arrow-blue)"/>
    <rect x="22" y="62" width="90" height="36" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
    <text x="67" y="84" font-size="12" fill="#1e40af" text-anchor="middle">Ingest</text>
    <rect x="140" y="62" width="110" height="36" rx="6" fill="#d1fae5" stroke="#22c55e"/>
    <text x="195" y="84" font-size="12" fill="#166534" text-anchor="middle">Store</text>
  </svg>`);
  expect(has(scanAlt(a), 'label-baseline-off')).toBeUndefined();
});

test('FP: bails past the maxNodes cap — dense imports scan no pairs, fire nothing', () => {
  // 402 nodes > maxNodes 400: one baseline-off unit is planted inside, so dropping the cap
  // fires on it. The cap bails BEFORE the O(T×N) containment scan instead.
  const ns = [node('box', 0, 0, 100, 36), line('lbl', 'Ingest', 24, 4, 12)];
  for (let i = 0; i < 400; i++) ns.push(node(`f${i}`, (i % 20) * 60, 200 + Math.floor(i / 20) * 40, 40, 20));
  const r = scanAlt(alt(ns, { w: 1200, h: 1200 }));
  expect(has(r, 'label-baseline-off')).toBeUndefined();
});
