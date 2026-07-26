import { expect, test } from 'bun:test';
import path from 'node:path';
import { sha256Json } from '../lib/shared/canonical-json.mjs';
import { createRunValidator } from '../lib/shared/validator.mjs';
import { foldDecision } from '../lib/skill-decision.mjs';
import {
  ReceiptCurrentInputError,
  buildClaimScope,
  buildDecisionBinding,
  decisionCore,
  validateReceiptV1Shape,
  verifyDecisionBinding,
} from '../lib/skill-receipt-core.mjs';
import { captureSchemaBundle } from '../lib/skill-snapshot.mjs';

const repoRoot = path.resolve(import.meta.dir, '..');

const RULE_KEYS = [
  'artifact_import',
  'alt_hard_integrity',
  'coverage',
  'structure_signature',
  'token_policy',
  'known_bad_signatures',
  'html_pattern_scan',
  'contract_criteria',
];

const EXPECTED_RULE_TEXT = {
  artifact_import: {
    blocking_conditions: ['read_parse_or_schema_failure_routes_to_regenerate'],
    coverage_behavior: 'failure_prevents_downstream_execution',
    advisory_behavior: 'none',
  },
  alt_hard_integrity: {
    blocking_conditions: ['p0_score_below_one_routes_to_fix_regenerate_or_human'],
    coverage_behavior: 'reported_separately',
    advisory_behavior: 'non_p0_measurements_do_not_directly_block',
  },
  coverage: {
    blocking_conditions: ['zero_routes_to_human'],
    coverage_behavior: 'nonzero_does_not_imply_full_coverage',
    advisory_behavior: 'none',
  },
  structure_signature: {
    blocking_conditions: ['fail_routes_to_regenerate'],
    coverage_behavior: 'unknown_is_nonblocking',
    advisory_behavior: 'none',
  },
  token_policy: {
    blocking_conditions: ['any_violation_routes_to_regenerate'],
    coverage_behavior: 'no_separate_coverage_state',
    advisory_behavior: 'none',
  },
  known_bad_signatures: {
    blocking_conditions: ['high_findings_route_to_regenerate_only_when_vuln_gate_enabled'],
    coverage_behavior: 'scanner_coverage_does_not_independently_block',
    advisory_behavior: 'ungated_high_findings_add_advisory_reasons',
  },
  html_pattern_scan: {
    blocking_conditions: [
      'branch_1_when_html_measured_and_p0_exists_regenerate',
      'branch_2_else_when_html_measured_and_gate_enabled_and_p1_exists_regenerate',
      'branch_3_else_when_html_measured_and_p0_signature_unmeasured_human',
    ],
    coverage_behavior: 'whole_scan_unmeasurable_is_nonblocking',
    advisory_behavior:
      'branch_4_only_p2_findings_add_reasons_after_no_prior_branch_p1_ungated_does_not',
  },
  contract_criteria: {
    blocking_conditions: ['non_p0_criterion_failure_routes_to_regenerate'],
    coverage_behavior: 'p0_only_contract_failure_is_nonblocking_in_contract_branch',
    advisory_behavior: 'none',
  },
};

const passReport = {
  summary: {
    hardIntegrityScore: 1,
    measuredAestheticScore: 0.8,
    coverageScore: 1,
  },
  skills: {},
};

const digest = (character) => character.repeat(64);

function manifest(kind, entries) {
  const files = entries.map((relative_path, index) => ({
    relative_path,
    sha256: digest(String((index + 1) % 10)),
  }));
  return { files, sha256: sha256Json(files) };
}

function literalPolicyFixture(overrides = {}) {
  const base = {
    adapter: { id: 'svg', effective_slide: null },
    profile: null,
    structure: null,
    lint: false,
    vuln: false,
    vuln_gate: false,
    slop: false,
    slop_gate: false,
    slop_autofix: false,
    human_on_unfixable: false,
    artifact_type: null,
    resources: {
      params_sha256: digest('a'),
      tokens_sha256: null,
      schemas: manifest('schemas', [
        'schemas/alt.schema.json',
        'schemas/decision.schema.json',
      ]),
      on_disk_installation: manifest('installation', [
        'bun.lock',
        'lib/measure.mjs',
        'package-lock.json',
        'package.json',
      ]),
    },
    validation: { mode: 'ajv', version: '8.17.1' },
    runtime: {
      engine: 'bun',
      version: '1.3.6',
      platform: 'linux',
      arch: 'x64',
      locale: 'en',
      versions_sha256: digest('b'),
    },
  };
  return Object.assign(base, structuredClone(overrides));
}

const notRequiredAction = {
  status: 'not_required',
  runtime_executable_locator_sha256: null,
  script_locator_sha256: null,
  artifact_locator_sha256: null,
  contract_locator_sha256: null,
  contract_sha256: null,
  adapter: null,
  slide: null,
  profile: null,
};

