# Snapshot-Bound Decision Receipt Design

**Status:** Revised after adversarial design review; awaiting user approval

**Baseline:** `origin/main` at `ea5c3a0c0498f481e40cd0216b4ea0491d9fc5d4`

**Goal:** Give every newly emitted Aesthete decision a self-consistency and
freshness receipt over the decision core, exact snapshotted inputs, consumed
configuration and schemas, runtime identity, and a snapshot of the on-disk
installation. Make the narrow meaning of the existing
`pass | fix_geometry | regenerate | human` fold machine-readable without
changing that branch contract.

## 1. Problem

`aesthete-post` currently emits deterministic scores and reasons, but a stored
`decision.json` does not identify the artifact, contract, configuration, or
runtime implementation used to create it. A decision can therefore be paired
with later inputs, or its decision fields can be edited, without a
machine-detectable inconsistency.

The label `pass` is also easy to overread. In the current fold it means that no
enabled blocking rule produced a higher-priority candidate. It does **not**
mean that every requested operation returned `pass`:

- an unknown structure result is not blocking;
- vulnerability findings are advisory unless their gate is enabled;
- P0-only contract failures are not folded through the contract branch;
- the fold directly gates P0 geometry, not every measured aesthetic axis.

The receipt must expose those limits. It must not reinterpret the current fold.

## 2. Security and Claim Model

The receipt provides two bounded properties:

1. **Internal consistency:** the stored decision core matches the digest
   stored beside it.
2. **Freshness under the current installation:** the supplied artifact,
   contract, consumed configuration and schemas, runtime, and current on-disk
   installation match the values recorded by the receipt.

The receipt does **not** prove:

- who or what generated the decision;
- that the decision logic is correct;
- that the evaluator was not malicious;
- that the on-disk source snapshot is the bytecode already loaded and executed
  by the current process;
- authenticity, identity, time, or authorization;
- reader comprehension, pixel-output equivalence, host-application behavior,
  or human approval.

SHA-256 is used only as a collision-resistant content digest. There is no
signature, key, trust root, timestamp, or attestation. Any party can recompute
the digest after editing the object, so the receipt is not adversarial
tamper-proof.

## 3. Required Behavior

1. `runPost()` snapshots artifact bytes once before import or scanning.
2. If a contract is requested, `runPost()` snapshots its bytes once before
   parsing, validation, or evaluation.
3. Geometry import, HTML scanning, contract evaluation, and digesting consume
   those same in-memory snapshots. They must not reread the input paths.
4. Effective measurement parameters and lint tokens are resolved once,
   injected into their consumers, and hashed as canonical values.
5. A complete receipt binds:
   - artifact snapshot bytes;
   - contract snapshot bytes or an explicit `not_requested`;
   - effective adapter and slide;
   - enabled fold/scanner flags;
   - effective parameters and tokens;
   - the consumed schema bundle and an on-disk installation snapshot;
   - validation and JavaScript runtime identities;
   - the stored decision core and claim scope.
6. A verifier distinguishes `current`, `stale`, `unbound`, `incomplete`, and
   `invalid`.
7. Existing consumers that branch only on `.decision` remain compatible.
8. The receipt verifier is strict: unknown or duplicate flags, missing flag
   values, extra positional arguments, invalid booleans, unsupported explicit
   domains, and invalid slide values are usage errors.

## 4. Non-goals

- No signing, identity, timestamps, remote trust, or provenance proof.
- No decision replay in Task 1. The verifier does not rerun measurement or
  prove that the stored core is the correct output of the bound evaluator.
- No executed-code attestation. Static modules are loaded before `runPost()`;
  an on-disk digest cannot prove the bytes already executing in memory.
- No per-report evidence ledger in Task 1. Report re-evaluation and report
  digests require a separate design.
- No change to measurement formulas, fold priority, fixer behavior, optional
  gate defaults, or existing post/gate branch exit codes.
- No hashing of output directories or filesystem metadata.
- No source code, schema shape, field ordering, test wording, or prose copied
  from `visual-authoring`.

## 5. Selected Architecture

Keep outer `aesthete.decision/v1` for compatibility and add optional,
versioned `binding` and `claim_scope` objects. New emissions always contain
both. Legacy v1 decisions remain parseable and verify as `unbound`.

Create `lib/skill-receipt-core.mjs` for deterministic value operations:

