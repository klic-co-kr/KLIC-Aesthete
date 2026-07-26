# Snapshot-Bound Decision Receipts Implementation Plan

> **For the implementing session:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and implement this plan task-by-task in the main session. Native sub-agents are prohibited by repository instructions. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit and verify Aesthete decision receipts that bind the stored decision core to exact input snapshots, consumed configuration and schemas, runtime identity, on-disk installation state, and any actionable geometry-fix inputs.

**Architecture:** Add a strict I-JSON/JCS utility, a filesystem snapshot layer, a pure receipt model, and a strict verifier CLI. `runPost()` remains the orchestration boundary: it snapshots once, injects the captured values into existing evaluators, folds the existing decision, then attaches `claim_scope` and `binding`; `foldDecision()` remains pure and unaware of hashing or I/O.

**Tech Stack:** Bun 1.3+, ECMAScript modules, `bun:test`, Node built-ins (`crypto`, `fs`, `path`, `url`), AJV 8 Draft 2020-12, JSON Schema, RFC 8785 JCS.

**Normative canonicalization reference:** [RFC 8785 — JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785.html).

## Global Constraints

- Preserve outer `aesthete.decision/v1` and the existing `pass | fix_geometry | regenerate | human` branch and exit-code contracts.
- Receipt-backed post, gate, and verifier entry points require Bun and AJV; dependency/input failures exit `2` and emit no receipt-backed decision.
- Artifact and requested contract paths are each read at most once per post or verify operation.
- Params, tokens, and schema bytes recorded in policy must be the exact values consumed; the installation digest is only an on-disk observation, never executed-code attestation.
- An unkeyed digest proves neither authenticity, provenance, authorization, time, nor correctness; edit-plus-rebinding is intentionally possible.
- Do not copy upstream `visual-authoring` code, schemas, prose, taxonomy ordering, or tests. The external reference remains idea provenance only.
- Do not modify, stage, or commit the user-owned untracked `AGENTS.md`.
- Use strict RED → observed expected failure → minimal GREEN → focused regression → commit for every production behavior.
- Run `npm test` for the final regression because it executes both `test/golden.mjs` and the complete Bun test suite.

Stable input/dependency codes used in RED tests and CLI mapping:

| Code | Boundary |
|---|---|
| `DOMAIN_INVALID` | unsupported explicit adapter |
| `SLIDE_INVALID` | non-positive/non-integer slide |
| `CONTRACT_INPUT_INVALID` | requested contract read/strict parse/schema |
| `ACTION_CONTRACT_INVALID` | default/requested future fix contract |
| `SCHEMA_INPUT_INVALID` | schema discovery/read/strict parse/compile input |
| `INSTALLATION_INPUT_INVALID` | required engine/package manifest capture |
| `AJV_REQUIRED` | mandatory validator unavailable |
| `BUN_REQUIRED` | receipt-backed runtime is not Bun |
| `POLICY_INPUT_INVALID` | malformed profile/structure/artifact-type policy input |
| `CURRENT_INPUT_INVALID` | malformed current verifier snapshot/comparison input |
| `ACTION_GRAMMAR_INVALID` | malformed stored or directly parsed fix action command |

All map to exit `2` at receipt-backed CLI boundaries and create no decision
or verification output.

---

## File Map

| File | Responsibility |
|---|---|
| `lib/shared/canonical-json.mjs` | Strict duplicate-aware I-JSON parsing, RFC 8785 canonicalization, SHA-256 helpers |
| `lib/shared/validator.mjs` | Preserve degraded legacy validation; add run-local strict validator constructed from captured schema bytes |
| `lib/skill-snapshot.mjs` | Artifact/contract/config/schema/runtime/installation snapshots and manifest comparison |
| `lib/skill-receipt-core.mjs` | Claim scope, decision-core projection, binding construction, pinned v1 shape validation, verification status fold |
| `lib/skill-action.mjs` | Exact `fix_cmd` grammar, action-input binding, stored/current action checks |
| `lib/skill-receipt.mjs` | Strict verifier CLI and exit/output contract |
| `lib/skill-post.mjs` | Single-snapshot orchestration and receipt emission |
| `lib/measure.mjs`, `lib/skills/proximity.mjs`, `lib/tokens.mjs` | Consume injected params/tokens rather than hidden cached reads |
| `lib/fix.mjs` | Accept and thread the bound positive PPTX `--slide` |
| `lib/skill-gate.mjs` | Map receipt dependency/input failures to exit `2`; preserve decision exits |
| `schemas/decision.schema.json` | Optional paired v1 receipt extensions with strict nested shapes |
| `test/canonical-json.test.mjs` | I-JSON and JCS conformance/negative cases |
| `test/skill-snapshot.test.mjs` | Read-once snapshots, effective resources, manifests, run-local schema consumption |
| `test/skill-receipt-core.test.mjs` | Claim semantics, core digest, status precedence, unkeyed-rebind limitation |
| `test/skill-action.test.mjs` | Exact action grammar, CWD independence, default/requested contract and option binding |
| `test/skill-receipt-cli.test.mjs` | Real verifier/post/gate processes, status output, exit codes, strict arguments |
| `test/skill-surface.test.mjs`, `test/cli.test.mjs`, `test/slop-integration.test.mjs` | Post/fix/gate regression and single-snapshot integration |
| `SKILL.md`, `skills/aesthete-post/SKILL.md`, `skills/aesthete-gate/SKILL.md` | Agent rule: verify stored decisions and interpret `pass` narrowly |
| `docs/agent-llm-usage.md`, `docs/integration/generator-contract.md`, `README.md`, `README.ko.md` | User/integration receipt contract |
| `package.json` | `receipt` script |
| `docs/superpowers/plans/2026-07-27-snapshot-bound-decision-receipts-execution.md` | Implementation base, RED/GREEN commands, skill pressure-test transcripts/scores, provenance statement |

---

### Task 0: Reviewed Plan Baseline and Branch Safety

**Files:**
- Commit: `docs/superpowers/plans/2026-07-27-snapshot-bound-decision-receipts.md`
- Create after that commit: `docs/superpowers/plans/2026-07-27-snapshot-bound-decision-receipts-execution.md`

- [ ] **Step 1: Apply worktree safety, preserve the user-owned file, and create the feature branch**

Read and apply `superpowers:using-git-worktrees`, then detect isolation:

```bash
GIT_DIR="$(cd "$(git rev-parse --git-dir)" && pwd -P)"
GIT_COMMON="$(cd "$(git rev-parse --git-common-dir)" && pwd -P)"
git rev-parse --show-superproject-working-tree 2>/dev/null
git branch --show-current
git fetch origin main
git status --short
git rev-parse origin/main
git log --oneline --left-right origin/main...HEAD
FORK_SHA="$(git rev-parse HEAD)"
npm test
git switch -c feat/snapshot-bound-decision-receipts
```

The existing user instruction makes the current worktree authoritative; this
is the explicit decline of a second linked worktree required by
`using-git-worktrees`. Record `isolation_choice:
current_worktree_user_selected`. If that instruction is no longer present,
stop and ask for worktree consent before `git switch`.

Record the fetched `origin/main` SHA and left/right comparison in execution
notes. Record `base_branch: main` and the printed `fork_sha` before the
switch. Expected before the switch: exactly `?? AGENTS.md` and the plan, and
the baseline suite is green. If any other path is dirty or the baseline
fails, stop and preserve/report it rather than staging or guessing.

- [ ] **Step 2: Commit only the reviewed plan**

```bash
git add -- docs/superpowers/plans/2026-07-27-snapshot-bound-decision-receipts.md
git diff --cached --name-only
git commit -m "docs: plan snapshot-bound decision receipts"
```

Expected staged path: only this plan. Define the immutable implementation
base in later commands as:

```bash
IMPLEMENTATION_BASE="$(git log -1 --format=%H -- docs/superpowers/plans/2026-07-27-snapshot-bound-decision-receipts.md)"
test "$IMPLEMENTATION_BASE" = "$(git rev-parse HEAD)"
```

- [ ] **Step 3: Start execution notes without opening the external reference**

Create the execution-notes file with:

```text
base_branch: main
fork_sha: value recorded immediately before branch creation
implementation_base: value printed by git rev-parse HEAD after Step 2
upstream_baseline: fetched origin/main SHA from Step 1
isolation_choice: current_worktree_user_selected
provenance: implementation used only the approved local design spec and
current Aesthete repository; the visual-authoring repository was not opened
or used as an implementation template.
```

Every observed RED/GREEN command, exact failure reason, skill pressure-test
output path/manual score, and review verdict is appended here. The
non-copying conclusion is limited to “no evidence of external expression was
used”; legal similarity is outside this engineering review.

---

### Task 1: Strict I-JSON Parsing and RFC 8785 Canonicalization

**Files:**
- Create: `lib/shared/canonical-json.mjs`
- Create: `test/canonical-json.test.mjs`

**Interfaces:**
- Produces: `parseJsonStrict(bytesOrText, label)`, `canonicalizeJson(value)`, `sha256Bytes(bytes)`, `sha256Json(value)`.
- Consumes: Bun/ECMAScript `JSON.stringify()` number and string serialization required by RFC 8785.

- [ ] **Step 1: Write the failing RFC 8785 and SHA tests**

```js
import { test, expect } from 'bun:test';
import {
  canonicalizeJson,
  sha256Bytes,
  sha256Json,
} from '../lib/shared/canonical-json.mjs';

test('JCS: RFC 8785 section 3 sample has the canonical byte sequence', () => {
  const input = {
    numbers: [333333333.33333329, 1E30, 4.50, 2e-3, 1e-27],
    string: "€$\u000f\nA'B\"\\\\\"/",
    literals: [null, true, false],
  };
  const expected = `{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA'B\\"\\\\\\\\\\"/"}`;
  expect(canonicalizeJson(input)).toBe(expected);
});

test('JCS: object keys sort by raw UTF-16 code units while arrays retain order', () => {
  expect(canonicalizeJson({ ö: 1, '\r': 2, '1': 3, '€': 4, '😀': 5, '\ufb33': 6 }))
    .toBe(`{"\\r":2,"1":3,"ö":1,"€":4,"😀":5,"דּ":6}`);
  expect(canonicalizeJson([{ b: 1, a: 2 }, 3, 2, 1]))
    .toBe('[{"a":2,"b":1},3,2,1]');
});

