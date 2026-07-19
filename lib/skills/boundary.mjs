import { overflow } from '../geometry.mjs';

// P0 hard constraint: every node must stay inside the canvas. Readability floor.
export default {
  id: 'boundary',
  tier: 'P0',
  weight: 3,
  effect: '캔버스 내 완결 배치로 게슈탈트 폐쇄성(closure) 만족 → 잘림으로 인한 인지 단절·불안 방지.',
  observe(alt) { return { canvas: alt.meta?.canvas, nodeCount: (alt.nodes||[]).filter(n=>n.bbox).length }; },
  measure(alt) {
    const canvas = alt.meta.canvas;
    const nodes = alt.nodes || [];
    const violations = [];
    let total = 0;
    for (const n of nodes) {
      if (!n.bbox) continue;
      const ov = overflow(n.bbox, canvas);
      if (ov.total > 0) {
        violations.push({
          severity: 'high',
          nodes: [n.id],
          metric: 'overflowCount',
          measured: Math.round(ov.total),
          threshold: 0,
          message: `boundary: /nodes/${n.id} overflows canvas by ${Math.round(ov.total)}px (threshold 0px) — clamp into ${Math.round(canvas.w)}×${Math.round(canvas.h)}`,
          fix: { kind: 'clamp-overflow', node: n.id },
        });
        total += ov.total;
      }
    }
    const count = violations.length;
    return {
      score: count === 0 ? 1 : 0,
      metrics: { overflowCount: count, totalOverflowPx: Math.round(total) },
      violations,
    };
  },
};