const boundAction = {
  status: 'bound',
  runtime_executable_locator_sha256: digest('1'),
  script_locator_sha256: digest('2'),
  artifact_locator_sha256: digest('3'),
  contract_locator_sha256: digest('4'),
  contract_sha256: digest('5'),
  adapter: 'svg',
  slide: null,
  profile: null,
};

const legacyDecision = {
  schema: 'aesthete.decision/v1',
  schema_version: 1,
  decision: 'pass',
  reasons: [],
  scores: {
    hardIntegrityScore: 1,
    measuredAestheticScore: 0.8,
    coverageScore: 1,
  },
  paths: { decision: '/tmp/decision.json' },
  next: { action: 'stop', loop_hint_max: 2 },
};

const current = {
  artifact_sha256: digest('c'),
  contract: { status: 'not_requested', sha256: null },
  action_inputs: notRequiredAction,
  policy: literalPolicyFixture(),
  schemaComparison: { matches: true, changes: [] },
  installationComparison: { matches: true, changes: [] },
};

function receiptDecision(overrides = {}, bindingOverrides = {}) {
  const decision = {
    ...structuredClone(legacyDecision),
    claim_scope: buildClaimScope({ report: passReport }),
    ...structuredClone(overrides),
  };
  decision.binding = buildDecisionBinding({
    decision,
    completeness: 'complete',
    ...structuredClone(current),
    ...structuredClone(bindingOverrides),
  });
  return decision;
}

const ALL_CHECKED = [
  'decision_core_sha256',
  'artifact.sha256',
  'contract.status',
  'contract.sha256',
  'action_inputs',
  'policy_sha256',
];

test('claim scope emits the exact schema, rule order, and limitation order', () => {
  const scope = buildClaimScope({});
  expect(scope.schema).toBe('aesthete.claim-scope/v1');
  expect(scope.pass_means).toBe('no_enabled_blocking_rule_triggered');
  expect(Object.keys(scope.rules)).toEqual(RULE_KEYS);
  expect(scope.does_not_establish).toEqual([
    'reader_comprehension',
    'pixel_output_equivalence',
    'host_application_behavior',
    'human_approval',
  ]);
  for (const key of RULE_KEYS) {
    expect({
      blocking_conditions: scope.rules[key].blocking_conditions,
      coverage_behavior: scope.rules[key].coverage_behavior,
      advisory_behavior: scope.rules[key].advisory_behavior,
    }).toEqual(EXPECTED_RULE_TEXT[key]);
  }
});

test.each([
  [
    'empty fold input',
    {},
    {
      artifact_import: [true, true],
      alt_hard_integrity: [true, false],
      coverage: [true, false],
      structure_signature: [false, false],
      token_policy: [false, false],
      known_bad_signatures: [false, false],
      html_pattern_scan: [false, false],
      contract_criteria: [false, false],
    },
  ],
  [
    'all requested results reached fold',
    {
      report: passReport,
      structureRequested: true,
      structureResult: { verdict: 'pass' },
      lintRequested: true,
      lintResult: { passed: true },
      vulnRequested: true,
      vulnReport: { vulnerabilities: [] },
      slopRequested: true,
      slopReport: {
        summary: { coverage: { html: 'measured' }, unmeasured: [] },
        findings: [],
      },
      contractRequested: true,
      contractEval: { allPass: true, criteria: [] },
    },
    {
      artifact_import: [true, true],
      alt_hard_integrity: [true, true],
      coverage: [true, true],
      structure_signature: [true, true],
      token_policy: [true, true],
      known_bad_signatures: [true, true],
      html_pattern_scan: [true, true],
      contract_criteria: [true, true],
    },
  ],
  [
    'requested without results',
    {
      structureRequested: true,
      lintRequested: true,
      vulnRequested: true,
      slopRequested: true,
      contractRequested: true,
    },
    {
      artifact_import: [true, true],
      alt_hard_integrity: [true, false],
      coverage: [true, false],
      structure_signature: [true, false],
      token_policy: [true, false],
      known_bad_signatures: [true, false],
      html_pattern_scan: [true, false],
      contract_criteria: [true, false],
    },
  ],
  [
    'results without request flags remain reported',
    {
      structureResult: { verdict: 'pass' },
      lintResult: { passed: true },
      vulnReport: { vulnerabilities: [] },
      slopReport: {
        summary: { coverage: { html: 'measured' }, unmeasured: [] },
        findings: [],
      },
      contractEval: { allPass: true, criteria: [] },
    },
    {
      artifact_import: [true, true],
      alt_hard_integrity: [true, false],
      coverage: [true, false],
      structure_signature: [false, false],
      token_policy: [false, false],
      known_bad_signatures: [false, true],
      html_pattern_scan: [false, true],
      contract_criteria: [false, false],
    },
  ],
  [
    'import error suppresses hard execution but reports other direct values',
    {
      importError: new Error('bad json'),
      report: passReport,
      structureRequested: true,
      structureResult: { verdict: 'pass' },
      lintRequested: true,
      lintResult: { passed: true },
      vulnReport: { vulnerabilities: [] },
      slopReport: {
        summary: { coverage: { html: 'measured' }, unmeasured: [] },
        findings: [],
      },
      contractRequested: true,
      contractEval: { allPass: true, criteria: [] },
    },
    {
      artifact_import: [true, true],
      alt_hard_integrity: [true, false],
      coverage: [true, true],
      structure_signature: [true, true],
      token_policy: [true, true],
      known_bad_signatures: [false, true],
      html_pattern_scan: [false, true],
      contract_criteria: [true, true],
    },
  ],
])('claim request/execution matrix: %s', (_name, input, expected) => {
  const scope = buildClaimScope(input);
  for (const key of RULE_KEYS) {
    expect([
      scope.rules[key].requested,
      scope.rules[key].executed,
    ]).toEqual(expected[key]);
  }
});

