import { actualArea, actualShapeComplexity } from '../geometry.mjs';
import { luminanceFromStyle, luminanceWeight } from '../color.mjs';

// Ngo's screen balance metric BM ∈ [0,1]. Optical weight W_j = Σ a·c·s·d over each
// quadrant half; BM = 1 − (|BMv| + |BMh|)/2. 1 = perfect equilibrium.
// c = luminanceWeight (dark = heavy), s = shapeComplexity (clamped ≤8).
export default {
  id: 'balance',
  tier: 'P2',
  weight: 1,
  effect: '광학 무게 중심의 평형(Ngo, 2001) → 정서적 안정감·시지각적 편안함, early visual processing 단과 연관(2024, Symmetry).',
  observe(alt) { const ns = (alt.nodes||[]).filter(n=>n.bbox); return { canvas: alt.meta?.canvas, elements: ns.length }; },
  measure(alt) {
    const canvas = alt.meta.canvas;
    const nodes = alt.nodes || [];
    const cx = canvas.w / 2;
    const cy = canvas.h / 2;

    const rows = nodes
      .filter((n) => n.bbox)
      .map((n) => {
        const [nx, ny] = [n.bbox.x + n.bbox.w / 2, n.bbox.y + n.bbox.h / 2];
        const a = actualArea(n);
        const opacity = n.style?.opacity ?? 1;          // backdrops weigh less
        const c = luminanceWeight(luminanceFromStyle(n.style)) * opacity;
        const s = actualShapeComplexity(n);
        return { n, nx, ny, w: a * c * s };
      });

    let WL = 0; let WR = 0; let WT = 0; let WB = 0;
    for (const r of rows) {
      const dv = Math.abs(r.nx - cx);
      const dh = Math.abs(r.ny - cy);
      if (r.nx < cx) WL += r.w * dv; else WR += r.w * dv;
      if (r.ny < cy) WT += r.w * dh; else WB += r.w * dh;
    }

    const safe = (l, r) => { const m = Math.max(l, r); return m === 0 ? 0 : (l - r) / m; };
    const BMv = safe(WL, WR);
    const BMh = safe(WT, WB);
    const BM = 1 - (Math.abs(BMv) + Math.abs(BMh)) / 2;
    const metrics = { BM: Number(BM.toFixed(3)), BMv: Number(BMv.toFixed(3)), BMh: Number(BMh.toFixed(3)) };

    const violations = [];
    if (BM < 0.85 && rows.length > 0) {
      const heavy = rows.reduce((acc, r) => (r.w > acc.w ? r : acc), rows[0]);
      const sideLR = BMv > 0 ? 'left-heavy' : 'right-heavy';
      const sideTB = BMh > 0 ? 'top-heavy' : 'bottom-heavy';
      violations.push({
        severity: 'medium',
        nodes: [heavy.n.id],
        metric: 'BM',
        measured: Number(BM.toFixed(3)),
        threshold: 0.85,
        message: `balance: BM ${BM.toFixed(2)} < 0.85 (${sideLR}, ${sideTB}) — shift heaviest /nodes/${heavy.n.id} toward canvas center`,
        fix: { kind: 'shift-heaviest-toward-center', node: heavy.n.id },
      });
    }
    return { score: Number(BM.toFixed(3)), metrics, violations };
  },
};
