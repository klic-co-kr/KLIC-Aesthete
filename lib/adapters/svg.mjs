// SVG adapter: SVG markup ↔ ALT. Pure-JS, deterministic (sequential ids, no Math.random).
// import: extracts bboxes from rect/circle/ellipse/line/image/text/g; accumulates translate().
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

function parseViewBox(vb) {
  if (!vb) return null;
  const p = String(vb).split(/[\s,]+/).map(Number);
  if (p.length >= 4 && p.every(Number.isFinite)) return { x: p[0], y: p[1], w: p[2], h: p[3] };
  return null;
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
  const doc = parseXml(svgText);
  const svg = findByTag(doc, 'svg')[0] || doc.children.find((c) => localName(c.tag) === 'svg') || doc;
  const vb = parseViewBox(svg.attrs.viewBox);
  // geometry is in viewBox coordinate space; width/height are only display size.
  const w = vb ? vb.w : (num(svg.attrs.width) || 1200);
  const h = vb ? vb.h : (num(svg.attrs.height) || 800);

  const nodes = [];
  let seq = 0;
  walk(svg, { tx: 0, ty: 0 }, nodes, () => seq++);

  // drop full-canvas background rects (they aren't content; they skew balance/whitespace)
  const canvasArea = w * h;
  const content = nodes.filter((nd) => {
    if (nd.kind === 'box' || nd.kind === 'image') {
      const a = nd.bbox.w * nd.bbox.h;
      if (a >= 0.9 * canvasArea) return false;
    }
    return true;
  });

  return {
    schema_version: 1,
    diagram_type: 'layout',
    meta: { title: svg.attrs['data-title'] || 'svg import', canvas: { w, h }, source: 'svg' },
    nodes: content,
  };
}

function walk(el, off, nodes, nextSeq) {
  for (const c of el.children) {
    const tag = localName(c.tag);
    if (tag === 'svg') continue;
    let delta = off;
    const tr = c.attrs.transform || '';
    const tm = /translate\(\s*([-\d.]+)[\s,]+([-\d.]+)\s*\)/.exec(tr);
    if (tm) delta = { tx: off.tx + num(tm[1]), ty: off.ty + num(tm[2]) };
    const node = geomNode(c, tag, delta, nextSeq);
    if (node) nodes.push(node);
    if (tag === 'g' || c.children.some((gc) => localName(gc.tag) !== undefined)) {
      walk(c, delta, nodes, nextSeq);
    }
  }
}

function geomNode(c, tag, off, nextSeq) {
  const a = c.attrs;
  const id = a.id || `${tag}-${nextSeq()}`;
  let bbox = null;

  if (tag === 'rect' || tag === 'image' || tag === 'use') {
    bbox = { x: num(a.x) + off.tx, y: num(a.y) + off.ty, w: num(a.width), h: num(a.height) };
  } else if (tag === 'circle') {
    const cx = num(a.cx) + off.tx, cy = num(a.cy) + off.ty, r = num(a.r);
    bbox = { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r };
  } else if (tag === 'ellipse') {
    const cx = num(a.cx) + off.tx, cy = num(a.cy) + off.ty, rx = num(a.rx), ry = num(a.ry);
    bbox = { x: cx - rx, y: cy - ry, w: 2 * rx, h: 2 * ry };
  } else if (tag === 'line') {
    const x1 = num(a.x1) + off.tx, y1 = num(a.y1) + off.ty, x2 = num(a.x2) + off.tx, y2 = num(a.y2) + off.ty;
    bbox = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  } else if (tag === 'path') {
    const pb = pathBbox(a.d);
    if (!pb) return null;
    bbox = { x: pb.x + off.tx, y: pb.y + off.ty, w: pb.w, h: pb.h };
  } else if (tag === 'text') {
    const fs = num(a['font-size']) || num(fontSizeFromStyle(a.style)) || 16;
    const txt = textOf(c);
    const w = estimateTextWidth(txt, fs);
    bbox = { x: num(a.x) + off.tx, y: num(a.y) + off.ty, w, h: fs * 1.3 };
  } else {
    return null;
  }

  if (bbox.w <= 0 && bbox.h <= 0) return null;

  const fill = a.fill && a.fill !== 'none' ? a.fill : null;
  const stroke = a.stroke && a.stroke !== 'none' ? a.stroke : null;
  const fs = num(a['font-size']) || 16;
  const opacity = Math.max(0, Math.min(1, num(a.opacity == null ? a['fill-opacity'] : a.opacity) || 1));
  const role = tag === 'text' ? (fs >= 22 ? 'heading' : 'body') : (opacity < 0.5 ? 'decor' : 'decor');
  const luminance = fill ? 1 - relativeLuminance(fill) : 0.15;
  const kind = tag === 'text' ? 'text' : (tag === 'image' ? 'image' : (tag === 'circle' || tag === 'ellipse' ? 'icon' : 'box'));

  return {
    id,
    label: tag === 'text' ? textOf(c) : (a.id || tag),
    category: a['data-category'] || a.id || tag,
    kind,
    shape: SHAPE_OF[tag] || 'rect',
    bbox,
    style: { fontSize: fs, luminance: Number(luminance.toFixed(3)), opacity, color: stroke || '#111827', bg: fill || '#ffffff', filled: fill !== null, role },
  };
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
      out.push(`  <text x="${round(b.x)}" y="${round(b.y + fs)}" font-size="${fs}" fill="${stroke}"${op}${dc}>${esc(node.label || '')}</text>`);
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