test('claim text mirrors the slop fold branch order without reinterpreting its result', () => {
  const input = {
    report: passReport,
    slopRequested: true,
    slopGate: true,
    slopReport: {
      summary: { coverage: { html: 'measured' }, unmeasured: [] },
      findings: [{ id: 'slop.palette.gradient', tier: 'P0', title: 'gradient' }],
    },
  };
  expect(foldDecision(input).decision).toBe('regenerate');
  expect(buildClaimScope(input).rules.html_pattern_scan).toEqual({
    requested: true,
    executed: true,
    ...EXPECTED_RULE_TEXT.html_pattern_scan,
  });
});

test('decision core is the exact seven-field projection', () => {
  const decision = {
    ...structuredClone(legacyDecision),
    claim_scope: buildClaimScope({}),
    binding: { ignored: true },
    unrelated: 'legacy-compatible',
  };
  expect(decisionCore(decision)).toEqual({
    schema: decision.schema,
    schema_version: decision.schema_version,
    decision: decision.decision,
    reasons: decision.reasons,
    scores: decision.scores,
    next: decision.next,
    claim_scope: decision.claim_scope,
  });
});

test.each([
  ['schema', 'aesthete.decision/other'],
  ['schema_version', 2],
  ['decision', 'human'],
  ['reasons', [{ code: 'NEW_REASON' }]],
  ['scores', { ...legacyDecision.scores, coverageScore: 0 }],
  ['next', { action: 'ask_human', loop_hint_max: 2 }],
  ['claim_scope', buildClaimScope({ structureRequested: true })],
])('decision core digest includes %s', (field, value) => {
  const first = {
    ...structuredClone(legacyDecision),
    claim_scope: buildClaimScope({}),
  };
  const second = structuredClone(first);
  second[field] = value;
  expect(sha256Json(decisionCore(first))).not.toBe(sha256Json(decisionCore(second)));
});

test.each([
  ['paths', { decision: '/different' }],
  ['binding', { copied: true }],
  ['unrelated', { value: 1 }],
])('decision core digest excludes %s', (field, value) => {
  const first = {
    ...structuredClone(legacyDecision),
    claim_scope: buildClaimScope({}),
  };
  const second = structuredClone(first);
  second[field] = value;
  expect(sha256Json(decisionCore(first))).toBe(sha256Json(decisionCore(second)));
});

test('binding builder emits the exact complete shape and clones structured inputs', () => {
  const decision = {
    ...structuredClone(legacyDecision),
    claim_scope: buildClaimScope({}),
  };
  const policy = literalPolicyFixture();
  const contract = { status: 'not_requested', sha256: null };
  const binding = buildDecisionBinding({
    decision,
    completeness: 'complete',
    artifact_sha256: digest('d'),
    contract,
    action_inputs: { status: 'not_required' },
    policy,
  });
  expect(binding).toEqual({
    schema: 'aesthete.binding/v1',
    algorithm: 'sha256',
    integrity: 'content_freshness_and_internal_consistency_not_authenticity',
    completeness: 'complete',
    artifact: { status: 'bound', sha256: digest('d') },
    contract,
    action_inputs: notRequiredAction,
    policy,
    policy_sha256: sha256Json(policy),
    decision_core_sha256: sha256Json(decisionCore(decision)),
  });
  policy.profile = 'mutated';
  contract.status = 'bound';
  expect(binding.policy.profile).toBe(null);
  expect(binding.contract).toEqual({ status: 'not_requested', sha256: null });
});

test('binding builder emits the exact incomplete artifact shape', () => {
  const decision = {
    ...structuredClone(legacyDecision),
    claim_scope: buildClaimScope({}),
  };
  const binding = buildDecisionBinding({
    decision,
    completeness: 'incomplete',
    artifact_sha256: null,
    artifact: { status: 'unreadable', sha256: null },
    contract: current.contract,
    action_inputs: current.action_inputs,
    policy: current.policy,
  });
  expect(binding.completeness).toBe('incomplete');
  expect(binding.artifact).toEqual({ status: 'unreadable', sha256: null });
});

