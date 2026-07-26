import { expect, test } from 'bun:test';
import path from 'node:path';
import { sha256Bytes } from '../lib/shared/canonical-json.mjs';
import { ReceiptCurrentInputError } from '../lib/skill-receipt-core.mjs';
import {
  ActionParseError,
  buildFixAction,
  inspectStoredFixAction,
  parseFixAction,
  verifyFixAction,
} from '../lib/skill-action.mjs';

const contractBytes = Buffer.from('{"schema_version":1}');
const absoluteCommand = [
  '/opt/bun/bin/bun',
  '/opt/aesthete/lib/fix.mjs',
  '/work/deck.pptx',
  '--contract', '/work/contract.json',
  '--domain', 'pptx',
  '--slide', '2',
  '--profile', 'strict',
];
const actionFixture = {
  executable: '/opt/bun/bin/bun',
  skillRoot: '/opt/aesthete',
  artifactPath: '/work/deck.pptx',
  contractPath: '/work/contract.json',
  contractBytes,
  adapter: 'pptx',
  slide: 2,
  profile: 'strict',
};

const locatorDigest = (value) => sha256Bytes(Buffer.from(value, 'utf8'));

function expectParseError(command) {
  try {
    parseFixAction(command);
    throw new Error('expected ActionParseError');
  } catch (error) {
    expect(error).toBeInstanceOf(ActionParseError);
    expect(error.code).toBe('ACTION_GRAMMAR_INVALID');
  }
}

function expectCurrentError(callback) {
  try {
    callback();
    throw new Error('expected ReceiptCurrentInputError');
  } catch (error) {
    expect(error).toBeInstanceOf(ReceiptCurrentInputError);
    expect(error.code).toBe('CURRENT_INPUT_INVALID');
  }
}

test('fix action is absolute and carries explicit contract/domain/slide/profile', () => {
  const before = structuredClone(actionFixture);
  const built = buildFixAction(actionFixture);
  expect(built.command).toEqual(absoluteCommand);
  expect(built.action_inputs).toEqual({
    status: 'bound',
    runtime_executable_locator_sha256: locatorDigest('/opt/bun/bin/bun'),
    script_locator_sha256: locatorDigest('/opt/aesthete/lib/fix.mjs'),
    artifact_locator_sha256: locatorDigest('/work/deck.pptx'),
    contract_locator_sha256: locatorDigest('/work/contract.json'),
    contract_sha256: sha256Bytes(contractBytes),
    adapter: 'pptx',
    slide: 2,
    profile: 'strict',
  });
  expect(actionFixture).toEqual(before);
});

test('builder lexically normalizes relative locator inputs once', () => {
  const built = buildFixAction({
    ...actionFixture,
    executable: './runtime/bun',
    skillRoot: './skill',
    artifactPath: './input/deck.pptx',
    contractPath: './input/contract.json',
  });
  expect(built.command.slice(0, 5)).toEqual([
    path.resolve('./runtime/bun'),
    path.join(path.resolve('./skill'), 'lib', 'fix.mjs'),
    path.resolve('./input/deck.pptx'),
    '--contract',
    path.resolve('./input/contract.json'),
  ]);
});

test.each([
  ['svg', null],
  ['html', null],
  ['docx', null],
  ['xlsx', null],
  ['image', null],
  ['alt', null],
  ['pptx', 1],
])('builder emits canonical optional flags for %s', (adapter, slide) => {
  const built = buildFixAction({
    ...actionFixture,
    adapter,
    slide,
    profile: null,
  });
  expect(built.command.includes('--profile')).toBe(false);
  expect(built.command.includes('--slide')).toBe(adapter === 'pptx');
  if (adapter === 'pptx') {
    expect(built.command.slice(-2)).toEqual(['--slide', '1']);
  }
  expect(built.action_inputs).toMatchObject({ adapter, slide, profile: null });
});

test.each([
  ['unsupported adapter', { adapter: 'pdf', slide: null }],
  ['PPTX without slide', { adapter: 'pptx', slide: null }],
  ['PPTX zero slide', { adapter: 'pptx', slide: 0 }],
  ['PPTX fractional slide', { adapter: 'pptx', slide: 1.5 }],
  ['non-PPTX slide', { adapter: 'svg', slide: 1 }],
  ['empty profile', { profile: '' }],
  ['flag-shaped profile', { profile: '--strict' }],
  ['non-string profile', { profile: 3 }],
  ['missing contract bytes', { contractBytes: undefined }],
])('builder rejects malformed current input: %s', (_name, overrides) => {
  expectCurrentError(() => buildFixAction({ ...actionFixture, ...overrides }));
});

