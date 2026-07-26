# Intent Packet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> inline to implement this plan task-by-task. Native subagents are prohibited
> by this repository's routing policy. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Emit deterministic generation intent from `aesthete-pre`, bind its
exact bytes into backward-compatible v2 decision receipts, and verify intent
freshness without allowing intent to affect Aesthete's arithmetic decision.

**Architecture:** A new pure `lib/skill-intent.mjs` owns normalization and
prompt rendering. `skill-pre` emits `intent.json`; `skill-snapshot` owns strict
single-read intake; receipt core keeps pinned v1 APIs and adds separate v2
builders, validators, and generic dispatch. Post, gate, and receipt CLIs share
strict intent-path semantics while `foldDecision()` and measurement modules
remain intent-free.

**Tech Stack:** Bun, ECMAScript modules, `bun:test`, JSON Schema draft
2020-12, AJV 8, existing strict JSON/JCS/SHA-256 receipt primitives.

**Approved design:**
`docs/superpowers/specs/2026-07-27-intent-packet-design.md`

## Global Constraints

- Execute in the current worktree on
  `feat/snapshot-bound-decision-receipts`; do not create another worktree.
- Do not stage, modify, or delete the user-owned untracked `AGENTS.md`.
- Do not use native subagents. Inline execution is the default. A helper
  process is permitted only after explicit user authorization and must use the
  repository's fixed-model `rtk codex exec` command.
- Never use `max` reasoning effort.
- Every task follows:
  `plan -> adversarial pre-review -> TDD implementation -> adversarial post-review -> fix -> next task`.
- Record each pre-review, post-review, accepted finding, and deferred external
  review in
  `docs/superpowers/plans/2026-07-27-intent-packet-execution.md`.
- If fixed-model reviewer quota remains unavailable, record
  `DEFERRED_EXTERNAL_REVIEW: model-fixed exec quota unavailable` and perform
  the specified main-session adversarial checks. Do not claim independent
  review.
- `intent.json` is declared generation context, not measured truth.
- Intent must never be passed to `foldDecision()`, adapters, measurement,
  scanners, contract evaluation, claim-scope construction, or fix-action
  construction.
- Missing intent values remain explicit `null`, `[]`, or `unspecified`; no LLM
  or heuristic inference is permitted.
- New emissions use exact `aesthete.binding/v2`; pinned
  `aesthete.binding/v1` shape and comparison semantics remain available.
- A current receipt establishes only content freshness and internal
  consistency, not correctness, fulfillment, comprehension, authenticity, or
  human approval.
- Post and gate normal decision exit behavior remains unchanged. Invalid
  explicitly requested intent is `INTENT_INPUT_INVALID`, exits `2`, and emits
  no decision file.
- Receipt verification keeps `current=0`, `stale=1`, and all other statuses or
  input failures at `2`.
- Use TDD for every behavior change: observe the intended RED failure before
  implementation, then targeted GREEN, then the broader regression suite.
- Use `apply_patch` for repository edits and commit only task-owned files.

---

## File Map

### New files

| File | Responsibility |
|---|---|
| `schemas/intent.schema.json` | Exact `aesthete.intent/v1` structural contract |
| `lib/skill-intent.mjs` | Pure brief/spec normalization and fixed-order prompt bullets |
| `lib/skill-post-args.mjs` | Strict shared post/gate CLI grammar |
| `test/helpers/intent-fixture.mjs` | Complete valid intent factory for cross-layer tests |
| `test/skill-intent.test.mjs` | Intent schema, normalization, default, contradiction, and bullet unit tests |
| `docs/superpowers/plans/2026-07-27-intent-packet-execution.md` | Per-task adversarial gate evidence |
| `examples/dashboard-intent-brief.json` | Full intent-enabled pre example |

### Modified code and schemas

| File | Responsibility in this feature |
|---|---|
| `schemas/brief.schema.json` | Optional declared intent inputs |
| `schemas/pre.schema.json` | Required `intent_path` in new pre bundles |
| `schemas/decision.schema.json` | Exact v1/v2 binding alternatives and intent binding |
| `lib/shared/validator.mjs` | Compile intent schema and use generic receipt dispatch |
| `lib/skill-pre.mjs` | Build, validate, append, return, and emit intent |
| `lib/skill-snapshot.mjs` | Strict single-snapshot `snapshotIntent()` |
| `lib/skill-receipt-core.mjs` | Pinned v1 plus exact v2 build/validate/compare |
| `lib/skill-post.mjs` | Optional validated intent intake and v2 emission |
| `lib/skill-gate.mjs` | Shared strict args and v2 emission through `runPost()` |
| `lib/skill-receipt.mjs` | Intent-aware strict current-input verification |

### Modified tests

| File | Coverage |
|---|---|
| `test/skill-snapshot.test.mjs` | Strict intent parse/digest/read-once boundary |
| `test/skill-receipt-core.test.mjs` | Exact v1/v2 shapes, dispatch, stale ordering, checked fields |
| `test/skill-surface.test.mjs` | Async pre surface, post/gate emission, invariance, no-output failures |
| `test/skill-receipt-cli.test.mjs` | Verifier flags, current/stale matrix, process exits |

### Modified docs and skills

`README.md`, `SKILL.md`, `skills/aesthete-pre/SKILL.md`,
`skills/aesthete-post/SKILL.md`, `skills/aesthete-gate/SKILL.md`,
`docs/agent-llm-usage.md`, and
`docs/integration/generator-contract.md`.

---

### Task 1: Exact Intent Schema and Pure Builder

**Files:**
- Create: `schemas/intent.schema.json`
- Create: `lib/skill-intent.mjs`
- Create: `test/helpers/intent-fixture.mjs`
- Create: `test/skill-intent.test.mjs`
- Create: `docs/superpowers/plans/2026-07-27-intent-packet-execution.md`
- Modify: `schemas/brief.schema.json:8-35`
- Modify: `lib/shared/validator.mjs:10-24,62-89`

**Interfaces:**
- Consumes:
  `buildIntentPacket(brief: object, spec: object)`.
- Produces:
  `buildIntentPacket(brief, spec) -> aesthete.intent/v1 object`;
  `renderIntentPromptBullets(intent) -> string[]`.
- Later tasks rely on exact field and bullet order defined here.

- [ ] **Step 1: Perform and record the adversarial pre-review**

Create the execution record with the exact task boundary:

```markdown
# Intent Packet Execution Record

## Task 1 — Intent schema and pure builder

### Pre-review

- Allowed writes: intent schema, brief schema, validator registration, pure intent module, intent unit tests.
- Forbidden dependencies: filesystem, network, evaluator, receipt, scanner, or LLM calls from `skill-intent.mjs`.
- Failure probes: whitespace-only values, duplicate list members, exact included/excluded collision, unknown fields, missing optional values, unknown artifact type.
- Gate: READY when every output key and prompt prefix has one deterministic source.
```

Confirm the gate with:

```bash
rg -n "artifact_type|audience_frequency|STRICT_TYPES|loadAjv" \
  schemas/brief.schema.json lib/shared/validator.mjs
```

- [ ] **Step 2: Write failing schema and builder tests**

Create `test/helpers/intent-fixture.mjs`:

```js
export function makeIntent(goal = 'declared goal') {
  return {
    schema: 'aesthete.intent/v1',
    schema_version: 1,
    goal,
    scope: { included: [], excluded: [] },
    content_priority: [],
    artifact: {
      requested_type: 'dashboard',
      effective_type: 'dashboard',
      format: null,
      canvas: null,
    },
    audience: { description: null, frequency: null },
    desired_action: null,
    source: {
      mode: 'unspecified',
      must_preserve: [],
      must_not_assume: [],
    },
    claim_scope: {
      role: 'declared_generation_context_not_evaluation',
      does_not_establish: [
        'intent_correctness',
        'intent_fulfillment',
        'scope_coverage',
        'priority_fulfillment',
        'audience_comprehension',
        'human_approval',
      ],
    },
  };
}
```

Create `test/skill-intent.test.mjs` with these initial tests:

