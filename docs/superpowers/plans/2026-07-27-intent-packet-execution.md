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
