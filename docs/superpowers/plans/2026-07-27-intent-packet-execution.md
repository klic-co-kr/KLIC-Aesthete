# Intent Packet Execution Record

## Task 1 — Intent schema and pure builder

### Pre-review

- Allowed writes: intent schema, brief schema, validator registration, pure intent module, intent unit tests.
- Forbidden dependencies: filesystem, network, evaluator, receipt, scanner, or LLM calls from `skill-intent.mjs`.
- Failure probes: whitespace-only values, duplicate list members, exact included/excluded collision, unknown fields, missing optional values, unknown artifact type.
- Gate: READY when every output key and prompt prefix has one deterministic source.

Baseline: `npm test` passed with 654 tests and 0 failures.

### RED

- `bun test test/skill-intent.test.mjs` failed because
  `lib/skill-intent.mjs` did not exist.
- After adding the pure module, the narrowed run failed with
  `unknown strict schema type: intent` and brief-schema rejection mismatches.
- The duplicate-list assertion was corrected to observe AJV's semantic
  `duplicate items` failure rather than an implementation-specific keyword.

### GREEN

- `bun test test/skill-intent.test.mjs`: 13 pass, 0 fail.
- `bun test test/preflight.test.mjs test/skill-snapshot.test.mjs`:
  66 pass, 0 fail.

### Post-review

- `rg -n "fs\\.|fetch\\(|foldDecision|measure|scan|receipt" lib/skill-intent.mjs`
  returned no matches.
- Case-sensitive scope comparison accepts `Settings` versus `settings`.
- The packet clones scope, priority, preservation, assumption, and canvas
  inputs; later brief mutation does not alter the packet.
- Unknown requested type remains declared while the effective type is
  `generic`.
- Repeated identical input is byte-equivalent under `JSON.stringify`.
- `bun test test/skill-intent.test.mjs --rerun-each 3`: 39 pass, 0 fail.
- `git diff --check`: pass.

Gate: READY. No accepted production finding remained after the test-message
correction.

## Task 2 — Pre integration

### Pre-review

- `runPre()` remains write-free but becomes async so it can complete schema validation.
- Existing structure, budget, negation, and slop bullet relative order is frozen.
- Intent bullets form one appended contiguous block.
- The CLI computes and validates every in-memory output before creating the output directory.
- `intent.json` is SSOT; `pre.json` contains only `intent_path`.
- Gate: READY when legacy briefs need no new field and all sync `runPre()` callers are enumerated.

Caller enumeration found nine test call sites and the CLI main. Every caller
was converted to `await`; no external runtime caller exists in this repository.

### RED

- The focused pre/intent run produced 20 passes and 2 expected failures.
- In-memory integration failed because `intentPath` was undefined.
- The CLI integration failed because `<out-dir>/intent.json` did not exist.
- Invalid whitespace-only intent input already failed before directory
  creation through the Task 1 brief-schema boundary.

### GREEN

- `bun test test/skill-intent.test.mjs test/skill-surface.test.mjs -t
  "pre|intent|slop-pre"`: 22 pass, 0 fail.
- `bun test test/preflight.test.mjs test/diversify.test.mjs`:
  29 pass, 0 fail.

### Post-review

- All repository `runPre()` call sites await the async result.
- `runPre()` returns intent data without creating its requested output path.
- CLI validation and in-memory construction precede `fs.mkdirSync()`.
- The CLI writes one `intent.json`; `pre.json` stores only its absolute path.
- Existing bullet order is unchanged and intent bullets are one final block.
- Invalid declared intent leaves the requested output directory absent.
- `bun test test/skill-surface.test.mjs --rerun-each 2`:
  90 pass, 0 fail.
- `git diff --check`: pass.

Gate: READY. No production correction was required after the post-review.

## Task 3 — Intent snapshot

### Pre-review

- Intent bytes, parsed value, and digest must come from one operation-cached read.
- The snapshot helper performs strict JSON parsing but not schema validation.
- The caller owns schema validation against the captured schema bundle.
- Every helper failure maps to `INTENT_INPUT_INVALID`.
- Gate: READY when contract snapshot behavior remains unchanged.

