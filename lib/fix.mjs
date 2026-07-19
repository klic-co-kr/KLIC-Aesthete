#!/usr/bin/env node
// Closed-loop fixer: measure → graph-resolve → deterministic patches → re-measure,
// guarded against oscillation (monotonic-improvement gate, per-node drift freeze,
// conflict arbitration). Returns the BEST snapshot seen, never NaN, never throws on
// bad input. CLI: node fix.mjs <layout-or-domain> [--contract c.json] [--max-iters N]

import path from 'node:path';
import fs from 'node:fs';
import { importPath, exportAlt, detectDomain } from './adapters/index.mjs';
import { measureAlt } from './measure.mjs';
import { evaluate } from './contract.mjs';
import { orderViolations, weightOf, compensationFactor } from './graph.mjs';
import { readJson, writeJson, parseArgs, skillRoot, isMain } from './shared/cli.mjs';
import { validate } from './shared/validator.mjs';
import { clampToCanvas, center, rectsOverlap, overlapDepth, area, shapeComplexity } from './geometry.mjs';
import { contentBounds } from './quadtree.mjs';
import { luminanceWeight, luminanceFromStyle } from './color.mjs';
import { isAllowed } from './profiles.mjs';

const SEV = { high: 1, medium: 0.5, low: 0.25 };
// Documented outcome enum (DESIGN §6, README). Enforced at the CLI boundary so a future
// code path can't silently emit an out-of-enum value (the neural gate once produced
// 'best-effort(neural)'). finalize() and applyNeuralGate() only emit these.
const OUTCOMES = new Set(['pass', 'best-effort', 'no-improvement', 'budget-exhausted']);
const DRIFT_LIMIT_MULT = 1.5;   // freeze a node after it drifts > 1.5× its width
// separation gap is canvas-relative so the fixer works at icon scale (24px) AND layout scale (1000px)
const sepGap = (canvas) => Math.max(0.5, 0.02 * Math.min(canvas.w, canvas.h));

// ---- helpers ----

function collectViolations(report) {
  const out = [];
  for (const [skill, sk] of Object.entries(report.skills || {})) {
    for (const v of (sk.violations || [])) out.push({ skill, ...v });
  }
  return out;
}
function totalCost(viols) {
  let s = 0;
  for (const v of viols) s += (SEV[v.severity] ?? 0.5) * weightOf(v.skill);
  return s;
}
function clone(alt) { return JSON.parse(JSON.stringify(alt)); }
function nodeMap(alt) { return new Map(alt.nodes.map((n) => [n.id, n])); }

function recordMove(ctx, n, oldB) {
  const dx = (n.bbox.x + n.bbox.w / 2) - (oldB.x + oldB.w / 2);
  const dy = (n.bbox.y + n.bbox.h / 2) - (oldB.y + oldB.h / 2);
  ctx.moveAccum[n.id] = (ctx.moveAccum[n.id] || 0) + Math.hypot(dx, dy);
  // drift limit is canvas-relative so a far outlier can legitimately be pulled back into
  // its cluster; the monotonic gate (not this) is the primary oscillation guard.
  const canvasDiag = ctx.canvas ? Math.hypot(ctx.canvas.w, ctx.canvas.h) : 1500;
  const limit = Math.max(DRIFT_LIMIT_MULT * Math.max(n.bbox.w, 1), 0.6 * canvasDiag);
  if (ctx.moveAccum[n.id] > limit) ctx.frozen.add(n.id);
}
function canMove(ctx, id) { return !ctx.frozen.has(id); }

// ---- patches (deterministic transforms on bboxes) ----

function pClampOverflow(alt, fix, ctx) {
  const n = nodeMap(alt).get(fix.node);
  if (!n || !canMove(ctx, n.id)) return [];
  const oldB = { ...n.bbox };
  n.bbox = clampToCanvas(n.bbox, alt.meta.canvas);
  recordMove(ctx, n, oldB);
  return [n.id];
}

