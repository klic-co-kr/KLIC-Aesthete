import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sha256Bytes, sha256Json } from '../lib/shared/canonical-json.mjs';
import { createRunValidator } from '../lib/shared/validator.mjs';
import { DEFAULT_PARAMS } from '../lib/skill-params.mjs';
import {
  captureSchemaBundle,
  captureInstallationManifest,
  captureRuntime,
  compareCurrentManifest,
  normalizePostPolicy,
  resolveEffectiveParams,
  resolveEffectiveTokens,
  snapshotArtifact,
  snapshotContract,
} from '../lib/skill-snapshot.mjs';
import { DEFAULT_TOKENS } from '../lib/tokens.mjs';

const repoRoot = path.resolve(import.meta.dir, '..');
const goodPath = path.join(repoRoot, 'examples', 'catalog-good.layout.json');
const contractPath = path.join(repoRoot, 'examples', 'catalog.contract.json');
let fixtureRoot;

function writeJson(root, relative, value) {
  const filePath = path.join(root, relative);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value));
}

function countedReader(root) {
  const counts = new Map();
  return {
    readFile(filePath) {
      const relative = path.relative(root, path.resolve(filePath)).split(path.sep).join('/');
      counts.set(relative, (counts.get(relative) || 0) + 1);
      return fs.readFileSync(filePath);
    },
    count(relative) {
      return counts.get(relative) || 0;
    },
  };
}

function literalPolicyInputs() {
  const digest = 'a'.repeat(64);
  return {
    adapter: 'svg',
    slide: null,
    profile: null,
    structure: null,
    type: null,
    lint: false,
    vuln: false,
    vulnGate: false,
    slop: false,
    slopGate: false,
    slopAutofix: false,
    humanOnUnfixable: false,
    params: structuredClone(DEFAULT_PARAMS),
    tokens: structuredClone(DEFAULT_TOKENS),
    schemas: {
      sha256: digest,
      files: [{ relative_path: 'schemas/alt.schema.json', sha256: digest }],
    },
    installation: {
      sha256: digest,
      files: [{ relative_path: 'lib/measure.mjs', sha256: digest }],
    },
    validator: { name: 'ajv', version: '8.20.0' },
    runtime: {
      engine: 'bun',
      version: '1.3.6',
      platform: 'linux',
      arch: 'x64',
      locale: 'en',
      versions_sha256: digest,
    },
  };
}

function expectReceiptError(callback, code) {
  try {
    callback();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error.name).toBe('ReceiptInputError');
    expect(error.code).toBe(code);
  }
}

beforeEach(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aesthete-snapshot-'));
  fs.mkdirSync(path.join(fixtureRoot, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, 'schemas'), { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, 'lib', 'a.mjs'), 'export const a = 1;');
  fs.writeFileSync(path.join(fixtureRoot, 'schemas', 'a.schema.json'), '{}');
  fs.writeFileSync(path.join(fixtureRoot, 'package.json'), '{}');
  fs.writeFileSync(path.join(fixtureRoot, 'bun.lock'), '{}');
  fs.writeFileSync(path.join(fixtureRoot, 'package-lock.json'), '{}');
});

