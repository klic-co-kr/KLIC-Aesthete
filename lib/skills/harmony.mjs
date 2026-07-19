import { hexToHsl } from '../color.mjs';
import { actualArea } from '../geometry.mjs';

// Color Harmony skill (제안서 §보색 모멘트 및 색채 균형 조화도).
// Pragmatic pure-JS operationalization (no Munsell/벡터 공간 렌더링):
//  - 각 채색 요소를 색상환 위의 면적 가중 단위벡터 (cos h, sin h)로 투영.
//  - momentBalance = 1 − |Σ Aᵢ·vᵢ| / ΣAᵢ  →  보색 모멘트 평형 (Σ Aᵢ·Dist(ωᵢ,ω₀)≈0 의 기하학적 등가).
//  - R(평균 합벡터 길이) = analogous(단색/유사색) 조화 점수.
//  - harmonyScore = max(R, momentBalance)  →  analogous OR 보색 평형 둘 다 조화로 인정.
//  - Birkhoff M = O/C (조화쌍 수 / 색 복잡도) 는 정보 메트릭.

const SAT_THRESHOLD = 0.08; // 채도 낮은 무채색(회색)은 색상 분석에서 제외(중성 = 조화)
const HUE_CLUSTER = 12;     // 이 각도 이내의 색상은 동일 색으로 군집

export default {
  id: 'harmony',
  tier: 'P2',
  weight: 1,
  effect: '보색 모멘트 평형 + analogous 그룹화(Birkhoff M=O/C, Munsell) → 색채 피로 감소, 지각적 안정·자연스러운 흐름.',
  observe(alt) { const ns = (alt.nodes||[]).filter(n=>n.bbox && n.style?.bg); return { coloredCount: ns.length }; },
  measure(alt) {
    const nodes = (alt.nodes || []).filter((n) => n.bbox && (n.style?.opacity ?? 1) >= 0.5);
    const colored = [];
    for (const n of nodes) {
      const hsl = n.style?.bg ? hexToHsl(n.style.bg) : null;
      if (!hsl || hsl.s < SAT_THRESHOLD) continue; // 무채색/알수없음 제외
      colored.push({ hsl, a: actualArea(n) });
    }

    const metrics = { distinctHues: 0, momentBalance: 1, analogousScore: 1, birkhoff: 1, harmonyScore: 1 };
    const violations = [];

    if (colored.length === 0) {
      return { score: 1, metrics, violations }; // 무채색 단일 구성 = 중성, 조화
    }

    // 면적 가중 색상환 합벡터 (보색 모멘트 평형)
    let sx = 0; let sy = 0; let sumA = 0;
    for (const c of colored) {
      const rad = (c.hsl.h * Math.PI) / 180;
      sx += c.a * Math.cos(rad);
      sy += c.a * Math.sin(rad);
      sumA += c.a;
    }
    const momentBalance = sumA > 0 ? 1 - Math.hypot(sx, sy) / sumA : 1;

    // 평균 합벡터 길이 R (analogous 점수, 비가중)
    let ux = 0; let uy = 0;
    for (const c of colored) {
      const rad = (c.hsl.h * Math.PI) / 180;
      ux += Math.cos(rad); uy += Math.sin(rad);
    }
    const R = Math.hypot(ux, uy) / colored.length;

    // distinct hues (clustering)
    const hues = colored.map((c) => c.hsl.h).sort((a, b) => a - b);
    let distinct = hues.length > 0 ? 1 : 0;
    for (let i = 1; i < hues.length; i++) {
      const diff = Math.abs(hues[i] - hues[i - 1]);
      if (Math.min(diff, 360 - diff) > HUE_CLUSTER) distinct++;
    }

    // Birkhoff M = O/C: 조화쌍(analogous≤30° or 보색 165~195°) 수 / (색 수−1)
    let harmoniousPairs = 0;
    for (let i = 0; i < colored.length; i++) {
      for (let j = i + 1; j < colored.length; j++) {
        const d = Math.abs(colored[i].hsl.h - colored[j].hsl.h);
        const sep = Math.min(d, 360 - d);
        if (sep <= 30 || (sep >= 165 && sep <= 195)) harmoniousPairs++;
      }
    }
    const birkhoff = distinct > 1 ? harmoniousPairs / (distinct - 1) : 1;

    const harmonyScore = Math.max(R, momentBalance);
    metrics.distinctHues = distinct;
    metrics.momentBalance = Number(momentBalance.toFixed(3));
    metrics.analogousScore = Number(R.toFixed(3));
    metrics.birkhoff = Number(birkhoff.toFixed(3));
    metrics.harmonyScore = Number(harmonyScore.toFixed(3));

    if (harmonyScore < 0.5 && distinct >= 3) {
      violations.push({
        severity: 'medium',
        metric: 'harmonyScore',
        measured: Number(harmonyScore.toFixed(3)),
        threshold: 0.5,
        message: `harmony: ${distinct} hues clashing (harmony ${harmonyScore.toFixed(2)} < 0.50) — converge to an analogous range or add a complement`,
        fix: { kind: 'converge-palette' },
      });
    } else if (momentBalance < 0.3 && distinct >= 2) {
      violations.push({
        severity: 'low',
        metric: 'momentBalance',
        measured: Number(momentBalance.toFixed(3)),
        threshold: 0.3,
        message: `harmony: color weight lopsided (moment ${momentBalance.toFixed(2)} < 0.30) — balance areas or add the missing complement`,
        fix: { kind: 'balance-color-weight' },
      });
    }

    return { score: Number(harmonyScore.toFixed(3)), metrics, violations };
  },
};
