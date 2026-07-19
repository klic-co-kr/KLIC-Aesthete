#!/usr/bin/env node
// 인지심리 하네스 — 자동화 통합 평가.
// 프론트메타(@design)에서 디자인 스펙을 읽어, 인지 스킬(9개) 측정 + 디자인 토큰 준수 lint를
// 한 번에 수행한다. HTML은 선언된 팔레트/시맨틱 토큰을 위반하면 위반으로 보고(exit 1).
//
//   bun lib/harness.mjs <file> [--contract c.json]
//
// @design 블록 예시(HTML 선두):
//   <!-- @design { "palette":["#1A73E8","#111827","#FFFFFF"], "fontScale":[16,24,32],
//                  "tokens":{"color":{"primary":"#1A73E8","text":"#111827"}} } -->

import fs from 'node:fs';
import { parseDesignSpec, buildDesignTokens } from './designspec.mjs';
import { importPath, detectDomain } from './adapters/index.mjs';
import { measureAlt } from './measure.mjs';
import { evaluate, defaultContract } from './contract.mjs';
import { lint } from './tokens.mjs';
import { readJson, parseArgs, isMain } from './shared/cli.mjs';
import { validate } from './shared/validator.mjs';

export async function harness(filePath, opts = {}) {
  const source = fs.readFileSync(filePath, 'utf8');
  const spec = parseDesignSpec(source, filePath);
  const domain = detectDomain(filePath, opts.domain);
  let alt = domain === 'alt' ? JSON.parse(source) : importPath(filePath, { domain });
  await validate('alt', alt);
  if (spec) alt.meta.design = spec; // HTML export 등이 디자인을 따르도록 부착(전파)

  const report = measureAlt(alt);
  const contract = spec?.contract || (opts.contract ? readJson(opts.contract) : defaultContract(''));

  // --fix: 인지 평가 후 보정 루프 실행 → 재측정
  let fixed = null;
  if (opts.fix) {
    const { fixAlt } = await import('./fix.mjs');
    const result = fixAlt(alt, contract, opts.maxIters || 5);
    fixed = { alt: result.fixed, outcome: result.outcome, report: result.report };
    alt = result.fixed;
  }

  const report2 = fixed ? fixed.report : report;
  const cognitive = evaluate(report2, contract);

  const designTokens = buildDesignTokens(spec);
  const tokenLint = designTokens ? lint(alt, { tokens: designTokens }) : null;

  return {
    file: filePath,
    domain,
    designPresent: !!spec,
    cognitive: {
      verdict: cognitive.verdict,
      score: cognitive.score,
      passing: cognitive.criteria.filter((c) => c.passed).length,
      total: cognitive.criteria.length,
      failing: cognitive.criteria.filter((c) => !c.passed).map((c) => c.criterion),
    },
    design: spec ? {
      palette: spec.palette.length,
      fontScale: spec.fontScale.length,
      tokenPassed: tokenLint.passed,
      tokenViolations: tokenLint.violations.length,
      violations: tokenLint.violations,
    } : null,
    overallScore: report2.summary.overallScore,
    measuredAestheticScore: report2.summary.measuredAestheticScore,
    coverageScore: report2.summary.coverageScore,
    fixed: fixed ? { outcome: fixed.outcome, score: fixed.report.summary.measuredAestheticScore } : null,
    report: report2,
  };
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const file = positional[0];
  if (!file) {
    console.error('usage: bun lib/harness.mjs <file> [--contract c.json]');
    process.exit(2);
  }
  const r = await harness(file, { contract: flags.contract, fix: Boolean(flags.fix), maxIters: Number(flags['max-iters']) || 5 });
  console.log(`=== aesthete harness: ${file} (${r.domain}) ===`);
  if (r.fixed) console.log(`보정       : ${r.fixed.outcome} | measured ${r.fixed.score}`);
  console.log(`인지 스킬 : ${r.cognitive.verdict} | ${r.cognitive.passing}/${r.cognitive.total} criteria | measured ${r.measuredAestheticScore} (coverage ${r.coverageScore})`);
  if (r.cognitive.failing.length) console.log(`  FAIL: ${r.cognitive.failing.join(', ')}`);
  if (r.designPresent) {
    console.log(`디자인 토큰: ${r.design.tokenPassed ? 'PASS' : 'REJECT'} | palette ${r.design.palette}·fontScale ${r.design.fontScale} | 위반 ${r.design.tokenViolations}`);
    for (const v of r.design.violations) console.log('  - ' + v.message);
  } else {
    console.log('디자인 토큰: @design 스펙 없음 — 기본 토큰 검사 생략');
  }
  const ok = r.cognitive.verdict === 'pass' && (!r.designPresent || r.design.tokenPassed);
  console.log(`\n→ ${ok ? 'PASS' : 'FAIL'}`);
  process.exit(ok ? 0 : 1);
}

if (isMain(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
