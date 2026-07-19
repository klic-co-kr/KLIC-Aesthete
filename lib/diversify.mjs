#!/usr/bin/env node
// Diversification log — keeps consecutive preflight outputs from sharing a structural fingerprint.
//
// preflight is deterministic by identity (same brief → byte-identical spec). Diversification is
// OPT-IN: it activates ONLY when a log is supplied (CLI --diversify, or opts.log). With a log,
// the structural-prior pick rotates off the last-used one for the same artifact_type, so two
// dashboard briefs in a row land on different shapes (evidence-grid → bento → split-pane).
//
// This is the structural-variety rotation that keeps consecutive outputs of the same type
// from sharing a shape. The rotation is index-based and deterministic (no Date.now /
// Math.random), and it rotates structural SHAPE only, never style/theme (measure-neutral).

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_LOG = '.aesthete/log.json';
const CAP = 20; // rolling window of recent runs

export function defaultLogPath() {
  return DEFAULT_LOG;
}

// Read the log (array, newest-first). Missing/unreadable → [] (first run, no constraint).
export function readLog(filePath = DEFAULT_LOG) {
  try {
    const j = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

export function writeLog(entries, filePath = DEFAULT_LOG) {
  fs.mkdirSync(path.dirname(filePath) || '.', { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(entries.slice(0, CAP), null, 2) + '\n');
}

// Which structure index to pick given the log. Deterministic: the index AFTER the last-used one
// for this artifact_type (mod len). No log / no prior entry for the type → 0 (first structure).
export function pickStructureIndex(structures, log, artifactType) {
  if (!Array.isArray(structures) || structures.length === 0) return 0;
  const prior = (log || []).find((e) => e && e.artifact_type === artifactType && e.structure != null);
  if (!prior) return 0;
  const lastIdx = structures.findIndex((s) => s.id === prior.structure);
  if (lastIdx < 0) return 0; // last-used id no longer in the catalog → restart at 0
  return (lastIdx + 1) % structures.length;
}

// Append a preflight run (newest-first). seq increments off the current max — no Date.
export function appendEntry(log, entry) {
  const seq = (log || []).reduce((m, e) => Math.max(m, Number(e?.seq) || 0), 0) + 1;
  return [{ seq, ...entry }, ...(log || [])].slice(0, CAP);
}

// Structural fingerprint of a preflight spec — two same-type runs should differ on at least
// structure.id (the primary rotation axis).
export function fingerprint(spec) {
  return {
    artifact_type: spec.artifact_type,
    structure: spec.structure?.id,
    freeRatio: spec.budget?.freeRatio?.target,
    typeScale: spec.budget?.typeScale?.id,
    posture: spec.budget?.posture,
  };
}
