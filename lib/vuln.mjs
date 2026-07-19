#!/usr/bin/env node
// Vulnerability engine — deterministic detector of KNOWN-BAD design patterns.
//
// The 9 measurement skills score continua (how balanced?). This engine flags discrete
// vulnerability signatures: the clichés polanyi-design calls "negation > assertion" and the
// gestalt "looks like a template" diagnostic. Where measure asks "how good is X?", vuln asks
// "is X definitely weak?" — grounded in measured evidence + a suggestionOnly remediation.
//
// REALISTIC-GUARDRAILS (learned the hard way — automated smell detection's #1 failure is high
// false-positive rate, and a deterministic wrong answer is still wrong):
//   1. CONTEXT-AWARE. polanyi's negation is a GENERATION heuristic; applying it blind as an
//      evaluation gate flags legitimate designs (a dashboard's equal KPI grid is correct, not a
//      "no focal" defect). scanAlt(alt, { artifact_type }) suppresses signatures that contradict
//      the type's intent. Suppressed signatures are listed, not hidden.
//   2. CONFIGURABLE THRESHOLDS. Hardcoded cutoffs are the top FP driver in smell detection;
//      every threshold is overridable via opts.thresholds, conservative defaults.
//   3. ADVISORY. Findings are advisory direction, never a gate — the report carries advisory=true
//      and severity means "look here", not "broken". No signature fires on a neutral color.
//
// Runs read-only under the 'measure-only' execution profile. Deterministic (no random/Date).

import path from 'node:path';
import { readJson, writeJson, parseArgs, isMain } from './shared/cli.mjs';
import { validate } from './shared/validator.mjs';
import { importPath, detectDomain } from './adapters/index.mjs';
import { actualArea, actualShapeComplexity, center } from './geometry.mjs';
import { hexToHsl, luminanceFromStyle, luminanceWeight } from './color.mjs';
import { assertAllowed } from './profiles.mjs';

const SAT = 0.08; // saturation floor for "has color" (matches lib/skills/similarity.mjs)
const fin = (v, f = 0) => (Number.isFinite(v) ? v : f);

// Conservative default thresholds — every one is overridable via opts.thresholds[id].
const DEFAULT_THRESHOLDS = {
  'no-focal-point': { dominance: 0.34 },      // top node's share of total optical weight below this → no focal
  'no-spacing-rhythm': { cv: 0.06 },          // gap coefficient-of-variation below this → no rhythm (identical gaps)
  'type-scale-accident': { sizes: 5 },        // more distinct font sizes than this → accidents
  'rainbow-categorical': { hueBands: 5, groups: 3 }, // >hueBands across ≥groups categorical hues → rainbow
  'even-split': { band: 0.48 },               // minor/total within [band, 1-band] → indecisive even split
  'ai-cliche-palette': { share: 0.66, hueLo: 200, hueHi: 300, lMin: 0.15, lMax: 0.85 }, // blue→purple share; l-floor excludes near-black/white neutrals
  'hanging-header': { yOverlap: 0.5, widthRatio: 0.5, minPaired: 1, maxNodes: 80, displayMin: 24, fontRatio: 0.6 }, // tag-left + heading-right two-column; the templated-editorial tell. Guards are tight on purpose — see FP suite in test/vuln.test.mjs.
};

// Signatures suppressed per artifact type, where the flagged pattern IS the type's intent
// (not a defect). Absent type → no suppression (generic advisory scan keeps everything).
const TYPE_SUPPRESSIONS = {
  dashboard: ['no-focal-point', 'no-spacing-rhythm', 'even-split'], // equal-weight grid is the intent
  diagram: ['no-focal-point', 'even-split', 'hanging-header'],      // multi-node graph, no single focal; left-margin layer labels are legitimate
};

