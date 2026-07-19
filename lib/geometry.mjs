// Pure bbox geometry + actual-shape area. Every division is guarded — NaN can never escape.

export function isFiniteBox(b) {
  return b != null
    && Number.isFinite(b.x) && Number.isFinite(b.y)
    && Number.isFinite(b.w) && Number.isFinite(b.h);
}

export function center(b) {
  return [b.x + b.w / 2, b.y + b.h / 2];
}

// Actual filled area (정밀 관찰). bbox w×h가 아니라 실제 형상의 면적:
//  - ellipse/circle/icon: π × r₁ × r₂ (bbox 대비 ~21% 적음 — 속 빈 영역 제거)
//  - image/rect/box: w × h (직사각형 — image는 항상 직사각형)
//  - 기본: bbox 면적 (안전 폴백)
export function actualArea(node) {
  const b = node?.bbox;
  if (!b || !isFiniteBox(b)) return 0;
  const kind = node?.kind;
  const shape = node?.shape;
  if (shape === 'ellipse' || kind === 'icon') {
    const rx = b.w / 2;
    const ry = b.h / 2;
    return Math.PI * rx * ry;
  }
  return b.w * b.h;
}

// Actual shape complexity (정밀 관찰). bbox 사각형(항상 4.0) 대신 실제 형상:
//  - ellipse/circle/icon: 2π·r / √(π·r²) ≈ 3.54 (원의 복잡도 — 사각형 4.0보다 단순)
//  - rect/box: perimeter/√area = 4.0 (기존)
export function actualShapeComplexity(node) {
  const b = node?.bbox;
  if (!b || !isFiniteBox(b)) return 1;
  const kind = node?.kind;
  const shape = node?.shape;
  if (shape === 'ellipse' || kind === 'icon') {
    const rx = b.w / 2;
    const ry = b.h / 2;
    const a = Math.PI * rx * ry;
    if (a <= 0) return 1;
    const perim = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
    const c = perim / Math.sqrt(a);
    return Number.isFinite(c) ? Math.min(8, c) : 1;
  }
  return shapeComplexity(b);
}

export function area(b) {
  return Math.max(0, b.w) * Math.max(0, b.h);
}

export function perimeter(b) {
  return 2 * (Math.max(0, b.w) + Math.max(0, b.h));
}

// Shape complexity for Ngo balance. square ≈ 4.0; slivers grow large → clamped to 8.
// Guard: non-positive area → neutral constant 1.
export function shapeComplexity(b) {
  const a = area(b);
  if (a <= 0) return 1;
  const c = perimeter(b) / Math.sqrt(a);
  if (!Number.isFinite(c)) return 1;
  return Math.min(8, c);
}

export function dist(a, b) {
  const [ax, ay] = center(a);
  const [bx, by] = center(b);
  const dx = ax - bx, dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

// axis-aligned overlap test. positive gap = require that much separation.
export function rectsOverlap(a, b, gap = 0) {
  const g = Number.isFinite(gap) ? Math.max(0, gap) : 0;
  return (a.x - g) < (b.x + b.w) && (a.x + a.w + g) > b.x
      && (a.y - g) < (b.y + b.h) && (a.y + a.h + g) > b.y;
}

export function overlapArea(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ix * iy;
}

// per-axis overlap depth (0 on an axis = touching/disjoint there)
export function overlapDepth(a, b) {
  const x = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const y = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return { x: Math.max(0, x), y: Math.max(0, y) };
}

export function overflow(b, canvas) {
  const left = Math.max(0, -b.x);
  const right = Math.max(0, b.x + b.w - canvas.w);
  const top = Math.max(0, -b.y);
  const bottom = Math.max(0, b.y + b.h - canvas.h);
  return { left, right, top, bottom, total: left + right + top + bottom };
}

export function clampToCanvas(b, canvas) {
  const w = Math.min(b.w, canvas.w);
  const h = Math.min(b.h, canvas.h);
  return {
    x: Math.max(0, Math.min(b.x, canvas.w - w)),
    y: Math.max(0, Math.min(b.y, canvas.h - h)),
    w, h,
  };
}

export function translate(b, dx, dy) {
  return { x: b.x + dx, y: b.y + dy, w: b.w, h: b.h };
}

export function scaleAround(b, px, py, s) {
  const k = Number.isFinite(s) && s > 0 ? s : 1;
  return {
    x: px + (b.x - px) * k,
    y: py + (b.y - py) * k,
    w: b.w * k,
    h: b.h * k,
  };
}
