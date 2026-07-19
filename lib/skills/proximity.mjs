import { dist } from '../geometry.mjs';
import { ratcliffObershelp } from '../similarity.mjs';
import { loadParams } from '../skill-params.mjs';

// Gestalt proximity grouping. Operationalization:
//   nn_i  = nearest-neighbor center distance per node.
//   d_ref = median(nn_i)  → typical "expected" spacing (robust scale reference).
//           (The proposal names this d_min; we use the MEDIAN nearest-neighbor
//            distance as the reference so the exponential discriminates instead of
//            collapsing toward 0 — with a literal global-min d_min the closest pair
//            always has d/d_min = 1 and nothing ever clusters.)
//   P_group(i,j) = exp(-α · d_ij / d_ref)  (α = 1.0) — informational confidence, reported as meanGroupP.
//   RANG edge   : d_ij ≤ RANG_RATIO · min(nn_i, nn_j)   → relative proximity (scale-invariant).
// Clustering/violation DECISIONS use RANG edges (robust); P_group is reported only.
// α / RANG_RATIO / FRAG_FACTOR are tunable via skill-params.json (self-evolution tuner).

function pGroup(d, dRef, alpha) {
  if (dRef <= 0) return d <= 0 ? 1 : 0;
  return Math.exp(-alpha * d / dRef);
}

function related(a, b, simThreshold) {
  // category is an explicit GROUP ID: only an exact match means "same cluster".
  // RO label similarity is a fallback only when one or both lack a category.
  if (a.category && b.category) return a.category === b.category;
  const sa = a.category || a.label || '';
  const sb = b.category || b.label || '';
  if (!sa || !sb) return false;
  return ratcliffObershelp(sa, sb) >= simThreshold;
}

function median(vals) {
  if (!vals.length) return 0;
  const s = [...vals].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export default {
  id: 'proximity',
  tier: 'P2',
  weight: 1,
  effect: '근접 요소를 단일 지각 단위로 군집화(Wertheimer, 1923) → 불필요 saccade 감소·처리 유창성(Reber)↑ → 인지 부하·탐색 마찰 감소.',
  observe(alt) { const ns = (alt.nodes||[]).filter(n=>n.bbox); return { nodeCount: ns.length, categories: [...new Set(ns.map(n=>n.category).filter(Boolean))] }; },
  measure(alt, opts = {}) {
    const { ALPHA, RANG_RATIO, FRAG_FACTOR, SIM_THRESHOLD } = loadParams(opts?.profile).proximity;
    const nodes = (alt.nodes || []).filter((n) => n.bbox);
    const n = nodes.length;
    if (n < 2) {
      return {
        score: 1,
        coverage: 'unmeasurable', // <2 nodes — clustering is undefined
        metrics: { fragmentedCount: 0, falseAdjacencyCount: 0, meanGroupP: 1 },
        violations: [],
      };
    }

    const D = (i, j) => dist(nodes[i].bbox, nodes[j].bbox);

    // nearest-neighbor distance per node
    const nn = new Array(n).fill(Infinity);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const d = D(i, j);
        if (d < nn[i]) nn[i] = d;
      }
    }
    const finiteNn = nn.filter((v) => Number.isFinite(v));
    const dRef = Math.max(median(finiteNn), 1e-6);

    // grouping signal: if NO pair of nodes is "related" (the source carries no grouping
    // semantics — e.g. a pptx where every shape is its own group), proximity can't judge
    // clustering intent. Skip gracefully instead of manufacturing false positives.
    let relatedPairs = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (related(nodes[i], nodes[j], SIM_THRESHOLD)) relatedPairs++;
    if (relatedPairs === 0) {
      return {
        score: 1,
        coverage: 'unmeasurable', // no grouping semantics in the source — can't judge clustering
        metrics: { fragmentedCount: 0, falseAdjacencyCount: 0, meanGroupP: 1, skipped: true },
        violations: [],
      };
    }

    // union-find
    const parent = nodes.map((_, i) => i);
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const union = (a, b) => { parent[find(a)] = find(b); };

    const rangEdge = (i, j) => {
      const ni = Number.isFinite(nn[i]) ? nn[i] : dRef;
      const nj = Number.isFinite(nn[j]) ? nn[j] : dRef;
      return D(i, j) <= RANG_RATIO * Math.min(ni, nj);
    };

    let pSum = 0;
    let pCount = 0;
    let fragmentedCount = 0;
    let falseAdjacencyCount = 0;
    const violations = [];

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = D(i, j);
        pSum += pGroup(d, dRef, ALPHA);
        pCount++;
        const rel = related(nodes[i], nodes[j], SIM_THRESHOLD);
        const e = rangEdge(i, j);
        if (e && rel) union(i, j);
        if (e && !rel) {
          falseAdjacencyCount++;
          violations.push({
            severity: 'medium',
            nodes: [nodes[i].id, nodes[j].id],
            metric: 'falseAdjacencyCount',
            measured: Number(pGroup(d, dRef, ALPHA).toFixed(3)),
            threshold: 0,
            message: `proximity: /nodes/${nodes[i].id} ↔ /nodes/${nodes[j].id} too close (d ${Math.round(d)} ≤ ${RANG_RATIO}×nn) but unrelated — increase gap`,
            fix: { kind: 'increase-gap', a: nodes[i].id, b: nodes[j].id },
          });
        }
      }
    }

    // fragmentation: related pair split across clusters AND much farther than typical spacing
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (!related(nodes[i], nodes[j], SIM_THRESHOLD) || find(i) === find(j)) continue;
        const d = D(i, j);
        if (d > FRAG_FACTOR * dRef) {
          fragmentedCount++;
          violations.push({
            severity: 'medium',
            nodes: [nodes[i].id, nodes[j].id],
            metric: 'fragmentedCount',
            measured: Math.round(d),
            threshold: Math.round(FRAG_FACTOR * dRef),
            message: `proximity: /nodes/${nodes[i].id} ↔ /nodes/${nodes[j].id} related but split (d ${Math.round(d)} > ${FRAG_FACTOR}×typical ${Math.round(dRef)}) — move closer into one cluster`,
            fix: { kind: 'shift-toward-cluster-centroid', node: nodes[j].id, toward: nodes[i].id },
          });
        }
      }
    }

    const meanGroupP = pCount ? Number((pSum / pCount).toFixed(3)) : 1;
    const bad = fragmentedCount + falseAdjacencyCount;
    const score = bad === 0 ? 1 : Math.max(0, 1 - bad * 0.25);
    return {
      score: Number(score.toFixed(3)),
      metrics: { fragmentedCount, falseAdjacencyCount, meanGroupP },
      violations,
    };
  },
};
