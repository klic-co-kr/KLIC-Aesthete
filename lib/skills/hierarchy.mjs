import { contrastRatio } from '../color.mjs';

// Visual hierarchy clarity = font-size step regularity × contrast adequacy.
// stepRegularity rewards geometric font-size progressions (clear heading/body/caption scale).
// contrastAdequacy rewards WCAG AA (≥4.5:1) fg/bg contrast on text nodes.
export default {
  id: 'hierarchy',
  tier: 'P1',
  weight: 1.5,
  effect: '명확한 시각 계층 → Treisman Feature Integration Theory 기반 visual search 시간 단축, 정보 우선순위 즉시 인지.',
  observe(alt) { const ns = (alt.nodes||[]).filter(n=>n.style?.role && n.style.role!=="decor"); return { textNodes: ns.length, sizes: [...new Set(ns.map(n=>n.style?.fontSize).filter(Number.isFinite))] }; },
  measure(alt) {
    const nodes = alt.nodes || [];
    const violations = [];

    const sizes = [...new Set(
      nodes.map((n) => n.style?.fontSize).filter((v) => Number.isFinite(v) && v > 0),
    )].sort((a, b) => a - b);

    let stepReg = 1;
    if (sizes.length >= 2) {
      const logs = sizes.map((s) => Math.log(s));
      const steps = [];
      for (let i = 1; i < logs.length; i++) steps.push(logs[i] - logs[i - 1]);
      const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
      if (mean > 0) {
        const variance = steps.reduce((a, b) => a + (b - mean) ** 2, 0) / steps.length;
        stepReg = Math.max(0, 1 - Math.sqrt(variance) / mean);
      }
    }

    const textNodes = nodes.filter((n) => n.style && n.style.role && n.style.role !== 'decor');
    let contrastSum = 0;
    let contrastN = 0;
    for (const n of textNodes) {
      const fg = n.style?.color;
      const bg = n.style?.bg;
      if (fg && bg) {
        contrastSum += Math.min(1, contrastRatio(fg, bg) / 4.5);
        contrastN++;
      }
    }
    const contrastAdequacy = contrastN ? contrastSum / contrastN : 1;

    const clarity = Number((stepReg * contrastAdequacy).toFixed(3));
    // unmeasurable when neither dimension has input: <2 distinct sizes (stepReg defaults) AND
    // no text nodes with fg/bg contrast (contrastAdequacy defaults) → clarity is fully default 1.
    const coverage = (sizes.length < 2 && contrastN === 0) ? 'unmeasurable' : 'measured';
    const metrics = {
      clarity,
      stepRegularity: Number(stepReg.toFixed(3)),
      contrastAdequacy: Number(contrastAdequacy.toFixed(3)),
      distinctSizes: sizes.length,
    };

    if (clarity < 0.7) {
      if (stepReg < 0.7) {
        violations.push({
          severity: 'medium',
          metric: 'clarity',
          measured: clarity,
          threshold: 0.7,
          message: `hierarchy: font-size steps irregular (stepReg ${stepReg.toFixed(2)} < 0.70) — differentiate heading vs body scale`,
          fix: { kind: 'differentiate-scale' },
        });
      }
      if (contrastAdequacy < 0.7) {
        violations.push({
          severity: 'medium',
          metric: 'clarity',
          measured: clarity,
          threshold: 0.7,
          message: `hierarchy: contrast inadequate (${contrastAdequacy.toFixed(2)}) — raise fg/bg contrast toward WCAG AA (4.5:1)`,
          fix: { kind: 'raise-contrast' },
        });
      }
    }
    return { score: clarity, coverage, metrics, violations };
  },
};