// ---- shared scan context (computed once) -----------------------------------
function scanContext(alt) {
  const nodes = (alt.nodes || []).filter((n) => n && n.bbox);
  const canvas = alt.meta?.canvas || { w: 0, h: 0 };
  const weights = nodes.map((n) => {
    const a = actualArea(n);
    const c = luminanceWeight(luminanceFromStyle(n.style)) * (n.style?.opacity ?? 1);
    const s = actualShapeComplexity(n);
    return fin(a) * fin(c) * fin(s);
  });
  const fontSizes = [...new Set(nodes.map((n) => n.style?.fontSize).filter((v) => Number.isFinite(v) && v > 0))];
  const colored = nodes
    .map((n) => {
      const h = n.style?.bg ? hexToHsl(n.style.bg) : null;
      return h && h.s >= SAT ? { node: n, h: h.h, s: h.s, l: h.l } : null;
    })
    .filter(Boolean);
  const gaps = [];
  for (let i = 0; i < nodes.length; i++) {
    let nn = Infinity;
    const [ax, ay] = center(nodes[i].bbox);
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const [bx, by] = center(nodes[j].bbox);
      const d = Math.hypot(ax - bx, ay - by);
      if (d < nn) nn = d;
    }
    if (Number.isFinite(nn)) gaps.push(nn);
  }
  return { nodes, canvas, weights, fontSizes, colored, gaps };
}