```js
import { expect, test } from 'bun:test';
import path from 'node:path';
import {
  buildIntentPacket,
  renderIntentPromptBullets,
} from '../lib/skill-intent.mjs';
import {
  captureSchemaBundle,
} from '../lib/skill-snapshot.mjs';
import { createRunValidator } from '../lib/shared/validator.mjs';

const repoRoot = path.resolve(import.meta.dir, '..');

const fullBrief = {
  artifact_type: 'dashboard',
  format: 'html',
  brief: '운영 지표를 빠르게 판단하는 대시보드',
  canvas: { w: 1440, h: 900 },
  scope: {
    included: ['운영 현황 화면', '이상 지표 탐색'],
    excluded: ['관리자 설정', '사용자 권한 편집'],
  },
  content_priority: ['이상 지표와 심각도', '원인 확인에 필요한 추세', '후속 조치'],
  audience: '일일 운영 담당자',
  audience_frequency: 'daily',
  desired_action: '이상 지표를 찾아 후속 조치한다',
  source_mode: 'continue_improve',
  must_preserve: ['승인된 수치', '브랜드 색상'],
  must_not_assume: ['누락된 수치', '사용자 승인'],
};

const spec = {
  artifact_type: 'dashboard',
};

test('intent: full brief produces the exact deterministic packet', () => {
  expect(buildIntentPacket(fullBrief, spec)).toEqual({
    schema: 'aesthete.intent/v1',
    schema_version: 1,
    goal: '운영 지표를 빠르게 판단하는 대시보드',
    scope: {
      included: ['운영 현황 화면', '이상 지표 탐색'],
      excluded: ['관리자 설정', '사용자 권한 편집'],
    },
    content_priority: ['이상 지표와 심각도', '원인 확인에 필요한 추세', '후속 조치'],
    artifact: {
      requested_type: 'dashboard',
      effective_type: 'dashboard',
      format: 'html',
      canvas: { w: 1440, h: 900 },
    },
    audience: {
      description: '일일 운영 담당자',
      frequency: 'daily',
    },
    desired_action: '이상 지표를 찾아 후속 조치한다',
    source: {
      mode: 'continue_improve',
      must_preserve: ['승인된 수치', '브랜드 색상'],
      must_not_assume: ['누락된 수치', '사용자 승인'],
    },
    claim_scope: {
      role: 'declared_generation_context_not_evaluation',
      does_not_establish: [
        'intent_correctness',
        'intent_fulfillment',
        'scope_coverage',
        'priority_fulfillment',
        'audience_comprehension',
        'human_approval',
      ],
    },
  });
});

test('intent: legacy brief uses only explicit unknown defaults', () => {
  const value = buildIntentPacket(
    { artifact_type: 'unrecognized-kind' },
    { artifact_type: 'generic' },
  );
  expect(value).toMatchObject({
    goal: null,
    scope: { included: [], excluded: [] },
    content_priority: [],
    artifact: {
      requested_type: 'unrecognized-kind',
      effective_type: 'generic',
      format: null,
      canvas: null,
    },
    audience: { description: null, frequency: null },
    desired_action: null,
    source: {
      mode: 'unspecified',
      must_preserve: [],
      must_not_assume: [],
    },
  });
});

test('intent: exact included/excluded collision is rejected', () => {
  expect(() => buildIntentPacket({
    artifact_type: 'dashboard',
    scope: { included: ['settings'], excluded: ['settings'] },
  }, spec)).toThrow('intent scope contradiction: settings');
});

test('intent: prompt bullets keep fixed grouping and priority order', () => {
  expect(renderIntentPromptBullets(buildIntentPacket(fullBrief, spec))).toEqual([
    'Declared goal: 운영 지표를 빠르게 판단하는 대시보드',
    'Included scope: 운영 현황 화면',
    'Included scope: 이상 지표 탐색',
    'Excluded scope: 관리자 설정',
    'Excluded scope: 사용자 권한 편집',
    'Content priority 1: 이상 지표와 심각도',
    'Content priority 2: 원인 확인에 필요한 추세',
    'Content priority 3: 후속 조치',
    'Audience: 일일 운영 담당자',
    'Audience frequency: daily',
    'Desired audience action: 이상 지표를 찾아 후속 조치한다',
    'Source mode: continue_improve',
    'Preserve: 승인된 수치',
    'Preserve: 브랜드 색상',
    'Do not assume: 누락된 수치',
    'Do not assume: 사용자 승인',
  ]);
});

test('intent: emitted packet is schema-valid', async () => {
  const validator = await createRunValidator(captureSchemaBundle(repoRoot));
  expect(() => validator.validate(
    'intent',
    buildIntentPacket(fullBrief, spec),
  )).not.toThrow();
});
```

Add table-driven AJV rejection cases for:

```js
[
  [{ ...fullBrief, audience: '   ' }, /audience/],
  [{ ...fullBrief, content_priority: ['same', 'same'] }, /unique/],
  [{ ...fullBrief, scope: { included: ['ok'], excluded: [], extra: true } }, /additional/],
  [{ ...fullBrief, must_preserve: [42] }, /string/],
]
```

- [ ] **Step 3: Run the tests and verify RED**

Run:

```bash
bun test test/skill-intent.test.mjs
```

Expected: FAIL because `lib/skill-intent.mjs` and
`schemas/intent.schema.json` do not exist.

- [ ] **Step 4: Add the exact schemas**

Create `schemas/intent.schema.json` with every top-level key required,
`additionalProperties: false` at every object boundary, and these reusable
definitions:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://acc0mplish/aesthete/schemas/intent.schema.json",
  "title": "Aesthete Generation Intent",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema",
    "schema_version",
    "goal",
    "scope",
    "content_priority",
    "artifact",
    "audience",
    "desired_action",
    "source",
    "claim_scope"
  ],
  "properties": {
    "schema": { "const": "aesthete.intent/v1" },
    "schema_version": { "const": 1 },
    "goal": { "$ref": "#/$defs/optionalText" },
    "scope": {
      "type": "object",
      "additionalProperties": false,
      "required": ["included", "excluded"],
      "properties": {
        "included": { "$ref": "#/$defs/textList" },
        "excluded": { "$ref": "#/$defs/textList" }
      }
    },
    "content_priority": { "$ref": "#/$defs/textList" },
    "artifact": {
      "type": "object",
      "additionalProperties": false,
      "required": ["requested_type", "effective_type", "format", "canvas"],
      "properties": {
        "requested_type": { "$ref": "#/$defs/text" },
        "effective_type": { "$ref": "#/$defs/text" },
        "format": {
          "enum": [null, "svg", "html", "pptx", "docx", "xlsx", "image"]
        },
        "canvas": {
          "anyOf": [
            { "type": "null" },
            {
              "type": "object",
              "additionalProperties": false,
              "required": ["w", "h"],
              "properties": {
                "w": { "type": "number", "minimum": 0 },
                "h": { "type": "number", "minimum": 0 }
              }
            }
          ]
        }
      }
    },
    "audience": {
      "type": "object",
      "additionalProperties": false,
      "required": ["description", "frequency"],
      "properties": {
        "description": { "$ref": "#/$defs/optionalText" },
        "frequency": { "enum": [null, "daily", "weekly", "once"] }
      }
    },
    "desired_action": { "$ref": "#/$defs/optionalText" },
    "source": {
      "type": "object",
      "additionalProperties": false,
      "required": ["mode", "must_preserve", "must_not_assume"],
      "properties": {
        "mode": {
          "enum": ["new", "continue_improve", "fresh_start", "unspecified"]
        },
        "must_preserve": { "$ref": "#/$defs/textList" },
        "must_not_assume": { "$ref": "#/$defs/textList" }
      }
    },
    "claim_scope": {
      "const": {
        "role": "declared_generation_context_not_evaluation",
        "does_not_establish": [
          "intent_correctness",
          "intent_fulfillment",
          "scope_coverage",
          "priority_fulfillment",
          "audience_comprehension",
          "human_approval"
        ]
      }
    }
  },
  "$defs": {
    "text": { "type": "string", "minLength": 1, "pattern": "\\S" },
    "optionalText": {
      "anyOf": [{ "type": "null" }, { "$ref": "#/$defs/text" }]
    },
    "textList": {
      "type": "array",
      "uniqueItems": true,
      "items": { "$ref": "#/$defs/text" }
    }
  }
}
```

Extend `brief.schema.json` with optional `scope`, `content_priority`,
`audience`, `desired_action`, `source_mode`, `must_preserve`, and
`must_not_assume`. Reuse the same `pattern: "\\S"` and `uniqueItems: true`
rules. A provided `scope` object requires both `included` and `excluded`.

Register `intent` in both validator paths:

```js
const STRICT_TYPES = [
  'alt',
  'contract',
  'report',
  'brief',
  'intent',
  'vuln-report',
  'slop-report',
  'validation-corpus',
  'decision',
];
```

and:

```js
for (const t of [
  'alt',
  'contract',
  'report',
  'brief',
  'intent',
  'vuln-report',
  'slop-report',
  'validation-corpus',
]) {
```

- [ ] **Step 5: Implement the pure builder and renderer**

Create `lib/skill-intent.mjs`:

```js
const CLAIM_SCOPE = Object.freeze({
  role: 'declared_generation_context_not_evaluation',
  does_not_establish: Object.freeze([
    'intent_correctness',
    'intent_fulfillment',
    'scope_coverage',
    'priority_fulfillment',
    'audience_comprehension',
    'human_approval',
  ]),
});

function list(value) {
  return Array.isArray(value) ? [...value] : [];
}

function optional(value) {
  return value === undefined ? null : value;
}

export function buildIntentPacket(brief, spec) {
  const included = list(brief?.scope?.included);
  const excluded = list(brief?.scope?.excluded);
  const excludedSet = new Set(excluded);
  const collision = included.find((value) => excludedSet.has(value));
  if (collision !== undefined) {
    throw new Error(`intent scope contradiction: ${collision}`);
  }
  return {
    schema: 'aesthete.intent/v1',
    schema_version: 1,
    goal: optional(brief?.brief),
    scope: { included, excluded },
    content_priority: list(brief?.content_priority),
    artifact: {
      requested_type: brief?.artifact_type,
      effective_type: spec?.artifact_type,
      format: optional(brief?.format),
      canvas: brief?.canvas === undefined
        ? null
        : { w: brief.canvas.w, h: brief.canvas.h },
    },
    audience: {
      description: optional(brief?.audience),
      frequency: optional(brief?.audience_frequency),
    },
    desired_action: optional(brief?.desired_action),
    source: {
      mode: brief?.source_mode ?? 'unspecified',
      must_preserve: list(brief?.must_preserve),
      must_not_assume: list(brief?.must_not_assume),
    },
    claim_scope: {
      role: CLAIM_SCOPE.role,
      does_not_establish: [...CLAIM_SCOPE.does_not_establish],
    },
  };
}

export function renderIntentPromptBullets(intent) {
  const bullets = [];
  if (intent.goal !== null) bullets.push(`Declared goal: ${intent.goal}`);
  for (const value of intent.scope.included) {
    bullets.push(`Included scope: ${value}`);
  }
  for (const value of intent.scope.excluded) {
    bullets.push(`Excluded scope: ${value}`);
  }
  intent.content_priority.forEach((value, index) => {
    bullets.push(`Content priority ${index + 1}: ${value}`);
  });
  if (intent.audience.description !== null) {
    bullets.push(`Audience: ${intent.audience.description}`);
  }
  if (intent.audience.frequency !== null) {
    bullets.push(`Audience frequency: ${intent.audience.frequency}`);
  }
  if (intent.desired_action !== null) {
    bullets.push(`Desired audience action: ${intent.desired_action}`);
  }
  if (intent.source.mode !== 'unspecified') {
    bullets.push(`Source mode: ${intent.source.mode}`);
  }
  for (const value of intent.source.must_preserve) {
    bullets.push(`Preserve: ${value}`);
  }
  for (const value of intent.source.must_not_assume) {
    bullets.push(`Do not assume: ${value}`);
  }
  return bullets;
}
```

- [ ] **Step 6: Run targeted GREEN tests**

Run:

```bash
bun test test/skill-intent.test.mjs
bun test test/preflight.test.mjs test/skill-snapshot.test.mjs
```

Expected: all selected tests PASS.

- [ ] **Step 7: Perform adversarial post-review and fix findings**

Run these probes:

```bash
rg -n "fs\\.|fetch\\(|foldDecision|measure|scan|receipt" lib/skill-intent.mjs
bun test test/skill-intent.test.mjs --rerun-each 3
git diff --check
```

The first command must return no dependency hit. Add unit cases proving:

- `Settings` and `settings` do not collide because comparison is exact and
  case-sensitive;
- returned arrays are clones and mutating the brief after the call does not
  mutate the packet;
- an unknown type preserves `requested_type` and uses `effective_type:
  "generic"`.

Record the observed results and any accepted fixes in the execution record.

- [ ] **Step 8: Commit Task 1**

```bash
git add \
  schemas/intent.schema.json \
  schemas/brief.schema.json \
  lib/shared/validator.mjs \
  lib/skill-intent.mjs \
  test/helpers/intent-fixture.mjs \
  test/skill-intent.test.mjs \
  docs/superpowers/plans/2026-07-27-intent-packet-execution.md
git commit -m "feat: define deterministic intent packets"
```

---

### Task 2: Pre Pipeline Integration and Emission

**Files:**
- Modify: `lib/skill-pre.mjs:8-196`
- Modify: `schemas/pre.schema.json:7-33`
- Modify: `test/skill-surface.test.mjs:13,79-98,717-776`
- Modify: `test/skill-intent.test.mjs`
- Modify: `docs/superpowers/plans/2026-07-27-intent-packet-execution.md`

**Interfaces:**
- Consumes:
  `buildIntentPacket(brief, spec)`;
  `renderIntentPromptBullets(intent)`.
- Produces:
  `async runPre(brief, opts) -> {spec,bundle,contractPath,intent,intentPath,slopRules,slopTestMd}`;
  `pre.json.intent_path`;
  `<out-dir>/intent.json`.

- [ ] **Step 1: Record the Task 2 adversarial pre-review**

Append:

```markdown
## Task 2 — Pre integration

### Pre-review

- `runPre()` remains write-free but becomes async so it can complete schema validation.
- Existing structure, budget, negation, and slop bullet relative order is frozen.
- Intent bullets form one appended contiguous block.
- The CLI computes and validates every in-memory output before creating the output directory.
- `intent.json` is SSOT; `pre.json` contains only `intent_path`.
- Gate: READY when legacy briefs need no new field and all sync `runPre()` callers are enumerated.
```

Enumerate callers:

```bash
rg -n "\\brunPre\\(" --glob '!docs/superpowers/**' --glob '!node_modules/**'
```

Expected: only `lib/skill-pre.mjs` and `test/skill-surface.test.mjs`.

- [ ] **Step 2: Write failing pre integration tests**

Update every existing `runPre()` test to `async` and `await runPre(...)`.
Add:

```js
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
```

Add a real-process test using `spawnSync`:

```js
test('pre CLI emits intent.json and pre.json points to it', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aesthete-intent-pre-'));
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
  fs.rmSync(tempDir, { recursive: true, force: true });
});
```

Add an invalid-brief process case that asserts `outDir` does not exist after a
whitespace-only `desired_action`.

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
bun test test/skill-intent.test.mjs test/skill-surface.test.mjs \
  -t "pre|intent"
```

