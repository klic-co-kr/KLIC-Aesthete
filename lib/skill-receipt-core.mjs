import { sha256Json } from './shared/canonical-json.mjs';

const LOWER_HEX_256 = /^[0-9a-f]{64}$/;
const SUPPORTED_ADAPTERS = Object.freeze([
  'svg',
  'html',
  'pptx',
  'docx',
  'xlsx',
  'image',
  'alt',
]);
const INSTALLATION_PACKAGE_FILES = Object.freeze([
  'package.json',
  'bun.lock',
  'package-lock.json',
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
const NULL_ACTION = Object.freeze({
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
const NEXT_ACTION = Object.freeze({
  regenerate: 'rewrite_generator',
  fix_geometry: 'run_fix_p0',
  pass: 'stop',
  human: 'ask_human',
});
const INVALID_CODE_ORDER = Object.freeze([
  'BASE_SCHEMA_INVALID',
  'EXTENSION_PAIR_INVALID',
  'RECEIPT_SCHEMA_INVALID',
  'MANIFEST_PATH_INVALID',
  'POLICY_DIGEST_MISMATCH',
  'CORE_DIGEST_MISMATCH',
  'ACTION_INTERNAL_MISMATCH',
]);
const STALE_CODE_ORDER = Object.freeze([
  'ARTIFACT_CHANGED',
  'CONTRACT_CHANGED',
  'ACTION_CHANGED',
  'POLICY_CHANGED',
  'MANIFEST_FILE_MISSING',
  'MANIFEST_FILE_ADDED',
  'MANIFEST_FILE_CHANGED',
]);
const MANIFEST_CHANGE_CODES = new Set(STALE_CODE_ORDER.slice(4));
const ALL_CHECKED = Object.freeze([
  'decision_core_sha256',
  'artifact.sha256',
  'contract.status',
  'contract.sha256',
  'action_inputs',
  'policy_sha256',
]);

const RULE_TEXT = Object.freeze({
  artifact_import: Object.freeze({
    blocking_conditions: Object.freeze([
      'read_parse_or_schema_failure_routes_to_regenerate',
    ]),
    coverage_behavior: 'failure_prevents_downstream_execution',
    advisory_behavior: 'none',
  }),
  alt_hard_integrity: Object.freeze({
    blocking_conditions: Object.freeze([
      'p0_score_below_one_routes_to_fix_regenerate_or_human',
    ]),
    coverage_behavior: 'reported_separately',
    advisory_behavior: 'non_p0_measurements_do_not_directly_block',
  }),
  coverage: Object.freeze({
    blocking_conditions: Object.freeze(['zero_routes_to_human']),
    coverage_behavior: 'nonzero_does_not_imply_full_coverage',
    advisory_behavior: 'none',
  }),
  structure_signature: Object.freeze({
    blocking_conditions: Object.freeze(['fail_routes_to_regenerate']),
    coverage_behavior: 'unknown_is_nonblocking',
    advisory_behavior: 'none',
  }),
  token_policy: Object.freeze({
    blocking_conditions: Object.freeze(['any_violation_routes_to_regenerate']),
    coverage_behavior: 'no_separate_coverage_state',
    advisory_behavior: 'none',
  }),
  known_bad_signatures: Object.freeze({
    blocking_conditions: Object.freeze([
      'high_findings_route_to_regenerate_only_when_vuln_gate_enabled',
    ]),
    coverage_behavior: 'scanner_coverage_does_not_independently_block',
    advisory_behavior: 'ungated_high_findings_add_advisory_reasons',
  }),
  html_pattern_scan: Object.freeze({
    blocking_conditions: Object.freeze([
      'branch_1_when_html_measured_and_p0_exists_regenerate',
      'branch_2_else_when_html_measured_and_gate_enabled_and_p1_exists_regenerate',
      'branch_3_else_when_html_measured_and_p0_signature_unmeasured_human',
    ]),
    coverage_behavior: 'whole_scan_unmeasurable_is_nonblocking',
    advisory_behavior:
      'branch_4_only_p2_findings_add_reasons_after_no_prior_branch_p1_ungated_does_not',
  }),
  contract_criteria: Object.freeze({
    blocking_conditions: Object.freeze([
      'non_p0_criterion_failure_routes_to_regenerate',
    ]),
    coverage_behavior: 'p0_only_contract_failure_is_nonblocking_in_contract_branch',
    advisory_behavior: 'none',
  }),
});

function rule(requested, executed, text) {
  return {
    requested,
    executed,
    blocking_conditions: [...text.blocking_conditions],
    coverage_behavior: text.coverage_behavior,
    advisory_behavior: text.advisory_behavior,
  };
}

export function buildClaimScope(input = {}) {
  return {
    schema: 'aesthete.claim-scope/v1',
    pass_means: 'no_enabled_blocking_rule_triggered',
    rules: {
      artifact_import: rule(true, true, RULE_TEXT.artifact_import),
      alt_hard_integrity: rule(
        true,
        Boolean(input.report) && !input.importError,
        RULE_TEXT.alt_hard_integrity,
      ),
      coverage: rule(true, Boolean(input.report), RULE_TEXT.coverage),
      structure_signature: rule(
        Boolean(input.structureRequested),
        Boolean(input.structureRequested && input.structureResult != null),
        RULE_TEXT.structure_signature,
      ),
      token_policy: rule(
        Boolean(input.lintRequested),
        Boolean(input.lintRequested && input.lintResult != null),
        RULE_TEXT.token_policy,
      ),
      known_bad_signatures: rule(
        Boolean(input.vulnRequested),
        input.vulnReport != null,
        RULE_TEXT.known_bad_signatures,
      ),
      html_pattern_scan: rule(
        Boolean(input.slopRequested),
        input.slopReport != null,
        RULE_TEXT.html_pattern_scan,
      ),
      contract_criteria: rule(
        Boolean(input.contractRequested),
        Boolean(input.contractRequested && input.contractEval != null),
        RULE_TEXT.contract_criteria,
      ),
    },
    does_not_establish: [
      'reader_comprehension',
      'pixel_output_equivalence',
      'host_application_behavior',
      'human_approval',
    ],
  };
}

export class ReceiptCurrentInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReceiptCurrentInputError';
    this.code = 'CURRENT_INPUT_INVALID';
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

function hasOrderedKeys(value, keys) {
  return isRecord(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key, index) => key === keys[index]);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isOptionalNonEmptyString(value) {
  return value === null || isNonEmptyString(value);
}

function isJsonNumberOrNull(value) {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function arraysEqual(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function clone(value) {
  return structuredClone(value);
}

function isValidReason(reason) {
  if (!isRecord(reason) || typeof reason.code !== 'string') return false;
  if ('tier' in reason && typeof reason.tier !== 'string') return false;
  if ('detail' in reason && typeof reason.detail !== 'string') return false;
  if ('fixable' in reason && typeof reason.fixable !== 'boolean') return false;
  return true;
}

function validateBaseDecision(decision) {
  if (!isRecord(decision)) return false;
  if (decision.schema !== 'aesthete.decision/v1' || decision.schema_version !== 1) return false;
  if (!Object.hasOwn(NEXT_ACTION, decision.decision)) return false;
  if (!Array.isArray(decision.reasons) || !decision.reasons.every(isValidReason)) return false;
  if (!isRecord(decision.scores)) return false;
  for (const key of [
    'hardIntegrityScore',
    'measuredAestheticScore',
    'coverageScore',
  ]) {
    if (key in decision.scores && !isJsonNumberOrNull(decision.scores[key])) return false;
  }
  if ('paths' in decision && !isRecord(decision.paths)) return false;
  if (!isRecord(decision.next) || decision.next.action !== NEXT_ACTION[decision.decision]) return false;
  if ('loop_hint_max' in decision.next && !Number.isInteger(decision.next.loop_hint_max)) return false;
  if (decision.decision === 'fix_geometry') {
    if (
      !Array.isArray(decision.next.fix_cmd)
      || decision.next.fix_cmd.length === 0
      || !decision.next.fix_cmd.every((operand) => typeof operand === 'string')
    ) {
      return false;
    }
  } else if ('fix_cmd' in decision.next) {
    return false;
  }
  return true;
}

function validateClaimScope(scope) {
  if (!hasExactKeys(scope, ['schema', 'pass_means', 'rules', 'does_not_establish'])) {
    return false;
  }
  if (
    scope.schema !== 'aesthete.claim-scope/v1'
    || scope.pass_means !== 'no_enabled_blocking_rule_triggered'
  ) {
    return false;
  }
  const ruleKeys = Object.keys(RULE_TEXT);
  if (!hasOrderedKeys(scope.rules, ruleKeys)) return false;
  for (const key of ruleKeys) {
    const candidate = scope.rules[key];
    const expected = RULE_TEXT[key];
    if (
      !hasExactKeys(candidate, [
        'requested',
        'executed',
        'blocking_conditions',
        'coverage_behavior',
        'advisory_behavior',
      ])
      || typeof candidate.requested !== 'boolean'
      || typeof candidate.executed !== 'boolean'
      || !arraysEqual(candidate.blocking_conditions, expected.blocking_conditions)
      || candidate.coverage_behavior !== expected.coverage_behavior
      || candidate.advisory_behavior !== expected.advisory_behavior
    ) {
      return false;
    }
  }
  return arraysEqual(scope.does_not_establish, [
    'reader_comprehension',
    'pixel_output_equivalence',
    'host_application_behavior',
    'human_approval',
  ]);
}

function isAllowedManifestPath(relative, kind) {
  if (typeof relative !== 'string' || relative.length === 0) return false;
  if (
    relative.startsWith('/')
    || /^[A-Za-z]:/.test(relative)
    || relative.includes('\\')
  ) {
    return false;
  }
  const segments = relative.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return false;
  }
  if (kind === 'schemas') return /^schemas\/[^/]+\.json$/.test(relative);
  return INSTALLATION_PACKAGE_FILES.includes(relative)
    || /^lib\/[^/](?:.*\/)?[^/]*\.mjs$/.test(relative);
}

function validateManifest(manifest, kind) {
  if (
    !hasExactKeys(manifest, ['sha256', 'files'])
    || !LOWER_HEX_256.test(manifest.sha256)
    || !Array.isArray(manifest.files)
  ) {
    return false;
  }
  let previous = null;
  for (const entry of manifest.files) {
    if (
      !hasExactKeys(entry, ['relative_path', 'sha256'])
      || !isAllowedManifestPath(entry.relative_path, kind)
      || !LOWER_HEX_256.test(entry.sha256)
      || (previous !== null && previous >= entry.relative_path)
    ) {
      return false;
    }
    previous = entry.relative_path;
  }
  try {
    return manifest.sha256 === sha256Json(manifest.files);
  } catch {
    return false;
  }
}

function validatePolicy(policy) {
  const result = { valid: true, manifestInvalid: false };
  if (!hasExactKeys(policy, [
    'adapter',
    'profile',
    'structure',
    'lint',
    'vuln',
    'vuln_gate',
    'slop',
    'slop_gate',
    'slop_autofix',
    'human_on_unfixable',
    'artifact_type',
    'resources',
    'validation',
    'runtime',
  ])) {
    result.valid = false;
    return result;
  }
  if (
    !hasExactKeys(policy.adapter, ['id', 'effective_slide'])
    || !SUPPORTED_ADAPTERS.includes(policy.adapter.id)
    || (
      policy.adapter.id === 'pptx'
        ? !Number.isInteger(policy.adapter.effective_slide)
          || policy.adapter.effective_slide <= 0
        : policy.adapter.effective_slide !== null
    )
  ) {
    result.valid = false;
  }
  if (
    !isOptionalNonEmptyString(policy.profile)
    || !isOptionalNonEmptyString(policy.structure)
    || !isOptionalNonEmptyString(policy.artifact_type)
  ) {
    result.valid = false;
  }
  for (const key of [
    'lint',
    'vuln',
    'vuln_gate',
    'slop',
    'slop_gate',
    'slop_autofix',
    'human_on_unfixable',
  ]) {
    if (typeof policy[key] !== 'boolean') result.valid = false;
  }
  if (!hasExactKeys(policy.resources, [
    'params_sha256',
    'tokens_sha256',
    'schemas',
    'on_disk_installation',
  ])) {
    result.valid = false;
  } else {
    if (!LOWER_HEX_256.test(policy.resources.params_sha256)) result.valid = false;
    if (
      policy.lint
        ? !LOWER_HEX_256.test(policy.resources.tokens_sha256)
        : policy.resources.tokens_sha256 !== null
    ) {
      result.valid = false;
    }
    if (!validateManifest(policy.resources.schemas, 'schemas')) result.manifestInvalid = true;
    if (!validateManifest(policy.resources.on_disk_installation, 'installation')) {
      result.manifestInvalid = true;
    }
  }
  if (
    !hasExactKeys(policy.validation, ['mode', 'version'])
    || policy.validation.mode !== 'ajv'
    || !isNonEmptyString(policy.validation.version)
  ) {
    result.valid = false;
  }
  if (
    !hasExactKeys(policy.runtime, [
      'engine',
      'version',
      'platform',
      'arch',
      'locale',
      'versions_sha256',
    ])
    || policy.runtime.engine !== 'bun'
    || !isNonEmptyString(policy.runtime.version)
    || !isNonEmptyString(policy.runtime.platform)
    || !isNonEmptyString(policy.runtime.arch)
    || !isNonEmptyString(policy.runtime.locale)
    || !LOWER_HEX_256.test(policy.runtime.versions_sha256)
  ) {
    result.valid = false;
  }
  return result;
}

function validateContract(contract) {
  return hasExactKeys(contract, ['status', 'sha256'])
    && (
      (contract.status === 'bound' && LOWER_HEX_256.test(contract.sha256))
      || (contract.status === 'not_requested' && contract.sha256 === null)
    );
}

function inspectAction(action) {
  if (!hasExactKeys(action, ACTION_FIELDS)) {
    return { valid: false, internalMismatch: false };
  }
  if (action.status === 'not_required') {
    return {
      valid: true,
      internalMismatch: ACTION_FIELDS.slice(1).some((field) => action[field] !== null),
    };
  }
  if (action.status !== 'bound') return { valid: false, internalMismatch: false };
  const digestFields = ACTION_FIELDS.slice(1, 6);
  const valid = digestFields.every((field) => LOWER_HEX_256.test(action[field]))
    && SUPPORTED_ADAPTERS.includes(action.adapter)
    && (
      action.adapter === 'pptx'
        ? Number.isInteger(action.slide) && action.slide > 0
        : action.slide === null
    )
    && isOptionalNonEmptyString(action.profile);
  return { valid, internalMismatch: false };
}

function validateArtifact(binding) {
  if (!hasExactKeys(binding.artifact, ['status', 'sha256'])) return false;
  if (binding.completeness === 'complete') {
    return binding.artifact.status === 'bound'
      && LOWER_HEX_256.test(binding.artifact.sha256);
  }
  if (binding.completeness === 'incomplete') {
    return binding.artifact.status === 'unreadable'
      && binding.artifact.sha256 === null;
  }
  return false;
}

function sortIssues(issues, order) {
  const rank = new Map(order.map((code, index) => [code, index]));
  return issues.sort((left, right) => {
    const byCode = (rank.get(left.code) ?? order.length)
      - (rank.get(right.code) ?? order.length);
    if (byCode !== 0) return byCode;
    const leftKind = left.manifest_kind === 'schemas' ? 0 : 1;
    const rightKind = right.manifest_kind === 'schemas' ? 0 : 1;
    if (leftKind !== rightKind) return leftKind - rightKind;
    const leftPath = String(left.relative_path ?? '');
    const rightPath = String(right.relative_path ?? '');
    return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
  });
}

function uniqueIssues(issues, order) {
  const seen = new Set();
  return sortIssues(issues.filter((issue) => {
    const key = JSON.stringify(issue);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }), order);
}

export function decisionCore(decision) {
  return {
    schema: decision?.schema,
    schema_version: decision?.schema_version,
    decision: decision?.decision,
    reasons: decision?.reasons,
    scores: decision?.scores,
    next: decision?.next,
    claim_scope: decision?.claim_scope,
  };
}

export function buildDecisionBinding(input = {}) {
  if (!validateBaseDecision(input.decision) || !validateClaimScope(input.decision.claim_scope)) {
    throw new Error('binding decision core is invalid');
  }
  let artifact;
  if (input.completeness === 'complete') {
    if (
      !LOWER_HEX_256.test(input.artifact_sha256)
      || Object.hasOwn(input, 'artifact')
    ) {
      throw new Error('complete binding requires only a lowercase artifact digest');
    }
    artifact = { status: 'bound', sha256: input.artifact_sha256 };
  } else if (input.completeness === 'incomplete') {
    if (
      input.artifact_sha256 !== null
      || !hasExactKeys(input.artifact, ['status', 'sha256'])
      || input.artifact.status !== 'unreadable'
      || input.artifact.sha256 !== null
    ) {
      throw new Error('incomplete binding requires the exact unreadable artifact shape');
    }
    artifact = clone(input.artifact);
  } else {
    throw new Error('binding completeness must be complete or incomplete');
  }
  if (!validateContract(input.contract)) throw new Error('binding contract is invalid');
  const policyResult = validatePolicy(input.policy);
  if (!policyResult.valid || policyResult.manifestInvalid) {
    throw new Error('binding policy is invalid');
  }
  let actionInputs;
  if (hasExactKeys(input.action_inputs, ['status'])
    && input.action_inputs.status === 'not_required') {
    actionInputs = clone(NULL_ACTION);
  } else {
    const actionResult = inspectAction(input.action_inputs);
    if (!actionResult.valid || actionResult.internalMismatch) {
      throw new Error('binding action inputs are invalid');
    }
    actionInputs = clone(input.action_inputs);
  }
  const expectsBound = input.decision.decision === 'fix_geometry';
  if ((actionInputs.status === 'bound') !== expectsBound) {
    throw new Error('binding action inputs do not match the decision');
  }
  const policy = clone(input.policy);
  return {
    schema: 'aesthete.binding/v1',
    algorithm: 'sha256',
    integrity: 'content_freshness_and_internal_consistency_not_authenticity',
    completeness: input.completeness,
    artifact,
    contract: clone(input.contract),
    action_inputs: actionInputs,
    policy,
    policy_sha256: sha256Json(policy),
    decision_core_sha256: sha256Json(decisionCore(input.decision)),
  };
}

function validateBindingStructure(decision) {
  const binding = decision.binding;
  const result = {
    receiptInvalid: false,
    manifestInvalid: false,
    actionMismatch: false,
  };
  if (!hasExactKeys(binding, [
    'schema',
    'algorithm',
    'integrity',
    'completeness',
    'artifact',
    'contract',
    'action_inputs',
    'policy',
    'policy_sha256',
    'decision_core_sha256',
  ])) {
    result.receiptInvalid = true;
    return result;
  }
  if (
    binding.schema !== 'aesthete.binding/v1'
    || binding.algorithm !== 'sha256'
    || binding.integrity
      !== 'content_freshness_and_internal_consistency_not_authenticity'
    || !['complete', 'incomplete'].includes(binding.completeness)
    || !LOWER_HEX_256.test(binding.policy_sha256)
    || !LOWER_HEX_256.test(binding.decision_core_sha256)
    || !validateArtifact(binding)
    || !validateContract(binding.contract)
  ) {
    result.receiptInvalid = true;
  }
  const actionResult = inspectAction(binding.action_inputs);
  if (!actionResult.valid) result.receiptInvalid = true;
  if (actionResult.internalMismatch) result.actionMismatch = true;
  if (
    actionResult.valid
    && ((binding.action_inputs.status === 'bound') !== (decision.decision === 'fix_geometry'))
  ) {
    result.actionMismatch = true;
  }
  const policyResult = validatePolicy(binding.policy);
  if (!policyResult.valid) result.receiptInvalid = true;
  if (policyResult.manifestInvalid) result.manifestInvalid = true;
  return result;
}

export function validateReceiptV1Shape(decision) {
  if (!validateBaseDecision(decision)) {
    return { status: 'invalid', issues: [{ code: 'BASE_SCHEMA_INVALID' }] };
  }
  const hasBinding = Object.hasOwn(decision, 'binding');
  const hasClaim = Object.hasOwn(decision, 'claim_scope');
  if (!hasBinding && !hasClaim) {
    return { status: 'unbound', issues: [{ code: 'RECEIPT_UNBOUND' }] };
  }
  if (hasBinding !== hasClaim) {
    return { status: 'invalid', issues: [{ code: 'EXTENSION_PAIR_INVALID' }] };
  }

  const issues = [];
  if (!validateClaimScope(decision.claim_scope)) {
    issues.push({ code: 'RECEIPT_SCHEMA_INVALID' });
  }
  const structural = validateBindingStructure(decision);
  if (structural.receiptInvalid) issues.push({ code: 'RECEIPT_SCHEMA_INVALID' });
  if (structural.manifestInvalid) issues.push({ code: 'MANIFEST_PATH_INVALID' });
  if (structural.actionMismatch) issues.push({ code: 'ACTION_INTERNAL_MISMATCH' });

  if (!structural.receiptInvalid && !structural.manifestInvalid) {
    if (decision.binding.policy_sha256 !== sha256Json(decision.binding.policy)) {
      issues.push({ code: 'POLICY_DIGEST_MISMATCH' });
    }
    if (decision.binding.decision_core_sha256 !== sha256Json(decisionCore(decision))) {
      issues.push({ code: 'CORE_DIGEST_MISMATCH' });
    }
  }
  if (issues.length > 0) {
    return {
      status: 'invalid',
      issues: uniqueIssues(issues, INVALID_CODE_ORDER),
    };
  }
  return { status: 'bound', issues: [] };
}

function validateComparison(comparison, kind) {
  if (
    !hasExactKeys(comparison, ['matches', 'changes'])
    || typeof comparison.matches !== 'boolean'
    || !Array.isArray(comparison.changes)
    || comparison.matches !== (comparison.changes.length === 0)
  ) {
    return false;
  }
  let previousPath = null;
  for (const change of comparison.changes) {
    if (
      !hasExactKeys(change, ['code', 'relative_path'])
      || !MANIFEST_CHANGE_CODES.has(change.code)
      || !isAllowedManifestPath(change.relative_path, kind)
      || (previousPath !== null && previousPath >= change.relative_path)
    ) {
      return false;
    }
    previousPath = change.relative_path;
  }
  return true;
}

function validateCurrent(current, decision) {
  if (!hasExactKeys(current, [
    'artifact_sha256',
    'contract',
    'action_inputs',
    'policy',
    'schemaComparison',
    'installationComparison',
  ])) {
    return false;
  }
  if (!LOWER_HEX_256.test(current.artifact_sha256) || !validateContract(current.contract)) {
    return false;
  }
  const action = inspectAction(current.action_inputs);
  if (!action.valid || action.internalMismatch) return false;
  if (
    (current.action_inputs.status === 'bound')
    !== (decision.decision === 'fix_geometry')
  ) {
    return false;
  }
  const policy = validatePolicy(current.policy);
  return policy.valid
    && !policy.manifestInvalid
    && validateComparison(current.schemaComparison, 'schemas')
    && validateComparison(current.installationComparison, 'installation');
}

function staleManifestIssues(comparison, kind) {
  return comparison.changes.map((change) => ({
    code: change.code,
    manifest_kind: kind,
    relative_path: change.relative_path,
  }));
}

export function verifyDecisionBinding(decision, current) {
  const shape = validateReceiptV1Shape(decision);
  if (shape.status === 'invalid' || shape.status === 'unbound') {
    return { ...shape, checked: [] };
  }
  if (decision.binding.completeness === 'incomplete') {
    return {
      status: 'incomplete',
      issues: [{ code: 'ARTIFACT_UNREADABLE' }],
      checked: [],
    };
  }
  if (!validateCurrent(current, decision)) {
    throw new ReceiptCurrentInputError('current receipt comparison input is invalid');
  }

  const issues = [];
  if (decision.binding.artifact.sha256 !== current.artifact_sha256) {
    issues.push({ code: 'ARTIFACT_CHANGED' });
  }
  if (
    decision.binding.contract.status !== current.contract.status
    || decision.binding.contract.sha256 !== current.contract.sha256
  ) {
    issues.push({ code: 'CONTRACT_CHANGED' });
  }
  if (sha256Json(decision.binding.action_inputs) !== sha256Json(current.action_inputs)) {
    issues.push({ code: 'ACTION_CHANGED' });
  }
  if (decision.binding.policy_sha256 !== sha256Json(current.policy)) {
    issues.push({ code: 'POLICY_CHANGED' });
  }
  issues.push(...staleManifestIssues(current.schemaComparison, 'schemas'));
  issues.push(...staleManifestIssues(current.installationComparison, 'installation'));
  const ordered = uniqueIssues(issues, STALE_CODE_ORDER);
  return {
    status: ordered.length === 0 ? 'current' : 'stale',
    issues: ordered,
    checked: [...ALL_CHECKED],
  };
}