```js
canonicalizeJson(value) -> RFC 8785 canonical JSON string
sha256Bytes(bytes) -> lowercase hex string
sha256Json(value) -> lowercase hex string
normalizePostPolicy(input) -> effective policy object
decisionCore(decision) -> bound decision-core object
buildClaimScope(input) -> claim-scope object
buildDecisionBinding(input) -> binding object
validateReceiptV1Shape(decision) -> structural validation result
verifyDecisionBinding(decision, current) -> verification result
```

Create `lib/skill-snapshot.mjs` for filesystem-facing snapshot and bundle
resolution:

```js
snapshotArtifact(path, options) -> bytes + adapter metadata
snapshotContract(path) -> bytes + parsed/validated contract
resolveEffectiveResources(options) -> params, tokens, schemas, installation, runtime
```

`foldDecision()` stays pure and does no I/O or hashing. `runPost()` performs
this sequence:

1. snapshot artifact and requested contract;
2. resolve effective params/tokens, capture schema bytes, and snapshot the
   on-disk installation;
3. import and evaluate only those snapshots;
4. call the existing fold;
5. build and attach `claim_scope`;
6. hash the decision core;
7. build and attach `binding`.

The last two steps may be implemented outside `foldDecision()` so the fold
does not gain receipt responsibilities.

## 6. Single-Snapshot Rule

### 6.1 Artifact

`snapshotArtifact()` reads the artifact once into a `Buffer`. Adapter import
uses `importBuffer(buffer, adapterId, opts)`. HTML slop scanning uses
`buffer.toString("utf8")` from the same buffer.

The adapter ID is the adapter actually executed:

- a supported explicit `--domain` selects that adapter;
- an unsupported explicit domain is rejected;
- absent an override, a supported extension selects its adapter;
- an unknown extension uses `alt`, matching the current fallback.

`--slide` must be a positive integer when present. It participates in the
effective policy only for `pptx`; other adapters record `effective_slide:
null`. PPTX absence records the currently effective default slide `1`.

### 6.2 Contract

The contract file is read once into a `Buffer`, parsed from that buffer,
strictly schema-validated, and evaluated from the parsed snapshot. An invalid
or unreadable requested contract is an input error and produces no
receipt-backed decision.

### 6.3 Incomplete artifact receipts

The existing import-failure fold can emit a decision even when artifact bytes
cannot be read. The following is an excerpt; the full object still has a
well-formed `claim_scope`, policy, decision-core digest, contract state, and
non-actionable action state:

```json
{
  "binding": {
    "schema": "aesthete.binding/v1",
    "completeness": "incomplete",
    "artifact": { "status": "unreadable", "sha256": null }
  }
}
```

It can never verify as `current`; it verifies as `incomplete`. If bytes were
snapshotted but parsing or schema validation failed, the receipt can be
complete because the exact failed input is known.

## 7. Canonical JSON

JSON values are canonicalized according to RFC 8785 (JCS), including its
ECMAScript number serialization and UTF-16 property ordering rules.
Unsupported JSON values, cycles, non-finite numbers, and `BigInt` are rejected
instead of being silently coerced. Unpaired high or low UTF-16 surrogates are
also rejected as non-I-JSON input.

Stored decisions and contract snapshots use a duplicate-key-aware strict JSON
parser before schema validation. Duplicate members at any nesting depth and
unpaired surrogates are input errors; ordinary `JSON.parse()` is not
sufficient for these two boundaries. Emitted JSON remains ordinary canonical
data and therefore has unique object keys.

Conformance tests cover official JCS vectors plus nested object order, array
order, `-0`, Unicode keys, lone high/low surrogates, duplicate raw JSON
members, and unsupported values.

All structured digests in this design use the UTF-8 bytes of that canonical
form. Raw artifact and contract digests use their original bytes.

## 8. Decision Shape

New decisions retain the current v1 fields and add:

```json
{
  "claim_scope": {
    "schema": "aesthete.claim-scope/v1",
    "pass_means": "no_enabled_blocking_rule_triggered",
    "rules": {
      "artifact_import": {
        "requested": true,
        "executed": true,
        "blocking_conditions": [
          "read_parse_or_schema_failure_routes_to_regenerate"
        ],
        "coverage_behavior": "failure_prevents_downstream_execution",
        "advisory_behavior": "none"
      },
      "alt_hard_integrity": {
        "requested": true,
        "executed": true,
        "blocking_conditions": [
          "p0_score_below_one_routes_to_fix_regenerate_or_human"
        ],
        "coverage_behavior": "reported_separately",
        "advisory_behavior": "non_p0_measurements_do_not_directly_block"
      },
      "coverage": {
        "requested": true,
        "executed": true,
        "blocking_conditions": ["zero_routes_to_human"],
        "coverage_behavior": "nonzero_does_not_imply_full_coverage",
        "advisory_behavior": "none"
      },
      "structure_signature": {
        "requested": false,
        "executed": false,
        "blocking_conditions": ["fail_routes_to_regenerate"],
        "coverage_behavior": "unknown_is_nonblocking",
        "advisory_behavior": "none"
      },
      "token_policy": {
        "requested": false,
        "executed": false,
        "blocking_conditions": ["any_violation_routes_to_regenerate"],
        "coverage_behavior": "no_separate_coverage_state",
        "advisory_behavior": "none"
      },
      "known_bad_signatures": {
        "requested": false,
        "executed": false,
        "blocking_conditions": [
          "high_findings_route_to_regenerate_only_when_vuln_gate_enabled"
        ],
        "coverage_behavior": "scanner_coverage_does_not_independently_block",
        "advisory_behavior": "ungated_high_findings_add_advisory_reasons"
      },
      "html_pattern_scan": {
        "requested": false,
        "executed": false,
        "blocking_conditions": [
          "branch_1_when_html_measured_and_p0_exists_regenerate",
          "branch_2_else_when_html_measured_and_gate_enabled_and_p1_exists_regenerate",
          "branch_3_else_when_html_measured_and_p0_signature_unmeasured_human"
        ],
        "coverage_behavior": "whole_scan_unmeasurable_is_nonblocking",
        "advisory_behavior": "branch_4_only_p2_findings_add_reasons_after_no_prior_branch_p1_ungated_does_not"
      },
      "contract_criteria": {
        "requested": false,
        "executed": false,
        "blocking_conditions": [
          "non_p0_criterion_failure_routes_to_regenerate"
        ],
        "coverage_behavior": "p0_only_contract_failure_is_nonblocking_in_contract_branch",
        "advisory_behavior": "none"
      }
    },
    "does_not_establish": [
      "reader_comprehension",
      "pixel_output_equivalence",
      "host_application_behavior",
      "human_approval"
    ]
  },
  "binding": {
    "schema": "aesthete.binding/v1",
    "algorithm": "sha256",
    "integrity": "content_freshness_and_internal_consistency_not_authenticity",
    "completeness": "complete",
    "artifact": {
      "status": "bound",
      "sha256": "<64 lowercase hex>"
    },
    "contract": {
      "status": "not_requested",
      "sha256": null
    },
    "action_inputs": {
      "status": "not_required",
      "runtime_executable_locator_sha256": null,
      "script_locator_sha256": null,
      "artifact_locator_sha256": null,
      "contract_locator_sha256": null,
      "contract_sha256": null,
      "adapter": null,
      "slide": null,
      "profile": null
    },
    "policy": {
      "adapter": {
        "id": "svg",
        "effective_slide": null
      },
      "profile": null,
      "structure": null,
      "lint": false,
      "vuln": false,
      "vuln_gate": false,
      "slop": false,
      "slop_gate": false,
      "slop_autofix": false,
      "human_on_unfixable": false,
      "artifact_type": null,
      "resources": {
        "params_sha256": "<64 lowercase hex>",
        "tokens_sha256": null,
        "schemas": {
          "sha256": "<64 lowercase hex>",
          "files": [
            {
              "relative_path": "schemas/alt.schema.json",
              "sha256": "<64 lowercase hex>"
            }
          ]
        },
        "on_disk_installation": {
          "sha256": "<64 lowercase hex>",
          "files": [
            {
              "relative_path": "lib/measure.mjs",
              "sha256": "<64 lowercase hex>"
            }
          ]
        }
      },
      "validation": {
        "mode": "ajv",
        "version": "<resolved installed version>"
      },
      "runtime": {
        "engine": "bun",
        "version": "<process.versions.bun>",
        "platform": "<process.platform>",
        "arch": "<process.arch>",
        "locale": "<Intl.Collator resolved locale>",
        "versions_sha256": "<JCS digest of full process.versions>"
      }
    },
    "policy_sha256": "<64 lowercase hex>",
    "decision_core_sha256": "<64 lowercase hex>"
  }
}
```

