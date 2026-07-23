#!/usr/bin/env bun
// aesthete-pre — one-shot preflight facade for agents.
// brief → pre bundle + contract + prompt_bullets (generator-facing).
// Deterministic. No network. Does not call fix/overlay/neural.

import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, parseArgs, isMain } from './shared/cli.mjs';
import { validate } from './shared/validator.mjs';
import { preflight } from './preflight.mjs';
import { defaultLogPath, readLog, appendEntry, fingerprint, writeLog } from './diversify.mjs';
import { getRules, mergeNeg } from './slop-rules.mjs';

const SOURCE_MAP = { inferred: 'brief', rotated: 'diversify', default: 'default' };

/**
 * Resolve out-dir.
 * - default / relative → must stay under cwd (blocks `../../etc`)
 * - absolute path → allowed (explicit agent/CI opt-in, e.g. /tmp/…)
 */
export function resolveOutDir(outDirFlag, cwd = process.cwd()) {
  const raw = outDirFlag == null || outDirFlag === true ? '.aesthete-skill' : String(outDirFlag);
  const abs = path.resolve(cwd, raw);
  if (!path.isAbsolute(raw)) {
    const root = path.resolve(cwd);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      throw new Error(`out-dir escapes cwd: ${abs}`);
    }
  }
  return abs;
}

export function negationBundle(negation) {
  const raw = negation && typeof negation === 'object' ? negation : {};
  const ids = [];
  const bullets = [];
  for (const [cat, items] of Object.entries(raw)) {
    if (!Array.isArray(items)) continue;
    for (const text of items) {
      const t = String(text);
      bullets.push(t.startsWith('Do not ') || t.startsWith('금지') ? t : `Do not: ${t}`);
      // stable slug id
      const slug = `${cat}-` + t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
      ids.push(slug || cat);
    }
  }
  return { ids, bullets, raw };
}

export function renderPromptBullets(spec) {
  const bullets = [];
  if (spec?.directive) bullets.push(String(spec.directive));
  if (spec?.structure?.id) {
    const shape = spec.structure.shape ? ` — ${spec.structure.shape}` : '';
    bullets.push(`Structure: ${spec.structure.id}${shape}`);
  }
  const fr = spec?.budget?.freeRatio;
  if (fr && (fr.target != null || fr.min != null)) {
    const parts = [];
    if (fr.target != null) parts.push(`target ${fr.target}`);
    if (fr.min != null) parts.push(`min ${fr.min}`);
    bullets.push(`freeRatio ${parts.join(', ')}.`);
  }
  if (spec?.budget?.focal != null) {
    bullets.push(`Focal budget: ${spec.budget.focal}.`);
  }
  const neg = negationBundle(spec?.negation);
  for (const b of neg.bullets) bullets.push(b);
  return bullets;
}

// Non-enforced self-check checklist (secondary prevention). Pure — deterministic.
// The REAL gate is the post-hoc deterministic scan: `aesthete-post --slop-gate`.
export function renderSlopTest(rules) {
  const lines = ['# slop-test — self-check (NON-ENFORCED)', '',
    '> Secondary prevention. You (the generator) run this yourself. It is NOT a gate — the',
    '> real gate is the post-hoc deterministic slop scan (`aesthete-post --slop-gate`).',
    '> Self-certification has limits; treat this as a checklist, not proof.', ''];
  for (const b of rules.bullets) lines.push(`- [ ] ${b}`);
  return lines.join('\n') + '\n';
}

export function buildPreBundle(spec, { contractPath, outDir } = {}) {
  const source = SOURCE_MAP[spec.structurePickReason] || spec.structurePickReason || 'default';
  const neg = negationBundle(spec.negation);
  const prompt_bullets = renderPromptBullets(spec);
  // slop prevention (spec §3): append generation constraints (medium-scoped).
  // Negation is already merged into spec.negation by runPre so renderPromptBullets
  // + negationBundle pick it up; here we only append the explicit bullets.
  if (spec._slopRules) for (const b of spec._slopRules.bullets) prompt_bullets.push(b);
  const optional = {};
  if (spec.artifact_type === 'dashboard') {
    optional.keyhole = { max_visible_chunks: 4, note: 'dashboard only' };
  }
  return {
    schema: 'aesthete.pre/v1',
    schema_version: 1,
    recognized: Boolean(spec.recognized),
    artifact_type: spec.artifact_type,
    directive: spec.directive,
    structure: {
      id: spec.structure?.id,
      shape: spec.structure?.shape,
      source,
    },
    structurePickReason: spec.structurePickReason,
    contract_path: contractPath || null,
    // keep embed for agents that don't want a second file read; file is SSOT path
    contract: spec.contract,
    budget: spec.budget,
    negation: neg,
    prompt_bullets,
    canvas: spec.canvas ?? null,
    optional: Object.keys(optional).length ? optional : undefined,
    note: spec.note,
  };
}

