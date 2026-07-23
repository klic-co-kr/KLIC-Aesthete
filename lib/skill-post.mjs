#!/usr/bin/env bun
// aesthete-post — one-shot post gate for agents.
// artifact → decision JSON. Non-destructive (never writes the input artifact).
// Whitelist: measure, contract.evaluate, structure.verify, vuln.scanAlt, lint tokens.

import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, parseArgs, isMain } from './shared/cli.mjs';
import { validate } from './shared/validator.mjs';
import { detectDomain, importPath } from './adapters/index.mjs';
import { measureAlt } from './measure.mjs';
import { evaluate } from './contract.mjs';
import { verifyStructure } from './structure.mjs';
import { scanAlt } from './vuln.mjs';
import { scanSlop } from './slop.mjs';
import { lint } from './tokens.mjs';
import { foldDecision, decisionExitCode } from './skill-decision.mjs';
import { resolveOutDir } from './skill-pre.mjs';

export function loadArtifact(inputPath, flags = {}) {
  const domain = detectDomain(inputPath, flags.domain);
  const opts = { domain };
  if (flags.slide) opts.slide = Number(flags.slide);
  const alt = domain === 'alt' ? readJson(inputPath) : importPath(inputPath, opts);
  return { alt, domain };
}

/**
 * Pure-ish orchestration (I/O for reads only). Returns { decision, report, ... }.
 */
export async function runPost(inputPath, opts = {}) {
  const flags = opts.flags || {};
  const outDir = opts.outDir;
  const paths = {
    report: outDir ? path.join(outDir, 'report.json') : null,
    vuln: null,
    structure: null,
    contract_eval: null,
    slop: null,
    decision: outDir ? path.join(outDir, 'decision.json') : null,
  };

  let alt;
  let importError = null;
  try {
    ({ alt } = loadArtifact(inputPath, flags));
    await validate('alt', alt);
  } catch (e) {
    importError = e;
    alt = null;
  }

  let report = null;
  if (alt) {
    report = measureAlt(alt, { profile: typeof flags.profile === 'string' ? flags.profile : undefined });
  }

  let structureResult = null;
  const structureRequested = typeof flags.structure === 'string' && flags.structure;
  if (alt && structureRequested) {
    structureResult = verifyStructure(alt, flags.structure);
    if (outDir) {
      paths.structure = path.join(outDir, 'structure.json');
    }
  }

  let lintResult = null;
  const lintRequested = Boolean(flags.lint);
  if (alt && lintRequested) {
    lintResult = lint(alt);
  }

  let vulnReport = null;
  // Always optional: generate advisory file only if --vuln or --vuln-gate
  const wantVuln = Boolean(flags.vuln) || Boolean(flags['vuln-gate']);
  if (alt && wantVuln) {
    const artifactType = typeof flags.type === 'string' ? flags.type : undefined;
    vulnReport = scanAlt(alt, { artifact_type: artifactType });
    if (outDir) paths.vuln = path.join(outDir, 'vuln.json');
  }

  let slopReport = null;
  const wantSlop = Boolean(flags.slop) || Boolean(flags['slop-gate']) || Boolean(flags['slop-autofix']);
  if (alt && wantSlop) {
    // slop v1 = HTML only. Read the RAW source text (the alt adapter drops CSS flow); for
    // non-html inputs slop reports coverage.html = unmeasurable (no false finding).
    let html = '';
    try {
      const domain = detectDomain(inputPath, flags.domain);
      if (domain === 'html') html = fs.readFileSync(inputPath, 'utf8');
    } catch { html = ''; }
    const artifactType = typeof flags.type === 'string' ? flags.type : undefined;
    slopReport = scanSlop({ alt, medium: 'html', html, opts: { artifact_type: artifactType } });
    if (outDir) {
      paths.slop = path.join(outDir, 'slop.json');
      writeJson(paths.slop, slopReport);
    }
  }

  let contractEval = null;
  const contractRequested = typeof flags.contract === 'string' && flags.contract;
  if (report && contractRequested) {
    const contract = readJson(flags.contract);
    contractEval = evaluate(report, contract);
    if (outDir) paths.contract_eval = path.join(outDir, 'contract-eval.json');
  }

  const fixCmd = [
    'bun',
    'lib/fix.mjs',
    inputPath,
    ...(contractRequested ? ['--contract', flags.contract] : []),
  ];

  const decision = foldDecision({
    importError,
    report,
    alt,
    structureResult,
    structureRequested: Boolean(structureRequested),
    lintResult,
    lintRequested,
    vulnReport,
    vulnGate: Boolean(flags['vuln-gate']),
    slopReport,
    slopGate: Boolean(flags['slop-gate']),
    slopAutofix: Boolean(flags['slop-autofix']),
    contractEval,
    contractRequested: Boolean(contractRequested),
    humanOnUnfixable: Boolean(flags['human-on-unfixable']),
    paths,
    fixCmd,
  });

  return {
    decision,
    report,
    structureResult,
    lintResult,
    vulnReport,
    slopReport,
    contractEval,
    paths,
    alt,
  };
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const inputPath = positional[0];
  if (!inputPath) {
    console.error(
      'usage: bun lib/skill-post.mjs <artifact> [--contract c.json] [--type TYPE] [--structure ID] [--lint] [--vuln] [--vuln-gate] [--slop] [--slop-gate] [--slop-autofix] [--human-on-unfixable] [--out-dir DIR]',
    );
    process.exit(2);
  }

  let outDir;
  try {
    outDir = resolveOutDir(flags['out-dir']);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  fs.mkdirSync(outDir, { recursive: true });

  // snapshot input bytes for non-destructive assertion in tests (CLI still never writes input)
  const { decision, report, structureResult, lintResult, vulnReport, slopReport, contractEval, paths } = await runPost(inputPath, {
    flags,
    outDir,
  });

  if (report && paths.report) writeJson(paths.report, report);
  if (vulnReport && paths.vuln) writeJson(paths.vuln, vulnReport);
  if (structureResult && paths.structure) writeJson(paths.structure, structureResult);
  if (slopReport && paths.slop) writeJson(paths.slop, slopReport);
  if (contractEval && paths.contract_eval) writeJson(paths.contract_eval, contractEval);
  writeJson(paths.decision, decision);

  const hard = decision.scores.hardIntegrityScore;
  console.log(
    `post decision=${decision.decision} | hard=${hard} | reasons=${decision.reasons.length} | ${paths.decision}`,
  );

  // post CLI always exit 0 on successful evaluation (gate owns CI exits)
  // usage/import hard failures still exit 1 so scripts notice
  if (decision.decision === 'regenerate' && decision.reasons.some((r) => r.code === 'IMPORT_FAIL')) {
    process.exit(1);
  }
}

if (isMain(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}

export { decisionExitCode };
