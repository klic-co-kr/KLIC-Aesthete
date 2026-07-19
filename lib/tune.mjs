#!/usr/bin/env node
// Self-evolution tuner (제안서 §검증 가능한 보상과 인간 선호 데이터 피드백 루프).
// 사용자가 에이전트 결과물을 편집한 "뒤(after)"를 "전(before)"과 비교해 차분(Diff) 분석하고,
// 인지 스킬의 수치 파라미터(근접성 α / FRAG_FACTOR 등)를 자율 튜닝한다 — 코드 수정 없이
// skill-params.json 으로 역전파. 결정론적(동일 입력 → 동일 튜닝).

import { dist } from './geometry.mjs';
import { loadParams, writeParams } from './skill-params.mjs';
import { readJson, writeJson, parseArgs, isMain } from './shared/cli.mjs';

// Governance: a single before/after pair is not enough evidence to mutate global cognition
// constants (one user edit → every future measurement shifts). Require a minimum sample, and
// write to a profile-isolated file by default. --force overrides the gate (documented escape).
const MIN_PAIRS = 3;

function nodeIndex(alt) {
  return new Map((alt.nodes || []).filter((n) => n.bbox).map((n) => [n.id, n]));
}

// 같은 category 쌍(관련 요소)의 중심거리 비율(after/before)을 수집. 사용자가 간격을 어떻게
// 조정했는지가 근접성 파라미터 튜닝의 증거가 된다.
export function analyzeDiff(before, after) {
  const bi = nodeIndex(before);
  const ai = nodeIndex(after);
  const ratios = [];
  const ids = [...bi.keys()];
  for (let p = 0; p < ids.length; p++) {
    for (let q = p + 1; q < ids.length; q++) {
      const bn1 = bi.get(ids[p]); const bn2 = bi.get(ids[q]);
      if (!bn1.category || bn1.category !== bn2.category) continue; // 관련(동일 그룹) 쌍만
      const an1 = ai.get(ids[p]); const an2 = ai.get(ids[q]);
      if (!an1 || !an2) continue;
      const db = dist(bn1.bbox, bn2.bbox);
      const da = dist(an1.bbox, an2.bbox);
      if (db > 1e-6) ratios.push(da / db);
    }
  }
  if (!ratios.length) return { analyzedPairs: 0, medianRatio: null, tightened: null };
  ratios.sort((a, b) => a - b);
  const median = ratios[Math.floor(ratios.length / 2)];
  return { analyzedPairs: ratios.length, medianRatio: Number(median.toFixed(4)), tightened: median < 1 };
}

