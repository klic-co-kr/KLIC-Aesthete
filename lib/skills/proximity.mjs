import { dist, coveredFraction, bboxGap } from '../geometry.mjs';
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
//
// Structural relations (diagram-gaps Gap A, svg-gated). An SVG import carries grouping
// semantics `related()` cannot see: (1) a non-text shape covering most of a label is its
// caption (labeled unit), (2) an unfilled path/line connector within EDGE_LABEL_GAP of a
// label is its edge label. Both pairs are one perceptual unit — force-unioned and exempt
// from false adjacency. The change is monotone by construction: S only ever grows the
// related set and the union-find, so FA/FG can only shrink and no new violation kind can
// appear. Gated on meta.source==='svg' so golden (abstract) and html/pptx stay unchanged.
// The skip gate counts related() pairs ONLY — S never feeds it (skip behavior preserved).
// EDGE_LABEL_GAP = max(EDGE_LABEL_MIN_PX, EDGE_LABEL_FS_RATIO × label fontSize).
const CONTAIN_FRAC = 0.8;

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
    const params = opts.params || loadParams(opts.profile);
    const { ALPHA, RANG_RATIO, FRAG_FACTOR, SIM_THRESHOLD, EDGE_LABEL_MIN_PX, EDGE_LABEL_FS_RATIO } = params.proximity;
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

    // Structural relations (Gap A, svg-only), O(n²) once before the main loop. Built AFTER
    // the skip gate above, which stays related()-only by design: a source with no
    // category/label semantics (e.g. a 3-node svg) still skips even when S is non-empty.
    // Non-svg sources build no pairs at all — that is what keeps golden (abstract) and
    // html/pptx proximity byte-identical.
    const structuralSet = new Set();
    const structuralPairs = [];
    if (alt.meta?.source === 'svg') {
      const addPair = (i, j) => {
        const a = Math.min(i, j);
        const b = Math.max(i, j);
        const k = `${a}:${b}`;
        if (!structuralSet.has(k)) {
          structuralSet.add(k);
          structuralPairs.push([a, b]);
        }
      };
      for (let i = 0; i < n; i++) {
        if (nodes[i].kind === 'text') continue;
        for (let j = 0; j < n; j++) {
          // (1) labeled unit: a non-text shape holding most of the label's bbox
          if (i === j || nodes[j].kind !== 'text') continue;
          if (coveredFraction(nodes[i].bbox, nodes[j].bbox) >= CONTAIN_FRAC) addPair(i, j);
        }
      }
      for (let i = 0; i < n; i++) {
        const c = nodes[i];
        // (2) edge label: an unfilled path/line connector next to its label. No thin guard —
        // any such connector within EDGE_LABEL_GAP of a text is that text's edge label.
        if (c.kind !== 'decor' || (c.shape !== 'path' && c.shape !== 'line') || c.style?.filled !== false) continue;
        for (let j = 0; j < n; j++) {
          const t = nodes[j];
          if (t.kind !== 'text') continue;
          const limit = Math.max(EDGE_LABEL_MIN_PX, EDGE_LABEL_FS_RATIO * (t.style?.fontSize || 0));
          if (bboxGap(c.bbox, t.bbox) <= limit) addPair(i, j);
        }
      }
    }

    // union-find
    const parent = nodes.map((_, i) => i);
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const union = (a, b) => { parent[find(a)] = find(b); };

    // structural pairs are one perceptual unit — union regardless of RANG. They share a
    // cluster either way, so the fragmentation pass (related && split) can never fire on them.
    for (const [i, j] of structuralPairs) union(i, j);

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
        const rel = related(nodes[i], nodes[j], SIM_THRESHOLD) || structuralSet.has(`${i}:${j}`);
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
