#!/usr/bin/env node
// SVG overlay export — the lossless counterpart to exportSvg's flattening.
//
// Problem (Phase 1 of the export-patch-overlay plan): `exportSvg` regenerates the SVG from ALT
// bboxes, so `<path>` Bézier/gradient/stroke flatten to bbox-rects (lossy). Overlay instead
// KEEPS the original SVG and applies only the fix's geometric change as a `<g transform>` wrap
// around the moved/resized element — path data, gradients, strokes preserved.
//
// Closed-loop-safe design (the hole the original plan missed): the fix STILL mutates `bbox`
// (measure reads bbox, so measure→fix→re-measure stays intact). Each imported node carries an
// `_originalBbox` (import-time copy). At overlay time we re-parse the ORIGINAL svg, match each
// leaf to a node by its `_originalBbox`, and where the node's CURRENT bbox differs we wrap that
// leaf's source element in `<g transform="...">`. The delta is derived, never accumulated — so
// no side-channel `_transform` that would desync the measurement loop.
//
// Honest scope: re-serializes the whole document (semantic preservation of every element +
// attribute incl. `d`/`fill`/`stroke`/gradients; formatting/comments normalized). NOT a
// byte-identical patch of the source. Matching is by import-time bbox; duplicate-identical
// elements are an unresolved edge case.

import path from 'node:path';
import fs from 'node:fs';
import { parseXml, localName, VOID_TAGS } from '../adapters/xml.mjs';
import { parseSvgLeaves } from '../adapters/svg.mjs';
import { readJson, parseArgs, isMain } from '../shared/cli.mjs';

const fmt = (v) => Number(Number(v).toFixed(3));
const EPS_PX = 0.5;   // sub-half-pixel translate is noise
const EPS_SC = 0.01;  // 1% scale is noise

// Transform that maps an element from its original bbox `o` to the fixed bbox `f`. null if the
// change is below noise. Pure translate when size is unchanged; scale-about-origin + translate
// when resized (so the element lands exactly on the fixed bbox).
export function deltaTransform(o, f) {
  const dx = f.x - o.x;
  const dy = f.y - o.y;
  const sx = o.w > 0 ? f.w / o.w : 1;
  const sy = o.h > 0 ? f.h / o.h : 1;
  const moved = Math.abs(dx) >= EPS_PX || Math.abs(dy) >= EPS_PX;
  const scaled = Math.abs(sx - 1) >= EPS_SC || Math.abs(sy - 1) >= EPS_SC;
  if (!moved && !scaled) return null;
  if (!scaled) return `translate(${fmt(dx)} ${fmt(dy)})`;
  // scale about the original origin, then translate to the fixed position
  return `translate(${fmt(f.x)} ${fmt(f.y)}) scale(${fmt(sx)} ${fmt(sy)}) translate(${fmt(-o.x)} ${fmt(-o.y)})`;
}

const attrEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const txtEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Re-serialize an element tree, wrapping any element in `wrapFor` (Map: el -> transform string)
// with `<g transform="...">…</g>`. Preserves tag, all attrs, text, children, gradients/defs.
function serialize(el, wrapFor) {
  const isVoid = VOID_TAGS.has(el.tag) || VOID_TAGS.has(localName(el.tag));
  const attrs = Object.entries(el.attrs).map(([k, v]) => ` ${k}="${attrEsc(v)}"`).join('');
  const open = `<${el.tag}${attrs}`;
  const inner = el.text ? txtEsc(el.text) : '';
  const body = isVoid
    ? `${open}/>`
    : `${open}>${inner}${el.children.map((c) => serialize(c, wrapFor)).join('')}</${el.tag}>`;
  const t = wrapFor.get(el);
  return t ? `<g transform="${t}">${body}</g>` : body;
}

// Build the overlay SVG: original document with each fix-changed element wrapped.
export function applySvgOverlay(originalSvgText, alt) {
  const { svg, leaves } = parseSvgLeaves(originalSvgText);
  // index fixed nodes by their import-time bbox (rounded key) → current bbox
  const key = (b) => `${b.x.toFixed(2)},${b.y.toFixed(2)},${b.w.toFixed(2)},${b.h.toFixed(2)}`;
  const fixedByKey = new Map();
  for (const n of alt.nodes || []) {
    if (n._originalBbox) fixedByKey.set(key(n._originalBbox), n);
  }
  const wrapFor = new Map();
  for (const { node, el } of leaves) {
    const fixed = fixedByKey.get(key(node.bbox));
    if (!fixed) continue;
    const t = deltaTransform(node.bbox, fixed.bbox);
    if (t) wrapFor.set(el, t);
  }
  return serialize(svg, wrapFor);
}

// ---- CLI: bun lib/overlay/svg.mjs <original.svg> <fixed.alt.json> [out.svg] ----
async function main() {
  const { positional } = parseArgs(process.argv.slice(2));
  const [svgPath, altPath] = positional;
  if (!svgPath || !altPath) {
    console.error('usage: bun lib/overlay/svg.mjs <original.svg> <fixed.alt.json> [out.svg]');
    console.error('  applies the fixed ALT as transform overlays on the ORIGINAL svg (lossless for path/gradient/stroke)');
    process.exit(2);
  }
  const originalSvgText = fs.readFileSync(svgPath, 'utf8');
  const alt = readJson(altPath);
  const out = applySvgOverlay(originalSvgText, alt);
  const outPath = positional[2] || path.join(process.cwd(), `${path.basename(svgPath, '.svg')}.overlay.svg`);
  fs.writeFileSync(outPath, out);
  const wraps = (out.match(/<g transform="/g) || []).length;
  console.log(`overlay: ${wraps} element(s) wrapped | ${outPath}`);
}

if (isMain(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