Expected: FAIL because `runPre()` does not return intent, does not emit
`intent.json`, and is still synchronous.

- [ ] **Step 4: Integrate intent without adding filesystem I/O to `runPre()`**

Import:

```js
import {
  buildIntentPacket,
  renderIntentPromptBullets,
} from './skill-intent.mjs';
```

Change the bundle signature:

```js
export function buildPreBundle(spec, {
  contractPath,
  intentPath,
  intentBullets = [],
} = {}) {
```

After existing slop bullets:

```js
for (const bullet of intentBullets) prompt_bullets.push(bullet);
```

Add to the returned bundle:

```js
intent_path: intentPath || null,
```

Change `runPre()` to async and build/validate intent before returning:

```js
export async function runPre(brief, opts = {}) {
  const log = opts.log;
  const spec = preflight(brief, log ? { log } : {});
  const medium = brief?.format === 'html' ? 'html' : (brief?.format || 'html');
  const slopRules = getRules(medium);
  spec.negation = mergeNeg(spec.negation || {}, slopRules.negation);
  spec._slopRules = slopRules;
  spec._slopMedium = medium;
  const outDir = opts.outDir;
  const contractPath = outDir ? path.join(outDir, 'contract.json') : null;
  const intentPath = outDir ? path.join(outDir, 'intent.json') : null;
  const intent = buildIntentPacket(brief, spec);
  await validate('intent', intent);
  const intentBullets = renderIntentPromptBullets(intent);
  const bundle = buildPreBundle(spec, {
    contractPath,
    intentPath,
    intentBullets,
  });
  const slopTestMd = renderSlopTest(slopRules);
  return {
    spec,
    bundle,
    contractPath,
    intent,
    intentPath,
    slopRules,
    slopTestMd,
  };
}
```

In `main()`, await `runPre()` before `fs.mkdirSync()`, then write the returned
intent:

```js
const result = await runPre(brief, { log, outDir });
fs.mkdirSync(outDir, { recursive: true });
writeJson(result.contractPath, result.spec.contract);
writeJson(result.intentPath, result.intent);
```

Retain all existing pre, bullets, slop-test, and diversify writes after those
two lines.

Update `pre.schema.json`:

```json
"required": [
  "schema",
  "schema_version",
  "artifact_type",
  "intent_path",
  "prompt_bullets",
  "structure"
]
```

and:

```json
"intent_path": { "type": ["string", "null"] }
```

- [ ] **Step 5: Run targeted GREEN tests**

Run:

```bash
bun test test/skill-intent.test.mjs test/skill-surface.test.mjs \
  -t "pre|intent|slop-pre"
bun test test/preflight.test.mjs test/diversify.test.mjs
```

Expected: all selected tests PASS.

- [ ] **Step 6: Perform adversarial post-review and fix**

Run:

```bash
rg -n "writeFile|writeJson|mkdir|appendFile" lib/skill-intent.mjs
rg -n "\\brunPre\\(" --glob '!docs/superpowers/**' --glob '!node_modules/**'
bun test test/skill-surface.test.mjs --rerun-each 2
git diff --check
```

Rerun the invalid-brief process test from Step 2 and inspect its captured
filesystem assertion. The Bun child process must fail and the test must prove
the requested output directory was never created. Record the observed exit
and fix any premature output creation.

- [ ] **Step 7: Commit Task 2**

```bash
git add \
  lib/skill-pre.mjs \
  schemas/pre.schema.json \
  test/skill-surface.test.mjs \
  test/skill-intent.test.mjs \
  docs/superpowers/plans/2026-07-27-intent-packet-execution.md
git commit -m "feat: emit intent from preflight"
```

---

### Task 3: Strict Intent Snapshot Boundary

**Files:**
- Modify: `lib/skill-snapshot.mjs:331-370`
- Modify: `test/skill-snapshot.test.mjs:1-460`
- Modify: `docs/superpowers/plans/2026-07-27-intent-packet-execution.md`

**Interfaces:**
- Produces:
  `snapshotIntent(filePath, io = DEFAULT_IO) -> {status:"bound",bytes,sha256,value}`.
- Error:
  every read/strict-parse failure becomes `ReceiptInputError` with code
  `INTENT_INPUT_INVALID`.

- [ ] **Step 1: Record the Task 3 adversarial pre-review**

Append:

```markdown
## Task 3 — Intent snapshot

### Pre-review

- Intent bytes, parsed value, and digest must come from one operation-cached read.
- The snapshot helper performs strict JSON parsing but not schema validation.
- The caller owns schema validation against the captured schema bundle.
- Every helper failure maps to `INTENT_INPUT_INVALID`.
- Gate: READY when contract snapshot behavior remains unchanged.
```

- [ ] **Step 2: Write failing snapshot tests**

Import `snapshotIntent` in `test/skill-snapshot.test.mjs` and add:

