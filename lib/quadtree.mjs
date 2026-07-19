// Occupancy-based quadtree over the canvas. No pixels, no browser — we test bbox
// occupancy directly. This is the deterministic analog of the proposal's pixel-based
// local-variance whitespace measure (documented in DESIGN.md).

import { rectsOverlap } from './geometry.mjs';

const MAX_DEPTH = 6;
const MIN_SIZE = 8;

function intersectsAny(node, boxes) {
  for (const b of boxes) {
    if (rectsOverlap(node, b, 0)) return true;
  }
  return false;
}

function subdivide(node, boxes, depth) {
  if (depth >= MAX_DEPTH || node.w < MIN_SIZE || node.h < MIN_SIZE) return;
  if (!intersectsAny(node, boxes)) return; // fully free leaf — stop subdividing
  const hw = node.w / 2;
  const hh = node.h / 2;
  node.children = [
    { x: node.x, y: node.y, w: hw, h: hh, children: null },
    { x: node.x + hw, y: node.y, w: hw, h: hh, children: null },
    { x: node.x, y: node.y + hh, w: hw, h: hh, children: null },
    { x: node.x + hw, y: node.y + hh, w: hw, h: hh, children: null },
  ];
  for (const c of node.children) subdivide(c, boxes, depth + 1);
}

export function buildQuadtree(canvas, boxes) {
  const root = { x: 0, y: 0, w: canvas.w, h: canvas.h, children: null };
  if (canvas.w <= 0 || canvas.h <= 0) return root;
  subdivide(root, boxes, 0);
  return root;
}

export function freeLeaves(root, boxes) {
  const out = [];
  const walk = (n) => {
    if (n.children) { for (const c of n.children) walk(c); return; }
    if (!intersectsAny(n, boxes)) out.push({ x: n.x, y: n.y, w: n.w, h: n.h });
  };
  walk(root);
  return out;
}

export function freeArea(root, boxes) {
  let a = 0;
  for (const lf of freeLeaves(root, boxes)) a += lf.w * lf.h;
  return a;
}

export function largestFreeRect(root, boxes) {
  let best = { x: 0, y: 0, w: 0, h: 0, area: 0 };
  for (const lf of freeLeaves(root, boxes)) {
    const ar = lf.w * lf.h;
    if (ar > best.area) best = { x: lf.x, y: lf.y, w: lf.w, h: lf.h, area: ar };
  }
  const aspect = (best.w > 0 && best.h > 0)
    ? Math.max(best.w, best.h) / Math.min(best.w, best.h)
    : 1;
  return { ...best, aspectRatio: aspect };
}

export function contentBounds(boxes) {
  if (!boxes.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function margins(boxes, canvas) {
  const cb = contentBounds(boxes);
  if (!cb) return { top: canvas.h, bottom: 0, left: canvas.w, right: 0 };
  return {
    top: Math.max(0, cb.y),
    bottom: Math.max(0, canvas.h - (cb.y + cb.h)),
    left: Math.max(0, cb.x),
    right: Math.max(0, canvas.w - (cb.x + cb.w)),
  };
}