The contract object is `{ "status": "bound", "sha256": "..." }` when
requested.

When `decision === "fix_geometry"`, the action is emitted in one exact
grammar:

```text
<absolute process.execPath>
<absolute skill-root>/lib/fix.mjs
<absolute artifact>
--contract <absolute contract>
--domain <effective adapter>
[--slide <effective PPTX slide>]
[--profile <effective profile>]
```

All paths are absolute and lexically normalized at emission, so command input
resolution is independent of the later shell CWD. Symlink aliases are
conservatively treated as different locators. `lib/fix.mjs` is extended to
parse and pass a positive `--slide` to the PPTX adapter; it already consumes
`--domain` and `--profile`.

The command always has an explicit contract:

- if post evaluated a requested contract, the command reuses that same
  snapshotted path and bytes;
- otherwise post snapshots, strictly validates, and explicitly passes
  `<skill-root>/examples/catalog.contract.json` as the future fixer's default
  action contract.

The default action contract does not retroactively become part of the post
decision fold. It is a separately named future-action input. If a
`fix_geometry` decision cannot snapshot and validate that action contract,
post/gate fail with a typed dependency error and emit no actionable decision.

`action_inputs.status` is then `bound`. It records the digests of the absolute
runtime executable, script, artifact, and contract locators; the action
contract bytes; and the adapter/slide/profile options. Stored values are
derived from the exact operands in `next.fix_cmd`.

Verification first parses the command with the exact grammar and checks every
stored operand/option against `action_inputs`; inconsistency is `invalid`. It
then compares the current runtime, installation, input locators, action
contract bytes, and effective options; a difference is `stale`. Bare
executables, relative operands, missing/duplicate action flags, extra
operands, or a command that relies on the fixer's implicit default contract
are `invalid`.

The fixer still writes its version/output logs under the caller's CWD. Those
output locations are not receipt-bound, and `current` makes no claim about
where future action outputs will be written.

## 9. Effective Policy and Installation Snapshot

The effective policy contains every identified outcome-affecting input that
can be captured and injected by post, plus a separately named on-disk
installation snapshot:

| Input | Bound representation |
|---|---|
| adapter selection | actual adapter ID |
| PPTX slide | effective 1-based slide; otherwise `null` |
| profile | normalized string or `null` |
| structure | normalized string or `null` |
| boolean post flags | strict booleans |
| artifact type | normalized string or `null` |
| measurement parameters | digest of the resolved merged parameter object |
| lint tokens | digest of the resolved token object when lint executes; otherwise `null` |
| schemas | manifest and digest of the exact captured schema bytes used to construct the run-local validator |
| installation | manifest and digest of current on-disk engine/package files; not executed-code attestation |
| validation | mandatory validator name and resolved installed version |
| runtime | Bun version, platform, architecture, full sorted `process.versions`, and resolved collation locale |

Both resource manifests are sorted arrays of
`{ relative_path, sha256 }`. The schema manifest contains every
`schemas/*.json` file. The on-disk installation manifest contains every
`lib/**/*.mjs` file plus `package.json`, `bun.lock`, and `package-lock.json`;
both lockfiles are required for this repository baseline. Missing a required
manifest file at emission is an input error. The aggregate digest is the JCS
digest of the manifest.

At verification, the stored manifest supplies the expected path set. The
verifier compares the union of stored paths and currently discovered paths;
a stored path that is now absent is represented as `missing`, while a newly
discovered path is represented as `added`. Either is `stale`, not an input
error. Stored manifest paths must be normalized relative paths inside the
allowed `lib/`, `schemas/`, or package-file set; absolute paths, `..`, and
symlink escapes are `invalid`.

The installation digest is deliberately conservative: a change anywhere in
the on-disk post engine can make an old decision stale even when that file did
not affect the particular artifact. Conservative false-stale results are
preferable to false-current results. Test files, docs, output paths,
timestamps, file modes, and absolute paths are excluded.

This digest identifies files on disk at snapshot time. Because ESM modules
were loaded before `runPost()`, it does not establish that those bytes are the
code already executing in memory. Executed-code attestation would require a
content-addressed loader or bundled executable and is outside Task 1.

