import { center } from '../geometry.mjs';

// Structural symmetry — reflective (bilateral across V/H axes) + rotational (180°).
//
// Why a separate skill: Ngo `balance` measures optical-WEIGHT equilibrium (coarse left/right),
// which is NOT symmetry. For icons and geometric compositions the perceived axis is structural
// mirroring — a node's mirror partner must exist at the mirrored position (and, for a true
// mirror, with the same color). This is the axis the layout-aesthetic skills miss, which is
// why four icons of clearly different symmetry all scored ~0.91–1.00 on measuredAesthetic.

const tolFor = (canvas) => Math.max(2, 0.04 * Math.min(canvas.w, canvas.h));

function colorOf(n) {
  return n.style?.bg && n.style.bg !== 'none' ? n.style.bg : null;
}

// find a node whose center is within tol of `pt`, similar size, and same color (if colors exist)
function findMirror(nodes, pt, w, h, color, tol, exclude) {
  for (let i = 0; i < nodes.length; i++) {
    if (i === exclude) continue;
    const n = nodes[i];
    const [nx, ny] = center(n.bbox);
    if (Math.hypot(nx - pt[0], ny - pt[1]) > tol) continue;
    if (Math.abs(n.bbox.w - w) > tol || Math.abs(n.bbox.h - h) > tol) continue;
    const mc = colorOf(n);
    if (color && mc && mc !== color) continue; // true mirror ⇒ same color
    return i;
  }
  return -1;
}

// fraction of nodes that have a mirror partner (or sit on the axis/center)
function reflectiveScore(nodes, axis, c, canvas) {
  const tol = tolFor(canvas);
  const matched = new Set();
  for (let i = 0; i < nodes.length; i++) {
    const [nx, ny] = center(nodes[i].bbox);
    const onAxis = axis === 'x' ? Math.abs(nx - c) <= tol : Math.abs(ny - c) <= tol;
    if (onAxis) { matched.add(i); continue; }
    const mir = axis === 'x' ? [2 * c - nx, ny] : [nx, 2 * c - ny];
    const j = findMirror(nodes, mir, nodes[i].bbox.w, nodes[i].bbox.h, colorOf(nodes[i]), tol, i);
    if (j >= 0) { matched.add(i); matched.add(j); }
  }
  return nodes.length ? matched.size / nodes.length : 1;
}

function rotationalScore(nodes, cx, cy, canvas) {
  const tol = tolFor(canvas);
  const matched = new Set();
  for (let i = 0; i < nodes.length; i++) {
    const [nx, ny] = center(nodes[i].bbox);
    if (Math.hypot(nx - cx, ny - cy) <= tol) { matched.add(i); continue; } // on center → self-map
    const rot = [2 * cx - nx, 2 * cy - ny];
    const j = findMirror(nodes, rot, nodes[i].bbox.w, nodes[i].bbox.h, colorOf(nodes[i]), tol, i);
    if (j >= 0) { matched.add(i); matched.add(j); }
  }
  return nodes.length ? matched.size / nodes.length : 1;
}

export default {
  id: 'symmetry',
  tier: 'P2',
  weight: 1,
  effect: '구조적 대칭(반사·180° 회전) — 아이콘·기하 구성의 지각적 안정축. Ngo 무게-평형(balance)과는 다른, 거울/회전 일치 기반의 축.',
  measure(alt) {
    const canvas = alt.meta?.canvas || { w: 0, h: 0 };
    const nodes = (alt.nodes || []).filter((n) => n.bbox);
    const n = nodes.length;
    if (n < 2 || !canvas.w || !canvas.h) {
      return { score: 1, coverage: 'unmeasurable', metrics: { symmetryScore: 1, reflectiveV: 1, reflectiveH: 1, rotational: 1 }, violations: [] };
    }
    const cx = canvas.w / 2;
    const cy = canvas.h / 2;
    const reflectiveV = reflectiveScore(nodes, 'x', cx, canvas); // mirror across vertical centerline
    const reflectiveH = reflectiveScore(nodes, 'y', cy, canvas); // mirror across horizontal centerline
    const rotational = rotationalScore(nodes, cx, cy, canvas);   // 180° about center
    const symmetryScore = Math.max(reflectiveV, reflectiveH, rotational); // best symmetry present
    const metrics = {
      symmetryScore: Number(symmetryScore.toFixed(3)),
      reflectiveV: Number(reflectiveV.toFixed(3)),
      reflectiveH: Number(reflectiveH.toFixed(3)),
      rotational: Number(rotational.toFixed(3)),
    };
    const violations = [];
    if (symmetryScore < 0.85) {
      violations.push({
        severity: 'medium',
        metric: 'symmetryScore',
        measured: Number(symmetryScore.toFixed(3)),
        threshold: 0.85,
        message: `symmetry: composition is asymmetric (best axis ${symmetryScore.toFixed(2)} < 0.85; V ${reflectiveV.toFixed(2)}/H ${reflectiveH.toFixed(2)}/rot ${rotational.toFixed(2)}) — for icons/geometric work, symmetry is the salient axis`,
        fix: { kind: 'symmetrize' }, // mirror partners need source ownership → suggestionOnly
      });
    }
    return { score: Number(symmetryScore.toFixed(3)), coverage: 'measured', metrics, violations };
  },
};
