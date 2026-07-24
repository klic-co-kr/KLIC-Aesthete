import { test, expect } from 'bun:test';
import { writeZip, readZip, zipEntryText, crc32 } from '../lib/adapters/zip.mjs';
import { parseXml, findByTag, localName, textOf } from '../lib/adapters/xml.mjs';
import { importSvg, exportSvg } from '../lib/adapters/svg.mjs';
import { importHtml, exportHtml } from '../lib/adapters/html.mjs';
import { importPptx, exportPptx } from '../lib/adapters/pptx.mjs';
import { detectOoxmlFlavor } from '../lib/adapters/ooxml.mjs';
import { readImageDimensions, importImage } from '../lib/adapters/image.mjs';
import { detectDomain } from '../lib/adapters/index.mjs';

test('zip: write→read round-trips text entries (stored + deflated)', () => {
  const longText = '<r>' + 'a'.repeat(500) + '</r>';
  const z = writeZip([{ name: 'a.txt', data: 'hello' }, { name: 'b.xml', data: longText }]);
  const e = readZip(z);
  expect(zipEntryText(e, 'a.txt')).toBe('hello');
  expect(zipEntryText(e, 'b.xml')).toBe(longText);
});

// Regression guard for the compMethod offset bug: Aesthete's zip reader/writer once used CD
// offset +8 (the general-purpose FLAGS slot) for the compression method instead of +10. That
// cancelled out in the writeZip→readZip round-trip (both wrong the same way) but broke reading
// EVERY real .pptx (PowerPoint/OfficeCLI deflate every part and put method at the spec +10).
// Asserts writeZip emits method at +10; the round-trip test above then covers readZip.
test('zip: writeZip emits CD compression-method at spec offset +10 (not the +8 flags slot)', () => {
  const z = writeZip([{ name: 'b.xml', data: '<r>' + 'a'.repeat(500) + '</r>' }]); // deflated
  const v = new DataView(z.buffer, z.byteOffset, z.byteLength);
  let eocd = -1;
  for (let i = z.length - 22; i >= 0; i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  const cdOff = v.getUint32(eocd + 16, true);
  expect(v.getUint16(cdOff + 10, true)).toBe(8); // method = deflate at spec offset +10
  expect(v.getUint16(cdOff + 8, true)).toBe(0);  // +8 is flags, not method
});

test('zip: crc32 is deterministic', () => {
  const a = new TextEncoder().encode('abc');
  expect(crc32(a)).toBe(crc32(a));
  expect(crc32(a) > 0).toBeTruthy();
});

test('xml: parses nested tags, attrs, namespaces, text', () => {
  const doc = parseXml('<p:sld><p:sp id="1"><a:t>Hi</a:t></p:sp></p:sld>');
  const sps = findByTag(doc, 'sp');
  expect(sps.length).toBe(1);
  expect(localName(sps[0].tag)).toBe('sp');
  expect(textOf(findByTag(doc, 't')[0])).toBe('Hi');
});

test('svg: import extracts geometry and skips full-canvas background', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
    <rect width="800" height="600" fill="#fff"/>
    <rect width="100%" height="100%" fill="url(#grid)"/>
    <rect x="10" y="10" width="100" height="50" fill="#eee" stroke="#000"/>
    <g transform="translate(200, 100)"><rect x="0" y="0" width="40" height="40"/></g>
    <text x="5" y="20" font-size="24">제목</text>
  </svg>`;
  const alt = importSvg(svg);
  expect(alt.meta.canvas.w).toBe(800);
  // background rect dropped, 3 content nodes remain
  expect(alt.nodes.length).toBe(3);
  const g = alt.nodes.find((n) => n.bbox.x === 200);
  expect(g).toBeTruthy();
  expect(g.bbox.y).toBe(100);
});

test('svg: PowerPoint affine transform lists resolve into canvas coordinates', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 200 100">
    <g transform="translate(30 40) scale(2)">
      <rect id="scaled" x="1" y="2" width="10" height="5" fill="#fff"/>
    </g>
  </svg>`;
  const alt = importSvg(svg);
  expect(alt.nodes).toHaveLength(1);
  expect(alt.nodes[0].bbox).toEqual({ x: 22, y: 24, w: 20, h: 10 });
});