function pSeparateOverlap(alt, fix, ctx) {
  const m = nodeMap(alt);
  const a = m.get(fix.a); const b = m.get(fix.b);
  if (!a || !b) return [];
  const moveB = canMove(ctx, b.id);
  const moveA = canMove(ctx, a.id);
  if (!moveB && !moveA) return [];
  const target = moveB ? b : a;
  const fixed = moveB ? a : b;
  const oldB = { ...target.bbox };
  const ta = target.bbox; const fb = fixed.bbox;
  if (fix.axis === 'X') {
    const tc = ta.x + ta.w / 2; const fc = fb.x + fb.w / 2;
    const overlap = Math.min(ta.x + ta.w, fb.x + fb.w) - Math.max(ta.x, fb.x);
    const push = overlap + sepGap(alt.meta.canvas);
    if (tc >= fc) target.bbox = { ...ta, x: ta.x + push };
    else target.bbox = { ...ta, x: ta.x - push };
  } else {
    const tc = ta.y + ta.h / 2; const fc = fb.y + fb.h / 2;
    const overlap = Math.min(ta.y + ta.h, fb.y + fb.h) - Math.max(ta.y, fb.y);
    const push = overlap + sepGap(alt.meta.canvas);
    if (tc >= fc) target.bbox = { ...ta, y: ta.y + push };
    else target.bbox = { ...ta, y: ta.y - push };
  }
  recordMove(ctx, target, oldB);
  return [target.id];
}

function pShiftToCenter(alt, fix, ctx) {
  const n = nodeMap(alt).get(fix.node);
  if (!n || !canMove(ctx, n.id)) return [];
  const [nx, ny] = center(n.bbox);
  const cx = alt.meta.canvas.w / 2; const cy = alt.meta.canvas.h / 2;
  const dx = (cx - nx) * 0.4; const dy = (cy - ny) * 0.4;
  const oldB = { ...n.bbox };
  n.bbox = { x: n.bbox.x + dx, y: n.bbox.y + dy, w: n.bbox.w, h: n.bbox.h };
  recordMove(ctx, n, oldB);
  return [n.id];
}

function pShiftToCentroid(alt, fix, ctx) {
  const m = nodeMap(alt);
  const n = m.get(fix.node); const t = m.get(fix.toward);
  if (!n || !t || !canMove(ctx, n.id)) return [];
  const [nx, ny] = center(n.bbox); const [tx, ty] = center(t.bbox);
  const dx = (tx - nx) * 0.35; const dy = (ty - ny) * 0.35;
  const oldB = { ...n.bbox };
  n.bbox = { x: n.bbox.x + dx, y: n.bbox.y + dy, w: n.bbox.w, h: n.bbox.h };
  recordMove(ctx, n, oldB);
  return [n.id];
}

function pIncreaseGap(alt, fix, ctx) {
  const m = nodeMap(alt);
  const a = m.get(fix.a); const b = m.get(fix.b);
  if (!a || !b) return [];
  const moveB = canMove(ctx, b.id); const moveA = canMove(ctx, a.id);
  if (!moveB && !moveA) return [];
  const target = moveB ? b : a; const fixed = moveB ? a : b;
  const [tx, ty] = center(target.bbox); const [fx, fy] = center(fixed.bbox);
  let ux = tx - fx; let uy = ty - fy;
  const len = Math.hypot(ux, uy) || 1; ux /= len; uy /= len;
  const step = Math.max(20, 0.25 * len);
  const oldB = { ...target.bbox };
  target.bbox = { x: target.bbox.x + ux * step, y: target.bbox.y + uy * step, w: target.bbox.w, h: target.bbox.h };
  recordMove(ctx, target, oldB);
  return [target.id];
}

