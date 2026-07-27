#!/usr/bin/env bun
// aesthete-gate — CI entry: same fold as skill-post, exit codes from decision.

import { writeJson, isMain } from './shared/cli.mjs';
import { parsePostArgs } from './skill-post-args.mjs';
import {
  runPost,
  decisionExitCode,
  receiptInputExitCode,
} from './skill-post.mjs';
import { resolveOutDir } from './skill-pre.mjs';
import { ReceiptInputError } from './skill-snapshot.mjs';

async function main() {
  const { inputPath, flags, outDirFlag } = parsePostArgs(
    process.argv.slice(2),
  );

  let outDir;
  try {
    outDir = resolveOutDir(outDirFlag);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  try {
    const {
      decision,
      report,
      structureResult,
      lintResult,
      vulnReport,
      slopReport,
      contractEval,
      paths,
    } = await runPost(inputPath, {
      flags,
      outDir,
    });

    if (report && paths.report) writeJson(paths.report, report);
    if (vulnReport && paths.vuln) writeJson(paths.vuln, vulnReport);
    if (structureResult && paths.structure) writeJson(paths.structure, structureResult);
    if (slopReport && paths.slop) writeJson(paths.slop, slopReport);
    if (contractEval && paths.contract_eval) writeJson(paths.contract_eval, contractEval);
    writeJson(paths.decision, decision);

    const code = decisionExitCode(decision.decision, false);
    console.log(
      `gate decision=${decision.decision} exit=${code} | hard=${decision.scores.hardIntegrityScore} | ${paths.decision}`,
    );
    process.exit(code);
  } catch (e) {
    if (e instanceof ReceiptInputError) {
      console.error(`${e.code}: ${e.message}`);
    } else {
      console.error(e.message || e);
    }
    process.exit(receiptInputExitCode(e));
  }
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    if (error instanceof ReceiptInputError) {
      console.error(`${error.code}: ${error.message}`);
    } else {
      console.error(error?.message || error);
    }
    process.exit(receiptInputExitCode(error));
  });
}
