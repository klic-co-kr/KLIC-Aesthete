import { test, expect } from 'bun:test';
import { regionsToNodes } from '../lib/hooks/region-provider.mjs';
import { importHtml } from '../lib/adapters/html.mjs';
import { importImage } from '../lib/adapters/image.mjs';

test('regionsToNodes: filters zero-dim, normalizes bbox aliases, defaults style', () => {
  const regions = [
    { x: 10, y: 20, w: 100, h: 50 },
    { bbox: { x: 0, y: 0, w: 30, h: 30 }, label: 'icon', kind: 'image' },
    { x: 0, y: 0, width: 0, height: 0 }, // zero → dropped
  ];
  const nodes = regionsToNodes(regions);
  expect(nodes.length).toBe(2);
  expect(nodes[0].bbox).toEqual({ x: 10, y: 20, w: 100, h: 50 });
  expect(nodes[0].id).toBe('region-0');
  expect(nodes[0].style.role).toBe('decor');
  expect(nodes[1].label).toBe('icon');
  expect(nodes[1].kind).toBe('image');
  expect(nodes[1].shape).toBe('rect');
});

test('importHtml: consumes opts.regions (render-hook path) instead of parsing absolute coords', () => {
  // flex layout — the pure-JS parse finds 0 nodes (no absolute coords); the regions (from a
  // browser hook) carry the rendered bboxes.
  const html = '<html><body><div style="display:flex;gap:8px"><span>A</span><span>B</span></div></body></html>';
  const regions = [
    { x: 0, y: 0, w: 40, h: 20, label: 'A' },
    { x: 48, y: 0, w: 40, h: 20, label: 'B' },
  ];
  const alt = importHtml(html, { regions, canvas: { w: 1280, h: 720 } });
  expect(alt.nodes.length).toBe(2);
  expect(alt.nodes.map((n) => n.label)).toEqual(['A', 'B']);
  expect(alt.meta.canvas).toEqual({ w: 1280, h: 720 });
  expect(alt.meta.title).toMatch(/rendered regions/);
});

test('importHtml: without regions, falls back to the absolute-coord parse (existing behavior)', () => {
  const html = '<html><body data-w="100" data-h="100"><div data-x="10" data-y="10" data-w="20" data-h="20">A</div></body></html>';
  const alt = importHtml(html);
  expect(alt.nodes.length).toBe(1);
  expect(alt.nodes[0].bbox.x).toBe(10);
});

test('importImage: regions → nodes via the shared normalizer', () => {
  const alt = importImage({ canvas: { w: 100, h: 100 }, regions: [{ x: 0, y: 0, w: 50, h: 50, label: 'r' }] });
  expect(alt.nodes.length).toBe(1);
  expect(alt.nodes[0].label).toBe('r');
  expect(alt.nodes[0].shape).toBe('rect');
});

test('sam-hook: no endpoint configured → [] (graceful fallback, no throw)', async () => {
  const { imageRegions } = await import('../lib/hooks/sam-hook.mjs');
  delete process.env.SAM_ENDPOINT;
  expect(await imageRegions(Buffer.from('x'))).toEqual([]);
});