test.each([
  ['missing completeness', { completeness: undefined }],
  ['unsupported completeness', { completeness: 'partial' }],
  ['complete missing digest', { completeness: 'complete', artifact_sha256: undefined }],
  [
    'complete with artifact override',
    {
      completeness: 'complete',
      artifact_sha256: digest('d'),
      artifact: { status: 'bound', sha256: digest('d') },
    },
  ],
  [
    'incomplete with bound digest',
    {
      completeness: 'incomplete',
      artifact_sha256: digest('d'),
      artifact: { status: 'unreadable', sha256: null },
    },
  ],
  [
    'incomplete missing artifact',
    { completeness: 'incomplete', artifact_sha256: null, artifact: undefined },
  ],
  [
    'incomplete wrong artifact',
    {
      completeness: 'incomplete',
      artifact_sha256: null,
      artifact: { status: 'unreadable', sha256: digest('d') },
    },
  ],
])('binding builder rejects %s', (_name, overrides) => {
  const decision = {
    ...structuredClone(legacyDecision),
    claim_scope: buildClaimScope({}),
  };
  expect(() => buildDecisionBinding({
    decision,
    completeness: 'complete',
    artifact_sha256: digest('d'),
    contract: current.contract,
    action_inputs: current.action_inputs,
    policy: current.policy,
    ...overrides,
  })).toThrow();
});

test('pinned validation distinguishes legacy unbound, partial, and valid paired receipts', () => {
  expect(validateReceiptV1Shape(legacyDecision)).toEqual({
    status: 'unbound',
    issues: [{ code: 'RECEIPT_UNBOUND' }],
  });
  expect(validateReceiptV1Shape({
    ...legacyDecision,
    claim_scope: buildClaimScope({}),
  })).toEqual({
    status: 'invalid',
    issues: [{ code: 'EXTENSION_PAIR_INVALID' }],
  });
  expect(validateReceiptV1Shape(receiptDecision())).toEqual({
    status: 'bound',
    issues: [],
  });
});

test.each([
  ['regenerate', 'rewrite_generator', notRequiredAction],
  ['pass', 'stop', notRequiredAction],
  ['human', 'ask_human', notRequiredAction],
  ['fix_geometry', 'run_fix_p0', boundAction],
])('pinned decision/action matrix accepts %s', (decisionName, action, actionInputs) => {
  const overrides = {
    decision: decisionName,
    next: { action, loop_hint_max: 2 },
  };
  if (decisionName === 'fix_geometry') overrides.next.fix_cmd = ['/bun', '/fix', '/artifact'];
  const decision = receiptDecision(overrides, { action_inputs: actionInputs });
  expect(validateReceiptV1Shape(decision)).toEqual({ status: 'bound', issues: [] });
});

test.each([
  [
    'unsupported binding schema',
    (decision) => { decision.binding.schema = 'aesthete.binding/v2'; },
    'RECEIPT_SCHEMA_INVALID',
  ],
  [
    'uppercase digest',
    (decision) => { decision.binding.artifact.sha256 = digest('A'); },
    'RECEIPT_SCHEMA_INVALID',
  ],
  [
    'unknown nested property',
    (decision) => { decision.binding.contract.extra = true; },
    'RECEIPT_SCHEMA_INVALID',
  ],
  [
    'incomplete artifact mismatch',
    (decision) => {
      decision.binding.completeness = 'incomplete';
      decision.binding.artifact = { status: 'bound', sha256: digest('c') };
    },
    'RECEIPT_SCHEMA_INVALID',
  ],
  [
    'decision/action incoherence',
    (decision) => {
      decision.decision = 'fix_geometry';
      decision.next = {
        action: 'run_fix_p0',
        loop_hint_max: 2,
        fix_cmd: ['/bun', '/fix', '/artifact'],
      };
      decision.binding.decision_core_sha256 = sha256Json(decisionCore(decision));
    },
    'ACTION_INTERNAL_MISMATCH',
  ],
  [
    'non-null not-required action field',
    (decision) => {
      decision.binding.action_inputs.profile = 'unexpected';
      decision.binding.policy_sha256 = sha256Json(decision.binding.policy);
    },
    'ACTION_INTERNAL_MISMATCH',
  ],
])('pinned validation rejects %s', (_name, mutate, code) => {
  const decision = receiptDecision();
  mutate(decision);
  expect(validateReceiptV1Shape(decision)).toEqual({
    status: 'invalid',
    issues: expect.arrayContaining([expect.objectContaining({ code })]),
  });
});