function pScaleGroupDown(alt, fix, ctx) {
  const boxes = alt.nodes.filter((n) => n.bbox && !ctx.frozen.has(n.id)).map((n) => n.bbox);
  const cb = contentBounds(boxes);
  if (!cb || cb.w <= 0 || cb.h <= 0) return [];
  const cx = cb.x + cb.w / 2; const cy = cb.y + cb.h / 2;
  const f = (Number.isFinite(fix.factor) && fix.factor > 0 && fix.factor < 1) ? fix.factor : 0.9;
  const moved = [];
  for (const n of alt.nodes) {
    if (!n.bbox || ctx.frozen.has(n.id)) continue;
    const oldB = { ...n.bbox };
    n.bbox = {
      x: cx + (n.bbox.x - cx) * f,
      y: cy + (n.bbox.y - cy) * f,
      w: n.bbox.w * f, h: n.bbox.h * f,
    };
    recordMove(ctx, n, oldB);
    moved.push(n.id);
  }
  return moved;
}

// terminal safe affine: uniform scale ≤1 + translation. Provably cannot introduce overlaps.
function pSnapToMarginGrid(alt, ctx) {
  const boxes = alt.nodes.filter((n) => n.bbox).map((n) => n.bbox);
  const cb = contentBounds(boxes);
  if (!cb || cb.w <= 0 || cb.h <= 0) return [];
  const margin = 0.06 * Math.min(alt.meta.canvas.w, alt.meta.canvas.h);
  const availW = alt.meta.canvas.w - 2 * margin;
  const availH = alt.meta.canvas.h - 2 * margin;
  const scale = Math.min(availW / cb.w, availH / cb.h, 1);
  const offX = margin + (availW - cb.w * scale) / 2;
  const offY = margin + (availH - cb.h * scale) / 2;
  const moved = [];
  for (const n of alt.nodes) {
    if (!n.bbox) continue;
    n.bbox = {
      x: offX + (n.bbox.x - cb.x) * scale,
      y: offY + (n.bbox.y - cb.y) * scale,
      w: n.bbox.w * scale, h: n.bbox.h * scale,
    };
    moved.push(n.id);
  }
  return moved;
}

const PATCHES = {
  'clamp-overflow': pClampOverflow,
  'separate-overlap': pSeparateOverlap,
  'shift-heaviest-toward-center': pShiftToCenter,
  'shift-toward-cluster-centroid': pShiftToCentroid,
  'increase-gap': pIncreaseGap,
  'scale-group-down': pScaleGroupDown,
};
// exported so tests can assert PATCHES keys stay in sync with fixkind.AUTO_FIXABLE_KINDS
export const PATCH_KINDS = Object.keys(PATCHES);

// Recenter the layout's optical-weight centroid onto the canvas center.
// Uniform translation → overlap-safe (relative positions unchanged) → directly reduces BM.
function opticalCenter(alt) {
  let wx = 0; let wy = 0; let wt = 0;
  for (const n of alt.nodes) {
    if (!n.bbox) continue;
    const w = area(n.bbox) * luminanceWeight(luminanceFromStyle(n.style)) * shapeComplexity(n.bbox);
    wx += w * (n.bbox.x + n.bbox.w / 2);
    wy += w * (n.bbox.y + n.bbox.h / 2);
    wt += w;
  }
  return wt > 0
    ? { x: wx / wt, y: wy / wt }
    : { x: alt.meta.canvas.w / 2, y: alt.meta.canvas.h / 2 };
}
function pRecenterOptical(alt, factor = 0.5) {
  const oc = opticalCenter(alt);
  const dx = (alt.meta.canvas.w / 2 - oc.x) * factor;
  const dy = (alt.meta.canvas.h / 2 - oc.y) * factor;
  if (Math.hypot(dx, dy) < 0.5) return false;
  for (const n of alt.nodes) {
    if (!n.bbox) continue;
    n.bbox = { x: n.bbox.x + dx, y: n.bbox.y + dy, w: n.bbox.w, h: n.bbox.h };
  }
  return true;
}

