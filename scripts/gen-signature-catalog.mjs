#!/usr/bin/env bun
// scripts/gen-signature-catalog.mjs
// Renders the vuln + slop signature catalog to markdown. Self-rendering: imports the signature
// modules + threshold/suppression tables and emits to stdout. Pipe to docs/signature-catalog.md.
// Deterministic (no Date/random) — same source produces the same catalog byte-for-byte.
//
// Usage: bun run gen:catalog   (writes docs/signature-catalog.md via package.json redirect)

import { SIGNATURES as VULN, DEFAULT_THRESHOLDS as VULN_T, TYPE_SUPPRESSIONS as VULN_S } from '../lib/vuln.mjs';
import { DEFAULT_THRESHOLDS as SLOP_T, TYPE_SUPPRESSIONS as SLOP_S } from '../lib/slop.mjs';
import { SIGNATURES as PALETTE } from '../lib/slop/signatures/palette.mjs';
import { SIGNATURES as DECO } from '../lib/slop/signatures/decoration.mjs';
import { SIGNATURES as COPY } from '../lib/slop/signatures/copy.mjs';
import { SIGNATURES as TMPL } from '../lib/slop/signatures/template.mjs';
import { SIGNATURES as IMG } from '../lib/slop/signatures/imagery.mjs';

const SLOP = [...PALETTE, ...DECO, ...COPY, ...TMPL, ...IMG];

// Reverse the suppression map: id -> [artifact types that treat this pattern as intended].
function reverseSuppressions(table) {
  const map = {};
  for (const [type, ids] of Object.entries(table || {})) {
    for (const id of ids) (map[id] ||= []).push(type);
  }
  return map;
}
const vulnSuppressed = reverseSuppressions(VULN_S);
const slopSuppressed = reverseSuppressions(SLOP_S);

function fmtThreshold(t) {
  if (!t || Object.keys(t).length === 0) return '—';
  return Object.entries(t).map(([k, v]) => `\`${k}=${v}\``).join(' ');
}

function row(sig, threshold, suppressedFor) {
  const det = `\`${sig.detectionMode ?? 'deterministic'}\``;
  const needs = (sig.needs || []).map((n) => `\`${n}\``).join(' ') || '—';
  const sev = sig.tier ? `${sig.severity}/${sig.tier}` : sig.severity;
  const sup = suppressedFor && suppressedFor.length ? suppressedFor.join(', ') : '—';
  return `| \`${sig.id}\` | ${sig.title} | ${sev} | ${needs} | ${det} | ${fmtThreshold(threshold)} | ${sup} |`;
}

const out = [];
out.push('# Signature Catalog');
out.push('');
out.push('Auto-generated from `lib/vuln.mjs` + `lib/slop/signatures/*.mjs` by `scripts/gen-signature-catalog.mjs`. Do not edit by hand — run `bun run gen:catalog`.');
out.push('');
out.push('Every signature is **deterministic** unless its detection column says otherwise (`browser` = needs real CSS layout; `llm-only` = no deterministic detector, caught by an LLM judge). All vuln/slop signatures are `measure-only` / advisory — they never touch the 9-skill weighted score, so adding one never churns `examples/*.report.json`.');
out.push('');
out.push('## vuln — known-bad-pattern negation');
out.push('');
out.push('Multi-domain (geometry / text / color). Each negates a specific layout defect (no-focal, even-split, rainbow, hanging-header, …). Type-suppressed signatures are listed in the last column — they are the *intent* for that artifact type, not a defect.');
out.push('');
out.push('| id | title | severity | needs | detection | default threshold | suppressed-for-types |');
out.push('|---|---|---|---|---|---|---|');
for (const sig of VULN) out.push(row(sig, VULN_T[sig.id], vulnSuppressed[sig.id]));
out.push('');
out.push('## slop — AI-slop signatures');
out.push('');
out.push('HTML-only v1 (SVG `<animate>` / PPTX `<p:timing>` are v2). Grouped by axis: `palette`, `decoration`, `copy`, `template`. Thresholds are conservative presence floors — uncalibrated until the v2 human-corpus lands.');
out.push('');
out.push('| id | title | severity/tier | needs | detection | default threshold | suppressed-for-types |');
out.push('|---|---|---|---|---|---|---|');
for (const sig of SLOP) out.push(row(sig, SLOP_T[sig.id], slopSuppressed[sig.id]));
out.push('');
out.push('## detection-mode legend');
out.push('');
out.push('- `deterministic` — pure-function detector, no browser, no LLM. The whole v1 catalog.');
out.push('- `browser` — reserved for signatures that need real CSS box layout (overflow, occlusion, viewport-edge). Not yet shipped; ALT geometry covers most of this today.');
out.push('- `llm-only` — no deterministic detector exists; surfaced only when an LLM judge runs (v2+). `slop.copy.generic` is the current example — it reports `unmeasured` until the v2 LLM judge lands.');
out.push('');

console.log(out.join('\n'));
