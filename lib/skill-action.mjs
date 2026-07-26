import path from 'node:path';
import { sha256Bytes } from './shared/canonical-json.mjs';
import { ReceiptCurrentInputError } from './skill-receipt-core.mjs';

const SUPPORTED_ADAPTERS = Object.freeze([
  'svg',
  'html',
  'pptx',
  'docx',
  'xlsx',
  'image',
  'alt',
]);
const LOWER_HEX_256 = /^[0-9a-f]{64}$/;
const CANONICAL_SLIDE = /^[1-9][0-9]*$/;
const CURRENT_FIELDS = Object.freeze([
  'executable',
  'skillRoot',
  'artifactPath',
  'contractPath',
  'contractBytes',
  'adapter',
  'slide',
  'profile',
]);
const ACTION_FIELDS = Object.freeze([
  'status',
  'runtime_executable_locator_sha256',
  'script_locator_sha256',
  'artifact_locator_sha256',
  'contract_locator_sha256',
  'contract_sha256',
  'adapter',
  'slide',
  'profile',
]);
const COMMAND_DERIVED_FIELDS = Object.freeze([
  'runtime_executable_locator_sha256',
  'script_locator_sha256',
  'artifact_locator_sha256',
  'contract_locator_sha256',
  'adapter',
  'slide',
  'profile',
]);

export class ActionParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ActionParseError';
    this.code = 'ACTION_GRAMMAR_INVALID';
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function currentError(message) {
  throw new ReceiptCurrentInputError(`fix action input invalid: ${message}`);
}

function normalizedLocator(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    currentError(`${field} must be a non-empty string`);
  }
  try {
    return path.resolve(value);
  } catch {
    return currentError(`${field} cannot be resolved`);
  }
}

function digestLocator(value) {
  return sha256Bytes(Buffer.from(value, 'utf8'));
}

function validateOptions(input) {
  if (!SUPPORTED_ADAPTERS.includes(input.adapter)) {
    currentError(`unsupported adapter: ${String(input.adapter)}`);
  }
  if (
    input.adapter === 'pptx'
      ? !Number.isSafeInteger(input.slide) || input.slide <= 0
      : input.slide !== null
  ) {
    currentError('slide must be a positive integer exactly for PPTX and null otherwise');
  }
  if (
    input.profile !== null
    && (
      typeof input.profile !== 'string'
      || input.profile.length === 0
      || input.profile.startsWith('--')
    )
  ) {
    currentError('profile must be null or a non-empty string');
  }
}

function normalizeCurrentInput(input) {
  if (!hasExactKeys(input, CURRENT_FIELDS)) currentError('unexpected or missing fields');
  if (!(input.contractBytes instanceof Uint8Array)) {
    currentError('contractBytes must be bytes');
  }
  validateOptions(input);
  const executable = normalizedLocator(input.executable, 'executable');
  const root = normalizedLocator(input.skillRoot, 'skillRoot');
  const scriptPath = path.join(root, 'lib', 'fix.mjs');
  return {
    executable,
    scriptPath,
    artifactPath: normalizedLocator(input.artifactPath, 'artifactPath'),
    contractPath: normalizedLocator(input.contractPath, 'contractPath'),
    contractBytes: input.contractBytes,
    adapter: input.adapter,
    slide: input.slide,
    profile: input.profile,
  };
}

function actionInputsFromNormalized(input) {
  return {
    status: 'bound',
    runtime_executable_locator_sha256: digestLocator(input.executable),
    script_locator_sha256: digestLocator(input.scriptPath),
    artifact_locator_sha256: digestLocator(input.artifactPath),
    contract_locator_sha256: digestLocator(input.contractPath),
    contract_sha256: sha256Bytes(input.contractBytes),
    adapter: input.adapter,
    slide: input.slide,
    profile: input.profile,
  };
}

function commandFromNormalized(input) {
  const command = [
    input.executable,
    input.scriptPath,
    input.artifactPath,
    '--contract',
    input.contractPath,
    '--domain',
    input.adapter,
  ];
  if (input.adapter === 'pptx') command.push('--slide', String(input.slide));
  if (input.profile !== null) command.push('--profile', input.profile);
  return command;
}

export function buildFixAction(input) {
  const normalized = normalizeCurrentInput(input);
  return {
    command: commandFromNormalized(normalized),
    action_inputs: actionInputsFromNormalized(normalized),
  };
}

function parseError(message) {
  throw new ActionParseError(message);
}

function parseAbsoluteLocator(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    parseError(`${field} must be an absolute lexically normalized path`);
  }
  if (path.posix.isAbsolute(value) && path.posix.normalize(value) === value) {
    return { value, flavor: 'posix', api: path.posix };
  }
  if (path.win32.isAbsolute(value) && path.win32.normalize(value) === value) {
    return { value, flavor: 'win32', api: path.win32 };
  }
  return parseError(`${field} must be an absolute lexically normalized path`);
}

function parseCanonicalSlide(value) {
  if (typeof value !== 'string' || !CANONICAL_SLIDE.test(value)) {
    parseError('slide must use canonical positive base-10 integer spelling');
  }
  const slide = Number(value);
  if (!Number.isSafeInteger(slide)) parseError('slide exceeds the safe integer range');
  return slide;
}

