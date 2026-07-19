// OOXML family router. PPTX (PresentationML) is geometry-rich → full delegation.
// DOCX (WordprocessingML) and XLSX (SpreadsheetML) have NO absolute 2D layout — text
// flows / cells grid — so we extract a best-effort flow/grid ALT. Honest about the
// approximation (documented in DESIGN.md): real pixel-exact doc/xls layout needs a renderer.

import { readZip, zipEntryText } from './zip.mjs';
import { parseXml, findByTag, textOf } from './xml.mjs';
import { importPptx } from './pptx.mjs';

const TWIPS_PER_PX = 15;

export function detectOoxmlFlavor(buffer) {
  const entries = readZip(buffer);
  const ct = zipEntryText(entries, '[Content_Types].xml') || '';
  if (/presentationml\.presentation/.test(ct)) return 'pptx';
  if (/wordprocessingml\.document/.test(ct)) return 'docx';
  if (/spreadsheetml\.sheet/.test(ct)) return 'xlsx';
  return null;
}

export function importOoxml(buffer, opts = {}) {
  const flavor = detectOoxmlFlavor(buffer);
  if (flavor === 'pptx') return importPptx(buffer, opts);
  if (flavor === 'docx') return importDocx(buffer);
  if (flavor === 'xlsx') return importXlsx(buffer);
  return {
    schema_version: 1,
    diagram_type: 'layout',
    meta: { title: 'unknown ooxml', canvas: { w: 1200, h: 800 }, source: 'ooxml', note: 'unrecognized OOXML flavor' },
    nodes: [],
  };
}

function importDocx(buffer) {
  const entries = readZip(buffer);
  const xml = zipEntryText(entries, 'word/document.xml') || '';
  const doc = parseXml(xml);
  const sectPr = findByTag(doc, 'sectPr')[0];
  const pgSz = sectPr ? findByTag(sectPr, 'pgSz')[0] : null;
  const w = pgSz && pgSz.attrs['w:w'] ? Math.round(Number(pgSz.attrs['w:w']) / TWIPS_PER_PX) : 816;
  const h = pgSz && pgSz.attrs['w:h'] ? Math.round(Number(pgSz.attrs['w:h']) / TWIPS_PER_PX) : 1056;

  const paragraphs = findByTag(doc, 'p');
  const nodes = [];
  const leftMargin = 96;
  const contentW = w - leftMargin * 2;
  let y = leftMargin;
  paragraphs.forEach((p, i) => {
    const text = findByTag(p, 't').map(textOf).filter(Boolean).join('');
    const szEl = findByTag(p, 'sz')[0] || findByTag(p, 'szCs')[0];
    const halfPt = szEl && szEl.attrs['w:val'] ? Number(szEl.attrs['w:val']) : 22;
    const fontSize = halfPt / 2;
    if (!text) { y += fontSize * 1.3; return; }
    const node = {
      id: `p-${i}`,
      label: text.slice(0, 80),
      category: `p-${i}`,
      kind: 'text',
      bbox: { x: leftMargin, y: Math.round(y), w: contentW, h: Math.round(fontSize * 1.3) },
      style: { fontSize, luminance: 0.1, color: '#111827', bg: '#ffffff', role: fontSize >= 24 ? 'heading' : 'body' },
    };
    nodes.push(node);
    y += fontSize * 1.3 + 4;
    if (y > h) return;
  });
  return {
    schema_version: 1,
    diagram_type: 'layout',
    meta: { title: 'docx import', canvas: { w, h }, source: 'docx', note: 'flow-estimated geometry (no absolute layout in docx)' },
    nodes,
  };
}

function colIdx(ref) {
  const m = /^([A-Z]+)/.exec(ref || '');
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function rowIdx(ref) {
  const m = /(\d+)$/.exec(ref || '');
  return m ? Number(m[1]) - 1 : 0;
}

function importXlsx(buffer) {
  const entries = readZip(buffer);
  const shared = zipEntryText(entries, 'xl/sharedStrings.xml');
  const strings = shared ? findByTag(parseXml(shared), 'si').map((si) => findByTag(si, 't').map(textOf).join('')) : [];
  const sheet = [...entries.keys()].find((n) => /^xl\/worksheets\/sheet1\.xml$/.test(n));
  const xml = sheet ? zipEntryText(entries, sheet) : '';
  const doc = parseXml(xml);

  const COL_W = 96;
  const ROW_H = 22;
  const nodes = [];
  const cells = findByTag(doc, 'c');
  let maxCol = 0;
  let maxRow = 0;
  cells.forEach((c, i) => {
    const ref = c.attrs.r;
    const ci = colIdx(ref);
    const ri = rowIdx(ref);
    maxCol = Math.max(maxCol, ci);
    maxRow = Math.max(maxRow, ri);
    const vEl = findByTag(c, 'v')[0];
    let val = vEl ? vEl.text : '';
    if (c.attrs.t === 's' && val) val = strings[Number(val)] || '';
    val = String(val).trim();
    if (!val) return;
    nodes.push({
      id: `cell-${i}`,
      label: val.slice(0, 40),
      category: `cell-${i}`,
      kind: 'text',
      bbox: { x: ci * COL_W, y: ri * ROW_H, w: COL_W, h: ROW_H },
      style: { fontSize: 13, luminance: 0.1, color: '#111827', bg: '#ffffff', role: 'body' },
    });
  });
  return {
    schema_version: 1,
    diagram_type: 'layout',
    meta: {
      title: 'xlsx import',
      canvas: { w: Math.max(1200, (maxCol + 1) * COL_W), h: Math.max(800, (maxRow + 1) * ROW_H) },
      source: 'xlsx',
      note: 'uniform-cell-grid geometry (real column widths/row heights need rendering)',
    },
    nodes,
  };
}