test.each([
  ['wrong namespace', 'schemas', 'lib/not-a-schema.mjs'],
  ['backslash', 'schemas', 'schemas\\decision.schema.json'],
  ['empty segment', 'schemas', 'schemas//decision.schema.json'],
  ['wrong package namespace', 'installation', 'docs/readme.mjs'],
])('stored manifest rejects %s', (_name, kind, relativePath) => {
  const decision = receiptDecision();
  const key = kind === 'schemas' ? 'schemas' : 'on_disk_installation';
  const stored = decision.binding.policy.resources[key];
  stored.files = [{ relative_path: relativePath, sha256: digest('1') }];
  stored.sha256 = sha256Json(stored.files);
  decision.binding.policy_sha256 = sha256Json(decision.binding.policy);
  expect(validateReceiptV1Shape(decision)).toEqual({
    status: 'invalid',
    issues: [expect.objectContaining({ code: 'MANIFEST_PATH_INVALID' })],
  });
});

test.each([
  ['unsorted', ['schemas/z.schema.json', 'schemas/a.schema.json']],
  ['duplicate', ['schemas/a.schema.json', 'schemas/a.schema.json']],
])('stored manifest rejects %s paths', (_name, paths) => {
  const decision = receiptDecision();
  const stored = decision.binding.policy.resources.schemas;
  stored.files = paths.map((relative_path, index) => ({
    relative_path,
    sha256: digest(String(index + 1)),
  }));
  stored.sha256 = sha256Json(stored.files);
  decision.binding.policy_sha256 = sha256Json(decision.binding.policy);
  expect(validateReceiptV1Shape(decision).issues).toEqual([
    expect.objectContaining({ code: 'MANIFEST_PATH_INVALID' }),
  ]);
});

test('stored manifest aggregate mismatch stays invalid after outer policy digest rebinding', () => {
  const decision = receiptDecision();
  decision.binding.policy.resources.schemas.sha256 = digest('f');
  decision.binding.policy_sha256 = sha256Json(decision.binding.policy);
  expect(validateReceiptV1Shape(decision)).toEqual({
    status: 'invalid',
    issues: [expect.objectContaining({ code: 'MANIFEST_PATH_INVALID' })],
  });
});

test('verification status precedence is base invalid, unbound, extension invalid, incomplete, stale, current', () => {
  expect(verifyDecisionBinding({ decision: 'pass' }, current)).toEqual({
    status: 'invalid',
    issues: [expect.objectContaining({ code: 'BASE_SCHEMA_INVALID' })],
    checked: [],
  });
  expect(verifyDecisionBinding(legacyDecision, current)).toEqual({
    status: 'unbound',
    issues: [{ code: 'RECEIPT_UNBOUND' }],
    checked: [],
  });
  const invalid = receiptDecision();
  invalid.binding.policy_sha256 = digest('f');
  expect(verifyDecisionBinding(invalid, current)).toEqual({
    status: 'invalid',
    issues: [expect.objectContaining({ code: 'POLICY_DIGEST_MISMATCH' })],
    checked: [],
  });
  const incomplete = receiptDecision({}, {
    completeness: 'incomplete',
    artifact_sha256: null,
    artifact: { status: 'unreadable', sha256: null },
  });
  expect(verifyDecisionBinding(incomplete, current)).toEqual({
    status: 'incomplete',
    issues: [{ code: 'ARTIFACT_UNREADABLE' }],
    checked: [],
  });
  expect(verifyDecisionBinding(
    receiptDecision(),
    { ...structuredClone(current), artifact_sha256: digest('f') },
  )).toEqual({
    status: 'stale',
    issues: [{ code: 'ARTIFACT_CHANGED' }],
    checked: ALL_CHECKED,
  });
  expect(verifyDecisionBinding(receiptDecision(), current)).toEqual({
    status: 'current',
    issues: [],
    checked: ALL_CHECKED,
  });
});

test('invalid precedence reports internal digest issues in stable class order', () => {
  const decision = receiptDecision();
  decision.binding.policy_sha256 = digest('e');
  decision.binding.decision_core_sha256 = digest('f');
  expect(verifyDecisionBinding(decision, current)).toEqual({
    status: 'invalid',
    issues: [
      { code: 'POLICY_DIGEST_MISMATCH' },
      { code: 'CORE_DIGEST_MISMATCH' },
    ],
    checked: [],
  });
});

test('unrecomputed core edit is invalid while full public rebinding can be current', () => {
  const decision = receiptDecision();
  decision.decision = 'human';
  decision.next.action = 'ask_human';
  expect(verifyDecisionBinding(decision, current).status).toBe('invalid');
  decision.binding = buildDecisionBinding({
    decision,
    completeness: 'complete',
    ...structuredClone(current),
  });
  expect(verifyDecisionBinding(decision, current)).toEqual({
    status: 'current',
    issues: [],
    checked: ALL_CHECKED,
  });
});

test.each([
  ['artifact', (value) => { value.artifact_sha256 = digest('f'); }, 'ARTIFACT_CHANGED'],
  [
    'contract status and digest',
    (value) => { value.contract = { status: 'bound', sha256: digest('1') }; },
    'CONTRACT_CHANGED',
  ],
  [
    'policy',
    (value) => { value.policy.profile = 'changed'; },
    'POLICY_CHANGED',
  ],
])('complete verification checks every field after a %s mismatch', (_name, mutate, code) => {
  const changed = structuredClone(current);
  mutate(changed);
  expect(verifyDecisionBinding(receiptDecision(), changed)).toEqual({
    status: 'stale',
    issues: [expect.objectContaining({ code })],
    checked: ALL_CHECKED,
  });
});

