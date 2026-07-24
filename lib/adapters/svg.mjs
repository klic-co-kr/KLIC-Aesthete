// SVG adapter: SVG markup ↔ ALT. Pure-JS, deterministic (sequential ids, no Math.random).
// import: extracts bboxes from rect/circle/ellipse/line/image/text/g; composes the complete
//   SVG affine transform list (matrix/translate/scale/rotate/skew).
//   text width is ESTIMATED from font-size × char width (no renderer) — documented heuristic.
//   the original tag is recorded as node.shape so export can preserve it.
// export: ALT → SVG. circle/ellipse/rect preserve their shape; <path> Bézier curves,
//   gradients, transforms and stroke detail flatten to a bbox-rect (documented §5 limitation).

import { parseXml, findByTag, localName, textOf } from './xml.mjs';
import { relativeLuminance } from '../color.mjs';

// tag → node.shape. Preserved through export so circles/ellipses/rects survive a round-trip
// instead of degrading to a rounded-rectangle <path> proxy.
const SHAPE_OF = {
  rect: 'rect', image: 'image', use: 'rect',
  circle: 'circle', ellipse: 'ellipse',
  line: 'line', path: 'path', text: 'text',
};

function num(v) {
  if (v == null) return 0;
  const m = /[-+]?[\d.]+/.exec(String(v));
  return m ? parseFloat(m[0]) : 0;
}

function length(v, reference = 0) {
  const source = String(v ?? '').trim();
  if (source.endsWith('%')) return num(source) * reference / 100;
  return num(source);
}

function parseViewBox(vb) {
  if (!vb) return null;
  const p = String(vb).split(/[\s,]+/).map(Number);
  if (p.length >= 4 && p.every(Number.isFinite)) return { x: p[0], y: p[1], w: p[2], h: p[3] };
  return null;
}

const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);
const TRANSFORM_NUMBER_RE = /[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;

// SVG uses column vectors. For transform="translate(...) scale(...)" the combined matrix is
// T × S, so the rightmost operation acts on a local point first. Parent and child matrices use
// the same rule: world = parent × local.
function multiplyMatrix(left, right) {
  const [a, b, c, d, e, f] = left;
  const [g, h, i, j, k, l] = right;
  return [
    a * g + c * h,
    b * g + d * h,
    a * i + c * j,
    b * i + d * j,
    a * k + c * l + e,
    b * k + d * l + f,
  ];
}

function translateMatrix(tx, ty = 0) {
  return [1, 0, 0, 1, tx, ty];
}

function transformOperation(name, values) {
  const op = name.toLowerCase();
  if (op === 'matrix' && values.length >= 6) return values.slice(0, 6);
  if (op === 'translate' && values.length >= 1) {
    return translateMatrix(values[0], values[1] ?? 0);
  }
  if (op === 'scale' && values.length >= 1) {
    return [values[0], 0, 0, values[1] ?? values[0], 0, 0];
  }
  if (op === 'rotate' && values.length >= 1) {
    const angle = values[0] * Math.PI / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rotation = [cos, sin, -sin, cos, 0, 0];
    if (values.length < 3) return rotation;
    return multiplyMatrix(
      multiplyMatrix(translateMatrix(values[1], values[2]), rotation),
      translateMatrix(-values[1], -values[2]),
    );
  }
  if (op === 'skewx' && values.length >= 1) {
    return [1, 0, Math.tan(values[0] * Math.PI / 180), 1, 0, 0];
  }
  if (op === 'skewy' && values.length >= 1) {
    return [1, Math.tan(values[0] * Math.PI / 180), 0, 1, 0, 0];
  }
  return null;
}

export function parseSvgTransform(value) {
  const source = String(value || '').trim();
  if (!source) return { matrix: [...IDENTITY], valid: true, translateOnly: true };

  const callRe = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let matrix = [...IDENTITY];
  let translateOnly = true;
  let valid = true;
  let consumed = '';
  let match;
  while ((match = callRe.exec(source))) {
    consumed += match[0];
    const values = (match[2].match(TRANSFORM_NUMBER_RE) || []).map(Number);
    const operation = transformOperation(match[1], values);
    if (!operation || !values.every(Number.isFinite)) {
      valid = false;
      continue;
    }
    if (match[1].toLowerCase() !== 'translate') translateOnly = false;
    matrix = multiplyMatrix(matrix, operation);
  }

  // Reject non-whitespace/comma text that was not parsed as a transform call.
  const residue = source.replace(callRe, '').replace(/[\s,]+/g, '');
  if (residue || !consumed) valid = false;
  return { matrix, valid, translateOnly };
}

function transformBox(box, matrix) {
  const point = (x, y) => ({
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5],
  });
  const points = [
    point(box.x, box.y),
    point(box.x + box.w, box.y),
    point(box.x, box.y + box.h),
    point(box.x + box.w, box.y + box.h),
  ];
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const round = (v) => Number(v.toFixed(4));
  return { x: round(minX), y: round(minY), w: round(maxX - minX), h: round(maxY - minY) };
}

