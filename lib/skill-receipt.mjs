#!/usr/bin/env bun
// aesthete-receipt — strict freshness verification for stored post/gate decisions.

import path from 'node:path';
import { SUPPORTED_DOMAINS } from './adapters/index.mjs';
import {
  parseJsonStrict,
} from './shared/canonical-json.mjs';
import {
  isMain,
  skillRoot,
  writeJson,
} from './shared/cli.mjs';
import { createRunValidator } from './shared/validator.mjs';
import {
  buildFixAction,
  inspectStoredFixAction,
} from './skill-action.mjs';
import {
  ReceiptCurrentInputError,
  validateReceiptShape,
  verifyDecisionBinding,
} from './skill-receipt-core.mjs';
import {
  captureInstallationManifest,
  captureRuntime,
  captureSchemaBundle,
  compareCurrentManifest,
  createOperationIo,
  DEFAULT_IO,
  normalizePostPolicy,
  ReceiptInputError,
  resolveEffectiveParams,
  resolveEffectiveTokens,
  snapshotArtifact,
  snapshotContract,
  snapshotIntent,
} from './skill-snapshot.mjs';

const VALUE_FLAGS = new Set([
  'contract',
  'intent',
  'domain',
  'slide',
  'profile',
  'structure',
  'type',
  'out',
]);
const PRESENCE_FLAGS = new Set([
  'lint',
  'vuln',
  'vuln-gate',
  'slop',
  'slop-gate',
  'slop-autofix',
  'human-on-unfixable',
]);
const CANONICAL_SLIDE = /^[1-9][0-9]*$/;
const NOT_REQUIRED_ACTION = Object.freeze({
  status: 'not_required',
  runtime_executable_locator_sha256: null,
  script_locator_sha256: null,
  artifact_locator_sha256: null,
  contract_locator_sha256: null,
  contract_sha256: null,
  adapter: null,
  slide: null,
  profile: null,
});

export class ReceiptUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReceiptUsageError';
    this.code = 'RECEIPT_USAGE_INVALID';
  }
}

function usageError(message) {
  throw new ReceiptUsageError(message);
}

function parseSlide(value) {
  if (!CANONICAL_SLIDE.test(value)) {
    throw new ReceiptInputError(
      'SLIDE_INVALID',
      'slide must use canonical positive base-10 integer spelling',
    );
  }
  const slide = Number(value);
  if (!Number.isSafeInteger(slide)) {
    throw new ReceiptInputError(
      'SLIDE_INVALID',
      'slide exceeds the safe integer range',
    );
  }
  return slide;
}

export function parseReceiptArgs(argv) {
  if (!Array.isArray(argv) || !argv.every((item) => typeof item === 'string')) {
    usageError('receipt arguments must be a string array');
  }
  if (argv[0] !== 'verify') usageError('usage: receipt verify <decision> <artifact> [flags]');

  const positional = [];
  const flags = {};
  const seen = new Set();
  let outPath = null;

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    if (token === '--' || token.includes('=')) {
      usageError(`unsupported flag spelling: ${token}`);
    }
    const name = token.slice(2);
    if (!VALUE_FLAGS.has(name) && !PRESENCE_FLAGS.has(name)) {
      usageError(`unknown flag: --${name}`);
    }
    if (seen.has(name)) usageError(`duplicate flag: --${name}`);
    seen.add(name);

    if (PRESENCE_FLAGS.has(name)) {
      flags[name] = true;
      continue;
    }

    const value = argv[index + 1];
    if (
      typeof value !== 'string'
      || value.length === 0
      || value.startsWith('--')
    ) {
      usageError(`--${name} requires one non-empty value`);
    }
    index += 1;
    if (name === 'slide') {
      flags.slide = parseSlide(value);
    } else if (name === 'domain') {
      if (!SUPPORTED_DOMAINS.includes(value)) {
        throw new ReceiptInputError(
          'DOMAIN_INVALID',
          `unsupported domain: ${value}`,
        );
      }
      flags.domain = value;
    } else if (name === 'out') {
      outPath = value;
    } else {
      flags[name] = value;
    }
  }

  if (
    positional.length !== 2
    || positional.some((value) => value.length === 0)
  ) {
    usageError('verify requires exactly decision and artifact positionals');
  }
  return {
    command: 'verify',
    decisionPath: positional[0],
    artifactPath: positional[1],
    flags,
    outPath,
  };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
  return isRecord(value)
    && Object.keys(value).every((key) => allowed.includes(key));
}