const SIGNATURES = [
  {
    id: 'no-focal-point',
    title: 'no dominant focal element (figure-ground failure)',
    severity: 'high',
    needs: ['geometry'],
    detect(ctx, t) {
      if (ctx.nodes.length < 3) return null;
      const total = ctx.weights.reduce((a, b) => a + b, 0);
      if (total <= 0) return null;
      const maxIdx = ctx.weights.indexOf(Math.max(...ctx.weights));
      const dominance = ctx.weights[maxIdx] / total;
      if (dominance > t.dominance) return null;
      return { signal: Number(dominance.toFixed(3)), threshold: t.dominance, nodes: [ctx.nodes[maxIdx].id],
        remediation: 'establish ONE focal element — concentrate size/weight/contrast so a single node dominates (squint test: one thing survives)' };
    },
  },
  {
    id: 'no-spacing-rhythm',
    title: 'identical spacing everywhere (no rhythm scale)',
    severity: 'medium',
    needs: ['geometry'],
    detect(ctx, t) {
      if (ctx.gaps.length < 3) return null;
      const mean = ctx.gaps.reduce((a, b) => a + b, 0) / ctx.gaps.length;
      if (mean <= 0) return null;
      const cv = Math.sqrt(ctx.gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / ctx.gaps.length) / mean;
      if (cv > t.cv) return null;
      return { signal: Number(cv.toFixed(3)), threshold: t.cv, nodes: ctx.nodes.slice(0, 4).map((n) => n.id),
        remediation: 'commit a spacing scale — identical gaps read as a template; vary deliberately on a base (e.g. 4/8/16/24)' };
    },
  },
  {
    id: 'type-scale-accident',
    title: 'too many type sizes (accidents, not a system)',
    severity: 'medium',
    needs: ['text'],
    detect(ctx, t) {
      if (ctx.fontSizes.length <= t.sizes) return null;
      return { signal: ctx.fontSizes.length, threshold: t.sizes, nodes: [],
        remediation: `reduce to ≤${t.sizes} distinct font sizes (currently ${ctx.fontSizes.length}); beyond that it is accidents, not a type system` };
    },
  },
  {
    id: 'rainbow-categorical',
    title: 'rainbow palette across categorical groups',
    severity: 'medium',
    needs: ['color'],
    detect(ctx, t) {
      const byCat = new Map();
      for (const c of ctx.colored) {
        const cat = c.node.category || '';
        if (!byCat.has(cat)) byCat.set(cat, new Set());
        byCat.get(cat).add(Math.round(c.h / 30)); // 12 hue bands
      }
      const cats = [...byCat.values()].filter((s) => s.size > 0);
      if (cats.length < t.groups) return null;
      const totalHueBands = new Set();
      for (const s of cats) for (const h of s) totalHueBands.add(h);
      if (totalHueBands.size <= t.hueBands) return null;
      return { signal: totalHueBands.size, threshold: t.hueBands, nodes: ctx.colored.slice(0, 4).map((c) => c.node.id),
        remediation: `${totalHueBands.size} distinct hue bands across ${cats.length} categories — use a bounded categorical palette, not a spectrum` };
    },
  },
  {
    id: 'even-split',
    title: 'near-50/50 content split reads indecisive',
    severity: 'low',
    needs: ['geometry'],
    detect(ctx, t) {
      const { w: cw, h: ch } = ctx.canvas;
      if (!cw || !ch || ctx.nodes.length < 2) return null;
      let L = 0; let R = 0; let T = 0; let B = 0;
      for (const n of ctx.nodes) {
        const wt = actualArea(n) || 1;
        const cx = n.bbox.x + n.bbox.w / 2;
        const cy = n.bbox.y + n.bbox.h / 2;
        if (cx < cw / 2) L += wt; else R += wt;
        if (cy < ch / 2) T += wt; else B += wt;
      }
      const minor = (a, b) => { const s = a + b; return s > 0 ? Math.min(a, b) / s : 1; };
      const lr = minor(L, R); const tb = minor(T, B);
      if (lr >= t.band && lr <= 1 - t.band) return { signal: Number(lr.toFixed(3)), threshold: t.band, axis: 'left/right', nodes: [], remediation: 'left/right content ≈ 50/50 — commit an asymmetry (60/40) or a clear focal side' };
      if (tb >= t.band && tb <= 1 - t.band) return { signal: Number(tb.toFixed(3)), threshold: t.band, axis: 'top/bottom', nodes: [], remediation: 'top/bottom content ≈ 50/50 — commit an asymmetry' };
      return null;
    },
  },
  {
    id: 'ai-cliche-palette',
    title: 'default “AI” blue→purple palette',
    severity: 'low',
    needs: ['color'],
    detect(ctx, t) {
      // only CHROMATIC colors count (l-floor excludes near-black/near-white neutrals — a dark
      // navy brand color is not the "AI gradient" cliché).
      const chromatic = ctx.colored.filter((c) => c.l >= t.lMin && c.l <= t.lMax);
      if (chromatic.length < 3) return null;
      const cliche = chromatic.filter((c) => c.h >= t.hueLo && c.h <= t.hueHi).length;
      const share = cliche / chromatic.length;
      if (share < t.share) return null;
      return { signal: Number(share.toFixed(3)), threshold: t.share, nodes: chromatic.slice(0, 4).map((c) => c.node.id),
        remediation: `${Math.round(share * 100)}% of chromatic color sits in the blue–purple band — the default “AI” look; pick a distinctive hue relationship` };
    },
  },
  {
    id: 'hanging-header',
    title: 'hanging header / left-margin label (templated-editorial tell)',
    severity: 'medium',
    needs: ['text'],
    detect(ctx, t) {
      // GUARDS (each tied to a real FP the empirical probe surfaced — see FP suite in
      // test/vuln.test.mjs; a deterministic wrong answer is still wrong):
      //   maxNodes   — dense imports (real SVGs carry thousands of nodes) both blow up the O(n²)
      //                scan AND fire on nonsense pairs; bail past the cap (no finding).
      //   fontSize on BOTH — kills icon↔body and box↔box false matches (icons/containers carry
      //                no fontSize); restricts to genuine text↔text pairs.
      //   displayMin + fontRatio — the HEADING must be display-scale and the LABEL much smaller.
      //                This is the eyebrow + section-heading cliché, NOT a form label beside an
      //                input or a key/value table row (whose value isn't display-scale).
      if (ctx.nodes.length > t.maxNodes) return null;
      const ns = ctx.nodes;
      const pairs = [];
      for (let i = 0; i < ns.length; i++) {
        const a = ns[i];
        const aFs = Number(a.style?.fontSize);
        if (!a.bbox || !Number.isFinite(aFs)) continue;          // label must be real text
        for (let j = 0; j < ns.length; j++) {
          if (i === j) continue;
          const b = ns[j];
          const bFs = Number(b.style?.fontSize);
          if (!b.bbox || !Number.isFinite(bFs)) continue;        // heading must be real text
          if (bFs < t.displayMin) continue;                       // heading must be display-scale
          if (aFs > bFs * t.fontRatio) continue;                  // label much smaller than heading
          const yO = Math.min(a.bbox.y + a.bbox.h, b.bbox.y + b.bbox.h) - Math.max(a.bbox.y, b.bbox.y);
          const minH = Math.min(a.bbox.h, b.bbox.h);
          if (minH <= 0 || yO / minH < t.yOverlap) continue;      // same row band
          if (a.bbox.x + a.bbox.w > b.bbox.x) continue;           // a fully left of b
          if (a.bbox.w >= b.bbox.w * t.widthRatio) continue;      // a is a margin label, b the heading
          pairs.push([a.id, b.id]);
          break; // one heading per label is enough
        }
      }
      if (pairs.length < t.minPaired) return null;
      return { signal: pairs.length, threshold: t.minPaired, nodes: pairs.flat(),
        remediation: 'stack the label ABOVE the heading in the same column — the tag-left + heading-right hanging header is the single most reliable templated-editorial tell' };
    },
  },
];

