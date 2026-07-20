// Pure decision fold for aesthete-post / aesthete-gate.
// Deterministic. No I/O. No LLM. Post never mutates artifacts — callers only read this JSON.

export const DECISIONS = Object.freeze(['regenerate', 'fix_geometry', 'pass', 'human']);

export const P0_SKILLS = Object.freeze(['collision', 'boundary']);

const NEXT = {
  regenerate: 'rewrite_generator',
  fix_geometry: 'run_fix_p0',
  pass: 'stop',
  human: 'ask_human',
};

// Lower priority number = more severe (wins the fold).
const PRI = {
  regenerate_import: 10,
  regenerate_structure: 20,
  fix_geometry: 30,
  regenerate_unfixable: 40,
  regenerate_lint: 50,
  regenerate_vuln: 60,
  regenerate_contract: 70,
  human_coverage: 80,
  pass: 90,
};

export function isPhysicallyInfeasible(alt, ratio = 1.05) {
  const canvas = alt?.meta?.canvas || alt?.canvas;
  const w = Number(canvas?.w);
  const h = Number(canvas?.h);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return false;
  const area = w * h;
  let sum = 0;
  for (const n of alt?.nodes || []) {
    const bw = Number(n?.bbox?.w);
    const bh = Number(n?.bbox?.h);
    if (Number.isFinite(bw) && Number.isFinite(bh) && bw > 0 && bh > 0) sum += bw * bh;
  }
  return sum > area * ratio;
}

/** Collect P0 violations from a measure report. */
export function collectP0Violations(report) {
  const out = [];
  for (const sid of P0_SKILLS) {
    const sk = report?.skills?.[sid];
    if (!sk) continue;
    for (const v of sk.violations || []) {
      out.push({ skill: sid, ...v });
    }
  }
  return out;
}

export function p0Fixable(report, alt, opts = {}) {
  const hard = report?.summary?.hardIntegrityScore;
  if (!(typeof hard === 'number') || hard >= 1) return { fixable: false, reason: 'hard-ok' };
  const p0 = collectP0Violations(report);
  if (p0.length === 0) {
    // hard failed but no violation objects — treat as unfixable signal
    return { fixable: false, reason: 'hard-fail-no-violations' };
  }
  for (const v of p0) {
    const mode = v?.fix?.mode;
    if (mode !== 'autoFixable') return { fixable: false, reason: `p0-not-autofixable:${v.skill}` };
  }
  if (isPhysicallyInfeasible(alt, opts.areaRatio)) {
    return { fixable: false, reason: 'physically-infeasible' };
  }
  return { fixable: true, reason: 'ok' };
}

/**
 * @param {object} input
 * @param {object|null} input.importError - if set, import/schema failed
 * @param {object} [input.report] - measure report
 * @param {object} [input.alt]
 * @param {object|null} [input.structureResult] - { verdict }
 * @param {boolean} [input.structureRequested]
 * @param {object|null} [input.lintResult] - { passed }
 * @param {boolean} [input.lintRequested]
 * @param {object|null} [input.vulnReport]
 * @param {boolean} [input.vulnGate]
 * @param {object|null} [input.contractEval] - evaluate() result
 * @param {boolean} [input.contractRequested]
 * @param {boolean} [input.humanOnUnfixable]
 * @param {object} [input.paths]
 * @param {string[]} [input.fixCmd]
 */
