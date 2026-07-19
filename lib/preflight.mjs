#!/usr/bin/env node
// Pre-generation geometric preflight — the "pre" counterpart to measure/fix.
//
// Aesthete is post-hoc by identity (DESIGN §0): it measures/corrects a layout AFTER it
// exists. Preflight runs BEFORE generation: given an artifact type + canvas + intent, it
// derives (1) a type-tuned frozen Sprint Contract — concrete geometric TARGETS, not guesses
// — that fix.mjs --contract consumes post-hoc unchanged, so the SAME contract defines the
// generation goal and the acceptance check; (2) a generator-facing geometric budget; (3) a
// negation list (banned defaults — Polanyi's "negation > assertion" + the token sandbox).
//
// The loop: preflight(brief) → contract+budget → generate → measure/fix --contract → verify.
// Deterministic: same brief → same preflight, byte-identical (no Math.random/Date).

import path from 'node:path';
import { readJson, writeJson, parseArgs, skillRoot, isMain } from './shared/cli.mjs';
import { validate } from './shared/validator.mjs';
import { readLog, writeLog, appendEntry, pickStructureIndex, fingerprint, defaultLogPath } from './diversify.mjs';
import { STRUCTURES, GENERIC_STRUCTURES, inferStructure } from './structure.mjs';
// STRUCTURES (per-type shape catalog) + its geometric signatures live in lib/structure.mjs, so the
// `structure` pick preflight emits is post-hoc VERIFIABLE via classifyStructure/verifyStructure
// there — closing the "generation goal = acceptance check" gap for the structural axis (not just
// the contract's geometric thresholds).

// ---- artifact-type profiles -------------------------------------------------
// Each threshold is tied to a measurement skill's metric (see lib/skills/*) so the emitted
// contract is verifiable post-hoc by contract.evaluate. Grounded in the gestalt lenses:
// density-appropriateness, figure-ground (focal), rhythm (spacing), balance posture.

