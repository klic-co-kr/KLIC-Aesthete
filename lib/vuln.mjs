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
import { actualArea, actualShapeComplexity, center, backdropIndexFor } from './geometry.mjs';
import { hexToHsl, luminanceFromStyle, luminanceWeight, contrastRatio, relativeLuminance, parseHex, ownColor } from './color.mjs';
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
  'ai-cliche-palette': { share: 0.66, hueLo: 200, hueHi: 300, lMin: 0.15, lMax: 0.85, sMin: 0.35 }, // blue→purple share; l-floor excludes near-black/white neutrals, s-floor excludes slate greys (#374151 is hue ~217 at s≈0.19 — a neutral, not a palette choice)
  'hanging-header': { yOverlap: 0.5, widthRatio: 0.5, minPaired: 1, maxNodes: 80, displayMin: 24, fontRatio: 0.6 }, // tag-left + heading-right two-column; the templated-editorial tell. Guards are tight on purpose — see FP suite in test/vuln.test.mjs.
  'icon-fill-mix': { minIcons: 3, minMixed: 1 },        // filled + outline icons in one set → inconsistent weight; filled icons also read as "selected"
  'all-caps-text': { minLetters: 8, capsShare: 0.9, minNodes: 1 }, // long ALL-CAPS strings force letter-by-letter reading (word shape is lost)
  'pure-black-text': { minNodes: 1, bgLumMin: 0.5 },    // #000 on a light field: max 21:1 → eye strain; near-black is the safer default
  'low-contrast-ui': { ratio: 3, maxWidthShare: 0.5, maxHeightShare: 0.15, maxRepeats: 4 }, // WCAG 1.4.11 non-text contrast — CONTROL-shaped, non-repeated elements only (see FP guards)
};

// Signatures suppressed per artifact type, where the flagged pattern IS the type's intent
// (not a defect). Absent type → no suppression (generic advisory scan keeps everything).
const TYPE_SUPPRESSIONS = {
  dashboard: ['no-focal-point', 'no-spacing-rhythm', 'even-split'], // equal-weight grid is the intent
  diagram: ['no-focal-point', 'even-split', 'hanging-header', 'icon-fill-mix', 'low-contrast-ui'], // multi-node graph, no single focal; left-margin layer labels are legitimate; mixed node glyphs and low-contrast grid/panel chrome are deliberate
  poster: ['all-caps-text'],  // display typography set in caps is the medium's language, not a readability defect
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
      const own = ownColor(n); // text contributes its GLYPH color to the palette, not its backdrop
      const h = own ? hexToHsl(own) : null;
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
  // Icon set consistency (tip: filled vs outline icons read as selected vs not). `filled` must be
  // DECLARED — collision.mjs defaults an undeclared node to filled:true, so inferring it here
  // would manufacture a "mix" the source never had.
  const icons = nodes.filter((n) => n.kind === 'icon' && typeof n.style?.filled === 'boolean');
  // Text carrying its rendered string. `label` is the glyph content for svg/pptx/html imports.
  const texts = nodes.filter((n) => (n.kind === 'text' || TEXT_ROLES.has(n.style?.role)) && typeof n.label === 'string');
  // Painter-stack backdrop per node — the surface an element visually sits on (index or -1).
  const backdrops = nodes.map((_, i) => backdropIndexFor(nodes, i));
  return { nodes, canvas, weights, fontSizes, colored, gaps, icons, texts, backdrops };
}

const TEXT_ROLES = new Set(['heading', 'body', 'caption']);

// cased-letter census — uppercase share is only meaningful for scripts that HAVE case.
// Korean/Japanese/Chinese text has no cased letters at all → never an all-caps finding.
function caseCensus(s) {
  const upper = (s.match(/\p{Lu}/gu) || []).length;
  const lower = (s.match(/\p{Ll}/gu) || []).length;
  const cased = upper + lower;
  return { upper, lower, cased, capsShare: cased > 0 ? upper / cased : 0 };
}