// Hard-clean P0 (overflow + overlap) in a sub-loop, independent of P1/P2 shift tuning.
// Shifts may push nodes into each other; this guarantees the iteration ends P0-clean.
function resolveP0(alt, ctx) {
  const canvas = alt.meta.canvas;
  for (let k = 0; k < 16; k++) {
    let changed = false;
    for (const n of alt.nodes) {
      if (!n.bbox) continue;
      const c = clampToCanvas(n.bbox, canvas);
      if (c.x !== n.bbox.x || c.y !== n.bbox.y || c.w !== n.bbox.w || c.h !== n.bbox.h) {
        const oldB = { ...n.bbox };
        n.bbox = c;
        recordMove(ctx, n, oldB);
        changed = true;
      }
    }
    for (let i = 0; i < alt.nodes.length; i++) {
      for (let j = i + 1; j < alt.nodes.length; j++) {
        const a = alt.nodes[i]; const b = alt.nodes[j];
        if (!a.bbox || !b.bbox) continue;
        // don't separate intentional stroke–stroke crossings (icons/line-art); only real
        // filled-region overlaps. Mirrors collision.mjs.
        if (a.style?.filled === false && b.style?.filled === false) continue;
        if (!rectsOverlap(a.bbox, b.bbox, 0)) continue;
        const moveB = canMove(ctx, b.id); const moveA = canMove(ctx, a.id);
        if (!moveB && !moveA) continue;
        const target = moveB ? b : a; const fixed = moveB ? a : b;
        const oldB = { ...target.bbox };
        const d = overlapDepth(target.bbox, fixed.bbox);
        const minAxis = d.x <= d.y ? 'X' : 'Y';
        const push = Math.min(d.x, d.y) + sepGap(canvas);
        if (minAxis === 'X') {
          const dir = (target.bbox.x + target.bbox.w / 2) >= (fixed.bbox.x + fixed.bbox.w / 2) ? 1 : -1;
          target.bbox = { ...target.bbox, x: target.bbox.x + dir * push };
        } else {
          const dir = (target.bbox.y + target.bbox.h / 2) >= (fixed.bbox.y + fixed.bbox.h / 2) ? 1 : -1;
          target.bbox = { ...target.bbox, y: target.bbox.y + dir * push };
        }
        recordMove(ctx, target, oldB);
        changed = true;
      }
    }
    if (!changed) break;
  }
}

function applyPatch(alt, fix, ctx) {
  const fn = PATCHES[fix.kind];
  if (!fn) return [];
  try { return fn(alt, fix, ctx); } catch { return []; }
}

// ---- the loop ----