```js
test('intent snapshot returns strict parsed value and raw-byte digest', () => {
  const intentPath = path.join(fixtureRoot, 'intent.json');
  const bytes = Buffer.from('{"schema":"aesthete.intent/v1","schema_version":1}\n');
  fs.writeFileSync(intentPath, bytes);
  expect(snapshotIntent(intentPath)).toEqual({
    status: 'bound',
    bytes,
    sha256: sha256Bytes(bytes),
    value: {
      schema: 'aesthete.intent/v1',
      schema_version: 1,
    },
  });
});

test('intent snapshot rejects duplicate keys with the stable input code', () => {
  const intentPath = path.join(fixtureRoot, 'duplicate-intent.json');
  fs.writeFileSync(intentPath, '{"schema":"a","schema":"b"}');
  expectReceiptError(
    () => snapshotIntent(intentPath),
    'INTENT_INPUT_INVALID',
  );
});

test('intent snapshot shares the first operation buffer', () => {
  const intentPath = path.join(fixtureRoot, 'intent-first.json');
  const first = Buffer.from('{"value":"first"}');
  const second = Buffer.from('{"value":"second"}');
  let reads = 0;
  const io = createOperationIo({
    readFile() {
      reads += 1;
      return reads === 1 ? first : second;
    },
  });
  const a = snapshotIntent(intentPath, io);
  const b = snapshotIntent(intentPath, io);
  expect(reads).toBe(1);
  expect(a.bytes).toEqual(first);
  expect(b.bytes).toEqual(first);
  expect(a.sha256).toBe(sha256Bytes(first));
});
```

Add unreadable and lone-surrogate cases expecting `INTENT_INPUT_INVALID`.

- [ ] **Step 3: Run tests and verify RED**

```bash
bun test test/skill-snapshot.test.mjs -t "intent snapshot"
```

Expected: FAIL because `snapshotIntent` is not exported.

- [ ] **Step 4: Implement `snapshotIntent()`**

Add beside `snapshotContract()`:

```js
export function snapshotIntent(filePath, io = DEFAULT_IO) {
  try {
    const supplied = io.readFile(path.resolve(filePath));
    const bytes = Buffer.isBuffer(supplied) ? supplied : Buffer.from(supplied);
    return {
      status: 'bound',
      bytes,
      sha256: sha256Bytes(bytes),
      value: parseJsonStrict(bytes, 'intent'),
    };
  } catch (error) {
    throw new ReceiptInputError(
      'INTENT_INPUT_INVALID',
      `intent input invalid: ${error.message}`,
    );
  }
}
```

- [ ] **Step 5: Run targeted GREEN and regression tests**

```bash
bun test test/skill-snapshot.test.mjs
bun test test/canonical-json.test.mjs test/skill-surface.test.mjs \
  -t "snapshot|strict"
```

Expected: all selected tests PASS.

- [ ] **Step 6: Perform adversarial post-review and fix**

Check exact read sites:

```bash
rg -n "snapshot(Intent|Contract)|readFile" \
  lib/skill-snapshot.mjs test/skill-snapshot.test.mjs
git diff --check
```

Mutate the backing file after the first `operationIo.readFile()` and assert a
second `snapshotIntent()` still returns the first bytes. Record that the raw
digest changes when only trailing whitespace changes; freshness is byte-based,
not semantic JSON equivalence.

- [ ] **Step 7: Commit Task 3**

```bash
git add \
  lib/skill-snapshot.mjs \
  test/skill-snapshot.test.mjs \
  docs/superpowers/plans/2026-07-27-intent-packet-execution.md
git commit -m "feat: snapshot strict intent inputs"
```

---

### Task 4: Version-Pinned Receipt v2 Core

**Files:**
- Modify: `schemas/decision.schema.json:52-54,520-730`
- Modify: `lib/skill-receipt-core.mjs:46-72,537-787`
- Modify: `lib/shared/validator.mjs:6-8,104-116`
- Modify: `test/skill-receipt-core.test.mjs:1-1175`
- Modify: `docs/superpowers/plans/2026-07-27-intent-packet-execution.md`

**Interfaces:**
- Preserves:
  `buildDecisionBinding(input) -> aesthete.binding/v1`;
  `validateReceiptV1Shape(decision)`.
- Produces:
  `buildDecisionBindingV2(input) -> aesthete.binding/v2`;
  `validateReceiptV2Shape(decision)`;
  `validateReceiptShape(decision)` generic dispatch;
  `verifyDecisionBinding(decision, current)` version-aware comparison.

- [ ] **Step 1: Record the Task 4 adversarial pre-review**

Append:

```markdown
## Task 4 — Receipt v2 core

### Pre-review

- Existing v1 builder output and exact v1 validator remain byte/shape compatible.
- V1 validator must reject a v2 binding; generic dispatch accepts both.
- V2 adds only `intent` between `contract` and `action_inputs`.
- Intent is outside policy and outside decision core.
- `INTENT_CHANGED` sorts after `CONTRACT_CHANGED`.
- Gate: READY when v1 and v2 APIs have distinct names and tests.
```

- [ ] **Step 2: Write failing v2 core tests**

Add imports:

```js
import {
  buildDecisionBindingV2,
  validateReceiptShape,
  validateReceiptV2Shape,
} from '../lib/skill-receipt-core.mjs';
```

Add v2 helpers using the existing `legacyDecision`, `passReport`, `current`,
and `literalPolicyFixture` fixtures:

```js
function receiptDecisionV2(intent = {
  status: 'bound',
  sha256: digest('9'),
}) {
  const decision = {
    ...structuredClone(legacyDecision),
    claim_scope: buildClaimScope({ report: passReport }),
  };
  decision.binding = buildDecisionBindingV2({
    decision,
    completeness: 'complete',
    artifact_sha256: digest('a'),
    contract: { status: 'not_requested', sha256: null },
    intent,
    action_inputs: { status: 'not_required' },
    policy: literalPolicyFixture(),
  });
  return decision;
}

function currentV2(intent = {
  status: 'bound',
  sha256: digest('9'),
}) {
  return {
    ...structuredClone(current),
    intent: structuredClone(intent),
  };
}
```

Add tests:

```js
test('v2 binding adds exact intent state while v1 remains pinned', () => {
  const v2 = receiptDecisionV2();
  expect(Object.keys(v2.binding)).toEqual([
    'schema',
    'algorithm',
    'integrity',
    'completeness',
    'artifact',
    'contract',
    'intent',
    'action_inputs',
    'policy',
    'policy_sha256',
    'decision_core_sha256',
  ]);
  expect(v2.binding.schema).toBe('aesthete.binding/v2');
  expect(validateReceiptV1Shape(v2).status).toBe('invalid');
  expect(validateReceiptV2Shape(v2)).toEqual({ status: 'bound', issues: [] });
  expect(validateReceiptShape(v2)).toEqual({ status: 'bound', issues: [] });
  expect(validateReceiptShape(receiptDecision()))
    .toEqual({ status: 'bound', issues: [] });
});

test('v2 intent change is stale after contract and before action', () => {
  const decision = {
    ...structuredClone(legacyDecision),
    decision: 'fix_geometry',
    next: {
      action: 'run_fix_p0',
      fix_cmd: ['bun', 'lib/fix.mjs'],
      loop_hint_max: 2,
    },
    claim_scope: buildClaimScope({ report: passReport }),
  };
  decision.binding = buildDecisionBindingV2({
    decision,
    completeness: 'complete',
    artifact_sha256: digest('c'),
    contract: { status: 'not_requested', sha256: null },
    intent: { status: 'bound', sha256: digest('9') },
    action_inputs: boundAction,
    policy: literalPolicyFixture(),
  });
  const changed = {
    ...structuredClone(current),
    contract: { status: 'bound', sha256: digest('b') },
    intent: { status: 'bound', sha256: digest('8') },
    action_inputs: {
      ...structuredClone(boundAction),
      script_locator_sha256: digest('f'),
    },
    policy: literalPolicyFixture({ profile: 'strict' }),
  };
  const result = verifyDecisionBinding(decision, changed);
  expect(result.issues.slice(0, 4)).toEqual([
    { code: 'CONTRACT_CHANGED' },
    { code: 'INTENT_CHANGED' },
    { code: 'ACTION_CHANGED' },
    { code: 'POLICY_CHANGED' },
  ]);
  expect(result.checked).toContain('intent.status');
  expect(result.checked).toContain('intent.sha256');
});

test('bound stored intent requires a current bound intent', () => {
  const decision = receiptDecisionV2();
  const changed = currentV2({ status: 'not_requested', sha256: null });
  expect(() => verifyDecisionBinding(decision, changed))
    .toThrow(ReceiptCurrentInputError);
});

test('not-requested stored intent becomes stale when current intent is supplied', () => {
  const decision = receiptDecisionV2({
    status: 'not_requested',
    sha256: null,
  });
  const changed = currentV2({ status: 'bound', sha256: digest('8') });
  expect(verifyDecisionBinding(decision, changed).issues)
    .toEqual([{ code: 'INTENT_CHANGED' }]);
});
```

Add hostile-shape cases for missing intent, extra intent key, invalid digest,
unknown binding schema, and v1 `current` objects containing an intent key.

- [ ] **Step 3: Run tests and verify RED**

```bash
bun test test/skill-receipt-core.test.mjs -t "v2|intent"
```

Expected: FAIL because v2 exports and schema alternatives do not exist.

- [ ] **Step 4: Add exact schema alternatives**

In `decision.schema.json`, add:

```json
"intentBinding": {
  "type": "object",
  "required": ["status", "sha256"],
  "additionalProperties": false,
  "properties": {
    "status": { "enum": ["bound", "not_requested"] },
    "sha256": {
      "anyOf": [
        { "$ref": "#/$defs/digest" },
        { "type": "null" }
      ]
    }
  },
  "allOf": [
    {
      "if": {
        "properties": { "status": { "const": "bound" } },
        "required": ["status"]
      },
      "then": {
        "properties": { "sha256": { "$ref": "#/$defs/digest" } }
      },
      "else": {
        "properties": { "sha256": { "type": "null" } }
      }
    }
  ]
}
```