afterEach(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

test('installation manifest is path-sorted, content-bound, and path-independent', () => {
  const first = captureInstallationManifest(fixtureRoot);
  expect(first.files.map((file) => file.relative_path)).toEqual([
    'bun.lock', 'lib/a.mjs', 'package-lock.json', 'package.json',
  ]);
  expect(first.files.every((file) => /^[0-9a-f]{64}$/.test(file.sha256))).toBe(true);
  expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
});

test('verification manifest reports stored deletion and current addition as stale changes', () => {
  const stored = captureInstallationManifest(fixtureRoot);
  fs.unlinkSync(path.join(fixtureRoot, 'lib', 'a.mjs'));
  fs.writeFileSync(path.join(fixtureRoot, 'lib', 'b.mjs'), 'export const b = 2;');
  const comparison = compareCurrentManifest(stored, fixtureRoot, 'installation');
  expect(comparison.matches).toBe(false);
  expect(comparison.changes).toEqual([
    { code: 'MANIFEST_FILE_MISSING', relative_path: 'lib/a.mjs' },
    { code: 'MANIFEST_FILE_ADDED', relative_path: 'lib/b.mjs' },
  ]);
});

test('emission wraps required manifest failures in stable typed errors', () => {
  fs.unlinkSync(path.join(fixtureRoot, 'bun.lock'));
  try {
    captureInstallationManifest(fixtureRoot);
    throw new Error('expected capture to fail');
  } catch (error) {
    expect(error.name).toBe('ReceiptInputError');
    expect(error.code).toBe('INSTALLATION_INPUT_INVALID');
  }
});

test('stored manifest traversal is invalid rather than readable', () => {
  const stored = { files: [{ relative_path: '../secret', sha256: '0'.repeat(64) }] };
  expect(() => compareCurrentManifest(stored, fixtureRoot, 'installation'))
    .toThrow(/invalid manifest path/i);
});

test('runtime snapshot records Bun, process versions, platform, arch, and locale', () => {
  const runtime = captureRuntime();
  expect(runtime.engine).toBe('bun');
  expect(runtime.version).toBe(process.versions.bun);
  expect(runtime.platform).toBe(process.platform);
  expect(runtime.arch).toBe(process.arch);
  expect(runtime.versions_sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(typeof runtime.locale).toBe('string');
});

test('runtime snapshot fails closed when Bun identity is absent', () => {
  try {
    captureRuntime({
      versions: { node: process.versions.node },
      platform: process.platform,
      arch: process.arch,
    });
    throw new Error('expected BUN_REQUIRED');
  } catch (error) {
    expect(error.name).toBe('ReceiptInputError');
    expect(error.code).toBe('BUN_REQUIRED');
  }
});

test('schema bundle records and returns the same buffers used by the validator', async () => {
  const bundle = captureSchemaBundle(repoRoot);
  const validator = await createRunValidator(bundle);
  const good = JSON.parse(fs.readFileSync(goodPath, 'utf8'));
  expect(() => validator.validate('alt', good)).not.toThrow();
  expect(bundle.manifest.files.find(
    (file) => file.relative_path === 'schemas/alt.schema.json',
  ).sha256).toBe(sha256Bytes(bundle.buffers.get('schemas/alt.schema.json')));
});

test('strict validator rejects invalid ALT and empty contract criteria', async () => {
  const validator = await createRunValidator(captureSchemaBundle(repoRoot));
  expect(() => validator.validate('alt', { nodes: [] })).toThrow(/alt schema/i);
  expect(() => validator.validate('contract', {
    schema_version: 1,
    brief: '',
    criteria: [],
  })).toThrow(/contract schema/i);
});

test('effective params and tokens are resolved once as consumed values', () => {
  const reads = countedReader(fixtureRoot);
  writeJson(fixtureRoot, 'skill-params.json', { proximity: { ALPHA: 0.7 } });
  writeJson(fixtureRoot, 'skill-params.strict.json', { proximity: { ALPHA: 0.9 } });
  writeJson(fixtureRoot, 'tokens.json', {
    colors: ['#ffffff'],
    fontScale: [12, 16],
    radii: [0, 4],
  });
  expect(resolveEffectiveParams(fixtureRoot, 'strict', reads))
    .toMatchObject({ proximity: {
      ALPHA: 0.9,
      RANG_RATIO: DEFAULT_PARAMS.proximity.RANG_RATIO,
      FRAG_FACTOR: DEFAULT_PARAMS.proximity.FRAG_FACTOR,
      SIM_THRESHOLD: DEFAULT_PARAMS.proximity.SIM_THRESHOLD,
    } });
  expect(resolveEffectiveTokens(fixtureRoot, reads))
    .toEqual({ colors: ['#ffffff'], fontScale: [12, 16], radii: [0, 4] });
  expect(reads.count('skill-params.json')).toBe(1);
  expect(reads.count('skill-params.strict.json')).toBe(1);
  expect(reads.count('tokens.json')).toBe(1);
  expect(resolveEffectiveParams(fixtureRoot, 'missing-profile'))
    .toMatchObject({ proximity: { ALPHA: 0.7 } });
});

test.each([
  [
    { colors: ['#ffffff'] },
    {
      colors: ['#ffffff'],
      fontScale: DEFAULT_TOKENS.fontScale,
      radii: DEFAULT_TOKENS.radii,
    },
  ],
  [
    { fontScale: [14] },
    {
      colors: DEFAULT_TOKENS.colors,
      fontScale: [14],
      radii: DEFAULT_TOKENS.radii,
    },
  ],
  [
    { radii: [2] },
    {
      colors: DEFAULT_TOKENS.colors,
      fontScale: DEFAULT_TOKENS.fontScale,
      radii: [2],
    },
  ],
])('partial tokens merge supported fields with defaults', (stored, expected) => {
  writeJson(fixtureRoot, 'tokens.json', stored);
  expect(resolveEffectiveTokens(fixtureRoot)).toEqual(expected);
});

test('artifact and requested contract snapshot each call the supplied reader once', () => {
  const counts = new Map();
  const readFile = (filePath) => {
    counts.set(filePath, (counts.get(filePath) || 0) + 1);
    return fs.readFileSync(filePath);
  };
  const io = { readFile };
  const artifact = snapshotArtifact(goodPath, {}, io);
  const contract = snapshotContract(contractPath, io);
  expect(artifact.bytes).toEqual(fs.readFileSync(goodPath));
  expect(contract.bytes).toEqual(fs.readFileSync(contractPath));
  expect(counts.get(goodPath)).toBe(1);
  expect(counts.get(contractPath)).toBe(1);
});

test('schema capture reads every schema once and validator identity is bound', async () => {
  const reads = countedReader(repoRoot);
  const bundle = captureSchemaBundle(repoRoot, reads);
  const validator = await createRunValidator(bundle);
  for (const entry of bundle.manifest.files) {
    expect(reads.count(entry.relative_path)).toBe(1);
  }
  expect(validator.name).toBe('ajv');
  expect(validator.version).toMatch(/^\d+\.\d+\.\d+/);
});

test('policy normalization is one pure seam for post and verifier', () => {
  const base = literalPolicyInputs();
  expect(normalizePostPolicy(base)).toEqual(normalizePostPolicy(structuredClone(base)));
  expect(normalizePostPolicy({ ...base, adapter: 'pptx', slide: undefined })
    .adapter.effective_slide).toBe(1);
  expect(normalizePostPolicy({ ...base, adapter: 'svg', slide: 2 })
    .adapter.effective_slide).toBeNull();
  expect(normalizePostPolicy({ ...base, lint: false }).resources.tokens_sha256).toBeNull();
});

test.each([
  ['profile', { profile: 'strict' }],
  ['structure', { structure: 'hero-grid' }],
  ['artifact type', { type: 'dashboard' }],
  ['lint', { lint: true }],
  ['vuln gate', { vulnGate: true }],
  ['slop gate', { slopGate: true }],
  ['human on unfixable', { humanOnUnfixable: true }],
])('policy normalization records %s', (_name, change) => {
  expect(normalizePostPolicy({ ...literalPolicyInputs(), ...change }))
    .not.toEqual(normalizePostPolicy(literalPolicyInputs()));
});

test('artifact snapshot normalizes adapter and effective slide semantics', () => {
  const pptxPath = path.join(fixtureRoot, 'deck.pptx');
  const svgPath = path.join(fixtureRoot, 'shape.svg');
  const unknownPath = path.join(fixtureRoot, 'shape.unknown');
  fs.writeFileSync(pptxPath, 'pptx');
  fs.writeFileSync(svgPath, '<svg/>');
  fs.writeFileSync(unknownPath, '{}');

  expect(snapshotArtifact(pptxPath, {})).toMatchObject({
    status: 'bound', adapter: 'pptx', effective_slide: 1,
  });
  expect(snapshotArtifact(pptxPath, { slide: 2 })).toMatchObject({
    status: 'bound', adapter: 'pptx', effective_slide: 2,
  });
  expect(snapshotArtifact(svgPath, { slide: 2 })).toMatchObject({
    status: 'bound', adapter: 'svg', effective_slide: null,
  });
  expect(snapshotArtifact(unknownPath, {})).toMatchObject({
    status: 'bound', adapter: 'alt', effective_slide: null,
  });
});

test('artifact snapshot rejects unsupported domain and invalid slides with stable codes', () => {
  expectReceiptError(
    () => snapshotArtifact(goodPath, { domain: 'unsupported-domain' }),
    'DOMAIN_INVALID',
  );
  for (const slide of [0, -1, 1.5, '2']) {
    expectReceiptError(() => snapshotArtifact(goodPath, { slide }), 'SLIDE_INVALID');
  }
});

test('unreadable artifact has no bytes or digest', () => {
  expect(snapshotArtifact(path.join(fixtureRoot, 'missing.svg'), {})).toMatchObject({
    status: 'unreadable',
    bytes: null,
    sha256: null,
    adapter: 'svg',
    effective_slide: null,
  });
});

test('requested contract rejects duplicate keys with a stable code', () => {
  const duplicatePath = path.join(fixtureRoot, 'duplicate.contract.json');
  fs.writeFileSync(duplicatePath, '{"brief":"","brief":"again"}');
  expectReceiptError(() => snapshotContract(duplicatePath), 'CONTRACT_INPUT_INVALID');
});

test('strict validator maps an unavailable AJV loader to a stable code', async () => {
  const unavailable = Object.assign(new Error('missing ajv'), { code: 'ERR_MODULE_NOT_FOUND' });
  try {
    await createRunValidator(captureSchemaBundle(repoRoot), async () => {
      throw unavailable;
    });
    throw new Error('expected AJV_REQUIRED');
  } catch (error) {
    expect(error.name).toBe('ReceiptInputError');
    expect(error.code).toBe('AJV_REQUIRED');
  }
});

test('policy digests exact effective params and lint-enabled tokens', () => {
  const base = literalPolicyInputs();
  const policy = normalizePostPolicy({ ...base, lint: true });
  expect(policy.resources.params_sha256).toBe(sha256Json(base.params));
  expect(policy.resources.tokens_sha256).toBe(sha256Json(base.tokens));
});