// Estimate a <path d="..."> bounding box by walking commands (M/L/H/V/C/S/Q/T/A/Z),
// relative + absolute. Control points are included (conservative bound); arcs use endpoints.
// Good enough for icon-level geometry measurement (no curve flattening).
export function pathBbox(d) {
  if (!d) return null;
  const tokens = String(d).match(/[mlhvcsqtazMLHVCSQTAZ]|-?[0-9.]+(?:e[-+]?[0-9]+)?/gi);
  if (!tokens || !tokens.length) return null;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  let x = 0; let y = 0; let sx = 0; let sy = 0;
  const pt = (px, py) => {
    if (Number.isFinite(px) && Number.isFinite(py)) {
      minX = Math.min(minX, px); minY = Math.min(minY, py);
      maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
    }
  };
  let i = 0;
  const take = (n) => { const out = []; while (n-- > 0 && i < tokens.length) out.push(Number(tokens[i++])); return out; };
  while (i < tokens.length) {
    const t = tokens[i];
    if (!/[a-zA-Z]/.test(t)) { i++; continue; }
    const cmd = t; i++;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'M' || C === 'L') {
      let p = take(2);
      while (p.length === 2) {
        const [a, b] = p; x = rel ? x + a : a; y = rel ? y + b : b; pt(x, y);
        if (C === 'L' || i >= tokens.length || /[a-zA-Z]/.test(tokens[i])) break;
        p = take(2); // implicit L after M
      }
      if (C === 'M') { sx = x; sy = y; }
    } else if (C === 'H') { let p = take(1); while (p.length === 1) { x = rel ? x + p[0] : p[0]; pt(x, y); if (i >= tokens.length || /[a-zA-Z]/.test(tokens[i])) break; p = take(1); } }
    else if (C === 'V') { let p = take(1); while (p.length === 1) { y = rel ? y + p[0] : p[0]; pt(x, y); if (i >= tokens.length || /[a-zA-Z]/.test(tokens[i])) break; p = take(1); } }
    else if (C === 'C') { const [c1x, c1y, c2x, c2y, X, Y] = take(6); pt(rel ? x + c1x : c1x, rel ? y + c1y : c1y); pt(rel ? x + c2x : c2x, rel ? y + c2y : c2y); x = rel ? x + X : X; y = rel ? y + Y : Y; pt(x, y); }
    else if (C === 'S') { const [c2x, c2y, X, Y] = take(4); pt(rel ? x + c2x : c2x, rel ? y + c2y : c2y); x = rel ? x + X : X; y = rel ? y + Y : Y; pt(x, y); }
    else if (C === 'Q') { const [cx, cy, X, Y] = take(4); pt(rel ? x + cx : cx, rel ? y + cy : cy); x = rel ? x + X : X; y = rel ? y + Y : Y; pt(x, y); }
    else if (C === 'T') { const [X, Y] = take(2); x = rel ? x + X : X; y = rel ? y + Y : Y; pt(x, y); }
    else if (C === 'A') { take(7); /* rx,ry,xrot,laf,sf,X,Y — endpoint only */ const last = tokens.slice(i - 2, i).map(Number); if (last.length === 2) { x = rel ? x + last[0] : last[0]; y = rel ? y + last[1] : last[1]; pt(x, y); } }
    else if (C === 'Z') { x = sx; y = sy; }
  }
  if (minX === Infinity) return null;
  const r = (v) => Number(v.toFixed(4));
  return { x: r(minX), y: r(minY), w: r(maxX - minX), h: r(maxY - minY) };
}