### RED

- `bun test test/skill-snapshot.test.mjs -t "intent snapshot"` failed at
  module loading because `snapshotIntent` was not exported.

### GREEN

- `bun test test/skill-snapshot.test.mjs`: 49 pass, 0 fail.
- `bun test test/canonical-json.test.mjs test/skill-surface.test.mjs -t
  "snapshot|strict"`: 22 pass, 0 fail.

### Post-review

- Exact read-site inspection confirms one `io.readFile()` call inside
  `snapshotIntent()`.
- Operation-scoped I/O returned the original bytes after the backing file was
  mutated.
- Semantically equal JSON with one trailing newline produced different raw
  SHA-256 digests.
- Duplicate keys, unreadable input, and a lone surrogate all map to
  `INTENT_INPUT_INVALID`.
- `bun test test/skill-snapshot.test.mjs -t "intent snapshot"`:
  6 pass, 0 fail.
- `git diff --check`: pass.

Gate: READY. Contract snapshot behavior remained unchanged.

## Task 4 — Receipt v2 core

### Pre-review

- Existing v1 builder output and exact v1 validator remain byte/shape compatible.
- V1 validator must reject a v2 binding; generic dispatch accepts both.
- V2 adds only `intent` between `contract` and `action_inputs`.
- Intent is outside policy and outside decision core.
- `INTENT_CHANGED` sorts after `CONTRACT_CHANGED`.
- Gate: READY when v1 and v2 APIs have distinct names and tests.

### RED

- The focused core run failed at module loading because
  `validateReceiptShape` and the v2 exports did not exist.

### GREEN

- `bun test test/skill-receipt-core.test.mjs`: 86 pass, 0 fail.
- `bun test test/skill-snapshot.test.mjs test/skill-action.test.mjs`:
  118 pass, 0 fail.

### Post-review

- Exact v1 output and validator remain separate from v2.
- Mutable JSON Schema accepts exact v2 and rejects a bound intent with null
  digest.
- V2 rejects missing intent, extra intent fields, uppercase digest, and
  unknown binding versions.
- V1 rejects both stored and current v2 intent fields.
- Bound v2 requires current bound intent; not-requested versus supplied intent
  yields `INTENT_CHANGED`.
- Issue order is contract, intent, action, policy.
- `decisionCore()` remains the same seven-field projection with no intent.
- `bun test test/skill-receipt-core.test.mjs --rerun-each 2`:
  178 pass, 0 fail.
- `git diff --check`: pass.

Gate: READY. No high-impact finding remained.

## Task 5 — Post and gate v2 emission

### Pre-review

- Post and gate share one strict argv parser.
- Duplicate, unknown, equals-form, missing-value, and extra positional input fail before output.
- Requested intent is snapshotted and schema-validated before artifact evaluation.
- Intent object/value never enters fold, claim scope, policy, or action construction.
- New emission always uses binding v2 with `bound` or `not_requested`.
- Gate: READY when output creation occurs only after successful `runPost()`.

### RED

- The first focused run failed because `skill-post-args.mjs` did not exist.
- After parser and v2 wiring, the legacy surface assertion correctly exposed
  that new emissions are v2 rather than v1.

### GREEN

- Focused post/intent/snapshot/gate run: 17 pass, 0 fail.
- Receipt core and snapshot regressions: 140 pass, 0 fail.

### Post-review

- Post and gate use the same strict parser.
- Both processes reject duplicate-key intent with exit 2,
  `INTENT_INPUT_INVALID`, and no decision file.
- Two valid intents produce identical decision core and policy but different
  intent digests.
- Intent-free calls emit exact v2 `not_requested`.
- Full `test/skill-surface.test.mjs`: 54 pass, 0 fail.
- Evaluator/fold/action modules have no new intent parameter or data flow;
  search hits are pre-existing prose uses of the word.
- `git diff --check`: pass.

Gate: READY. The obsolete v1-only surface assertion was updated to the generic
version dispatcher.
