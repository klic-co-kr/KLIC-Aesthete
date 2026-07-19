#!/usr/bin/env node
// Orchestrator: validate ALT → run every skill → assemble report.json.
// Deterministic — never throws on bad input (degraded-friendly); never emits NaN.

import path from 'node:path';
import { readJson, writeJson, parseArgs, skillRoot, isMain } from './shared/cli.mjs';
import { validate } from './shared/validator.mjs';
import { SKILLS, SPECIALTY } from './skills/index.mjs';
import { importPath, detectDomain } from './adapters/index.mjs';
import { fixMode } from './fixkind.mjs';

const SEVERITY_WEIGHT = { high: 1, medium: 0.5, low: 0.25 };

function fin(v, fallback = 0) {
  return Number.isFinite(v) ? v : fallback;
}

// wrap each skill so a throw/NaN in one skill never aborts measurement
function safeMeasure(skill, alt, opts) {
  try {
    const r = skill.measure(alt, opts) || {};
    const score = fin(r.score, 0);
    const metrics = r.metrics && typeof r.metrics === 'object' ? r.metrics : {};
    // coverage: measured | partial | unmeasurable. Default measured; skills that can't judge
    // (no grouping semantics, no comparable pairs, etc.) declare it. §12.
    const coverage = r.coverage === 'partial' || r.coverage === 'unmeasurable' ? r.coverage : 'measured';
    const violations = Array.isArray(r.violations) ? r.violations : [];
    // stamp every fix with its applicability mode so the report never implies an
    // auto-fix for a font/color/semantic problem the geometry fixer can't resolve.
    for (const v of violations) {
      if (v && v.fix && v.fix.kind) v.fix.mode = fixMode(v.fix.kind);
    }
    return { score, metrics, coverage, violations };
  } catch (err) {
    return {
      score: 0,
      errored: true, // a skill that threw produced no valid measurement
      coverage: 'unmeasurable',
      metrics: { error: String((err && err.message) || err) },
      violations: [],
    };
  }
}

export function measureAlt(alt, opts = {}, skillList = SKILLS) {
  const skills = {};
  let scoreSum = 0;        // legacy overallScore (all skills; unmeasurable axes still donate their score)
  let weightSum = 0;
  let hardSum = 0;         // P0 hardIntegrityScore (collision + boundary — structural floor)
  let hardWeight = 0;
  let measuredSum = 0;     // measuredAestheticScore (excludes unmeasurable axes — the honest score)
  let measuredWeight = 0;
  let totalWeightedViolation = 0;
  const passing = [];
  const failing = [];

  for (const s of skillList) {
    const res = safeMeasure(s, alt, opts);
    const measured = res.coverage !== 'unmeasurable';
    skills[s.id] = {
      score: Number(fin(res.score).toFixed(3)),
      coverage: res.coverage,
      metrics: res.metrics,
      effect: s.effect,
      violations: res.violations,
    };
    scoreSum += fin(res.score) * s.weight;
    weightSum += s.weight;
    if (s.tier === 'P0') { hardSum += fin(res.score) * s.weight; hardWeight += s.weight; }
    if (measured) { measuredSum += fin(res.score) * s.weight; measuredWeight += s.weight; }
    for (const v of res.violations) {
      const sev = SEVERITY_WEIGHT[v.severity] ?? 0.5;
      totalWeightedViolation += sev * s.weight;
    }
    // a skill that threw is NOT passing — it produced no valid measurement. Bucket it as
    // failing (with coverage 'unmeasurable' + metrics.error on the entry) so it can never
    // be mistaken for a clean pass.
    if (res.errored) failing.push(s.id);
    else if (res.violations.length > 0) failing.push(s.id);
    else passing.push(s.id);
  }

  const overallScore = weightSum ? scoreSum / weightSum : 0;
  const hardIntegrityScore = hardWeight ? hardSum / hardWeight : 1;
  const measuredAestheticScore = measuredWeight ? measuredSum / measuredWeight : 0;
  const coverageScore = weightSum ? measuredWeight / weightSum : 0;
  return {
    schema_version: 1,
    summary: {
      // overallScore is retained for backward compatibility — it INCLUDES unmeasurable axes
      // (which return a neutral 1.0) and can therefore overstate quality. Prefer
      // measuredAestheticScore + coverageScore. (§12)
      overallScore: Number(fin(overallScore).toFixed(3)),
      hardIntegrityScore: Number(fin(hardIntegrityScore).toFixed(3)),
      measuredAestheticScore: Number(fin(measuredAestheticScore).toFixed(3)),
      coverageScore: Number(fin(coverageScore).toFixed(3)),
      totalWeightedViolation: Number(fin(totalWeightedViolation).toFixed(3)),
      passing: passing.sort(),
      failing: failing.sort(),
    },
    skills,
  };
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const inputPath = positional[0]
    || path.join(skillRoot(), 'examples', 'catalog-good.layout.json');

  // auto-detect domain by extension; .json (or unknown) → treat as native ALT
  const domain = detectDomain(inputPath, flags.domain);
  const opts = {};
  if (flags.slide) opts.slide = Number(flags.slide);
  if (flags.canvas) {
    const [w, h] = String(flags.canvas).split(/[x,]/).map(Number);
    if (Number.isFinite(w) && Number.isFinite(h)) opts.canvas = { w, h };
  }
  const alt = domain === 'alt' ? readJson(inputPath) : importPath(inputPath, { ...opts, domain });
  await validate('alt', alt);

  const profile = typeof flags.profile === 'string' ? flags.profile : undefined;
  // --symmetry: opt-in the icon/geometric axis (NOT a default layout skill — most layouts are
  // deliberately asymmetric, so symmetry would false-positive there).
  const skillList = flags.symmetry ? [...SKILLS, SPECIALTY.symmetry] : SKILLS;
  let report = measureAlt(alt, { profile }, skillList);

  // neuro-symbolic seam: 외부 신경 점수(MLLM/CLIP)를 병합(선택). 코어는 모델 미호출.
  if (flags.neural) {
    const { loadNeural, mergeNeural } = await import('./neural.mjs');
    const scores = loadNeural(flags.neural);
    if (scores) report = mergeNeural(report, scores);
  }

  await validate('report', report);

  const base = path.basename(inputPath, path.extname(inputPath));
  const outPath = positional[1] || path.join(process.cwd(), `${base}.report.json`);
  writeJson(outPath, report);
  console.log(outPath);
}

if (isMain(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
