import { test, expect } from 'bun:test';
import { mergeNeural, neuralAxes, neuralFeedback, applyNeuralGate } from '../lib/neural.mjs';
import { evaluate } from '../lib/contract.mjs';

const geo = (skills) => ({
  schema_version: 1,
  summary: { overallScore: 1, totalWeightedViolation: 0, passing: [], failing: [] },
  skills,
});

test('mergeNeural: 외부 신경 점수를 report.skills에 병합 (코어 불변)', () => {
  const before = geo({ collision: { score: 1, metrics: { count: 0 }, violations: [] } });
  const merged = mergeNeural(before, { '_neural.clip': { score: 0.82, metrics: { aesthetic: 0.82 } } });
  // 원본은 변경되지 않음
  expect(Object.keys(before.skills)).toEqual(['collision']);
  // 병합본에 신경 축 추가
  expect(merged.skills['_neural.clip'].metrics.aesthetic).toBe(0.82);
  expect(merged.skills['_neural.clip'].score).toBe(0.82);
  expect(merged.skills['_neural.clip'].coverage).toBe('measured');
  // 기하 스킬은 그대로
  expect(merged.skills.collision.metrics.count).toBe(0);
});

test('contract.evaluate: 신경 축을 기하와 동일 방식으로 가중 판정', () => {
  const report = mergeNeural(geo({
    collision: { score: 1, metrics: { count: 0 }, violations: [] },
    boundary: { score: 1, metrics: { overflowCount: 0 }, violations: [] },
  }), { '_neural.mllm': { score: 0.6, metrics: { aesthetic: 0.6 } } });

  const contract = {
    schema_version: 1, brief: 'neuro-symbolic',
    criteria: [
      { skill: 'collision', metric: 'count', op: '==', threshold: 0, weight: 3 },
      { skill: 'boundary', metric: 'overflowCount', op: '==', threshold: 0, weight: 3 },
      { skill: '_neural.mllm', metric: 'aesthetic', op: '>=', threshold: 0.7, weight: 1 },
    ],
  };
  const e = evaluate(report, contract);
  // 신경 축이 0.6 < 0.7 → 해당 criterion 실패 → 전체 fail
  expect(e.verdict).toBe('fail');
  expect(e.criteria.find((c) => c.skill === '_neural.mllm').passed).toBe(false);
});

test('contract.evaluate: 신경 점수가 임계 통과하면 같이 pass', () => {
  const report = mergeNeural(geo({
    collision: { score: 1, metrics: { count: 0 }, violations: [] },
  }), { '_neural.mllm': { score: 0.9, metrics: { aesthetic: 0.9 } } });
  const contract = {
    schema_version: 1, brief: '',
    criteria: [
      { skill: 'collision', metric: 'count', op: '==', threshold: 0, weight: 1 },
      { skill: '_neural.mllm', metric: 'aesthetic', op: '>=', threshold: 0.7, weight: 1 },
    ],
  };
  expect(evaluate(report, contract).verdict).toBe('pass');
});

test('neuralAxes: "_" 접두어 축만 추출', () => {
  const r = mergeNeural(geo({ collision: { score: 1, metrics: { count: 0 }, violations: [] } }),
    { '_neural.a': { score: 0.5, metrics: {} }, '_neural.b': { score: 0.5, metrics: {} } });
  expect(Object.keys(neuralAxes(r)).sort()).toEqual(['_neural.a', '_neural.b']);
});

test('mergeNeural: 빈/잘못된 입력에도 깨지지 않음', () => {
  const r = mergeNeural(geo({}), null);
  expect(r.skills.collision).toBeUndefined();
  const r2 = mergeNeural(geo({}), { '_neural.x': null });
  expect(r2.skills['_neural.x']).toBeUndefined();
});

