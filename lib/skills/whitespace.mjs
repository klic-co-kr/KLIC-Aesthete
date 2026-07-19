import { buildQuadtree, freeArea, largestFreeRect, margins } from '../quadtree.mjs';

// Active whitespace via occupancy quadtree (deterministic analog of the proposal's
// pixel local-variance measure — see DESIGN.md). freeRatio = free area / canvas area.
export default {
  id: 'whitespace',
  tier: 'P2',
  weight: 1,
  effect: '능동 여백으로 처리 유창성(Reber et al.) 극대화 → 시선 유도·cognitive load 감소, 시각 복잡도 통제(Fan et al.).',
  observe(alt) { const ns = (alt.nodes||[]).filter(n=>n.bbox && (n.style?.opacity??1)>=0.5); return { canvas: alt.meta?.canvas, contentNodes: ns.length }; },
  measure(alt) {
    const canvas = alt.meta.canvas;
    const nodes = alt.nodes || [];
    // occupancy counts only OPAQUE content; low-opacity backdrops (duo-tone panels) are
    // the icon's field, not "content density" — they must not read as cramped.
    const contentNodes = nodes.filter((n) => n.bbox && (n.style?.opacity ?? 1) >= 0.5);
    const boxes = contentNodes.map((n) => n.bbox);
    const canvasArea = Math.max(1, canvas.w * canvas.h);

    const qt = buildQuadtree(canvas, boxes);
    const free = freeArea(qt, boxes);
    const freeRatio = free / canvasArea;
    const largest = largestFreeRect(qt, boxes);
    const m = margins(boxes, canvas);
    const minMargin = Math.min(m.top, m.bottom, m.left, m.right);

    const metrics = {
      freeRatio: Number(freeRatio.toFixed(3)),
      largestFreeRect: { area: Math.round(largest.area), aspectRatio: Number(largest.aspectRatio.toFixed(2)) },
      margins: {
        top: Math.round(m.top), bottom: Math.round(m.bottom),
        left: Math.round(m.left), right: Math.round(m.right),
      },
      minMargin: Math.round(minMargin),
    };

    const violations = [];
    if (freeRatio < 0.25) {
      violations.push({
        severity: 'high',
        metric: 'freeRatio',
        measured: Number(freeRatio.toFixed(3)),
        threshold: 0.25,
        message: `whitespace: freeRatio ${freeRatio.toFixed(2)} < 0.25 — content cramped; enlarge margins or scale group down`,
        fix: { kind: 'scale-group-down', factor: 0.9 },
      });
    }

    // score: the only whitespace FAILURE mode in v1 is cramping (freeRatio < 0.25).
    // Generous whitespace is healthy (processing fluency); distribution quality is
    // owned by the balance skill, not double-counted here.
    const score = freeRatio >= 0.25 ? 1 : freeRatio / 0.25;

    return { score: Number(score.toFixed(3)), metrics, violations };
  },
};
