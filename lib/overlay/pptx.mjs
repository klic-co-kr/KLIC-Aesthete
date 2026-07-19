#!/usr/bin/env node
// PPTX overlay export — Aesthete fix → OfficeCLI batch manifest (lossless for masters/themes/charts).
//
// The PPTX adapter's exportPptx regenerates a minimal single-slide package (no master/theme/chart
// — lossy). Instead of round-tripping, emit a PATCH MANIFEST that an external engine (OfficeCLI)
// applies to the ORIGINAL .pptx, preserving everything else. Aesthete measures/corrects; OfficeCLI
// executes. Separation of concerns, same as the SVG overlay.
//
// Addressing gap (the real mapping problem): Aesthete imports only <p:sp> and indexes them
// sp-0, sp-1, …. OfficeCLI's /slide[N]/shape[M] counts ALL shape-tree children (sp, pic,
// graphicFrame, cxnSp, grpSp) 1-based — so the indices DIVERGE when pictures/charts are
// interspersed. Rather than stash a sidecar on the ALT (schema pollution), exportPatches
// RE-PARSES the original .pptx, walks the full shape tree to find each <p:sp>'s true OfficeCLI
// shape-index, and matches positionally to alt.nodes (exact — import and overlay run the same
// sp walk, fix preserves order/count). Throws on count mismatch; never silently mis-addresses.
//
// Honest scope (MVP): top-level shapes only (grouped shapes /slide/grpSp[..]/.. not addressed);
// prop names x/y/w/h in EMU (position x/y well-attested; size w/h should be confirmed via
// `officecli help pptx set shape` — OfficeCLI auto-suggests on a wrong name, so no silent risk).

import fs from 'node:fs';
import path from 'node:path';
import { readZip, zipEntryText } from '../adapters/zip.mjs';
import { parseXml, findByTag, localName } from '../adapters/xml.mjs';
import { emuToPx, pxToEmu } from '../adapters/emu.mjs';
import { readJson, parseArgs, isMain } from '../shared/cli.mjs';

const SHAPE_TAGS = new Set(['sp', 'pic', 'graphicFrame', 'cxnSp', 'grpSp']);
const numSlide = (name) => { const m = /slide(\d+)\.xml/.exec(name); return m ? +m[1] : Infinity; };

function firstSlideName(entries) {
  const slides = [...entries.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  if (!slides.length) return null;
  slides.sort((a, b) => numSlide(a) - numSlide(b));
  return slides[0];
}

// Walk the slide's spTree top-level children. Each shape-tag child gets a 1-based OfficeCLI
// shape-index; <p:sp> children also record their px bbox and sp-order (for positional match).
// Exported so the divergence logic (sp-order vs full-tree shape-index) is unit-testable.
export function spOfficePaths(slideXmlText) {
  const doc = parseXml(slideXmlText);
  const spTree = findByTag(doc, 'spTree')[0];
  if (!spTree) return [];
  const out = [];
  let shapeIdx = 0;
  let spOrder = 0;
  for (const c of spTree.children) {
    const tag = localName(c.tag);
    if (!SHAPE_TAGS.has(tag)) continue;
    shapeIdx++; // OfficeCLI 1-based shape index (counts ALL shape children)
    if (tag !== 'sp') continue;
    const xfrm = findByTag(c, 'xfrm')[0];
    const off = xfrm ? findByTag(xfrm, 'off')[0] : null;
    const ext = xfrm ? findByTag(xfrm, 'ext')[0] : null;
    if (!off || !ext) continue;
    out.push({
      spOrder: spOrder++,
      shapeIdx,
      bboxPx: {
        x: Math.round(emuToPx(off.attrs.x)),
        y: Math.round(emuToPx(off.attrs.y)),
        w: Math.round(emuToPx(ext.attrs.cx)),
        h: Math.round(emuToPx(ext.attrs.cy)),
      },
    });
  }
  return out; // ordered by spOrder; each { spOrder, shapeIdx, bboxPx }
}

// Build the OfficeCLI batch manifest: one `set` patch per fix-changed shape.
// Matching is POSITIONAL: spOfficePaths(originalSlide)[i] ↔ alt.nodes[i]. Throws on mismatch.
export function exportPatches(originalPptxBuffer, fixedAlt, opts = {}) {
  const entries = readZip(originalPptxBuffer);
  const slideName = opts.slide ? `ppt/slides/slide${opts.slide}.xml` : firstSlideName(entries);
  if (!slideName) throw new Error('pptx overlay: no slide found in the original .pptx');
  const slide = numSlide(slideName);
  const slideXml = zipEntryText(entries, slideName);
  if (!slideXml) throw new Error(`pptx overlay: slide entry ${slideName} missing`);
  const spPaths = spOfficePaths(slideXml);
  const nodes = fixedAlt.nodes || [];
  if (spPaths.length !== nodes.length) {
    throw new Error(`pptx overlay: sp count (${spPaths.length}) ≠ alt node count (${nodes.length}) — the alt is not the import of this slide. Aborting positional match.`);
  }
  const EPS = 1; // px
  const patches = [];
  for (let i = 0; i < nodes.length; i++) {
    const b = nodes[i].bbox;
    const o = spPaths[i].bboxPx;
    const moved = Math.abs(b.x - o.x) >= EPS || Math.abs(b.y - o.y) >= EPS;
    const sized = Math.abs(b.w - o.w) >= EPS || Math.abs(b.h - o.h) >= EPS;
    if (!moved && !sized) continue;
    const props = {};
    if (moved) { props.x = pxToEmu(b.x); props.y = pxToEmu(b.y); }
    if (sized) { props.w = pxToEmu(b.w); props.h = pxToEmu(b.h); }
    patches.push({ op: 'set', path: `/slide[${slide}]/shape[${spPaths[i].shapeIdx}]`, props });
  }
  return {
    domain: 'pptx',
    engine: 'officecli',
    slide,
    command: 'batch',
    patches,
    note: "apply: officecli batch <deck.pptx> --commands '<patches JSON>'  (atomic; preserves masters/themes/charts)",
  };
}

// ---- CLI: bun lib/overlay/pptx.mjs <original.pptx> <fixed.alt.json> [out.patches.json] [--slide N] ----
async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [pptxPath, altPath] = positional;
  if (!pptxPath || !altPath) {
    console.error('usage: bun lib/overlay/pptx.mjs <original.pptx> <fixed.alt.json> [out.patches.json] [--slide N]');
    console.error('  emits an OfficeCLI batch manifest applying the fixed ALT to the ORIGINAL pptx (lossless for masters/themes/charts)');
    process.exit(2);
  }
  const buf = fs.readFileSync(pptxPath);
  const alt = readJson(altPath);
  const slide = flags.slide ? Number(flags.slide) : undefined;
  const manifest = exportPatches(buf, alt, { slide });
  const outPath = positional[2] || path.join(process.cwd(), `${path.basename(pptxPath, '.pptx')}.patches.json`);
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`pptx overlay: ${manifest.patches.length} patch(es) | slide ${manifest.slide} | ${outPath}`);
}

if (isMain(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
