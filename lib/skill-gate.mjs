#!/usr/bin/env bun
// aesthete-gate — CI entry: same fold as skill-post, exit codes from decision.

import fs from 'node:fs';
import path from 'node:path';
import { writeJson, parseArgs, isMain } from './shared/cli.mjs';
import { runPost, decisionExitCode } from './skill-post.mjs';
import { resolveOutDir } from './skill-pre.mjs';

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const inputPath = positional[0];
  if (!inputPath) {
    console.error(
      'usage: bun lib/skill-gate.mjs <artifact> [--contract c.json] [--type TYPE] [--structure ID] [--lint] [--vuln-gate] [--human-on-unfixable] [--out-dir DIR]',
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

  try {
    const { decision, report, structureResult, lintResult, vulnReport, contractEval, paths } = await runPost(inputPath, {
      flags,
      outDir,
    });

    if (report && paths.report) writeJson(paths.report, report);
    if (vulnReport && paths.vuln) writeJson(paths.vuln, vulnReport);
    if (structureResult && paths.structure) writeJson(paths.structure, structureResult);
    if (contractEval && paths.contract_eval) writeJson(paths.contract_eval, contractEval);
    writeJson(paths.decision, decision);

    const code = decisionExitCode(decision.decision, false);
    console.log(
      `gate decision=${decision.decision} exit=${code} | hard=${decision.scores.hardIntegrityScore} | ${paths.decision}`,
    );
    process.exit(code);
  } catch (e) {
    console.error(e.message || e);
    process.exit(2);
  }
}

if (isMain(import.meta.url)) {
  main();
}
