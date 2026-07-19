// Design spec 파서 — 프론트메타에서 디자인 스펙을 읽는다.
// 소스 우선순위: (1) HTML/파일 내 `<!-- @design {...json...} -->` 블록, (2) sidecar design.json.
// 추출: palette(허용 색), fontScale(허용 폰트), tokens(시맨틱 토큰 맵), contract(선택).
// 이 스펙이 토큰 샌드박스의 "정답"이 된다 — 이 팔레트/스케일을 벗어나면 디자인 위반.

import fs from 'node:fs';
import path from 'node:path';

const HEX = /^#[0-9a-fA-F]{3,8}$/;
function normHex(h) {
  const s = String(h || '').toLowerCase().trim();
  if (!s) return null;
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + s.slice(1).split('').map((c) => c + c).join('');
  if (/^#[0-9a-f]{8}$/.test(s)) return s.slice(0, 7);
  return HEX.test(s) ? s : null;
}

// 디자인 스펙 정규화: palette/fontScale을 tokens까지 흡수해 하나의 허용집합으로.
export function normalizeSpec(raw) {
  const spec = raw && typeof raw === 'object' ? raw : {};
  const tokens = spec.tokens || {};
  const colorTokens = tokens.color || {};
  const fontTokens = tokens.fontSize || {};

  const paletteSet = new Set();
  for (const c of [...(spec.palette || []), ...Object.values(colorTokens)]) {
    const h = normHex(c);
    if (h) paletteSet.add(h);
  }
  const fontSet = new Set();
  for (const f of [...(spec.fontScale || []), ...Object.values(fontTokens)]) {
    if (Number.isFinite(f)) fontSet.add(f);
  }

  return {
    palette: [...paletteSet].sort(),
    fontScale: [...fontSet].sort((a, b) => a - b),
    tokens,
    contract: Array.isArray(spec.contract) ? spec.contract : null,
    raw: spec,
  };
}

// 본문/사이드카에서 디자인 스펙 추출. source=파일 텍스트, filePath=sidecar 탐색용.
export function parseDesignSpec(source, filePath) {
  // (1) 인라인 @design 주석 블록
  if (source) {
    const m = /<!--\s*@design\s*([\s\S]*?)-->/i.exec(source);
    if (m) {
      try { return normalizeSpec(JSON.parse(m[1].trim())); } catch { /* fall through */ }
    }
  }
  // (2) sidecar design.json
  if (filePath) {
    const dir = path.dirname(filePath);
    for (const name of ['design.json', 'design.yaml']) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) {
        try { return normalizeSpec(JSON.parse(fs.readFileSync(p, 'utf8'))); } catch { /* ignore */ }
      }
    }
  }
  return null;
}

// 디자인 스펙 → 토큰 샌드박스 형태(tokens.mjs lint 호환).
export function buildDesignTokens(spec) {
  if (!spec) return null;
  return {
    colors: spec.palette,
    fontScale: spec.fontScale,
    radii: spec.raw?.radii || [0, 2, 4, 8, 12, 16],
  };
}
