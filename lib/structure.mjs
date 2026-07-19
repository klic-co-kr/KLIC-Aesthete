#!/usr/bin/env node
// Structural classifier — the post-hoc verifier for preflight's `structure` pick.
//
// preflight emits a structural prior (evidence-grid / bento / hero-led / ...) as a generation
// HINT. Without this module that hint is unverifiable — a hole in the "generation goal =
// acceptance check" thesis (the structural axis had no post-hoc check, unlike the contract's
// geometric thresholds). This module closes it (partially, honestly): each structure has a
// GEOMETRIC SIGNATURE —
// thresholds on measurable ALT quantities (node count, area spread, column/row clustering,
// top-node dominance, free ratio). classifyStructure(alt) detects the shape deterministically;
// verifyStructure(alt, expectedId) checks a generated layout against the requested shape.
//
// Honest scope: signatures verify the GEOMETRIC ESSENCE of a shape, not a full template match.
// When no signature clearly holds, the classifier returns 'unknown' with the raw metrics rather
// than forcing a wrong label (coverage/score separation, same discipline as measure/vuln).
// Deterministic: no random/Date.

import path from 'node:path';
import { actualArea } from './geometry.mjs';
import { buildQuadtree, freeArea } from './quadtree.mjs';
import { readJson, writeJson, parseArgs, isMain } from './shared/cli.mjs';
import { validate } from './shared/validator.mjs';
import { importPath, detectDomain } from './adapters/index.mjs';

// ---- per-type structural priors (shape text) --------------------------------
// Owned here so the shape catalog + its verification signatures live together. preflight imports
// STRUCTURES; the `signature` is evaluated by classifyStructure/verifyStructure below.
// SHAPE ONLY — no opinionated style/theme (measure-neutrality preserved).

const GENERIC_STRUCTURES = [
  { id: 'unspecified', shape: 'no type profile — pick a shape and commit (do not default to the statistical mode)' },
];

const STRUCTURES = {
  dashboard: [
    { id: 'evidence-grid', shape: 'uniform KPI/stat grid — equal cells, one metric each (equal-weight by intent: no imposed focal — overrides the profile focal hint); scan order left→right, top→bottom' },
    { id: 'bento', shape: 'irregular bento — mixed cell sizes, one hero cell anchors, the rest support' },
    { id: 'split-pane', shape: 'master-detail — filter/list rail on the left, focal panel on the right' },
  ],
  marketing: [
    { id: 'hero-led', shape: 'single hero focal above the fold → supporting sections below in descending weight' },
    { id: 'stat-led', shape: 'one proof number dominates → context and detail follow it' },
    { id: 'manifesto', shape: 'declarative long-form — large statement type, sparse structure, conviction over features' },
  ],
  report: [
    { id: 'long-document', shape: 'scannable document — heading hierarchy, one claim per section, evidence inline' },
    { id: 'stat-led', shape: 'one headline metric per slide → supporting breakdown beneath' },
    { id: 'exec-summary', shape: 'TL;DR band at the top → detail sections below' },
  ],
  diagram: [
    { id: 'flow-graph', shape: 'directed left→right or top→bottom flow; edges encode sequence' },
    { id: 'layered', shape: 'horizontal tiers — proximity within a layer, edges between layers' },
    { id: 'radial', shape: 'central hub → satellites; hub-and-spoke' },
  ],
  poster: [
    { id: 'signature-hero', shape: 'one signature display decision fills the frame — type or image, nothing competes' },
    { id: 'manifesto-split', shape: 'asymmetric two-field split — statement vs field; tension is intentional' },
    { id: 'type-forward', shape: 'typography IS the poster — scale and weight carry everything, no image' },
  ],
};

// ---- measurable structural signals ------------------------------------------

function clusterCount(sortedVals, gap) {
  if (!sortedVals.length) return 0;
  let clusters = 1;
  for (let i = 1; i < sortedVals.length; i++) {
    if (sortedVals[i] - sortedVals[i - 1] > gap) clusters++;
  }
  return clusters;
}

// Group sibling nodes that share a `category` (a card's box + its label) into one unit via union
// bbox, so a 2×2 card grid reads as 4 units / 2 cols / 2 rows — not 8 nodes / 4 rows. Falls back
// to raw nodes when no category is declared (SVG/PPTX imports). Pure; does not mutate input.
function groupNodes(nodes) {
  const hasCat = nodes.some((n) => n.category != null);
  if (!hasCat) return nodes;
  const groups = new Map();
  for (const n of nodes) {
    const k = n.category ?? n.id;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(n);
  }
  const out = [];
  for (const [cat, mem] of groups) {
    const xs = mem.map((m) => m.bbox.x);
    const ys = mem.map((m) => m.bbox.y);
    const x2 = mem.map((m) => m.bbox.x + m.bbox.w);
    const y2 = mem.map((m) => m.bbox.y + m.bbox.h);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    out.push({ id: cat, category: cat, kind: 'group', bbox: { x, y, w: Math.max(...x2) - x, h: Math.max(...y2) - y }, style: mem[0].style });
  }
  return out;
}

