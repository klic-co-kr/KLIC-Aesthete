#!/usr/bin/env node
// Phase 4 harness — turns raw pairwise human votes into a validate.mjs-ready human corpus.
//
// The validation goal (ρ≥0.4 vs human preference) needs REAL human ratings, which is an external
// 2–3-week track (recruit raters, collect pairwise votes). This script is the PLUMBING: given a
// corpus of items (each with an `alt`) and a list of pairwise votes (rater preferred winner over
// loser), it computes a Bradley-Terry humanScore per item and emits a corpus that `lib/validate.mjs`
// correlates against the engine's measuredAestheticScore. No raters → can't run the study; this
// just makes the study plug-and-play when votes exist.
//
//   bun scripts/build-human-corpus.mjs <corpus.json> <votes.json> [out.json]
//   bun lib/validate.mjs out.json
//
// corpus.json: { entries: [{ id, alt }, ...] }
// votes.json:  [{ winner: id, loser: id }, ...]  (or { winner, loser, count })

import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, parseArgs, skillRoot, isMain } from '../lib/shared/cli.mjs';
import { bradleyTerry } from '../lib/bradley-terry.mjs';

async function main() {
  const { positional } = parseArgs(process.argv.slice(2));
  const [corpusPath, votesPath] = positional;
  if (!corpusPath || !votesPath) {
    console.error('usage: bun scripts/build-human-corpus.mjs <corpus.json> <votes.json> [out.json]');
    process.exit(2);
  }
  const corpus = readJson(corpusPath);
  const votes = readJson(votesPath);
  const strength = bradleyTerry(votes);
  const entries = (corpus.entries || []).map((e) => ({
    id: e.id,
    humanScore: Number((strength.get(e.id) ?? 0).toFixed(6)),
    alt: e.alt,
  }));
  const out = {
    schema_version: 1,
    demo: false,
    note: 'Human-rated corpus — humanScore = Bradley-Terry strength on pairwise votes (NOT the engineered-defect placeholder of the synthetic corpus). When fed to lib/validate.mjs this is the real aesthetic-preference correlation the project needs.',
    entries,
  };
  const outPath = positional[2] || path.join(process.cwd(), 'human-corpus.json');
  writeJson(outPath, out);
  const rated = entries.filter((e) => e.humanScore > 0).length;
  console.log(`human corpus: ${rated}/${entries.length} items rated from ${votes.length} votes → ${outPath}`);
  console.log('next: bun lib/validate.mjs ' + outPath);
}

if (isMain(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
