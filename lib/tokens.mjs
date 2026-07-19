// Design Token Sandbox (제안서 §오프셋 방지 토큰 샌드박싱).
// 에이전트는 사전 승인된 토큰(색/폰트/라디오)만 써야 한다. lint()는 ALT를 정적 분석해
// 임의의 핵사코드·승인 외 폰트사이즈·오프셋를 "탈출구(Escape Hatch)"로 간주해 위반 목록을 뽑는다.
// CI 게이트: lib/lint.mjs 가 위반 있으면 exit 1.

import fs from 'node:fs';
import path from 'node:path';
import { skillRoot } from './shared/cli.mjs';

export const DEFAULT_TOKENS = {
  // 합의된 팔레트 — 이 외 핵사코드는 거부
  colors: ['#FFFFFF', '#ffffff', '#000000', '#111827', '#374151',
    '#1A73E8', '#4A9BEF', '#F47974', '#FFCE5C', '#5BCFB9', '#3DB39E', '#F3F4F6'],
  fontScale: [12, 14, 16, 20, 24, 32, 40, 48],
  radii: [0, 2, 4, 8, 12, 16],
};

let cached = null;
const tokensPath = () => path.join(skillRoot(), 'tokens.json');

export function loadTokens() {
  if (cached) return cached;
  try {
    if (fs.existsSync(tokensPath())) {
      const onDisk = JSON.parse(fs.readFileSync(tokensPath(), 'utf8'));
      cached = {
        colors: onDisk.colors || DEFAULT_TOKENS.colors,
        fontScale: onDisk.fontScale || DEFAULT_TOKENS.fontScale,
        radii: onDisk.radii || DEFAULT_TOKENS.radii,
      };
    } else {
      cached = DEFAULT_TOKENS;
    }
  } catch {
    cached = DEFAULT_TOKENS;
  }
  return cached;
}

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
// normalize for palette comparison: expand #abc→#aabbcc, drop 8-digit alpha, lowercase
export const normHex = (h) => {
  let s = String(h).toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(s)) s = '#' + s.slice(1).split('').map((ch) => ch + ch).join('');
  if (/^#[0-9a-f]{8}$/.test(s)) return s.slice(0, 7);
  return s;
};

function near(value, scale, tol) {
  return scale.some((s) => Math.abs(value - s) <= tol);
}

// lint an ALT against the token sandbox. Returns { passed, violations, counts }.
// opts.tokens(선택)가 주어지면 디자인 스펙 파생 토큰로 평가(프로젝트 @design이 "정답").
export function lint(alt, opts = {}) {
  const tokens = opts.tokens || loadTokens();
  const tol = opts.tol ?? 0.5;
  const allowedColors = new Set(tokens.colors.map(normHex));
  const violations = [];
  const counts = { color: 0, fontSize: 0, radius: 0 };

  for (const n of (alt.nodes || [])) {
    for (const key of ['bg', 'color']) {
      const v = n.style?.[key];
      if (!v) continue;
      if (v === 'none' || v === 'transparent') continue;
      if (!HEX.test(v)) {
        violations.push({ node: n.id, kind: 'color', value: v, message: `tokens: /nodes/${n.id} style.${key}="${v}" is not a hex color — use an approved token` });
        counts.color++;
      } else if (!allowedColors.has(normHex(v))) {
        violations.push({ node: n.id, kind: 'color', value: v, message: `tokens: /nodes/${n.id} style.${key}="${v}" is an arbitrary hex not in the approved palette — use a design token` });
        counts.color++;
      }
    }
    const fs2 = n.style?.fontSize;
    if (Number.isFinite(fs2) && fs2 > 0 && !near(fs2, tokens.fontScale, tol)) {
      violations.push({ node: n.id, kind: 'fontSize', value: fs2, message: `tokens: /nodes/${n.id} fontSize=${fs2} is off the approved type scale ${tokens.fontScale.join('/')} — snap to a token` });
      counts.fontSize++;
    }
  }

  return { passed: violations.length === 0, violations, counts };
}
