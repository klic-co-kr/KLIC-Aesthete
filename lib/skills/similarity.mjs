import { actualArea } from '../geometry.mjs';
import { hexToHsl } from '../color.mjs';

// Gestalt Similarity (게슈탈트 유사성). 같은 그룹(category) + 같은 종류(kind)의 요소는
// 시각적으로 일관(크기·명도·색상)해야 "유사성" 단서로 군집화가 강화된다.
// 비교 단위를 category∩kind로 좁혀, "카드=박스+라벨" 같은 의도적 역할 차이는
// 위반으로 오판하지 않는다(박스와 라벨은 kind가 다르므로 비교 대상 아님).

const SAT_THRESHOLD = 0.08;

// (max-min)/|mean| 정규화 산포 → 0(일관) .. 1+(불일관)
function normSpread(vals) {
  if (vals.length < 2) return 0;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const range = max - min;
  return mean !== 0 ? range / Math.abs(mean) : range;
}

// 원형 산포(색상): 0(한 색) .. 1(균등 분산)
function circSpread(hues) {
  if (hues.length < 2) return 0;
  let sx = 0; let sy = 0;
  for (const h of hues) { const r = (h * Math.PI) / 180; sx += Math.cos(r); sy += Math.sin(r); }
  return 1 - Math.hypot(sx, sy) / hues.length;
}

export default {
  id: 'similarity',
  tier: 'P2',
  weight: 1,
  effect: '동일 그룹·종류 요소의 시각 일관성으로 게슈탈트 유사성(Similarity) 군집화 강화 → 지각적 단위화, visual search 효율↑.',
  observe(alt) { const ns = (alt.nodes||[]).filter(n=>n.bbox && n.category && n.kind); return { bucketCount: new Set(ns.map(n=>n.category+"|"+n.kind)).size }; },
  measure(alt) {
    const nodes = (alt.nodes || []).filter((n) => n.bbox && n.category && n.kind);
    const buckets = new Map();
    for (const n of nodes) {
      const k = `${n.category}|${n.kind}`;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(n);
    }

    const metrics = { inconsistentGroups: 0, meanConsistency: 1, groupsMeasured: 0 };
    const violations = [];
    let sum = 0; let cnt = 0;

    for (const [key, group] of buckets) {
      if (group.length < 2) continue; // 단일 요소 그룹은 비교 무의미
      const spreads = [];

      const fs = group.map((n) => n.style?.fontSize).filter((v) => Number.isFinite(v));
      if (fs.length === group.length) spreads.push(normSpread(fs));

      const lum = group.map((n) => n.style?.luminance ?? 0.5).filter((v) => Number.isFinite(v));
      if (lum.length === group.length) spreads.push(normSpread(lum));

      const hsls = group.map((n) => (n.style?.bg ? hexToHsl(n.style.bg) : null))
        .filter((h) => h && h.s >= SAT_THRESHOLD);
      if (hsls.length === group.length) spreads.push(circSpread(hsls.map((h) => h.h)));

      const logA = group.map((n) => Math.log(Math.max(1, actualArea(n))));
      spreads.push(normSpread(logA));

      const worst = Math.min(1, Math.max(...spreads));
      const consistency = 1 - worst;
      sum += consistency; cnt++; metrics.groupsMeasured++;

      if (consistency < 0.6) {
        metrics.inconsistentGroups++;
        violations.push({
          severity: 'low',
          nodes: group.map((n) => n.id),
          metric: 'inconsistentGroups',
          measured: Number(consistency.toFixed(3)),
          threshold: 0.6,
          message: `similarity: group "${key}" visually inconsistent (consistency ${consistency.toFixed(2)} < 0.60) — unify size/lightness/color among same-group elements`,
          fix: { kind: 'unify-group', category: n_category(key) },
        });
      }
    }

    metrics.meanConsistency = cnt ? Number((sum / cnt).toFixed(3)) : 1;
    const score = cnt ? metrics.meanConsistency : 1;
    // no comparable same-group pairs (no categories, or every group is a singleton) → can't judge
    const coverage = cnt > 0 ? 'measured' : 'unmeasurable';
    return { score: Number(score.toFixed(3)), coverage, metrics, violations };
  },
};

function n_category(key) { return key.split('|')[0]; }