const isPureBlack = (hex) => { const c = parseHex(hex); return !!c && c.r === 0 && c.g === 0 && c.b === 0; };

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
      // only CHROMATIC colors count. Two floors, because either alone lets a neutral through:
      //   l-floor — a dark navy brand color is not the "AI gradient" cliché.
      //   s-floor — Tailwind-style slate greys (#374151 is hue ~217 at s≈0.19, l≈0.27) clear the
      //             l-floor comfortably, and once text contributes its glyph color they made
      //             ordinary grey body copy read as a blue–purple palette.
      const chromatic = ctx.colored.filter((c) => c.l >= t.lMin && c.l <= t.lMax && c.s >= t.sMin);
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
  // ---- screen-UI guideline signatures ---------------------------------------
  // Encoded from logic-driven UI guidelines (Dannaway, *16 little UI design tips*, 2026) and,
  // for the contrast ratios, W3C WCAG 2.1 AA (SC 1.4.3 text / 1.4.11 non-text).
  // MEDIUM SCOPE: these are screen-UI rules. A poster's caps display type and a diagram's
  // low-contrast chrome are intent, not defects — hence TYPE_SUPPRESSIONS above.
  {
    id: 'icon-fill-mix',
    title: 'filled and outline icons mixed in one set',
    severity: 'low',
    needs: ['geometry'],
    detect(ctx, t) {
      if (ctx.icons.length < t.minIcons) return null;
      const filled = ctx.icons.filter((n) => n.style.filled === true);
      const outline = ctx.icons.filter((n) => n.style.filled === false);
      if (!filled.length || !outline.length) return null;
      const minority = filled.length <= outline.length ? filled : outline;
      if (minority.length < t.minMixed) return null;
      return { signal: minority.length, threshold: t.minMixed, nodes: minority.slice(0, 4).map((n) => n.id),
        remediation: `${filled.length} filled + ${outline.length} outline icons in one set — pick ONE treatment (a filled icon reads as "selected", so mixing them signals state that isn't there)` };
    },
  },
  {
    id: 'all-caps-text',
    title: 'long text set in ALL CAPS',
    severity: 'low',
    needs: ['text'],
    detect(ctx, t) {
      // Guard: SHORT caps strings (acronyms, eyebrows, buttons — "API", "NEW", "HERO") are
      // legitimate and everywhere; only sustained caps forces letter-by-letter reading.
      const hits = ctx.texts.filter((n) => {
        if (n.style?.role === 'decor') return false;
        const c = caseCensus(n.label);
        return c.cased >= t.minLetters && c.capsShare >= t.capsShare;
      });
      if (hits.length < t.minNodes) return null;
      return { signal: hits.length, threshold: t.minNodes, nodes: hits.slice(0, 4).map((n) => n.id),
        remediation: 'set it in sentence case — uppercase words share one rectangular shape, so word-shape recognition is lost and each letter is read individually' };
    },
  },
  {
    id: 'pure-black-text',
    title: 'pure black text on a light field',
    severity: 'low',
    needs: ['text'],
    detect(ctx, t) {
      // Only on a LIGHT backdrop: #000 on a dark field is a contrast problem (hierarchy's job),
      // not the eye-strain tell this signature is about.
      const hits = ctx.texts.filter((n) => n.style?.role !== 'decor'
        && isPureBlack(n.style?.color)
        && n.style?.bg && relativeLuminance(n.style.bg) >= t.bgLumMin);
      if (hits.length < t.minNodes) return null;
      return { signal: hits.length, threshold: t.minNodes, nodes: hits.slice(0, 4).map((n) => n.id),
        remediation: 'use a dark grey instead of #000 — 21:1 against white is more brightness difference than the eye wants to hold for body copy' };
    },
  },
  {
    id: 'low-contrast-ui',
    title: 'UI element below 3:1 against its backdrop (WCAG 1.4.11)',
    severity: 'medium',
    needs: ['geometry'],
    detect(ctx, t) {
      // SHAPE GUARD (the FP that would otherwise flood): flat design legitimately stacks a #fff
      // card on a #f9fafb surface, and a #fafafa sidebar on white. The "can't see the element's
      // shape" risk is specific to CONTROLS — icons, buttons, chips — which are BOUNDED IN HEIGHT.
      // Cards, panels and sidebars are tall, so a height share cap separates them.
      // Not an area cap: a 140×44 button on a 390×700 phone canvas is 2.3% of the area, which an
      // area cap tight enough to exclude cards would also exclude.
      const { w: cw, h: chh } = ctx.canvas;
      if (!(cw > 0) || !(chh > 0)) return null;
      // REPETITION GUARD: WCAG 1.4.11 exempts purely decorative graphics. An element repeated many
      // times at identical size AND color is a field/pattern/tile grid, not a control whose shape
      // anyone must perceive. (Empirical: the *--whitespace--severe corpus files fill the canvas
      // with 96 identical #cbd5e1 tiles at 1.7:1.) Cost: a toolbar of >maxRepeats identical
      // low-contrast icons goes unflagged — a false negative traded for a false positive, which is
      // this engine's stated preference.
      // key rounds to 0.1px: a transformed SVG yields 96.0000001 where the source said 96, and an
      // exact-float key would split the tally and silently disable this guard.
      const tileKey = (n) => `${n.bbox.w.toFixed(1)}x${n.bbox.h.toFixed(1)}:${n.style.bg}`;
      const tally = new Map();
      for (const n of ctx.nodes) {
        if (!n.style?.bg || !n.bbox) continue;
        tally.set(tileKey(n), (tally.get(tileKey(n)) || 0) + 1);
      }
      let worst = null;
      for (let i = 0; i < ctx.nodes.length; i++) {
        const n = ctx.nodes[i];
        if (n.kind === 'text' || n.style?.filled === false) continue;
        if (!n.style?.bg) continue;
        if (n.bbox.w / cw > t.maxWidthShare || n.bbox.h / chh > t.maxHeightShare) continue;
        if ((tally.get(tileKey(n)) || 0) > t.maxRepeats) continue;
        const j = ctx.backdrops[i];
        if (j < 0) continue;                                  // no resolvable surface → never guess
        const surface = ctx.nodes[j].style?.bg;
        if (!surface || !parseHex(n.style.bg) || !parseHex(surface)) continue;
        const ratio = contrastRatio(n.style.bg, surface);
        if (ratio >= t.ratio) continue;
        if (!worst || ratio < worst.ratio) worst = { ratio, id: n.id };
      }
      if (!worst) return null;
      return { signal: Number(worst.ratio.toFixed(2)), threshold: t.ratio, nodes: [worst.id],
        remediation: `${worst.ratio.toFixed(1)}:1 against its backdrop — raise it above 3:1 (or give the control a solid field) so people with low vision can see the element's shape, not just its label` };
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