export function structuralMetrics(alt) {
  const all = groupNodes((alt.nodes || []).filter((n) => n && n.bbox));
  const canvas = alt.meta?.canvas || { w: 0, h: 0 };
  const n = all.length;
  if (n === 0) return { n: 0, canvas };
  const areas = all.map((nd) => Math.max(1, nd.bbox.w * nd.bbox.h));
  const totalArea = areas.reduce((a, b) => a + b, 0);
  const meanArea = totalArea / n;
  const areaCV = meanArea > 0 ? Math.sqrt(areas.reduce((s, a) => s + (a - meanArea) ** 2, 0) / n) / meanArea : 0;
  const maxArea = Math.max(...areas);
  const topDominance = totalArea > 0 ? maxArea / totalArea : 0;
  const topIdx = areas.indexOf(maxArea);
  const top = all[topIdx];
  const topYRatio = canvas.h > 0 ? (top.bbox.y + top.bbox.h / 2) / canvas.h : 0.5;

  const xgap = Math.max(1, canvas.w * 0.08);
  const ygap = Math.max(1, canvas.h * 0.08);
  const byX = [...all].sort((a, b) => (a.bbox.x + a.bbox.w / 2) - (b.bbox.x + b.bbox.w / 2));
  const colAssign = new Array(byX.length);
  colAssign[0] = 0;
  for (let i = 1; i < byX.length; i++) {
    const g = (byX[i].bbox.x + byX[i].bbox.w / 2) - (byX[i - 1].bbox.x + byX[i - 1].bbox.w / 2);
    colAssign[i] = g > xgap ? colAssign[i - 1] + 1 : colAssign[i - 1];
  }
  const cols = colAssign[colAssign.length - 1] + 1;
  const colW = new Array(cols).fill(0);
  byX.forEach((nd, i) => { colW[colAssign[i]] += nd.bbox.w; });
  colW.sort((a, b) => a - b);
  const colWidthRatio = cols >= 2 && colW[cols - 1] > 0 ? colW[0] / colW[cols - 1] : 1;
  const cys = all.map((nd) => nd.bbox.y + nd.bbox.h / 2).sort((a, b) => a - b);
  const rows = clusterCount(cys, ygap);

  // freeRatio via occupancy quadtree (same source as the whitespace skill)
  let freeRatio = null;
  try {
    const boxes = all.map((nd) => nd.bbox);
    const qt = buildQuadtree(canvas, boxes);
    freeRatio = canvas.w && canvas.h ? freeArea(qt, boxes) / (canvas.w * canvas.h) : null;
  } catch { freeRatio = null; }

  return { n, areaCV: Number(areaCV.toFixed(3)), topDominance: Number(topDominance.toFixed(3)),
    cols, rows, colWidthRatio: Number(colWidthRatio.toFixed(3)), topYRatio: Number(topYRatio.toFixed(3)),
    freeRatio: freeRatio == null ? null : Number(freeRatio.toFixed(3)), canvas };
}

// ---- signatures: each structure's geometric essence (predicates on metrics) --
// Conservative on purpose — a structure only "matches" when its essence clearly holds. Returns
// null when the metric is unmeasurable (n=0) so the classifier falls through to 'unknown'.
const SIGNATURES = {
  'evidence-grid': (m) => m.n >= 4 && m.areaCV < 0.4 && m.cols >= 2 && m.rows >= 2,
  'bento': (m) => m.n >= 4 && m.areaCV > 0.45 && m.topDominance > 0.2 && m.cols >= 2 && m.rows >= 2,
  'split-pane': (m) => m.cols === 2 && m.colWidthRatio < 0.45 && m.n >= 3,
  'hero-led': (m) => m.topDominance > 0.3 && m.topYRatio < 0.55 && m.n >= 3,
  'stat-led': (m) => m.topDominance > 0.4,
  'manifesto': (m) => m.n <= 5 && m.freeRatio != null && m.freeRatio > 0.5,
  'long-document': (m) => m.rows >= 4 && m.cols <= 2,
  'exec-summary': (m) => m.topDominance > 0.25 && m.topYRatio < 0.35 && m.rows >= 2,
  'layered': (m) => m.rows >= 3 && m.cols >= 2,
  'flow-graph': (m) => m.n >= 4 && (m.rows >= 3 || m.cols >= 3) && m.topDominance < 0.25,
  'radial': (m) => m.n >= 4 && m.topDominance < 0.3 && m.cols >= 3 && m.rows >= 3, // weak proxy; radial is hard without edges
  'signature-hero': (m) => m.topDominance > 0.55,
  'manifesto-split': (m) => m.cols === 2 && m.topDominance < 0.55 && m.n <= 6,
  'type-forward': (m) => m.n <= 4 && m.topDominance < 0.5,
};