const PROFILES = {
  // high-frequency operational surface: dense, zero decoration, one focal per viewport,
  // whitespace is cost. Evidence > polish.
  dashboard: {
    label: 'operational dashboard',
    density: 'high', decoration: 'low', focal: 1, posture: 'stable',
    contract: {
      'whitespace.freeRatio': ['>=', 0.12],
      'balance.BM': ['>=', 0.82],
      'hierarchy.clarity': ['>=', 0.72],
      'fluency.fluency': ['>=', 0.7],
    },
    budget: {
      freeRatio: { min: 0.12, target: 0.22 },
      typeScale: { id: 'tight', hint: 'few compact steps (≈12/14/16/20); evidence, not display' },
      focalPoints: 1,
      balance: { target: 0.85, posture: 'stable' },
      decoration: 'low',
      spacingRhythm: 'tight 4px-base; density over breathing',
    },
    directive: 'dense evidence grid — one focal per viewport, compact type, decoration suppressed',
  },

  // once-seen surface: whitespace is the medium (breathing, luxury, hierarchy via scale).
  marketing: {
    label: 'marketing / landing',
    density: 'low', decoration: 'medium', focal: 1, posture: 'dynamic',
    contract: {
      'whitespace.freeRatio': ['>=', 0.35],
      'balance.BM': ['>=', 0.7],
      'hierarchy.clarity': ['>=', 0.82],
      'fluency.fluency': ['>=', 0.6],
    },
    budget: {
      freeRatio: { min: 0.35, target: 0.5 },
      typeScale: { id: 'dramatic', hint: 'large hero/body contrast (≈16/24/48/72)' },
      focalPoints: 1,
      balance: { target: 0.72, posture: 'dynamic' },
      decoration: 'medium',
      spacingRhythm: 'generous 8px-base; whitespace carries hierarchy',
    },
    directive: 'single hero focal — dramatic scale, generous whitespace, breathing over density',
  },

  // executive/evidence deck: sober, scannable, stable. Quantified claims, restrained type.
  report: {
    label: 'report / exec deck',
    density: 'medium', decoration: 'low', focal: 1, posture: 'stable',
    contract: {
      'whitespace.freeRatio': ['>=', 0.25],
      'balance.BM': ['>=', 0.85],
      'hierarchy.clarity': ['>=', 0.75],
      'fluency.fluency': ['>=', 0.72],
    },
    budget: {
      freeRatio: { min: 0.25, target: 0.35 },
      typeScale: { id: 'sober', hint: 'clear heading/body steps (≈14/18/28)' },
      focalPoints: 1,
      balance: { target: 0.86, posture: 'stable' },
      decoration: 'low',
      spacingRhythm: 'even 8px-base; scannable, evidence-style',
    },
    directive: 'sober evidence — one claim per slide, stable balance, restrained type',
  },

  // architecture/flow diagram: semantic structure dominates. Proximity = grouping meaning.
  diagram: {
    label: 'architecture / flow diagram',
    density: 'medium', decoration: 'minimal', focal: 0, posture: 'stable',
    contract: {
      'whitespace.freeRatio': ['>=', 0.2],
      'balance.BM': ['>=', 0.8],
      'hierarchy.clarity': ['>=', 0.7],
      'fluency.fluency': ['>=', 0.7],
    },
    budget: {
      freeRatio: { min: 0.2, target: 0.32 },
      typeScale: { id: 'paired', hint: 'node-label vs relationship-label; two voices' },
      focalPoints: 0,
      balance: { target: 0.82, posture: 'stable' },
      decoration: 'minimal',
      spacingRhythm: 'geometric; proximity encodes grouping (RANG-led)',
    },
    directive: 'semantic graph — proximity IS meaning, no decorative weight, labels legible',
  },

  // poster: distinctive, energetic, one strong focal; balance may carry tension.
  poster: {
    label: 'poster',
    density: 'medium', decoration: 'high', focal: 1, posture: 'dynamic',
    contract: {
      'whitespace.freeRatio': ['>=', 0.2],
      'balance.BM': ['>=', 0.6],
      'hierarchy.clarity': ['>=', 0.7],
      'fluency.fluency': ['>=', 0.5],
    },
    budget: {
      freeRatio: { min: 0.2, target: 0.4 },
      typeScale: { id: 'dramatic', hint: 'signature display type; one conviction' },
      focalPoints: 1,
      balance: { target: 0.65, posture: 'dynamic' },
      decoration: 'high',
      spacingRhythm: 'expressive; asymmetry allowed for energy',
    },
    directive: 'one signature decision — distinctive gestalt, not the statistical mode',
  },
};

// Criteria emitted for EVERY artifact type (P0 structural floor + group/color consistency).
// Tunable per-type thresholds are layered on top from the profile.
const BASE_CRITERIA = [
  { skill: 'collision', metric: 'count', op: '==', threshold: 0, weight: 3 },
  { skill: 'boundary', metric: 'overflowCount', op: '==', threshold: 0, weight: 3 },
  { skill: 'proximity', metric: 'fragmentedCount', op: '==', threshold: 0, weight: 1 },
  { skill: 'proximity', metric: 'falseAdjacencyCount', op: '==', threshold: 0, weight: 1 },
  { skill: 'harmony', metric: 'harmonyScore', op: '>=', threshold: 0.5, weight: 1 },
  { skill: 'similarity', metric: 'inconsistentGroups', op: '==', threshold: 0, weight: 1 },
];

// default weights for the tunable metrics (mirrors defaultContract so scores stay comparable)
const TUNABLE_WEIGHT = {
  whitespace: 1, balance: 1, hierarchy: 1.5, fluency: 1,
};

