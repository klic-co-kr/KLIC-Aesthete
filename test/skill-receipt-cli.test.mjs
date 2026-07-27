import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseReceiptArgs,
  ReceiptUsageError,
  verifyReceiptFiles,
} from '../lib/skill-receipt.mjs';
import { runPost } from '../lib/skill-post.mjs';
import {
  decisionCore,
} from '../lib/skill-receipt-core.mjs';
import {
  sha256Json,
} from '../lib/shared/canonical-json.mjs';
import { makeTwoSlideDeck } from './helpers/pptx-fixture.mjs';
import { makeIntent } from './helpers/intent-fixture.mjs';
import { parseFixAction } from '../lib/skill-action.mjs';
import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = path.resolve(import.meta.dir, '..');

function copyReceiptFixtureRoot(target) {
  for (const directory of ['lib', 'schemas', 'examples']) {
    fs.cpSync(path.join(repoRoot, directory), path.join(target, directory), {
      recursive: true,
    });
  }
  for (const file of ['package.json', 'bun.lock', 'package-lock.json']) {
    fs.copyFileSync(path.join(repoRoot, file), path.join(target, file));
  }
}

function countedReader(onRead = () => {}) {
  const counts = new Map();
  return {
    counts,
    readFile(filePath) {
      const absolute = path.resolve(filePath);
      const bytes = fs.readFileSync(absolute);
      const count = (counts.get(absolute) || 0) + 1;
      counts.set(absolute, count);
      onRead(absolute, count);
      return bytes;
    },
    count(filePath) {
      return counts.get(path.resolve(filePath)) || 0;
    },
  };
}

function expectUsageError(argv) {
  try {
    parseReceiptArgs(argv);
    throw new Error('expected ReceiptUsageError');
  } catch (error) {
    expect(error).toBeInstanceOf(ReceiptUsageError);
    expect(error.code).toBe('RECEIPT_USAGE_INVALID');
  }
}

test('receipt args accept one verify command, two positionals, and known flags', () => {
  expect(parseReceiptArgs([
    'verify',
    'decision.json',
    'artifact.svg',
    '--contract',
    'contract.json',
    '--lint',
    '--slide',
    '2',
  ])).toEqual({
    command: 'verify',
    decisionPath: 'decision.json',
    artifactPath: 'artifact.svg',
    flags: {
      contract: 'contract.json',
      lint: true,
      slide: 2,
    },
    outPath: null,
  });
});

test('receipt args accept one strict intent path', () => {
  expect(parseReceiptArgs([
    'verify',
    'decision.json',
    'artifact.svg',
    '--intent',
    'intent.json',
  ])).toMatchObject({
    flags: { intent: 'intent.json' },
  });
});

test('receipt args preserve all allowlisted policy flags and separate out', () => {
  expect(parseReceiptArgs([
    'verify',
    'd.json',
    'deck.pptx',
    '--domain',
    'pptx',
    '--slide',
    '1',
    '--profile',
    'strict',
    '--structure',
    'hero-grid',
    '--type',
    'report',
    '--vuln',
    '--vuln-gate',
    '--slop',
    '--slop-gate',
    '--slop-autofix',
    '--human-on-unfixable',
    '--out',
    'verify.json',
  ])).toEqual({
    command: 'verify',
    decisionPath: 'd.json',
    artifactPath: 'deck.pptx',
    flags: {
      domain: 'pptx',
      slide: 1,
      profile: 'strict',
      structure: 'hero-grid',
      type: 'report',
      vuln: true,
      'vuln-gate': true,
      slop: true,
      'slop-gate': true,
      'slop-autofix': true,
      'human-on-unfixable': true,
    },
    outPath: 'verify.json',
  });
});

test.each([
  [['check', 'd.json', 'a.svg'], 'wrong command'],
  [['verify', 'd.json'], 'missing positional'],
  [['verify', 'd.json', 'a.svg', 'extra'], 'extra positional'],
  [['verify', 'd.json', 'a.svg', '--typo'], 'unknown flag'],
  [['verify', 'd.json', 'a.svg', '--lint', '--lint'], 'duplicate flag'],
  [['verify', 'd.json', 'a.svg', '--contract'], 'missing value'],
  [['verify', 'd.json', 'a.svg', '--contract', ''], 'empty value'],
  [['verify', 'd.json', 'a.svg', '--lint', 'false'], 'boolean value'],
  [['verify', 'd.json', 'a.svg', '--'], 'separator'],
  [['verify', 'd.json', 'a.svg', '--profile=strict'], 'equals shorthand'],
  [['verify', 'd.json', 'a.svg', '--out', '--lint'], 'flag-shaped value'],
])('receipt args reject %s: %s', (argv) => {
  expectUsageError(argv);
});