function charWidth(ch, fontSize) {
  const cjk = /[　-鿿가-힯＀-￯]/.test(ch);
  return cjk ? fontSize : fontSize * 0.55;
}

function estimateTextWidth(text, fontSize) {
  let w = 0;
  for (const ch of String(text || '')) w += charWidth(ch, fontSize);
  return w;
}

export function importSvg(svgText) {
  const { svg, w, h, leaves } = parseSvgLeaves(svgText);
  const nodes = leaves.map(({ node }) => node);
  return {
    schema_version: 1,
    diagram_type: 'layout',
    meta: { title: svg.attrs['data-title'] || 'svg import', canvas: { w, h }, source: 'svg' },
    nodes,
  };
}

// Walk an SVG, collect content leaves (geomNode + its source element), drop full-canvas backdrops.
// SHARED by importSvg and lib/overlay/svg.mjs — overlay matches fixed nodes to leaves POSITIONALLY
// (leaves[i] ↔ alt.nodes[i]), which is exact because importSvg and overlay run the same walk, and
// fix preserves node order/count. No per-node provenance field is needed on the ALT (clean schema).
// `tainted` is retained for the lossless overlay writer. Measurement supports complete affine
// transforms, but wrapping a fixed leaf inside a transformed parent still needs inverse-matrix
// projection; overlay therefore bails on non-translate or malformed transforms.
export function parseSvgLeaves(svgText) {
  const doc = parseXml(svgText);
  const svg = findByTag(doc, 'svg')[0] || doc.children.find((c) => localName(c.tag) === 'svg') || doc;
  const vb = parseViewBox(svg.attrs.viewBox);
  const w = vb ? vb.w : (num(svg.attrs.width) || 1200);
  const h = vb ? vb.h : (num(svg.attrs.height) || 800);
  const pairs = [];
  const ctx = { tainted: false };
  let seq = 0;
  const rootMatrix = vb ? translateMatrix(-vb.x, -vb.y) : [...IDENTITY];
  walk(svg, rootMatrix, pairs, () => seq++, ctx, { w, h });
  const canvasArea = w * h;
  const leaves = pairs.filter(({ node }) => {
    if (node.kind === 'box' || node.kind === 'image') {
      if (node.bbox.w * node.bbox.h >= 0.9 * canvasArea) return false;
    }
    return true;
  });
  classifySvgSemantics(leaves);
  return { svg, w, h, leaves, tainted: ctx.tainted };
}

const NON_RENDERED_CONTAINERS = new Set([
  'defs', 'marker', 'pattern', 'clipPath', 'mask', 'symbol',
  'metadata', 'title', 'desc', 'style', 'script',
]);

function hiddenSubtree(el, tag) {
  const hidden = String(el.attrs['aria-hidden'] || '').toLowerCase() === 'true'
    || Object.hasOwn(el.attrs, 'hidden')
    || String(el.attrs.display || '').toLowerCase() === 'none'
    || String(el.attrs.visibility || '').toLowerCase() === 'hidden'
    // PowerPoint-safe SVG flattening turns a nested logo/icon SVG into a role=img group.
    // Its internal paths are image pixels, not independent layout boxes.
    || (tag === 'g' && String(el.attrs.role || '').toLowerCase() === 'img');
  return hidden || NON_RENDERED_CONTAINERS.has(tag);
}

function walk(el, parentMatrix, pairs, nextSeq, ctx, viewport) {
  for (const c of el.children) {
    const tag = localName(c.tag);
    if (tag === 'svg') continue;
    if (hiddenSubtree(c, tag)) continue;

    const transform = parseSvgTransform(c.attrs.transform);
    const matrix = multiplyMatrix(parentMatrix, transform.matrix);
    if (!transform.valid || !transform.translateOnly) ctx.tainted = true;

    const node = geomNode(c, tag, matrix, nextSeq, viewport);
    if (node) pairs.push({ node, el: c });
    if (tag === 'g' || c.children.some((gc) => localName(gc.tag) !== undefined)) {
      walk(c, matrix, pairs, nextSeq, ctx, viewport);
    }
  }
}

