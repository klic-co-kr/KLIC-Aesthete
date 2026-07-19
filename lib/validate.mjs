#!/usr/bin/env node
// Validation harness — does any engine score actually track human aesthetic judgment?
//
// This is the realistic-review answer to "the engine is deterministic but empirically
// unvalidated." Hand-crafted aesthetic metrics are known to correlate weakly with humans;
// the only honest test is to compare each scoring variant against a HUMAN-rated corpus.
//
// The harness is the real deliverable. The shipped demo corpus (examples/validation-corpus.json)
// uses SYNTHETIC placeholder human scores so the harness runs and produces an A/B/C/D comparison;
// those results are NOT a validation until real human ratings replace the placeholder. Swap the
// corpus → real validation, no code change.
//
// Variants (the competing hypotheses about "what is the engine's aesthetic-quality signal?"):
//   A = overallScore          (legacy — includes unmeasurable axes as neutral 1.0)
//   B = measuredAestheticScore(§12 — measured axes only)
//   C = hardIntegrityScore    (P0 structural floor — "maybe humans just hate broken layouts")
//   D = coverageScore         (measurement fraction — "maybe humans prefer well-structured input")
// plus a baseline (predict-the-mean → r≈0). A real signal must beat the baseline.

import path from 'node:path';
import { readJson, writeJson, parseArgs, skillRoot, isMain } from './shared/cli.mjs';
import { validate } from './shared/validator.mjs';
import { measureAlt } from './measure.mjs';

const fin = (v, f = 0) => (Number.isFinite(v) ? v : f);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

// average ranks (ties share the mean rank) — for Spearman
export function rank(arr) {
  const order = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(arr.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j < order.length && order[j][0] === order[i][0]) j++;
    const avg = (i + 1 + j) / 2; // mean of 1-based ranks (i+1 .. j)
    for (let k = i; k < j; k++) r[order[k][1]] = avg;
    i = j;
  }
  return r;
}

export function pearson(x, y) {
  const n = Math.min(x.length, y.length);
  if (n === 0) return 0;
  const mx = mean(x); const my = mean(y);
  let num = 0; let dx = 0; let dy = 0;
  for (let i = 0; i < n; i++) { const a = x[i] - mx; const b = y[i] - my; num += a * b; dx += a * a; dy += b * b; }
  return dx === 0 || dy === 0 ? 0 : num / Math.sqrt(dx * dy);
}

export function spearman(x, y) {
  return pearson(rank(x), rank(y));
}

const VARIANTS = [
  { id: 'A', label: 'overallScore (legacy)', get: (s) => s.overallScore },
  { id: 'B', label: 'measuredAestheticScore (§12)', get: (s) => s.measuredAestheticScore },
  { id: 'C', label: 'hardIntegrityScore (P0)', get: (s) => s.hardIntegrityScore },
  { id: 'D', label: 'coverageScore', get: (s) => s.coverageScore },
];

// baseline: predict-the-mean → Pearson/Spearman ≈ 0 by construction (the chance floor a real
// signal must beat). Deterministic (no shuffle).
function baseline() {
  return { id: '·', label: 'baseline (predict-mean)', spearman: 0, pearson: 0 };
}

export function validateCorpus(corpus) {
  const entries = (corpus && Array.isArray(corpus.entries) ? corpus.entries : corpus) || [];
  const human = entries.map((e) => Number(e.humanScore)).filter(Number.isFinite);
  const measures = entries.map((e) => {
    try { return measureAlt(e.alt).summary; } catch { return null; }
  });
  // keep only entries where both human score and a measurement exist (paired)
  const pairs = [];
  for (let i = 0; i < entries.length; i++) {
    const h = Number(entries[i].humanScore);
    if (Number.isFinite(h) && measures[i]) pairs.push({ h, s: measures[i] });
  }
  const hs = pairs.map((p) => p.h);
  const variants = VARIANTS.map((v) => ({
    id: v.id,
    label: v.label,
    spearman: Number(fin(spearman(pairs.map((p) => v.get(p.s)), hs), 0).toFixed(3)),
    pearson: Number(fin(pearson(pairs.map((p) => v.get(p.s)), hs), 0).toFixed(3)),
  }));
  const byStrength = [...variants].sort((a, b) => Math.abs(b.spearman) - Math.abs(a.spearman));
  const winner = byStrength[0];
  return {
    schema_version: 1,
    n: pairs.length,
    baseline: baseline(),
    variants,
    winner: winner ? winner.id : null,
    beatsBaseline: variants.filter((v) => v.spearman > 0).map((v) => v.id), // Spearman > mean-predictor floor
    demo: Boolean(corpus && corpus.demo),
    note: corpus && corpus.demo
      ? 'DEMO corpus — SYNTHETIC placeholder human scores. These correlations prove the harness runs, NOT that the metrics are validated. Replace entries[].humanScore with real human ratings to validate.'
      : (corpus && corpus.note) || '',
  };
}

// ---- CLI: bun lib/validate.mjs <corpus.json> [validate-report.json] ----
async function main() {
  const { positional } = parseArgs(process.argv.slice(2));
  const corpusPath = positional[0] || path.join(skillRoot(), 'examples', 'validation-corpus.json');
  const corpus = readJson(corpusPath);
  await validate('validation-corpus', corpus);

  const result = validateCorpus(corpus);

  const outPath = positional[1] || path.join(process.cwd(), `${path.basename(corpusPath, '.json')}.validate.json`);
  writeJson(outPath, result);

  const w = (s) => String(s).padEnd(34);
  console.log(`=== validation: ${result.n} paired entries | winner ${result.winner} | beats baseline ${result.beatsBaseline.join('') || '(none)'} ===`);
  console.log(`${w('variant')} | spearman | pearson`);
  for (const v of result.variants) console.log(`${w(v.id + ' ' + v.label)} |   ${v.spearman.toFixed(3).padStart(6)} | ${v.pearson.toFixed(3).padStart(6)}`);
  console.log(`${w(result.baseline.label)} |   ${result.baseline.spearman.toFixed(3).padStart(6)} | ${result.baseline.pearson.toFixed(3).padStart(6)}`);
  if (result.demo) console.log(`\nNOTE: ${result.note}`);
  console.log(outPath);
}

if (isMain(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
