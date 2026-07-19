import { test, expect } from 'bun:test';
import { normalizeSpec, parseDesignSpec, buildDesignTokens } from '../lib/designspec.mjs';
import { harness } from '../lib/harness.mjs';
import { writeFileSync, readFileSync } from 'node:fs';

test('parseDesignSpec: HTML @design 블록에서 스펙 추출', () => {
  const html = `<!-- @design { "palette":["#1A73E8","#111827"], "fontScale":[16,24],
    "tokens":{"color":{"primary":"#1A73E8","text":"#111827"},"fontSize":{"heading":24,"body":16}} } -->
<!doctype html><html><body data-w="800" data-h="600">
<div data-x="10" data-y="10" data-w="100" data-h="50" data-category="a">A</div></body></html>`;
  const spec = parseDesignSpec(html);
  expect(spec).not.toBeNull();
  expect(spec.palette).toContain('#1a73e8');
  expect(spec.palette).toContain('#111827'); // token 흡수
  expect(spec.fontScale).toContain(24); // token 흡수
});

test('normalizeSpec: 빈/잘못된 입력에도 깨지지 않음', () => {
  const s = normalizeSpec(null);
  expect(s.palette).toEqual([]);
  expect(s.fontScale).toEqual([]);
});

test('buildDesignTokens: spec → lint 호환 토큰 세트', () => {
  const spec = normalizeSpec({ palette: ['#1A73E8'], fontScale: [16], tokens: { color: { text: '#111827' } } });
  const t = buildDesignTokens(spec);
  expect(t.colors).toContain('#1a73e8');
  expect(t.colors).toContain('#111827');
  expect(t.fontScale).toContain(16);
});

test('harness: @design 없으면 designPresent=false (기본 토큰 검사 생략)', async () => {
  const alt = { schema_version: 1, diagram_type: 'layout',
    meta: { title: 't', canvas: { w: 100, h: 100 } },
    nodes: [{ id: 'a', category: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 } }] };
  const f = '/tmp/no-design.json';
  writeFileSync(f, JSON.stringify(alt));
  const r = await harness(f);
  expect(r.designPresent).toBe(false);
  expect(r.design).toBeNull();
  expect(r.cognitive).toBeDefined();
});

test('harness: @design 위반(허용 밖 색) → tokenLint REJECT', async () => {
  const html = `<!-- @design { "palette":["#1A73E8","#111827","#FFFFFF"], "fontScale":[16,24] } -->
<!doctype html><html><body data-w="800" data-h="600">
<div data-x="10" data-y="10" data-w="100" data-h="50" data-bg="#FF3B30" data-fontsize="24">A</div>
<div data-x="10" data-y="80" data-w="100" data-h="50" data-bg="#1A73E8" data-fontsize="17">B</div>
</body></html>`;
  const f = '/tmp/with-design.html';
  writeFileSync(f, html);
  const r = await harness(f);
  expect(r.designPresent).toBe(true);
  expect(r.design.tokenPassed).toBe(false);
  // #FF3B30 (허용밖 색) + fontSize 17 (허용밖 폰트) 위반
  expect(r.design.violations.length).toBeGreaterThanOrEqual(2);
});