There is no digest recursion: source/schema files contain algorithms and
schema definitions, not the receipt instance being generated. Adding
`lib/skill-receipt*.mjs` changes the installation manifest when that code is
installed; after installation, repeated receipts are stable.

Effective resources are injected into execution:

- `measureAlt(..., { params })`; proximity reads `opts.params` rather than
  reopening or reusing a hidden cached file value;
- `lint(alt, { tokens })`;
- a new run-local validator is compiled from the captured schema buffers and
  uses the validator identity recorded in policy.

This makes params, tokens, and schemas the hashed values actually consumed.
The installation manifest remains an explicitly weaker on-disk observation.
Receipt-backed post, gate, and verifier entry points require
`process.versions.bun`; another JavaScript engine is a typed input/dependency
error rather than an attempt to emulate Bun semantics.

## 10. Bound Decision Core

`decision_core_sha256` hashes a canonical projection of:

```json
{
  "schema": "...",
  "schema_version": 1,
  "decision": "...",
  "reasons": [],
  "scores": {},
  "next": {},
  "claim_scope": {}
}
```

`binding` is excluded to avoid recursion. `paths` is excluded because it is
output-only and may vary across otherwise identical evaluations. The schema
documents this exact projection.

This digest detects unrecomputed edits or a binding copied onto a different
decision core. It does not prove that the bound evaluator produced the core;
replay is a future feature.

For decisions without an actionable command, input locators do not
participate in freshness: identical bytes and policy can remain `current`
after relocation. For `fix_geometry`, locator digests participate in
freshness because executing a stale `next.fix_cmd` could process the wrong
input.

## 11. Claim-Scope Construction

Each rule records:

- `requested`: whether its input or scan was requested;
- `executed`: whether a result reached the fold;
- `blocking_conditions`: the exact current fold candidates;
- `coverage_behavior`: how unmeasured/unknown states affect the fold;
- `advisory_behavior`: which nonblocking findings become reasons or are
  ignored.

These values are derived from the same orchestration inputs passed to
`foldDecision()`. No report digest or second pass/fail ledger is added.

`pass_means` remains `no_enabled_blocking_rule_triggered`. Documentation must
not paraphrase it as “all requested checks passed.”

## 12. Verifier

Create:

```bash
bun lib/skill-receipt.mjs verify DECISION ARTIFACT \
  [--contract CONTRACT] \
  [--domain DOMAIN] [--slide N] [--profile NAME] \
  [--structure ID] [--lint] [--vuln] [--vuln-gate] \
  [--slop] [--slop-gate] [--slop-autofix] \
  [--human-on-unfixable] [--type TYPE] [--out REPORT]
```

The verifier snapshots each current input once and rebuilds the effective
policy from the current installation. It does not rerun the evaluator.

Result:

```json
{
  "schema": "aesthete.receipt-verification/v1",
  "status": "current",
  "issues": [],
  "checked": [
    "decision_core_sha256",
    "artifact.sha256",
    "contract.status",
    "contract.sha256",
    "action_inputs",
    "policy_sha256"
  ]
}
```

Validation and status precedence is:

1. Validate the base decision/v1 core with the version-pinned receipt
   structural validator. A malformed core is `invalid`.
2. Check the extension pair:
   - neither `binding` nor `claim_scope`: `unbound`;
   - only one of them: `invalid`;
   - both: continue strict receipt validation.
3. A malformed/unsupported extension, unknown nested property, inconsistent
   stored internal digest, or decision-core digest mismatch is `invalid`.
4. A well-formed receipt that declares incomplete input binding is
   `incomplete`.
5. An internally valid receipt whose current bound inputs, actionable
   locators, or effective policy differ is `stale`.
6. A receipt for which every check matches is `current`.

Base validation precedes `unbound`. `invalid` takes precedence over
`incomplete` and `stale`; `incomplete` takes precedence over `stale`. All
issues within the selected class are returned in stable code order.

Exit codes:

- `0`: `current`;
- `1`: `stale`;
- `2`: `unbound`, `incomplete`, `invalid`, or usage/input error.

The concise output is `receipt status=<status> issues=<count>`. `--out`
writes the full JSON report.

## 13. Validation and Schema

Add optional `binding` and `claim_scope` definitions to
`schemas/decision.schema.json` and add their nested required fields, enums,
digest patterns, and `additionalProperties: false` boundaries.
Use dependent requirements so either both receipt extensions are present or
neither is. The legacy outer object retains its compatibility allowance, but
a conditional receipt-backed branch uses `unevaluatedProperties: false` for
the two extension objects and their descendants.