Rename only the existing `$defs.binding` key to `$defs.bindingV1`; preserve
that definition's body byte-for-byte so v1 validation cannot drift. Add this
exact sibling:

```json
"bindingV2": {
  "type": "object",
  "required": [
    "schema",
    "algorithm",
    "integrity",
    "completeness",
    "artifact",
    "contract",
    "intent",
    "action_inputs",
    "policy",
    "policy_sha256",
    "decision_core_sha256"
  ],
  "additionalProperties": false,
  "properties": {
    "schema": { "const": "aesthete.binding/v2" },
    "algorithm": { "const": "sha256" },
    "integrity": {
      "const": "content_freshness_and_internal_consistency_not_authenticity"
    },
    "completeness": { "enum": ["complete", "incomplete"] },
    "artifact": { "$ref": "#/$defs/artifactBinding" },
    "contract": { "$ref": "#/$defs/contractBinding" },
    "intent": { "$ref": "#/$defs/intentBinding" },
    "action_inputs": { "$ref": "#/$defs/actionInputs" },
    "policy": { "$ref": "#/$defs/policy" },
    "policy_sha256": { "$ref": "#/$defs/digest" },
    "decision_core_sha256": { "$ref": "#/$defs/digest" }
  },
  "allOf": [
    {
      "if": {
        "properties": { "completeness": { "const": "complete" } },
        "required": ["completeness"]
      },
      "then": {
        "properties": {
          "artifact": {
            "properties": {
              "status": { "const": "bound" },
              "sha256": { "$ref": "#/$defs/digest" }
            }
          }
        }
      },
      "else": {
        "properties": {
          "artifact": {
            "properties": {
              "status": { "const": "unreadable" },
              "sha256": { "type": "null" }
            }
          }
        }
      }
    }
  ]
}
```

Replace `$defs.binding` with this exact dispatcher:

```json
"binding": {
  "oneOf": [
    { "$ref": "#/$defs/bindingV1" },
    { "$ref": "#/$defs/bindingV2" }
  ]
}
```

Do not loosen either version with `additionalProperties: true`.

- [ ] **Step 5: Add v2 builder and pinned dispatch**

Add:

```js
function validateIntent(intent) {
  return hasExactKeys(intent, ['status', 'sha256'])
    && (
      (intent.status === 'bound' && LOWER_HEX_256.test(intent.sha256))
      || (intent.status === 'not_requested' && intent.sha256 === null)
    );
}

export function buildDecisionBindingV2(input = {}) {
  const v1 = buildDecisionBinding(input);
  if (!validateIntent(input.intent)) {
    throw new Error('binding intent is invalid');
  }
  return {
    schema: 'aesthete.binding/v2',
    algorithm: v1.algorithm,
    integrity: v1.integrity,
    completeness: v1.completeness,
    artifact: v1.artifact,
    contract: v1.contract,
    intent: clone(input.intent),
    action_inputs: v1.action_inputs,
    policy: v1.policy,
    policy_sha256: v1.policy_sha256,
    decision_core_sha256: v1.decision_core_sha256,
  };
}
```

Keep the current `buildDecisionBinding()` body and v1 schema string unchanged.
Split current structural validation into exact v1/v2 functions. The v2 key
list is:

```js
[
  'schema',
  'algorithm',
  'integrity',
  'completeness',
  'artifact',
  'contract',
  'intent',
  'action_inputs',
  'policy',
  'policy_sha256',
  'decision_core_sha256',
]
```

Add generic dispatch:

```js
export function validateReceiptShape(decision) {
  if (!isRecord(decision?.binding)) {
    return validateReceiptV1Shape(decision);
  }
  if (decision.binding.schema === 'aesthete.binding/v1') {
    return validateReceiptV1Shape(decision);
  }
  if (decision.binding.schema === 'aesthete.binding/v2') {
    return validateReceiptV2Shape(decision);
  }
  if (!validateBaseDecision(decision)) {
    return { status: 'invalid', issues: [{ code: 'BASE_SCHEMA_INVALID' }] };
  }
  return { status: 'invalid', issues: [{ code: 'RECEIPT_SCHEMA_INVALID' }] };
}
```

Version the current-input validators:

```js
const ALL_CHECKED_V2 = Object.freeze([
  'decision_core_sha256',
  'artifact.sha256',
  'contract.status',
  'contract.sha256',
  'intent.status',
  'intent.sha256',
  'action_inputs',
  'policy_sha256',
]);
```

Insert `INTENT_CHANGED` after `CONTRACT_CHANGED`. For v2:

```js
if (
  decision.binding.intent.status === 'bound'
  && current.intent.status !== 'bound'
) {
  throw new ReceiptCurrentInputError(
    'bound receipt intent requires a current intent input',
  );
}
if (
  decision.binding.intent.status !== current.intent.status
  || decision.binding.intent.sha256 !== current.intent.sha256
) {
  issues.push({ code: 'INTENT_CHANGED' });
}
```

V1 current validation keeps the old exact key list and old checked fields.
V2 current validation requires the old fields plus exact `intent`.

Change `createRunValidator()` to import and call `validateReceiptShape()` for
decision semantic checks.

- [ ] **Step 6: Run targeted GREEN tests**

```bash
bun test test/skill-receipt-core.test.mjs -t "v1|v2|intent|verification"
bun test test/skill-snapshot.test.mjs test/skill-action.test.mjs
```

Expected: all selected tests PASS.

- [ ] **Step 7: Perform adversarial post-review and fix**

Run:

```bash
rg -n "aesthete\\.binding/v[12]|validateReceipt(V1|V2|Shape)|INTENT_CHANGED" \
  lib schemas test/skill-receipt-core.test.mjs
bun test test/skill-receipt-core.test.mjs --rerun-each 2
git diff --check
```

Mutate v1 fixtures with an `intent` key and confirm
`validateReceiptV1Shape()` returns `RECEIPT_SCHEMA_INVALID`. Mutate v2 fixtures
by removing `intent` and confirm the same. Confirm `decisionCore()` source and
returned keys have no intent reference:

```bash
sed -n '525,535p' lib/skill-receipt-core.mjs
```

Record all observed results.

- [ ] **Step 8: Commit Task 4**

```bash
git add \
  schemas/decision.schema.json \
  lib/skill-receipt-core.mjs \
  lib/shared/validator.mjs \
  test/skill-receipt-core.test.mjs \
  docs/superpowers/plans/2026-07-27-intent-packet-execution.md
git commit -m "feat: add intent-bound receipt v2"
```

---

### Task 5: Strict Post/Gate Args and v2 Emission

**Files:**
- Create: `lib/skill-post-args.mjs`
- Modify: `lib/skill-post.mjs:6-45,89-149,210-228,261-530`
- Modify: `lib/skill-gate.mjs:4-72`
- Modify: `test/skill-surface.test.mjs`
- Modify: `docs/superpowers/plans/2026-07-27-intent-packet-execution.md`

**Interfaces:**
- Produces:
  `parsePostArgs(argv) -> {inputPath,flags,outDirFlag}`;
  programmatic `runPost(..., {flags:{intent}})`;
  new post/gate receipt `aesthete.binding/v2`.

- [ ] **Step 1: Record the Task 5 adversarial pre-review**

Append:

```markdown
## Task 5 — Post and gate v2 emission

### Pre-review

- Post and gate share one strict argv parser.
- Duplicate, unknown, `--name=value`, missing-value, and extra positional input fail before output.
- Requested intent is snapshotted and schema-validated before artifact evaluation.
- Intent object/value never enters fold, claim scope, policy, or action construction.
- New emission always uses binding v2 with `bound` or `not_requested`.
- Gate: READY when output directory creation occurs only after successful `runPost()`.
```

- [ ] **Step 2: Write failing parser and emission tests**

Add:

```js
import { parsePostArgs } from '../lib/skill-post-args.mjs';
import { makeIntent } from './helpers/intent-fixture.mjs';
```

Tests:

```js
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
```

Add post invariance:

```js
test('post: intent changes binding only, never the decision core or policy', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aesthete-intent-post-'));
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
  expect(decisionCore(first)).toEqual(decisionCore(second));
  expect(first.binding.policy).toEqual(second.binding.policy);
  expect(first.binding.intent.sha256).not.toBe(second.binding.intent.sha256);
  expect(first.binding.schema).toBe('aesthete.binding/v2');
  fs.rmSync(tempDir, { recursive: true, force: true });
});
```

Add process tests for both `skill-post.mjs` and `skill-gate.mjs` asserting a
duplicate-key intent exits `2`, prints `INTENT_INPUT_INVALID`, and does not
create `<out-dir>/decision.json`.

- [ ] **Step 3: Run tests and verify RED**

```bash
bun test test/skill-surface.test.mjs -t "post args|intent changes|INTENT_INPUT"
```

Expected: FAIL because the parser and v2 post wiring do not exist.

- [ ] **Step 4: Implement the shared strict parser**

Create `lib/skill-post-args.mjs` with:

```js
import { ReceiptInputError } from './skill-snapshot.mjs';

const VALUE_FLAGS = new Set([
  'domain',
  'slide',
  'profile',
  'contract',
  'intent',
  'type',
  'structure',
  'out-dir',
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

export function parsePostArgs(argv) {
  if (!Array.isArray(argv) || !argv.every((value) => typeof value === 'string')) {
    throw new ReceiptInputError('POLICY_INPUT_INVALID', 'post arguments must be strings');
  }
  const positional = [];
  const flags = {};
  const seen = new Set();
  let outDirFlag;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    if (token === '--' || token.includes('=')) {
      throw new ReceiptInputError(
        'POLICY_INPUT_INVALID',
        `unsupported flag spelling: ${token}`,
      );
    }
    const name = token.slice(2);
    if (!VALUE_FLAGS.has(name) && !PRESENCE_FLAGS.has(name)) {
      throw new ReceiptInputError('POLICY_INPUT_INVALID', `unknown flag: --${name}`);
    }
    if (seen.has(name)) {
      throw new ReceiptInputError('POLICY_INPUT_INVALID', `duplicate flag: --${name}`);
    }
    seen.add(name);
    if (PRESENCE_FLAGS.has(name)) {
      flags[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (typeof value !== 'string' || value.length === 0 || value.startsWith('--')) {
      throw new ReceiptInputError(
        name === 'intent' ? 'INTENT_INPUT_INVALID' : 'POLICY_INPUT_INVALID',
        `--${name} requires one non-empty value`,
      );
    }
    index += 1;
    if (name === 'out-dir') outDirFlag = value;
    else flags[name] = value;
  }
  if (positional.length !== 1 || positional[0].length === 0) {
    throw new ReceiptInputError(
      'POLICY_INPUT_INVALID',
      'post requires exactly one artifact positional',
    );
  }
  return { inputPath: positional[0], flags, outDirFlag };
}
```

- [ ] **Step 5: Wire validated intent into post/gate v2 emission**

In `skill-post.mjs`:

- replace shared `parseArgs` with `parsePostArgs`;
- import `buildDecisionBindingV2` and `snapshotIntent`;
- add exact intent-path normalization:

```js
function normalizeIntentPath(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || value.startsWith('--')) {
    throw new ReceiptInputError(
      'INTENT_INPUT_INVALID',
      'requested intent path must be a non-flag string',
    );
  }
  try {
    return path.resolve(value);
  } catch (error) {
    throw new ReceiptInputError(
      'INTENT_INPUT_INVALID',
      `requested intent path is invalid: ${error.message}`,
    );
  }
}
```

Before returning from `normalizePostFlags()`, reject unknown programmatic
keys with this exact allow-list:

```js
const POST_FLAG_KEYS = [
  'domain',
  'slide',
  'contract',
  'intent',
  'profile',
  'structure',
  'type',
  'lint',
  'vuln',
  'vuln-gate',
  'slop',
  'slop-gate',
  'slop-autofix',
  'human-on-unfixable',
];

if (!hasOnlyKeys(flags, POST_FLAG_KEYS)) {
  throw new ReceiptInputError(
    'POLICY_INPUT_INVALID',
    'post flags contain unknown fields',
  );
}
```

Add `intentPath: normalizeIntentPath(flags.intent)` to the returned normalized
flags. After creating the validator:

```js
const requestedIntent = flags.intentPath === null
  ? null
  : validateRequestedIntent(flags.intentPath, context.io, validator);
```

Use:

```js
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
```

Build v2:

```js
const bindingInput = {
  decision,
  completeness: artifact.status === 'bound' ? 'complete' : 'incomplete',
  artifact_sha256: artifact.sha256,
  contract: requestedContract
    ? { status: 'bound', sha256: requestedContract.sha256 }
    : { status: 'not_requested', sha256: null },
  intent: requestedIntent
    ? { status: 'bound', sha256: requestedIntent.sha256 }
    : { status: 'not_requested', sha256: null },
  action_inputs: actionInputs,
  policy,
};
decision.binding = buildDecisionBindingV2(bindingInput);
```

Return `intentSnapshot: requestedIntent`.

In both CLI mains:

```js
const { inputPath, flags, outDirFlag } = parsePostArgs(
  process.argv.slice(2),
);
const outDir = resolveOutDir(outDirFlag);
const result = await runPost(inputPath, { flags, outDir });
```

Do not create `outDir` before `runPost()` succeeds. Existing `writeJson()`
calls create parent directories after success.

- [ ] **Step 6: Run targeted GREEN and regression tests**

```bash
bun test test/skill-surface.test.mjs \
  -t "post args|intent|snapshot-bound post emission|gate exit"
bun test test/skill-receipt-core.test.mjs test/skill-snapshot.test.mjs
```

Expected: all selected tests PASS.

- [ ] **Step 7: Perform adversarial post-review and fix**

Run:

```bash
rg -n "\\bintent\\b" \
  lib/skill-decision.mjs lib/measure.mjs lib/contract.mjs \
  lib/structure.mjs lib/vuln.mjs lib/slop.mjs lib/skill-action.mjs
```

Expected: no new intent parameter or use. Then run:

```bash
bun test test/skill-surface.test.mjs --rerun-each 2
git diff --check
```

Probe an unreadable intent and a schema-invalid but parseable intent through
both post and gate. Both must exit `2`; neither may create a decision. Record
the exact observed stderr codes.

- [ ] **Step 8: Commit Task 5**

```bash
git add \
  lib/skill-post-args.mjs \
  lib/skill-post.mjs \
  lib/skill-gate.mjs \
  test/skill-surface.test.mjs \
  docs/superpowers/plans/2026-07-27-intent-packet-execution.md
git commit -m "feat: emit intent-bound post receipts"
```

---

### Task 6: Intent-Aware Receipt Verification

**Files:**
- Modify: `lib/skill-receipt.mjs:19-56,99-292,395-535`
- Modify: `test/skill-receipt-cli.test.mjs:1-930`
- Modify: `docs/superpowers/plans/2026-07-27-intent-packet-execution.md`

**Interfaces:**
- Consumes:
  generic `validateReceiptShape()`;
  `snapshotIntent()`;
  v2 `verifyDecisionBinding()`.
- Produces:
  strict `aesthete-receipt verify ... --intent <path>` behavior.

- [ ] **Step 1: Record the Task 6 adversarial pre-review**

Append:

```markdown
## Task 6 — Receipt verification

### Pre-review

- V1 plus `--intent` is `CURRENT_INPUT_INVALID`, not stale.
- V2 bound without `--intent` is `CURRENT_INPUT_INVALID`, not stale.
- V2 not-requested plus no flag can be current.
- V2 not-requested plus a valid flag is stale `INTENT_CHANGED`.
- Invalid current intent is `INTENT_INPUT_INVALID`, never a verification result.
- Gate: READY when every matrix row has one process-level test.
```

- [ ] **Step 2: Write failing parser and matrix tests**

Extend parser expectations:

```js
expect(parseReceiptArgs([
  'verify',
  'decision.json',
  'artifact.svg',
  '--intent',
  'intent.json',
])).toMatchObject({
  flags: { intent: 'intent.json' },
});
```

Add to the fixture-based verifier suite:

```js
import { makeIntent } from './helpers/intent-fixture.mjs';

function writeIntent(name, goal) {
  const intentPath = path.join(tempDir, name);
  fs.writeFileSync(intentPath, JSON.stringify(makeIntent(goal)));
  return intentPath;
}

async function expectInputCode(promise, code) {
  try {
    await promise;
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error.code).toBe(code);
  }
}

test('v2 intent current/stale/missing matrix is exact', async () => {
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

  await expectInputCode(
    verifyReceiptFiles({
      decisionPath: emitted.decisionPath,
      artifactPath: goodPath,
      flags: {},
    }, { root: fixtureRoot }),
    'CURRENT_INPUT_INVALID',
  );
});
```

Place `writeIntent()` and `expectInputCode()` inside the existing
fixture-based `describe` block, after its `tempDir` setup, so each test writes
only beneath that suite's temporary directory. Add:

- new v2 `not_requested` receipt + supplied intent → stale;
- malformed supplied intent → `INTENT_INPUT_INVALID`;
- stored v1 receipt + supplied intent → `CURRENT_INPUT_INVALID`;
- duplicate `--intent` and missing value → process exit `2`;
- `checked` contains `intent.status` and `intent.sha256` only for v2.

- [ ] **Step 3: Run tests and verify RED**

```bash
bun test test/skill-receipt-cli.test.mjs -t "intent"
```

Expected: FAIL because receipt args and verification do not accept intent.

- [ ] **Step 4: Normalize the verifier intent flag**

Add `intent` to `VALUE_FLAGS`. In `normalizeCurrentFlags()`:

```js
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
```

Return `intentPath` beside `contractPath`.

- [ ] **Step 5: Dispatch stored versions and construct exact current input**

Import `validateReceiptShape` and `snapshotIntent`. Replace the stored shape
call with generic dispatch.

Before current resource I/O:

```js
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
```

After validator creation:

```js
const requestedIntent = flags.intentPath === null
  ? null
  : validateRequestedIntent(flags.intentPath, context.io, validator);
```

Use the same exact `validateRequestedIntent()` wrapper as Task 5. Build current
input with no `intent` key for v1 and an exact key for v2:

```js
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
```

- [ ] **Step 6: Run targeted GREEN and process tests**

```bash
bun test test/skill-receipt-cli.test.mjs -t "intent|arguments|current|stale"
bun test test/skill-receipt-core.test.mjs
```

Expected: all selected tests PASS.

- [ ] **Step 7: Perform adversarial post-review and fix**

Run the real CLI for all five relevant paths:

```bash
bun lib/skill-receipt.mjs verify decision-v2.json artifact.json \
  --intent intent-same.json
bun lib/skill-receipt.mjs verify decision-v2.json artifact.json \
  --intent intent-changed.json
bun lib/skill-receipt.mjs verify decision-v2.json artifact.json
bun lib/skill-receipt.mjs verify decision-v2-not-requested.json artifact.json \
  --intent intent-same.json
bun lib/skill-receipt.mjs verify decision-v1.json artifact.json \
  --intent intent-same.json
```

Use test-created fixture paths rather than committing generated receipts. The
observed exits must be `0,1,2,1,2`. Record stdout/stderr and fix any path that
returns a verification result when current intent is invalid.

Then:

```bash
bun test test/skill-receipt-cli.test.mjs --rerun-each 2
git diff --check
```

- [ ] **Step 8: Commit Task 6**

```bash
git add \
  lib/skill-receipt.mjs \
  test/skill-receipt-cli.test.mjs \
  docs/superpowers/plans/2026-07-27-intent-packet-execution.md
git commit -m "feat: verify intent receipt freshness"
```

---

### Task 7: End-to-End Failure Atomicity and Invariance Hardening

**Files:**
- Modify: `test/skill-surface.test.mjs`
- Modify: `test/skill-receipt-cli.test.mjs`
- Modify: `test/skill-receipt-core.test.mjs`
- Modify only if a test exposes a defect:
  `lib/skill-pre.mjs`, `lib/skill-post.mjs`, `lib/skill-gate.mjs`,
  `lib/skill-receipt.mjs`, `lib/skill-receipt-core.mjs`,
  `lib/skill-snapshot.mjs`
- Modify: `docs/superpowers/plans/2026-07-27-intent-packet-execution.md`

**Interfaces:**
- No new public interface.
- Delivers cross-layer acceptance evidence for the approved spec.

- [ ] **Step 1: Record the Task 7 adversarial pre-review**

Append:

```markdown
## Task 7 — Cross-layer hardening

### Pre-review

- This task adds no feature surface.
- Tests attack ordering, first-buffer coherence, output atomicity, v1 pinning, and decision invariance.
- Any production edit must correspond to a reproduced failing test.
- Gate: READY when each approved acceptance criterion maps to a named test.
```

- [ ] **Step 2: Add the full acceptance matrix**

Add or consolidate named tests for:

```text
pre intent same brief -> byte-identical JSON output
pre intent missing values -> no inferred strings
pre invalid scope contradiction -> no output directory
post invalid intent -> no decision/report/advisory files
gate invalid intent -> no decision/report/advisory files
post mutating intent reader -> first bytes used by validation and digest
intent A vs B -> identical decisionCore, claim_scope, policy, and action
new no-intent post -> binding/v2 intent not_requested
legacy synthetic v1 -> pinned validator behavior
v2 same/changed/added/removed/invalid -> exact current/stale/error matrix
stale ordering -> artifact, contract, intent, action, policy, manifests
checked fields -> version-specific exact arrays
```

The decision-invariance assertion must compare:

```js
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
```

- [ ] **Step 3: Run the matrix and observe any RED failures**

```bash
bun test \
  test/skill-intent.test.mjs \
  test/skill-snapshot.test.mjs \
  test/skill-receipt-core.test.mjs \
  test/skill-surface.test.mjs \
  test/skill-receipt-cli.test.mjs
```

Expected: newly added attack cases may fail only where an implementation defect
remains. Record each failure before changing production code.

- [ ] **Step 4: Fix only reproduced defects**

For each failure:

1. write the exact input and observed result in the execution record;
2. identify the single owning module from the design responsibility table;
3. patch that module without adding a second owner;
4. rerun the single failing test;
5. rerun the five-file matrix.

Use no intent branch in `foldDecision()` as a hard invariant.

- [ ] **Step 5: Perform the Task 7 adversarial post-review**

Run:

```bash
rg -n "\\bintent\\b" lib | sort
rg -n "foldDecision\\(" lib/skill-post.mjs lib/skill-gate.mjs
git diff --check
```

Every `intent` hit must belong to pre, snapshot, post intake/binding, receipt
validation, or CLI plumbing. No hit may appear in measure, decision,
structure, lint, vuln, slop, contract, or action modules.

Run mutation probes:

- add an unknown key to `intent.json`;
- duplicate `goal`;
- append only a newline;
- delete the current intent after receipt creation;
- replace v2 schema string with v3;
- add `intent` to a v1 binding;
- remove `intent` from v2.

Confirm exact schema/input/stale behavior and record it.

- [ ] **Step 6: Run GREEN acceptance and broader regression tests**

```bash
bun test \
  test/skill-intent.test.mjs \
  test/skill-snapshot.test.mjs \
  test/skill-receipt-core.test.mjs \
  test/skill-surface.test.mjs \
  test/skill-receipt-cli.test.mjs
bun test test/skill-action.test.mjs test/preflight.test.mjs test/contract.test.mjs
```

Expected: all selected tests PASS.

- [ ] **Step 7: Commit Task 7**

Stage only the tests, execution record, and production files changed by a
reproduced defect:

```bash
git add \
  test/skill-intent.test.mjs \
  test/skill-snapshot.test.mjs \
  test/skill-receipt-core.test.mjs \
  test/skill-surface.test.mjs \
  test/skill-receipt-cli.test.mjs \
  docs/superpowers/plans/2026-07-27-intent-packet-execution.md
git add lib/skill-pre.mjs lib/skill-post.mjs lib/skill-gate.mjs \
  lib/skill-receipt.mjs lib/skill-receipt-core.mjs lib/skill-snapshot.mjs
git diff --cached --name-only
git commit -m "test: harden intent packet invariants"
```

Before committing, unstage any listed production file that has no actual diff.

---

### Task 8: Skill Surface, Integration Docs, and Example

**Files:**
- Create: `examples/dashboard-intent-brief.json`
- Modify: `README.md`
- Modify: `SKILL.md`
- Modify: `skills/aesthete-pre/SKILL.md`
- Modify: `skills/aesthete-post/SKILL.md`
- Modify: `skills/aesthete-gate/SKILL.md`
- Modify: `docs/agent-llm-usage.md`
- Modify: `docs/integration/generator-contract.md`
- Modify: `test/skill-surface.test.mjs`
- Modify: `docs/superpowers/plans/2026-07-27-intent-packet-execution.md`

**Interfaces:**
- Documents the exact commands:
  pre output `intent.json`;
  post/gate `--intent`;
  receipt verify `--intent`.
- Requires `superpowers:writing-skills` during execution because SKILL files
  change.

- [ ] **Step 1: Invoke `superpowers:writing-skills` and record the pre-review**

Append:

```markdown
## Task 8 — Skills and documentation

### Pre-review

- Every documented post/gate/verify example passes the same intent path.
- Every skill says intent is generation context, not evaluator input.
- Scope and priority claims remain non-enforced.
- `pass` and `current` keep their existing narrow meanings.
- No borrowed numeric UI rule or prose from reviewed external repositories is copied.
- Gate: READY when all command surfaces are listed by one `rg` query.
```

Run:

```bash
rg -n "skill-pre|skill-post|skill-gate|skill-receipt|prompt_bullets|contract.json" \
  README.md SKILL.md skills docs/agent-llm-usage.md \
  docs/integration/generator-contract.md
```

- [ ] **Step 2: Add the full example brief**

Create `examples/dashboard-intent-brief.json`:

```json
{
  "artifact_type": "dashboard",
  "format": "html",
  "brief": "운영 지표를 빠르게 판단하는 대시보드",
  "canvas": { "w": 1440, "h": 900 },
  "scope": {
    "included": ["운영 현황 화면", "이상 지표 탐색"],
    "excluded": ["관리자 설정", "사용자 권한 편집"]
  },
  "content_priority": [
    "이상 지표와 심각도",
    "원인 확인에 필요한 추세",
    "후속 조치"
  ],
  "audience": "일일 운영 담당자",
  "audience_frequency": "daily",
  "desired_action": "이상 지표를 찾아 후속 조치한다",
  "source_mode": "continue_improve",
  "must_preserve": ["승인된 수치", "브랜드 색상"],
  "must_not_assume": ["누락된 수치", "사용자 승인"]
}
```

- [ ] **Step 3: Write the failing documentation smoke test**

Add a process test that:

1. runs pre with the new example;
2. runs post with both `--contract PRE/contract.json` and
   `--intent PRE/intent.json`;
3. verifies with both paths;
4. asserts verifier exit `0`.

The command argv is:

```js
[
  '--no-install',
  path.join(root, 'lib', 'skill-post.mjs'),
  goodPath,
  '--contract',
  path.join(preDir, 'contract.json'),
  '--intent',
  path.join(preDir, 'intent.json'),
  '--out-dir',
  postDir,
]
```

and:

```js
[
  '--no-install',
  path.join(root, 'lib', 'skill-receipt.mjs'),
  'verify',
  path.join(postDir, 'decision.json'),
  goodPath,
  '--contract',
  path.join(preDir, 'contract.json'),
  '--intent',
  path.join(preDir, 'intent.json'),
]
```

- [ ] **Step 4: Run the smoke test and verify RED**

```bash
bun test test/skill-surface.test.mjs -t "documented intent pipeline"
```

Expected: FAIL until the example and all command paths are present.

- [ ] **Step 5: Update every skill and integration surface**

Use this canonical pipeline in root and subskill docs:

```bash
bun lib/skill-pre.mjs examples/dashboard-intent-brief.json --out-dir PRE

# Generator input:
# PRE/prompt_bullets.md

bun lib/skill-post.mjs artifact.html \
  --contract PRE/contract.json \
  --intent PRE/intent.json \
  --out-dir POST

bun lib/skill-receipt.mjs verify POST/decision.json artifact.html \
  --contract PRE/contract.json \
  --intent PRE/intent.json
```