test.each([
  [['verify', 'd.json', 'a.svg', '--slide', '0'], 'SLIDE_INVALID'],
  [['verify', 'd.json', 'a.svg', '--slide', '01'], 'SLIDE_INVALID'],
  [['verify', 'd.json', 'a.svg', '--slide', '1.5'], 'SLIDE_INVALID'],
  [['verify', 'd.json', 'a.svg', '--slide', '9007199254740992'], 'SLIDE_INVALID'],
  [['verify', 'd.json', 'a.svg', '--domain', 'unsupported'], 'DOMAIN_INVALID'],
])('receipt args preserve semantic input code for %s', (argv, code) => {
  try {
    parseReceiptArgs(argv);
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error.name).toBe('ReceiptInputError');
    expect(error.code).toBe(code);
  }
});

test('package receipt script dispatches to the strict verifier', () => {
  const result = spawnSync(process.execPath, [
    'run',
    'receipt',
    '--',
    'verify',
    'missing-decision.json',
    'artifact.svg',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('DECISION_INPUT_INVALID');
});

describe('verifyReceiptFiles snapshot fold', () => {
  let tempDir;
  let fixtureRoot;
  let goodPath;
  let badPath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aesthete-receipt-verify-'));
    fixtureRoot = path.join(tempDir, 'skill');
    fs.mkdirSync(fixtureRoot);
    copyReceiptFixtureRoot(fixtureRoot);
    goodPath = path.join(fixtureRoot, 'examples', 'catalog-good.layout.json');
    badPath = path.join(fixtureRoot, 'examples', 'catalog-bad.layout.json');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function emitDecision(artifactPath, flags = {}, name = 'decision.json') {
    const result = await runPost(artifactPath, {
      flags,
      deps: { root: fixtureRoot },
    });
    const decisionPath = path.join(tempDir, name);
    fs.writeFileSync(decisionPath, JSON.stringify(result.decision));
    return { decision: result.decision, decisionPath };
  }

  function writeIntent(name, goal) {
    const intentPath = path.join(tempDir, name);
    fs.writeFileSync(intentPath, JSON.stringify(makeIntent(goal)));
    return intentPath;
  }

  test('v2 intent current, stale, and missing matrix is exact', async () => {
    const intentA = writeIntent('intent-a.json', 'first');
    const intentB = writeIntent('intent-b.json', 'second');
    const emitted = await emitDecision(
      goodPath,
      { intent: intentA },
      'intent-bound.json',
    );

    expect((await verifyReceiptFiles({
      decisionPath: emitted.decisionPath,
      artifactPath: goodPath,
      flags: { intent: intentA },
    }, { root: fixtureRoot })).status).toBe('current');

    expect((await verifyReceiptFiles({
      decisionPath: emitted.decisionPath,
      artifactPath: goodPath,
      flags: { intent: intentB },
    }, { root: fixtureRoot })).issues).toEqual([
      { code: 'INTENT_CHANGED' },
    ]);

    try {
      await verifyReceiptFiles({
        decisionPath: emitted.decisionPath,
        artifactPath: goodPath,
        flags: {},
      }, { root: fixtureRoot });
      throw new Error('expected CURRENT_INPUT_INVALID');
    } catch (error) {
      expect(error.code).toBe('CURRENT_INPUT_INVALID');
    }
  });

  test('v2 not-requested intent becomes stale when valid intent is supplied', async () => {
    const intentPath = writeIntent('intent-added.json', 'added');
    const emitted = await emitDecision(goodPath, {}, 'intent-not-requested.json');
    const result = await verifyReceiptFiles({
      decisionPath: emitted.decisionPath,
      artifactPath: goodPath,
      flags: { intent: intentPath },
    }, { root: fixtureRoot });
    expect(result.status).toBe('stale');
    expect(result.issues).toEqual([{ code: 'INTENT_CHANGED' }]);
  });

  test('malformed current intent is an input error, never stale', async () => {
    const intentPath = path.join(tempDir, 'intent-malformed.json');
    fs.writeFileSync(intentPath, '{"schema":"a","schema":"b"}');
    const emitted = await emitDecision(goodPath, {}, 'intent-invalid-current.json');
    try {
      await verifyReceiptFiles({
        decisionPath: emitted.decisionPath,
        artifactPath: goodPath,
        flags: { intent: intentPath },
      }, { root: fixtureRoot });
      throw new Error('expected INTENT_INPUT_INVALID');
    } catch (error) {
      expect(error.code).toBe('INTENT_INPUT_INVALID');
    }
  });

  test('unchanged complete receipt is current and each primary input is read once', async () => {
    const { decisionPath } = await emitDecision(goodPath);
    const reader = countedReader();
    const result = await verifyReceiptFiles({
      decisionPath,
      artifactPath: goodPath,
      flags: {},
    }, {
      root: fixtureRoot,
      io: reader,
    });
    expect(result).toEqual({
      schema: 'aesthete.receipt-verification/v1',
      status: 'current',
      issues: [],
      checked: [
        'decision_core_sha256',
        'artifact.sha256',
        'contract.status',
        'contract.sha256',
        'intent.status',
        'intent.sha256',
        'action_inputs',
        'policy_sha256',
      ],
    });
    expect(reader.count(decisionPath)).toBe(1);
    expect(reader.count(goodPath)).toBe(1);
  });

  test('invalid, unbound, stored-action-invalid, and incomplete return before current reads', async () => {
    const complete = (await emitDecision(goodPath, {}, 'complete.json')).decision;
    const fix = (await emitDecision(badPath, {}, 'fix.json')).decision;
    const incomplete = (await runPost(path.join(tempDir, 'missing.alt.json'), {
      flags: {},
      deps: { root: fixtureRoot },
    })).decision;
    const cases = [
      ['invalid.json', { decision: 'pass' }, 'invalid'],
      [
        'unbound.json',
        (() => {
          const value = structuredClone(complete);
          delete value.claim_scope;
          delete value.binding;
          return value;
        })(),
        'unbound',
      ],
      [
        'partial.json',
        (() => {
          const value = structuredClone(complete);
          delete value.binding;
          return value;
        })(),
        'invalid',
      ],
      [
        'action-invalid.json',
        (() => {
          const value = structuredClone(fix);
          value.next.fix_cmd[2] = path.join(tempDir, 'other.alt.json');
          value.binding.decision_core_sha256 = sha256Json(decisionCore(value));
          return value;
        })(),
        'invalid',
      ],
      ['incomplete.json', incomplete, 'incomplete'],
    ];
    for (const [name, decision, status] of cases) {
      const decisionPath = path.join(tempDir, name);
      fs.writeFileSync(decisionPath, JSON.stringify(decision));
      const reader = countedReader();
      const result = await verifyReceiptFiles({
        decisionPath,
        artifactPath: goodPath,
        flags: {},
      }, {
        root: fixtureRoot,
        io: reader,
      });
      expect(result.status).toBe(status);
      expect(result.checked).toEqual([]);
      expect(reader.count(decisionPath)).toBe(1);
      expect(reader.count(goodPath)).toBe(0);
      expect(reader.counts.size).toBe(1);
    }
  });

  test('artifact content change is stale without evaluator replay', async () => {
    const { decisionPath } = await emitDecision(goodPath);
    fs.appendFileSync(goodPath, '\n');
    const result = await verifyReceiptFiles({
      decisionPath,
      artifactPath: goodPath,
      flags: {},
    }, { root: fixtureRoot });
    expect(result.status).toBe('stale');
    expect(result.issues).toEqual([{ code: 'ARTIFACT_CHANGED' }]);
  });

  test('requested and default fix contract changes use exact combined issues', async () => {
    const requestedPath = path.join(
      fixtureRoot,
      'examples',
      'catalog.contract.json',
    );
    const requested = await emitDecision(
      badPath,
      { contract: requestedPath },
      'requested.json',
    );
    const requestedValue = JSON.parse(fs.readFileSync(requestedPath, 'utf8'));
    requestedValue.brief = 'changed requested contract';
    fs.writeFileSync(requestedPath, JSON.stringify(requestedValue));
    const requestedResult = await verifyReceiptFiles({
      decisionPath: requested.decisionPath,
      artifactPath: badPath,
      flags: { contract: requestedPath },
    }, { root: fixtureRoot });
    expect(requestedResult.status).toBe('stale');
    expect(requestedResult.issues).toEqual([
      { code: 'CONTRACT_CHANGED' },
      { code: 'ACTION_CHANGED' },
    ]);

    const freshRoot = path.join(tempDir, 'fresh-skill');
    fs.mkdirSync(freshRoot);
    copyReceiptFixtureRoot(freshRoot);
    const freshBad = path.join(freshRoot, 'examples', 'catalog-bad.layout.json');
    const defaultDecision = await runPost(freshBad, {
      flags: {},
      deps: { root: freshRoot },
    });
    const defaultDecisionPath = path.join(tempDir, 'default.json');
    fs.writeFileSync(defaultDecisionPath, JSON.stringify(defaultDecision.decision));
    const defaultPath = path.join(freshRoot, 'examples', 'catalog.contract.json');
    const defaultValue = JSON.parse(fs.readFileSync(defaultPath, 'utf8'));
    defaultValue.brief = 'changed default contract';
    fs.writeFileSync(defaultPath, JSON.stringify(defaultValue));
    const defaultResult = await verifyReceiptFiles({
      decisionPath: defaultDecisionPath,
      artifactPath: freshBad,
      flags: {},
    }, { root: freshRoot });
    expect(defaultResult.status).toBe('stale');
    expect(defaultResult.issues).toEqual([{ code: 'ACTION_CHANGED' }]);
  });

  test('valid schema and installation changes report policy plus manifest drift', async () => {
    const { decisionPath } = await emitDecision(goodPath);
    const schemaPath = path.join(fixtureRoot, 'schemas', 'alt.schema.json');
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    schema.description = 'changed but valid';
    fs.writeFileSync(schemaPath, JSON.stringify(schema));
    const installationPath = path.join(fixtureRoot, 'lib', 'measure.mjs');
    fs.appendFileSync(installationPath, '\n// changed but valid\n');
    const result = await verifyReceiptFiles({
      decisionPath,
      artifactPath: goodPath,
      flags: {},
    }, { root: fixtureRoot });
    expect(result.status).toBe('stale');
    expect(result.issues).toEqual([
      { code: 'POLICY_CHANGED' },
      {
        code: 'MANIFEST_FILE_CHANGED',
        manifest_kind: 'schemas',
        relative_path: 'schemas/alt.schema.json',
      },
      {
        code: 'MANIFEST_FILE_CHANGED',
        manifest_kind: 'installation',
        relative_path: 'lib/measure.mjs',
      },
    ]);
  });

  test('one operation cache binds every consumed first buffer despite mutation', async () => {
    const paramsPath = path.join(fixtureRoot, 'skill-params.json');
    const tokensPath = path.join(fixtureRoot, 'tokens.json');
    const contractPath = path.join(
      fixtureRoot,
      'examples',
      'catalog.contract.json',
    );
    fs.writeFileSync(
      paramsPath,
      JSON.stringify({ proximity: { ALPHA: 0.5 } }),
    );
    fs.writeFileSync(tokensPath, JSON.stringify({
      colors: ['#111827', '#ffffff'],
      fontScale: [24],
      radii: [0],
    }));
    const emitted = await emitDecision(badPath, {
      contract: contractPath,
      lint: true,
    }, 'mutating.json');
    const schemaPaths = emitted.decision.binding.policy.resources.schemas.files
      .map((entry) => path.join(fixtureRoot, entry.relative_path));
    const installationPaths = emitted.decision.binding.policy.resources
      .on_disk_installation.files
      .map((entry) => path.join(fixtureRoot, entry.relative_path));
    const schemaSet = new Set(schemaPaths);
    const installationSet = new Set(installationPaths);
    const reader = countedReader((filePath, count) => {
      if (count !== 1) return;
      if (filePath === emitted.decisionPath) {
        fs.writeFileSync(filePath, '{}');
      } else if (filePath === badPath) {
        fs.appendFileSync(filePath, '\n');
      } else if (filePath === contractPath) {
        const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        value.brief = 'changed after snapshot';
        fs.writeFileSync(filePath, JSON.stringify(value));
      } else if (filePath === paramsPath) {
        fs.writeFileSync(filePath, JSON.stringify({ proximity: { ALPHA: 99 } }));
      } else if (filePath === tokensPath) {
        fs.writeFileSync(filePath, JSON.stringify({
          colors: ['#000000'],
          fontScale: [12],
          radii: [16],
        }));
      } else if (schemaSet.has(filePath)) {
        fs.writeFileSync(filePath, '{');
      } else if (installationSet.has(filePath)) {
        fs.appendFileSync(filePath, '\nchanged after snapshot\n');
      }
    });
    const result = await verifyReceiptFiles({
      decisionPath: emitted.decisionPath,
      artifactPath: badPath,
      flags: {
        contract: contractPath,
        lint: true,
      },
    }, {
      root: fixtureRoot,
      io: reader,
    });
    expect(result.status).toBe('current');
    for (const filePath of [
      emitted.decisionPath,
      badPath,
      contractPath,
      paramsPath,
      tokensPath,
      ...schemaPaths,
      ...installationPaths,
    ]) {
      expect(reader.count(filePath)).toBe(1);
    }
  });

  test('policy-only current flag changes are stale without evaluator replay', async () => {
    const { decisionPath } = await emitDecision(goodPath);
    const changes = [
      { profile: 'strict' },
      { structure: 'hero-grid' },
      { type: 'report' },
      { lint: true },
      { vuln: true },
      { 'vuln-gate': true },
      { slop: true },
      { 'slop-gate': true },
      { 'slop-autofix': true },
      { 'human-on-unfixable': true },
      { domain: 'svg' },
    ];
    for (const flags of changes) {
      const result = await verifyReceiptFiles({
        decisionPath,
        artifactPath: goodPath,
        flags,
      }, { root: fixtureRoot });
      expect(result.status).toBe('stale');
      expect(result.issues).toEqual([{ code: 'POLICY_CHANGED' }]);
    }
  });

  test('params and lint-on tokens are policy-bound while lint-off tokens are ignored', async () => {
    const baseline = await emitDecision(goodPath, {}, 'baseline.json');
    const tokensPath = path.join(fixtureRoot, 'tokens.json');
    fs.writeFileSync(tokensPath, JSON.stringify({
      colors: ['#000000'],
      fontScale: [12],
      radii: [0],
    }));
    expect((await verifyReceiptFiles({
      decisionPath: baseline.decisionPath,
      artifactPath: goodPath,
      flags: {},
    }, { root: fixtureRoot })).status).toBe('current');

    const paramsPath = path.join(fixtureRoot, 'skill-params.json');
    fs.writeFileSync(paramsPath, JSON.stringify({ proximity: { ALPHA: 0.25 } }));
    expect((await verifyReceiptFiles({
      decisionPath: baseline.decisionPath,
      artifactPath: goodPath,
      flags: {},
    }, { root: fixtureRoot })).issues).toEqual([{ code: 'POLICY_CHANGED' }]);

    fs.unlinkSync(paramsPath);
    const linted = await emitDecision(goodPath, { lint: true }, 'linted.json');
    fs.writeFileSync(tokensPath, JSON.stringify({
      colors: ['#ffffff'],
      fontScale: [24],
      radii: [16],
    }));
    expect((await verifyReceiptFiles({
      decisionPath: linted.decisionPath,
      artifactPath: goodPath,
      flags: { lint: true },
    }, { root: fixtureRoot })).issues).toEqual([{ code: 'POLICY_CHANGED' }]);
  });

  test('identical pass relocation is current while fix relocation changes the action', async () => {
    const pass = await emitDecision(goodPath, {}, 'pass-relocation.json');
    const relocatedGood = path.join(tempDir, 'relocated.layout.json');
    fs.copyFileSync(goodPath, relocatedGood);
    expect((await verifyReceiptFiles({
      decisionPath: pass.decisionPath,
      artifactPath: relocatedGood,
      flags: {},
    }, { root: fixtureRoot })).status).toBe('current');

    const fix = await emitDecision(badPath, {}, 'fix-relocation.json');
    const relocatedBad = path.join(tempDir, 'relocated-bad.layout.json');
    fs.copyFileSync(badPath, relocatedBad);
    const result = await verifyReceiptFiles({
      decisionPath: fix.decisionPath,
      artifactPath: relocatedBad,
      flags: {},
    }, { root: fixtureRoot });
    expect(result.status).toBe('stale');
    expect(result.issues).toEqual([{ code: 'ACTION_CHANGED' }]);
  });

  test('PPTX default and explicit slide one are equivalent while slide two changes policy and action', async () => {
    const deckPath = path.join(tempDir, 'fixable.pptx');
    fs.writeFileSync(deckPath, makeTwoSlideDeck({ fixable: true }));
    const emitted = await emitDecision(deckPath, {}, 'pptx.json');
    expect(emitted.decision.decision).toBe('fix_geometry');
    expect((await verifyReceiptFiles({
      decisionPath: emitted.decisionPath,
      artifactPath: deckPath,
      flags: {},
    }, { root: fixtureRoot })).status).toBe('current');
    expect((await verifyReceiptFiles({
      decisionPath: emitted.decisionPath,
      artifactPath: deckPath,
      flags: { slide: 1 },
    }, { root: fixtureRoot })).status).toBe('current');
    const changed = await verifyReceiptFiles({
      decisionPath: emitted.decisionPath,
      artifactPath: deckPath,
      flags: { slide: 2 },
    }, { root: fixtureRoot });
    expect(changed.status).toBe('stale');
    expect(changed.issues).toEqual([
      { code: 'ACTION_CHANGED' },
      { code: 'POLICY_CHANGED' },
    ]);
  });

  test('fix profile and cross-extension domain changes affect both action and policy', async () => {
    const emitted = await emitDecision(badPath, {}, 'fix-options.json');
    for (const flags of [{ profile: 'strict' }, { domain: 'svg' }]) {
      const result = await verifyReceiptFiles({
        decisionPath: emitted.decisionPath,
        artifactPath: badPath,
        flags,
      }, { root: fixtureRoot });
      expect(result.status).toBe('stale');
      expect(result.issues).toEqual([
        { code: 'ACTION_CHANGED' },
        { code: 'POLICY_CHANGED' },
      ]);
    }
  });

  test('runtime and validator identity participate in current policy freshness', async () => {
    const emitted = await emitDecision(goodPath, {}, 'identity.json');
    const runtime = {
      versions: { ...process.versions },
      platform: `${process.platform}-changed`,
      arch: process.arch,
      execPath: process.execPath,
    };
    expect((await verifyReceiptFiles({
      decisionPath: emitted.decisionPath,
      artifactPath: goodPath,
      flags: {},
    }, {
      root: fixtureRoot,
      runtime,
    })).issues).toEqual([{ code: 'POLICY_CHANGED' }]);
    expect((await verifyReceiptFiles({
      decisionPath: emitted.decisionPath,
      artifactPath: goodPath,
      flags: {},
    }, {
      root: fixtureRoot,
      loadAjv: async () => ({
        Ajv2020,
        version: '999.0.0-test',
      }),
    })).issues).toEqual([{ code: 'POLICY_CHANGED' }]);
  });

  test('an unreadable current artifact is a stable current-input error', async () => {
    const emitted = await emitDecision(goodPath, {}, 'unreadable-current.json');
    fs.unlinkSync(goodPath);
    try {
      await verifyReceiptFiles({
        decisionPath: emitted.decisionPath,
        artifactPath: goodPath,
        flags: {},
      }, { root: fixtureRoot });
      throw new Error('expected CURRENT_INPUT_INVALID');
    } catch (error) {
      expect(error.name).toBe('ReceiptInputError');
      expect(error.code).toBe('CURRENT_INPUT_INVALID');
    }
  });

  test('direct verifier input and dependency shapes fail closed with stable codes', async () => {
    const emitted = await emitDecision(goodPath, {}, 'exact-input.json');
    const base = {
      decisionPath: emitted.decisionPath,
      artifactPath: goodPath,
      flags: {},
    };
    const cases = [
      [{ ...base, extra: true }, {}, 'CURRENT_INPUT_INVALID'],
      [{ ...base, flags: false }, {}, 'POLICY_INPUT_INVALID'],
      [{ ...base, flags: { contract: '--other-flag' } }, {}, 'CONTRACT_INPUT_INVALID'],
      [{ ...base, flags: { structure: '--other-flag' } }, {}, 'POLICY_INPUT_INVALID'],
      [{ ...base, flags: { type: '--other-flag' } }, {}, 'POLICY_INPUT_INVALID'],
      [{ ...base, decisionPath: null }, {}, 'DECISION_INPUT_INVALID'],
      [{ ...base, artifactPath: null }, {}, 'CURRENT_INPUT_INVALID'],
      [base, { root: fixtureRoot, extra: true }, 'CURRENT_INPUT_INVALID'],
    ];
    for (const [input, deps, code] of cases) {
      try {
        await verifyReceiptFiles(input, deps);
        throw new Error(`expected ${code}`);
      } catch (error) {
        expect(error.code).toBe(code);
      }
    }
  });
});

describe('receipt verifier real process contract', () => {
  let tempDir;
  let fixtureRoot;
  let goodPath;
  let badPath;
  let receiptScript;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aesthete-receipt-cli-'));
    fixtureRoot = path.join(tempDir, 'skill');
    fs.mkdirSync(fixtureRoot);
    copyReceiptFixtureRoot(fixtureRoot);
    goodPath = path.join(fixtureRoot, 'examples', 'catalog-good.layout.json');
    badPath = path.join(fixtureRoot, 'examples', 'catalog-bad.layout.json');
    receiptScript = path.join(fixtureRoot, 'lib', 'skill-receipt.mjs');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function writeEmittedDecision(
    artifactPath,
    flags = {},
    name = 'decision.json',
  ) {
    const result = await runPost(artifactPath, {
      flags,
      deps: { root: fixtureRoot },
    });
    const decisionPath = path.join(tempDir, name);
    fs.writeFileSync(decisionPath, JSON.stringify(result.decision));
    return { decision: result.decision, decisionPath };
  }

  function runReceipt(args, executable = process.execPath) {
    return spawnSync(executable, [
      ...(executable === 'node' ? [] : ['--no-install']),
      receiptScript,
      ...args,
    ], {
      cwd: fixtureRoot,
      encoding: 'utf8',
    });
  }

  test('current, stale, unbound, incomplete, and invalid statuses have exact output and exits', async () => {
    fs.symlinkSync(
      path.join(repoRoot, 'node_modules'),
      path.join(fixtureRoot, 'node_modules'),
      'dir',
    );
    const emitted = await writeEmittedDecision(goodPath);
    const staleArtifact = path.join(tempDir, 'stale.layout.json');
    fs.copyFileSync(goodPath, staleArtifact);
    fs.appendFileSync(staleArtifact, '\n');

    const unbound = structuredClone(emitted.decision);
    delete unbound.claim_scope;
    delete unbound.binding;
    const unboundPath = path.join(tempDir, 'unbound.json');
    fs.writeFileSync(unboundPath, JSON.stringify(unbound));

    const incomplete = await runPost(path.join(tempDir, 'missing.alt.json'), {
      flags: {},
      deps: { root: fixtureRoot },
    });
    const incompletePath = path.join(tempDir, 'incomplete.json');
    fs.writeFileSync(incompletePath, JSON.stringify(incomplete.decision));

    const invalid = structuredClone(emitted.decision);
    invalid.reasons.push({
      code: 'EDITED_WITHOUT_REBIND',
      tier: 'P0',
      detail: 'edited',
      fixable: false,
    });
    const invalidPath = path.join(tempDir, 'invalid.json');
    fs.writeFileSync(invalidPath, JSON.stringify(invalid));

    const cases = [
      ['current', emitted.decisionPath, goodPath, 0],
      ['stale', emitted.decisionPath, staleArtifact, 1],
      ['unbound', unboundPath, goodPath, 2],
      ['incomplete', incompletePath, goodPath, 2],
      ['invalid', invalidPath, goodPath, 2],
    ];
    for (const [status, decisionPath, artifactPath, exitCode] of cases) {
      const outPath = path.join(tempDir, `${status}.verification.json`);
      const result = runReceipt([
        'verify',
        decisionPath,
        artifactPath,
        '--out',
        outPath,
      ]);
      expect(result.status).toBe(exitCode);
      expect(result.stdout).toBe(`receipt status=${status} issues=1\n`.replace(
        'current issues=1',
        'current issues=0',
      ));
      expect(result.stderr).toBe('');
      const output = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      expect(output.schema).toBe('aesthete.receipt-verification/v1');
      expect(output.status).toBe(status);
      expect(Array.isArray(output.issues)).toBe(true);
      expect(Array.isArray(output.checked)).toBe(true);
    }
  });

  test('emitted absolute action runs from a different cwd with bound inputs', async () => {
    fs.symlinkSync(
      path.join(repoRoot, 'node_modules'),
      path.join(fixtureRoot, 'node_modules'),
      'dir',
    );
    const before = fs.readFileSync(badPath);
    const emitted = await writeEmittedDecision(
      badPath,
      { profile: 'strict' },
      'action.json',
    );
    expect(emitted.decision.decision).toBe('fix_geometry');
    const parsed = parseFixAction(emitted.decision.next.fix_cmd);
    expect(parsed).toMatchObject({
      artifactPath: badPath,
      contractPath: path.join(
        fixtureRoot,
        'examples',
        'catalog.contract.json',
      ),
      adapter: 'alt',
      slide: null,
      profile: 'strict',
    });
    const actionCwd = path.join(tempDir, 'other-cwd');
    fs.mkdirSync(actionCwd);
    const result = spawnSync(
      emitted.decision.next.fix_cmd[0],
      emitted.decision.next.fix_cmd.slice(1),
      {
        cwd: actionCwd,
        encoding: 'utf8',
      },
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const log = JSON.parse(fs.readFileSync(
      path.join(actionCwd, 'catalog-bad.layout.fix-log.json'),
      'utf8',
    ));
    expect(log.input).toBe(badPath);
    expect(log.contract).toBe(parsed.contractPath);
    expect(Buffer.compare(before, fs.readFileSync(badPath))).toBe(0);
  });

  test('malformed stored action grammar is an invalid status before current I/O', async () => {
    const emitted = await writeEmittedDecision(
      badPath,
      {},
      'grammar-source.json',
    );
    emitted.decision.next.fix_cmd.push('--unknown', 'value');
    emitted.decision.binding.decision_core_sha256 = sha256Json(
      decisionCore(emitted.decision),
    );
    const decisionPath = path.join(tempDir, 'grammar-invalid.json');
    fs.writeFileSync(decisionPath, JSON.stringify(emitted.decision));
    const outPath = path.join(tempDir, 'grammar-invalid.verification.json');
    const result = runReceipt([
      'verify',
      decisionPath,
      path.join(tempDir, 'missing-current-artifact.alt.json'),
      '--out',
      outPath,
    ]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('receipt status=invalid issues=1\n');
    expect(result.stderr).toBe('');
    expect(JSON.parse(fs.readFileSync(outPath, 'utf8')).issues)
      .toEqual([{ code: 'ACTION_INTERNAL_MISMATCH' }]);
  });

  test.each([
    'DOMAIN_INVALID',
    'SLIDE_INVALID',
    'CONTRACT_INPUT_INVALID',
    'ACTION_CONTRACT_INVALID',
    'SCHEMA_INPUT_INVALID',
    'INSTALLATION_INPUT_INVALID',
    'AJV_REQUIRED',
    'BUN_REQUIRED',
  ])('%s is preserved at the verifier process boundary', async (code) => {
    const emitted = await writeEmittedDecision(
      code === 'ACTION_CONTRACT_INVALID' ? badPath : goodPath,
      {},
      `${code}.decision.json`,
    );
    let args = ['verify', emitted.decisionPath, (
      code === 'ACTION_CONTRACT_INVALID' ? badPath : goodPath
    )];
    let executable = process.execPath;
    if (code === 'DOMAIN_INVALID') {
      args.push('--domain', 'unsupported-domain');
    } else if (code === 'SLIDE_INVALID') {
      args.push('--slide', '0');
    } else if (code === 'CONTRACT_INPUT_INVALID') {
      const contractPath = path.join(tempDir, 'invalid.contract.json');
      fs.writeFileSync(contractPath, '{"brief":"a","brief":"b"}');
      args.push('--contract', contractPath);
    } else if (code === 'ACTION_CONTRACT_INVALID') {
      fs.unlinkSync(path.join(fixtureRoot, 'examples', 'catalog.contract.json'));
    } else if (code === 'SCHEMA_INPUT_INVALID') {
      fs.writeFileSync(path.join(fixtureRoot, 'schemas', 'alt.schema.json'), '{');
    } else if (code === 'INSTALLATION_INPUT_INVALID') {
      fs.unlinkSync(path.join(fixtureRoot, 'bun.lock'));
    } else if (code === 'BUN_REQUIRED') {
      executable = 'node';
    }
    if (code !== 'AJV_REQUIRED' && code !== 'BUN_REQUIRED') {
      fs.symlinkSync(
        path.join(repoRoot, 'node_modules'),
        path.join(fixtureRoot, 'node_modules'),
        'dir',
      );
    }
    const outPath = path.join(tempDir, `${code}.verification.json`);
    args.push('--out', outPath);
    const result = runReceipt(args, executable);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim().startsWith(`${code}:`)).toBe(true);
    expect(fs.existsSync(outPath)).toBe(false);
    expect(fs.existsSync(path.join(fixtureRoot, 'decision.json'))).toBe(false);
    expect(fs.existsSync(path.join(fixtureRoot, 'report.json'))).toBe(false);
  });

  test('usage and decision-input failures keep stdout empty and create no output', () => {
    const malformedPath = path.join(tempDir, 'malformed.json');
    fs.writeFileSync(malformedPath, '{"a":');
    const cases = [
      [
        ['verify', 'd.json', 'a.svg', '--out', path.join(tempDir, 'unknown.json'), '--typo'],
        'RECEIPT_USAGE_INVALID',
      ],
      [
        ['verify', 'd.json', 'a.svg', '--out', path.join(tempDir, 'duplicate.json'), '--lint', '--lint'],
        'RECEIPT_USAGE_INVALID',
      ],
      [
        ['verify', malformedPath, goodPath, '--out', path.join(tempDir, 'malformed.out.json')],
        'DECISION_INPUT_INVALID',
      ],
      [
        ['verify', path.join(tempDir, 'missing.json'), goodPath, '--out', path.join(tempDir, 'missing.out.json')],
        'DECISION_INPUT_INVALID',
      ],
    ];
    for (const [args, code] of cases) {
      const outPath = args[args.indexOf('--out') + 1];
      const result = runReceipt(args);
      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr.trim().startsWith(`${code}:`)).toBe(true);
      expect(fs.existsSync(outPath)).toBe(false);
    }
  });
});