At emission, add base-decision and strict receipt schema compilation to the
run-local validator. Receipt verification must not accept an invalid base
core, unknown nested receipt fields, malformed digests, unsupported receipt
schemas, or internally inconsistent objects.

Verification does not use the mutable current
`schemas/decision.schema.json` to decide whether a stored v1 receipt is
structurally valid. `skill-receipt-core.mjs` carries a version-pinned,
code-defined v1 structural validator for the base core and receipt
extensions. This validator preserves v1 verification semantics even when the
current evaluator schema bundle changes incompatibly. The mutable captured
decision schema is still used at emission and remains part of the effective
schema policy; its later change therefore produces `stale` after the pinned
shape check, not `invalid`.

For receipt-backed post/gate execution, AJV is mandatory. Its absence is a
typed input/dependency error: post and gate exit `2` and emit no decision.
They must not fall back to the shared validator's current degraded mode.

The independent measure/fix CLIs keep their existing degraded-validation
behavior. This is an intentional tightening only at the receipt boundary.

## 14. Compatibility

- `.decision`, `.reasons`, `.scores`, `.paths`, and `.next` keep their current
  shapes and fold behavior.
- `next.fix_cmd` remains a string array, but its operands become absolute and
  it gains explicit contract/domain/slide/profile flags so the stored action
  matches the evaluated input semantics.
- Existing `jq -r .decision` consumers continue to work.
- New fields remain optional in outer decision/v1 only for legacy parsing.
- Newly emitted decisions are tested to require `binding` and `claim_scope`.
- `stableDecision()` keeps normalizing volatile paths; receipt fields remain
  in deterministic comparisons.
- The post/gate exit-code contract does not change.
- A missing AJV installation no longer silently certifies receipt-backed
  evaluation; this compatibility change is explicit and fail-closed.

## 15. Error Handling

- Unreadable artifact: existing `IMPORT_FAIL` branch plus an `incomplete`
  binding; verifier exit `2`.
- Readable but unparseable or schema-invalid artifact: bound bytes,
  `IMPORT_FAIL`, complete receipt.
- Unreadable, invalid, or schema-invalid requested contract: input error; no
  decision is emitted.
- Missing or invalid default action contract when a `fix_geometry` command is
  required: dependency error; no actionable decision is emitted.
- Invalid explicit domain, slide, or verifier flag: usage error.
- Duplicate JSON members or unpaired surrogates in a stored decision or
  contract: input/validation error.
- Missing AJV or a non-Bun runtime: input/dependency error; exit `2`, no
  decision.
- Unsupported canonical JSON value: explicit error; no lossy digest.
- A changed runtime/config/schema/on-disk installation is `stale`, not
  `invalid`.

## 16. Test Strategy

All implementation follows red-green-refactor. Read-only baseline scenarios
for agent-facing skill wording are captured before skill docs change.

### Canonicalization and digest unit tests

1. RFC 8785 conformance vectors;
2. nested key order independence and array order sensitivity;
3. `-0`, Unicode property order, lone high/low surrogate, duplicate raw
   member, invalid number, `BigInt`, `undefined`, and cycles;
4. raw-byte SHA-256 stability.

### Binding and verifier unit tests

1. identical snapshots/resources produce identical bindings;
2. artifact, contract, flag, params, tokens, schema, installation, validator,
   or runtime change produces `stale`;
3. decision/reason/score/next/claim edit without recomputing the original
   binding produces `invalid`;
4. edit plus full rebinding can produce `current`, demonstrating that the
   unkeyed receipt is not an authenticity or adversarial tamper proof;
5. path-only change does not invalidate the decision core;
6. missing receipt is `unbound`, while a partial extension pair is `invalid`;
7. well-formed unreadable-artifact receipt is `incomplete`;
8. unsupported schema, malformed nested hash, unknown nested property, or
   internal digest mismatch is `invalid`;
9. incompatible current decision-schema change is `stale` after pinned-v1
   structural validation;
10. deleted stored manifest file and added current manifest file are `stale`;
11. invalid/incomplete/stale precedence and issue ordering are deterministic.

### Snapshot and orchestration tests

