import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { foldDecision, stableDecision, decisionExitCode, isPhysicallyInfeasible, p0Fixable } from '../lib/skill-decision.mjs';
import { buildPreBundle, renderPromptBullets, runPre, resolveOutDir, negationBundle } from '../lib/skill-pre.mjs';
import { runPost } from '../lib/skill-post.mjs';
import { parsePostArgs } from '../lib/skill-post-args.mjs';
import { makeIntent } from './helpers/intent-fixture.mjs';
import { measureAlt } from '../lib/measure.mjs';
import { readJson } from '../lib/shared/cli.mjs';
import { skillRoot } from '../lib/shared/cli.mjs';
import { sha256Bytes, sha256Json } from '../lib/shared/canonical-json.mjs';
import { parseFixAction } from '../lib/skill-action.mjs';
import {
  buildClaimScope,
  decisionCore,
  validateReceiptShape,
} from '../lib/skill-receipt-core.mjs';
import { DEFAULT_PARAMS } from '../lib/skill-params.mjs';

const root = skillRoot();
const badPath = path.join(root, 'examples', 'catalog-bad.layout.json');
const goodPath = path.join(root, 'examples', 'catalog-good.layout.json');
const dashBriefPath = path.join(root, 'examples', 'dashboard-brief.json');

function copyReceiptFixtureRoot(target) {
  for (const directory of ['lib', 'schemas', 'examples']) {
    fs.cpSync(path.join(root, directory), path.join(target, directory), {
      recursive: true,
    });
  }
  for (const file of ['package.json', 'bun.lock', 'package-lock.json']) {
    fs.copyFileSync(path.join(root, file), path.join(target, file));
  }
}

function mutatingReader(onRead = () => {}) {
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

async function expectReceiptInputError(promise, code) {
  try {
    await promise;
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error.name).toBe('ReceiptInputError');
    expect(error.code).toBe(code);
  }
}

test('resolveOutDir: relative jail + absolute opt-in', () => {
  expect(() => resolveOutDir('../escape-aesthete', root)).toThrow(/escapes cwd/);
  const ok = resolveOutDir('tmp-out', root);
  expect(ok.startsWith(path.resolve(root))).toBe(true);
  const abs = resolveOutDir('/tmp/ae-allowed', root);
  expect(abs).toBe(path.resolve('/tmp/ae-allowed'));
});

test('pre: dashboard brief → prompt_bullets ≥ 3 + contract', async () => {
  const brief = readJson(dashBriefPath);
  const { bundle } = await runPre(brief, {
    outDir: path.join(root, '.aesthete-skill-test-pre'),
  });
  expect(bundle.schema).toBe('aesthete.pre/v1');
  expect(bundle.recognized).toBe(true);
  expect(bundle.structure.id).toBeTruthy();
  expect(bundle.prompt_bullets.length).toBeGreaterThanOrEqual(3);
  expect(bundle.contract?.criteria?.length).toBeGreaterThan(0);
  expect(bundle.optional?.keyhole?.max_visible_chunks).toBe(4);
});

test('pre: deterministic without diversify', async () => {
  const brief = readJson(dashBriefPath);
  const a = buildPreBundle((await runPre(brief)).spec);
  const b = buildPreBundle((await runPre(brief)).spec);
  // strip nothing — full bundle should match (no paths)
  expect(JSON.stringify(a.prompt_bullets)).toBe(JSON.stringify(b.prompt_bullets));
  expect(a.structure.id).toBe(b.structure.id);
  expect(JSON.stringify(a.contract)).toBe(JSON.stringify(b.contract));
});

test('pre: intent is validated, returned, and appended as one bullet block', async () => {
  const outDir = path.join(root, '.aesthete-skill-test-intent');
  const { bundle, intent, intentPath } = await runPre({
    artifact_type: 'dashboard',
    scope: { included: ['overview'], excluded: ['settings'] },
    content_priority: ['alerts', 'trend'],
    desired_action: 'triage an alert',
  }, { outDir });
  expect(intentPath).toBe(path.join(outDir, 'intent.json'));
  expect(bundle.intent_path).toBe(intentPath);
  expect(bundle.intent).toBeUndefined();
  expect(bundle.prompt_bullets.slice(-5)).toEqual([
    'Included scope: overview',
    'Excluded scope: settings',
    'Content priority 1: alerts',
    'Content priority 2: trend',
    'Desired audience action: triage an alert',
  ]);
  expect(intent.claim_scope.role)
    .toBe('declared_generation_context_not_evaluation');
  expect(fs.existsSync(intentPath)).toBe(false);
});

