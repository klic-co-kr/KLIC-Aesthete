// Bradley-Terry model: pairwise comparison results → a scalar strength per item (maximum-
// likelihood). The piece Phase 4 needs to turn raw pairwise human votes ("design A preferred over
// B") into a per-item humanScore that validate.mjs can then correlate against the engine's score.
//
// Deterministic (Zermelo/Ford iterative MLE, fixed iteration count — no random, no Date). The
// measurement core stays pure; this is a small stats utility, not a skill.
//
// Input:  pairs — [{winner, loser}] or [{winner, loser, count}] (count = repeated matchups).
// Output: Map<item, number> — relative strengths, normalized to sum 1 (so directly comparable as
//         a humanScore). Items that never win converge toward 0.

export function bradleyTerry(pairs, opts = {}) {
  const iters = opts.iters || 100;
  const wins = new Map();       // item → total wins
  const matchups = new Map();   // item → Map<opponent, n_ij>
  const items = new Set();
  const bump = (m, k, n) => m.set(k, (m.get(k) || 0) + n);

  for (const p of pairs || []) {
    const { winner: w, loser: l } = p;
    if (w == null || l == null || w === l) continue;
    const n = p.count || 1;
    items.add(w); items.add(l);
    bump(wins, w, n);
    if (!matchups.has(w)) matchups.set(w, new Map());
    if (!matchups.has(l)) matchups.set(l, new Map());
    bump(matchups.get(w), l, n);
    bump(matchups.get(l), w, n);
  }

  let strength = new Map();
  for (const it of items) strength.set(it, 1); // uniform start
  for (let k = 0; k < iters; k++) {
    const next = new Map();
    for (const i of items) {
      const wi = wins.get(i) || 0;
      const pi = strength.get(i);
      let denom = 0;
      for (const [j, nij] of matchups.get(i) || new Map()) denom += nij / (pi + strength.get(j));
      next.set(i, denom > 0 ? wi / denom : pi);
    }
    strength = next;
  }

  const sum = [...strength.values()].reduce((a, b) => a + b, 0) || 1;
  for (const it of items) strength.set(it, strength.get(it) / sum);
  return strength;
}

// Convenience: ranks from a strength map (highest first), for sanity-checking the ordering.
export function rankByStrength(strength) {
  return [...strength.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