function geomNode(c, tag, matrix, nextSeq, viewport) {
  const a = c.attrs;
  const id = a.id || `${tag}-${nextSeq()}`;
  let localBox = null;

  if (tag === 'rect' || tag === 'image' || tag === 'use') {
    localBox = {
      x: length(a.x, viewport.w),
      y: length(a.y, viewport.h),
      w: length(a.width, viewport.w),
      h: length(a.height, viewport.h),
    };
  } else if (tag === 'circle') {
    const cx = length(a.cx, viewport.w);
    const cy = length(a.cy, viewport.h);
    const r = length(a.r, Math.min(viewport.w, viewport.h));
    localBox = { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r };
  } else if (tag === 'ellipse') {
    const cx = length(a.cx, viewport.w);
    const cy = length(a.cy, viewport.h);
    const rx = length(a.rx, viewport.w);
    const ry = length(a.ry, viewport.h);
    localBox = { x: cx - rx, y: cy - ry, w: 2 * rx, h: 2 * ry };
  } else if (tag === 'line') {
    const x1 = length(a.x1, viewport.w);
    const y1 = length(a.y1, viewport.h);
    const x2 = length(a.x2, viewport.w);
    const y2 = length(a.y2, viewport.h);
    localBox = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  } else if (tag === 'path') {
    const pb = pathBbox(a.d);
    if (!pb) return null;
    localBox = pb;
  } else if (tag === 'text') {
    const fs = num(a['font-size']) || num(fontSizeFromStyle(a.style)) || 16;
    const txt = textOf(c);
    const w = estimateTextWidth(txt, fs);
    const anchor = String(a['text-anchor'] || 'start').toLowerCase();
    const baseline = String(a['dominant-baseline'] || '').toLowerCase();
    let x = length(a.x, viewport.w);
    // Approximate the rendered glyph ink, not CSS line-height. A 0.8em ascent + 0.2em descent
    // avoids false overlap between adjacent baselines while staying conservative for CJK.
    let y = length(a.y, viewport.h) - fs * 0.8;
    if (anchor === 'middle') x -= w / 2;
    else if (anchor === 'end') x -= w;
    if (/^(?:hanging|text-before-edge)$/.test(baseline)) y = length(a.y, viewport.h);
    else if (/^(?:middle|central)$/.test(baseline)) y = length(a.y, viewport.h) - fs * 0.65;
    localBox = { x, y, w, h: fs };
  } else {
    return null;
  }

  const bbox = transformBox(localBox, matrix);
  if (bbox.w <= 0 && bbox.h <= 0) return null;

  const fill = a.fill && a.fill !== 'none' ? a.fill : null;
  const stroke = a.stroke && a.stroke !== 'none' ? a.stroke : null;
  const rawFs = num(a['font-size']) || 16;
  const matrixScale = Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2])) || 1;
  const fs = Number((rawFs * matrixScale).toFixed(3));
  const rawOpacity = a.opacity == null ? a['fill-opacity'] : a.opacity;
  const opacity = rawOpacity == null ? 1 : Math.max(0, Math.min(1, num(rawOpacity)));
  const role = tag === 'text' ? (fs >= 22 ? 'heading' : 'body') : (opacity < 0.5 ? 'decor' : 'decor');
  const luminance = fill ? 1 - relativeLuminance(fill) : 0.15;
  // A line or an unfilled path has no solid rectangular footprint. Its conservative bbox is
  // useful for bounds, but using that bbox as a collision body creates false positives for chart
  // grids, radar spokes, flow edges and PowerPoint's invisible path hit targets.
  const lineArt = tag === 'line' || (tag === 'path' && fill === null);
  const connector = lineArt || ((tag === 'path' || tag === 'line')
    && (a['data-link'] || a['data-route'] || a['marker-start'] || a['marker-mid'] || a['marker-end']));
  const kind = connector
    ? 'decor'
    : tag === 'text'
      ? 'text'
      : tag === 'image'
        ? 'image'
        : (tag === 'circle' || tag === 'ellipse' ? 'icon' : 'box');

  return {
    id,
    label: tag === 'text' ? textOf(c) : (a.id || tag),
    category: a['data-category'] || a['data-link'] || a.id || tag,
    kind,
    shape: SHAPE_OF[tag] || 'rect',
    bbox,
    style: { fontSize: fs, luminance: Number(luminance.toFixed(3)), opacity, color: stroke || '#111827', bg: fill || '#ffffff', filled: fill !== null, role },
  };
}

