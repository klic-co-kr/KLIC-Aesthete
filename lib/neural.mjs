// Neuro-Symbolic 결합 seam (DESIGN.md §9).
// aesthete(기호/결정론 기하) + 외부 신경 점수(MLLM/CLIP IAA)를 가중 Sprint Contract로 결합.
//
// 핵심 원칙: aesthete 코어는 절대 모델을 호출하지 않는다. 신경 점수는 '외부'(Claude/CLIP 등)에서
// JSON으로 계산돼 들어온다. 본 모듈은 그 값을 report.skills에 병합만 해 준다 — 그러면
// contract.evaluate 가 기하 점수와 동일한 방식으로 가중 합산/판정한다.
//
// 규약: 신경 축의 skill id는 '_' 접두어로 표시(예: '_neural.clip') → 기하 스킬과 구분.
// 외부 평가자가 낸 JSON 형식:
//   { "_neural.clip": { "score": 0.82, "metrics": { "aesthetic": 0.82 } } }
// contract criterion: { "skill": "_neural.clip", "metric": "aesthetic", "op": ">=", "threshold": 0.7, "weight": 0.5 }

import fs from 'node:fs';

// report(기하 측정 결과)에 신경 점수를 병합. 코어 불변 — 새 report 반환.
export function mergeNeural(report, neuralScores) {
  const merged = JSON.parse(JSON.stringify(report));
  merged.skills = merged.skills || {};
  for (const [id, entry] of Object.entries(neuralScores || {})) {
    if (!entry || typeof entry !== 'object') continue;
    const skill = {
      score: Number.isFinite(entry.score) ? Number(entry.score) : 0,
      coverage: 'measured', // the external evaluator produced a value — this axis WAS measured
      metrics: entry.metrics && typeof entry.metrics === 'object' ? entry.metrics : {},
      violations: Array.isArray(entry.violations) ? entry.violations : [],
    };
    if (entry.effect) skill.effect = entry.effect;
    merged.skills[id] = skill;
  }
  return merged;
}

// 파일에서 신경 점수 JSON 로드 (외부 평가자가 기록).
export function loadNeural(filePath) {
  if (!filePath) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.warn(`neural: '${filePath}' 읽기 실패 — 신경 축 무시 (${err.message})`);
    return null;
  }
}

// 한 보고서에서 신경 축만 추출(검사/디버그용).
export function neuralAxes(report) {
  const out = {};
  for (const [id, sk] of Object.entries(report?.skills || {})) {
    if (id.startsWith('_')) out[id] = sk;
  }
  return out;
}

// Neural reward gate (fix.mjs --neural 용).
// 신경 점수는 기하 패치로 직접 고칠 수 없다(외부 모델의 판정). 그러므로 신경 축이
// contract에서 미충족이면 → "재생성 권고(regenerate)" 신호. 기하 fix는 구조 무결을 담당하고,
// 신경은 "이 버전이 주관적으로 충족하는가"를 가늠하는 보상/정지 신호.
import { evaluate } from './contract.mjs';
export function neuralFeedback(report, contract) {
  const ev = evaluate(report, contract);
  const neuralCriteria = ev.criteria.filter((c) => c.skill.startsWith('_'));
  const failing = neuralCriteria.filter((c) => !c.passed).map((c) => c.criterion).sort();
  return {
    present: neuralCriteria.length > 0,
    failing,
    regenerate: failing.length > 0, // 신경 미충족 = 기하로 못 고침 → 재생성
  };
}

// Apply the neural gate to a fixAlt() result (in place) and return it.
// outcome stays within the documented enum (pass | best-effort | no-improvement | budget-exhausted):
// neural failure maps to plain 'best-effort' and records the reason in stoppedReason — never an
// out-of-enum value like 'best-effort(neural)'.
export function applyNeuralGate(result, contract) {
  const fb = neuralFeedback(result.report, contract);
  result.neuralFeedback = fb;
  if (fb.regenerate) {
    result.outcome = 'best-effort';
    result.stoppedReason = `neural-criteria-failed: ${fb.failing.join(', ')}`;
  }
  return result;
}