test('parsing an action is cwd-independent and returns exact typed fields', () => {
  expect(parseFixAction(absoluteCommand)).toEqual({
    executable: '/opt/bun/bin/bun',
    scriptPath: '/opt/aesthete/lib/fix.mjs',
    artifactPath: '/work/deck.pptx',
    contractPath: '/work/contract.json',
    adapter: 'pptx',
    slide: 2,
    profile: 'strict',
  });
});

const grammarCases = [
  ['not an array', null],
  ['bare executable', ['bun', ...absoluteCommand.slice(1)]],
  ['relative script', [absoluteCommand[0], 'lib/fix.mjs', ...absoluteCommand.slice(2)]],
  ['relative artifact', [...absoluteCommand.slice(0, 2), 'deck.pptx', ...absoluteCommand.slice(3)]],
  ['relative contract', [...absoluteCommand.slice(0, 4), 'contract.json', ...absoluteCommand.slice(5)]],
  ['nonnormal executable', ['/opt/bun/../bun', ...absoluteCommand.slice(1)]],
  ['missing contract flag', absoluteCommand.filter((token) => token !== '--contract')],
  ['missing contract value', [...absoluteCommand.slice(0, 4), '--domain', ...absoluteCommand.slice(5)]],
  ['missing domain flag', absoluteCommand.filter((token) => token !== '--domain')],
  ['missing domain value', [...absoluteCommand.slice(0, 6), '--slide', ...absoluteCommand.slice(7)]],
  ['unsupported domain', [...absoluteCommand.slice(0, 6), 'pdf', ...absoluteCommand.slice(7)]],
  ['duplicate profile', [...absoluteCommand, '--profile', 'again']],
  ['duplicate slide', [...absoluteCommand, '--slide', '3']],
  ['unknown flag', [...absoluteCommand, '--unknown', 'x']],
  ['extra operand', [...absoluteCommand, 'extra']],
  ['missing PPTX slide', absoluteCommand.slice(0, 7)],
  ['PPTX slide without value', [...absoluteCommand.slice(0, 7), '--slide']],
  ['PPTX zero slide', [...absoluteCommand.slice(0, 8), '0']],
  ['PPTX leading-zero slide', [...absoluteCommand.slice(0, 8), '01']],
  ['PPTX plus slide', [...absoluteCommand.slice(0, 8), '+1']],
  ['PPTX decimal slide', [...absoluteCommand.slice(0, 8), '1.0']],
  ['PPTX exponent slide', [...absoluteCommand.slice(0, 8), '1e2']],
  ['PPTX fractional slide', [...absoluteCommand.slice(0, 8), '1.5']],
  ['empty profile', [...absoluteCommand.slice(0, 10), '']],
  [
    'profile before slide',
    [
      ...absoluteCommand.slice(0, 7),
      '--profile', 'strict',
      '--slide', '2',
    ],
  ],
  [
    'slide on non-PPTX',
    [
      ...absoluteCommand.slice(0, 6),
      'svg',
      '--slide', '2',
    ],
  ],
];

test.each(grammarCases)('parser rejects %s with one stable code', (_name, command) => {
  expectParseError(command);
});

test('parser accepts the exact non-PPTX form with an optional final profile', () => {
  expect(parseFixAction([
    '/opt/bun/bin/bun',
    '/opt/aesthete/lib/fix.mjs',
    '/work/layout.svg',
    '--contract', '/work/contract.json',
    '--domain', 'svg',
    '--profile', 'strict',
  ])).toMatchObject({
    adapter: 'svg',
    slide: null,
    profile: 'strict',
  });
});

test('parser accepts canonical Windows locators independently of verifier host OS', () => {
  expect(parseFixAction([
    'C:\\Program Files\\Bun\\bun.exe',
    'C:\\aesthete\\lib\\fix.mjs',
    'D:\\work\\deck.pptx',
    '--contract', 'D:\\work\\contract.json',
    '--domain', 'pptx',
    '--slide', '2',
  ])).toEqual({
    executable: 'C:\\Program Files\\Bun\\bun.exe',
    scriptPath: 'C:\\aesthete\\lib\\fix.mjs',
    artifactPath: 'D:\\work\\deck.pptx',
    contractPath: 'D:\\work\\contract.json',
    adapter: 'pptx',
    slide: 2,
    profile: null,
  });
});

function decisionFor(built = buildFixAction(actionFixture)) {
  return {
    decision: 'fix_geometry',
    next: { action: 'run_fix_p0', fix_cmd: built.command },
    binding: { action_inputs: built.action_inputs },
  };
}

test('stored fix action inspection requires no current input', () => {
  expect(inspectStoredFixAction(decisionFor())).toEqual({
    status: 'valid',
    issues: [],
  });
  const malformed = decisionFor();
  malformed.next.fix_cmd[2] = '/work/other.pptx';
  expect(inspectStoredFixAction(malformed)).toEqual({
    status: 'invalid',
    issues: [{ code: 'ACTION_INTERNAL_MISMATCH' }],
  });
});

