import { rectsOverlap, overlapDepth } from '../geometry.mjs';

function contains(outer, inner, epsilon = 0.5) {
  return inner.x >= outer.x - epsilon
    && inner.y >= outer.y - epsilon
    && inner.x + inner.w <= outer.x + outer.w + epsilon
    && inner.y + inner.h <= outer.y + outer.h + epsilon;
}

// Gap B: a thin stroke-only connector (fill="none" <path>/<line>) has a bbox that IS the
// stroke line, but its stroke still paints a band of real ink — (strokeWidth)/2 on each side.
// THIN_MAX keeps the check to straight horizontal/vertical connectors whose bbox is a sliver;
// diagonal/curved paths (bbox mostly empty) and icon outlines stay exempt.
export const THIN_MAX = 4;

// Named exports so the fixer can reuse the exact same thin-connector semantics it measures
// with (measure/fix must agree on what counts as a thin connector).
export function isThinConnector(n) {
  const b = n?.bbox;
  return n?.kind === 'decor'
    && (n.shape === 'path' || n.shape === 'line')
    && n.style?.filled === false
    && !!b
    && Math.min(b.w, b.h) <= THIN_MAX;
}

// The real ink band of a thin connector: its line bbox inflated by strokeWidth/2 per side
// (strokeWidth falls back to 1 for ALTs recorded before the svg adapter tracked it).
export function strokeBand(n) {
  const r = (n.style?.strokeWidth ?? 1) / 2;
  return {
    x: n.bbox.x - r,
    y: n.bbox.y - r,
    w: n.bbox.w + 2 * r,
    h: n.bbox.h + 2 * r,
  };
}

// The tangency shrink the band check applies to the label side. The label's conservative ink
// box (baseline − 0.8em, h = fs) overhangs D3-style axis labels that legitimately sit close
// to their axis, so shrink it vertically by TANGENCY_EPS = max(1, 0.15·fs) per side first;
// a standard 0.75em axis label then stays clear of the band. Named export: the fixer must
// shrink identically — measure/fix agreement is the whole point of the band check.
export function tangencyShrunk(n) {
  const eps = Math.max(1, 0.15 * (n.style?.fontSize ?? 0));
  return {
    x: n.bbox.x,
    y: n.bbox.y + eps,
    w: n.bbox.w,
    h: n.bbox.h - 2 * eps,
  };
}

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
        // Gap B exception, evaluated before the blanket decor skip: the ONLY decor pair that
        // can still collide is a thin stroke-only connector whose stroke band crosses OPAQUE
        // text — the stroke paints through the glyphs. The label's conservative ink box
        // (baseline − 0.8em, h = fs) overhangs D3-style axis labels that legitimately sit
        // close to their axis, so shrink it vertically by TANGENCY_EPS = max(1, 0.15·fs) per
        // side first; a standard 0.75em axis label then stays clear of the band.
        if ((a.kind === 'text' && isThinConnector(b)) || (b.kind === 'text' && isThinConnector(a))) {
          const text = a.kind === 'text' ? a : b;
          const connector = text === a ? b : a;
          // The translucency exemption applies inside this branch too: half-transparent
          // guidelines are auxiliary ink, same threshold as the generic opacity guard below.
          const opText = text.style?.opacity ?? 1;
          const opCon = connector.style?.opacity ?? 1;
          if (opText >= 0.5 && opCon >= 0.5) {
            const shrunk = tangencyShrunk(text);
            const band = strokeBand(connector);
            if (shrunk.h > 0 && rectsOverlap(band, shrunk, gap)) {
              const d = overlapDepth(band, shrunk);
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
          // Either way the connector stays exempt in every other pairing (box/icon/stroke).
          continue;
        }
        // Connectors, shadows and other explicitly decorative SVG geometry are not independent
        // layout objects. Their bbox is intentionally allowed to cross content.
        if (a.kind === 'decor' || b.kind === 'decor') continue;
        // A container is expected to hold labels, icons and cards. Only containment is exempt;
        // peer containers that partially overlap are still reported.
        if ((a.kind === 'container' && contains(a.bbox, b.bbox))
            || (b.kind === 'container' && contains(b.bbox, a.bbox))) continue;
        // auxiliary/backdrop elements (opacity < 0.5) are not collision targets —
        // opaque objects legitimately sit on a low-opacity panel (duo-tone design).
        const opA = a.style?.opacity ?? 1;
        const opB = b.style?.opacity ?? 1;
        if (opA < 0.5 || opB < 0.5) continue;
        // stroke–stroke crossings are intentional line-art (icons/outlines), not layout
        // collisions: skip when BOTH elements are unfilled stroke shapes (lucide fill="none").
        // Text and raster <image> are never line art: class-styled web SVG may not expose its
        // fill attribute while the PowerPoint-safe sibling does, and both formats must report
        // the same overlap. An <image> carries no fill attribute at all, so without excluding
        // it here two overlapping raster images would be mistaken for crossing strokes.
        // `filled` otherwise defaults true for backward-compatible ALT behavior.
        const strokeOnlyA = a.kind !== 'text' && a.kind !== 'image' && a.style?.filled === false;
        const strokeOnlyB = b.kind !== 'text' && b.kind !== 'image' && b.style?.filled === false;
        if (strokeOnlyA && strokeOnlyB) continue;
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
