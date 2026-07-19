// Tunable skill parameters. Read from skill-params.json (if present) so the self-evolution
// tuner (lib/tune.mjs) can adjust cognition constants — e.g. proximity's α / FRAG_FACTOR —
// from human-preference diff analysis, WITHOUT editing code (제안서 §인간 선호 데이터 피드백 루프).
//
// Profiles: a `--profile <name>` write goes to skill-params.<name>.json so a single user
// edit never mutates the GLOBAL params every measurement reads. loadParams(profile) inherits
// the global file (then DEFAULTS) when the profile file is absent — safe default, no surprise.
// The no-argument loadParams() path is byte-identical to v1 (golden/measure stability).

import fs from 'node:fs';
import path from 'node:path';
import { skillRoot } from './shared/cli.mjs';

export const DEFAULT_PARAMS = {
  proximity: { ALPHA: 1.0, RANG_RATIO: 1.5, FRAG_FACTOR: 2.5, SIM_THRESHOLD: 0.6 },
};

const globalPath = () => path.join(skillRoot(), 'skill-params.json');
const profilePath = (profile) => path.join(skillRoot(), `skill-params.${profile}.json`);

let cached = null;                       // global (no-profile) cache
const profileCache = new Map();          // profile → params

function mergeDefaults(onDisk) {
  return { proximity: { ...DEFAULT_PARAMS.proximity, ...(onDisk?.proximity || {}) } };
}
function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

export function loadParams(profile) {
  // no-profile path: unchanged behavior (measure/fix rely on this staying stable)
  if (!profile) {
    if (cached) return cached;
    const onDisk = fs.existsSync(globalPath()) ? readJsonSafe(globalPath()) : null;
    cached = onDisk ? mergeDefaults(onDisk) : JSON.parse(JSON.stringify(DEFAULT_PARAMS));
    return cached;
  }
  if (profileCache.has(profile)) return profileCache.get(profile);
  // profile missing → inherit global → DEFAULTS (never throws, never surprises)
  const onDisk = fs.existsSync(profilePath(profile))
    ? readJsonSafe(profilePath(profile))
    : (fs.existsSync(globalPath()) ? readJsonSafe(globalPath()) : null);
  const params = onDisk ? mergeDefaults(onDisk) : JSON.parse(JSON.stringify(DEFAULT_PARAMS));
  profileCache.set(profile, params);
  return params;
}

// Deterministic backup name: counter based on existing siblings (no Date/wall-clock),
// so the tuner stays reproducible. skill-params.json → .backup-000, -001, …
function nextBackupName(target) {
  const dir = path.dirname(target);
  const base = path.basename(target);
  const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let max = -1;
  try {
    for (const f of fs.readdirSync(dir)) {
      const m = new RegExp(`^${esc}\\.backup-(\\d+)$`).exec(f);
      if (m) max = Math.max(max, +m[1]);
    }
  } catch { /* dir unreadable — fall through to 0 */ }
  return `${target}.backup-${String(max + 1).padStart(3, '0')}`;
}

export function writeParams(params, opts = {}) {
  const target = opts.profile ? profilePath(opts.profile) : globalPath();
  // rollback snapshot (best-effort): copy the file we're about to clobber so a bad
  // mutation can be reverted. Never blocks the write on a backup failure.
  if (opts.backup && fs.existsSync(target)) {
    try { fs.copyFileSync(target, nextBackupName(target)); } catch { /* advisory */ }
  }
  fs.writeFileSync(target, JSON.stringify(params, null, 2) + '\n', 'utf8');
  if (opts.profile) profileCache.delete(opts.profile); else cached = null;
}