test('svg: non-rendered defs and aria-hidden flattened icons are excluded', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">
    <defs><marker id="arrow"><path d="M0 0 L999 999"/></marker></defs>
    <g aria-hidden="true"><g transform="translate(300 200) scale(.02) translate(0 0)">
      <path d="M0 0 L5000 5000" fill="#000"/>
    </g></g>
    <rect id="card" x="20" y="20" width="100" height="60" fill="#fff"/>
  </svg>`;
  const alt = importSvg(svg);
  expect(alt.nodes).toHaveLength(1);
  expect(alt.nodes[0].id).toBe('card');
});

test('svg: presentation attributes infer shadows, containers, connectors, and anchored text', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">
    <rect x="22" y="22" width="360" height="260" fill="#ccd"/>
    <rect id="panel" x="20" y="20" width="360" height="260" fill="#eef"/>
    <rect id="card" x="40" y="50" width="100" height="80" fill="#fff"/>
    <text id="label" x="90" y="90" text-anchor="middle" font-size="20" fill="#111">Card</text>
    <path id="edge" data-link="a-&gt;b" d="M140 90 L200 90" fill="none" stroke="#111"/>
  </svg>`;
  const alt = importSvg(svg);
  expect(alt.nodes.find((n) => n.id === 'rect-0')?.kind).toBe('decor');
  expect(alt.nodes.find((n) => n.id === 'panel')?.kind).toBe('container');
  expect(alt.nodes.find((n) => n.id === 'card')?.kind).toBe('container');
  expect(alt.nodes.find((n) => n.id === 'edge')?.kind).toBe('decor');
  expect(alt.nodes.find((n) => n.id === 'label')?.bbox).toEqual({
    x: 68,
    y: 74,
    w: 44,
    h: 20,
  });
});

test('svg: an opaque card base survives a later translucent PowerPoint tint layer', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200">
    <rect id="base" x="40" y="40" width="120" height="70" fill="#111"/>
    <rect id="tint" x="40" y="40" width="120" height="70" fill="#0f0" fill-opacity=".3"/>
    <text id="label" x="100" y="78" text-anchor="middle" font-size="16" fill="#fff">Node</text>
  </svg>`;
  const alt = importSvg(svg);
  expect(alt.nodes.find((n) => n.id === 'base')?.kind).toBe('container');
  expect(alt.nodes.find((n) => n.id === 'tint')?.kind).toBe('decor');
});

test('svg: line art is decorative and filled path nodes contain their labels', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">
    <line id="grid" x1="0" y1="100" x2="400" y2="100" stroke="#ddd"/>
    <path id="hit-path" d="M20 20 L380 280" fill="none" stroke="none"/>
    <path id="decision" d="M200 40 L280 100 L200 160 L120 100 Z" fill="#fff" stroke="#111"/>
    <text id="decision-label" x="200" y="106" text-anchor="middle" font-size="16">Decide</text>
    <circle id="set" cx="330" cy="220" r="40" class="c-set" fill-opacity=".85"/>
    <text id="set-label" x="330" y="225" text-anchor="middle" font-size="14">Set</text>
  </svg>`;
  const alt = importSvg(svg);
  expect(alt.nodes.find((n) => n.id === 'grid')?.kind).toBe('decor');
  expect(alt.nodes.find((n) => n.id === 'hit-path')?.kind).toBe('decor');
  expect(alt.nodes.find((n) => n.id === 'decision')?.kind).toBe('container');
  expect(alt.nodes.find((n) => n.id === 'decision-label')?.kind).toBe('text');
  expect(alt.nodes.find((n) => n.id === 'set')?.kind).toBe('container');
});

test('svg: export→import round-trips bbox positions', () => {
  const alt = importSvg(`<svg width="400" height="300"><rect x="10" y="20" width="100" height="50" stroke="#000"/><text x="10" y="40" font-size="20">Hi</text></svg>`);
  const out = exportSvg(alt);
  const back = importSvg(out);
  const r = back.nodes.find((n) => n.shape === 'rect');
  expect(r.bbox.x).toBe(10);
  expect(r.bbox.w).toBe(100);
});

test('svg: circle/ellipse survive export→import (shape preserved, not flattened to <path>)', () => {
  const alt = importSvg(`<svg width="200" height="200">
    <circle cx="60" cy="60" r="40" fill="#3b82f6"/>
    <ellipse cx="140" cy="60" rx="50" ry="20" fill="#ef4444"/>
  </svg>`);
  expect(alt.nodes.length).toBe(2);
  expect(alt.nodes[0].shape).toBe('circle');
  expect(alt.nodes[1].shape).toBe('ellipse');

  const out = exportSvg(alt);
  // export must emit native <circle>/<ellipse>, not a rounded-rect <path> proxy
  expect(/<circle\b/.test(out)).toBe(true);
  expect(/<ellipse\b/.test(out)).toBe(true);
  expect(/<path\b/.test(out)).toBe(false);

  // re-import keeps the same shape — true round-trip fidelity
  const back = importSvg(out);
  expect(back.nodes[0].shape).toBe('circle');
  expect(back.nodes[1].shape).toBe('ellipse');
  expect(back.nodes[0].bbox.w).toBe(80); // r=40 → 80×80
});