test('a canonical foreign-platform command is stale rather than internally invalid', () => {
  const command = [
    'C:\\Program Files\\Bun\\bun.exe',
    'C:\\aesthete\\lib\\fix.mjs',
    'D:\\work\\deck.pptx',
    '--contract', 'D:\\work\\contract.json',
    '--domain', 'pptx',
    '--slide', '2',
  ];
  const decision = {
    decision: 'fix_geometry',
    next: { action: 'run_fix_p0', fix_cmd: command },
    binding: {
      action_inputs: {
        status: 'bound',
        runtime_executable_locator_sha256: locatorDigest(command[0]),
        script_locator_sha256: locatorDigest(command[1]),
        artifact_locator_sha256: locatorDigest(command[2]),
        contract_locator_sha256: locatorDigest(command[4]),
        contract_sha256: sha256Bytes(contractBytes),
        adapter: 'pptx',
        slide: 2,
        profile: null,
      },
    },
  };
  expect(verifyFixAction(decision, {
    ...actionFixture,
    profile: null,
  })).toEqual({
    status: 'stale',
    issues: [{ code: 'ACTION_CHANGED' }],
  });
});

test('action verification separates internal invalid from current-input stale', () => {
  const decision = decisionFor();
  expect(verifyFixAction(decision, actionFixture)).toEqual({
    status: 'current',
    issues: [],
  });
  const edited = structuredClone(decision);
  edited.next.fix_cmd[2] = '/work/other.pptx';
  expect(verifyFixAction(edited, actionFixture)).toEqual({
    status: 'invalid',
    issues: [{ code: 'ACTION_INTERNAL_MISMATCH' }],
  });
  expect(verifyFixAction(decision, {
    ...actionFixture,
    contractBytes: Buffer.from('changed'),
  })).toEqual({
    status: 'stale',
    issues: [{ code: 'ACTION_CHANGED' }],
  });
});

test.each([
  ['executable locator', { executable: '/other/bun' }],
  ['script locator', { skillRoot: '/other/aesthete' }],
  ['artifact locator', { artifactPath: '/work/other.pptx' }],
  ['contract locator', { contractPath: '/work/other.json' }],
  ['contract content', { contractBytes: Buffer.from('changed') }],
  ['slide', { slide: 3 }],
  ['profile', { profile: 'other' }],
])('each current action field participates in freshness: %s', (_name, overrides) => {
  expect(verifyFixAction(decisionFor(), {
    ...actionFixture,
    ...overrides,
  })).toEqual({
    status: 'stale',
    issues: [{ code: 'ACTION_CHANGED' }],
  });
});

test('adapter participates in freshness while preserving a valid current shape', () => {
  expect(verifyFixAction(decisionFor(), {
    ...actionFixture,
    adapter: 'svg',
    slide: null,
  })).toEqual({
    status: 'stale',
    issues: [{ code: 'ACTION_CHANGED' }],
  });
});

test.each([
  ['wrong decision', (decision) => { decision.decision = 'pass'; }],
  ['wrong next action', (decision) => { decision.next.action = 'stop'; }],
  ['malformed stored command', (decision) => { decision.next.fix_cmd = ['bun']; }],
  [
    'stored locator mismatch',
    (decision) => {
      decision.binding.action_inputs.artifact_locator_sha256 = 'f'.repeat(64);
    },
  ],
  [
    'stored content digest shape',
    (decision) => { decision.binding.action_inputs.contract_sha256 = 'short'; },
  ],
])('stored action mismatch is invalid: %s', (_name, mutate) => {
  const decision = decisionFor();
  mutate(decision);
  expect(verifyFixAction(decision, actionFixture)).toEqual({
    status: 'invalid',
    issues: [{ code: 'ACTION_INTERNAL_MISMATCH' }],
  });
});

test('internal invalid wins over simultaneous current staleness', () => {
  const decision = decisionFor();
  decision.next.fix_cmd[2] = '/work/edited.pptx';
  expect(verifyFixAction(decision, {
    ...actionFixture,
    contractBytes: Buffer.from('changed'),
  })).toEqual({
    status: 'invalid',
    issues: [{ code: 'ACTION_INTERNAL_MISMATCH' }],
  });
});

test.each([
  ['missing field', (value) => { delete value.contractBytes; }],
  ['unknown field', (value) => { value.extra = true; }],
  ['invalid adapter/slide', (value) => { value.slide = null; }],
])('verification rejects malformed current action input: %s', (_name, mutate) => {
  const changed = { ...actionFixture };
  mutate(changed);
  expectCurrentError(() => verifyFixAction(decisionFor(), changed));
});