// ---- scan -------------------------------------------------------------------
export function scanAlt(alt, opts = {}) {
  assertAllowed('measure-only', 'vuln-scan'); // governance: vuln is read-only, lives in measure-only profile
  const ctx = scanContext(alt);
  const hasText = ctx.fontSizes.length > 0;
  const hasColor = ctx.colored.length > 0;
  // deep-merge per signature so a PARTIAL threshold override (e.g. {share:0.5}) keeps the
  // other defaults (hueLo/lMin/…) — a shallow merge would leave them undefined and silently
  // kill the signature via NaN comparisons.
  const overrides = opts.thresholds || {};
  const thresholds = {};
  for (const id of Object.keys(DEFAULT_THRESHOLDS)) {
    thresholds[id] = { ...DEFAULT_THRESHOLDS[id], ...(overrides[id] || {}) };
  }
  const artifactType = opts.artifact_type || null;
  const suppressedByContext = artifactType ? (TYPE_SUPPRESSIONS[artifactType] || []) : [];

  const vulnerabilities = [];
  const suppressed = [];
  for (const sig of SIGNATURES) {
    const measurable = sig.needs.every((need) => (need === 'text' ? hasText : need === 'color' ? hasColor : true));
    if (!measurable) continue; // §12 coverage: required input absent → skip (never fake a finding)
    if (suppressedByContext.includes(sig.id)) {
      suppressed.push({ id: sig.id, reason: `inappropriate for artifact_type '${artifactType}' (pattern is intended)` });
      continue; // context guard: don't flag a type's intended pattern
    }
    let hit;
    try { hit = sig.detect(ctx, thresholds[sig.id]); } catch { continue; }
    if (!hit) continue;
    vulnerabilities.push({
      id: sig.id,
      title: sig.title,
      severity: sig.severity,
      signal: hit.signal,
      threshold: hit.threshold,
      ...(hit.axis ? { axis: hit.axis } : {}),
      nodes: hit.nodes || [],
      remediation: hit.remediation,
      mode: 'suggestionOnly', // design-direction findings: the geometry fixer cannot apply these
    });
  }
  const bySeverity = { high: 0, medium: 0, low: 0 };
  for (const v of vulnerabilities) bySeverity[v.severity] = (bySeverity[v.severity] || 0) + 1;
  return {
    schema_version: 1,
    summary: {
      vulnCount: vulnerabilities.length,
      bySeverity,
      coverage: {
        geometry: ctx.nodes.length >= 2 ? 'measured' : 'unmeasurable',
        text: hasText ? 'measured' : 'unmeasurable',
        color: hasColor ? 'measured' : 'unmeasurable',
      },
      artifact_type: artifactType,
      suppressed, // transparent: which signatures were skipped, and why
      advisory: true, // this report is advisory direction, NOT a gate
      profile: 'measure-only',
    },
    vulnerabilities,
  };
}

// ---- CLI: bun lib/vuln.mjs <layout> [vuln-report.json] [--type T] -----------
async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const inputPath = positional[0];
  if (!inputPath) {
    console.error('usage: bun lib/vuln.mjs <layout-or-domain> [vuln-report.json] [--type dashboard|marketing|report|diagram|poster]');
    process.exit(2);
  }
  const domain = detectDomain(inputPath);
  const alt = domain === 'alt' ? readJson(inputPath) : importPath(inputPath, { domain });
  await validate('alt', alt);

  const artifactType = typeof flags.type === 'string' ? flags.type : undefined;
  const report = scanAlt(alt, { artifact_type: artifactType });
  await validate('vuln-report', report);

  const base = path.basename(inputPath, path.extname(inputPath));
  const outPath = positional[1] || path.join(process.cwd(), `${base}.vuln.json`);
  writeJson(outPath, report);
  const b = report.summary.bySeverity;
  const c = report.summary.coverage;
  const sup = report.summary.suppressed.length ? ` | -${report.summary.suppressed.length} suppressed(${artifactType})` : '';
  console.log(`${report.summary.vulnCount} vuln(s) | high ${b.high} med ${b.medium} low ${b.low}${sup} | coverage geom/${c.geometry === 'measured' ? '✓' : '·'} text/${c.text === 'measured' ? '✓' : '·'} color/${c.color === 'measured' ? '✓' : '·'} | advisory | ${outPath}`);
}

if (isMain(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