test('neuralFeedback: 신경 미충족 → regenerate=true (기하로 못 고침)', () => {
  const report = mergeNeural(geo({
    collision: { score: 1, metrics: { count: 0 }, violations: [] },
  }), { '_neural.mllm': { score: 0.4, metrics: { aesthetic: 0.4 } } });
  const contract = {
    schema_version: 1, brief: '',
    criteria: [
      { skill: 'collision', metric: 'count', op: '==', threshold: 0, weight: 1 },
      { skill: '_neural.mllm', metric: 'aesthetic', op: '>=', threshold: 0.7, weight: 1 },
    ],
  };
  const fb = neuralFeedback(report, contract);
  expect(fb.present).toBe(true);
  expect(fb.regenerate).toBe(true);
  expect(fb.failing).toContain('_neural.mllm.aesthetic>=0.7');
});

test('neuralFeedback: 신경 충족 → regenerate=false', () => {
  const report = mergeNeural(geo({
    collision: { score: 1, metrics: { count: 0 }, violations: [] },
  }), { '_neural.mllm': { score: 0.9, metrics: { aesthetic: 0.9 } } });
  const contract = {
    schema_version: 1, brief: '',
    criteria: [
      { skill: 'collision', metric: 'count', op: '==', threshold: 0, weight: 1 },
      { skill: '_neural.mllm', metric: 'aesthetic', op: '>=', threshold: 0.7, weight: 1 },
    ],
  };
  expect(neuralFeedback(report, contract).regenerate).toBe(false);
});

test('neuralFeedback: contract에 신경 축이 없으면 present=false', () => {
  const report = geo({ collision: { score: 1, metrics: { count: 0 }, violations: [] } });
  const contract = { schema_version: 1, brief: '', criteria: [
    { skill: 'collision', metric: 'count', op: '==', threshold: 0, weight: 1 },
  ] };
  expect(neuralFeedback(report, contract).present).toBe(false);
});

const OUTCOME_ENUM = ['pass', 'best-effort', 'no-improvement', 'budget-exhausted'];

test('applyNeuralGate: neural 미충족 → outcome은 enum 내 (best-effort), stoppedReason에 사유', () => {
  const report = mergeNeural(geo({ collision: { score: 1, metrics: { count: 0 }, violations: [] } }),
    { '_neural.mllm': { score: 0.4, metrics: { aesthetic: 0.4 } } });
  const contract = { schema_version: 1, brief: '', criteria: [
    { skill: 'collision', metric: 'count', op: '==', threshold: 0, weight: 1 },
    { skill: '_neural.mllm', metric: 'aesthetic', op: '>=', threshold: 0.7, weight: 1 },
  ] };
  const result = { outcome: 'pass', report, stoppedReason: 'pass at iter 0' };
  applyNeuralGate(result, contract);
  expect(OUTCOME_ENUM).toContain(result.outcome);        // never 'best-effort(neural)'
  expect(result.outcome).toBe('best-effort');
  expect(result.neuralFeedback.regenerate).toBe(true);
  expect(result.stoppedReason).toContain('neural-criteria-failed');
});

test('applyNeuralGate: neural 충족 → outcome 그대로 (덮어쓰지 않음)', () => {
  const report = mergeNeural(geo({ collision: { score: 1, metrics: { count: 0 }, violations: [] } }),
    { '_neural.mllm': { score: 0.9, metrics: { aesthetic: 0.9 } } });
  const contract = { schema_version: 1, brief: '', criteria: [
    { skill: 'collision', metric: 'count', op: '==', threshold: 0, weight: 1 },
    { skill: '_neural.mllm', metric: 'aesthetic', op: '>=', threshold: 0.7, weight: 1 },
  ] };
  const result = { outcome: 'pass', report, stoppedReason: 'pass at iter 0' };
  applyNeuralGate(result, contract);
  expect(result.outcome).toBe('pass');
  expect(OUTCOME_ENUM).toContain(result.outcome);
  expect(result.neuralFeedback.regenerate).toBe(false);
});