// ---- classify / verify -------------------------------------------------------

// Detect the structure of an ALT. If `type` is given, only that type's structures are candidates;
// otherwise every known structure is a candidate (generic scan). Returns the best clear match, or
// {id:'unknown'} with the metrics — never forces a label it can't defend.
export function classifyStructure(alt, type) {
  const m = structuralMetrics(alt);
  if (m.n === 0) return { id: 'unknown', confidence: 'none', reason: 'no content nodes', metrics: m };
  const candidates = type && STRUCTURES[type]
    ? STRUCTURES[type].map((s) => s.id)
    : Object.keys(SIGNATURES);
  const matched = candidates.filter((id) => SIGNATURES[id] && SIGNATURES[id](m));
  if (matched.length === 0) return { id: 'unknown', confidence: 'none', reason: 'no signature clearly held', metrics: m, candidates };
  // disambiguate: prefer the MORE SPECIFIC match (longer predicate / stronger signal). Specificity
  // is approximated by a hand-set priority — signatures with more discriminative predicates first.
  const PRIORITY = ['signature-hero', 'split-pane', 'bento', 'evidence-grid', 'hero-led', 'exec-summary', 'stat-led', 'long-document', 'layered', 'flow-graph', 'radial', 'manifesto-split', 'type-forward', 'manifesto'];
  const ranked = matched.sort((a, b) => PRIORITY.indexOf(a) - PRIORITY.indexOf(b));
  const id = ranked[0];
  return { id, confidence: matched.length === 1 ? 'high' : 'medium', matched, metrics: m };
}

// Does the generated layout satisfy the structure preflight asked for? pass = the requested
// structure's signature holds; fail = it does not; unknown = no signature for that id / no nodes.
export function verifyStructure(alt, expectedId) {
  const m = structuralMetrics(alt);
  if (m.n === 0) return { verdict: 'unknown', reason: 'no content nodes', metrics: m };
  const sig = SIGNATURES[expectedId];
  if (!sig) return { verdict: 'unknown', reason: `no geometric signature for '${expectedId}'`, metrics: m };
  const holds = sig(m);
  return { verdict: holds ? 'pass' : 'fail', expected: expectedId, metrics: m };
}

// ---- brief → structure inference (the brief-fit step that runs BEFORE diversification) ----
// Diversification rotates the pick to vary output, but forced variety on a brief that CLEARLY
// signals a shape degrades quality (the FP flagged in the adversarial review). So the pick
// precedence is: brief signal > diversify rotation > index 0. A signal only fires when its
// target structure exists for the artifact_type (type-scoping prevents cross-type false triggers
// — "flow" in a dashboard brief can't pull in flow-graph, which isn't a dashboard shape).
// First matching signal wins; deterministic.
const SIGNALS = {
  dashboard: [
    ['bento', 'bento'], ['다양한 크기', 'bento'], ['irregular', 'bento'], ['혼합', 'bento'],
    ['filter', 'split-pane'], ['rail', 'split-pane'], ['master', 'split-pane'], ['사이드', 'split-pane'], ['목록', 'split-pane'], ['detail', 'split-pane'],
    // default dashboard = evidence-grid (no signal required)
  ],
  marketing: [
    ['manifesto', 'manifesto'], ['선언', 'manifesto'], ['declaration', 'manifesto'], ['신념', 'manifesto'], ['long-form', 'manifesto'],
    ['stat', 'stat-led'], ['number', 'stat-led'], ['proof', 'stat-led'], ['지표', 'stat-led'], ['숫자', 'stat-led'], ['증명', 'stat-led'], ['metric', 'stat-led'],
    // default marketing = hero-led
  ],
  report: [
    ['summary', 'exec-summary'], ['요약', 'exec-summary'], ['tl;dr', 'exec-summary'], ['exec', 'exec-summary'],
    ['document', 'long-document'], ['문서', 'long-document'], ['long', 'long-document'], ['scan', 'long-document'], ['흐름', 'long-document'],
    ['stat', 'stat-led'], ['metric', 'stat-led'], ['지표', 'stat-led'], ['headline', 'stat-led'],
  ],
  diagram: [
    ['flow', 'flow-graph'], ['플로우', 'flow-graph'], ['sequence', 'flow-graph'], ['시퀀스', 'flow-graph'], ['process', 'flow-graph'], ['순서', 'flow-graph'],
    ['layer', 'layered'], ['계층', 'layered'], ['tier', 'layered'], ['arch', 'layered'], ['아키텍처', 'layered'], ['스택', 'layered'], ['stack', 'layered'],
    ['radial', 'radial'], ['방사', 'radial'], ['hub', 'radial'], ['spoke', 'radial'], ['중심', 'radial'],
  ],
  poster: [
    ['split', 'manifesto-split'], ['분할', 'manifesto-split'], ['statement', 'manifesto-split'], ['선언', 'manifesto-split'], ['대비', 'manifesto-split'],
    ['type', 'type-forward'], ['타이포', 'type-forward'], ['typography', 'type-forward'], ['글씨', 'type-forward'], ['서체', 'type-forward'],
    // default poster = signature-hero
  ],
};