export function fixAlt(alt, contract, maxIters = 5, opts = {}) {
  // Runs under the 'fix-geometry' execution profile (profiles.mjs): autoFixable geometry
  // patches only; suggestionOnly fixes are refused in the patch loop below and recorded in
  // skippedFixes. The REAL enforcement is structural — PATCHES contains no suggestionOnly
  // kinds — the profile names that fact and records skips for transparency (advisory, not a
  // security boundary).
  alt = clone(alt); // never mutate the caller's ALT; work on a private copy
  const aesthetic = opts.aesthetic === true; // P1/P2 aesthetic shifts are OPT-IN (Goodhart risk); default = P0 structural cleanup only
  const ctx = { frozen: new Set(), moveAccum: {}, canvas: alt.meta.canvas, skippedFixes: [] };
  // The Sprint Contract states intent: only optimize for skills it references.
  // (A chart icon excludes balance/proximity — growth asymmetry + bar spread are intentional.)
  const contracted = new Set((contract?.criteria || []).map((c) => c.skill));
  let best = { alt: clone(alt), report: measureAlt(alt, opts), cost: totalCost(collectViolations(measureAlt(alt, opts))) };
  let prevCost = Infinity;
  let noImprove = 0;
  let lastReport = best.report;
  const iters = [];
  const startCost = best.cost;

  for (let iter = 0; iter < maxIters; iter++) {
    const report = measureAlt(alt, opts);
    lastReport = report;
    const viols = collectViolations(report);
    const cost = totalCost(viols);
    if (cost < best.cost) { best = { alt: clone(alt), report, cost }; }

    const ev = evaluate(report, contract);
    if (ev.allPass || cost === 0) {
      return finalize('pass', iter, best, contract, iters, ctx, startCost);
    }
    if (iter > 0 && cost >= prevCost) {
      noImprove++;
      if (noImprove >= 2) return finalize('no-improvement', iter, best, contract, iters, ctx, startCost);
    } else {
      noImprove = 0;
    }
    prevCost = cost;

    const freeRatio = report.skills?.whitespace?.metrics?.freeRatio ?? 1;

    let applied = 0;
    if (aesthetic) {
      // P1/P2 AESTHETIC SHIFTS — OPT-IN (opts.aesthetic / --aesthetic). These maximize the
      // score but do NOT track real aesthetics (Goodhart): they can destroy deliberate
      // structure (scatter a neat grid) and fill canvases while the score rises. Default OFF;
      // the fixer only does P0 structural cleanup (below). The score is a conformance proxy,
      // not beauty — never let it auto-drive aesthetic mutation by default.
      const passingSkills = new Set(Object.entries(report.skills || {})
        .filter(([, s]) => !s.violations.length).map(([k]) => k));
      const proxComp = compensationFactor('proximity', { freeRatio }); // 동적 충돌 보상 (de-cramp ↔ 군집화)
      for (const v of orderViolations(viols, { passingSkills })) {
        if (v.skill === 'collision' || v.skill === 'boundary') continue; // P0 owned by resolveP0
        if (!contracted.has(v.skill)) continue; // respect Sprint Contract: skip non-contracted skills
        const fix = v.fix;
        if (!fix || !fix.kind) continue;
        if (v.skill === 'proximity' && fix.kind === 'shift-toward-cluster-centroid' && proxComp < 0.15) continue;
        const action = PATCHES[fix.kind] ? 'apply-autoFixable-patch' : 'apply-suggestionOnly';
        if (!isAllowed('fix-geometry', action)) {
          if (!ctx.skippedFixes.some((s) => s.kind === fix.kind)) {
            ctx.skippedFixes.push({ kind: fix.kind, mode: 'suggestionOnly', reason: `fix-geometry profile forbids ${action}` });
          }
          continue;
        }
        const moved = applyPatch(alt, fix, ctx);
        if (moved.length) applied++;
      }
      if (contracted.has('balance') && report.skills.balance?.score < 0.85) pRecenterOptical(alt);
    }
    resolveP0(alt, ctx);          // P0 STRUCTURAL CLEANUP — always on, the only legitimate auto-fix:
                                  // resolve overlaps + clamp overflow (readability floor). Not aesthetics.
    if (aesthetic) pSnapToMarginGrid(alt, ctx);  // terminal aesthetic normalization — opt-in only
    iters.push({ iter, cost: Number(cost.toFixed(3)), applied, freeRatio: Number(freeRatio.toFixed(3)) });
  }
  return finalize('budget-exhausted', maxIters, best, contract, iters, ctx, startCost);
}

function finalize(outcome, iterations, best, contract, iters, ctx, startCost) {
  const ev = evaluate(best.report, contract);
  const bestIter = iters.length
    ? iters.reduce((a, b) => (b.cost < a.cost ? b : a)).iter
    : 0;
  return {
    outcome,
    profile: 'fix-geometry', // this layer's execution profile (governance declaration)
    iterations,
    bestIteration: bestIter,
    passedCriteria: ev.criteria.filter((c) => c.status === 'pass').map((c) => c.criterion).sort(),
    failingCriteria: ev.criteria.filter((c) => c.status === 'fail')
      .map((c) => ({ criterion: c.criterion, measured: c.measured }))
      .sort((a, b) => (a.criterion < b.criterion ? -1 : 1)),
    unmeasuredCriteria: ev.criteria.filter((c) => c.status === 'unmeasured').map((c) => c.criterion).sort(),
    totalWeightedViolation: { start: Number(startCost.toFixed(3)), best: Number(best.cost.toFixed(3)) },
    frozenNodes: [...ctx.frozen].sort(),
    skippedFixes: ctx.skippedFixes, // suggestionOnly fixes the fix-geometry profile refused to apply
    stoppedReason: `${outcome} at iter ${iterations}`,
    fixed: best.alt,
    report: best.report,
    iterations_log: iters,
  };
}