export function runPre(brief, opts = {}) {
  const log = opts.log;
  const spec = preflight(brief, log ? { log } : {});
  // slop prevention (spec §3): resolve medium from brief.format, merge slop negation
  // into spec.negation BEFORE buildPreBundle so renderPromptBullets + negationBundle
  // pick it up. html→'html' (universal + html extras); any other format → that medium
  // (svg/pptx/docx/image → universal only in v1); missing format → universal default.
  const medium = brief?.format === 'html' ? 'html' : (brief?.format || 'html');
  const slopRules = getRules(medium);
  // Per-key CONCAT (mergeNeg), NOT key-level REPLACE. preflight's NEGATION_SPEC and
  // slop-rules both have a `copy` key — a shallow `{...a, ...b}` merge would let slop's
  // terse entry overwrite preflight's richer copy guidance ("use real numbers or a
  // labelled placeholder, never invent") in spec.negation.copy, dropping it from
  // prompt_bullets. Union keys, concat arrays → both entries survive.
  spec.negation = mergeNeg(spec.negation || {}, slopRules.negation);
  spec._slopRules = slopRules; // carry for buildPreBundle bullet append
  spec._slopMedium = medium;
  const outDir = opts.outDir;
  const contractPath = outDir ? path.join(outDir, 'contract.json') : null;
  const bundle = buildPreBundle(spec, { contractPath, outDir });
  // Secondary prevention: render the non-enforced self-check checklist STRING and
  // return it for main() to write. runPre is write-free (Task 9 pattern, mirror of
  // skill-post): main() owns all on-disk emits. The enforced gate stays post-hoc
  // (`aesthete-post --slop-gate`); this checklist is advisory.
  const slopTestMd = renderSlopTest(slopRules);
  return { spec, bundle, contractPath, slopRules, slopTestMd };
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const briefPath = positional[0];
  if (!briefPath) {
    console.error('usage: bun lib/skill-pre.mjs <brief.json> [--out-dir DIR] [--diversify [log.json]]');
    process.exit(2);
  }

  let outDir;
  try {
    outDir = resolveOutDir(flags['out-dir']);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }

  const brief = readJson(briefPath);
  await validate('brief', brief);

  const diversify = flags.diversify !== undefined;
  const logPath = typeof flags.diversify === 'string' && flags.diversify ? flags.diversify : defaultLogPath();
  const log = diversify ? readLog(logPath) : undefined;

  fs.mkdirSync(outDir, { recursive: true });
  const { spec, bundle, contractPath, slopTestMd } = runPre(brief, { log, outDir });

  writeJson(contractPath, spec.contract);
  const prePath = path.join(outDir, 'pre.json');
  writeJson(prePath, bundle);
  const bulletsPath = path.join(outDir, 'prompt_bullets.md');
  fs.writeFileSync(bulletsPath, bundle.prompt_bullets.map((b) => `- ${b}`).join('\n') + '\n', 'utf8');
  // Secondary prevention: emit the non-enforced self-check checklist next to pre.json.
  // runPre renders the string (write-free); main() owns the on-disk emit (Task 9 pattern).
  fs.writeFileSync(path.join(outDir, 'slop-test.md'), slopTestMd, 'utf8');

  if (diversify) {
    const updated = appendEntry(log, { ...fingerprint(spec), brief: brief?.brief || spec.artifact_type });
    writeLog(updated, logPath);
  }

  console.log(
    `pre ${bundle.artifact_type}${bundle.recognized ? '' : ' (generic)'} | structure ${bundle.structure.id} (${bundle.structure.source}) | bullets ${bundle.prompt_bullets.length} | ${prePath}`,
  );
}

if (isMain(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
