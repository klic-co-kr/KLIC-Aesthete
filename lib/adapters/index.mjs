// Domain registry: detect format by extension, import file → ALT, export ALT → format.
// The measurement/fix core never sees these — it only ever sees ALT. Adding a domain =
// adding an adapter pair here. This is the proposal's domain-agnostic-extension seam.

import fs from 'node:fs';
import path from 'node:path';
import * as svg from './svg.mjs';
import * as pptxA from './pptx.mjs';
import * as html from './html.mjs';
import * as image from './image.mjs';
import * as ooxml from './ooxml.mjs';

const EXT_DOMAIN = {
  svg: 'svg',
  html: 'html', htm: 'html',
  pptx: 'pptx',
  docx: 'docx',
  xlsx: 'xlsx',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
  json: 'alt',
};

export function detectDomain(filePath, hint) {
  if (hint) return hint;
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  return EXT_DOMAIN[ext] || 'alt';
}

// file path (any supported domain) → ALT
export function importPath(filePath, opts = {}) {
  const domain = opts.domain || detectDomain(filePath, opts.hint);
  switch (domain) {
    case 'svg': return svg.importSvg(fs.readFileSync(filePath, 'utf8'));
    case 'html': return html.importHtml(fs.readFileSync(filePath, 'utf8'), opts);
    case 'pptx': return pptxA.importPptx(fs.readFileSync(filePath), opts);
    case 'docx':
    case 'xlsx': return ooxml.importOoxml(fs.readFileSync(filePath), opts);
    case 'image': return image.importImage({ imageBuffer: fs.readFileSync(filePath), regions: opts.regions, canvas: opts.canvas });
    case 'alt':
    default: return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
}

// in-memory buffer (for export round-trips) → ALT
export function importBuffer(buffer, domain, opts = {}) {
  switch (domain) {
    case 'svg': return svg.importSvg(buffer.toString('utf8'));
    case 'html': return html.importHtml(buffer.toString('utf8'), opts);
    case 'pptx': return pptxA.importPptx(buffer, opts);
    case 'docx':
    case 'xlsx': return ooxml.importOoxml(buffer, opts);
    case 'image': return image.importImage({ imageBuffer: buffer, regions: opts.regions, canvas: opts.canvas });
    case 'alt':
    default: return JSON.parse(buffer.toString('utf8'));
  }
}

// ALT → domain output. Returns { ext, text? , buffer? }.
export function exportAlt(alt, domain) {
  switch (domain) {
    case 'svg': return { ext: 'svg', text: svg.exportSvg(alt) };
    case 'html': return { ext: 'html', text: html.exportHtml(alt) };
    case 'pptx': return { ext: 'pptx', buffer: pptxA.exportPptx(alt) };
    default: return { ext: 'json', text: JSON.stringify(alt, null, 2) + '\n' };
  }
}

export const SUPPORTED_DOMAINS = ['svg', 'html', 'pptx', 'docx', 'xlsx', 'image', 'alt'];