// ---- CLI ----

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const inputPath = positional[0];
  if (!inputPath) {
    console.error('usage: node lib/fix.mjs <layout-or-domain-file> [--contract c.json] [--max-iters N] [--out fixed.ext]');
    process.exit(2);
  }
  const domain = detectDomain(inputPath, flags.domain);
  const contractPath = flags.contract || path.join(skillRoot(), 'examples', 'catalog.contract.json');
  const contract = readJson(contractPath);
  const maxIters = Number(flags['max-iters']) || 5;
  const profile = typeof flags.profile === 'string' ? flags.profile : undefined;

  const alt = domain === 'alt' ? readJson(inputPath) : importPath(inputPath, { domain });
  await validate('alt', alt);

  const versionsDir = path.join(process.cwd(), 'versions');
  const snapIdx = nextSnapshot(versionsDir, inputPath);
  fs.mkdirSync(versionsDir, { recursive: true });
  writeJson(path.join(versionsDir, `v${String(snapIdx).padStart(2, '0')}-pre.json`), alt);

  const aesthetic = Boolean(flags.aesthetic);
  const result = fixAlt(alt, contract, maxIters, { profile, aesthetic });
  if (aesthetic) {
    console.error('⚠ --aesthetic enables P1/P2 score-maximizing shifts (Goodhart risk: may degrade real aesthetics). Default is P0 structural cleanup only.');
  }

  // neural reward gate (옵션): 외부 신경 점수를 병합해 contract 재평가. 신경 미충족 = 기하로 못 고침 → 재생성 권고.
  if (flags.neural) {
    const { loadNeural, mergeNeural, applyNeuralGate } = await import('./neural.mjs');
    const scores = loadNeural(flags.neural);
    if (scores) {
      result.report = mergeNeural(result.report, scores);
      // applyNeuralGate computes feedback and maps neural failure to a documented enum
      // outcome ('best-effort') + stoppedReason — no out-of-enum 'best-effort(neural)'.
      applyNeuralGate(result, contract);
    }
  }
  if (!OUTCOMES.has(result.outcome)) {
    throw new Error(`invalid outcome '${result.outcome}' — must be one of ${[...OUTCOMES].join('|')}`);
  }

  const base = path.basename(inputPath, path.extname(inputPath));
  const outDomain = flags['emit'] || (domain === 'alt' ? 'alt' : domain);
  const exported = exportAlt(result.fixed, outDomain);
  const outPath = flags.out || path.join(process.cwd(), `${base}.fixed.${exported.ext}`);
  if (exported.text != null) fs.writeFileSync(outPath, exported.text, 'utf8');
  else fs.writeFileSync(outPath, exported.buffer);

  const logPath = path.join(process.cwd(), `${base}.fix-log.json`);
  const { fixed, report, ...logBody } = result;
  writeJson(logPath, { ...logBody, input: inputPath, contract: contractPath, output: outPath });

  writeJson(path.join(process.cwd(), `${base}.fixed.report.json`), report);

  const neuralNote = result.neuralFeedback?.regenerate
    ? ` | ⚠ neural 미충족 → 재생성 권고 [${result.neuralFeedback.failing.join(', ')}]`
    : (result.neuralFeedback?.present ? ' | neural OK' : '');
  console.log(`${result.outcome} | geometryScore ${report.summary.measuredAestheticScore} (coverage ${report.summary.coverageScore}, hard ${report.summary.hardIntegrityScore}) | ${result.passedCriteria.length}/${result.passedCriteria.length + result.failingCriteria.length} criteria${neuralNote} | ${outPath}`);
}

function nextSnapshot(dir, inputPath) {
  if (!fs.existsSync(dir)) return 0;
  const base = path.basename(inputPath, path.extname(inputPath));
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(`v`) && f.endsWith('-pre.json'));
  let max = -1;
  for (const f of files) { const m = /^v(\d+)-pre\.json$/.exec(f); if (m) max = Math.max(max, +m[1]); }
  return max + 1;
}

if (isMain(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
