import collision from './collision.mjs';
import boundary from './boundary.mjs';
import proximity from './proximity.mjs';
import balance from './balance.mjs';
import whitespace from './whitespace.mjs';
import hierarchy from './hierarchy.mjs';
import harmony from './harmony.mjs';
import similarity from './similarity.mjs';
import fluency from './fluency.mjs';
import symmetry from './symmetry.mjs';

// Skill registry. Each skill is an independent capsule with the 3-layer structure
// from the proposal: observe/measure (geometry) + effect (cognitive rationale).
// NOTE: `symmetry` is OPT-IN (icon/geometric axis) — not in the default layout set, because
// most layouts are deliberately asymmetric and symmetry would false-positive there. measure.mjs
// adds it via --symmetry. See lib/skills/symmetry.mjs.
export const SKILLS = [collision, boundary, proximity, balance, whitespace, hierarchy, harmony, similarity, fluency];

// specialty skills, included only on request (e.g. icon/geometric composition)
export const SPECIALTY = { symmetry };

export const byId = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

export const TIER_ORDER = { P0: 0, P1: 1, P2: 2 };

export function tierRank(tier) {
  return TIER_ORDER[tier] ?? 9;
}