test.each([
  ['adapter and effective slide', (policy) => {
    policy.adapter = { id: 'pptx', effective_slide: 2 };
  }],
  ['profile', (policy) => { policy.profile = 'review'; }],
  ['structure', (policy) => { policy.structure = 'evidence-grid'; }],
  ['lint and tokens', (policy) => {
    policy.lint = true;
    policy.resources.tokens_sha256 = digest('d');
  }],
  ['vulnerability flags', (policy) => {
    policy.vuln = true;
    policy.vuln_gate = true;
  }],
  ['slop flags', (policy) => {
    policy.slop = true;
    policy.slop_gate = true;
    policy.slop_autofix = true;
  }],
  ['human fallback', (policy) => { policy.human_on_unfixable = true; }],
  ['artifact type', (policy) => { policy.artifact_type = 'dashboard'; }],
  ['parameter digest', (policy) => { policy.resources.params_sha256 = digest('d'); }],
  ['schema manifest', (policy) => {
    policy.resources.schemas.files[0].sha256 = digest('d');
    policy.resources.schemas.sha256 = sha256Json(policy.resources.schemas.files);
  }],
  ['installation manifest', (policy) => {
    policy.resources.on_disk_installation.files[0].sha256 = digest('d');
    policy.resources.on_disk_installation.sha256 = sha256Json(
      policy.resources.on_disk_installation.files,
    );
  }],
  ['validator identity', (policy) => { policy.validation.version = '8.18.0'; }],
  ['runtime identity', (policy) => {
    policy.runtime.version = '1.3.7';
    policy.runtime.versions_sha256 = digest('d');
  }],
])('every policy component participates in freshness: %s', (_name, mutate) => {
  const changed = structuredClone(current);
  mutate(changed.policy);
  expect(verifyDecisionBinding(receiptDecision(), changed)).toEqual({
    status: 'stale',
    issues: [{ code: 'POLICY_CHANGED' }],
    checked: ALL_CHECKED,
  });
});

test('a changed bound action is stale for a fix decision', () => {
  const decision = receiptDecision({
    decision: 'fix_geometry',
    next: {
      action: 'run_fix_p0',
      loop_hint_max: 2,
      fix_cmd: ['/bun', '/fix', '/artifact'],
    },
  }, { action_inputs: boundAction });
  const changed = structuredClone(current);
  changed.action_inputs = structuredClone(boundAction);
  changed.action_inputs.artifact_locator_sha256 = digest('f');
  expect(verifyDecisionBinding(decision, changed)).toEqual({
    status: 'stale',
    issues: [{ code: 'ACTION_CHANGED' }],
    checked: ALL_CHECKED,
  });
});

test('simultaneous complete mismatches return every issue in stable class order', () => {
  const decision = receiptDecision({
    decision: 'fix_geometry',
    next: {
      action: 'run_fix_p0',
      loop_hint_max: 2,
      fix_cmd: ['/bun', '/fix', '/artifact'],
    },
  }, {
    contract: { status: 'bound', sha256: digest('5') },
    action_inputs: boundAction,
  });
  const changed = structuredClone(current);
  changed.artifact_sha256 = digest('f');
  changed.contract = { status: 'bound', sha256: digest('6') };
  changed.action_inputs = structuredClone(boundAction);
  changed.action_inputs.script_locator_sha256 = digest('f');
  changed.policy.profile = 'changed';
  changed.schemaComparison = {
    matches: false,
    changes: [
      { code: 'MANIFEST_FILE_CHANGED', relative_path: 'schemas/a.schema.json' },
    ],
  };
  expect(verifyDecisionBinding(decision, changed)).toEqual({
    status: 'stale',
    issues: [
      { code: 'ARTIFACT_CHANGED' },
      { code: 'CONTRACT_CHANGED' },
      { code: 'ACTION_CHANGED' },
      { code: 'POLICY_CHANGED' },
      {
        code: 'MANIFEST_FILE_CHANGED',
        manifest_kind: 'schemas',
        relative_path: 'schemas/a.schema.json',
      },
    ],
    checked: ALL_CHECKED,
  });
});

test('current action status must remain coherent with the stored decision', () => {
  const changed = structuredClone(current);
  changed.action_inputs = structuredClone(boundAction);
  expectCurrentInputError(() => verifyDecisionBinding(receiptDecision(), changed));
});

