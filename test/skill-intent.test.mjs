import { expect, test } from 'bun:test';
import path from 'node:path';
import {
  buildIntentPacket,
  renderIntentPromptBullets,
} from '../lib/skill-intent.mjs';
import { captureSchemaBundle } from '../lib/skill-snapshot.mjs';
import { createRunValidator } from '../lib/shared/validator.mjs';

const repoRoot = path.resolve(import.meta.dir, '..');

const fullBrief = {
  artifact_type: 'dashboard',
  format: 'html',
  brief: '운영 지표를 빠르게 판단하는 대시보드',
  canvas: { w: 1440, h: 900 },
  scope: {
    included: ['운영 현황 화면', '이상 지표 탐색'],
    excluded: ['관리자 설정', '사용자 권한 편집'],
  },
  content_priority: ['이상 지표와 심각도', '원인 확인에 필요한 추세', '후속 조치'],
  audience: '일일 운영 담당자',
  audience_frequency: 'daily',
  desired_action: '이상 지표를 찾아 후속 조치한다',
  source_mode: 'continue_improve',
  must_preserve: ['승인된 수치', '브랜드 색상'],
  must_not_assume: ['누락된 수치', '사용자 승인'],
};

const spec = {
  artifact_type: 'dashboard',
};

test('intent: full brief produces the exact deterministic packet', () => {
  expect(buildIntentPacket(fullBrief, spec)).toEqual({
    schema: 'aesthete.intent/v1',
    schema_version: 1,
    goal: '운영 지표를 빠르게 판단하는 대시보드',
    scope: {
      included: ['운영 현황 화면', '이상 지표 탐색'],
      excluded: ['관리자 설정', '사용자 권한 편집'],
    },
    content_priority: ['이상 지표와 심각도', '원인 확인에 필요한 추세', '후속 조치'],
    artifact: {
      requested_type: 'dashboard',
      effective_type: 'dashboard',
      format: 'html',
      canvas: { w: 1440, h: 900 },
    },
    audience: {
      description: '일일 운영 담당자',
      frequency: 'daily',
    },
    desired_action: '이상 지표를 찾아 후속 조치한다',
    source: {
      mode: 'continue_improve',
      must_preserve: ['승인된 수치', '브랜드 색상'],
      must_not_assume: ['누락된 수치', '사용자 승인'],
    },
    claim_scope: {
      role: 'declared_generation_context_not_evaluation',
      does_not_establish: [
        'intent_correctness',
        'intent_fulfillment',
        'scope_coverage',
        'priority_fulfillment',
        'audience_comprehension',
        'human_approval',
      ],
    },
  });
});

test('intent: legacy brief uses only explicit unknown defaults', () => {
  const value = buildIntentPacket(
    { artifact_type: 'unrecognized-kind' },
    { artifact_type: 'generic' },
  );
  expect(value).toMatchObject({
    goal: null,
    scope: { included: [], excluded: [] },
    content_priority: [],
    artifact: {
      requested_type: 'unrecognized-kind',
      effective_type: 'generic',
      format: null,
      canvas: null,
    },
    audience: { description: null, frequency: null },
    desired_action: null,
    source: {
      mode: 'unspecified',
      must_preserve: [],
      must_not_assume: [],
    },
  });
});

test('intent: exact included/excluded collision is rejected', () => {
  expect(() => buildIntentPacket({
    artifact_type: 'dashboard',
    scope: { included: ['settings'], excluded: ['settings'] },
  }, spec)).toThrow('intent scope contradiction: settings');
});

test('intent: scope collision comparison is case-sensitive', () => {
  expect(buildIntentPacket({
    artifact_type: 'dashboard',
    scope: { included: ['Settings'], excluded: ['settings'] },
  }, spec).scope).toEqual({
    included: ['Settings'],
    excluded: ['settings'],
  });
});

test('intent: packet owns cloned declared arrays and canvas', () => {
  const brief = structuredClone(fullBrief);
  const packet = buildIntentPacket(brief, spec);
  brief.scope.included.push('later scope');
  brief.content_priority[0] = 'later priority';
  brief.must_preserve.push('later preservation');
  brief.must_not_assume.push('later assumption');
  brief.canvas.w = 1;
  expect(packet.scope.included).toEqual(['운영 현황 화면', '이상 지표 탐색']);
  expect(packet.content_priority[0]).toBe('이상 지표와 심각도');
  expect(packet.source.must_preserve).toEqual(['승인된 수치', '브랜드 색상']);
  expect(packet.source.must_not_assume).toEqual(['누락된 수치', '사용자 승인']);
  expect(packet.artifact.canvas).toEqual({ w: 1440, h: 900 });
});

test('intent: unknown requested type preserves declaration and generic resolution', () => {
  const packet = buildIntentPacket(
    { artifact_type: 'immersive-wall' },
    { artifact_type: 'generic' },
  );
  expect(packet.artifact).toMatchObject({
    requested_type: 'immersive-wall',
    effective_type: 'generic',
  });
});

test('intent: repeated identical input is byte-equivalent', () => {
  const first = JSON.stringify(buildIntentPacket(fullBrief, spec));
  const second = JSON.stringify(buildIntentPacket(fullBrief, spec));
  expect(second).toBe(first);
});

test('intent: prompt bullets keep fixed grouping and priority order', () => {
  expect(renderIntentPromptBullets(buildIntentPacket(fullBrief, spec))).toEqual([
    'Declared goal: 운영 지표를 빠르게 판단하는 대시보드',
    'Included scope: 운영 현황 화면',
    'Included scope: 이상 지표 탐색',
    'Excluded scope: 관리자 설정',
    'Excluded scope: 사용자 권한 편집',
    'Content priority 1: 이상 지표와 심각도',
    'Content priority 2: 원인 확인에 필요한 추세',
    'Content priority 3: 후속 조치',
    'Audience: 일일 운영 담당자',
    'Audience frequency: daily',
    'Desired audience action: 이상 지표를 찾아 후속 조치한다',
    'Source mode: continue_improve',
    'Preserve: 승인된 수치',
    'Preserve: 브랜드 색상',
    'Do not assume: 누락된 수치',
    'Do not assume: 사용자 승인',
  ]);
});

test('intent: emitted packet is schema-valid', async () => {
  const validator = await createRunValidator(captureSchemaBundle(repoRoot));
  expect(() => validator.validate(
    'intent',
    buildIntentPacket(fullBrief, spec),
  )).not.toThrow();
});

test.each([
  [{ ...fullBrief, audience: '   ' }, /audience/],
  [{ ...fullBrief, content_priority: ['same', 'same'] }, /content_priority.*duplicate/],
  [{
    ...fullBrief,
    scope: { included: ['ok'], excluded: [], extra: true },
  }, /additional/],
  [{ ...fullBrief, must_preserve: [42] }, /string/],
])('intent: brief schema rejects malformed declared context', async (brief, message) => {
  const validator = await createRunValidator(captureSchemaBundle(repoRoot));
  expect(() => validator.validate('brief', brief)).toThrow(message);
});