// Map a brief's intent text to a structure id for the type, or null when no signal fires.
export function inferStructure(brief, type) {
  const text = String(brief?.brief || '').toLowerCase();
  if (!text) return null;
  const signals = SIGNALS[type];
  if (!signals) return null;
  const valid = new Set((STRUCTURES[type] || []).map((s) => s.id));
  for (const [kw, id] of signals) {
    if (text.includes(kw) && valid.has(id)) return id;
  }
  return null;
}

export { STRUCTURES, GENERIC_STRUCTURES };

// ---- CLI: bun lib/structure.mjs classify <alt> [type] | verify <alt> <structureId> ----
// Closes the preflight → generate → verify loop as an explicit command sequence:
//   1. preflight brief.json --contract c.json        (goal: structure + contract)
//   2. <generate the layout>
//   3. structure verify layout.alt <structure-id>     (did the layout match the requested shape?)
//   4. fix layout --contract c.json                   (geometric acceptance)
// classify prints the detected shape + metrics; verify prints pass/fail and exits 1 on fail
// (so it can gate CI — an unknown signature exits 0, since "can't verify" is not "wrong").
async function main() {
  const { positional } = parseArgs(process.argv.slice(2));
  const cmd = positional[0];

  const loadAlt = (p) => {
    const domain = detectDomain(p);
    const alt = domain === 'alt' ? readJson(p) : importPath(p, { domain });
    return alt;
  };

  if (cmd === 'classify') {
    const inputPath = positional[1];
    const type = positional[2];
    if (!inputPath) { console.error('usage: bun lib/structure.mjs classify <alt|svg|pptx|html> [type]'); process.exit(2); }
    const alt = loadAlt(inputPath);
    await validate('alt', alt);
    const result = classifyStructure(alt, type || undefined);
    const base = path.basename(inputPath, path.extname(inputPath));
    const outPath = path.join(process.cwd(), `${base}.structure.json`);
    writeJson(outPath, result);
    const m = result.metrics || {};
    console.log(`structure: ${result.id} (${result.confidence})${result.matched ? ` [matched: ${result.matched.join(',')}]` : ''}${type ? ` type=${type}` : ' (generic)'} | n=${m.n ?? '-'} cols=${m.cols ?? '-'} rows=${m.rows ?? '-'} areaCV=${m.areaCV ?? '-'} dom=${m.topDominance ?? '-'} | ${outPath}`);
    return;
  }

  if (cmd === 'verify') {
    const inputPath = positional[1];
    const expectedId = positional[2];
    if (!inputPath || !expectedId) { console.error('usage: bun lib/structure.mjs verify <alt|svg|pptx|html> <structureId>'); process.exit(2); }
    const alt = loadAlt(inputPath);
    await validate('alt', alt);
    const result = verifyStructure(alt, expectedId);
    const m = result.metrics || {};
    console.log(`verify ${expectedId}: ${result.verdict.toUpperCase()} | n=${m.n ?? '-'} cols=${m.cols ?? '-'} rows=${m.rows ?? '-'} areaCV=${m.areaCV ?? '-'} dom=${m.topDominance ?? '-'}`);
    if (result.verdict === 'fail') process.exit(1);
    return;
  }

  console.error('usage: bun lib/structure.mjs classify <alt> [type] | verify <alt> <structureId>');
  process.exit(2);
}

if (isMain(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
