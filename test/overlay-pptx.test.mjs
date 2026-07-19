import { test, expect } from 'bun:test';
import { exportPptx, importPptx } from '../lib/adapters/pptx.mjs';
import { exportPatches, spOfficePaths } from '../lib/overlay/pptx.mjs';
import { pxToEmu } from '../lib/adapters/emu.mjs';

const alt = (nodes) => ({
  meta: { canvas: { w: 960, h: 540 }, source: 'abstract' },
  nodes,
});
const box = (id, x, y, w, h) => ({ id, label: id, category: id, kind: 'box', bbox: { x, y, w, h }, style: {} });

test('spOfficePaths: <p:sp> indices diverge from sp-order when pics are interspersed', () => {
  // spTree: sp, pic, sp → officecli shape indices 1, (2=pic), 3; sp-order 0,1
  const slideXml = `<p:sld><p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    <p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9525" cy="9525"/></a:xfrm></p:spPr></p:sp>
    <p:pic><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9525" cy="9525"/></a:xfrm></p:spPr></p:pic>
    <p:sp><p:spPr><a:xfrm><a:off x="9525" y="0"/><a:ext cx="9525" cy="9525"/></a:xfrm></p:spPr></p:sp>
  </p:spTree></p:cSld></p:sld>`;
  const paths = spOfficePaths(slideXml);
  expect(paths.length).toBe(2);
  expect(paths.map((p) => p.shapeIdx)).toEqual([1, 3]); // pic at index 2 skipped for sp, but COUNTED
});

test('exportPatches: a moved shape → one set-patch with the right OfficeCLI path + EMU', () => {
  const original = alt([box('sp-0', 100, 100, 200, 100), box('sp-1', 500, 200, 200, 100)]);
  const buf = exportPptx(original);            // minimal pptx (the "original")
  const imported = importPptx(buf);            // nodes sp-0, sp-1 (px bboxes round-trip)
  // simulate a fix: move sp-1 right by 50px (a collision/boundary shift)
  imported.nodes[1].bbox = { ...imported.nodes[1].bbox, x: imported.nodes[1].bbox.x + 50 };

  const manifest = exportPatches(buf, imported);

  expect(manifest.domain).toBe('pptx');
  expect(manifest.engine).toBe('officecli');
  expect(manifest.slide).toBe(1);
  expect(manifest.patches.length).toBe(1);
  const p = manifest.patches[0];
  expect(p.op).toBe('set');
  expect(p.path).toBe('/slide[1]/shape[2]');   // sp-1 is the 2nd shape (1-based)
  expect(p.props.x).toBe(pxToEmu(imported.nodes[1].bbox.x));
  expect(p.props.y).toBe(pxToEmu(imported.nodes[1].bbox.y));
  expect(p.props.w).toBeUndefined();            // size unchanged → no w/h
});

test('exportPatches: unchanged layout → zero patches', () => {
  const original = alt([box('sp-0', 100, 100, 200, 100), box('sp-1', 500, 200, 200, 100)]);
  const buf = exportPptx(original);
  const imported = importPptx(buf);
  expect(exportPatches(buf, imported).patches.length).toBe(0);
});

test('exportPatches: ABORTS on alt/pptx mismatch (positional count check)', () => {
  const original = alt([box('sp-0', 100, 100, 200, 100), box('sp-1', 500, 200, 200, 100)]);
  const buf = exportPptx(original);
  const imported = importPptx(buf);
  imported.nodes.pop();                         // alt no longer matches this pptx slide
  expect(() => exportPatches(buf, imported)).toThrow(/sp count.*≠.*node count|positional/i);
});

test('exportPatches: resize emits w/h too (size prop, EMU)', () => {
  const original = alt([box('sp-0', 100, 100, 200, 100)]);
  const buf = exportPptx(original);
  const imported = importPptx(buf);
  imported.nodes[0].bbox = { ...imported.nodes[0].bbox, w: 300 };  // widen
  const p = exportPatches(buf, imported).patches[0];
  expect(p.path).toBe('/slide[1]/shape[1]');
  expect(p.props.w).toBe(pxToEmu(300));
});
