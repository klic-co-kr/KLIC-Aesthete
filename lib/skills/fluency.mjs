// Fluency skill (Processing Fluency — Reber, Schwarz & Winkielman, 2004).
// 처리 유창성 기하 근사: (a) reading flow — 의미 역할이 주사 순서(상→하, 좌→우)를 따르는가,
// (b) size–prominence gradient — 큰 폰트가 더 중요 역할(heading)에 배치되는가.
// 둘 다 기하만으로 측정 가능. local density(quadtree)는 whitespace 스킬과 중복하므로 여기선 제외.
//
// 설계 원칙: fluency는 "최대화"가 아니다 — over-fluency(단조)는 지루함(Birkhoff O/C 균형).
// 따라서 본 스킬은 "충분한 계층 + 읽기 흐름 정렬"을 점수화하지, 단순함 자체를 올리지 않는다.

const ROLE_RANK = { heading: 0, control: 1, body: 1, caption: 2, decor: 3 };
const roleProminence = (r) => {
  const k = ROLE_RANK[r] ?? 3;
  const max = 3;
  return (max - k) / max; // heading=1, body/control=0.667, caption=0.333, decor=0
};

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0; let dx = 0; let dy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i] - mx; const b = ys[i] - my; num += a * b; dx += a * a; dy += b * b; }
  const den = Math.sqrt(dx * dy);
  return den > 1e-9 ? num / den : null;
}

export default {
  id: 'fluency',
  tier: 'P2',
  weight: 1,
  effect: '읽기 흐름(Z/F-pattern) 정렬 + 크기-중요도 기울기로 처리 유창성(Reber et al., 2004)↑ → 이해·회상·미학적 쾌감 증가. 과도한 단조는 지루함(Birkhoff O/C 균형).',
  observe(alt) { const ns = (alt.nodes||[]).filter(n=>n.bbox && n.style?.role && n.style.role!=="decor"); return { textNodes: ns.length, roles: [...new Set(ns.map(n=>n.style.role))] }; },
  measure(alt) {
    // reading flow는 '읽는' 요소(heading/body/caption/control)에만 적용.
    // decor(컨테이너·아이콘)은 주사 대상이 아니므로 제외 — 박스 위에 라벨이 있는 카드 구조를 역전으로 오판하지 않는다.
    const nodes = (alt.nodes || []).filter((n) => n.bbox && n.style?.role && n.style.role !== 'decor');
    const metrics = { flowInversions: 0, flowScore: 1, gradientScore: 1, fluency: 1 };
    const violations = [];

    // --- (a) reading flow: 주사 순서 상에서 role 역순 전환(inversion) 없는가 ---
    const byRole = nodes.slice().sort((a, b) => {
      const ay = a.bbox.y + a.bbox.h / 2; const by = b.bbox.y + b.bbox.h / 2;
      if (Math.abs(ay - by) > 1) return ay - by; // 위→아래
      return (a.bbox.x + a.bbox.w / 2) - (b.bbox.x + b.bbox.w / 2); // 좌→우
    });
    let inversions = 0;
    let pairs = 0;
    for (let i = 0; i < byRole.length; i++) {
      for (let j = i + 1; j < byRole.length; j++) {
        pairs++;
        const ri = ROLE_RANK[byRole[i].style.role] ?? 3;
        const rj = ROLE_RANK[byRole[j].style.role] ?? 3;
        if (ri > rj) inversions++; // 덜 중요 역할이 더 먼저(위/좌) = 역전
      }
    }
    const flowScore = pairs > 0 ? 1 - inversions / pairs : 1;
    metrics.flowInversions = inversions;
    metrics.flowScore = Number(flowScore.toFixed(3));

    // --- (b) size–prominence gradient: 큰 폰트가 중요 역할과 양의 상관인가 ---
    const sized = byRole.filter((n) => Number.isFinite(n.style?.fontSize) && n.style.fontSize > 0);
    let gradientScore = 1;
    if (sized.length >= 2) {
      const corr = pearson(
        sized.map((n) => n.style.fontSize),
        sized.map((n) => roleProminence(n.style.role)),
      );
      gradientScore = corr == null ? 1 : Math.max(0, corr); // 음의 상관(역기울기) → 0
    }
    metrics.gradientScore = Number(gradientScore.toFixed(3));

    const fluency = Number((0.5 * flowScore + 0.5 * gradientScore).toFixed(3));
    metrics.fluency = fluency;

    if (inversions > 0) {
      violations.push({
        severity: 'medium',
        metric: 'flowInversions',
        measured: inversions,
        threshold: 0,
        message: `fluency: ${inversions} reading-flow inversion(s) — less-prominent role precedes a more-prominent one in scan order; reorder top-down (heading→body) for processing fluency`,
        fix: { kind: 'reorder-reading-flow' },
      });
    }
    if (sized.length >= 2 && gradientScore < 0.2) {
      violations.push({
        severity: 'low',
        metric: 'gradientScore',
        measured: Number(gradientScore.toFixed(3)),
        threshold: 0.2,
        message: `fluency: size–prominence gradient weak/inverted (corr ${gradientScore.toFixed(2)}) — align larger type with more important roles`,
        fix: { kind: 'strengthen-hierarchy-gradient' },
      });
    }

    // unmeasurable when there are <2 role-bearing nodes — no reading flow or gradient to judge,
    // so flowScore/gradientScore are both default 1 and fluency would be a vacuous 1.
    const coverage = nodes.length < 2 ? 'unmeasurable' : 'measured';
    return { score: fluency, coverage, metrics, violations };
  },
};
