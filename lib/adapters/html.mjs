// HTML adapter: HTML ↔ ALT. Pure-JS — NO browser, so this only sees EXPLICIT geometry:
//   - data-* attributes: data-x/y/w/h (data-role, data-category, data-label)
//   - inline position:absolute with left/top/width/height
// Real CSS box-model layout (flow, flex, grid) needs a browser and is out of scope here.
// Documented limitation (see DESIGN.md). export() writes absolutely-positioned divs so the
// round-trip stays measurable.

import { parseXml, findByTag, localName, textOf } from './xml.mjs';

function num(v) {
  if (v == null) return 0;
  const m = /[-+]?[\d.]+/.exec(String(v));
  return m ? parseFloat(m[0]) : 0;
}

function stylePx(style, prop) {
  if (!style) return null;
  const m = new RegExp(`${prop}\\s*:\\s*([\\d.]+)`).exec(style);
  return m ? parseFloat(m[1]) : null;
}

export function importHtml(htmlText, opts = {}) {
  const doc = parseXml(htmlText);
  const body = findByTag(doc, 'body')[0] || doc;
  const canvas = {
    w: num(body.attrs['data-w']) || opts.w || 1200,
    h: num(body.attrs['data-h']) || opts.h || 800,
  };
  const nodes = [];
  let seq = 0;
  walk(body, nodes, () => seq++);
  return {
    schema_version: 1,
    diagram_type: 'layout',
    meta: { title: body.attrs['data-title'] || 'html import', canvas, source: 'html' },
    nodes,
  };
}

function walk(el, nodes, nextSeq) {
  for (const c of el.children) {
    const tag = localName(c.tag);
    if (tag === 'script' || tag === 'style' || tag === 'head') continue;
    const node = geomHtml(c, nextSeq);
    if (node) nodes.push(node);
    walk(c, nodes, nextSeq);
  }
}

function geomHtml(c, nextSeq) {
  const a = c.attrs;
  const style = a.style || '';
  const x = a['data-x'] != null ? num(a['data-x']) : stylePx(style, 'left');
  const y = a['data-y'] != null ? num(a['data-y']) : stylePx(style, 'top');
  const w = a['data-w'] != null ? num(a['data-w']) : stylePx(style, 'width');
  const h = a['data-h'] != null ? num(a['data-h']) : stylePx(style, 'height');
  if ([x, y, w, h].some((v) => v == null || !Number.isFinite(v))) return null;
  if (w <= 0 && h <= 0) return null;

  const fs = stylePx(style, 'font-size') || num(a['data-fontsize']) || 16;
  const role = a['data-role'] || (fs >= 22 ? 'heading' : 'body');
  const seqId = a.id || `${localName(c.tag)}-${nextSeq()}`;
  // explicit grouping via data-category; otherwise unique per element so proximity skips
  // gracefully (HTML without data-category carries no grouping semantics).
  const category = a['data-category'] || seqId;
  const label = a['data-label'] || textOf(c);
  const color = stylePxColor(style, 'color') || '#111827';
  const bg = stylePxColor(style, 'background-color') || a['data-bg'] || '#ffffff';
  const kind = a['data-kind'] || (role === 'decor' ? 'box' : (label && w * h < 40000 ? 'text' : 'box'));

  return {
    id: seqId,
    label,
    category,
    kind,
    bbox: { x, y, w, h },
    style: { fontSize: fs, color, bg, role },
  };
}

function stylePxColor(style, prop) {
  if (!style) return null;
  const m = new RegExp(`${prop}\\s*:\\s*(#[0-9a-fA-F]{3,8})`).exec(style);
  return m ? m[1] : null;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function exportHtml(alt) {
  const { w, h } = alt.meta.canvas;
  const lines = [
    '<!doctype html>',
    '<html><head><meta charset="utf-8"><style>',
    'html,body{margin:0;padding:0}',
    `.stage{position:relative;width:${round(w)}px;height:${round(h)}px;background:#fff;font-family:system-ui,sans-serif}`,
    '.node{position:absolute;box-sizing:border-box}',
  ];

  // 디자인 스펙이 시맨틱 컬러 토큰을 선언하면 :root CSS 변수로 내보내고, 노드 색은
  // var(--color-<token>)로 참조한다 — 임의 hex 대신 선언된 토큰을 적극 사용(디자인 준수).
  const colorTokens = alt.meta?.design?.tokens?.color || null;
  const hexToToken = new Map();
  if (colorTokens) {
    const rootVars = Object.entries(colorTokens)
      .map(([name, hex]) => { const n = normHex(hex); if (n) hexToToken.set(n, name); return n ? `--color-${name}:${n}` : null; })
      .filter(Boolean);
    if (rootVars.length) lines.push(`:root{${rootVars.join(';')}}`);
  }
  const colorOf = (hex, fallback) => {
    const n = normHex(hex);
    const tok = n && hexToToken.get(n);
    return tok ? `var(--color-${tok})` : (hex || fallback);
  };
  const fontTokens = alt.meta?.design?.tokens?.fontSize || null;
  const fsToToken = new Map();
  if (fontTokens) for (const [name, v] of Object.entries(fontTokens)) if (Number.isFinite(v)) fsToToken.set(v, name);
  const fontOfSize = (fs) => (fsToToken.has(fs) ? `var(--font-${fsToToken.get(fs)})` : `${fs}px`);
  if (fontTokens) {
    const fv = Object.entries(fontTokens).filter(([, v]) => Number.isFinite(v)).map(([n, v]) => `--font-${n}:${v}px`);
    if (fv.length) lines.push(`:root{${fv.join(';')}}`);
  }

  lines.push('</style></head>');
  lines.push(`<body data-w="${round(w)}" data-h="${round(h)}">`);
  lines.push(`<div class="stage" data-w="${round(w)}" data-h="${round(h)}">`);
  for (const n of alt.nodes) {
    const b = n.bbox;
    const bg = colorOf(n.style?.bg, '#ffffff');
    const col = colorOf(n.style?.color, '#111827');
    if (n.kind === 'text') {
      const fs = n.style?.fontSize || 16;
      lines.push(`  <div class="node" style="left:${round(b.x)}px;top:${round(b.y)}px;width:${round(b.w)}px;height:${round(b.h)}px;color:${col};font-size:${fontOfSize(fs)}">${esc(n.label || '')}</div>`);
    } else {
      lines.push(`  <div class="node" style="left:${round(b.x)}px;top:${round(b.y)}px;width:${round(b.w)}px;height:${round(b.h)}px;background:${bg};border:1.5px solid ${col}"></div>`);
    }
  }
  lines.push('</div></body></html>');
  return lines.join('\n');
}

function normHex(h) {
  const s = String(h || '').toLowerCase().trim();
  if (!s) return null;
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + s.slice(1).split('').map((c) => c + c).join('');
  if (/^#[0-9a-f]{8}$/.test(s)) return s.slice(0, 7);
  return /^#[0-9a-f]{6}$/.test(s) ? s : null;
}

function round(v) { return Number(Number(v).toFixed(2)); }