// diff → 파라미터 튜닝. 사용자가 관련 요소를 더 조였으면(r<1) 군집을 더 타이트하게,
// 더 벌렸으면(r>1) 더 느슨하게. FRAG_FACTOR 를 r 에 비례해 스케일(0.5~2배 클램프).
export function tune(before, after, opts = {}) {
  const analysis = analyzeDiff(before, after);
  // CLONE the cached params before mutating — loadParams() returns a shared cached
  // reference, so an in-place edit would pollute every later measurement in this process
  // even when the apply is BLOCKED or dry-run. Read the profile baseline (inherits global
  // when the profile file is absent) so the "before" matches what we are about to write.
  const params = structuredClone(loadParams(opts.profile));
  const result = {
    analysis,
    before: JSON.parse(JSON.stringify(params)),
    changes: {},
    recommendation: '',
    applied: false,
  };

  if (analysis.medianRatio == null || !Number.isFinite(analysis.medianRatio)) {
    result.recommendation = '관련 쌍의 간격 변화를 감지하지 못함 — 파라미터 유지';
    return result;
  }

  const r = Math.max(0.5, Math.min(2, analysis.medianRatio));
  const p = params.proximity;
  const oldFrag = p.FRAG_FACTOR;
  const oldRang = p.RANG_RATIO;
  const oldAlpha = p.ALPHA;
  // 타이트하게(r<1): 더 작은 거리에서 군집·단편화 판정 → FRAG_FACTOR·RANG_RATIO 축소
  p.FRAG_FACTOR = Number((oldFrag * r).toFixed(3));
  p.RANG_RATIO = Number(Math.max(1.0, oldRang * (0.7 + 0.3 * r)).toFixed(3));
  // α는 P_group 감쇠 계수(보고용 meanGroupP 신뢰도에만 영향; 군집 '결정'은 RANG이 주도).
  // 사용자가 간격을 좁혔으면(r<1) 감쇠를 완화(α↓)해 근접 신호를 더 관대히 반영.
  p.ALPHA = Number(Math.max(0.5, Math.min(4, oldAlpha * r)).toFixed(3));
  result.changes = {
    FRAG_FACTOR: { from: oldFrag, to: p.FRAG_FACTOR },
    RANG_RATIO: { from: oldRang, to: p.RANG_RATIO },
    ALPHA: { from: oldAlpha, to: p.ALPHA, informational: true, decisionImpact: false },
  };
  const pct = Math.round(Math.abs(1 - r) * 100);
  result.recommendation = r < 1
    ? `사용자가 관련 요소 간격을 ${pct}% 줄임 → 군집 타이트화 (FRAG_FACTOR ${oldFrag}→${p.FRAG_FACTOR}, RANG_RATIO ${oldRang}→${p.RANG_RATIO}, α ${oldAlpha}→${p.ALPHA}·신뢰도-only, 결정은 RANG 주도)`
    : `사용자가 관련 요소 간격을 ${pct}% 벌림 → 군집 이완 (FRAG_FACTOR ${oldFrag}→${p.FRAG_FACTOR}, RANG_RATIO ${oldRang}→${p.RANG_RATIO}, α ${oldAlpha}→${p.ALPHA}·신뢰도-only, 결정은 RANG 주도)`;

  if (opts.apply) {
    // minimum-sample gate: refuse to mutate params from too-thin evidence unless --force.
    if (!opts.force && analysis.analyzedPairs < MIN_PAIRS) {
      result.applied = false;
      result.blocked = true;
      result.blockedReason = `최소 표본 미달(${analysis.analyzedPairs}/${MIN_PAIRS}쌍). 더 많은 before/after 사례를 모으거나 --force로 우회(권장 안 함).`;
      return result;
    }
    // global write requires explicit opt-in (--global). By default --apply targets a
    // profile only, so a single layout's evidence can NEVER silently mutate the global
    // cognition constants every measurement reads.
    if (!opts.profile && !opts.global) {
      result.applied = false;
      result.blocked = true;
      result.blockedReason = '글로벌 skill-params.json 쓰기는 --global으로 명시해야 함(단일 편집 → 전역 변동 방지). 기본은 --profile <name> 격리.';
      return result;
    }
    writeParams(params, { profile: opts.profile, backup: true });
    result.applied = true;
    result.writtenTo = opts.profile ? `skill-params.${opts.profile}.json` : 'skill-params.json';
    result.backupNote = '이전 값은 *.backup-NNN에 스냅샷됨(롤백).';
  }
  return result;
}

// CLI: node tune.mjs <before.layout.json> <after.layout.json> [--apply] [--out tune.json]
async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  if (positional.length < 2) {
    console.error('usage: node lib/tune.mjs <before.layout.json> <after.layout.json> [--apply] [--force] [--profile <name> | --global] [--out tune.json]');
    process.exit(2);
  }
  const before = readJson(positional[0]);
  const after = readJson(positional[1]);
  const profile = typeof flags.profile === 'string' ? flags.profile : undefined;
  const result = tune(before, after, {
    apply: Boolean(flags.apply),
    force: Boolean(flags.force),
    global: Boolean(flags.global),
    profile,
  });
  const outPath = flags.out || 'tune.json';
  writeJson(outPath, result);
  if (result.blocked) {
    console.log(`BLOCKED | pairs ${result.analysis.analyzedPairs}/${MIN_PAIRS} | ${result.blockedReason}`);
  } else {
    console.log(`${result.applied ? 'APPLIED' : 'DRY-RUN'} | pairs ${result.analysis.analyzedPairs} | medianRatio ${result.analysis.medianRatio} | ${result.recommendation}`);
  }
  console.log(outPath);
}

if (isMain(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