// Polanyi "negation > assertion" — ban the defaults. Deterministic banned-pattern list,
// not a taste judgment. (Token sandbox already bans arbitrary hex; this is the aesthetic
// cousin: ban the cliché gestalt.) The layout/copy rows name concrete anti-pattern tells
// (re-drawn chrome, mid-render token drift, two-line buttons, bare-1fr grids, hanging
// headers, invented metrics) — the ones that aren't deterministically detectable on ALT
// live here as generation heuristics; the geometrically-detectable one (hanging-header)
// ALSO has a discrete detector in lib/vuln.mjs.
//
// DOMAIN-SCOPING: each item is [text, domains?]. domains omitted = universal (every output
// format). domains present = format-specific — several gates are CSS/web-shaped by origin
// ("bare 1fr / minmax(0,1fr)" is CSS Grid, "oklch token block" is CSS, "browser bars /
// buttons / nav / CTA" are web-UI), so they're tagged html-only. Tagging keeps them from
// leaking into SVG/PPTX/diagram/docx preflight (telling a PPTX author to "use minmax(0,1fr)"
// is nonsense). negationFor(format) filters; no format on the brief → all items
// (backward-compatible).
const NEGATION_SPEC = {
  type: [
    ['generic sans as the SOLE typeface (pair a display/serif voice)'],
    ['more than 5 type sizes (a system, not accidents)'],
    ['mid-render token improvisation — every color/font must reference a named token; inline hex/oklch bypassing the token block is an escape hatch', ['html']],
  ],
  color: [
    ['purple→blue gradient on white (the default “AI” look)'],
    ['pure #000 on #FFF (use off-black/off-white)'],
    ['rainbow palette for non-ordinal categories'],
  ],
  layout: [
    ['identical spacing everywhere (commit a rhythm scale)'],
    ['50/50 split (reads indecisive — 60/40 or commit an asymmetry)'],
    ['identical shadow + corner-radius on every element (differentiate surfaces)'],
    ['every decision at the statistical mode (that is a template, not a design)'],
    ['hanging header / left-margin label — tag-left + heading-right two-column (the templated-editorial tell)'],
    ['bare 1fr grid tracks for image-bearing cells (use minmax(0,1fr))', ['html']],
    ['re-drawn fake chrome — browser bars, phone frames, code-window mockups (use real screenshots or omit)', ['html']],
    ['two-line clickable text — buttons / nav / CTA labels must fit one line', ['html']],
  ],
  copy: [
    ['invented metrics / testimonials / counts — “+47% conversion”, “trusted by 50,000+”, “10× faster” are slop the moment they are fabricated; use real numbers or a labelled placeholder, never invent'],
  ],
};

// Resolve the negation list for an output format. No format → every item (backward-compatible;
// a brief with no format gets the full universal + all format-specific bans as before).
export function negationFor(domain) {
  const out = {};
  for (const [cat, items] of Object.entries(NEGATION_SPEC)) {
    out[cat] = items.filter(([t, d]) => !d || !domain || d.includes(domain)).map(([t]) => t);
  }
  return out;
}

export function resolveProfile(brief) {
  const type = brief?.artifact_type;
  const prof = PROFILES[type];
  if (!prof) return null;
  return prof;
}

// Build the frozen contract from base + per-type tuned criteria.
export function buildContract(brief) {
  const prof = resolveProfile(brief);
  const type = prof ? brief.artifact_type : 'generic';
  const criteria = BASE_CRITERIA.map((c) => ({ ...c }));
  if (prof) {
    for (const [key, [op, threshold]] of Object.entries(prof.contract)) {
      const [skill, metric] = key.split('.');
      criteria.push({
        skill, metric, op, threshold,
        weight: TUNABLE_WEIGHT[skill] ?? 1,
      });
    }
  } else {
    // unknown type → neutral defaults so generation still gets a verifiable floor
    criteria.push({ skill: 'whitespace', metric: 'freeRatio', op: '>=', threshold: 0.2, weight: 1 });
    criteria.push({ skill: 'balance', metric: 'BM', op: '>=', threshold: 0.7, weight: 1 });
    criteria.push({ skill: 'hierarchy', metric: 'clarity', op: '>=', threshold: 0.7, weight: 1.5 });
    criteria.push({ skill: 'fluency', metric: 'fluency', op: '>=', threshold: 0.6, weight: 1 });
  }
  return {
    schema_version: 1,
    brief: brief?.brief || `${type} layout`,
    // NOTE: no artifact_type here — contract.schema.json is additionalProperties:false and
    // a contract is just {schema_version, brief, criteria}. The type lives on the preflight
    // spec wrapper so the emitted contract stays schema-valid for measure/fix/contract CLIs.
    criteria,
  };
}

