import { rectsOverlap, overlapDepth } from '../geometry.mjs';

// P0 hard constraint: no two nodes may overlap. Highest priority — readability floor.
export default {
  id: 'collision',
  tier: 'P0',
  weight: 3,
  effect: '요소 겹침 제거로 명확한 figure-ground 분리를 복원 → saccadic eye movement 안정화. 가독성의 최상위 전제(P0).',
  observe(alt) { const ns = (alt.nodes||[]).filter(n=>n.bbox && (n.style?.opacity??1)>=0.5); return { nodeCount: ns.length, candidatePairs: ns.length*(ns.length-1)/2 }; },
  measure(alt, opts = {}) {
    // gap = required separation tolerance (default 0). Read from opts so the orchestrator
    // can pass { profile } without colliding with this positional parameter.
    const gap = Number.isFinite(opts?.gap) ? opts.gap : 0;
    const nodes = alt.nodes || [];
    const violations = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        if (!a.bbox || !b.bbox) continue;
        // auxiliary/backdrop elements (opacity < 0.5) are not collision targets —
        // opaque objects legitimately sit on a low-opacity panel (duo-tone design).
        const opA = a.style?.opacity ?? 1;
        const opB = b.style?.opacity ?? 1;
        if (opA < 0.5 || opB < 0.5) continue;
        // stroke–stroke crossings are intentional line-art (icons/outlines), not layout
        // collisions: skip when BOTH elements are unfilled (lucide fill="none" → filled=false).
        // Filled-region overlaps (the layout case) are still flagged. `filled` defaults true
        // (backward-compat: pre-existing ALTs without the flag are treated as filled).
        if (a.style?.filled === false && b.style?.filled === false) continue;
        if (rectsOverlap(a.bbox, b.bbox, gap)) {
          const d = overlapDepth(a.bbox, b.bbox);
          const minAxis = d.x <= d.y ? 'X' : 'Y';
          const mag = Math.min(d.x, d.y);
          violations.push({
            severity: 'high',
            nodes: [a.id, b.id],
            metric: 'count',
            measured: Number(mag.toFixed(1)),
            threshold: 0,
            message: `collision: /nodes/${a.id} ↔ /nodes/${b.id} overlap ${Math.round(mag)}px on ${minAxis} (threshold 0px) — separate along ${minAxis}`,
            fix: { kind: 'separate-overlap', a: a.id, b: b.id, axis: minAxis, magnitude: mag, gap },
          });
        }
      }
    }
    const count = violations.length;
    return { score: count === 0 ? 1 : 0, metrics: { count }, violations };
  },
};