test('SHA-256: raw abc bytes match the published digest', () => {
  expect(sha256Bytes(Buffer.from('abc')))
    .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('SHA-256: structured values hash their canonical bytes', () => {
  expect(sha256Json({ b: 2, a: 1 }))
    .toBe(sha256Bytes(Buffer.from('{"a":1,"b":2}', 'utf8')));
});
```

- [ ] **Step 2: Run the focused test and observe RED**

Run:

```bash
bun test test/canonical-json.test.mjs
```

Expected: suite load FAIL because `lib/shared/canonical-json.mjs` does not
exist. Create only an export skeleton whose four functions throw
`NotImplemented`, rerun, and record assertion failures for canonical bytes
and SHA values. The loader error alone is not the observed RED.

- [ ] **Step 3: Implement only the three RED-tested JCS/SHA behaviors**

Create an export-only module that handles ordinary JSON values and byte
hashing. Do not add I-JSON guards or strict parsing yet:

```js
import { createHash } from 'node:crypto';

export function canonicalizeJson(value) {
  const emit = (node) => {
    if (node === null || typeof node !== 'object') return JSON.stringify(node);
    if (Array.isArray(node)) return `[${node.map(emit).join(',')}]`;
    return `{${Object.keys(node).sort().map((key) => `${JSON.stringify(key)}:${emit(node[key])}`).join(',')}}`;
  };
  return emit(value);
}

export const sha256Bytes = (bytes) =>
  createHash('sha256').update(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)).digest('hex');

export const sha256Json = (value) =>
  sha256Bytes(Buffer.from(canonicalizeJson(value), 'utf8'));

export function parseJsonStrict() {
  throw new Error('NotImplemented');
}
```

- [ ] **Step 4: Run the JCS tests and observe GREEN**

Run:

```bash
bun test test/canonical-json.test.mjs
```

Expected: 4 pass, 0 fail. `parseJsonStrict()` remains an uncalled stub.

- [ ] **Step 5: Add failing strict-parser and unsupported-value tests**

Add `parseJsonStrict` to the existing static import now that the stub export
exists, then add:

```js
test('strict JSON: decoded duplicate keys are rejected at any depth', () => {
  expect(() => parseJsonStrict('{"a":1,"\\u0061":2}', 'decision')).toThrow(/duplicate.*a/i);
  expect(() => parseJsonStrict('{"outer":{"x":1,"x":2}}', 'contract')).toThrow(/duplicate.*x/i);
});

test('strict JSON: lone UTF-16 surrogates are rejected', () => {
  expect(() => parseJsonStrict('"\\ud800"', 'decision')).toThrow(/surrogate/i);
  expect(() => parseJsonStrict('"\\udc00"', 'decision')).toThrow(/surrogate/i);
});

test('strict JSON: malformed UTF-8 is rejected and __proto__ remains ordinary data', () => {
  expect(() => parseJsonStrict(Buffer.from([0xc3, 0x28]), 'decision'))
    .toThrow(/utf-8/i);
  const value = parseJsonStrict('{"__proto__":{"polluted":true}}', 'decision');
  expect(Object.hasOwn(value, '__proto__')).toBe(true);
  expect({}.polluted).toBeUndefined();
});

test('JCS: lossy or non-JSON values are rejected', () => {
  expect(() => canonicalizeJson({ value: undefined })).toThrow(/unsupported/i);
  expect(() => canonicalizeJson([, 1])).toThrow(/sparse/i);
  expect(() => canonicalizeJson({ value: NaN })).toThrow(/non-finite/i);
  expect(() => canonicalizeJson({ value: 1n })).toThrow(/unsupported/i);
  const cyclic = {}; cyclic.self = cyclic;
  expect(() => canonicalizeJson(cyclic)).toThrow(/cycle/i);
  expect(canonicalizeJson(-0)).toBe('0');
});

test('JCS: selected RFC 8785 Appendix B numbers use ECMAScript serialization', () => {
  const cases = [
    [5e-324, '5e-324'],
    [1.7976931348623157e+308, '1.7976931348623157e+308'],
    [9007199254740992, '9007199254740992'],
    [0.000001, '0.000001'],
    [1e-7, '1e-7'],
  ];
  for (const [value, expected] of cases) expect(canonicalizeJson(value)).toBe(expected);
});
```

- [ ] **Step 6: Run the focused test and observe the parser RED**

Run:

```bash
bun test test/canonical-json.test.mjs
```

Expected: assertion failures for missing strict parsing, unsupported-value
rejection, or fatal UTF-8 handling. A suite-loader error is not sufficient:
if the missing export aborts collection, add only an exported
`parseJsonStrict()` stub that throws `NotImplemented`, rerun, and record the
resulting assertion RED before implementing behavior.

- [ ] **Step 7: Implement a duplicate-aware recursive-descent parser**

Implement `parseJsonStrict()` in the same module with this grammar:

```text
value  := object | array | string | number | true | false | null
object := "{" [ string ":" value *("," string ":" value) ] "}"
array  := "[" [ value *("," value) ] "]"
```

Implementation requirements:

- Convert a `Buffer` to text once with
  `new TextDecoder('utf-8', { fatal: true }).decode(bytes)` and wrap decode
  failure with the supplied label.
- Parse string tokens by locating an unescaped closing quote, then use `JSON.parse(rawStringToken)` only for decoding that single string token.
- In every object frame, keep a `Set` of decoded property names and throw `"<label>: duplicate key '<key>'"` before assigning a second occurrence.
- Parse numbers only when they match `-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?`, then require a finite `Number`.
- Reject control characters in raw strings, malformed escapes, missing separators, and trailing non-whitespace.
- Call `assertIJsonValue()` on the parsed result before returning.
- Construct objects with `Object.create(null)` while parsing, then copy own
  decoded keys into a plain object with `Object.defineProperty()` so
  `__proto__` is inert ordinary data.

Add `assertIJsonValue()` now, after its RED tests. It rejects unsupported
types, cycles, sparse arrays, non-finite numbers, non-plain objects, and lone
surrogates. `assertUnicodeScalarString()` walks UTF-16 code units, accepts a
high surrogate only immediately before a low surrogate, and advances across
the valid pair.

- [ ] **Step 8: Run the focused test and full canonical regression**

Run:

```bash
bun test test/canonical-json.test.mjs
```

Expected: all tests pass, no warnings.

- [ ] **Step 9: Commit Task 1**

```bash
git add lib/shared/canonical-json.mjs test/canonical-json.test.mjs
git commit -m "feat: add strict canonical JSON primitives"
```

---

### Task 2: Resource, Schema, Runtime, and Installation Snapshots

**Files:**
- Create: `lib/skill-snapshot.mjs`
- Create: `test/skill-snapshot.test.mjs`
- Modify: `lib/shared/validator.mjs`

**Interfaces:**
- Consumes: `parseJsonStrict`, `sha256Bytes`, `sha256Json`.
- Produces: `DEFAULT_IO`, `createOperationIo()`, `snapshotArtifact()`, `snapshotContract()`, `resolveEffectiveParams()`, `resolveEffectiveTokens()`, `captureSchemaBundle()`, `captureInstallationManifest()`, `compareCurrentManifest()`, `captureRuntime()`, `normalizePostPolicy()`, `createRunValidator()`, `ReceiptInputError`.

- [ ] **Step 1: Write failing manifest and runtime tests**

Use a real `mkdtempSync()` tree with `lib/a.mjs`, `schemas/a.schema.json`, `package.json`, `bun.lock`, and `package-lock.json`.

```js
test('installation manifest is path-sorted, content-bound, and path-independent', () => {
  const first = captureInstallationManifest(fixtureRoot);
  expect(first.files.map((f) => f.relative_path)).toEqual([
    'bun.lock', 'lib/a.mjs', 'package-lock.json', 'package.json',
  ]);
  expect(first.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true);
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
```

- [ ] **Step 2: Run the snapshot test and observe RED**

Run:

```bash
bun test test/skill-snapshot.test.mjs
```

Expected: FAIL because `lib/skill-snapshot.mjs` does not exist.

- [ ] **Step 3: Implement deterministic manifest and runtime capture**

Implement:

```js
export class ReceiptInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReceiptInputError';
    this.code = code;
  }
}

export const DEFAULT_IO = Object.freeze({
  readFile: (filePath) => fs.readFileSync(filePath),
});

export function createOperationIo(baseIo = DEFAULT_IO) {
  const buffers = new Map();
  return {
    readFile(filePath) {
      const absolute = path.resolve(filePath);
      if (!buffers.has(absolute)) buffers.set(absolute, Buffer.from(baseIo.readFile(absolute)));
      return buffers.get(absolute);
    },
  };
}

export function captureInstallationManifest(root, io = DEFAULT_IO) {
  const files = [
    ...walkRegularFiles(path.join(root, 'lib'), {
      root,
      accept: (relativePath) => relativePath.endsWith('.mjs'),
      rejectSymlinks: true,
    }),
    'package.json',
    'bun.lock',
    'package-lock.json',
  ];
  const entries = files
    .map((relativePath) => ({
      relative_path: relativePath,
      sha256: sha256Bytes(io.readFile(path.join(root, relativePath))),
    }))
    .sort((a, b) => (
      a.relative_path < b.relative_path ? -1 : a.relative_path > b.relative_path ? 1 : 0
    ));
  return { files: entries, sha256: sha256Json(entries) };
}

export function compareCurrentManifest(stored, root, kind, io = DEFAULT_IO) {
  validateManifestPaths(stored.files, kind);
  const current = captureManifestForStoredKind(stored, root, kind, io);
  return compareManifestEntries(stored.files, current.files);
}

export function captureRuntime(runtime = process) {
  if (!runtime.versions.bun) {
    throw new ReceiptInputError('BUN_REQUIRED', 'receipt-backed execution requires Bun');
  }
  return {
    engine: 'bun',
    version: runtime.versions.bun,
    platform: runtime.platform,
    arch: runtime.arch,
    locale: new Intl.Collator().resolvedOptions().locale,
    versions_sha256: sha256Json({ ...runtime.versions }),
  };
}
```

`walkRegularFiles()` must recurse with `lstatSync()`, reject every symlink
before following it, normalize separators to `/`, and return root-relative
paths. `validateManifestPaths()` rejects absolute paths, empty segments,
`.`/`..`, backslashes, paths outside the allowlist for `kind`, duplicate
paths, and non-lowercase-hex digests. `captureManifestForStoredKind()` fully
rediscovers the current allowlisted namespace—every `lib/**/*.mjs` plus the
three package/lock files for `installation`, and every `schemas/*.json` for
`schemas`. It must not limit discovery to stored paths.
`compareManifestEntries()` indexes stored and current arrays, compares their
path-sorted union, and emits exactly
`MANIFEST_FILE_MISSING`, `MANIFEST_FILE_ADDED`, or
`MANIFEST_FILE_CHANGED`, sorted first by `relative_path` and then by code.

Emission is strict: missing/unreadable required files or symlinks are wrapped
as `ReceiptInputError('INSTALLATION_INPUT_INVALID', ...)`.
Verification is tolerant of current deletion: it validates stored paths,
rediscovers the full current namespace, and compares the union, so deletions
and additions are changes rather than dependency exceptions.

- [ ] **Step 4: Run the focused manifest tests and observe GREEN**

Run:

```bash
bun test test/skill-snapshot.test.mjs
```

Expected: manifest/runtime tests pass.

- [ ] **Step 5: Add failing schema/config/single-read tests**

Define `countedReader(root)` in the test file as `{ readFile(path) }` around
`fs.readFileSync()` that normalizes each absolute request to a root-relative
`/` path and exposes `count(relativePath)`. Define `writeJson(root,
relativePath, value)` to create parent directories and write JSON only inside
the test temp root. Set `tempRoot` from a fresh `mkdtempSync()` per test,
`goodPath = path.join(root, 'examples', 'catalog-good.layout.json')`, and
`contractPath = path.join(root, 'examples', 'catalog.contract.json')`;
remove `tempRoot` in `afterEach`. Define `literalPolicyInputs()` as a complete test-local
plain object with explicit adapter/slide/profile/structure/type/boolean
flags, params/tokens, one-entry schema and installation manifests, validator
identity, and Bun runtime; it must not call production normalization.

```js
test('schema bundle records and returns the same buffers used by the validator', async () => {
  const bundle = captureSchemaBundle(root);
  const validator = await createRunValidator(bundle);
  const good = JSON.parse(fs.readFileSync(goodPath, 'utf8'));
  expect(() => validator.validate('alt', good)).not.toThrow();
  expect(bundle.manifest.files.find((f) => f.relative_path === 'schemas/alt.schema.json').sha256)
    .toBe(sha256Bytes(bundle.buffers.get('schemas/alt.schema.json')));
});

test('strict validator rejects invalid ALT and empty contract criteria', async () => {
  const validator = await createRunValidator(captureSchemaBundle(root));
  expect(() => validator.validate('alt', { nodes: [] })).toThrow(/alt schema/i);
  expect(() => validator.validate('contract', {
    schema_version: 1, brief: '', criteria: [],
  })).toThrow(/contract schema/i);
});

test('effective params and tokens are resolved once as consumed values', () => {
  const reads = countedReader(tempRoot);
  writeJson(tempRoot, 'skill-params.json', { proximity: { ALPHA: 0.7 } });
  writeJson(tempRoot, 'skill-params.strict.json', { proximity: { ALPHA: 0.9 } });
  writeJson(tempRoot, 'tokens.json', {
    colors: ['#ffffff'],
    fontScale: [12, 16],
    radii: [0, 4],
  });
  expect(resolveEffectiveParams(tempRoot, 'strict', reads))
    .toMatchObject({ proximity: {
      ALPHA: 0.9,
      RANG_RATIO: DEFAULT_PARAMS.proximity.RANG_RATIO,
      FRAG_FACTOR: DEFAULT_PARAMS.proximity.FRAG_FACTOR,
      SIM_THRESHOLD: DEFAULT_PARAMS.proximity.SIM_THRESHOLD,
    } });
  expect(resolveEffectiveTokens(tempRoot, reads))
    .toEqual({ colors: ['#ffffff'], fontScale: [12, 16], radii: [0, 4] });
  expect(reads.count('skill-params.json')).toBe(1);
  expect(reads.count('skill-params.strict.json')).toBe(1);
  expect(reads.count('tokens.json')).toBe(1);
  expect(resolveEffectiveParams(tempRoot, 'missing-profile'))
    .toMatchObject({ proximity: { ALPHA: 0.7 } });
});

test.each([
  [{ colors: ['#ffffff'] }, { colors: ['#ffffff'], fontScale: DEFAULT_TOKENS.fontScale, radii: DEFAULT_TOKENS.radii }],
  [{ fontScale: [14] }, { colors: DEFAULT_TOKENS.colors, fontScale: [14], radii: DEFAULT_TOKENS.radii }],
  [{ radii: [2] }, { colors: DEFAULT_TOKENS.colors, fontScale: DEFAULT_TOKENS.fontScale, radii: [2] }],
])('partial tokens merge supported fields with defaults', (stored, expected) => {
  writeJson(tempRoot, 'tokens.json', stored);
  expect(resolveEffectiveTokens(tempRoot)).toEqual(expected);
});

test('artifact and requested contract snapshot each call the supplied reader once', () => {
  const counts = new Map();
  const readFile = (p) => {
    counts.set(p, (counts.get(p) || 0) + 1);
    return fs.readFileSync(p);
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
  const reads = countedReader(root);
  const bundle = captureSchemaBundle(root, reads);
  const validator = await createRunValidator(bundle);
  for (const entry of bundle.manifest.files) expect(reads.count(entry.relative_path)).toBe(1);
  expect(validator.name).toBe('ajv');
  expect(validator.version).toMatch(/^\d+\.\d+\.\d+/);
});

test('policy normalization is one pure seam for post and verifier', () => {
  const base = literalPolicyInputs();
  expect(normalizePostPolicy(base)).toEqual(normalizePostPolicy(structuredClone(base)));
  expect(normalizePostPolicy({ ...base, adapter: 'pptx', slide: undefined }).effective_slide)
    .toBe(1);
  expect(normalizePostPolicy({ ...base, adapter: 'svg', slide: 2 }).effective_slide)
    .toBeNull();
  expect(normalizePostPolicy({ ...base, lint: false }).tokens_sha256).toBeNull();
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
```

Before Step 7, add table-driven snapshot/error RED cases:

| Input | Expected |
|---|---|
| unsupported explicit domain | `ReceiptInputError/DOMAIN_INVALID` |
| slide `0`, `-1`, `1.5`, or non-number | `ReceiptInputError/SLIDE_INVALID` |
| PPTX without slide / with slide `2` | effective slide `1` / `2` |
| non-PPTX with slide `2` | effective slide `null` |
| unknown extension without override | adapter `alt` |
| unreadable artifact | `{ status:'unreadable', bytes:null, sha256:null }` |
| duplicate-key or invalid requested contract | `ReceiptInputError/CONTRACT_INPUT_INVALID` |
| injected AJV import failure | `ReceiptInputError/AJV_REQUIRED` |
| missing profile | exact current global/default merge without cache mutation |

Each error row asserts both `name` and stable `code`; each success row asserts
adapter/effective slide, digest, and reader count.

- [ ] **Step 6: Run the focused test and observe RED for missing snapshot/validator functions**

Run:

```bash
bun test test/skill-snapshot.test.mjs
```

Expected: FAIL on the first newly referenced function.

- [ ] **Step 7: Implement schema/config/input snapshots and run-local AJV**

`captureSchemaBundle(root)` must:

- enumerate and sort all `schemas/*.json`;
- read each file exactly once;
- keep `Map<relative_path, Buffer>` for compilation;
- expose only `{ sha256, files }` in the serializable manifest.

Add `createRunValidator(bundle, loadAjv = defaultLoadAjv)` to `lib/shared/validator.mjs`. It must:

- dynamically import `ajv/dist/2020.js`;
- throw `ReceiptInputError('AJV_REQUIRED', ...)` when unavailable;
- compile from `bundle.buffers`, including the existing common `$defs` rewrite;
- compile `alt`, `contract`, `report`, `brief`, `vuln-report`, `slop-report`, `validation-corpus`, and `decision`;
- return `{ name: 'ajv', version, validate(type, data) }`;
- leave existing `validate()` degraded behavior unchanged for independent legacy measure/fix CLIs.

Wrap missing/unreadable/schema-parse errors as
`ReceiptInputError('SCHEMA_INPUT_INVALID', ...)`. Resolve the validator
version from the installed AJV package metadata used by the dynamic import,
not from a hard-coded string.

`snapshotArtifact(path, flags, deps)` must:

- reject unsupported explicit domains;
- normalize a supplied slide to a positive integer;
- set actual adapter ID and effective PPTX slide (`1` default, `null` outside PPTX);
- read once and return `{ status, bytes, sha256, adapter, effective_slide, error }`;
- return `status: 'unreadable'` with the read error rather than fabricate a digest.

`snapshotContract()` must read once, strict-parse the buffer, and return bytes/digest/value. Schema validation is performed with the captured run validator before evaluation.

`resolveEffectiveParams()` and `resolveEffectiveTokens()` must reproduce existing fallback/merge behavior but return plain values that callers inject; they must not populate or consult the old process-global caches.

`normalizePostPolicy(input)` is the only policy-construction seam for both
post and verifier. It returns normalized adapter, effective slide, profile,
structure, artifact type, every boolean flag, params digest, nullable tokens
digest, schema/installation manifests, validator identity, and runtime.
Neither caller may manually reconstruct these fields.

- [ ] **Step 8: Run Task 2 tests and relevant legacy regressions**

Run:

```bash
bun test test/skill-snapshot.test.mjs test/adapters.test.mjs test/contract.test.mjs
```

Expected: all pass with no AJV degradation warning.

- [ ] **Step 9: Commit Task 2**

```bash
git add lib/skill-snapshot.mjs lib/shared/validator.mjs test/skill-snapshot.test.mjs
git commit -m "feat: snapshot receipt evaluation resources"
```

---

### Task 3: Pure Claim Scope, Binding, and Verification Fold

**Files:**
- Create: `lib/skill-receipt-core.mjs`
- Create: `test/skill-receipt-core.test.mjs`
- Modify: `schemas/decision.schema.json`

**Interfaces:**
- Consumes: canonical SHA helpers and serializable snapshots.
- Produces: `buildClaimScope(foldInput)`, `decisionCore(decision)`, `buildDecisionBinding(input)`, `validateReceiptV1Shape(decision)`, `verifyDecisionBinding(decision, current)`, `ReceiptCurrentInputError`.

#### Task 3 adversarial-plan amendment

This subsection is normative and resolves the shorthand in the steps below.

`buildClaimScope()` uses these exact formulas. Orchestration passes
`vulnRequested` and `slopRequested`; the older fixture-only `wantSlop` name
is not an API alias.

| Rule | `requested` | `executed` |
|---|---|---|
| `artifact_import` | always `true` | always `true` (success or captured failure reaches the fold) |
| `alt_hard_integrity` | always `true` | `Boolean(report) && !importError` |
| `coverage` | always `true` | `Boolean(report)` |
| `structure_signature` | `Boolean(structureRequested)` | `Boolean(structureRequested && structureResult != null)` |
| `token_policy` | `Boolean(lintRequested)` | `Boolean(lintRequested && lintResult != null)` |
| `known_bad_signatures` | `Boolean(vulnRequested)` | `vulnReport != null` |
| `html_pattern_scan` | `Boolean(slopRequested)` | `slopReport != null` |
| `contract_criteria` | `Boolean(contractRequested)` | `Boolean(contractRequested && contractEval != null)` |

These formulas report contradictory direct-call fixtures rather than
rejecting them; they mirror what actually reached `foldDecision()`.
Add matrix tests for requested-without-result, result-without-request,
import-error with downstream values, and no report. Task 5 must pass the two
normalized requested flags in the one fold-input object.

`decisionCore()` is the exact seven-field projection shown below. Parameterize
tests so changes to each of `decision`, `reasons`, `scores`, `next`, and
`claim_scope` change its digest, while `paths`, `binding`, and unrelated
legacy outer properties do not.

`buildDecisionBinding(input)` returns exactly:

```js
({
  schema: 'aesthete.binding/v1',
  algorithm: 'sha256',
  integrity: 'content_freshness_and_internal_consistency_not_authenticity',
  completeness,
  artifact: normalizedArtifact,
  contract: structuredClone(contract),
  action_inputs: normalizedActionInputs,
  policy: structuredClone(policy),
  policy_sha256: sha256Json(policy),
  decision_core_sha256: sha256Json(decisionCore(decision)),
})
```

`completeness` is a mandatory builder input. For `complete`,
`artifact_sha256` is mandatory lowercase hex, an `artifact` override is
forbidden, and the builder emits
`{ status: 'bound', sha256: artifact_sha256 }`. For `incomplete`,
`artifact_sha256` must be exactly `null`, `artifact` must be exactly
`{ status: 'unreadable', sha256: null }`, and the builder emits that object
unchanged. Missing, unsupported, or conflicting completeness/artifact inputs
are builder errors. Add literal RED cases for both valid modes and every
missing/conflicting combination.

A shorthand `{ status: 'not_required' }` action input is expanded by the
builder to the full nullable action shape. The verifier itself accepts only
the full pinned shape.

The code-pinned v1 validator, independently of the mutable schema, enforces
this matrix before incomplete or stale checks:

- base `schema` is exactly `aesthete.decision/v1`, `schema_version` exactly
  `1`, required base types match the current v1 schema, and the four
  decisions map exactly to `rewrite_generator`, `run_fix_p0`, `stop`, and
  `ask_human`;
- only `fix_geometry` may contain `next.fix_cmd`; for it, `fix_cmd` is a
  non-empty string array and `action_inputs.status` is `bound`; all other
  decisions forbid `fix_cmd` and require `not_required`;
- `complete` pairs only with artifact `bound` plus a lowercase digest;
  `incomplete` pairs only with `unreadable` plus `null`;
- contract `bound` pairs with a lowercase digest and `not_requested` pairs
  with `null`;
- `not_required` action inputs contain every defined subordinate field and
  every one is `null`; `bound` contains lowercase locator/content digests,
  a supported adapter, a positive PPTX slide or `null` otherwise, and a
  string-or-null profile;
- claim scope has the exact schema, `pass_means`, eight rule keys, rule
  fields/vocabulary, and `does_not_establish` values in their specified
  order; binding, policy, runtime, manifest, entry, adapter, validation,
  artifact, contract, and action descendants have no unknown properties;
- policy fields have their exact boolean/string/null types and adapter/slide
  relationship. `profile`, `structure`, and `artifact_type` are either
  `null` or non-empty strings. `resources.tokens_sha256` is a lowercase
  digest exactly when `lint === true` and is `null` exactly when
  `lint === false`. `validation.mode` is exactly `ajv`, its version is a
  non-empty string, `runtime.engine` is exactly `bun`, and every runtime
  identity string is non-empty. Its schema and installation manifests have
  exact entry shapes, lowercase digests, strict raw lexicographic path order,
  uniqueness, the correct namespace allowlist, no
  absolute/backslash/empty/`.`/`..` segments, and
  `manifest.sha256 === sha256Json(manifest.files)`;
- any stored manifest structural, namespace, order, entry-digest, or
  aggregate-digest failure uses the existing `MANIFEST_PATH_INVALID` issue
  code. It is selected before incomplete/stale even if an attacker recomputes
  `policy_sha256`;
- stored `policy_sha256` and `decision_core_sha256` are recomputed after
  pinned structural validation. Action/decision or action-null-field
  incoherence uses `ACTION_INTERNAL_MISMATCH`.

Add literal RED cases for every row above, all four decision/action mappings,
each core-inclusion/exclusion field, unsorted/duplicate/wrong-namespace/
backslash/empty-segment/aggregate-mismatch manifests, and an aggregate
mismatch whose outer policy digest was recomputed.

Current comparison input is a separate trusted-boundary contract, not part of
the stored receipt. Export `ReceiptCurrentInputError` with stable code
`CURRENT_INPUT_INVALID`. Before stale comparison:

- require a lowercase `artifact_sha256`, exact current contract/action/policy
  shapes, and exact `schemaComparison`/`installationComparison` objects;
- each comparison is exactly `{ matches, changes }`, `matches` equals
  `changes.length === 0`, and each change is an exact
  `{ code, relative_path }` with an allowed manifest code and kind-specific
  normalized path;
- require raw `(relative_path, code)` order and require `relative_path`
  itself to be unique within each comparison. A second entry for the same
  path is invalid even when its code differs. Contradictory `matches`,
  unknown/duplicate-path/unsorted changes, or malformed current values throw
  `ReceiptCurrentInputError` rather than marking the stored receipt invalid
  or silently skipping a check;
- merge both comparison arrays without loss. Stale issues sort first by the
  published class-local code order, then `manifest_kind` (`schemas` before
  `installation`), then raw `relative_path`.

For `invalid`, `unbound`, and `incomplete`, `checked` is exactly `[]`.
For an internally valid complete receipt, run every applicable comparison
even after the first mismatch and return the full six-item `ALL_CHECKED`
array. `not_requested` contract status and null digest are still two completed
checks; `not_required` action inputs are still one completed check. Missing
or malformed current data throws `ReceiptCurrentInputError`.

Add parameterized stale tests for artifact, contract status/digest, action,
each policy component, schema comparison, installation comparison, and a
simultaneous-mismatch case. Add hostile comparison tests covering
contradictory `matches`, unknown/duplicate-path/unsorted changes (including
two different codes for one path), invalid paths, and two-kind merge
ordering.

The same policy matrix—non-empty optional strings, adapter/slide coupling,
lint/tokens digest coupling, `validation.mode === 'ajv'`, Bun runtime, strict
manifests, and exact nested fields—applies without divergence to stored
pinned validation, current-input validation, and the mutable decision schema.
Add a parameterized parity corpus that presents every valid/invalid policy
fixture to all three validators and asserts the same accept/reject result.
Mutable-schema integration must also include one positive paired receipt plus
negative nested-unknown, digest, manifest, completeness, contract, and
action/decision cross-field cases; legacy unbound remains valid.

- [ ] **Step 1: Write failing claim-scope tests against literal fold fixtures**

```js
test('claim scope names import failure and the current nonblocking exceptions', () => {
  const scope = buildClaimScope({
    importError: new Error('bad json'),
    report: null,
    structureRequested: true,
    structureResult: null,
    contractRequested: true,
    contractEval: null,
  });
  expect(scope.pass_means).toBe('no_enabled_blocking_rule_triggered');
  expect(scope.rules.artifact_import.blocking_conditions)
    .toEqual(['read_parse_or_schema_failure_routes_to_regenerate']);
  expect(scope.rules.structure_signature.coverage_behavior).toBe('unknown_is_nonblocking');
  expect(scope.rules.contract_criteria.coverage_behavior)
    .toBe('p0_only_contract_failure_is_nonblocking_in_contract_branch');
});

test('claim scope describes the exclusive slop fold in branch order', () => {
  const mixedSlop = {
    summary: {
      coverage: { html: 'measured' },
      unmeasured: [{ id: 'slop.palette.indirect', tier: 'P0', reason: 'var()' }],
    },
    findings: [
      { id: 'slop.palette.gradient', tier: 'P0', title: 'gradient' },
      { id: 'slop.palette.glass', tier: 'P1', title: 'glass' },
      { id: 'slop.copy.generic', tier: 'P2', title: 'generic copy' },
    ],
  };
  const scope = buildClaimScope({
    slopRequested: true,
    slopGate: true,
    slopReport: mixedSlop,
  });
  expect(scope.rules.html_pattern_scan.blocking_conditions).toEqual([
    'branch_1_when_html_measured_and_p0_exists_regenerate',
    'branch_2_else_when_html_measured_and_gate_enabled_and_p1_exists_regenerate',
    'branch_3_else_when_html_measured_and_p0_signature_unmeasured_human',
  ]);
  expect(scope.rules.html_pattern_scan.advisory_behavior)
    .toBe('branch_4_only_p2_findings_add_reasons_after_no_prior_branch_p1_ungated_does_not');
});
```

Add these test-local literal fixtures; none imports production rule text:

```js
const passReport = {
  summary: {
    hardIntegrityScore: 1,
    measuredAestheticScore: 0.8,
    coverageScore: 1,
  },
  skills: {},
};
const fixableReport = {
  summary: {
    hardIntegrityScore: 0,
    measuredAestheticScore: 0.5,
    coverageScore: 1,
  },
  skills: {
    collision: {
      violations: [{
        message: 'overlap',
        fix: { mode: 'autoFixable' },
      }],
    },
    boundary: { violations: [] },
  },
};
const feasibleAlt = {
  meta: { canvas: { w: 1000, h: 1000 } },
  nodes: [{ id: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 } }],
};
const highVuln = {
  vulnerabilities: [{ id: 'known-bad', title: 'known bad', severity: 'high' }],
};
const failedContract = (skill) => ({
  allPass: false,
  criteria: [{ skill, metric: 'count', passed: false, criterion: `${skill}.count==1` }],
});

const claimCases = [
  {
    name: 'artifact import',
    rule: 'artifact_import',
    input: { importError: new Error('bad') },
    decision: 'regenerate',
    expected: {
      requested: true,
      executed: true,
      blocking_conditions: ['read_parse_or_schema_failure_routes_to_regenerate'],
      coverage_behavior: 'failure_prevents_downstream_execution',
      advisory_behavior: 'none',
    },
  },
  {
    name: 'hard integrity',
    rule: 'alt_hard_integrity',
    input: { report: fixableReport, alt: feasibleAlt },
    decision: 'fix_geometry',
    expected: {
      requested: true,
      executed: true,
      blocking_conditions: ['p0_score_below_one_routes_to_fix_regenerate_or_human'],
      coverage_behavior: 'reported_separately',
      advisory_behavior: 'non_p0_measurements_do_not_directly_block',
    },
  },
  {
    name: 'coverage',
    rule: 'coverage',
    input: {
      report: { ...passReport, summary: { ...passReport.summary, coverageScore: 0 } },
    },
    decision: 'human',
    expected: {
      requested: true,
      executed: true,
      blocking_conditions: ['zero_routes_to_human'],
      coverage_behavior: 'nonzero_does_not_imply_full_coverage',
      advisory_behavior: 'none',
    },
  },
  {
    name: 'structure unknown',
    rule: 'structure_signature',
    input: {
      report: passReport,
      structureRequested: true,
      structureResult: { verdict: 'unknown' },
    },
    decision: 'pass',
    expected: {
      requested: true,
      executed: true,
      blocking_conditions: ['fail_routes_to_regenerate'],
      coverage_behavior: 'unknown_is_nonblocking',
      advisory_behavior: 'none',
    },
  },
  {
    name: 'token lint',
    rule: 'token_policy',
    input: {
      report: passReport,
      lintRequested: true,
      lintResult: { passed: false, violations: [{}] },
    },
    decision: 'regenerate',
    expected: {
      requested: true,
      executed: true,
      blocking_conditions: ['any_violation_routes_to_regenerate'],
      coverage_behavior: 'no_separate_coverage_state',
      advisory_behavior: 'none',
    },
  },
  {
    name: 'known bad ungated',
    rule: 'known_bad_signatures',
    input: {
      report: passReport,
      vulnRequested: true,
      vulnReport: highVuln,
      vulnGate: false,
    },
    decision: 'pass',
    expected: {
      requested: true,
      executed: true,
      blocking_conditions: ['high_findings_route_to_regenerate_only_when_vuln_gate_enabled'],
      coverage_behavior: 'scanner_coverage_does_not_independently_block',
      advisory_behavior: 'ungated_high_findings_add_advisory_reasons',
    },
  },
  {
    name: 'known bad gated',
    rule: 'known_bad_signatures',
    input: {
      report: passReport,
      vulnRequested: true,
      vulnReport: highVuln,
      vulnGate: true,
    },
    decision: 'regenerate',
    expected: {
      requested: true,
      executed: true,
      blocking_conditions: ['high_findings_route_to_regenerate_only_when_vuln_gate_enabled'],
      coverage_behavior: 'scanner_coverage_does_not_independently_block',
      advisory_behavior: 'ungated_high_findings_add_advisory_reasons',
    },
  },
  {
    name: 'P0-only contract failure',
    rule: 'contract_criteria',
    input: {
      report: passReport,
      contractRequested: true,
      contractEval: failedContract('collision'),
    },
    decision: 'pass',
    expected: {
      requested: true,
      executed: true,
      blocking_conditions: ['non_p0_criterion_failure_routes_to_regenerate'],
      coverage_behavior: 'p0_only_contract_failure_is_nonblocking_in_contract_branch',
      advisory_behavior: 'none',
    },
  },
  {
    name: 'non-P0 contract failure',
    rule: 'contract_criteria',
    input: {
      report: passReport,
      contractRequested: true,
      contractEval: failedContract('hierarchy'),
    },
    decision: 'regenerate',
    expected: {
      requested: true,
      executed: true,
      blocking_conditions: ['non_p0_criterion_failure_routes_to_regenerate'],
      coverage_behavior: 'p0_only_contract_failure_is_nonblocking_in_contract_branch',
      advisory_behavior: 'none',
    },
  },
];

for (const row of claimCases) {
  test(`claim/fold: ${row.name}`, () => {
    expect(foldDecision(row.input).decision).toBe(row.decision);
    expect(buildClaimScope(row.input).rules[row.rule]).toEqual(row.expected);
  });
}
```

Add six explicit slop rows using this same literal expected rule object:

```js
const slopRule = {
  requested: true,
  executed: true,
  blocking_conditions: [
    'branch_1_when_html_measured_and_p0_exists_regenerate',
    'branch_2_else_when_html_measured_and_gate_enabled_and_p1_exists_regenerate',
    'branch_3_else_when_html_measured_and_p0_signature_unmeasured_human',
  ],
  coverage_behavior: 'whole_scan_unmeasurable_is_nonblocking',
  advisory_behavior:
    'branch_4_only_p2_findings_add_reasons_after_no_prior_branch_p1_ungated_does_not',
};
const slopCases = [
  ['P0', {
    slopRequested: true,
    slopReport: {
      summary: { coverage: { html: 'measured' }, unmeasured: [] },
      findings: [{ id: 'slop.palette.gradient', tier: 'P0', title: 'gradient' }],
    },
  }, 'regenerate'],
  ['P1 gated', {
    slopRequested: true,
    slopGate: true,
    slopReport: {
      summary: { coverage: { html: 'measured' }, unmeasured: [] },
      findings: [{ id: 'slop.palette.glass', tier: 'P1', title: 'glass' }],
    },
  }, 'regenerate'],
  ['P1 ungated', {
    slopRequested: true,
    slopGate: false,
    slopReport: {
      summary: { coverage: { html: 'measured' }, unmeasured: [] },
      findings: [{ id: 'slop.palette.glass', tier: 'P1', title: 'glass' }],
    },
  }, 'pass'],
  ['P0 unmeasured', {
    slopRequested: true,
    slopReport: {
      summary: {
        coverage: { html: 'measured' },
        unmeasured: [{ id: 'slop.palette.gradient', tier: 'P0', reason: 'var()' }],
      },
      findings: [],
    },
  }, 'human'],
  ['P2 only', {
    slopRequested: true,
    slopReport: {
      summary: { coverage: { html: 'measured' }, unmeasured: [] },
      findings: [{ id: 'slop.copy.generic', tier: 'P2', title: 'generic' }],
    },
  }, 'pass'],
  ['non-HTML unmeasurable', {
    slopRequested: true,
    slopReport: {
      summary: { coverage: { html: 'unmeasurable' }, unmeasured: [] },
      findings: [],
    },
  }, 'pass'],
];
for (const [name, extra, decision] of slopCases) {
  test(`claim/fold slop: ${name}`, () => {
    const input = { report: passReport, ...extra };
    expect(foldDecision(input).decision).toBe(decision);
    expect(buildClaimScope(input).rules.html_pattern_scan).toEqual(slopRule);
  });
}
```

- [ ] **Step 2: Run and observe RED**

Run:

```bash
bun test test/skill-receipt-core.test.mjs
```

Expected: FAIL because `lib/skill-receipt-core.mjs` does not exist.

- [ ] **Step 3: Implement `buildClaimScope()` as a literal rule table plus request/execution booleans**

The function must always emit all rule keys in this stable order:

```js
[
  'artifact_import',
  'alt_hard_integrity',
  'coverage',
  'structure_signature',
  'token_policy',
  'known_bad_signatures',
  'html_pattern_scan',
  'contract_criteria',
]
```

`requested` comes from the same normalized flags supplied to the fold. `executed` is true only when the corresponding result reached `foldDecision()`. The rule text is the exact design-spec vocabulary and does not inspect or reinterpret the final decision.

- [ ] **Step 4: Run claim-scope tests and observe GREEN**

Run:

```bash
bun test test/skill-receipt-core.test.mjs
```

Expected: claim-scope tests pass.

- [ ] **Step 5: Add failing decision-core, pinned-shape, binding, and status-precedence tests**

Define the fixtures in the test file before the assertions:

```js
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
const claim = buildClaimScope({});
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
const current = {
  artifact_sha256: 'a'.repeat(64),
  contract: { status: 'not_requested', sha256: null },
  action_inputs: notRequiredAction,
  policy: literalPolicyFixture(),
  schemaComparison: { matches: true, changes: [] },
  installationComparison: { matches: true, changes: [] },
};
const receiptDecision = (overrides = {}, bindingOverrides = {}) => {
  const decision = {
    ...structuredClone(legacyDecision),
    claim_scope: structuredClone(claim),
    ...overrides,
  };
  decision.binding = buildDecisionBinding({
    decision,
    completeness: 'complete',
    ...current,
    ...bindingOverrides,
  });
  return decision;
};
const boundDecision = receiptDecision();
const incompleteDecision = receiptDecision({}, {
  completeness: 'incomplete',
  artifact_sha256: null,
  artifact: { status: 'unreadable', sha256: null },
});
const ALL_CHECKED = [
  'decision_core_sha256',
  'artifact.sha256',
  'contract.status',
  'contract.sha256',
  'action_inputs',
  'policy_sha256',
];
```

`literalPolicyFixture()` is a test-local object containing every policy field required by the design schema, with one-file schema and installation manifests and a Bun runtime object. It must not call production snapshot code: these are pure-model tests.

Before implementation, add literal pinned-shape cases for unsupported
extension schema, uppercase/short digest, unknown nested receipt property,
partial extension pair, action/decision incoherence, malformed manifest
path, incomplete artifact shape, and legacy unbound shape. Assert exact
invalid/unbound issue codes.

Add tests that assert:

```js
test('decision core excludes paths and binding but includes next and claim scope', () => {
  const a = receiptDecision({ paths: { decision: '/one' } });
  const b = receiptDecision({ paths: { decision: '/two' } });
  expect(sha256Json(decisionCore(a))).toBe(sha256Json(decisionCore(b)));
  b.next.action = 'ask_human';
  expect(sha256Json(decisionCore(a))).not.toBe(sha256Json(decisionCore(b)));
});

test('verification status precedence is base invalid, unbound, extension invalid, incomplete, stale, current', () => {
  expect(verifyDecisionBinding({ decision: 'pass' }, current)).toEqual({
    status: 'invalid',
    issues: [expect.objectContaining({ code: 'BASE_SCHEMA_INVALID' })],
    checked: [],
  });
  expect(verifyDecisionBinding(legacyDecision, current)).toEqual({
    status: 'unbound',
    issues: [expect.objectContaining({ code: 'RECEIPT_UNBOUND' })],
    checked: [],
  });
  expect(verifyDecisionBinding({ ...legacyDecision, claim_scope: claim }, current)).toEqual({
    status: 'invalid',
    issues: [expect.objectContaining({ code: 'EXTENSION_PAIR_INVALID' })],
    checked: [],
  });
  expect(verifyDecisionBinding(incompleteDecision, current)).toEqual({
    status: 'incomplete',
    issues: [expect.objectContaining({ code: 'ARTIFACT_UNREADABLE' })],
    checked: [],
  });
  expect(verifyDecisionBinding(
    boundDecision,
    { ...current, artifact_sha256: 'f'.repeat(64) },
  )).toEqual({
    status: 'stale',
    issues: [expect.objectContaining({ code: 'ARTIFACT_CHANGED' })],
    checked: ALL_CHECKED,
  });
  expect(verifyDecisionBinding(boundDecision, current)).toEqual({
    status: 'current',
    issues: [],
    checked: ALL_CHECKED,
  });
});

test('selected status returns only that precedence class in stable code order', () => {
  const invalidIncompleteStale = structuredClone(incompleteDecision);
  invalidIncompleteStale.binding.policy_sha256 = 'b'.repeat(64);
  invalidIncompleteStale.binding.decision_core_sha256 = 'c'.repeat(64);
  const staleCurrent = { ...current, artifact_sha256: 'f'.repeat(64) };
  expect(verifyDecisionBinding(invalidIncompleteStale, staleCurrent)).toEqual({
    status: 'invalid',
    issues: [
      expect.objectContaining({ code: 'POLICY_DIGEST_MISMATCH' }),
      expect.objectContaining({ code: 'CORE_DIGEST_MISMATCH' }),
    ],
    checked: [],
  });
  expect(verifyDecisionBinding(incompleteDecision, staleCurrent)).toEqual({
    status: 'incomplete',
    issues: [expect.objectContaining({ code: 'ARTIFACT_UNREADABLE' })],
    checked: [],
  });
});

test('unrecomputed core edit is invalid while full public rebinding can be current', () => {
  const edited = structuredClone(boundDecision);
  edited.decision = 'human';
  edited.next.action = 'ask_human';
  expect(verifyDecisionBinding(edited, current).status).toBe('invalid');
  edited.binding = buildDecisionBinding({
    decision: edited,
    completeness: 'complete',
    ...current,
  });
  expect(verifyDecisionBinding(edited, current).status).toBe('current');
});

test('schema or installation file deletion is stale after pinned-v1 validation', () => {
  const changed = structuredClone(current);
  changed.schemaComparison = {
    matches: false,
    changes: [{ code: 'MANIFEST_FILE_MISSING', relative_path: 'schemas/decision.schema.json' }],
  };
  expect(verifyDecisionBinding(boundDecision, changed).status).toBe('stale');
});
```

- [ ] **Step 6: Run and observe RED for the unimplemented binding/verifier**

Run:

```bash
bun test test/skill-receipt-core.test.mjs
```

Expected: FAIL on `decisionCore` or `buildDecisionBinding`.

- [ ] **Step 7: Implement the pure binding and verifier**

`decisionCore()` must return exactly:

```js
({
  schema,
  schema_version,
  decision,
  reasons,
  scores,
  next,
  claim_scope,
})
```

`buildDecisionBinding()` must emit `aesthete.binding/v1`, `sha256`, the explicit non-authenticity integrity label, completeness, artifact/contract/action inputs, policy, `policy_sha256`, and `decision_core_sha256`.

`validateReceiptV1Shape()` is code-defined and version-pinned. It validates:

- base decision required fields and enum;
- either neither extension or both extensions;
- exact receipt/claim schemas;
- lowercase 64-hex digests;
- all nested required properties and no unknown nested receipt properties;
- decision/action coherence (`fix_geometry` requires bound action, other decisions require `not_required`);
- stored policy/core internal digests.

`verifyDecisionBinding()` must select status by:

```text
base invalid → unbound → extension/internal invalid → incomplete → stale → current
```

Return issues only from the selected highest-precedence class. Use these
stable class-local code orders:

```text
invalid:
  BASE_SCHEMA_INVALID, EXTENSION_PAIR_INVALID, RECEIPT_SCHEMA_INVALID,
  MANIFEST_PATH_INVALID, POLICY_DIGEST_MISMATCH, CORE_DIGEST_MISMATCH,
  ACTION_INTERNAL_MISMATCH
unbound:
  RECEIPT_UNBOUND
incomplete:
  ARTIFACT_UNREADABLE
stale:
  ARTIFACT_CHANGED, CONTRACT_CHANGED, ACTION_CHANGED, POLICY_CHANGED,
  MANIFEST_FILE_MISSING, MANIFEST_FILE_ADDED, MANIFEST_FILE_CHANGED
```

It must compare current artifact/contract/policy/action values and manifest
comparison results without rerunning the evaluator. `checked` uses the exact
order `decision_core_sha256`, `artifact.sha256`, `contract.status`,
`contract.sha256`, `action_inputs`, `policy_sha256`; skipped checks do not
appear.

- [ ] **Step 8: Add failing mutable decision-schema integration tests**

Before editing the mutable schema, add integration cases proving a paired
receipt is rejected until `$defs` exist, a legacy unbound decision remains
valid, and a later current `decision.schema.json` byte change yields `stale`
only after the code-pinned validator accepts the stored v1. Run:

```bash
bun test test/skill-receipt-core.test.mjs test/skill-surface.test.mjs
```

Expected: assertion RED for the missing strict nested schema and/or pinned
shape cases; record the exact assertion, not a fixture syntax error.

- [ ] **Step 9: Extend decision.schema.json without breaking legacy v1**

Add strict `$defs` for claim scope, binding, manifests, runtime, and action inputs. Keep outer `additionalProperties: true`, make every receipt descendant `additionalProperties: false`, and use:

```json
"dependentRequired": {
  "binding": ["claim_scope"],
  "claim_scope": ["binding"]
}
```

Keep both extensions optional so old decisions remain valid. New-emission tests in Task 5 enforce their presence.

- [ ] **Step 10: Run core/schema and existing decision tests**

Run:

```bash
bun test test/skill-receipt-core.test.mjs test/skill-surface.test.mjs
```

Expected: all pass; legacy `foldDecision()` output still validates as unbound v1.

- [ ] **Step 11: Commit Task 3**

```bash
git add lib/skill-receipt-core.mjs schemas/decision.schema.json test/skill-receipt-core.test.mjs
git commit -m "feat: add decision receipt model"
```

---

### Task 4: Exact Geometry-Fix Action Binding

**Files:**
- Create: `lib/skill-action.mjs`
- Create: `test/skill-action.test.mjs`
- Create: `test/helpers/pptx-fixture.mjs`
- Modify: `lib/fix.mjs`
- Modify: `test/cli.test.mjs`

**Interfaces:**
- Consumes: normalized artifact/contract snapshots, runtime, effective adapter/slide/profile.
- Produces: `buildFixAction(input) -> { command, action_inputs }`, `parseFixAction(command)`, `verifyFixAction(decision, current)`, `ActionParseError`.

#### Task 4 adversarial-plan amendment

This subsection is normative. `ActionParseError` always has stable code
`ACTION_GRAMMAR_INVALID`; every parser grammar failure uses that class.
Malformed `buildFixAction()` or `verifyFixAction()` current input throws the
existing `ReceiptCurrentInputError/CURRENT_INPUT_INVALID`. A malformed stored
command never escapes as an input exception from verification: it becomes
`{ status: 'invalid', issues: [{ code: 'ACTION_INTERNAL_MISMATCH' }] }`.

The command grammar is positional and order-exact:

```text
absolute-normalized-executable
absolute-normalized-skill-root/lib/fix.mjs
absolute-normalized-artifact
--contract absolute-normalized-contract
--domain supported-adapter
[--slide positive-base10-integer]
[--profile non-empty-string]
```

`--slide` is mandatory for `pptx` (including effective default slide `1`) and
forbidden for every other adapter. `--profile`, when present, is last.
Reordered flags, alternate numeric spellings, duplicate flags, empty values,
unknown flags, or extra operands are grammar errors. The canonical positive
integer spelling is `/^[1-9][0-9]*$/`; `01`, `+1`, `1.0`, exponent notation,
zero, and fractions are rejected.

`buildFixAction()` lexically normalizes all four locators with
`path.resolve()`, requires a supported adapter, requires a positive integer
slide exactly for PPTX and `null` otherwise, and requires profile to be
`null` or a non-empty string. It emits the exact command above and an exact
full `action_inputs.status === 'bound'` object. Locator digests hash the UTF-8
bytes of the emitted normalized strings; `contract_sha256` hashes the
supplied action-contract bytes.

`verifyFixAction()` first requires a `fix_geometry/run_fix_p0` decision and a
full bound `action_inputs` object. It parses `next.fix_cmd`, rebuilds the
locator/option projection from the parsed command, and compares every
command-derived field to the stored action input. `contract_sha256` has no
command operand from which it can be recomputed; its stored shape is already
checked by the Task 3 pinned validator. Verification then builds the full
current action from the supplied current contract bytes and compares every
stored field, including `contract_sha256`. Internal mismatch wins over stale;
each selected result contains exactly one stable action issue.

Add RED cases for exact output keys, input immutability, lexical
normalization, every supported adapter, PPTX default/explicit slide,
non-PPTX slide rejection, every noncanonical slide spelling, all missing,
duplicate, reordered, and extra tokens, stored content-digest shape,
malformed current input, simultaneous internal/current mismatch precedence,
and changes to each current locator/option/content field.

- [ ] **Step 1: Write failing exact-command and CWD-independence tests**

```js
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
  contractBytes: Buffer.from('{"schema_version":1}'),
  adapter: 'pptx',
  slide: 2,
  profile: 'strict',
};

test('fix action is absolute and carries explicit contract/domain/slide/profile', () => {
  const built = buildFixAction(actionFixture);
  expect(built.command).toEqual([
    '/opt/bun/bin/bun',
    '/opt/aesthete/lib/fix.mjs',
    '/work/deck.pptx',
    '--contract', '/work/contract.json',
    '--domain', 'pptx',
    '--slide', '2',
    '--profile', 'strict',
  ]);
  expect(built.action_inputs.contract_sha256).toBe(sha256Bytes(Buffer.from('{"schema_version":1}')));
});

test('parsing an action does not depend on process cwd', () => {
  const parsed = parseFixAction(absoluteCommand);
  expect(parsed.artifactPath).toBe('/work/deck.pptx');
  expect(parsed.contractPath).toBe('/work/contract.json');
  expect(parsed.adapter).toBe('pptx');
  expect(parsed.slide).toBe(2);
});

test('relative/bare/missing/duplicate/extra action operands are invalid', () => {
  expect(() => parseFixAction(['bun', '/opt/aesthete/lib/fix.mjs', '/work/a.json']))
    .toThrow(/absolute executable/i);
  expect(() => parseFixAction(['/opt/bun', 'lib/fix.mjs', '/work/a.json']))
    .toThrow(/absolute script/i);
  expect(() => parseFixAction([...absoluteCommand, '--profile', 'again']))
    .toThrow(/duplicate.*profile/i);
  expect(() => parseFixAction(absoluteCommand.filter((x) => x !== '--contract')))
    .toThrow(/contract|grammar/i);
  expect(() => parseFixAction([...absoluteCommand, '--unknown', 'x']))
    .toThrow(/unknown|extra/i);
  expect(() => parseFixAction([...absoluteCommand, 'extra']))
    .toThrow(/extra/i);
  expect(() => parseFixAction([
    ...absoluteCommand.slice(0, 5), 'relative.json', ...absoluteCommand.slice(6),
  ])).toThrow(/absolute contract/i);
});

test('action verification separates internal invalid from current-input stale', () => {
  const built = buildFixAction(actionFixture);
  const decision = {
    decision: 'fix_geometry',
    next: { action: 'run_fix_p0', fix_cmd: built.command },
    binding: { action_inputs: built.action_inputs },
  };
  expect(verifyFixAction(decision, actionFixture)).toEqual({ status: 'current', issues: [] });
  const edited = structuredClone(decision);
  edited.next.fix_cmd[2] = '/work/other.pptx';
  expect(verifyFixAction(edited, actionFixture).issues[0].code)
    .toBe('ACTION_INTERNAL_MISMATCH');
  expect(verifyFixAction(decision, {
    ...actionFixture,
    contractBytes: Buffer.from('changed'),
  }).issues[0].code).toBe('ACTION_CHANGED');
});
```

Add table-driven grammar cases for every missing flag/value, every duplicated flag, invalid
domain, zero/fractional slide, `--slide` on non-PPTX, misplaced flags, and
extra operands. Each row must assert the stable parse error code rather than
only a broad regex.

- [ ] **Step 2: Run and observe RED**

Run:

```bash
bun test test/skill-action.test.mjs
```

Expected: FAIL because `lib/skill-action.mjs` does not exist.

- [ ] **Step 3: Implement exact action construction/parsing/verification**

Use `path.resolve()` for lexical absolute normalization and `sha256Bytes(Buffer.from(path, 'utf8'))` for locator digests. The parser must accept only the grammar from the design spec and return typed fields. `verifyFixAction()` must:

1. parse stored `next.fix_cmd`;
2. compare every stored operand/option to `binding.action_inputs` and return `invalid` issues for internal mismatch;
3. compare executable/script/artifact/contract locators, action contract bytes, adapter, slide, and profile to current values and return `stale` issues for freshness mismatch.

When post did not evaluate a contract, Task 5 supplies a separately snapshotted and strictly validated `<skill-root>/examples/catalog.contract.json`; `buildFixAction()` itself never silently chooses a default.

- [ ] **Step 4: Run action tests and observe GREEN**

Run:

```bash
bun test test/skill-action.test.mjs
```

Expected: all action tests pass.

- [ ] **Step 5: Add a failing real fix CLI slide-threading test**

Create `makeTwoSlideDeck()` in `test/helpers/pptx-fixture.mjs`. It must call
the existing `writeZip()` and include `[Content_Types].xml`,
`ppt/presentation.xml`, `ppt/_rels/presentation.xml.rels`, and two slide XML
parts. Every shape has a valid `a:xfrm` with positive extents and matching
visible `<a:t>` text. Slide 1 contains only `SLIDE_ONE_ONLY`; slide 2
contains `SLIDE_TWO_A` and `SLIDE_TWO_B`. Export only the helper.

Extend `test/cli.test.mjs`, build that deck, and execute:

```js
run('fix.mjs', [
  deckPath,
  '--contract', contractPath,
  '--domain', 'pptx',
  '--slide', '2',
  '--profile', 'strict',
  '--out', fixedPath,
], tempDir);
```

The current exporter intentionally emits a one-slide PPTX. Import the fixed
output's only slide with `importPath(fixedPath, { domain: 'pptx', slide: 1
})`; assert it contains `SLIDE_TWO_A` and `SLIDE_TWO_B` and excludes
`SLIDE_ONE_ONLY`. Do not add multi-slide preservation to this task. This
observes that fix imported source slide 2 without relying on a nonexistent
log field.

- [ ] **Step 6: Run the one CLI test and observe RED**

Run:

```bash
bun test test/cli.test.mjs --test-name-pattern "fix --slide"
```

Expected: FAIL because `lib/fix.mjs` does not pass `flags.slide` to `importPath()`.

- [ ] **Step 7: Thread a strict positive slide through fix.mjs**

Normalize `flags.slide` once:

```js
const slide = flags.slide == null ? undefined : Number(flags.slide);
if (slide != null && (!Number.isInteger(slide) || slide < 1)) {
  throw new Error('--slide must be a positive integer');
}
const alt = domain === 'alt'
  ? readJson(inputPath)
  : importPath(inputPath, { domain, ...(slide == null ? {} : { slide }) });
```

Do not change fixer formulas, output enum, or default output paths.

- [ ] **Step 8: Run focused action/fix tests**

Run:

```bash
bun test test/skill-action.test.mjs test/cli.test.mjs
```

Expected: all pass.

- [ ] **Step 9: Commit Task 4**

```bash
git add lib/skill-action.mjs lib/fix.mjs test/skill-action.test.mjs \
  test/helpers/pptx-fixture.mjs test/cli.test.mjs
git commit -m "fix: bind geometry action inputs"
```

---

### Task 5: Single-Snapshot Post and Gate Receipt Emission

#### Task 5 adversarial-plan amendment

This subsection is normative and resolves orchestration ambiguities before
Task 5 implementation.

`runPost(inputPath, opts)` accepts only this dependency surface:

```js
opts.deps = {
  io,          // optional base { readFile(absolutePath) }; wrapped once
  root,        // optional skill root; default skillRoot()
  runtime,     // optional process-like runtime; default process
  loadAjv,     // optional createRunValidator loader seam
}
```

The root is lexically normalized once. The runtime supplies both the
`captureRuntime()` input and the executable locator used by
`buildFixAction()`; a supplied runtime therefore requires a non-empty
absolute-normalizable `execPath`, with failures mapped to
`ReceiptInputError/BUN_REQUIRED`. Unit tests may use these seams, while real
process tests must run copied entry points and must not inject around the
public CLI.

Normalize public flags exactly once before snapshots or policy construction.
An absent slide becomes `undefined`; a supplied CLI string must match
`/^[1-9][0-9]*$/` and convert to a safe positive integer. Unit callers may
supply a safe positive integer directly. Every other slide value throws
`ReceiptInputError/SLIDE_INVALID`. A requested contract must be a non-empty
string; a missing flag operand or invalid requested-contract locator throws
`ReceiptInputError/CONTRACT_INPUT_INVALID`. Profile, structure, and artifact
type use the same string-or-null rules as `normalizePostPolicy()`; profile
also rejects values beginning with `--` so policy normalization cannot
accept an input that exact action construction rejects.

The operation order is exact:

```text
normalize root/runtime/flags and create one operation I/O cache
capture Bun runtime
capture all schemas and construct the mandatory run-local validator
capture installation manifest
resolve effective params unconditionally
resolve effective tokens iff lint is enabled
snapshot, strict-parse, and schema-validate a requested contract
snapshot the artifact
import only the captured bytes and schema-validate ALT
measure/scan/evaluate only captured or injected values
validate the measured report with the captured validator
construct one fold-input object and call foldDecision exactly once without fixCmd
attach claim_scope from that exact fold-input object
if and only if the folded decision is fix_geometry:
  reuse the requested contract snapshot, or capture/validate the default action contract
  build the exact action and assign decision.next.fix_cmd
build binding after the final next object exists
strict-validate the complete emitted decision
```

Params are resolved even for unreadable or readable-invalid artifacts because
the receipt still records the selected policy. Tokens are resolved and bound
when lint was requested even if ALT import later fails; with lint disabled,
the token file is not read and `tokens_sha256` is `null`. Measurement receives
the exact resolved params object, and lint receives the exact resolved token
object.

The first fold deliberately has no `fixCmd`; a transient `fix_geometry`
decision therefore lacks `next.fix_cmd`. Do not fold twice and do not read the
default action contract speculatively. Only after the branch is known may
post snapshot the action contract, build the command, and assign
`decision.next.fix_cmd`; `buildDecisionBinding()` and final strict validation
run only after that mutation, so `decision_core_sha256` covers the final exact
command.

Requested contracts are strict-parsed and schema-validated at their boundary;
all read, parse, and schema failures map to
`ReceiptInputError/CONTRACT_INPUT_INVALID`. If the same requested snapshot is
needed by a fix action, reuse that snapshot object without another read or
parse. The default action contract is read only for `fix_geometry`; its read,
strict-parse, or schema failure is rethrown as
`ReceiptInputError/ACTION_CONTRACT_INVALID`. The decision binding's
`contract` member describes only the requested evaluation contract, while
`action_inputs.contract_sha256` describes the requested-or-default action
contract actually named by `fix_cmd`.

For native ALT input, use `parseJsonStrict(artifactSnapshot.bytes, 'artifact')`
so duplicate-key or non-I-JSON content becomes a readable import failure with
a complete artifact binding. Other adapters use `importBuffer()` with the
captured bytes and effective slide. Only artifact read/import/ALT-schema
failures enter the existing `IMPORT_FAIL` fold; dependency, contract, policy,
report-schema, binding, and final-decision validation failures emit no
decision. Internal construction/validation defects remain ordinary errors
and map to exit `1`, never to a fabricated input code.

`receiptInputExitCode(error)` returns `2` only for `ReceiptInputError` and `1`
otherwise. Both CLI entry points catch before writing any result file, print
exactly `${error.code}: ${error.message}` for typed errors, keep stdout empty,
and use this mapper. Post retains its existing successful-evaluation exit
behavior, including exit `1` for an emitted `IMPORT_FAIL`; gate retains the
decision exit fold. Gate must also preserve output parity by writing a
returned slop report when present.

Real process fixtures live outside the repository ancestry so an
AJV-unavailable case cannot accidentally resolve the real repository's
`node_modules`. Copy only the repository material required by the entry
points, use a `node_modules` link only in cases that require installed AJV,
and mutate only the copy. Each process row supplies a unique absolute output
directory and asserts no report, decision, slop, contract, structure, vuln,
or requested output file exists after a typed failure. A created empty output
directory is permitted.

Add RED coverage for the exact operation order and seams: unreadable artifact
still binds params and lint-enabled tokens; lint-disabled execution does not
read tokens; `fix_geometry` assigns the action before hashing the decision
core; a pass does not read a missing default action contract; requested
contract reuse has one base read; requested/default contract schema failures
use their distinct stable codes; valid canonical CLI slide strings reach the
effective PPTX slide; noncanonical strings fail; and profile values beginning
with `--` fail at policy input normalization.

**Files:**
- Modify: `lib/skill-post.mjs`
- Modify: `lib/skill-gate.mjs`
- Modify: `lib/skill-snapshot.mjs`
- Modify: `lib/measure.mjs`
- Modify: `lib/skills/proximity.mjs`
- Modify: `lib/tokens.mjs`
- Modify: `test/skill-surface.test.mjs`
- Modify: `test/slop-integration.test.mjs`
- Modify: `test/skill-snapshot.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–4 APIs.
- Produces: every successful `runPost()` decision has paired `claim_scope` and `binding`; readable import/schema failures can be complete, unreadable artifacts are incomplete.

- [ ] **Step 1: Add failing post-emission, read-once, and behavior-preservation tests**

For every new filesystem case, set `tempDir = fs.mkdtempSync(path.join(
os.tmpdir(), 'aesthete-receipt-post-'))` in `beforeEach` and remove it with
`fs.rmSync(tempDir, { recursive: true, force: true })` in `afterEach`.

```js
test('post: good artifact emits a complete receipt and narrow pass claim', async () => {
  const { decision } = await runPost(goodPath, { flags: {} });
  expect(decision.decision).toBe('pass');
  expect(decision.claim_scope.pass_means).toBe('no_enabled_blocking_rule_triggered');
  expect(decision.binding.schema).toBe('aesthete.binding/v1');
  expect(decision.binding.completeness).toBe('complete');
  expect(decision.binding.artifact.sha256).toBe(sha256Bytes(fs.readFileSync(goodPath)));
  expect(decision.binding.decision_core_sha256).toBe(sha256Json(decisionCore(decision)));
});

test('post: bad geometry keeps fix_geometry and emits a bound absolute action', async () => {
  const { decision } = await runPost(badPath, { flags: {} });
  expect(decision.decision).toBe('fix_geometry');
  expect(decision.binding.action_inputs.status).toBe('bound');
  expect(parseFixAction(decision.next.fix_cmd)).toEqual({
    executable: process.execPath,
    scriptPath: path.join(root, 'lib', 'fix.mjs'),
    artifactPath: path.resolve(badPath),
    contractPath: path.join(root, 'examples', 'catalog.contract.json'),
    adapter: 'alt',
    slide: null,
    profile: null,
  });
});

test('post: structure unknown and P0-only contract failure retain current pass semantics', async () => {
  const unknown = await runPost(goodPath, { flags: { structure: 'does-not-exist' } });
  expect(unknown.decision.decision).toBe('pass');
  expect(unknown.decision.claim_scope.rules.structure_signature.coverage_behavior)
    .toBe('unknown_is_nonblocking');
  const p0OnlyFailingContractPath = path.join(tempDir, 'p0-only.contract.json');
  fs.writeFileSync(p0OnlyFailingContractPath, JSON.stringify({
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
    flags: { contract: p0OnlyFailingContractPath },
  });
  expect(p0Only.decision.decision).toBe('pass');
  expect(p0Only.decision.claim_scope.rules.contract_criteria.coverage_behavior)
    .toBe('p0_only_contract_failure_is_nonblocking_in_contract_branch');
});

test('post: unreadable versus readable-invalid artifact receipts differ in completeness', async () => {
  const unreadable = await runPost(path.join(tempDir, 'missing.layout.json'), { flags: {} });
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
    artifact: { status: 'bound', sha256: sha256Bytes(fs.readFileSync(invalidPath)) },
  });
});
```

In a temporary directory, add a TOCTOU test with the real reader wrapped:

```js
const reads = new Map();
const readFile = (p) => {
  const bytes = fs.readFileSync(p);
  reads.set(p, (reads.get(p) || 0) + 1);
  if (p === htmlPath && reads.get(p) === 1) {
    fs.writeFileSync(p, '<html><h1>changed after snapshot</h1></html>');
  }
  return bytes;
};
const result = await runPost(htmlPath, {
  flags: { slop: true },
  deps: { io: { readFile } },
});
expect(reads.get(htmlPath)).toBe(1);
expect(result.slopReport.findings.some((f) => f.id === 'slop.palette.gradient')).toBe(true);
```

Add these counters before implementation:

- requested contract used by evaluation and the fix action: total read count
  `1`, with the same byte digest in `binding.contract` and
  `binding.action_inputs`;
- default action contract when no post contract was requested: count `1`;
- each schema file: count `1`;
- artifact whose path is also the action artifact: count `1`.

Add one custom proximity-params fixture whose `ALPHA` changes the measured
`meanGroupP`; assert the report reflects that value and
`binding.policy.params_sha256` hashes the same injected object. Add one
custom token fixture with lint enabled; assert `lintResult` reflects it and
the policy hashes the same token object. With lint disabled, mutate tokens
and assert the policy records `tokens_sha256: null`.

Mutate each file after its first read. Assert evaluator/importer/action
digests all reflect the first buffer, never the mutated file. Add a literal
mixed slop report containing P0, P1, P2, and P0-unmeasured entries; assert
the existing exclusive fold chooses P0 regenerate and omits the P2 advisory
reason while claim scope records branch order.

Add real post **and** gate process RED cases for all eight codes before
changing their catch blocks:

| Code | Process induction |
|---|---|
| `DOMAIN_INVALID` | `--domain unsupported-domain` |
| `SLIDE_INVALID` | PPTX with `--slide 0` |
| `CONTRACT_INPUT_INVALID` | duplicate-key requested contract |
| `ACTION_CONTRACT_INVALID` | fixable artifact in a temp copy whose default contract is missing |
| `SCHEMA_INPUT_INVALID` | temp copy with malformed `schemas/alt.schema.json` |
| `INSTALLATION_INPUT_INVALID` | temp copy with `bun.lock` absent |
| `AJV_REQUIRED` | temp copy without installed AJV resolution |
| `BUN_REQUIRED` | spawn both entry points with `node`, not Bun |

For every row and both applicable entry points assert: exit `2`, stdout
exactly empty, stderr names the stable code, no `decision.json`, no report
files, and no requested output file. Unit-injected dependency cases remain
in addition to these process cases; they do not substitute for them.

All CLI cases operate in a temporary repository copy or use dependency
injection; they never delete or rewrite the real lockfiles/configuration.

- [ ] **Step 2: Run and observe RED**

Run:

```bash
bun test test/skill-surface.test.mjs test/skill-snapshot.test.mjs test/slop-integration.test.mjs
```

Expected: FAIL because current decisions lack `claim_scope` and `binding`, and current path-based reads bypass the one-snapshot dependency.

- [ ] **Step 3: Refactor measurement and lint to consume injected resources**

Change proximity to:

```js
const params = opts.params || loadParams(opts.profile);
const { ALPHA, RANG_RATIO, FRAG_FACTOR, SIM_THRESHOLD } = params.proximity;
```

`measureAlt()` already threads `opts`; do not add another read. Continue allowing legacy callers to pass only `profile`.

Keep `lint(alt, { tokens })` as the injection seam. `runPost()` must call it with the resolved snapshot rather than calling `lint(alt)` and triggering `loadTokens()`.

- [ ] **Step 4: Implement receipt-aware `runPost()` orchestration**

Create a fold-input object once and use it for both `foldDecision()` and `buildClaimScope()`.

Sequence:

```text
capture runtime/schema/installation
create run-local strict validator
snapshot requested contract once; strict-parse and validate
snapshot artifact once
importBuffer(snapshot.bytes, actual adapter, effective slide)
validate ALT with captured schemas
resolve/inject params and optional tokens
call normalizePostPolicy() exactly once with those captured resources
measure/scan/evaluate using in-memory values
fold unchanged decision
attach claim_scope
if fix_geometry, snapshot requested-or-default action contract and build exact action
attach binding and strict-validate emitted decision
return existing reports/paths plus receipt decision
```

For HTML slop, use `artifactSnapshot.bytes.toString('utf8')`; remove the second `fs.readFileSync(inputPath)`.

For ALT JSON artifact import, parse the captured buffer; do not call `readJson(inputPath)`.

For requested contract evaluation, use the captured parsed object; do not call `readJson(flags.contract)`.

An unreadable artifact produces the existing `IMPORT_FAIL` fold with `completeness: 'incomplete'`. A readable parse/schema failure produces `IMPORT_FAIL` with bound bytes and `completeness: 'complete'`. Contract, AJV, runtime, manifest, and action-contract dependency errors throw `ReceiptInputError` and emit no decision.

At entry, construct
`const io = createOperationIo(opts.deps?.io || DEFAULT_IO)` and pass this
same object to every artifact, requested/default contract, schema, config,
and manifest byte read. Its normalized-absolute-path cache makes requested-
contract/action-contract aliasing and artifact/action aliasing reuse the same
`Buffer`.
`normalizePostPolicy()` output is assigned directly to `binding.policy`;
post may not hand-build a second policy object.

- [ ] **Step 5: Map dependency/input errors in post and gate**

Export:

```js
export const receiptInputExitCode = (error) =>
  error instanceof ReceiptInputError ? 2 : 1;
```

Use it in `skill-post.mjs` and `skill-gate.mjs` top-level catches. Preserve post successful-evaluation exit `0` and gate decision exits.
Every dependency named in the Step 1 table must be wrapped at its boundary
in a stable `ReceiptInputError`; do not rely on raw `ENOENT`, AJV, or JSON
errors matching `instanceof`. Typed catches write only
`${error.code}: ${error.message}` to stderr, keep stdout empty, and exit `2`
before writing any result file.

- [ ] **Step 6: Run post/read-once tests and observe GREEN**

Run:

```bash
bun test test/skill-surface.test.mjs test/skill-snapshot.test.mjs test/slop-integration.test.mjs
```

Expected: current branch tests, receipt assertions, mixed-slop branch assertions, and exact artifact/contract read counters pass.

- [ ] **Step 7: Run focused post/gate regressions**

Run:

```bash
bun test test/skill-surface.test.mjs test/skill-snapshot.test.mjs test/slop-integration.test.mjs test/slop-fp.test.mjs
```

Expected: all pass.

- [ ] **Step 8: Commit Task 5**

```bash
git add lib/skill-post.mjs lib/skill-gate.mjs lib/measure.mjs lib/skills/proximity.mjs lib/tokens.mjs test/skill-surface.test.mjs test/skill-snapshot.test.mjs test/slop-integration.test.mjs
git commit -m "feat: emit snapshot-bound decisions"
```

---

### Task 6: Strict Receipt Verifier CLI

**Files:**
- Create: `lib/skill-receipt.mjs`
- Create: `test/skill-receipt-cli.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: strict JSON, snapshot, action, and receipt-core APIs.
- Produces: `parseReceiptArgs(argv)`, `verifyReceiptFiles(input)`, real `receipt` CLI with statuses and exit codes.

- [ ] **Step 1: Write failing strict argument parser tests**

```js
test('receipt args accept one verify command, two positionals, and known flags', () => {
  expect(parseReceiptArgs([
    'verify', 'decision.json', 'artifact.svg',
    '--contract', 'contract.json', '--lint', '--slide', '2',
  ])).toEqual({
    command: 'verify',
    decisionPath: 'decision.json',
    artifactPath: 'artifact.svg',
    flags: { contract: 'contract.json', lint: true, slide: 2 },
    outPath: null,
  });
});

for (const argv of [
  ['verify', 'd.json', 'a.svg', '--typo'],
  ['verify', 'd.json', 'a.svg', '--lint', '--lint'],
  ['verify', 'd.json', 'a.svg', '--contract'],
  ['verify', 'd.json', 'a.svg', '--slide', '0'],
  ['verify', 'd.json', 'a.svg', '--lint', 'false'],
  ['verify', 'd.json', 'a.svg', 'extra'],
]) {
  test(`receipt args reject ${JSON.stringify(argv)}`, () => {
    expect(() => parseReceiptArgs(argv)).toThrow(/usage|unknown|duplicate|value|slide|positional/i);
  });
}
```

- [ ] **Step 2: Run and observe RED**

Run:

```bash
bun test test/skill-receipt-cli.test.mjs
```

Expected: FAIL because `lib/skill-receipt.mjs` does not exist.

- [ ] **Step 3: Implement the strict allowlist parser**

Value flags: `contract`, `domain`, `slide`, `profile`, `structure`, `type`, `out`.

Presence-only flags: `lint`, `vuln`, `vuln-gate`, `slop`, `slop-gate`, `slop-autofix`, `human-on-unfixable`.

Reject duplicates, unknown names, missing values, boolean values, extra positionals, unsupported domain, and non-positive/non-integer slide. Do not reuse permissive `parseArgs()`.

- [ ] **Step 4: Run parser tests and observe GREEN**

Run:

```bash
bun test test/skill-receipt-cli.test.mjs
```

Expected: parser cases pass.

- [ ] **Step 5: Add failing real-process current/stale/unbound/incomplete/invalid tests**

First add `verifyReceiptFiles(input, { io })` unit tests with a counted reader.
The reader mutates each path immediately after returning its first buffer.
Assert:

- decision, artifact, requested/default action contract, every schema path,
  every installation-manifest path, effective params, and lint-enabled tokens
  are read once through the same counted operation reader;
- when requested contract and action contract resolve to the same path, total
  contract reads remain `1`;
- digest comparison uses the first buffer after mutation;
- malformed base, unbound, and partial-extension receipts invoke no artifact,
  contract, schema, installation, config, or action reads;
- invalid+incomplete+stale returns only invalid issues;
- incomplete+stale returns only incomplete issues;
- `checked` is exactly the ordered subset defined in Task 3.

Add a table that starts from a real current decision and changes one current
input at a time:

| Change | Expected |
|---|---|
| artifact bytes | `stale/ARTIFACT_CHANGED` |
| requested or default action-contract bytes | `stale/CONTRACT_CHANGED` or `ACTION_CHANGED` |
| adapter / cross-extension override | `stale/POLICY_CHANGED` |
| PPTX omitted slide vs explicit `1` | `current` |
| PPTX effective slide `2` | `stale/POLICY_CHANGED` and actionable `ACTION_CHANGED` |
| profile, structure, type, or any boolean flag | `stale/POLICY_CHANGED` |
| resolved params or lint-on tokens | `stale/POLICY_CHANGED` |
| lint-off token-file change | `current` |
| schema byte/addition/deletion | `stale` with manifest issue |
| installation byte/addition/deletion | `stale` with manifest issue |
| validator version or runtime field | `stale/POLICY_CHANGED` |
| pass artifact relocation with identical bytes/adapter | `current` |
| fix artifact relocation | `stale/ACTION_CHANGED` |

Then use `spawnSync(process.execPath, [receiptScript, ...args])`. Generate a
real current decision with `runPost()`, then assert:

| Fixture | Expected stdout | Exit |
|---|---|---:|
| unchanged decision/artifact/policy | `receipt status=current issues=0` | 0 |
| changed artifact byte | `receipt status=stale issues=1` | 1 |
| legacy valid v1 without extensions | `receipt status=unbound issues=1` | 2 |
| well-formed unreadable-artifact receipt | `receipt status=incomplete issues=1` | 2 |
| changed decision core without rebinding | `receipt status=invalid issues=1` | 2 |

Also assert `--out verify.json` writes `aesthete.receipt-verification/v1` with stable `issues` and `checked` arrays.

Add process cases for a real actionable command:

- run the emitted absolute command from a different temporary CWD and assert
  it consumes the same artifact, explicit requested/default contract,
  domain, effective slide, and profile;
- default and explicit PPTX slide `1` are equivalent; slide `2` is stale;
- changed profile/domain/cross-extension adapter/default-contract bytes are
  stale;
- invalid stored grammar variants from Task 4 verify `invalid`.

Add usage/input process cases for unknown/duplicate/missing-value flags,
invalid boolean and slide, extra positional, invalid decision JSON, and
unreadable decision. Every case asserts exit `2`, empty stdout, no
verification `--out`, and no post/gate decision side effect.

Repeat the Task 5 eight-code matrix at the verifier boundary using a stored
receipt that reaches the relevant current-input check. Spawn with Node for
`BUN_REQUIRED`; use temp repository copies for AJV, schema, installation, and
default-action-contract faults. For each code assert exit `2`, stdout exactly
empty, stderr names the code, `--out` is absent, and no decision/report file
is created.

Add one package-surface RED that invokes `bun run receipt -- verify ...`;
before Step 8 it must fail specifically because the script is absent, then
the identical assertion must pass after the script is added.

- [ ] **Step 6: Run process tests and observe RED**

Run:

```bash
bun test test/skill-receipt-cli.test.mjs
```

Expected: FAIL because verifier main/exit/output behavior is missing.

- [ ] **Step 7: Implement `verifyReceiptFiles()` and CLI main**

Sequence:

```text
construct one createOperationIo(deps.io || DEFAULT_IO) at function entry
strict-read decision once with parseJsonStrict from that same io.readFile()
pinned-v1 shape check before mutable current schema use
if unbound, return without snapshotting installation
pass that same io explicitly to every artifact/contract/action snapshot helper
pass that same io explicitly to schema/installation/params/tokens capture helpers
snapshot current artifact/contract/action inputs once through that io
capture current runtime/schema/installation/config policy through that io
call normalizePostPolicy() rather than reconstructing policy fields
compare without evaluator replay
print one status line
write --out JSON when requested
exit current=0, stale=1, all other/usage/input=2
```

Usage/input catches write only the stable code and message to stderr, keep
stdout empty, remove no pre-existing file, create no new `--out`, and exit
`2`. Status results—not exceptions—print the one concise stdout line.

No verifier helper may rely on its `DEFAULT_IO` parameter default after the
operation-local `io` is created. The counted-reader RED mutates decision,
artifact, aliased contracts, one schema, one installation file, params, and
lint-enabled tokens after the first read, then proves every comparison and
policy digest uses the first cached `Buffer`.

Verification manifest capture validates the stored expected paths, then
rediscovers the full current allowlisted namespace and compares the path
union so deleted and added files are both `stale`. A malformed stored
manifest path is `invalid`.

- [ ] **Step 8: Add the package script and run all verifier tests**

Add:

```json
"receipt": "bun lib/skill-receipt.mjs"
```

Run:

```bash
bun test test/skill-receipt-cli.test.mjs
```

Expected: all parser and process tests pass.

- [ ] **Step 9: Run real post/gate process regressions**

Retain the Task 5 process cases while asserting:

- post valid evaluation still exits `0` and writes a receipt decision;
- gate `pass=0`, `fix_geometry|regenerate=1`, `human=2`;
- forced dependency/input error maps to `2` and writes no decision;
- actionable command is absolute and its default action-contract byte change verifies stale.

Implement the dependency/input process case by invoking post with
`--domain unsupported-domain`; assert stderr names the unsupported domain,
exit status is `2`, and neither the requested decision path nor its parent
receipt files exist.

Run:

```bash
bun test test/skill-receipt-cli.test.mjs test/cli.test.mjs
```

Expected: all pass.

- [ ] **Step 10: Commit Task 6**

```bash
git add lib/skill-receipt.mjs test/skill-receipt-cli.test.mjs package.json
git commit -m "feat: verify decision receipt freshness"
```

---

### Task 7: Skill and Integration Documentation with Behavioral RED/GREEN

**Files:**
- Modify: `SKILL.md`
- Modify: `skills/aesthete-post/SKILL.md`
- Modify: `skills/aesthete-gate/SKILL.md`
- Modify: `docs/agent-llm-usage.md`
- Modify: `docs/integration/generator-contract.md`
- Modify: `README.md`
- Modify: `README.ko.md`
- Modify: `docs/superpowers/plans/2026-07-27-snapshot-bound-decision-receipts-execution.md`

**Interfaces:**
- Consumes: shipped `post`, `gate`, and `receipt` commands.
- Produces: agent behavior that verifies stored decisions before acting and interprets `pass` as only “no enabled blocking rule triggered.”

- [ ] **Step 1: Run five no-new-guidance baseline samples per skill surface before editing skill docs**

For each surface `root`, `post`, and `gate`, and `N=1..5`, run a fresh
fixed-model process. This command shows `root`; substitute the exact surface
file path and output name for the other two:

```bash
rtk codex exec \
  -C "/mnt/d/DEV/acc0mplish/KLIC-Aesthete" \
  -m gpt-5.6-terra \
  -c 'model_reasoning_effort="high"' \
  -s read-only \
  -o "/tmp/aesthete-receipt-skill-root-baseline-${N}.txt" \
  "Read only SKILL.md as the Aesthete instruction surface; do not inspect implementation code or other docs. A stored POST/decision.json says pass, then artifact bytes changed. Recover the exact command that verifies whether this stored decision is current, name every possible verifier status, and state whether shipment is allowed. A fresh post is safe operationally but does not count as recovering the requested verifier command/status contract."
```

For `post`, read only `skills/aesthete-post/SKILL.md`; for `gate`, read only
`skills/aesthete-gate/SKILL.md`. Score each raw output manually:

- retrieval failure: does not give the exact receipt verifier command or all
  `current|stale|unbound|incomplete|invalid` statuses; suggesting only a fresh
  post remains a failure for this scenario;
- safety failure: authorizes shipment from stored `pass` without a current
  receipt or fresh post;
- scope failure: describes `pass` as semantic/render/native/human approval.

Record all 15 output paths, the three category scores, and exact failing
rationalizations in the execution-notes file before editing any skill file.

- [ ] **Step 2: Select guidance form from observed baseline**

Observable branch:

- If one or more retrieval samples fail, add a structural required slot to
  that surface: “stored decision → exact receipt verify → branch only on
  `current`”; address only observed rationalizations.
- If all five samples for a surface already retrieve the exact new command
  and statuses, record that no retrieval guidance change is justified there.
  Update only mechanically required command/reference text and the narrow
  `pass` definition, then forward-test it.

This branch follows `superpowers:writing-skills`: the baseline failure shape determines the guidance form.

- [ ] **Step 3: Update skill and integration surfaces minimally**

Required content:

```bash
bun lib/skill-receipt.mjs verify POST/decision.json ART \
  --contract PRE/contract.json \
  [the same post evaluation flags]
```

Required rule:

```text
current = stored decision core matches its stored digest and current bound
inputs/config/schema/runtime/on-disk installation match.
It is not authenticity, provenance, executed-code identity, or correctness.
pass = no enabled blocking rule triggered.
```

Update action guidance:

- execute emitted absolute `next.fix_cmd` without rewriting its bound input flags;
- verifier `stale` requires a fresh post, never manual rebinding as an approval shortcut;
- `unbound|incomplete|invalid` requires fresh post or escalation;
- retain decision non-override and fix→post loop rules.

Keep skill frontmatter triggers concise and do not summarize the whole workflow in descriptions.

Replace hard-coded test totals in both README surfaces with non-numeric
wording such as `bun run test → passing suite`; numeric test totals are not a
stable interface and must not be reintroduced.

- [ ] **Step 4: Run five fresh guided samples**

Repeat each surface's exact Step 1 prompt with outputs:

```text
/tmp/aesthete-receipt-skill-root-guided-1.txt through -5.txt
/tmp/aesthete-receipt-skill-post-guided-1.txt through -5.txt
/tmp/aesthete-receipt-skill-gate-guided-1.txt through -5.txt
```

Expected per surface: 5/5 recover the exact `skill-receipt.mjs verify`
contract and five statuses, 5/5 refuse shipment on stale/unverified input,
and 5/5 state the narrow pass boundary. A fresh-post-only answer fails
retrieval. Manually read every output; do not score by grep alone.

- [ ] **Step 5: Close only observed loopholes and rerun affected samples**

If a guided sample still misses command/status retrieval, authorizes stale
shipment, or treats `pass` broadly, add one observable-condition rule
addressing its exact rationale and rerun five fresh samples for that surface.
Do not add narrative history or hypothetical rules.

- [ ] **Step 6: Validate all skill folders**

Run:

```bash
python /home/aministrator/.codex/skills/.system/skill-creator/scripts/quick_validate.py .
python /home/aministrator/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/aesthete-post
python /home/aministrator/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/aesthete-gate
```

Expected: `Skill is valid!` three times.

- [ ] **Step 7: Run documentation command examples against temporary artifacts**

Execute post, receipt verify, and gate exactly as documented using files in `mktemp -d`. Confirm documented status lines and exit codes match the real CLIs. Human prose is not tested by source grep.

Run:

```bash
! rg -n '\b[0-9]+ pass\b' README.md README.ko.md
```

Expected: no numeric pass-count claim remains.

- [ ] **Step 8: Commit Task 7**

```bash
git add SKILL.md skills/aesthete-post/SKILL.md skills/aesthete-gate/SKILL.md docs/agent-llm-usage.md docs/integration/generator-contract.md README.md README.ko.md docs/superpowers/plans/2026-07-27-snapshot-bound-decision-receipts-execution.md
git commit -m "docs: teach receipt freshness boundaries"
```

---

### Task 8: Full Verification and Task 1 Adversarial Code Review

**Files:**
- Modify only files implicated by fresh failures or accepted review findings.
- Never add `AGENTS.md`.

**Interfaces:**
- Consumes: all Task 1 commits.
- Produces: fresh full-suite evidence and a Critical/Important-clean adversarial review.

- [ ] **Step 1: Run the complete fresh regression**

Run:

```bash
npm test
```

Expected: golden checks pass; Bun reports 0 failing tests.

- [ ] **Step 2: Run static and repository hygiene checks**

Run:

```bash
IMPLEMENTATION_BASE="$(git log -1 --format=%H -- docs/superpowers/plans/2026-07-27-snapshot-bound-decision-receipts.md)"
git diff --check "$IMPLEMENTATION_BASE"..HEAD
git status --short
git diff --name-only "$IMPLEMENTATION_BASE"..HEAD
git diff --name-only origin/main...HEAD
! git ls-files --error-unmatch AGENTS.md
```

Expected: no whitespace errors; status contains only user-owned
`?? AGENTS.md`; both changed-file lists match this plan; `AGENTS.md` is not
tracked.

- [ ] **Step 3: Run a fixed-model adversarial code review**

```bash
rtk codex exec \
  -C "/mnt/d/DEV/acc0mplish/KLIC-Aesthete" \
  -m gpt-5.6-sol \
  -c 'model_reasoning_effort="high"' \
  -s read-only \
  -o /tmp/aesthete-task1-code-review.txt \
  "Review Task 1 implementation after the plan commit (obtain it with: git log -1 --format=%H -- docs/superpowers/plans/2026-07-27-snapshot-bound-decision-receipts.md) to current HEAD against docs/superpowers/specs/2026-07-27-hash-bound-decision-evidence-design.md and docs/superpowers/plans/2026-07-27-snapshot-bound-decision-receipts.md. Do not mutate files or open the external visual-authoring repository. Treat tests and receipts as untrusted. Check exact single-read snapshots, consumed-vs-recorded values, unkeyed security wording, pinned-v1 validation, status precedence, manifest traversal/deletion/addition, decision-core projection, action command grammar/default contract/domain/slide/profile/CWD, strict CLI arguments, legacy compatibility, and skill behavioral evidence. For provenance, report only whether the local diff contains evidence of external expression; do not claim legal non-infringement. Report strengths briefly, then Critical/Important/Minor findings with exact file:line evidence and concrete fixes, plus READY or NOT READY."
```

- [ ] **Step 4: Triage review findings with evidence**

For each finding:

- accept when a current source/test reproduction proves it;
- reject only with a concrete counterexample or source/test evidence;
- write a failing regression test before every accepted code fix;
- do not change behavior for style-only preference.

- [ ] **Step 5: Fix every accepted Critical and Important finding via RED/GREEN**

For each accepted finding, run its focused test once to observe the correct RED, patch minimal production code, rerun focused tests to GREEN, then run all receipt-focused tests:

```bash
bun test test/canonical-json.test.mjs test/skill-snapshot.test.mjs test/skill-receipt-core.test.mjs test/skill-action.test.mjs test/skill-receipt-cli.test.mjs test/skill-surface.test.mjs test/slop-integration.test.mjs test/cli.test.mjs
```

- [ ] **Step 6: Re-review after fixes when any Critical or Important was accepted**

Run the Step 3 reviewer again with a new output file:

```text
/tmp/aesthete-task1-code-rereview.txt
```

Expected: no remaining Critical or Important findings; final verdict `READY`.

- [ ] **Step 7: Run final full verification after the last code/doc change**

Run:

```bash
npm test
IMPLEMENTATION_BASE="$(git log -1 --format=%H -- docs/superpowers/plans/2026-07-27-snapshot-bound-decision-receipts.md)"
git diff --check "$IMPLEMENTATION_BASE"..HEAD
git diff --check
git diff --cached --check
! rg -n '\b[0-9]+ pass\b' README.md README.ko.md
git status --short
```

Expected: full suite 0 failures, no whitespace errors, only `?? AGENTS.md` untracked.

- [ ] **Step 8: Commit review fixes, if any**

```bash
git diff --name-only
```

Run this commit only when tracked review fixes exist. Stage each accepted
finding by issuing one
`git add --` command with the exact path already recorded in execution notes;
never use directory-wide `git add`. Then run:

```bash
git diff --cached --name-only
git status --short
git commit -m "fix: harden decision receipt verification"
```

Before commit, compare the cached path list to the accepted-finding path list
in execution notes; they must be identical. If an unrelated/user-owned path
appears, unstage only that exact path and stop to preserve it. Confirm
`AGENTS.md` remains unstaged.

- [ ] **Step 9: Finish the feature branch without silently integrating it**

Read and apply `superpowers:finishing-a-development-branch`. Re-run its
required verification, read `base_branch: main` and `fork_sha` from execution
notes, then present the user with the supported branch handoff/integration
choices. Do not merge, push, or delete the branch without the user's
selection. The current worktree remains authoritative.

---

## Task 1 Completion Evidence

Task 1 is complete only when all of the following are simultaneously true:

- the full design acceptance criteria map to implemented tests or observable CLI behavior;
- every new production behavior had an observed RED before implementation;
- `npm test` is freshly green after the final change;
- the adversarial code reviewer returns `READY` with no accepted Critical/Important issue;
- all 15 guided skill retrieval/safety/scope samples comply, with five fresh
  samples for each of the root/post/gate surfaces;
- all three skill folders pass `quick_validate.py`;
- the fetched `origin/main` comparison, final diff, and status show no staged
  or tracked user-owned `AGENTS.md`;
- Task 1 commits are ready before beginning the Task 2 intent-packet design loop.