function containsBox(outer, inner, epsilon = 0.5) {
  return inner.x >= outer.x - epsilon
    && inner.y >= outer.y - epsilon
    && inner.x + inner.w <= outer.x + outer.w + epsilon
    && inner.y + inner.h <= outer.y + outer.h + epsilon;
}

function sameSizeShadow(a, b) {
  const sizeTolerance = Math.max(1, Math.min(a.w, a.h, b.w, b.h) * 0.02);
  const offsetTolerance = Math.max(12, Math.min(a.w, a.h, b.w, b.h) * 0.12);
  return Math.abs(a.w - b.w) <= sizeTolerance
    && Math.abs(a.h - b.h) <= sizeTolerance
    && Math.abs(a.x - b.x) <= offsetTolerance
    && Math.abs(a.y - b.y) <= offsetTolerance;
}

// Presentation-attribute SVGs expose fills that class-based web SVGs often leave in CSS. Infer
// the same layout semantics from geometry so opaque panels, card backgrounds and shadow stacks
// do not become hundreds of false P0 collisions after a PowerPoint-safe export.
function classifySvgSemantics(leaves) {
  const rects = leaves.filter(({ node }) => node.shape === 'rect' && node.kind === 'box');
  const nonRectSurfaces = leaves.filter(({ node }) =>
    (node.shape === 'path' && node.kind === 'box' && node.style?.filled === true)
    || ((node.shape === 'circle' || node.shape === 'ellipse') && node.kind === 'icon')
  );

  // Equal-size rectangle stacks are one visual component. Usually the later rectangle is the
  // foreground and the earlier offset copy is a shadow. PowerPoint exports also use an opaque
  // base followed by a translucent tint; in that case keep the base and discard the tint.
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (sameSizeShadow(rects[i].node.bbox, rects[j].node.bbox)) {
        const firstOpacity = rects[i].node.style?.opacity ?? 1;
        const secondOpacity = rects[j].node.style?.opacity ?? 1;
        if (firstOpacity >= 0.5 && secondOpacity < 0.5) {
          rects[j].node.kind = 'decor';
        } else {
          rects[i].node.kind = 'decor';
        }
        break;
      }
    }
  }

  // Small text-bearing pills are connector labels/status badges. They intentionally sit on a
  // panel or card edge, so both the pill and its label are annotations rather than collision
  // targets.
  for (const { node } of rects) {
    if (node.kind === 'decor' || node.bbox.h > 20) continue;
    const labels = leaves
      .map(({ node: other }) => other)
      .filter((other) => other.kind === 'text' && containsBox(node.bbox, other.bbox, 1));
    if (labels.length) {
      node.kind = 'decor';
      for (const label of labels) label.kind = 'decor';
    }
  }

  const visible = leaves.map(({ node }) => node).filter((node) => node.kind !== 'decor');
  for (const { node } of rects) {
    if (node.kind === 'decor') continue;
    const contained = visible.filter((other) =>
      other !== node
      && other.bbox
      && containsBox(node.bbox, other.bbox)
      && other.bbox.w * other.bbox.h < node.bbox.w * node.bbox.h
    );
    if (!contained.length) continue;
    const containedRects = contained.filter((other) => other.shape === 'rect');
    // Region panels and outline/highlight shells are visual grouping backgrounds. A filled panel
    // becomes a backdrop once it owns multiple boxes; an unfilled shell needs only one.
    if (containedRects.length >= 2 || (node.style?.filled === false && containedRects.length >= 1)) {
      node.kind = 'decor';
    } else {
      node.kind = 'container';
    }
  }

  // Flowchart decisions and Venn/set nodes are emitted as paths, circles or ellipses. Their bbox
  // is a container approximation; contained labels are intentional children, not collisions.
  for (const { node } of nonRectSurfaces) {
    const containsText = leaves.some(({ node: other }) =>
      other !== node
      && other.kind === 'text'
      && containsBox(node.bbox, other.bbox, 1)
    );
    if (containsText) node.kind = 'container';
  }
}