function normalizePath(value, field, ErrorClass = Error) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ErrorClass(`${field} must be a non-empty string`);
  }
  try {
    return path.resolve(value);
  } catch (error) {
    throw new ErrorClass(`${field} is invalid: ${error.message}`);
  }
}

function normalizeCurrentFlags(flags = {}) {
  if (!isRecord(flags)) {
    throw new ReceiptInputError(
      'POLICY_INPUT_INVALID',
      'verification flags must be an object',
    );
  }
  const allowed = new Set([
    ...VALUE_FLAGS,
    ...PRESENCE_FLAGS,
  ]);
  allowed.delete('out');
  for (const key of Object.keys(flags)) {
    if (!allowed.has(key)) {
      throw new ReceiptInputError(
        'POLICY_INPUT_INVALID',
        `unknown verification policy flag: ${key}`,
      );
    }
  }

  let contractPath = null;
  if (Object.hasOwn(flags, 'contract')) {
    if (
      typeof flags.contract !== 'string'
      || flags.contract.length === 0
      || flags.contract.startsWith('--')
    ) {
      throw new ReceiptInputError(
        'CONTRACT_INPUT_INVALID',
        'contract must be a non-empty path value',
      );
    }
    try {
      contractPath = normalizePath(
        flags.contract,
        'requested contract path',
        Error,
      );
    } catch (error) {
      throw new ReceiptInputError('CONTRACT_INPUT_INVALID', error.message);
    }
  }
  let intentPath = null;
  if (Object.hasOwn(flags, 'intent')) {
    if (
      typeof flags.intent !== 'string'
      || flags.intent.length === 0
      || flags.intent.startsWith('--')
    ) {
      throw new ReceiptInputError(
        'INTENT_INPUT_INVALID',
        'intent must be a non-flag path value',
      );
    }
    try {
      intentPath = normalizePath(
        flags.intent,
        'requested intent path',
        Error,
      );
    } catch (error) {
      throw new ReceiptInputError('INTENT_INPUT_INVALID', error.message);
    }
  }
  let domain;
  if (Object.hasOwn(flags, 'domain')) {
    if (!SUPPORTED_DOMAINS.includes(flags.domain)) {
      throw new ReceiptInputError(
        'DOMAIN_INVALID',
        `unsupported explicit domain: ${String(flags.domain)}`,
      );
    }
    domain = flags.domain;
  }
  let slide;
  if (Object.hasOwn(flags, 'slide')) {
    if (!Number.isSafeInteger(flags.slide) || flags.slide <= 0) {
      throw new ReceiptInputError(
        'SLIDE_INVALID',
        `slide must be a safe positive integer: ${String(flags.slide)}`,
      );
    }
    slide = flags.slide;
  }
  const optionalString = (key) => {
    if (!Object.hasOwn(flags, key)) return null;
    const value = flags[key];
    if (
      typeof value !== 'string'
      || value.length === 0
      || value.startsWith('--')
    ) {
      throw new ReceiptInputError(
        'POLICY_INPUT_INVALID',
        `${key} must be a non-empty policy string`,
      );
    }
    return value;
  };
  for (const key of PRESENCE_FLAGS) {
    if (Object.hasOwn(flags, key) && flags[key] !== true) {
      throw new ReceiptInputError(
        'POLICY_INPUT_INVALID',
        `${key} is a presence-only boolean flag`,
      );
    }
  }
  return {
    contractPath,
    intentPath,
    domain,
    slide,
    profile: optionalString('profile'),
    structure: optionalString('structure'),
    type: optionalString('type'),
    lint: flags.lint === true,
    vuln: flags.vuln === true,
    vulnGate: flags['vuln-gate'] === true,
    slop: flags.slop === true,
    slopGate: flags['slop-gate'] === true,
    slopAutofix: flags['slop-autofix'] === true,
    humanOnUnfixable: flags['human-on-unfixable'] === true,
  };
}