1. injected read spy proves artifact and contract paths are each read once;
2. adapter import and HTML scanning consume the same artifact buffer;
3. contract parse/validation/evaluation consume the same contract buffer;
4. the run-local validator is built from the same captured schema buffers
   recorded in policy;
5. effective parameters and tokens are injected into measurement/lint;
6. same bytes at different paths with the same effective adapter remain
   current for a non-actionable `pass` decision;
7. relocating an actionable `fix_geometry` decision is stale because its
   artifact locator changes;
8. actionable command uses absolute runtime/script/input paths, an explicit
   requested-or-default contract, and exact domain/slide/profile flags;
9. command remains semantically identical under a different execution CWD;
10. default action-contract byte change, domain override, PPTX slide `2`, or
    profile change is stale;
11. cross-extension adapter change is stale;
12. PPTX default/effective slide normalization is deterministic and
    `fix.mjs --slide` reaches the adapter;
13. invalid domain, slide, contract, non-Bun runtime, and unavailable AJV
    fail closed;
14. current `.decision` branch behavior and non-destructive post behavior are
   unchanged.

Claim-scope fixtures separately cover structure `unknown`, P0-only contract
failure, vulnerability gated/ungated high findings, HTML-measured slop P0,
P1 gated and ungated, P0-signature unmeasured, P2 advisory reasons, and
whole-scan non-HTML unmeasurable behavior. A mixed
P0+P1+P2+P0-unmeasured fixture proves the slop branch precedence and which
advisory reasons are suppressed.

### Process-level CLI tests

Spawn the real CLIs and assert stdout, JSON output, and exit codes for:

- receipt `current`, `stale`, `unbound`, `incomplete`, and `invalid`;
- unknown/duplicate/missing-value flags, invalid booleans, invalid slides, and
  extra positional arguments;
- post/gate pass and non-pass regressions;
- `--out` and output-directory behavior.

Tests mutate only temporary copies or inject resource snapshots; they do not
rewrite repository configuration.

## 17. Documentation

Update only agent-facing surfaces that must explain the invariant:

- `SKILL.md`;
- `skills/aesthete-post/SKILL.md`;
- `skills/aesthete-gate/SKILL.md`;
- `docs/agent-llm-usage.md`;
- `docs/integration/generator-contract.md`;
- `README.md` and `README.ko.md`;
- `package.json` verifier script.

Required concise rule:

> A receipt marked `current` means the stored decision core matches its stored
> digest, and its bound inputs, consumed configuration/schema, runtime, and
> on-disk Aesthete snapshot match. Anyone can edit and rebind it, so it does
> not prove authenticity, provenance, executed-code identity, or correctness.
> `pass` means only that no enabled blocking rule triggered.

## 18. Acceptance Criteria

1. A decision-core edit made without recomputing its binding is `invalid`;
   edit-plus-rebinding is explicitly allowed and tested as an unkeyed-digest
   limitation.
2. Changed artifact/contract bytes or effective flags/config/schema/on-disk
   installation/validator/runtime are `stale` when the original receipt is
   retained.
3. Artifact and contract paths are read at most once during a post run.
4. Artifact, contract, params, tokens, and schema bytes hashed are the values
   consumed; the installation digest is explicitly only an on-disk snapshot.
5. An actionable `fix_geometry` command resolves the same artifact, contract,
   adapter, slide, and profile semantics under any caller CWD; a change to
   those action inputs is stale.
6. Legacy, incomplete, malformed, stale, and current receipts are
   distinguishable with documented exit codes.
7. Existing fold choices and post/gate exit behavior remain unchanged for
   valid, normally installed inputs.
8. Full existing and new tests pass.
9. Agent-facing docs never call the receipt authentication, provenance, or a
   correctness proof, and never redefine `pass` as “all requested checks
   passed.”

## 19. Provenance Boundary

External reference reviewed:

- repository: `https://github.com/vibeworkers/visual-authoring`;
- revision: `30f74ef45eb05e29b17854eccd0ab2ede4df2d08`;
- observed license: CC BY-NC 4.0.

The only adopted abstraction is that a stored conclusion benefits from an
input binding and an explicit boundary on what the conclusion asserts. This
design independently derives its field names, data flow, schemas, checks, and
tests from Aesthete's existing fold and runtime. Upstream code, prose,
taxonomy order, schemas, and test cases are not implementation templates and
will not be copied. Any future use of upstream expression, rather than this
independently implemented abstraction, requires separate license and legal
review.