test('svg: <path> Bézier flattens to bbox-rect on export (documented limitation)', () => {
  const alt = importSvg(`<svg width="200" height="200"><path d="M10 10 C 20 80, 90 80, 100 10" fill="#22c55e"/></svg>`);
  expect(alt.nodes[0].shape).toBe('path');
  const out = exportSvg(alt);
  // path has no native preserved shape → falls back to a bbox proxy (not a <path> with the original curve)
  expect(/<path\b/.test(out)).toBe(true);
});

test('svg: shapeless box (pptx/alt origin) exports as <rect>, not a <path> proxy', () => {
  // nodes imported from non-svg adapters carry no `shape` — a bbox-only box is a rectangle.
  const alt = {
    schema_version: 1, diagram_type: 'layout',
    meta: { title: 't', canvas: { w: 200, h: 200 }, source: 'pptx' },
    nodes: [{ id: 'a', kind: 'box', bbox: { x: 10, y: 10, w: 80, h: 50 }, style: { bg: '#3b82f6', color: '#111' } }],
  };
  const out = exportSvg(alt);
  expect(/<rect\b/.test(out)).toBe(true);
  expect(/<path\b/.test(out)).toBe(false);
});

test('html: import reads explicit geometry via data-* and inline style', () => {
  const html = `<!doctype html><html><body data-w="1200" data-h="800">
    <div data-x="10" data-y="20" data-w="100" data-h="50" data-category="a">A</div>
    <div style="position:absolute;left:200px;top:100px;width:80px;height:40px">B</div>
  </body></html>`;
  const alt = importHtml(html);
  expect(alt.meta.canvas.w).toBe(1200);
  expect(alt.nodes.length).toBe(2);
  expect(alt.nodes[0].bbox.x).toBe(10);
  expect(alt.nodes[1].bbox.x).toBe(200);
  expect(alt.nodes[1].category).toBe(alt.nodes[1].id); // no data-category → unique
});

test('html: export→import round-trips', () => {
  const alt = importHtml(`<body data-w="600" data-h="400"><div data-x="5" data-y="5" data-w="50" data-h="50" data-kind="box"></div></body>`);
  const back = importHtml(exportHtml(alt));
  expect(back.nodes[0].bbox.x).toBe(5);
  expect(back.meta.canvas.w).toBe(600);
});

test('pptx: export→import round-trips shape geometry', () => {
  const alt = {
    schema_version: 1, diagram_type: 'layout',
    meta: { title: 't', canvas: { w: 960, h: 540 }, source: 'pptx' },
    nodes: [
      { id: 'a', label: 'A', category: 'a', kind: 'text', bbox: { x: 100, y: 100, w: 200, h: 50 }, style: { fontSize: 24, luminance: 0.1, color: '#111', bg: '#fff', role: 'heading' } },
      { id: 'b', label: 'B', category: 'b', kind: 'box', bbox: { x: 400, y: 200, w: 100, h: 100 }, style: { fontSize: 18, luminance: 0.1, color: '#111', bg: '#fff', role: 'body' } },
    ],
  };
  const buf = exportPptx(alt);
  const back = importPptx(buf);
  expect(back.meta.canvas.w).toBe(960);
  expect(back.nodes.length).toBe(2);
  expect(back.nodes[0].bbox.x).toBe(100);
  expect(back.nodes[0].bbox.w).toBe(200);
});

test('ooxml: detects pptx flavor', () => {
  const buf = exportPptx({ schema_version: 1, diagram_type: 'layout', meta: { title: 't', canvas: { w: 960, h: 540 }, source: 'pptx' }, nodes: [] });
  expect(detectOoxmlFlavor(buf)).toBe('pptx');
  expect(detectDomain('foo.pptx')).toBe('pptx');
});

test('image: reads PNG dimensions from header (no browser)', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const dims = readImageDimensions(png);
  expect(dims).toEqual({ w: 2, h: 2 });
});

test('image: import with declared regions', () => {
  const alt = importImage({ imageBuffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'), regions: [{ id: 'r1', label: 'logo', bbox: { x: 0, y: 0, w: 1, h: 1 } }] });
  expect(alt.meta.canvas.w).toBe(2);
  expect(alt.nodes.length).toBe(1);
});

test('registry: detectDomain by extension', () => {
  expect(detectDomain('a.svg')).toBe('svg');
  expect(detectDomain('a.html')).toBe('html');
  expect(detectDomain('a.docx')).toBe('docx');
  expect(detectDomain('a.xlsx')).toBe('xlsx');
  expect(detectDomain('a.png')).toBe('image');
  expect(detectDomain('a.json')).toBe('alt');
  expect(detectDomain('a.unknown')).toBe('alt');
});
