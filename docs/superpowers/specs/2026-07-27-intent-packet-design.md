# Intent Packet Design

**Status:** Revised after external skill-architecture review; awaiting user review

**Aesthete baseline:** `origin/main` at
`ea5c3a0c0498f481e40cd0216b4ea0491d9fc5d4`; local feature head before this
spec at `8e6b90d288001f18bdf078f2d88933d37ff72034`

**Revision baseline:** prior design commit
`ffd7d343a7c3583dae366f620987d03a56d6b1cb` was 28 commits ahead of and 0
commits behind `origin/main`

**Concept review sources:**

- [`vibeworkers/visual-authoring`](https://github.com/vibeworkers/visual-authoring)
  main at `16c23819dd5136585fd43736b400eae7a1d6324a`;
- [`jakubkrehel/skills`](https://github.com/jakubkrehel/skills) main at
  `79a09456be60419e652e63fc9e057b5587d051ea`.

## 1. Goal

Add a deterministic, machine-readable intent packet between Aesthete's brief
and generated artifact. The packet records why an artifact is being made, its
included and excluded scope, the intended content priority, for whom it is
made, what action it should support, what source state must be preserved, and
what the generator must not assume.

The packet has two roles:

1. give the generator explicit context through deterministic prompt bullets;
2. let a decision receipt detect whether the declared generation context has
   changed since post-processing.

The packet is not an evaluator. It must never alter Aesthete's measurement
formulas, fold priority, or `pass | fix_geometry | regenerate | human`
decision.

## 2. Reviewed Insight and Independence Boundary

The useful concepts reviewed in `visual-authoring` are:

- fix source, audience, desired change or action, and output before authoring;
- distinguish what must be preserved from what is unknown;
- do not fill missing facts with generic assumptions;
- keep structural, visual, runtime, and human approval claims separate;
- leave final approval to a human.

The useful concepts reviewed in `jakubkrehel/skills` are:

- resolve the exact reviewed screen, flow, feature, or repository boundary
  before making claims;
- never imply that an uninspected surface was reviewed;
- let content importance determine reading order and hierarchy;
- give each rule and review domain one owner instead of duplicating it across
  orchestrators;
- separate evidence, unverified coverage, findings, and final verdict;
- preserve established project conventions unless a migration is in scope.

Aesthete adopts only the high-level principles that fit this feature. This
design does not copy source code, schemas, field ordering, taxonomy ordering,
test wording, numeric UI recipes, or prose from either reviewed repository.
Aesthete keeps its own deterministic pre/post architecture and narrow
geometric decision contract.

### 2.1 Adopted now

Two reviewed principles change the intent packet:

1. explicit included and excluded scope, so a broad goal cannot silently
   expand into unrequested surfaces;
2. explicit ordered content priority, so the generator does not have to infer
   which information should dominate the layout.

The second change is Aesthete's design inference from the reviewed
importance-ordering principle; the source repository does not define this
packet or field. The one-owner principle also sharpens module boundaries in
Section 7.

### 2.2 Deliberately not adopted in this feature

- `quick | full` review modes are not intent. Aesthete's actual enabled checks
  already live in receipt-bound post policy; duplicating them in intent would
  create a second policy source.
- Accessibility, typography, color, writing, and motion rules are separate
  domains. Aesthete must not claim those reviews from geometric evidence it
  does not have.
- Shared severity scales, finding caps, before/after recommendations, and
  considered-but-rejected findings belong to review presentation, not the
  generation-context packet.
- Responsive, RTL, zoom, keyboard, and screen-reader verification require
  runtime evidence. A declared canvas or scope must not be presented as that
  evidence.

The future interactive viewport should reuse the reviewed evidence discipline:
show exact scope, measured or unmeasured coverage, evidence location,
verification gaps, and consolidated root causes. That follow-up must not alter
the arithmetic decision fold.

## 3. Selected Semantics

The selected approach is **generation context plus freshness only**:

- `aesthete-pre` emits `intent.json`;
- intent values add deterministic generator-facing prompt bullets;
- `aesthete-post --intent <path>` snapshots and binds the packet;
- receipt verification reports a changed packet as stale;
- the packet is never supplied to `foldDecision()` or a measurement routine.

Rejected alternatives:

- **Policy input:** treating intent as evaluator policy would blur generation
  context with arithmetic decision criteria.
- **Decision gate:** routing missing or mismatched intent directly to
  `human` or `regenerate` would let declared prose override measured evidence.
- **Display only:** omitting receipt binding would allow a viewport to show
  intent that was not the intent attached to the stored decision.

## 4. Intent Schema

Add `schemas/intent.schema.json` with an exact,
`additionalProperties: false` object:

```json
{
  "schema": "aesthete.intent/v1",
  "schema_version": 1,
  "goal": "운영 지표를 빠르게 판단하는 대시보드",
  "scope": {
    "included": ["운영 현황 화면", "이상 지표 탐색"],
    "excluded": ["관리자 설정", "사용자 권한 편집"]
  },
  "content_priority": [
    "이상 지표와 심각도",
    "원인 확인에 필요한 추세",
    "후속 조치"
  ],
  "artifact": {
    "requested_type": "dashboard",
    "effective_type": "dashboard",
    "format": "html",
    "canvas": { "w": 1440, "h": 900 }
  },
  "audience": {
    "description": "일일 운영 담당자",
    "frequency": "daily"
  },
  "desired_action": "이상 지표를 찾아 후속 조치한다",
  "source": {
    "mode": "continue_improve",
    "must_preserve": ["승인된 수치", "브랜드 색상"],
    "must_not_assume": ["누락된 수치", "사용자 승인"]
  },
  "claim_scope": {
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
```

### 4.1 Exact field rules

| Field | Rule |
|---|---|
| `schema` | Exact value `aesthete.intent/v1` |
| `schema_version` | Exact integer `1` |
| `goal` | Non-whitespace string or `null` |
| `scope.included` | Ordered unique non-whitespace strings |
| `scope.excluded` | Ordered unique non-whitespace strings |
| `content_priority` | Ordered unique non-whitespace strings, highest priority first |
| `artifact.requested_type` | Original non-whitespace `brief.artifact_type` |
| `artifact.effective_type` | Profile-resolved type from preflight, including `generic` fallback |
| `artifact.format` | Existing format enum or `null` |
| `artifact.canvas` | Existing `{w,h}` object or `null` |
| `audience.description` | Non-whitespace string or `null` |
| `audience.frequency` | `daily | weekly | once` or `null` |
| `desired_action` | Non-whitespace string or `null` |
| `source.mode` | `new | continue_improve | fresh_start | unspecified` |
| `source.must_preserve` | Ordered unique non-whitespace strings |
| `source.must_not_assume` | Ordered unique non-whitespace strings |
| `claim_scope` | Fixed literal object shown above |

All keys are always present. Optional scalar values use `null`, optional lists
use `[]`, both scope lists remain present even when empty, and an omitted
source mode becomes `unspecified`. The builder preserves input strings and
list order; it does not trim, sort, paraphrase, deduplicate, or infer values.
Brief validation rejects whitespace-only strings and duplicate list members
before the builder runs.

`scope.included` and `scope.excluded` are declared generation boundaries, not
proof of inspected or implemented coverage. `content_priority` order is an
instruction to the generator, not proof that the resulting reading order
satisfies it.

## 5. Brief Extension

Extend `schemas/brief.schema.json` with these optional properties:

```json
{
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
  "desired_action": "이상 지표를 찾아 후속 조치한다",
  "source_mode": "continue_improve",
  "must_preserve": ["승인된 수치", "브랜드 색상"],
  "must_not_assume": ["누락된 수치", "사용자 승인"]
}
```

The existing fields map as follows:

- `brief` → `intent.goal`;
- `artifact_type` → `intent.artifact.requested_type`;
- resolved preflight type → `intent.artifact.effective_type`;
- `format` and `canvas` → the corresponding artifact fields;
- `audience_frequency` → `intent.audience.frequency`.

The new `scope`, `content_priority`, `audience`, `desired_action`,
`source_mode`, `must_preserve`, and `must_not_assume` fields map directly to
their intent counterparts.

All new fields are optional for backward compatibility. Their absence produces
explicit empty or unknown values rather than generated guesses. If the same
non-empty string appears in both `scope.included` and `scope.excluded`,
`buildIntentPacket()` rejects the exact-string contradiction after brief
schema validation instead of choosing one side. This comparison is
case-sensitive and does not attempt semantic synonym detection.

## 6. Pre Architecture and Output

Create `lib/skill-intent.mjs` as a pure module:

```text
buildIntentPacket(brief, spec) -> intent
renderIntentPromptBullets(intent) -> string[]
```

`buildIntentPacket()` depends only on the validated brief and resolved
preflight spec. It performs no filesystem or network I/O.

`runPre()` performs this sequence:

1. validate and resolve the existing preflight spec;
2. build the intent packet;
3. validate the packet against `intent.schema.json`;
4. render intent bullets in a fixed order;
5. append those bullets to the existing generator-facing bullets;
6. return all in-memory values without writing.

The CLI writes:

```text
<out-dir>/pre.json
<out-dir>/contract.json
<out-dir>/intent.json
<out-dir>/prompt_bullets.md
<out-dir>/slop-test.md
```

`intent.json` is the single source of truth. `pre.json` adds only
`intent_path`; it does not embed a second copy of the packet.

Intent bullets use a fixed order:

1. declared goal, when present;
2. one included-scope bullet per declared entry;
3. one excluded-scope bullet per declared entry;
4. one numbered priority bullet per `content_priority` entry;
5. audience description and frequency, when present;
6. desired action, when present;
7. source mode, unless `unspecified`;
8. one bullet per `must_preserve` entry;
9. one bullet per `must_not_assume` entry.

No bullet is invented for a missing value. Existing structural, budget,
negation, and anti-slop bullets retain their current relative ordering. Intent
bullets are appended as one contiguous block so their provenance remains
testable.

## 7. Responsibility Ownership

Each concern has one owner:

| Concern | Owner | Must not own |
|---|---|---|
| Declared context normalization and intent bullets | `lib/skill-intent.mjs` | geometry, review severity, receipt freshness |
| Pre orchestration and file emission | `lib/skill-pre.mjs` | intent inference, post decisions |
| Geometry and signature evidence | existing measure/lint/vuln/slop modules | intent truth or human approval |
| Decision fold | existing `foldDecision()` | intent fields or viewport presentation |
| Intent snapshot and digest | `lib/skill-snapshot.mjs` | prompt rendering or decision changes |
| Binding validation and freshness comparison | `lib/skill-receipt-core.mjs` | domain measurement rules |
| Review presentation and coverage consolidation | future interactive viewport | re-evaluation or decision override |

Cross-domain concerns are handed off rather than reimplemented. In particular,
the intent packet may declare a desired action or priority, but no module may
turn that declaration into an accessibility, typography, responsive-runtime,
or comprehension claim.

## 8. Post Snapshot Boundary

Add optional `--intent <path>` support to `aesthete-post` and
`aesthete-gate`.

When requested, the intent packet follows the same single-snapshot rule as
other receipt-bound inputs:

1. read the file exactly once through the operation-scoped buffered I/O;
2. parse those bytes with the duplicate-key-aware strict JSON parser;
3. validate the parsed value against the snapshotted schema bundle;
4. compute SHA-256 from the same original bytes;
5. attach only the resulting status and digest to the receipt builder.

The intent value is not passed to adapters, scanners, contract evaluation,
claim-scope construction, `foldDecision()`, or action construction.

If `--intent` is absent, post-processing continues normally and records
`not_requested`.

## 9. Receipt Versioning

Keep the outer decision at `aesthete.decision/v1`. Add
`aesthete.binding/v2` rather than changing the exact v1 binding shape.

New post and gate emissions use v2. Existing v1 decisions remain
shape-valid and retain their existing verification semantics. As before, a
stored v1 receipt may still report stale when the current schema or
installation manifest differs; adding `intent.schema.json` is such a manifest
change for receipts created before this feature.

The v2 binding adds exactly one field to the v1 shape:

```json
{
  "intent": {
    "status": "bound",
    "sha256": "lowercase-sha256"
  }
}
```

The intent binding is:

```text
bound         -> sha256 is a lowercase 64-character digest
not_requested -> sha256 is null
```

The field sits beside `artifact`, `contract`, and `action_inputs`; it is not
inside `policy`. Intent therefore participates in content freshness but not
evaluator-policy freshness.

The following remain unchanged:

- `decisionCore()` fields and digest;
- `claim_scope`;
- `policy` and `policy_sha256`;
- artifact completeness semantics;
- action binding semantics;
- decision and gate exit behavior.

Receipt validation dispatches on `binding.schema`:

- `aesthete.binding/v1` → pinned v1 shape and current v1 comparison;
- `aesthete.binding/v2` → exact v2 shape and intent-aware comparison;
- any other value → `RECEIPT_SCHEMA_INVALID`.

Do not mutate the v1 validator to accept v2 fields.

## 10. Verification Semantics

Add `--intent <path>` to `aesthete-receipt verify`.

For v2 receipts:

| Stored intent | Current invocation | Result |
|---|---|---|
| `bound` | same valid bytes | unchanged |
| `bound` | different valid bytes | stale: `INTENT_CHANGED` |
| `bound` | missing `--intent` | input error: `CURRENT_INPUT_INVALID` |
| `not_requested` | no `--intent` | unchanged |
| `not_requested` | valid `--intent` supplied | stale: `INTENT_CHANGED` |
| either | requested file unreadable or invalid | input error: `INTENT_INPUT_INVALID` |

For v1 receipts, supplying `--intent` raises `CURRENT_INPUT_INVALID` with exit
`2` because v1 has no stored intent comparison contract. Omitting it preserves
current behavior.

`INTENT_CHANGED` is inserted after `CONTRACT_CHANGED` in deterministic stale
issue ordering. V2 `checked` output adds:

```text
intent.status
intent.sha256
```

The CLI keeps the existing status exit contract:

- `current` → `0`;
- `stale` → `1`;
- invalid, incomplete, unbound, usage, or input failure → `2`.

## 11. Error Handling

An explicitly requested intent file is a receipt input boundary. Unreadable
bytes, duplicate JSON keys, invalid Unicode, JSON parse failure, or schema
failure raises:

```text
INTENT_INPUT_INVALID
```

The error maps to exit `2`. Post and gate must not emit a receipt-backed
decision from an invalid requested intent. Receipt verification must not emit
a `current` or `stale` result when the current intent cannot be validated.

Brief schema failures retain the existing pre CLI error behavior. Output
directories are not created until the brief and in-memory intent packet are
valid.

## 12. Decision Invariance

The central acceptance property is:

> For identical artifact, contract, flags, resources, runtime, and installation,
> changing only a valid intent packet, including scope or priority, may change
> generator bullets and
> `binding.intent.sha256`, but must not change `decision`, `reasons`, `scores`,
> `next`, `claim_scope`, `policy`, or `decision_core_sha256`.

This is enforced by both architecture and tests: evaluator functions have no
intent parameter, and a paired test compares the complete decision core for
two different valid packets.

## 13. Test Strategy

### 13.1 Intent unit tests

- exact minimal packet from a legacy brief;
- exact full packet from all new brief fields;
- byte-equivalent canonical output for repeated identical input;
- requested type versus effective generic fallback;
- fixed null, empty-list, and `unspecified` defaults;
- no inferred scope, priority, audience, action, source, or preservation claim;
- included/excluded scope contradiction rejection;
- ordered priority preservation and numbered prompt bullets;
- fixed claim-scope literals;
- stable prompt-bullet ordering;
- whitespace-only and duplicate-list input rejection.

### 13.2 Pre surface tests

- `runPre()` remains write-free;
- CLI emits `intent.json` and `pre.json.intent_path`;
- `prompt_bullets.md` includes each declared intent exactly once;
- included scope, excluded scope, and priority bullets retain fixed grouping
  and order;
- existing brief fixtures remain valid and deterministic;
- invalid intent-related brief data produces no output directory.

### 13.3 Post snapshot tests

- intent bytes are read exactly once;
- parsing, validation, and digesting use the first buffered bytes even if the
  backing file changes during execution;
- duplicate keys, lone surrogates, unreadable files, and schema violations
  fail with `INTENT_INPUT_INVALID`;
- no decision file is emitted after an invalid requested intent.

### 13.4 Receipt core tests

- exact v2 key and status validation;
- v1 receipts remain shape-valid and use the pinned v1 comparison behavior;
- a v1 receipt becomes current only when its stored manifests and all other
  existing inputs match, and otherwise retains the existing stale result;
- same, changed, added, removed, and invalid intent matrix;
- deterministic `INTENT_CHANGED` ordering and checked fields;
- unknown binding versions fail closed;
- changing only intent leaves the entire decision core identical.

### 13.5 CLI and regression tests

- strict `--intent` parsing: unknown, duplicate, or missing values fail;
- post, gate, and verifier exit/output contracts;
- legacy invocations without intent remain compatible;
- full repository test suite;
- skill and integration documentation examples stay synchronized.

## 14. Documentation and Skill Surface

Update:

- `README.md`;
- `SKILL.md`;
- `skills/aesthete-pre/SKILL.md`;
- `skills/aesthete-post/SKILL.md`;
- `skills/aesthete-gate/SKILL.md`;
- `docs/agent-llm-usage.md`;
- `docs/integration/generator-contract.md`;
- relevant examples and schema documentation.

Documentation must say:

- intent is declared generation context, not measured truth;
- declared scope is a generation boundary, not review or implementation
  coverage;
- declared content priority is not proof of resulting reading order;
- `must_preserve` and `must_not_assume` are generator instructions, not
  geometric enforcement;
- a current receipt proves content freshness and internal consistency only;
- intent does not establish correctness, fulfillment, comprehension, or
  approval;
- consumers may branch on `.decision` only after the receipt status is
  `current`.

## 15. Scope and Task Order

This spec is one feature-sized project and will be implemented in this order:

1. intent schema and pure builder;
2. pre integration and emission;
3. intent snapshot input boundary;
4. binding v2 core and pinned v1 compatibility;
5. post/gate emission;
6. receipt verification;
7. skill, integration, and example documentation;
8. full adversarial review and verification.

Each implementation task follows the requested loop:

```text
plan -> adversarial review -> implement -> adversarial review -> fix -> next task
```

Interactive viewport consumption is a later task. This design provides the
stable `intent.json` and receipt freshness surface that viewport work will
consume; it does not implement the viewport. Its later design should present
exact requested scope, evidence location, measured/unmeasured coverage,
verification gaps, and consolidated root causes without inventing unavailable
domain reviews or overriding the decision.

## 16. Acceptance Criteria

The feature is ready when:

1. pre always emits a schema-valid deterministic intent packet;
2. missing intent fields remain explicitly unknown and are never inferred;
3. included and excluded scope contradictions fail before output;
4. content priority remains ordered and reaches numbered generation bullets;
5. all other declared intent reaches generation prompt bullets;
6. post/gate can bind an optional strict single-snapshot intent input;
7. new receipts use exact binding v2 while pinned v1 receipts still verify;
8. changed intent yields deterministic `INTENT_CHANGED` staleness;
9. invalid requested intent fails closed with exit `2` and no decision output;
10. paired tests prove intent cannot alter the decision core;
11. all repository tests pass;
12. documentation preserves scope, evidence, measurement, and human-approval
    boundaries.