export function parseFixAction(command) {
  if (!Array.isArray(command) || !command.every((token) => typeof token === 'string')) {
    parseError('fix command must be a string array');
  }
  if (command.length < 7) parseError('fix command is missing mandatory operands');

  const executable = parseAbsoluteLocator(command[0], 'executable');
  const scriptPath = parseAbsoluteLocator(command[1], 'script');
  const artifactPath = parseAbsoluteLocator(command[2], 'artifact');
  if (
    executable.flavor !== scriptPath.flavor
    || executable.flavor !== artifactPath.flavor
  ) {
    parseError('all action locators must use one platform path syntax');
  }
  if (
    scriptPath.api.basename(scriptPath.value) !== 'fix.mjs'
    || scriptPath.api.basename(scriptPath.api.dirname(scriptPath.value)) !== 'lib'
  ) {
    parseError('script must be an absolute */lib/fix.mjs locator');
  }
  if (command[3] !== '--contract') parseError('expected --contract after artifact');
  const contractPath = parseAbsoluteLocator(command[4], 'contract');
  if (contractPath.flavor !== executable.flavor) {
    parseError('all action locators must use one platform path syntax');
  }
  if (command[5] !== '--domain') parseError('expected --domain after contract');
  const adapter = command[6];
  if (!SUPPORTED_ADAPTERS.includes(adapter)) parseError(`unsupported domain: ${adapter}`);

  let cursor = 7;
  let slide = null;
  if (adapter === 'pptx') {
    if (command[cursor] !== '--slide') parseError('PPTX action requires --slide');
    slide = parseCanonicalSlide(command[cursor + 1]);
    cursor += 2;
  } else if (command[cursor] === '--slide') {
    parseError('--slide is forbidden for non-PPTX actions');
  }

  let profile = null;
  if (cursor < command.length) {
    if (command[cursor] !== '--profile') parseError('unexpected or misplaced action token');
    const value = command[cursor + 1];
    if (
      typeof value !== 'string'
      || value.length === 0
      || value.startsWith('--')
    ) {
      parseError('--profile requires one non-empty value');
    }
    profile = value;
    cursor += 2;
  }
  if (cursor !== command.length) parseError('extra or duplicate action operands');

  return {
    executable: executable.value,
    scriptPath: scriptPath.value,
    artifactPath: artifactPath.value,
    contractPath: contractPath.value,
    adapter,
    slide,
    profile,
  };
}

function inspectStoredAction(action) {
  if (
    !hasExactKeys(action, ACTION_FIELDS)
    || action.status !== 'bound'
    || !ACTION_FIELDS.slice(1, 6).every((field) => LOWER_HEX_256.test(action[field]))
    || !SUPPORTED_ADAPTERS.includes(action.adapter)
    || (
      action.adapter === 'pptx'
        ? !Number.isSafeInteger(action.slide) || action.slide <= 0
        : action.slide !== null
    )
    || (
      action.profile !== null
      && (typeof action.profile !== 'string' || action.profile.length === 0)
    )
  ) {
    return false;
  }
  return true;
}

function parsedProjection(parsed, storedContractDigest) {
  return {
    status: 'bound',
    runtime_executable_locator_sha256: digestLocator(parsed.executable),
    script_locator_sha256: digestLocator(parsed.scriptPath),
    artifact_locator_sha256: digestLocator(parsed.artifactPath),
    contract_locator_sha256: digestLocator(parsed.contractPath),
    contract_sha256: storedContractDigest,
    adapter: parsed.adapter,
    slide: parsed.slide,
    profile: parsed.profile,
  };
}

function fieldsMatch(left, right, fields = ACTION_FIELDS) {
  return fields.every((field) => left[field] === right[field]);
}

function inspectStored(decision) {
  if (
    !isRecord(decision)
    || decision.decision !== 'fix_geometry'
    || !isRecord(decision.next)
    || decision.next.action !== 'run_fix_p0'
    || !isRecord(decision.binding)
    || !inspectStoredAction(decision.binding.action_inputs)
  ) {
    return {
      result: {
        status: 'invalid',
        issues: [{ code: 'ACTION_INTERNAL_MISMATCH' }],
      },
      parsed: null,
    };
  }

  let parsed;
  try {
    parsed = parseFixAction(decision.next.fix_cmd);
  } catch (error) {
    if (!(error instanceof ActionParseError)) throw error;
    return {
      result: {
        status: 'invalid',
        issues: [{ code: 'ACTION_INTERNAL_MISMATCH' }],
      },
      parsed: null,
    };
  }
  const stored = decision.binding.action_inputs;
  const commandProjection = parsedProjection(parsed, stored.contract_sha256);
  if (!fieldsMatch(commandProjection, stored, COMMAND_DERIVED_FIELDS)) {
    return {
      result: {
        status: 'invalid',
        issues: [{ code: 'ACTION_INTERNAL_MISMATCH' }],
      },
      parsed: null,
    };
  }
  return {
    result: { status: 'valid', issues: [] },
    parsed,
  };
}

export function inspectStoredFixAction(decision) {
  return inspectStored(decision).result;
}

export function verifyFixAction(decision, current) {
  const inspected = inspectStored(decision);
  if (inspected.result.status === 'invalid') return inspected.result;

  const stored = decision.binding.action_inputs;
  const currentAction = buildFixAction(current).action_inputs;
  if (!fieldsMatch(stored, currentAction)) {
    return {
      status: 'stale',
      issues: [{ code: 'ACTION_CHANGED' }],
    };
  }
  return { status: 'current', issues: [] };
}
