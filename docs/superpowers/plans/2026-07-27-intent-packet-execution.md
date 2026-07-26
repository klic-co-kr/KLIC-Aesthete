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