Document these exact boundaries:

```text
intent.goal/scope/content_priority/audience/source -> generator context
intent digest -> receipt freshness
intent -> never a measurement or fold input
scope -> not implementation or review coverage
content_priority -> not proof of reading order
must_preserve/must_not_assume -> not geometric enforcement
current -> content freshness/internal consistency only
pass -> no enabled blocking rule triggered only
human approval -> never established
```

Update output tables so pre lists `intent.json`. Update usage strings and
examples for post, gate, and receipt. Preserve the legacy no-intent path as
supported but mark the full pipeline as recommended.

- [ ] **Step 6: Run documentation smoke GREEN**

```bash
bun test test/skill-surface.test.mjs -t "documented intent pipeline"
bun lib/skill-pre.mjs examples/dashboard-intent-brief.json \
  --out-dir /tmp/aesthete-intent-doc-pre
test -f /tmp/aesthete-intent-doc-pre/intent.json
```

Expected: test PASS, CLI exit `0`, file check succeeds.

- [ ] **Step 7: Perform adversarial documentation post-review and fix**

Run:

```bash
rg -n "intent|current|pass|human approval|scope|priority" \
  README.md SKILL.md skills/aesthete-* docs/agent-llm-usage.md \
  docs/integration/generator-contract.md
rg -n "quick|full|OKLCH|ARIA|WCAG.*intent" \
  README.md SKILL.md skills/aesthete-* docs/agent-llm-usage.md \
  docs/integration/generator-contract.md
git diff --check
```

The second command must not show imported external review modes or unrelated
domain rules attributed to intent. Confirm every verifier example passes the
same intent path used by post/gate.

- [ ] **Step 8: Commit Task 8**

```bash
git add \
  examples/dashboard-intent-brief.json \
  README.md \
  SKILL.md \
  skills/aesthete-pre/SKILL.md \
  skills/aesthete-post/SKILL.md \
  skills/aesthete-gate/SKILL.md \
  docs/agent-llm-usage.md \
  docs/integration/generator-contract.md \
  test/skill-surface.test.mjs \
  docs/superpowers/plans/2026-07-27-intent-packet-execution.md
git commit -m "docs: teach the intent-bound pipeline"
```

---

### Task 9: Full Verification and Final Adversarial Gate

**Files:**
- Modify only when verification exposes a reproducible defect:
  files owned by Tasks 1-8
- Modify: `docs/superpowers/plans/2026-07-27-intent-packet-execution.md`

**Interfaces:**
- No new interface.
- Delivers final evidence that the approved feature is ready.

- [ ] **Step 1: Record the final pre-review**

Append:

```markdown
## Task 9 — Final gate

### Pre-review

- All eight implementation commits are present.
- No task-owned file remains unstaged or uncommitted.
- User-owned `AGENTS.md` remains untracked and untouched.
- Final claims require fresh command output from this task.
```

- [ ] **Step 2: Run static boundary checks**

```bash
rg -n "\\bintent\\b" \
  lib/skill-decision.mjs lib/measure.mjs lib/contract.mjs \
  lib/structure.mjs lib/tokens.mjs lib/vuln.mjs lib/slop.mjs \
  lib/skill-action.mjs
git diff --check
git status --short
```

Expected:

- no intent use in evaluator/fold/action modules;
- no whitespace errors;
- only the execution record may be modified;
- `?? AGENTS.md` remains present and unstaged.

- [ ] **Step 3: Run focused intent and receipt tests**

```bash
bun test \
  test/skill-intent.test.mjs \
  test/skill-snapshot.test.mjs \
  test/skill-receipt-core.test.mjs \
  test/skill-surface.test.mjs \
  test/skill-receipt-cli.test.mjs \
  test/skill-action.test.mjs
```

Expected: all selected tests PASS with zero failures.

- [ ] **Step 4: Run the full repository suite**

```bash
npm test
```

Expected:

```text
test/golden.mjs passes
bun test reports 0 fail
process exits 0
```

- [ ] **Step 5: Run real end-to-end commands**

```bash
pre_dir=$(mktemp -d /tmp/aesthete-intent-pre.XXXXXX)
post_dir=$(mktemp -d /tmp/aesthete-intent-post.XXXXXX)
bun lib/skill-pre.mjs examples/dashboard-intent-brief.json \
  --out-dir "$pre_dir"
bun lib/skill-post.mjs examples/catalog-good.layout.json \
  --contract "$pre_dir/contract.json" \
  --intent "$pre_dir/intent.json" \
  --out-dir "$post_dir"
bun lib/skill-receipt.mjs verify "$post_dir/decision.json" \
  examples/catalog-good.layout.json \
  --contract "$pre_dir/contract.json" \
  --intent "$pre_dir/intent.json"
```

Expected:

```text
pre exit 0 and emits intent.json
post exit 0 and emits binding schema aesthete.binding/v2
receipt status=current issues=0 and exit 0
```

Copy the intent, append one newline, and rerun verifier against the changed
copy. Expected: `receipt status=stale issues=1`, issue
`INTENT_CHANGED`, exit `1`.

- [ ] **Step 6: Perform the final adversarial review**

Review the complete diff from the approved spec commit:

```bash
git diff --stat 122f6c1..HEAD
git diff --color=never 122f6c1..HEAD -- \
  schemas lib test README.md SKILL.md skills docs examples
```

Answer these exact questions in the execution record:

1. Can any intent field reach `foldDecision()` through an object spread?
2. Can post/gate create a decision after an invalid requested intent?
3. Can a v2 receipt omit intent and still validate?
4. Can a v1 receipt accept the v2 field?
5. Can a bound v2 receipt verify without current intent bytes?
6. Does a not-requested v2 receipt become stale when intent is newly supplied?
7. Do `policy_sha256` and `decision_core_sha256` remain intent-independent?
8. Are all schema and installation manifest effects documented?
9. Do docs avoid claiming accessibility, responsive-runtime, comprehension,
   or approval coverage?
10. Is `AGENTS.md` absent from every commit?

The final gate is `READY` only when every answer is backed by code or test
evidence and no high-impact finding remains.

- [ ] **Step 7: Fix verified findings and rerun all verification**

For each finding, add or retain a reproducing test, patch the owning module,
and rerun Steps 2-5. Do not accept a finding solely from speculation.

If no production change is required, do not create an empty fix commit.

- [ ] **Step 8: Commit the final execution evidence**

```bash
git add docs/superpowers/plans/2026-07-27-intent-packet-execution.md
git commit -m "docs: record intent packet verification"
```

Then verify:

```bash
git status --short --branch
git log --oneline --decorate -12
```

Expected: the only untracked path is the user-owned `AGENTS.md`.

---

## Completion Conditions

The plan is complete only when:

1. all Task 1-9 checkboxes are recorded in the execution file;
2. every task has both pre- and post-adversarial evidence;
3. all targeted and full tests pass from fresh output;
4. the real pre/post/verify pipeline returns `current`;
5. a byte-only intent change returns `INTENT_CHANGED`;
6. v1 remains pinned and v2 remains exact;
7. decision invariance is tested across two valid intents;
8. documentation uses the same intent path through post/gate/verify;
9. no independent review is claimed unless a fixed-model reviewer actually
   completed;
10. `AGENTS.md` remains untouched and unstaged.

---

## Plan Self-Review

### Approved-spec coverage

- Sections 1-3 (goal, adopted insight, semantics): Goal, Architecture, and
  Global Constraints.
- Sections 4-5 (intent and brief schemas): Task 1.
- Sections 6-7 (pre pipeline and one-owner boundaries): Tasks 1-2 plus the
  File Map.
- Section 8 (strict snapshot boundary): Tasks 3 and 5.
- Sections 9-10 (v1/v2 receipt and verification matrix): Tasks 4 and 6.
- Sections 11-12 (fail-closed handling and decision invariance): Tasks 5-7.
- Section 13 (test strategy): Tasks 1-7 and final Task 9 regression runs.
- Section 14 (documentation and skill surface): Task 8.
- Sections 15-16 (task loop and acceptance): Task 9 and Completion
  Conditions.

### Interface and ownership consistency

- `buildIntentPacket(brief, spec)` and `renderIntentPromptBullets(intent)` are
  defined once in Task 1 and consumed by Task 2.
- `snapshotIntent(filePath, io)` is defined once in Task 3 and consumed only
  at post/gate/receipt input boundaries.
- Pinned `buildDecisionBinding()` and `validateReceiptV1Shape()` remain v1;
  Task 4 adds `buildDecisionBindingV2()`, `validateReceiptV2Shape()`, and
  schema-dispatched `validateReceiptShape()`.
- Task 5 emits v2; Task 6 verifies both versions with version-specific exact
  current-input shapes.
- Intent values terminate at prompt rendering and snapshot validation. Only
  `{status, sha256}` crosses into the receipt binding.
- No task adds intent to evaluator, fold, claim-scope, policy, scanner, or
  fix-action interfaces.

### Gap and execution audit

- All approved acceptance criteria map to at least one named test and one
  final verification check.
- Each implementation task includes RED, GREEN, adversarial post-review,
  evidence recording, correction, and a scoped commit.
- All sample helpers and public interfaces used in code blocks are defined in
  the plan or already exist in the named test/module.
- All JSON alternatives use exact key sets; v1 preservation and v2 dispatch
  are explicit.
- The plan contains no unresolved implementation markers.
- User-owned `AGENTS.md` is excluded from every write and staging command.