function normalizeContext(deps = {}) {
  if (!hasOnlyKeys(deps, ['io', 'root', 'runtime', 'loadAjv'])) {
    currentInputError('verification dependencies contain unknown fields');
  }
  if (
    deps.io !== undefined
    && (!isRecord(deps.io) || typeof deps.io.readFile !== 'function')
  ) {
    currentInputError('verification io must provide readFile');
  }
  if (deps.loadAjv !== undefined && typeof deps.loadAjv !== 'function') {
    currentInputError('verification loadAjv must be a function');
  }
  const runtime = deps.runtime === undefined ? process : deps.runtime;
  let root;
  let executable;
  try {
    root = path.resolve(deps.root === undefined ? skillRoot() : deps.root);
  } catch (error) {
    throw new ReceiptInputError(
      'INSTALLATION_INPUT_INVALID',
      `skill root is invalid: ${error.message}`,
    );
  }
  try {
    if (typeof runtime?.execPath !== 'string' || runtime.execPath.length === 0) {
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
    runtime,
    root,
    executable,
    io: createOperationIo(deps.io === undefined ? DEFAULT_IO : deps.io),
    loadAjv: deps.loadAjv,
  };
}

function verificationResult(result) {
  return {
    schema: 'aesthete.receipt-verification/v1',
    status: result.status,
    issues: structuredClone(result.issues),
    checked: structuredClone(result.checked || []),
  };
}

function readDecision(decisionPath, io) {
  try {
    return parseJsonStrict(io.readFile(decisionPath), 'decision');
  } catch (error) {
    throw new ReceiptInputError(
      'DECISION_INPUT_INVALID',
      `decision input invalid: ${error.message}`,
    );
  }
}

function validateRequestedContract(contractPath, io, validator) {
  try {
    const snapshot = snapshotContract(contractPath, io);
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

function validateRequestedIntent(intentPath, io, validator) {
  try {
    const snapshot = snapshotIntent(intentPath, io);
    validator.validate('intent', snapshot.value);
    return snapshot;
  } catch (error) {
    if (
      error instanceof ReceiptInputError
      && error.code === 'INTENT_INPUT_INVALID'
    ) {
      throw error;
    }
    throw new ReceiptInputError(
      'INTENT_INPUT_INVALID',
      `intent input invalid: ${error.message}`,
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

function currentInputError(message) {
  throw new ReceiptInputError('CURRENT_INPUT_INVALID', message);
}

export async function verifyReceiptFiles(input, deps = {}) {
  if (!hasOnlyKeys(input, ['decisionPath', 'artifactPath', 'flags'])) {
    currentInputError('verification input contains unknown fields');
  }
  const flags = normalizeCurrentFlags(
    input.flags === undefined ? {} : input.flags,
  );
  let decisionPath;
  try {
    decisionPath = normalizePath(input.decisionPath, 'decision path', Error);
  } catch (error) {
    throw new ReceiptInputError('DECISION_INPUT_INVALID', error.message);
  }
  const artifactPath = normalizePath(
    input.artifactPath,
    'artifact path',
    ReceiptCurrentInputError,
  );
  const context = normalizeContext(deps);
  const decision = readDecision(decisionPath, context.io);

  const shape = validateReceiptShape(decision);
  if (shape.status === 'invalid' || shape.status === 'unbound') {
    return verificationResult({ ...shape, checked: [] });
  }
  if (decision.decision === 'fix_geometry') {
    const actionShape = inspectStoredFixAction(decision);
    if (actionShape.status === 'invalid') {
      return verificationResult({ ...actionShape, checked: [] });
    }
  }
  if (decision.binding.completeness === 'incomplete') {
    return verificationResult({
      status: 'incomplete',
      issues: [{ code: 'ARTIFACT_UNREADABLE' }],
      checked: [],
    });
  }
  const bindingVersion = decision.binding.schema;
  if (
    bindingVersion === 'aesthete.binding/v1'
    && flags.intentPath !== null
  ) {
    currentInputError('binding v1 has no stored intent comparison contract');
  }
  if (
    bindingVersion === 'aesthete.binding/v2'
    && decision.binding.intent.status === 'bound'
    && flags.intentPath === null
  ) {
    currentInputError('bound receipt intent requires --intent');
  }

  const runtime = captureRuntime(context.runtime);
  const schemas = captureSchemaBundle(context.root, context.io);
  const schemaComparison = compareCurrentManifest(
    decision.binding.policy.resources.schemas,
    context.root,
    'schemas',
    context.io,
  );
  const validator = await createRunValidator(schemas, context.loadAjv);
  const installation = captureInstallationManifest(context.root, context.io);
  const installationComparison = compareCurrentManifest(
    decision.binding.policy.resources.on_disk_installation,
    context.root,
    'installation',
    context.io,
  );
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
  const requestedIntent = flags.intentPath === null
    ? null
    : validateRequestedIntent(flags.intentPath, context.io, validator);
  const artifact = snapshotArtifact(artifactPath, {
    domain: flags.domain,
    slide: flags.slide,
  }, context.io);
  if (artifact.status !== 'bound') {
    currentInputError(
      `current artifact is unreadable: ${artifact.error?.message || artifactPath}`,
    );
  }

  let actionInputs = structuredClone(NOT_REQUIRED_ACTION);
  if (decision.decision === 'fix_geometry') {
    const actionContractPath = requestedContract
      ? flags.contractPath
      : path.join(context.root, 'examples', 'catalog.contract.json');
    const actionContract = requestedContract || validateActionContract(
      actionContractPath,
      context.io,
      validator,
    );
    try {
      actionInputs = buildFixAction({
        executable: context.executable,
        skillRoot: context.root,
        artifactPath,
        contractPath: actionContractPath,
        contractBytes: actionContract.bytes,
        adapter: artifact.adapter,
        slide: artifact.effective_slide,
        profile: flags.profile,
      }).action_inputs;
    } catch (error) {
      if (error instanceof ReceiptCurrentInputError) {
        currentInputError(error.message);
      }
      throw error;
    }
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
  const current = {
    artifact_sha256: artifact.sha256,
    contract: requestedContract
      ? { status: 'bound', sha256: requestedContract.sha256 }
      : { status: 'not_requested', sha256: null },
    ...(bindingVersion === 'aesthete.binding/v2'
      ? {
          intent: requestedIntent
            ? { status: 'bound', sha256: requestedIntent.sha256 }
            : { status: 'not_requested', sha256: null },
        }
      : {}),
    action_inputs: actionInputs,
    policy,
    schemaComparison,
    installationComparison,
  };
  try {
    return verificationResult(verifyDecisionBinding(decision, current));
  } catch (error) {
    if (error instanceof ReceiptCurrentInputError) currentInputError(error.message);
    throw error;
  }
}

function statusExitCode(status) {
  if (status === 'current') return 0;
  if (status === 'stale') return 1;
  return 2;
}

function writeCliError(error) {
  if (error instanceof ReceiptUsageError || error instanceof ReceiptInputError) {
    console.error(`${error.code}: ${error.message}`);
  } else if (error instanceof ReceiptCurrentInputError) {
    console.error(`${error.code}: ${error.message}`);
  } else {
    console.error(error?.message || error);
  }
}

async function main() {
  const parsed = parseReceiptArgs(process.argv.slice(2));
  const outPath = parsed.outPath === null
    ? null
    : normalizePath(parsed.outPath, 'verification output path', ReceiptUsageError);
  const result = await verifyReceiptFiles({
    decisionPath: parsed.decisionPath,
    artifactPath: parsed.artifactPath,
    flags: parsed.flags,
  });
  if (outPath !== null) writeJson(outPath, result);
  console.log(`receipt status=${result.status} issues=${result.issues.length}`);
  process.exit(statusExitCode(result.status));
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    writeCliError(error);
    process.exit(
      error instanceof ReceiptUsageError
      || error instanceof ReceiptInputError
      || error instanceof ReceiptCurrentInputError
        ? 2
        : 1,
    );
  });
}