// Assemble the full preflight spec.
// Structure pick precedence: brief signal (inferStructure) > diversify rotation (opts.log) >
// index 0. A brief that clearly signals a shape wins — forced variety on a signaled brief
// degrades quality. Without a signal AND without a log, the pick is index 0 and the spec stays
// byte-identical for the same brief (determinism guaranteed).
export function preflight(brief, opts = {}) {
  const prof = resolveProfile(brief);
  const contract = buildContract(brief);
  const type = prof ? brief.artifact_type : 'generic';
  const structures = prof ? (STRUCTURES[brief.artifact_type] || GENERIC_STRUCTURES) : GENERIC_STRUCTURES;
  const inferred = prof ? inferStructure(brief, brief.artifact_type) : null;
  let pickIdx;
  let reason;
  if (inferred) {
    pickIdx = Math.max(0, structures.findIndex((s) => s.id === inferred));
    reason = 'inferred';
  } else if (opts.log) {
    pickIdx = pickStructureIndex(structures, opts.log, type);
    reason = 'rotated';
  } else {
    pickIdx = 0;
    reason = 'default';
  }
  const structure = structures[pickIdx] || structures[0];
  return {
    schema_version: 1,
    artifact_type: type,
    recognized: Boolean(prof),
    directive: prof ? prof.directive : 'generic layout — no type profile; verifiable P0 floor only',
    contract, // feed to: bun lib/fix.mjs <layout> --contract <this>
    structure: { id: structure.id, shape: structure.shape }, // the structural prior (shape-only — no opinionated style/theme)
    structurePickReason: reason, // inferred (brief-fit) | rotated (diversify) | default (index 0)
    structures, // all available shapes for this type — generator/user may pick a different one explicitly
    budget: prof ? { ...prof.budget, density: prof.density, focal: prof.focal, posture: prof.posture } : {
      density: 'medium', decoration: 'medium', focal: 1, posture: 'neutral',
      freeRatio: { min: 0.2, target: 0.3 },
      typeScale: { id: 'generic', hint: 'no type profile — pick a scale and commit' },
      spacingRhythm: 'unspecified',
    },
    negation: negationFor(brief?.format), // HTML-only gates suppressed for svg/pptx/docx/diagram
    canvas: brief?.canvas || null,
    note: 'pre-generation spec. Generate against structure+budget+negation; accept with the contract via measure/fix.',
  };
}

// ---- CLI: bun lib/preflight.mjs <brief.json> [preflight.json] [--contract c.json] [--diversify [log.json]] ----
async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const briefPath = positional[0];
  if (!briefPath) {
    console.error('usage: bun lib/preflight.mjs <brief.json> [preflight.json] [--contract c.json] [--diversify [log.json]]');
    process.exit(2);
  }
  const brief = readJson(briefPath);
  await validate('brief', brief);

  // --diversify: read the rotation log so the structural prior differs from the last same-type run.
  // Determinism is preserved without the flag (preflight stays byte-identical for the same brief).
  const diversify = flags.diversify !== undefined;
  const logPath = typeof flags.diversify === 'string' && flags.diversify ? flags.diversify : defaultLogPath();
  const log = diversify ? readLog(logPath) : undefined;

  const spec = preflight(brief, log ? { log } : {});

  const outPath = positional[1] || path.join(process.cwd(), 'preflight.json');
  writeJson(outPath, spec);

  if (flags.contract) {
    writeJson(flags.contract, spec.contract);
  }

  if (diversify) {
    const updated = appendEntry(log, { ...fingerprint(spec), brief: brief?.brief || spec.artifact_type });
    writeLog(updated, logPath);
  }

  const b = spec.budget;
  console.log(
    `${spec.artifact_type}${spec.recognized ? '' : ' (generic)'} | structure ${spec.structure.id} (${spec.structurePickReason}) | freeRatio≥${(spec.contract.criteria.find((c) => c.skill === 'whitespace') || { threshold: '-' }).threshold} | balance≥${(spec.contract.criteria.find((c) => c.skill === 'balance') || { threshold: '-' }).threshold} | decoration ${b.decoration} | ${b.focal} focal | ${outPath}`,
  );
  if (flags.contract) console.log(`contract → ${flags.contract} (feed to: bun lib/fix.mjs <layout> --contract ${flags.contract})`);
  if (diversify) console.log(`diversification log → ${logPath}`);
}

if (isMain(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
