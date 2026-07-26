#!/usr/bin/env bun
// aesthete-post — one-shot post gate for agents.
// artifact → decision JSON. Non-destructive (never writes the input artifact).
// Whitelist: measure, contract.evaluate, structure.verify, vuln.scanAlt, lint tokens.

import fs from 'node:fs';
import path from 'node:path';
import {
  writeJson,
  parseArgs,
  isMain,
  skillRoot,
} from './shared/cli.mjs';
import { parseJsonStrict } from './shared/canonical-json.mjs';
import { createRunValidator } from './shared/validator.mjs';
import {
  importBuffer,
  SUPPORTED_DOMAINS,
} from './adapters/index.mjs';
import { measureAlt } from './measure.mjs';
import { evaluate } from './contract.mjs';
import { verifyStructure } from './structure.mjs';
import { scanAlt } from './vuln.mjs';
import { scanSlop } from './slop.mjs';
import { lint } from './tokens.mjs';
import { foldDecision, decisionExitCode } from './skill-decision.mjs';
import { resolveOutDir } from './skill-pre.mjs';
import {
  buildClaimScope,
  buildDecisionBinding,
} from './skill-receipt-core.mjs';
import { buildFixAction } from './skill-action.mjs';
import {
  captureInstallationManifest,
  captureRuntime,
  captureSchemaBundle,
  createOperationIo,
  DEFAULT_IO,
  normalizePostPolicy,
  ReceiptInputError,
  resolveEffectiveParams,
  resolveEffectiveTokens,
  snapshotArtifact,
  snapshotContract,
} from './skill-snapshot.mjs';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
  return isRecord(value)
    && Object.keys(value).every((key) => allowed.includes(key));
}

function normalizeSlide(value) {
  if (value === undefined || value === null) return undefined;
  if (
    typeof value === 'string'
    && /^[1-9][0-9]*$/.test(value)
  ) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  } else if (Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  throw new ReceiptInputError(
    'SLIDE_INVALID',
    `slide must be a canonical safe positive integer: ${String(value)}`,
  );
}

function normalizeOptionalPolicyString(value, field, {
  rejectFlag = false,
} = {}) {
  if (value === undefined || value === null || value === '') return null;
  if (
    typeof value !== 'string'
    || (rejectFlag && value.startsWith('--'))
  ) {
    throw new ReceiptInputError(
      'POLICY_INPUT_INVALID',
      `${field} must be a non-flag string or null`,
    );
  }
  return value;
}

function normalizeContractPath(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length === 0) {
    throw new ReceiptInputError(
      'CONTRACT_INPUT_INVALID',
      'requested contract path must be a non-empty string',
    );
  }
  try {
    return path.resolve(value);
  } catch (error) {
    throw new ReceiptInputError(
      'CONTRACT_INPUT_INVALID',
      `requested contract path is invalid: ${error.message}`,
    );
  }
}

function normalizeDomain(value) {
  if (value === undefined || value === null) return undefined;
  if (!SUPPORTED_DOMAINS.includes(value)) {
    throw new ReceiptInputError(
      'DOMAIN_INVALID',
      `unsupported explicit domain: ${String(value)}`,
    );
  }
  return value;
}

function normalizeArtifactPath(inputPath) {
  if (typeof inputPath !== 'string' || inputPath.length === 0) {
    throw new Error('artifact path must be a non-empty string');
  }
  return path.resolve(inputPath);
}

function normalizePostFlags(flags = {}) {
  if (!isRecord(flags)) {
    throw new ReceiptInputError(
      'POLICY_INPUT_INVALID',
      'post flags must be an object',
    );
  }
  return {
    domain: normalizeDomain(flags.domain),
    slide: normalizeSlide(flags.slide),
    contractPath: normalizeContractPath(flags.contract),
    profile: normalizeOptionalPolicyString(flags.profile, 'profile', {
      rejectFlag: true,
    }),
    structure: normalizeOptionalPolicyString(flags.structure, 'structure'),
    type: normalizeOptionalPolicyString(flags.type, 'artifact type'),
    lint: Boolean(flags.lint),
    vuln: Boolean(flags.vuln),
    vulnGate: Boolean(flags['vuln-gate']),
    slop: Boolean(flags.slop),
    slopGate: Boolean(flags['slop-gate']),
    slopAutofix: Boolean(flags['slop-autofix']),
    humanOnUnfixable: Boolean(flags['human-on-unfixable']),
  };
}