function fontSizeFromStyle(style) {
  if (!style) return null;
  const m = /font-size:\s*([\d.]+)/.exec(style);
  return m ? m[1] : null;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function exportSvg(alt) {
  const { w, h } = alt.meta.canvas;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`];
  out.push(`  <rect width="${w}" height="${h}" fill="#ffffff"/>`);
  for (const node of alt.nodes) {
    const b = node.bbox;
    const bg = node.style?.bg || '#ffffff';
    const stroke = node.style?.color || '#111827';
    const opacity = node.style?.opacity;
    const op = (opacity != null && opacity < 1) ? ` opacity="${round(opacity)}"` : '';
    // data-category preserves grouping semantics across export→import (measurement hint; browsers ignore it)
    const dc = node.category ? ` data-category="${esc(node.category)}"` : '';
    if (node.kind === 'text') {
      const fs = node.style?.fontSize || 16;
      out.push(`  <text x="${round(b.x)}" y="${round(b.y + fs * 0.8)}" font-size="${fs}" fill="${stroke}"${op}${dc}>${esc(node.label || '')}</text>`);
    } else if (node.kind === 'image') {
      out.push(`  <image x="${round(b.x)}" y="${round(b.y)}" width="${round(b.w)}" height="${round(b.h)}"${op}${dc}/>`);
    } else {
      // A bbox-only node is a rectangle by default — this holds for nodes imported from
      // pptx/html/ooxml/alt (no recorded shape) as well as svg <rect>. Only <path>/<line>
      // (explicit non-rect shapes) flatten to a rounded-rect proxy (documented §5 limitation).
      const shape = node.shape || 'rect';
      if (shape === 'circle') {
        out.push(`  <circle cx="${round(b.x + b.w / 2)}" cy="${round(b.y + b.h / 2)}" r="${round(Math.min(b.w, b.h) / 2)}" fill="${bg}"${op}${dc}/>`);
      } else if (shape === 'ellipse') {
        out.push(`  <ellipse cx="${round(b.x + b.w / 2)}" cy="${round(b.y + b.h / 2)}" rx="${round(b.w / 2)}" ry="${round(b.h / 2)}" fill="${bg}"${op}${dc}/>`);
      } else if (shape === 'rect') {
        out.push(`  <rect x="${round(b.x)}" y="${round(b.y)}" width="${round(b.w)}" height="${round(b.h)}" fill="${bg}"${op}${dc}/>`);
      } else {
        // path / line: Bézier & stroke geometry flatten to the bbox.
        out.push(`  <path d="${rectPath(b.x, b.y, b.w, b.h, Math.min(1.2, Math.min(b.w, b.h) / 3))}" fill="${bg}"${op}${dc}/>`);
      }
    }
  }
  out.push(`</svg>`);
  return out.join('\n');
}

function round(v) { return Number(Number(v).toFixed(2)); }

// rounded-rectangle as a <path> (so export honors the <path> convention with corner radius)
function rectPath(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  const X = round(x); const Y = round(y); const W = round(w); const H = round(h);
  if (rr <= 0.01) return `M${X} ${Y} h${W} v${H} h${-W} Z`;
  return `M${round(x + rr)} ${Y} h${round(W - 2 * rr)} a${rr} ${rr} 0 0 1 ${rr} ${rr} v${round(H - 2 * rr)} a${rr} ${rr} 0 0 1 ${-rr} ${rr} h${round(-(W - 2 * rr))} a${rr} ${rr} 0 0 1 ${-rr} ${-rr} v${round(-(H - 2 * rr))} a${rr} ${rr} 0 0 1 ${rr} ${-rr} Z`;
}
