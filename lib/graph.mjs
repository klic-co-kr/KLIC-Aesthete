// Skill Relationship Graph (제안서 §위상수학적 스킬 관계 그래프 및 대립 제어).
// 세 가지 관계 엣지를 선언적 데이터로 정의한다:
//   - priority : tier 위계 (collision/boundary > hierarchy > balance/proximity/whitespace/harmony)
//   - conflict : 서로 대립하는 스킬 쌍 — 동적 보상 가중치(compensationFactor)로 타협
//   - influence: 한 스킬이 다른 스킬 달성에 기여 (hierarchy → proximity 상향 전이)
// 그래프는 노드·엣지 데이터로 export 돼 시각화/확장 가능 (새 스킬 = 노드+엣지 추가, 코어 수정 불필요).

import { SKILLS } from './skills/index.mjs';

const byId = Object.fromEntries(SKILLS.map((s) => [s.id, s]));
export const TIER_RANK = { P0: 0, P1: 1, P2: 2 };

export function tierOf(id) { return byId[id]?.tier ?? 'P2'; }
export function weightOf(id) { return byId[id]?.weight ?? 1; }

function edgeKey(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }

// ---- declarative edges ----
export const CONFLICT_EDGES = [
  { a: 'proximity', b: 'whitespace', note: '군집화(pull-together) vs 여백 확보(needs-space)' },
  { a: 'balance', b: 'proximity', note: '중앙 정렬 vs 군집 중심으로 이동' },
];
export const INFLUENCE_EDGES = [
  { from: 'hierarchy', to: 'proximity', weight: 0.3, note: '강조된 계층이 군집 지각을 간접 지원(상향 전이)' },
];
const CONFLICTS = new Set(CONFLICT_EDGES.map((e) => edgeKey(e.a, e.b)));
export function conflicts(a, b) { return CONFLICTS.has(edgeKey(a, b)); }
export function influenceWeight(from, to) {
  const e = INFLUENCE_EDGES.find((x) => x.from === from && x.to === to);
  return e ? e.weight : 0;
}

// introspectable graph (nodes + typed edges) — for visualization / tooling
export const GRAPH = {
  nodes: SKILLS.map((s) => ({ id: s.id, tier: s.tier, weight: s.weight, effect: s.effect })),
  edges: [
    ...CONFLICT_EDGES.map((e) => ({ type: 'conflict', ...e })),
    ...INFLUENCE_EDGES.map((e) => ({ type: 'influence', ...e })),
    // priority encoded by tier on nodes (not pairwise edges)
  ],
};

const SEV_RANK = { high: 3, medium: 2, low: 1 };
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// urgency: tier weight × severity × overshoot × (influence boost from upstream skills).
export function urgency(v, ctx = {}) {
  const sev = SEV_RANK[v.severity] ?? 2;
  let overshoot = 1;
  if (Number.isFinite(v.measured) && Number.isFinite(v.threshold) && v.threshold !== 0) {
    overshoot = 1 + Math.abs(v.measured - v.threshold) / Math.abs(v.threshold);
  }
  let boost = 1;
  for (const e of INFLUENCE_EDGES) {
    if (e.to === v.skill && ctx.passingSkills?.has(e.from)) boost += e.weight;
  }
  return weightOf(v.skill) * sev * overshoot * boost;
}

// 동적 충돌 보상 가중치 (제안서: "캔버스 면적 비율에 맞추어 보상 가중치를 동적으로 감쇠").
// proximity↔whitespace: freeRatio 가 매우 낙으면(비좁으면) de-cramp 가 승 → proximity 군집화(pull) 감쇠.
// 연속 선형 램프 — hard threshold 대신. 반환 0..1 (해당 스킬 패치의 유효 가중치).
export function compensationFactor(skill, ctx = {}) {
  const f = ctx.freeRatio ?? 1;
  if (skill === 'proximity') {
    // freeRatio ≤ 0.15 → proximity pull 완전 억제(0), ≥ 0.35 → 자유(1)
    return clamp01((f - 0.15) / 0.20);
  }
  return 1;
}

// deterministic ordering: tier asc, then urgency desc, then stable node-id tiebreak.
// (No Math.random anywhere — fully reproducible.)
export function orderViolations(viols, ctx = {}) {
  return [...viols].sort((x, y) => {
    const tr = TIER_RANK[tierOf(x.skill)] - TIER_RANK[tierOf(y.skill)];
    if (tr) return tr;
    const u = urgency(y, ctx) - urgency(x, ctx);
    if (Math.abs(u) > 1e-9) return u;
    const ax = (x.nodes || []).join(',');
    const ay = (y.nodes || []).join(',');
    if (ax !== ay) return ax < ay ? -1 : 1;
    return 0;
  });
}