test('schema and installation changes merge without loss in stable issue order', () => {
  const changed = structuredClone(current);
  changed.schemaComparison = {
    matches: false,
    changes: [
      { code: 'MANIFEST_FILE_MISSING', relative_path: 'schemas/a.schema.json' },
      { code: 'MANIFEST_FILE_CHANGED', relative_path: 'schemas/z.schema.json' },
    ],
  };
  changed.installationComparison = {
    matches: false,
    changes: [
      { code: 'MANIFEST_FILE_MISSING', relative_path: 'lib/a.mjs' },
      { code: 'MANIFEST_FILE_ADDED', relative_path: 'lib/b.mjs' },
    ],
  };
  expect(verifyDecisionBinding(receiptDecision(), changed)).toEqual({
    status: 'stale',
    issues: [
      {
        code: 'MANIFEST_FILE_MISSING',
        manifest_kind: 'schemas',
        relative_path: 'schemas/a.schema.json',
      },
      {
        code: 'MANIFEST_FILE_MISSING',
        manifest_kind: 'installation',
        relative_path: 'lib/a.mjs',
      },
      {
        code: 'MANIFEST_FILE_ADDED',
        manifest_kind: 'installation',
        relative_path: 'lib/b.mjs',
      },
      {
        code: 'MANIFEST_FILE_CHANGED',
        manifest_kind: 'schemas',
        relative_path: 'schemas/z.schema.json',
      },
    ],
    checked: ALL_CHECKED,
  });
});

test('stale manifest paths use raw lexical order rather than locale collation', () => {
  const changed = structuredClone(current);
  changed.schemaComparison = {
    matches: false,
    changes: [
      { code: 'MANIFEST_FILE_CHANGED', relative_path: 'schemas/Z.schema.json' },
      { code: 'MANIFEST_FILE_CHANGED', relative_path: 'schemas/a.schema.json' },
    ],
  };
  expect(verifyDecisionBinding(receiptDecision(), changed).issues).toEqual([
    {
      code: 'MANIFEST_FILE_CHANGED',
      manifest_kind: 'schemas',
      relative_path: 'schemas/Z.schema.json',
    },
    {
      code: 'MANIFEST_FILE_CHANGED',
      manifest_kind: 'schemas',
      relative_path: 'schemas/a.schema.json',
    },
  ]);
});

test('all computable invalid-class issues are returned in published code order', () => {
  const decision = receiptDecision();
  decision.decision = 'fix_geometry';
  decision.next = {
    action: 'run_fix_p0',
    loop_hint_max: 2,
    fix_cmd: ['/bun', '/fix', '/artifact'],
  };
  decision.binding.policy_sha256 = digest('e');
  expect(validateReceiptV1Shape(decision)).toEqual({
    status: 'invalid',
    issues: [
      { code: 'POLICY_DIGEST_MISMATCH' },
      { code: 'CORE_DIGEST_MISMATCH' },
      { code: 'ACTION_INTERNAL_MISMATCH' },
    ],
  });
});

function expectCurrentInputError(callback) {
  try {
    callback();
    throw new Error('expected ReceiptCurrentInputError');
  } catch (error) {
    expect(error).toBeInstanceOf(ReceiptCurrentInputError);
    expect(error.code).toBe('CURRENT_INPUT_INVALID');
  }
}

test.each([
  [
    'contradictory matches',
    {
      matches: true,
      changes: [{ code: 'MANIFEST_FILE_MISSING', relative_path: 'schemas/a.schema.json' }],
    },
  ],
  [
    'unknown code',
    {
      matches: false,
      changes: [{ code: 'UNKNOWN', relative_path: 'schemas/a.schema.json' }],
    },
  ],
  [
    'duplicate path with different codes',
    {
      matches: false,
      changes: [
        { code: 'MANIFEST_FILE_MISSING', relative_path: 'schemas/a.schema.json' },
        { code: 'MANIFEST_FILE_CHANGED', relative_path: 'schemas/a.schema.json' },
      ],
    },
  ],
  [
    'unsorted paths',
    {
      matches: false,
      changes: [
        { code: 'MANIFEST_FILE_MISSING', relative_path: 'schemas/z.schema.json' },
        { code: 'MANIFEST_FILE_ADDED', relative_path: 'schemas/a.schema.json' },
      ],
    },
  ],
  [
    'invalid namespace',
    {
      matches: false,
      changes: [{ code: 'MANIFEST_FILE_ADDED', relative_path: 'lib/a.mjs' }],
    },
  ],
])('hostile current schema comparison rejects %s', (_name, comparison) => {
  const changed = structuredClone(current);
  changed.schemaComparison = comparison;
  expectCurrentInputError(() => verifyDecisionBinding(receiptDecision(), changed));
});

