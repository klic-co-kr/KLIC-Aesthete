// Sprint Contract: the frozen rubric. Written BEFORE generation. The evaluator reads
// ONLY this file + the measurement report — never the generator's source. This is the
// anti-rationalization contract from the proposal (the evaluator here is arithmetic,
// so rationalization is structurally impossible).

import path from 'node:path';
import { readJson, writeJson, parseArgs, skillRoot, isMain } from './shared/cli.mjs';
import { validate } from './shared/validator.mjs';

// Default rubric for a catalog/diagram-style layout.
//
// Slop note (spec §6 M2): slop is NOT in the default contract — the slop-test self-check is
// non-enforced. A caller MAY add a criterion like
//   { skill: 'slop', metric: 'p0Count', op: '==', threshold: 0, weight: 1 }
// to gate on measured slop P0 findings; report.skills.slop.metrics.p0Count is the source.
// An unmeasurable slop axis (coverage 'unmeasurable') yields status 'unmeasured' (no false-pass),
// identical to unmeasurable geometry axes.
export function defaultContract(brief) {
  return {
    schema_version: 1,
    brief: brief || '',
    criteria: [
      { skill: 'collision', metric: 'count', op: '==', threshold: 0, weight: 3 },
      { skill: 'boundary', metric: 'overflowCount', op: '==', threshold: 0, weight: 3 },
      { skill: 'hierarchy', metric: 'clarity', op: '>=', threshold: 0.7, weight: 1.5 },
      { skill: 'balance', metric: 'BM', op: '>=', threshold: 0.85, weight: 1 },
      { skill: 'proximity', metric: 'fragmentedCount', op: '==', threshold: 0, weight: 1 },
      { skill: 'proximity', metric: 'falseAdjacencyCount', op: '==', threshold: 0, weight: 1 },
      { skill: 'whitespace', metric: 'freeRatio', op: '>=', threshold: 0.25, weight: 1 },
      { skill: 'harmony', metric: 'harmonyScore', op: '>=', threshold: 0.5, weight: 1 },
      { skill: 'similarity', metric: 'inconsistentGroups', op: '==', threshold: 0, weight: 1 },
      { skill: 'fluency', metric: 'fluency', op: '>=', threshold: 0.6, weight: 1 },
    ],
  };
}

function cmp(op, measured, threshold) {
  switch (op) {
    case '==': return measured === threshold;
    case '>=': return measured >= threshold;
    case '<=': return measured <= threshold;
    default: return false;
  }
}

function getMetric(report, skill, metric) {
  const sk = report?.skills?.[skill];
  if (!sk || !sk.metrics) return NaN;
  const v = sk.metrics[metric];
  return typeof v === 'number' ? v : NaN;
}

// Pure comparison → PASS/FAIL/UNMEASURED per criterion + weighted overall. Deterministic.
export function evaluate(report, contract) {
  const criteria = [];
  let weightedPassed = 0;
  let weightedTotal = 0;
  const unmeasured = [];
  for (const c of contract.criteria) {
    const coverage = report?.skills?.[c.skill]?.coverage;
    const measured = getMetric(report, c.skill, c.metric);
    const measuredFinite = Number.isFinite(measured) ? Number(measured.toFixed(4)) : null;
    let passed; let status; let reason;
    if (coverage === 'unmeasurable') {
      // §12: a criterion on an axis that could not be measured is NOT verifiable. Never let it
      // pass vacuously via the skill's default metric (e.g. clarity=1, inconsistentGroups=0).
      passed = false;
      status = 'unmeasured';
      reason = `skill '${c.skill}' is unmeasurable — criterion not verifiable from geometry`;
      unmeasured.push(`${c.skill}.${c.metric}${c.op}${c.threshold}`);
    } else {
      passed = measuredFinite !== null ? cmp(c.op, measuredFinite, c.threshold) : false;
      status = passed ? 'pass' : 'fail';
    }
    criteria.push({
      criterion: `${c.skill}.${c.metric}${c.op}${c.threshold}`,
      skill: c.skill,
      metric: c.metric,
      op: c.op,
      threshold: c.threshold,
      measured: measuredFinite,
      passed,
      status,
      reason,
      weight: c.weight,
    });
    weightedTotal += c.weight;
    if (passed) weightedPassed += c.weight;
  }
  const allPass = criteria.every((r) => r.passed);
  const score = weightedTotal ? weightedPassed / weightedTotal : 0;
  return {
    verdict: allPass ? 'pass' : 'fail',
    score: Number(score.toFixed(3)),
    allPass,
    criteria,
    unmeasured,
  };
}

// CLI: node contract.mjs build [brief.json] [contract.json]
async function main() {
  const { positional } = parseArgs(process.argv.slice(2));
  const cmd = positional[0];
  if (cmd === 'build') {
    const briefPath = positional[1] || path.join(skillRoot(), 'examples', 'catalog-brief.json');
    const outPath = positional[2] || path.join(process.cwd(), 'contract.json');
    const briefFile = readJson(briefPath);
    const brief = typeof briefFile === 'string' ? briefFile : (briefFile.brief || '');
    const contract = defaultContract(brief);
    await validate('contract', contract);
    writeJson(outPath, contract);
    console.log(outPath);
  } else {
    console.error('usage: node lib/contract.mjs build [brief.json] [contract.json]');
    process.exit(2);
  }
}

if (isMain(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