function normalizeRunContext(deps = {}) {
  if (!hasOnlyKeys(deps, ['io', 'root', 'runtime', 'loadAjv'])) {
    throw new ReceiptInputError(
      'INSTALLATION_INPUT_INVALID',
      'post dependencies contain unknown fields',
    );
  }
  if (
    deps.io !== undefined
    && (!isRecord(deps.io) || typeof deps.io.readFile !== 'function')
  ) {
    throw new ReceiptInputError(
      'INSTALLATION_INPUT_INVALID',
      'post dependency io must provide readFile',
    );
  }
  let root;
  let executable;
  const runtime = deps.runtime === undefined ? process : deps.runtime;
  try {
    root = path.resolve(deps.root === undefined ? skillRoot() : deps.root);
  } catch (error) {
    throw new ReceiptInputError(
      'INSTALLATION_INPUT_INVALID',
      `skill root is invalid: ${error.message}`,
    );
  }
  try {
    if (typeof runtime.execPath !== 'string' || runtime.execPath.length === 0) {
      throw new Error('runtime executable locator is missing');
    }
    executable = path.resolve(runtime.execPath);
  } catch (error) {
    throw new ReceiptInputError(
      'BUN_REQUIRED',
      `receipt-backed runtime executable is invalid: ${error.message}`,
    );
  }
  return {
    root,
    runtime,
    executable,
    io: createOperationIo(deps.io === undefined ? DEFAULT_IO : deps.io),
    loadAjv: deps.loadAjv,
  };
}

function importArtifactSnapshot(snapshot) {
  if (snapshot.adapter === 'alt') {
    return parseJsonStrict(snapshot.bytes, 'artifact');
  }
  return importBuffer(snapshot.bytes, snapshot.adapter, {
    domain: snapshot.adapter,
    ...(snapshot.effective_slide === null
      ? {}
      : { slide: snapshot.effective_slide }),
  });
}

function validateRequestedContract(contractPath, io, validator) {
  let snapshot;
  try {
    snapshot = snapshotContract(contractPath, io);
    validator.validate('contract', snapshot.value);
    return snapshot;
  } catch (error) {
    if (
      error instanceof ReceiptInputError
      && error.code === 'CONTRACT_INPUT_INVALID'
    ) {
      throw error;
    }
    throw new ReceiptInputError(
      'CONTRACT_INPUT_INVALID',
      `contract input invalid: ${error.message}`,
    );
  }
}

function validateActionContract(contractPath, io, validator) {
  try {
    const snapshot = snapshotContract(contractPath, io);
    validator.validate('contract', snapshot.value);
    return snapshot;
  } catch (error) {
    throw new ReceiptInputError(
      'ACTION_CONTRACT_INVALID',
      `action contract input invalid: ${error.message}`,
    );
  }
}

export function loadArtifact(inputPath, flags = {}, deps = {}) {
  const normalized = normalizePostFlags(flags);
  const artifactPath = normalizeArtifactPath(inputPath);
  const io = createOperationIo(deps.io === undefined ? DEFAULT_IO : deps.io);
  const snapshot = snapshotArtifact(artifactPath, {
    domain: normalized.domain,
    slide: normalized.slide,
  }, io);
  if (snapshot.status !== 'bound') throw snapshot.error;
  return {
    alt: importArtifactSnapshot(snapshot),
    domain: snapshot.adapter,
  };
}

/**
 * Pure-ish orchestration (I/O for reads only). Returns { decision, report, ... }.
 */