function policyCorpus() {
  return [
    ['valid baseline', () => {}, true],
    ['empty profile', (policy) => { policy.profile = ''; }, false],
    [
      'pptx without effective slide',
      (policy) => { policy.adapter = { id: 'pptx', effective_slide: null }; },
      false,
    ],
    [
      'non-pptx with effective slide',
      (policy) => { policy.adapter.effective_slide = 1; },
      false,
    ],
    [
      'lint without token digest',
      (policy) => { policy.lint = true; },
      false,
    ],
    [
      'disabled lint with token digest',
      (policy) => { policy.resources.tokens_sha256 = digest('d'); },
      false,
    ],
    [
      'unsupported validator mode',
      (policy) => { policy.validation.mode = 'manual'; },
      false,
    ],
    [
      'non-Bun runtime',
      (policy) => { policy.runtime.engine = 'node'; },
      false,
    ],
    [
      'unknown adapter descendant',
      (policy) => { policy.adapter.extra = true; },
      false,
    ],
    [
      'wrong schema manifest namespace',
      (policy) => {
        policy.resources.schemas.files[0].relative_path = 'lib/not-a-schema.mjs';
        policy.resources.schemas.sha256 = sha256Json(policy.resources.schemas.files);
      },
      false,
    ],
    [
      'unsorted schema manifest',
      (policy) => {
        policy.resources.schemas.files.reverse();
        policy.resources.schemas.sha256 = sha256Json(policy.resources.schemas.files);
      },
      false,
    ],
    [
      'schema manifest aggregate mismatch',
      (policy) => { policy.resources.schemas.sha256 = digest('f'); },
      false,
    ],
    [
      'duplicate schema path with different digests',
      (policy) => {
        policy.resources.schemas.files = [
          { relative_path: 'schemas/a.schema.json', sha256: digest('1') },
          { relative_path: 'schemas/a.schema.json', sha256: digest('2') },
        ];
        policy.resources.schemas.sha256 = sha256Json(policy.resources.schemas.files);
      },
      false,
    ],
    [
      'Task 2-valid Unicode schema path',
      (policy) => {
        policy.resources.schemas.files = [
          { relative_path: 'schemas/é.schema.json', sha256: digest('1') },
        ];
        policy.resources.schemas.sha256 = sha256Json(policy.resources.schemas.files);
      },
      true,
    ],
  ];
}

test('stored, current, and mutable-schema policy validators share one parity corpus', async () => {
  const validator = await createRunValidator(captureSchemaBundle(repoRoot));
  for (const [name, mutate, expected] of policyCorpus()) {
    const policy = literalPolicyFixture();
    mutate(policy);

    const stored = receiptDecision();
    stored.binding.policy = structuredClone(policy);
    stored.binding.policy_sha256 = sha256Json(policy);
    const pinnedAccepted = validateReceiptV1Shape(stored).status === 'bound';

    const currentInput = structuredClone(current);
    currentInput.policy = structuredClone(policy);
    let currentAccepted = true;
    try {
      verifyDecisionBinding(receiptDecision(), currentInput);
    } catch (error) {
      if (!(error instanceof ReceiptCurrentInputError)) throw error;
      currentAccepted = false;
    }

    let mutableAccepted = true;
    try {
      validator.validate('decision', stored);
    } catch {
      mutableAccepted = false;
    }

    expect(
      { pinnedAccepted, currentAccepted, mutableAccepted },
      name,
    ).toEqual({
      pinnedAccepted: expected,
      currentAccepted: expected,
      mutableAccepted: expected,
    });
  }
});

test('mutable decision schema keeps legacy unbound valid and enforces paired receipt cross-fields', async () => {
  const validator = await createRunValidator(captureSchemaBundle(repoRoot));
  expect(() => validator.validate('decision', legacyDecision)).not.toThrow();
  expect(() => validator.validate('decision', receiptDecision())).not.toThrow();

  const invalidCases = [];
  invalidCases.push({
    ...structuredClone(legacyDecision),
    claim_scope: buildClaimScope({}),
  });

  const nestedUnknown = receiptDecision();
  nestedUnknown.binding.contract.extra = true;
  invalidCases.push(nestedUnknown);

  const malformedDigest = receiptDecision();
  malformedDigest.binding.artifact.sha256 = 'abc';
  invalidCases.push(malformedDigest);

  const completenessMismatch = receiptDecision();
  completenessMismatch.binding.completeness = 'incomplete';
  invalidCases.push(completenessMismatch);

  const contractMismatch = receiptDecision();
  contractMismatch.binding.contract = { status: 'not_requested', sha256: digest('a') };
  invalidCases.push(contractMismatch);

  const actionMismatch = receiptDecision();
  actionMismatch.binding.action_inputs = structuredClone(boundAction);
  invalidCases.push(actionMismatch);

  for (const invalid of invalidCases) {
    expect(() => validator.validate('decision', invalid)).toThrow();
  }
});

test.each([
  ['missing current field', (value) => { delete value.policy; }],
  ['uppercase artifact digest', (value) => { value.artifact_sha256 = digest('A'); }],
  ['unknown current contract field', (value) => { value.contract.extra = true; }],
  ['invalid current policy', (value) => { value.policy.runtime.engine = 'node'; }],
])('malformed current input throws for %s', (_name, mutate) => {
  const changed = structuredClone(current);
  mutate(changed);
  expectCurrentInputError(() => verifyDecisionBinding(receiptDecision(), changed));
});