test('pre CLI emits intent.json and pre.json points to it', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aesthete-intent-pre-'));
  try {
    const briefPath = path.join(tempDir, 'brief.json');
    const outDir = path.join(tempDir, 'out');
    fs.writeFileSync(briefPath, JSON.stringify({
      artifact_type: 'dashboard',
      content_priority: ['alerts'],
    }));
    const result = spawnSync(process.execPath, [
      '--no-install',
      path.join(root, 'lib', 'skill-pre.mjs'),
      briefPath,
      '--out-dir',
      outDir,
    ], { cwd: root, encoding: 'utf8' });
    expect(result.status).toBe(0);
    const intentPath = path.join(outDir, 'intent.json');
    expect(JSON.parse(fs.readFileSync(intentPath, 'utf8')).schema)
      .toBe('aesthete.intent/v1');
    expect(JSON.parse(fs.readFileSync(
      path.join(outDir, 'pre.json'),
      'utf8',
    )).intent_path).toBe(intentPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('pre CLI creates no output for invalid declared intent', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aesthete-intent-pre-'));
  try {
    const briefPath = path.join(tempDir, 'brief.json');
    const outDir = path.join(tempDir, 'out');
    fs.writeFileSync(briefPath, JSON.stringify({
      artifact_type: 'dashboard',
      desired_action: '   ',
    }));
    const result = spawnSync(process.execPath, [
      '--no-install',
      path.join(root, 'lib', 'skill-pre.mjs'),
      briefPath,
      '--out-dir',
      outDir,
    ], { cwd: root, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(fs.existsSync(outDir)).toBe(false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('pre CLI creates no output for contradictory declared scope', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aesthete-intent-pre-'));
  try {
    const briefPath = path.join(tempDir, 'brief.json');
    const outDir = path.join(tempDir, 'out');
    fs.writeFileSync(briefPath, JSON.stringify({
      artifact_type: 'dashboard',
      scope: { included: ['settings'], excluded: ['settings'] },
    }));
    const result = spawnSync(process.execPath, [
      '--no-install',
      path.join(root, 'lib', 'skill-pre.mjs'),
      briefPath,
      '--out-dir',
      outDir,
    ], { cwd: root, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(fs.existsSync(outDir)).toBe(false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('documented intent pipeline is current end to end', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aesthete-intent-doc-'));
  try {
    const preDir = path.join(tempDir, 'pre');
    const postDir = path.join(tempDir, 'post');
    const pre = spawnSync(process.execPath, [
      '--no-install',
      path.join(root, 'lib', 'skill-pre.mjs'),
      path.join(root, 'examples', 'dashboard-intent-brief.json'),
      '--out-dir',
      preDir,
    ], { cwd: root, encoding: 'utf8' });
    expect(pre.status).toBe(0);
    const post = spawnSync(process.execPath, [
      '--no-install',
      path.join(root, 'lib', 'skill-post.mjs'),
      goodPath,
      '--contract',
      path.join(preDir, 'contract.json'),
      '--intent',
      path.join(preDir, 'intent.json'),
      '--out-dir',
      postDir,
    ], { cwd: root, encoding: 'utf8' });
    expect(post.status).toBe(0);
    const verify = spawnSync(process.execPath, [
      '--no-install',
      path.join(root, 'lib', 'skill-receipt.mjs'),
      'verify',
      path.join(postDir, 'decision.json'),
      goodPath,
      '--contract',
      path.join(preDir, 'contract.json'),
      '--intent',
      path.join(preDir, 'intent.json'),
    ], { cwd: root, encoding: 'utf8' });
    expect(verify.status).toBe(0);
    expect(verify.stdout).toContain('status=current');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('post args: intent is a strict value flag shared with gate', () => {
  expect(parsePostArgs([
    'artifact.svg',
    '--intent',
    'intent.json',
    '--lint',
    '--out-dir',
    'out',
  ])).toEqual({
    inputPath: 'artifact.svg',
    flags: { intent: 'intent.json', lint: true },
    outDirFlag: 'out',
  });
});

test.each([
  [['artifact.svg', '--intent'], /requires one non-empty value/],
  [['artifact.svg', '--intent', 'a.json', '--intent', 'b.json'], /duplicate flag/],
  [['artifact.svg', '--intent=a.json'], /unsupported flag spelling/],
  [['artifact.svg', '--unknown'], /unknown flag/],
  [['artifact.svg', 'extra.svg'], /exactly one artifact/],
])('post args reject hostile grammar', (argv, message) => {
  expect(() => parsePostArgs(argv)).toThrow(message);
});

test('post: intent changes binding only, never the decision core or policy', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aesthete-intent-post-'));
  try {
    const firstPath = path.join(tempDir, 'first.intent.json');
    const secondPath = path.join(tempDir, 'second.intent.json');
    fs.writeFileSync(firstPath, JSON.stringify(makeIntent('first')));
    fs.writeFileSync(secondPath, JSON.stringify(makeIntent('second')));
    const first = (await runPost(goodPath, {
      flags: { intent: firstPath },
    })).decision;
    const second = (await runPost(goodPath, {
      flags: { intent: secondPath },
    })).decision;
    expect({
      core: decisionCore(first),
      claim_scope: first.claim_scope,
      policy: first.binding.policy,
      action: first.binding.action_inputs,
    }).toEqual({
      core: decisionCore(second),
      claim_scope: second.claim_scope,
      policy: second.binding.policy,
      action: second.binding.action_inputs,
    });
    expect(first.binding.intent.sha256).not.toBe(second.binding.intent.sha256);
    expect(first.binding.schema).toBe('aesthete.binding/v2');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test.each(['skill-post.mjs', 'skill-gate.mjs'])(
  '%s rejects invalid intent before creating output',
  (script) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aesthete-intent-post-'));
    try {
      const intentPath = path.join(tempDir, 'intent.json');
      const outDir = path.join(tempDir, 'out');
      fs.writeFileSync(intentPath, '{"schema":"a","schema":"b"}');
      const result = spawnSync(process.execPath, [
        '--no-install',
        path.join(root, 'lib', script),
        goodPath,
        '--intent',
        intentPath,
        '--out-dir',
        outDir,
      ], { cwd: root, encoding: 'utf8' });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('INTENT_INPUT_INVALID');
      expect(fs.existsSync(outDir)).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  },
);

test('post: catalog-bad → fix_geometry (P0)', async () => {
  const altBytesBefore = fs.readFileSync(badPath);
  const { decision } = await runPost(badPath, { flags: {}, outDir: undefined });
  expect(decision.decision).toBe('fix_geometry');
  expect(decision.reasons.some((r) => r.code === 'P0_COLLISION' || r.code === 'P0_BOUNDARY')).toBe(true);
  expect(decision.next.action).toBe('run_fix_p0');
  const altBytesAfter = fs.readFileSync(badPath);
  expect(Buffer.compare(altBytesBefore, altBytesAfter)).toBe(0);
});

test('post: catalog-good → pass', async () => {
  const { decision } = await runPost(goodPath, { flags: {} });
  expect(decision.decision).toBe('pass');
  expect(decision.next.action).toBe('stop');
  expect(decision.scores.hardIntegrityScore).toBe(1);
});

test('post: decision deterministic (stable strip)', async () => {
  const a = stableDecision((await runPost(badPath, { flags: {} })).decision);
  const b = stableDecision((await runPost(badPath, { flags: {} })).decision);
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});

describe('snapshot-bound post emission', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aesthete-receipt-post-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('good artifact emits a complete receipt and narrow pass claim', async () => {
    const { decision } = await runPost(goodPath, { flags: {} });
    expect(decision.decision).toBe('pass');
    expect(decision.claim_scope.pass_means)
      .toBe('no_enabled_blocking_rule_triggered');
    expect(decision.binding.schema).toBe('aesthete.binding/v2');
    expect(decision.binding.intent).toEqual({
      status: 'not_requested',
      sha256: null,
    });
    expect(decision.binding.completeness).toBe('complete');
    expect(decision.binding.artifact.sha256)
      .toBe(sha256Bytes(fs.readFileSync(goodPath)));
    expect(decision.binding.decision_core_sha256)
      .toBe(sha256Json(decisionCore(decision)));
  });

  test('bad geometry keeps fix_geometry and emits a bound absolute action', async () => {
    const { decision } = await runPost(badPath, { flags: {} });
    expect(decision.decision).toBe('fix_geometry');
    expect(decision.binding.action_inputs.status).toBe('bound');
    expect(parseFixAction(decision.next.fix_cmd)).toEqual({
      executable: path.resolve(process.execPath),
      scriptPath: path.join(root, 'lib', 'fix.mjs'),
      artifactPath: path.resolve(badPath),
      contractPath: path.join(root, 'examples', 'catalog.contract.json'),
      adapter: 'alt',
      slide: null,
      profile: null,
    });
  });

  test('structure unknown and P0-only contract failure retain pass semantics', async () => {
    const unknown = await runPost(goodPath, {
      flags: { structure: 'does-not-exist' },
    });
    expect(unknown.decision.decision).toBe('pass');
    expect(unknown.decision.claim_scope.rules.structure_signature.coverage_behavior)
      .toBe('unknown_is_nonblocking');

    const contractPath = path.join(tempDir, 'p0-only.contract.json');
    fs.writeFileSync(contractPath, JSON.stringify({
      schema_version: 1,
      brief: 'P0-only fold fixture',
      criteria: [{
        skill: 'collision',
        metric: 'count',
        op: '==',
        threshold: 1,
        weight: 1,
      }],
    }));
    const p0Only = await runPost(goodPath, {
      flags: { contract: contractPath },
    });
    expect(p0Only.decision.decision).toBe('pass');
    expect(p0Only.decision.claim_scope.rules.contract_criteria.coverage_behavior)
      .toBe('p0_only_contract_failure_is_nonblocking_in_contract_branch');
  });

  test('unreadable versus readable-invalid artifact receipts differ in completeness', async () => {
    const unreadable = await runPost(
      path.join(tempDir, 'missing.layout.json'),
      { flags: {} },
    );
    expect(unreadable.decision.decision).toBe('regenerate');
    expect(unreadable.decision.binding).toMatchObject({
      completeness: 'incomplete',
      artifact: { status: 'unreadable', sha256: null },
    });

    const invalidPath = path.join(tempDir, 'readable-invalid.layout.json');
    fs.writeFileSync(invalidPath, '{"schema_version":1,"nodes":[]}');
    const invalid = await runPost(invalidPath, { flags: {} });
    expect(invalid.decision.decision).toBe('regenerate');
    expect(invalid.decision.binding).toMatchObject({
      completeness: 'complete',
      artifact: {
        status: 'bound',
        sha256: sha256Bytes(fs.readFileSync(invalidPath)),
      },
    });

    const duplicatePath = path.join(tempDir, 'duplicate-key.layout.json');
    fs.writeFileSync(
      duplicatePath,
      '{"schema_version":1,"diagram_type":"layout","meta":{"title":"first","canvas":{"w":100,"h":100}},"meta":{"title":"second","canvas":{"w":100,"h":100}},"nodes":[]}',
    );
    const duplicate = await runPost(duplicatePath, { flags: {} });
    expect(duplicate.decision.decision).toBe('regenerate');
    expect(duplicate.decision.binding).toMatchObject({
      completeness: 'complete',
      artifact: {
        status: 'bound',
        sha256: sha256Bytes(fs.readFileSync(duplicatePath)),
      },
    });
  });
});

describe('single-snapshot resource consumption', () => {
  let tempDir;
  let fixtureRoot;
  let fixtureGood;
  let fixtureBad;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aesthete-receipt-post-'));
    fixtureRoot = path.join(tempDir, 'skill');
    fs.mkdirSync(fixtureRoot);
    copyReceiptFixtureRoot(fixtureRoot);
    fixtureGood = path.join(fixtureRoot, 'examples', 'catalog-good.layout.json');
    fixtureBad = path.join(fixtureRoot, 'examples', 'catalog-bad.layout.json');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('measurement, lint, and policy digest the same first params and tokens', async () => {
    const paramsPath = path.join(fixtureRoot, 'skill-params.json');
    const tokensPath = path.join(fixtureRoot, 'tokens.json');
    const firstParams = {
      proximity: { ...DEFAULT_PARAMS.proximity, ALPHA: 0 },
    };
    const firstTokens = {
      colors: ['#111827', '#ffffff'],
      fontScale: [24],
      radii: [0],
    };
    fs.writeFileSync(paramsPath, JSON.stringify({ proximity: { ALPHA: 0 } }));
    fs.writeFileSync(tokensPath, JSON.stringify(firstTokens));
    const reader = mutatingReader((filePath, count) => {
      if (filePath === paramsPath && count === 1) {
        fs.writeFileSync(paramsPath, JSON.stringify({ proximity: { ALPHA: 100 } }));
      }
      if (filePath === tokensPath && count === 1) {
        fs.writeFileSync(tokensPath, JSON.stringify({
          colors: ['#000000'],
          fontScale: [12],
          radii: [16],
        }));
      }
    });

    const result = await runPost(fixtureGood, {
      flags: { lint: true },
      deps: { root: fixtureRoot, io: reader },
    });

    expect(result.report.skills.proximity.metrics.meanGroupP).toBe(1);
    expect(result.lintResult.passed).toBe(true);
    expect(result.decision.binding.policy.resources.params_sha256)
      .toBe(sha256Json(firstParams));
    expect(result.decision.binding.policy.resources.tokens_sha256)
      .toBe(sha256Json(firstTokens));
    expect(reader.count(paramsPath)).toBe(1);
    expect(reader.count(tokensPath)).toBe(1);
  });

  test('lint-disabled policy neither reads nor hashes tokens', async () => {
    const tokensPath = path.join(fixtureRoot, 'tokens.json');
    fs.writeFileSync(tokensPath, JSON.stringify({
      colors: ['#000000'],
      fontScale: [12],
      radii: [16],
    }));
    const reader = mutatingReader();
    const result = await runPost(fixtureGood, {
      flags: {},
      deps: { root: fixtureRoot, io: reader },
    });
    expect(reader.count(tokensPath)).toBe(0);
    expect(result.decision.binding.policy.resources.tokens_sha256).toBeNull();
  });

  test('unreadable artifact still binds selected params and lint-enabled tokens', async () => {
    const paramsPath = path.join(fixtureRoot, 'skill-params.json');
    const tokensPath = path.join(fixtureRoot, 'tokens.json');
    fs.writeFileSync(paramsPath, JSON.stringify({ proximity: { ALPHA: 0.25 } }));
    fs.writeFileSync(tokensPath, JSON.stringify({
      colors: ['#000000'],
      fontScale: [12],
      radii: [0],
    }));
    const reader = mutatingReader();
    const result = await runPost(path.join(tempDir, 'missing.alt.json'), {
      flags: { lint: true },
      deps: { root: fixtureRoot, io: reader },
    });
    expect(result.decision.binding.completeness).toBe('incomplete');
    expect(result.decision.binding.policy.resources.params_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.decision.binding.policy.resources.tokens_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(reader.count(paramsPath)).toBe(1);
    expect(reader.count(tokensPath)).toBe(1);
  });

  test('requested contract is one snapshot shared by evaluation and fix action', async () => {
    const contractPath = path.join(fixtureRoot, 'examples', 'catalog.contract.json');
    const firstBytes = fs.readFileSync(contractPath);
    const reader = mutatingReader((filePath, count) => {
      if (filePath === contractPath && count === 1) {
        fs.writeFileSync(contractPath, '{"changed":true}');
      }
    });
    const result = await runPost(fixtureBad, {
      flags: { contract: contractPath },
      deps: { root: fixtureRoot, io: reader },
    });
    expect(result.decision.decision).toBe('fix_geometry');
    expect(reader.count(contractPath)).toBe(1);
    expect(result.decision.binding.contract.sha256).toBe(sha256Bytes(firstBytes));
    expect(result.decision.binding.action_inputs.contract_sha256)
      .toBe(sha256Bytes(firstBytes));
    expect(parseFixAction(result.decision.next.fix_cmd).contractPath)
      .toBe(contractPath);
  });

  test('default fix contract and action artifact are each read exactly once', async () => {
    const contractPath = path.join(fixtureRoot, 'examples', 'catalog.contract.json');
    const contractBytes = fs.readFileSync(contractPath);
    const artifactBytes = fs.readFileSync(fixtureBad);
    const reader = mutatingReader((filePath, count) => {
      if (filePath === contractPath && count === 1) {
        fs.writeFileSync(contractPath, '{"changed":true}');
      }
      if (filePath === fixtureBad && count === 1) {
        fs.writeFileSync(fixtureBad, '{"changed":true}');
      }
    });
    const result = await runPost(fixtureBad, {
      flags: {},
      deps: { root: fixtureRoot, io: reader },
    });
    expect(result.decision.decision).toBe('fix_geometry');
    expect(reader.count(contractPath)).toBe(1);
    expect(reader.count(fixtureBad)).toBe(1);
    expect(result.decision.binding.artifact.sha256).toBe(sha256Bytes(artifactBytes));
    expect(result.decision.binding.action_inputs.contract_sha256)
      .toBe(sha256Bytes(contractBytes));
  });

  test('schema validation and policy manifest consume the same first schema bytes', async () => {
    const schemaPath = path.join(fixtureRoot, 'schemas', 'alt.schema.json');
    const firstBytes = fs.readFileSync(schemaPath);
    const reader = mutatingReader((filePath, count) => {
      if (filePath === schemaPath && count === 1) {
        fs.writeFileSync(schemaPath, '{');
      }
    });
    const result = await runPost(fixtureGood, {
      flags: {},
      deps: { root: fixtureRoot, io: reader },
    });
    expect(result.decision.decision).toBe('pass');
    expect(reader.count(schemaPath)).toBe(1);
    expect(result.decision.binding.policy.resources.schemas.files.find(
      (entry) => entry.relative_path === 'schemas/alt.schema.json',
    ).sha256).toBe(sha256Bytes(firstBytes));
  });

  test('intent validation and binding digest consume the same first bytes', async () => {
    const intentPath = path.join(tempDir, 'intent.json');
    const firstBytes = Buffer.from(JSON.stringify(makeIntent('first')));
    fs.writeFileSync(intentPath, firstBytes);
    const reader = mutatingReader((filePath, count) => {
      if (filePath === intentPath && count === 1) {
        fs.writeFileSync(intentPath, '{"schema":"broken"}');
      }
    });
    const result = await runPost(fixtureGood, {
      flags: { intent: intentPath },
      deps: { root: fixtureRoot, io: reader },
    });
    expect(reader.count(intentPath)).toBe(1);
    expect(result.intentSnapshot.value.goal).toBe('first');
    expect(result.decision.binding.intent.sha256)
      .toBe(sha256Bytes(firstBytes));
  });

  test('relative artifact locator is frozen before injected I/O can change cwd', async () => {
    const originalCwd = process.cwd();
    const relativeArtifact = path.relative(originalCwd, fixtureGood);
    const changedCwd = path.join(
      tempDir,
      'deep',
      'one',
      'two',
      'three',
      'four',
      'five',
      'six',
    );
    fs.mkdirSync(changedCwd, { recursive: true });
    let changed = false;
    const reader = mutatingReader((filePath) => {
      if (!changed && filePath.includes(`${path.sep}schemas${path.sep}`)) {
        changed = true;
        process.chdir(changedCwd);
      }
    });
    let result;
    try {
      result = await runPost(relativeArtifact, {
        flags: {},
        deps: { root: fixtureRoot, io: reader },
      });
    } finally {
      process.chdir(originalCwd);
    }
    expect(changed).toBe(true);
    expect(result.decision.decision).toBe('pass');
    expect(result.decision.binding.artifact.sha256)
      .toBe(sha256Bytes(fs.readFileSync(fixtureGood)));
  });

  test('invalid explicit domains win before malformed dependency capture', async () => {
    fs.writeFileSync(path.join(fixtureRoot, 'schemas', 'alt.schema.json'), '{');
    for (const domain of ['', 'unsupported-domain']) {
      await expectReceiptInputError(runPost(fixtureGood, {
        flags: { domain },
        deps: { root: fixtureRoot },
      }), 'DOMAIN_INVALID');
    }
  });

  test('falsey post option containers are rejected instead of defaulted', async () => {
    await expectReceiptInputError(runPost(fixtureGood, {
      flags: false,
      deps: { root: fixtureRoot },
    }), 'POLICY_INPUT_INVALID');
    await expectReceiptInputError(runPost(fixtureGood, {
      flags: {},
      deps: false,
    }), 'INSTALLATION_INPUT_INVALID');
    await expectReceiptInputError(runPost(fixtureGood, {
      flags: {},
      deps: { root: fixtureRoot, extra: true },
    }), 'INSTALLATION_INPUT_INVALID');
    await expectReceiptInputError(runPost(fixtureGood, {
      flags: {},
      deps: { root: fixtureRoot, io: false },
    }), 'INSTALLATION_INPUT_INVALID');
  });

  test('pass does not read a missing default action contract', async () => {
    const contractPath = path.join(fixtureRoot, 'examples', 'catalog.contract.json');
    fs.unlinkSync(contractPath);
    const reader = mutatingReader();
    const result = await runPost(fixtureGood, {
      flags: {},
      deps: { root: fixtureRoot, io: reader },
    });
    expect(result.decision.decision).toBe('pass');
    expect(reader.count(contractPath)).toBe(0);
  });

  test('default action contract failure has its own stable boundary code', async () => {
    fs.unlinkSync(path.join(fixtureRoot, 'examples', 'catalog.contract.json'));
    await expectReceiptInputError(runPost(fixtureBad, {
      flags: {},
      deps: { root: fixtureRoot },
    }), 'ACTION_CONTRACT_INVALID');
  });

  test('requested and default contract schema failures keep distinct codes', async () => {
    const requestedPath = path.join(tempDir, 'invalid-requested.contract.json');
    fs.writeFileSync(requestedPath, JSON.stringify({
      schema_version: 1,
      brief: '',
      criteria: [],
    }));
    await expectReceiptInputError(runPost(fixtureGood, {
      flags: { contract: requestedPath },
      deps: { root: fixtureRoot },
    }), 'CONTRACT_INPUT_INVALID');

    fs.writeFileSync(
      path.join(fixtureRoot, 'examples', 'catalog.contract.json'),
      fs.readFileSync(requestedPath),
    );
    await expectReceiptInputError(runPost(fixtureBad, {
      flags: {},
      deps: { root: fixtureRoot },
    }), 'ACTION_CONTRACT_INVALID');
  });

  test('slide and profile flags are normalized at the receipt boundary', async () => {
    const deckPath = path.join(tempDir, 'invalid-but-readable.pptx');
    fs.writeFileSync(deckPath, 'not-a-zip');
    const result = await runPost(deckPath, {
      flags: { slide: '2' },
      deps: { root: fixtureRoot },
    });
    expect(result.decision.binding.policy.adapter).toEqual({
      id: 'pptx',
      effective_slide: 2,
    });
    await expectReceiptInputError(runPost(deckPath, {
      flags: { slide: '02' },
      deps: { root: fixtureRoot },
    }), 'SLIDE_INVALID');
    await expectReceiptInputError(runPost(fixtureGood, {
      flags: { profile: '--strict' },
      deps: { root: fixtureRoot },
    }), 'POLICY_INPUT_INVALID');
  });
});

describe('receipt-backed post and gate process failures', () => {
  let tempDir;
  let fixtureRoot;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aesthete-receipt-post-'));
    fixtureRoot = path.join(tempDir, 'skill');
    fs.mkdirSync(fixtureRoot);
    copyReceiptFixtureRoot(fixtureRoot);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const cases = [
    'DOMAIN_INVALID',
    'SLIDE_INVALID',
    'CONTRACT_INPUT_INVALID',
    'ACTION_CONTRACT_INVALID',
    'SCHEMA_INPUT_INVALID',
    'INSTALLATION_INPUT_INVALID',
    'AJV_REQUIRED',
    'BUN_REQUIRED',
  ];

  test.each(cases)('%s exits 2 without stdout or result files', (code) => {
    const good = path.join(fixtureRoot, 'examples', 'catalog-good.layout.json');
    const bad = path.join(fixtureRoot, 'examples', 'catalog-bad.layout.json');
    let artifact = good;
    let args = [];
    let executable = process.execPath;

    if (code !== 'AJV_REQUIRED' && code !== 'BUN_REQUIRED') {
      fs.symlinkSync(
        path.join(root, 'node_modules'),
        path.join(fixtureRoot, 'node_modules'),
        'dir',
      );
    }

    if (code === 'DOMAIN_INVALID') {
      args = ['--domain', 'unsupported-domain'];
    } else if (code === 'SLIDE_INVALID') {
      artifact = path.join(tempDir, 'deck.pptx');
      fs.writeFileSync(artifact, 'not-a-zip');
      args = ['--slide', '0'];
    } else if (code === 'CONTRACT_INPUT_INVALID') {
      const contractPath = path.join(tempDir, 'duplicate.contract.json');
      fs.writeFileSync(
        contractPath,
        '{"schema_version":1,"brief":"a","brief":"b","criteria":[{"skill":"collision","metric":"count","op":"==","threshold":0,"weight":1}]}',
      );
      args = ['--contract', contractPath];
    } else if (code === 'ACTION_CONTRACT_INVALID') {
      artifact = bad;
      fs.unlinkSync(path.join(fixtureRoot, 'examples', 'catalog.contract.json'));
    } else if (code === 'SCHEMA_INPUT_INVALID') {
      fs.writeFileSync(path.join(fixtureRoot, 'schemas', 'alt.schema.json'), '{');
    } else if (code === 'INSTALLATION_INPUT_INVALID') {
      fs.unlinkSync(path.join(fixtureRoot, 'bun.lock'));
    } else if (code === 'BUN_REQUIRED') {
      executable = 'node';
    }

    for (const entry of ['skill-post.mjs', 'skill-gate.mjs']) {
      const outDir = path.join(tempDir, `${code}-${entry}`);
      const result = spawnSync(executable, [
        ...(executable === 'node' ? [] : ['--no-install']),
        path.join(fixtureRoot, 'lib', entry),
        artifact,
        ...args,
        '--out-dir',
        outDir,
      ], {
        cwd: fixtureRoot,
        encoding: 'utf8',
      });

      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr.trim().startsWith(`${code}:`)).toBe(true);
      if (fs.existsSync(outDir)) {
        expect(fs.readdirSync(outDir)).toEqual([]);
      }
      for (const name of [
        'decision.json',
        'report.json',
        'slop.json',
        'contract-eval.json',
        'structure.json',
        'vuln.json',
      ]) {
        expect(fs.existsSync(path.join(outDir, name))).toBe(false);
      }
    }
  });

  test('successful post and gate persist validated receipts and slop output', () => {
    fs.symlinkSync(
      path.join(root, 'node_modules'),
      path.join(fixtureRoot, 'node_modules'),
      'dir',
    );
    const artifact = path.join(
      fixtureRoot,
      'examples',
      'catalog-good.layout.json',
    );
    for (const entry of ['skill-post.mjs', 'skill-gate.mjs']) {
      const outDir = path.join(tempDir, `success-${entry}`);
      const result = spawnSync(process.execPath, [
        '--no-install',
        path.join(fixtureRoot, 'lib', entry),
        artifact,
        '--slop',
        '--out-dir',
        outDir,
      ], {
        cwd: fixtureRoot,
        encoding: 'utf8',
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('decision=pass');
      const decision = JSON.parse(
        fs.readFileSync(path.join(outDir, 'decision.json'), 'utf8'),
      );
      expect(validateReceiptShape(decision)).toEqual({
        status: 'bound',
        issues: [],
      });
      expect(fs.existsSync(path.join(outDir, 'report.json'))).toBe(true);
      expect(fs.existsSync(path.join(outDir, 'slop.json'))).toBe(true);
    }
  });
});

test('gate exit codes', () => {
  expect(decisionExitCode('pass')).toBe(0);
  expect(decisionExitCode('fix_geometry')).toBe(1);
  expect(decisionExitCode('regenerate')).toBe(1);
  expect(decisionExitCode('human')).toBe(2);
  expect(decisionExitCode('pass', true)).toBe(2);
});

test('fold: structure fail → regenerate beats pass', () => {
  const good = measureAlt(readJson(goodPath));
  const d = foldDecision({
    report: good,
    alt: readJson(goodPath),
    structureRequested: true,
    structureResult: { verdict: 'fail', expected: 'evidence-grid' },
  });
  expect(d.decision).toBe('regenerate');
  expect(d.reasons.some((r) => r.code === 'STRUCTURE_FAIL')).toBe(true);
});

test('fold: vuln advisory does not force regenerate without --vuln-gate', () => {
  const good = measureAlt(readJson(goodPath));
  const d = foldDecision({
    report: good,
    alt: readJson(goodPath),
    vulnGate: false,
    vulnReport: {
      vulnerabilities: [{ id: 'no-focal', title: 'x', severity: 'high' }],
    },
  });
  expect(d.decision).toBe('pass');
  expect(d.reasons.some((r) => String(r.code).startsWith('VULN_ADVISORY_'))).toBe(true);
});

test('fold: vuln-gate high → regenerate', () => {
  const good = measureAlt(readJson(goodPath));
  const d = foldDecision({
    report: good,
    alt: readJson(goodPath),
    vulnGate: true,
    vulnReport: {
      vulnerabilities: [{ id: 'no-focal', title: 'x', severity: 'high' }],
    },
  });
  expect(d.decision).toBe('regenerate');
});

// ---- contract coverage-insufficiency escalation (no false-fail regenerate loop) ----
// A contract fail is only regeneration-worthy if the axis was actually measured (finite metric).
// fails that are pure unmeasurable/partial-null must escalate to human, never regenerate —
// determinism guarantees re-generation re-measures to the same gap, so regenerate cannot help.
const crit = (skill, metric, overrides = {}) => ({
  skill, metric, op: '>=', threshold: 0.7,
  measured: null, passed: false, status: 'unmeasured',
  criterion: `${skill}.${metric}>=0.7`, weight: 1,
  ...overrides,
});

test('fold: contract fails only on unmeasurable axes → human (not regenerate), even when coverage≠0', () => {
  const good = measureAlt(readJson(goodPath));   // coverageScore > 0
  expect(good.summary.coverageScore).not.toBe(0);
  const d = foldDecision({
    report: good,
    alt: readJson(goodPath),
    contractRequested: true,
    contractEval: {
      allPass: false,
      criteria: [
        crit('fluency', 'rhythm'),                                   // unmeasurable
        crit('hierarchy', 'contrast', { status: 'fail' }),           // partial + null metric
        crit('proximity', 'grouping'),                               // unmeasurable
      ],
    },
  });
  expect(d.decision).toBe('human');
  expect(d.reasons.some((r) => r.code === 'CONTRACT_UNMEASURABLE')).toBe(true);
  expect(d.reasons.some((r) => r.code === 'CONTRACT_FAIL')).toBe(false);
});

test('fold: contract real metric fail (finite measured) → regenerate', () => {
  const good = measureAlt(readJson(goodPath));
  const d = foldDecision({
    report: good,
    alt: readJson(goodPath),
    contractRequested: true,
    contractEval: {
      allPass: false,
      criteria: [
        crit('balance', 'b', { measured: 0.4, status: 'fail' }),   // finite, compared, failed
      ],
    },
  });
  expect(d.decision).toBe('regenerate');
  expect(d.reasons.some((r) => r.code === 'CONTRACT_FAIL')).toBe(true);
  expect(d.reasons.some((r) => r.code === 'CONTRACT_UNMEASURABLE')).toBe(false);
});

test('fold: contract mixed real + unmeasurable → regenerate wins, both reasons attached', () => {
  const good = measureAlt(readJson(goodPath));
  const d = foldDecision({
    report: good,
    alt: readJson(goodPath),
    contractRequested: true,
    contractEval: {
      allPass: false,
      criteria: [
        crit('balance', 'b', { measured: 0.4, status: 'fail' }),
        crit('fluency', 'rhythm'),                                  // unmeasurable, real fail coexists
      ],
    },
  });
  expect(d.decision).toBe('regenerate');
  expect(d.reasons.some((r) => r.code === 'CONTRACT_FAIL')).toBe(true);
  expect(d.reasons.some((r) => r.code === 'CONTRACT_UNMEASURABLE')).toBe(true);
});

test('physically infeasible area sum', () => {
  const alt = {
    meta: { canvas: { w: 100, h: 100 } },
    nodes: [
      { id: 'a', bbox: { x: 0, y: 0, w: 80, h: 80 } },
      { id: 'b', bbox: { x: 0, y: 0, w: 80, h: 80 } },
    ],
  };
  expect(isPhysicallyInfeasible(alt)).toBe(true);
  expect(isPhysicallyInfeasible({ meta: { canvas: { w: 1000, h: 1000 } }, nodes: alt.nodes })).toBe(false);
});

test('negationBundle + renderPromptBullets non-empty', () => {
  const bullets = renderPromptBullets({
    directive: 'test directive',
    structure: { id: 'hero-led', shape: 'one hero' },
    budget: { freeRatio: { min: 0.3, target: 0.4 }, focal: 1 },
    negation: { color: ['rainbow palette'] },
  });
  expect(bullets[0]).toBe('test directive');
  expect(bullets.some((b) => b.includes('Structure:'))).toBe(true);
  expect(bullets.some((b) => b.includes('freeRatio'))).toBe(true);
  expect(negationBundle({ color: ['rainbow'] }).bullets.length).toBe(1);
});

// ---- slop-pre (Task 11) ----
const slopTmpDir = () => { const d = path.join(import.meta.dir, '.tmp-slop-pre'); fs.mkdirSync(d, { recursive: true }); return d; };

test('skill-pre: html brief → prompt_bullets include slop constraints + slopTestMd contract in-memory (write-free runPre)', async () => {
  const outDir = path.join(slopTmpDir(), 'out');
  // Clean slate: the tmp dir is reused across runs, so a stale slop-test.md from a
  // prior (pre-fix) runPre would mask the write-free assertion below.
  fs.rmSync(outDir, { recursive: true, force: true });
  const brief = { artifact_type: 'marketing', format: 'html', brief: 'hero landing' };
  // runPre is write-free (Task 9 pattern): it returns the rendered slop-test markdown
  // for main() to emit — assert the IN-MEMORY contract, not a file on disk.
  const { bundle, slopTestMd } = await runPre(brief, { outDir });
  expect(bundle.prompt_bullets.some((b) => /gradient|emoji|glass/i.test(b))).toBe(true);
  expect(typeof slopTestMd).toBe('string');
  expect(slopTestMd.includes('NON-ENFORCED')).toBe(true);
  expect(slopTestMd.includes('slop-test')).toBe(true);
  // runPre must NOT have written the file — on-disk emit is a main()/CLI concern.
  expect(fs.existsSync(path.join(outDir, 'slop-test.md'))).toBe(false);
});

test('skill-pre: per-key negation merge — preflight copy + slop copy both survive (regression, Task 11 review Finding 1)', async () => {
  // A shallow `{...preflight, ...slop}` merge would let slop's terse `copy` entry
  // overwrite preflight's richer copy guidance ("use real numbers or a labelled
  // placeholder, never invent") in spec.negation.copy, dropping it from prompt_bullets.
  // Per-key concat (mergeNeg) unions both — assert the union survives.
  const { bundle } = await runPre({
    artifact_type: 'report',
    format: 'html',
  }, {});
  // preflight's richer copy guidance survives the merge
  expect(bundle.prompt_bullets.some((b) => /real numbers|placeholder|never invent/i.test(b))).toBe(true);
  // slop's terse copy entry is ALSO present (union, not replace). slop uses
  // "testimonials/counts" with no spaces; preflight uses "testimonials / counts".
  expect(bundle.prompt_bullets.some((b) => /testimonials\/counts/.test(b))).toBe(true);
  // And the underlying raw copy array carries both entries (length 2, not 1)
  expect(Array.isArray(bundle.negation.raw.copy)).toBe(true);
  expect(bundle.negation.raw.copy.length).toBe(2);
});

test('skill-pre: same brief twice (no diversify) → byte-identical slop bullets (deterministic)', async () => {
  const a = (await runPre({
    artifact_type: 'report',
    format: 'html',
  }, {})).bundle.prompt_bullets;
  const b = (await runPre({
    artifact_type: 'report',
    format: 'html',
  }, {})).bundle.prompt_bullets;
  expect(a).toEqual(b);
});

test('skill-pre: non-html brief → slop universal bullets only (no html-only extras)', async () => {
  const { bundle } = await runPre({
    artifact_type: 'report',
    format: 'svg',
  }, {});
  expect(bundle.prompt_bullets.some((b) => /icon/i.test(b))).toBe(false);
  expect(bundle.prompt_bullets.some((b) => /gradient|emoji/i.test(b))).toBe(true); // universal present
});
