// PPTX (OOXML PresentationML) adapter. .pptx is a ZIP of XML; slide shapes carry
// EXPLICIT geometry (a:off/a:ext in EMU), so this is fully deterministic in pure JS —
// no browser. import: .pptx → ALT for slide N (default first). export: ALT → minimal
// geometry-faithful .pptx (round-trips with our importer; add a slide master/theme for
// pristine PowerPoint rendering — documented limitation).

import { readZip, zipEntryText, writeZip } from './zip.mjs';
import { parseXml, findByTag, textOf } from './xml.mjs';
import { emuToPx, pxToEmu } from './emu.mjs';

const DEFAULT_CANVAS = { w: 960, h: 540 }; // 13.33"×7.5" at 72dpi-ish (16:9)

function firstSlideName(entries) {
  const slides = [...entries.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  if (!slides.length) return null;
  slides.sort((a, b) => numSlide(a) - numSlide(b));
  return slides[0];
}
function numSlide(name) { const m = /slide(\d+)\.xml/.exec(name); return m ? +m[1] : Infinity; }

export function importPptx(buffer, opts = {}) {
  const entries = readZip(buffer);
  let canvas = { ...DEFAULT_CANVAS };
  const pres = zipEntryText(entries, 'ppt/presentation.xml');
  if (pres) {
    const sz = findByTag(parseXml(pres), 'sldSz')[0];
    if (sz && sz.attrs.cx && sz.attrs.cy) {
      canvas = { w: Math.round(emuToPx(sz.attrs.cx)), h: Math.round(emuToPx(sz.attrs.cy)) };
    }
  }
  const slideName = opts.slide ? `ppt/slides/slide${opts.slide}.xml` : firstSlideName(entries);
  const nodes = [];
  if (slideName) {
    const xml = zipEntryText(entries, slideName);
    if (xml) {
      const doc = parseXml(xml);
      const shapes = findByTag(doc, 'sp');
      shapes.forEach((sp, idx) => {
        const node = shapeToNode(sp, idx);
        if (node) nodes.push(node);
      });
    }
  }
  return {
    schema_version: 1,
    diagram_type: 'layout',
    meta: { title: `pptx ${slideName || '(no slide)'}`, canvas, source: 'pptx' },
    nodes,
  };
}

function shapeToNode(sp, idx) {
  const xfrm = findByTag(sp, 'xfrm')[0];
  const off = xfrm ? findByTag(xfrm, 'off')[0] : null;
  const ext = xfrm ? findByTag(xfrm, 'ext')[0] : null;
  if (!off || !ext) return null;
  const bbox = {
    x: Math.round(emuToPx(off.attrs.x)),
    y: Math.round(emuToPx(off.attrs.y)),
    w: Math.round(emuToPx(ext.attrs.cx)),
    h: Math.round(emuToPx(ext.attrs.cy)),
  };
  if (bbox.w <= 0 && bbox.h <= 0) return null;
  const text = findByTag(sp, 't').map(textOf).filter(Boolean).join(' ').trim();
  const sz = detectFontSize(sp) || 18;
  const hasText = Boolean(text);
  return {
    id: `sp-${idx}`,
    label: text || sp.attrs.id || 'shape',
    // PPTX carries no grouping semantics → unique category per shape so proximity
    // skips gracefully (no manufactured fragmentation). Annotate to enable grouping.
    category: `sp-${idx}`,
    kind: hasText ? 'text' : 'box',
    bbox,
    style: {
      fontSize: sz,
      luminance: 0.1,
      color: '#111827',
      bg: '#ffffff',
      role: sz >= 22 ? 'heading' : 'body',
    },
  };
}

function detectFontSize(sp) {
  let max = 0;
  for (const tag of ['rPr', 'defRPr']) {
    for (const el of findByTag(sp, tag)) {
      const sz = Number(el.attrs.sz);
      if (Number.isFinite(sz)) max = Math.max(max, sz / 100);
    }
  }
  return max || 0;
}

// ---- export: ALT → minimal .pptx (Buffer) ----

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function slideXml(alt) {
  const shapes = alt.nodes.map((n, i) => {
    const b = n.bbox;
    const x = pxToEmu(b.x), y = pxToEmu(b.y), cx = pxToEmu(b.w), cy = pxToEmu(b.h);
    const txt = n.kind === 'text' ? `<a:p><a:r><a:rPr lang="ko-KR" sz="${Math.round((n.style?.fontSize || 18) * 100)}"/><a:t>${esc(n.label || '')}</a:t></a:r></a:p>` : '';
    return `<p:sp><p:nvSpPr><p:cNvPr id="${i + 1}" name="${esc(n.id)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>${txt ? `<p:txBody><a:bodyPr/><a:lstStyle/>${txt}</p:txBody>` : ''}</p:sp>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

export function exportPptx(alt) {
  const cx = pxToEmu(alt.meta.canvas.w);
  const cy = pxToEmu(alt.meta.canvas.h);
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`;
  const presentation = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst><p:sldId id="rId1"/></p:sldIdLst><p:sldSz cx="${cx}" cy="${cy}"/></p:presentation>`;
  const presRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`;
  return writeZip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'ppt/presentation.xml', data: presentation },
    { name: 'ppt/_rels/presentation.xml.rels', data: presRels },
    { name: 'ppt/slides/slide1.xml', data: slideXml(alt) },
  ]);
}