export function foldDecision(input = {}) {
  const reasons = [];
  const candidates = []; // { priority, decision }

  const push = (priority, decision, reason) => {
    if (reason) reasons.push(reason);
    candidates.push({ priority, decision });
  };

  if (input.importError) {
    push(PRI.regenerate_import, 'regenerate', {
      code: 'IMPORT_FAIL',
      tier: 'P0',
      detail: String(input.importError.message || input.importError),
      fixable: false,
    });
  }

  const report = input.report;
  const alt = input.alt;
  const scores = {
    hardIntegrityScore: report?.summary?.hardIntegrityScore ?? null,
    measuredAestheticScore: report?.summary?.measuredAestheticScore ?? null,
    coverageScore: report?.summary?.coverageScore ?? null,
  };

  if (input.structureRequested) {
    const v = input.structureResult?.verdict;
    if (v === 'fail') {
      push(PRI.regenerate_structure, 'regenerate', {
        code: 'STRUCTURE_FAIL',
        tier: 'P0',
        detail: `structure.verify=${v} expected=${input.structureResult?.expected || ''}`,
        fixable: false,
      });
    }
  }

  if (report && !input.importError) {
    const hard = scores.hardIntegrityScore;
    if (typeof hard === 'number' && hard < 1) {
      const fx = p0Fixable(report, alt, input);
      const p0 = collectP0Violations(report);
      for (const v of p0) {
        reasons.push({
          code: v.skill === 'collision' ? 'P0_COLLISION' : v.skill === 'boundary' ? 'P0_BOUNDARY' : `P0_${String(v.skill).toUpperCase()}`,
          tier: 'P0',
          detail: v.message || `${v.skill}:${v.metric}=${v.measured}`,
          fixable: v?.fix?.mode === 'autoFixable',
        });
      }
      if (p0.length === 0) {
        reasons.push({
          code: 'P0_HARD_INTEGRITY',
          tier: 'P0',
          detail: `hardIntegrityScore=${hard}`,
          fixable: false,
        });
      }
      if (fx.fixable) {
        candidates.push({ priority: PRI.fix_geometry, decision: 'fix_geometry' });
      } else if (input.humanOnUnfixable) {
        candidates.push({ priority: PRI.regenerate_unfixable, decision: 'human' });
        reasons.push({ code: 'UNFIXABLE_P0', tier: 'P0', detail: fx.reason, fixable: false });
      } else {
        candidates.push({ priority: PRI.regenerate_unfixable, decision: 'regenerate' });
        if (!reasons.some((r) => r.code === 'UNFIXABLE_P0')) {
          reasons.push({ code: 'UNFIXABLE_P0', tier: 'P0', detail: fx.reason, fixable: false });
        }
      }
    }
  }

  if (input.lintRequested && input.lintResult && !input.lintResult.passed) {
    push(PRI.regenerate_lint, 'regenerate', {
      code: 'LINT_FAIL',
      tier: 'P1',
      detail: `token violations=${(input.lintResult.violations || []).length}`,
      fixable: false,
    });
  }

  if (input.vulnGate && input.vulnReport) {
    const high = (input.vulnReport.vulnerabilities || []).filter((v) => v.severity === 'high');
    if (high.length) {
      for (const v of high) {
        reasons.push({
          code: `VULN_${String(v.id || 'high').toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`,
          tier: 'P1',
          detail: v.title || v.id || 'high vuln',
          fixable: false,
        });
      }
      candidates.push({ priority: PRI.regenerate_vuln, decision: 'regenerate' });
    }
  } else if (input.vulnReport && !input.vulnGate) {
    // advisory only — attach low-weight reasons without changing decision
    for (const v of (input.vulnReport.vulnerabilities || []).filter((x) => x.severity === 'high').slice(0, 5)) {
      reasons.push({
        code: `VULN_ADVISORY_${String(v.id || 'x').toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`,
        tier: 'advisory',
        detail: v.title || v.id || 'advisory',
        fixable: false,
      });
    }
  }

  if (input.contractRequested && input.contractEval && !input.contractEval.allPass) {
    const fails = (input.contractEval.criteria || []).filter((c) => !c.passed && !P0_SKILLS.includes(c.skill));
    if (fails.length) {
      for (const c of fails.slice(0, 12)) {
        reasons.push({
          code: 'CONTRACT_FAIL',
          tier: 'P2',
          detail: c.criterion || `${c.skill}.${c.metric}`,
          fixable: false,
        });
      }
      candidates.push({ priority: PRI.regenerate_contract, decision: 'regenerate' });
    }
  }

  if (report && typeof scores.coverageScore === 'number' && scores.coverageScore === 0) {
    push(PRI.human_coverage, 'human', {
      code: 'COVERAGE_ZERO',
      tier: 'P0',
      detail: 'coverageScore=0 — all axes unmeasurable',
      fixable: false,
    });
  }

  if (candidates.length === 0) {
    push(PRI.pass, 'pass', null);
  }

  candidates.sort((a, b) => a.priority - b.priority || a.decision.localeCompare(b.decision));
  const decision = candidates[0].decision;

  // stable reason order: code then detail
  reasons.sort((a, b) => String(a.code).localeCompare(b.code) || String(a.detail).localeCompare(b.detail));

  const next = {
    action: NEXT[decision] || 'stop',
    loop_hint_max: 3,
  };
  if (decision === 'fix_geometry' && input.fixCmd) {
    next.fix_cmd = input.fixCmd;
  }

  return {
    schema: 'aesthete.decision/v1',
    schema_version: 1,
    decision,
    reasons,
    scores,
    paths: input.paths || {},
    next,
  };
}

export function decisionExitCode(decision, usageError = false) {
  if (usageError) return 2;
  if (decision === 'pass') return 0;
  if (decision === 'human') return 2;
  if (decision === 'fix_geometry' || decision === 'regenerate') return 1;
  return 1;
}

/** Strip volatile paths for golden byte compare */
export function stableDecision(decisionObj) {
  const d = JSON.parse(JSON.stringify(decisionObj));
  if (d.paths) {
    for (const k of Object.keys(d.paths)) d.paths[k] = d.paths[k] ? `<${k}>` : null;
  }
  if (d.next?.fix_cmd) d.next.fix_cmd = d.next.fix_cmd.map((x) => (String(x).includes('/') ? pathBasename(x) : x));
  return d;
}

function pathBasename(p) {
  const s = String(p);
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i >= 0 ? s.slice(i + 1) : s;
}