export async function runPost(inputPath, opts = {}) {
  if (!isRecord(opts)) {
    throw new ReceiptInputError(
      'POLICY_INPUT_INVALID',
      'post options must be an object',
    );
  }
  const flags = normalizePostFlags(
    opts.flags === undefined ? {} : opts.flags,
  );
  const artifactPath = normalizeArtifactPath(inputPath);
  const context = normalizeRunContext(
    opts.deps === undefined ? {} : opts.deps,
  );
  const outDir = opts.outDir;
  const paths = {
    report: outDir ? path.join(outDir, 'report.json') : null,
    vuln: null,
    structure: null,
    contract_eval: null,
    slop: null,
    decision: outDir ? path.join(outDir, 'decision.json') : null,
  };

  const runtime = captureRuntime(context.runtime);
  const schemas = captureSchemaBundle(context.root, context.io);
  const validator = await createRunValidator(schemas, context.loadAjv);
  const installation = captureInstallationManifest(context.root, context.io);
  const params = resolveEffectiveParams(
    context.root,
    flags.profile,
    context.io,
  );
  const tokens = flags.lint
    ? resolveEffectiveTokens(context.root, context.io)
    : null;
  const requestedContract = flags.contractPath === null
    ? null
    : validateRequestedContract(flags.contractPath, context.io, validator);

  const artifact = snapshotArtifact(artifactPath, {
    domain: flags.domain,
    slide: flags.slide,
  }, context.io);
  let alt;
  let importError = null;
  if (artifact.status === 'unreadable') {
    importError = artifact.error || new Error('artifact is unreadable');
    alt = null;
  } else {
    try {
      alt = importArtifactSnapshot(artifact);
      validator.validate('alt', alt);
    } catch (error) {
      importError = error;
      alt = null;
    }
  }

  let report = null;
  if (alt) {
    report = measureAlt(alt, {
      profile: flags.profile || undefined,
      params,
    });
    validator.validate('report', report);
  }

  let structureResult = null;
  const structureRequested = flags.structure !== null;
  if (alt && structureRequested) {
    structureResult = verifyStructure(alt, flags.structure);
    if (outDir) {
      paths.structure = path.join(outDir, 'structure.json');
    }
  }

  let lintResult = null;
  const lintRequested = flags.lint;
  if (alt && lintRequested) {
    lintResult = lint(alt, { tokens });
  }

  let vulnReport = null;
  // Always optional: generate advisory file only if --vuln or --vuln-gate
  const wantVuln = flags.vuln || flags.vulnGate;
  if (alt && wantVuln) {
    const artifactType = flags.type || undefined;
    vulnReport = scanAlt(alt, { artifact_type: artifactType });
    if (outDir) paths.vuln = path.join(outDir, 'vuln.json');
  }

  let slopReport = null;
  const wantSlop = flags.slop || flags.slopGate || flags.slopAutofix;
  if (alt && wantSlop) {
    // Slop v1 needs raw HTML because the adapter drops CSS flow. Reuse the
    // captured artifact bytes so import and scanning make one coherent claim.
    const html = artifact.adapter === 'html'
      ? artifact.bytes.toString('utf8')
      : '';
    const artifactType = flags.type || undefined;
    slopReport = scanSlop({ alt, medium: 'html', html, opts: { artifact_type: artifactType } });
    if (outDir) paths.slop = path.join(outDir, 'slop.json');
  }

  let contractEval = null;
  const contractRequested = requestedContract !== null;
  if (report && contractRequested) {
    contractEval = evaluate(report, requestedContract.value);
    if (outDir) paths.contract_eval = path.join(outDir, 'contract-eval.json');
  }

  const foldInput = {
    importError,
    report,
    alt,
    structureResult,
    structureRequested: Boolean(structureRequested),
    lintResult,
    lintRequested,
    vulnReport,
    vulnRequested: wantVuln,
    vulnGate: flags.vulnGate,
    slopReport,
    slopRequested: wantSlop,
    slopGate: flags.slopGate,
    slopAutofix: flags.slopAutofix,
    contractEval,
    contractRequested,
    humanOnUnfixable: flags.humanOnUnfixable,
    paths,
  };
  const decision = foldDecision(foldInput);
  decision.claim_scope = buildClaimScope(foldInput);

  let actionInputs = { status: 'not_required' };
  if (decision.decision === 'fix_geometry') {
    const actionContractPath = requestedContract
      ? flags.contractPath
      : path.join(context.root, 'examples', 'catalog.contract.json');
    const actionContract = requestedContract || validateActionContract(
      actionContractPath,
      context.io,
      validator,
    );
    const action = buildFixAction({
      executable: context.executable,
      skillRoot: context.root,
      artifactPath,
      contractPath: actionContractPath,
      contractBytes: actionContract.bytes,
      adapter: artifact.adapter,
      slide: artifact.effective_slide,
      profile: flags.profile,
    });
    decision.next.fix_cmd = action.command;
    actionInputs = action.action_inputs;
  }

  const policy = normalizePostPolicy({
    adapter: artifact.adapter,
    slide: artifact.effective_slide,
    profile: flags.profile,
    structure: flags.structure,
    type: flags.type,
    lint: flags.lint,
    vuln: flags.vuln,
    vulnGate: flags.vulnGate,
    slop: flags.slop,
    slopGate: flags.slopGate,
    slopAutofix: flags.slopAutofix,
    humanOnUnfixable: flags.humanOnUnfixable,
    params,
    tokens,
    schemas: schemas.manifest,
    installation,
    validator,
    runtime,
  });
  const bindingInput = {
    decision,
    completeness: artifact.status === 'bound' ? 'complete' : 'incomplete',
    artifact_sha256: artifact.sha256,
    contract: requestedContract
      ? { status: 'bound', sha256: requestedContract.sha256 }
      : { status: 'not_requested', sha256: null },
    action_inputs: actionInputs,
    policy,
  };
  if (artifact.status !== 'bound') {
    bindingInput.artifact = { status: 'unreadable', sha256: null };
  }
  decision.binding = buildDecisionBinding(bindingInput);
  validator.validate('decision', decision);

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
    artifactSnapshot: artifact,
  };
}

export const receiptInputExitCode = (error) => (
  error instanceof ReceiptInputError ? 2 : 1
);

function writeCliError(error) {
  if (error instanceof ReceiptInputError) {
    console.error(`${error.code}: ${error.message}`);
  } else {
    console.error(error?.message || error);
  }
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const inputPath = positional[0];
  if (!inputPath) {
    console.error(
      'usage: bun lib/skill-post.mjs <artifact> [--domain DOMAIN] [--slide N] [--profile NAME] [--contract c.json] [--type TYPE] [--structure ID] [--lint] [--vuln] [--vuln-gate] [--slop] [--slop-gate] [--slop-autofix] [--human-on-unfixable] [--out-dir DIR]',
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
    writeCliError(e);
    process.exit(receiptInputExitCode(e));
  });
}

export { decisionExitCode };
