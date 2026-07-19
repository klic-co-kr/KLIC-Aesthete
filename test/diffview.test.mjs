import { test, expect } from 'bun:test';
import { diffView, diffHtml } from '../lib/diffview.mjs';
import { defaultContract } from '../lib/contract.mjs';

// a FEASIBLE collision (small nodes, big canvas) — the fixer CAN separate them
const broken = {
  schema_version: 1, diagram_type: 'layout',
  meta: { title: 't', canvas: { w: 600, h: 600 }, source: 'abstract' },
  nodes: [
    { id: 'a', category: 'x', kind: 'box', bbox: { x: 50, y: 50, w: 100, h: 100 }, style: { opacity: 1, bg: '#dc2626', color: '#fff' } },
    { id: 'b', category: 'x', kind: 'box', bbox: { x: 100, y: 100, w: 100, h: 100 }, style: { opacity: 1, bg: '#dc2626', color: '#fff' } },
  ],
};

test('diffView: fixer raises hardIntegrity on a broken layout (0 → 1)', () => {
  const d = diffView(broken, defaultContract(''));
  expect(d.before.hardIntegrityScore).toBeLessThan(d.after.hardIntegrityScore);
  expect(d.after.hardIntegrityScore).toBe(1); // collision+overflow resolved
  expect(d.outcome).toBeTruthy();
});

test('diffView: AFTER svg differs from BEFORE svg when the fixer applies', () => {
  const d = diffView(broken, defaultContract(''));
  expect(d.beforeSvg).not.toBe(d.afterSvg);
  expect(d.beforeSvg).toContain('<svg');
  expect(d.afterSvg).toContain('<svg');
});

test('diffView: both panels pass through the adapter (round-trip), so the diff is fixer-only', () => {
  // before is exportSvg(import) — a valid SVG with the same node count, not the raw source
  const d = diffView(broken, defaultContract(''));
  const beforeRects = (d.beforeSvg.match(/<(rect|circle|ellipse|path)\b/g) || []).length;
  const afterRects = (d.afterSvg.match(/<(rect|circle|ellipse|path)\b/g) || []).length;
  expect(beforeRects).toBe(afterRects); // adapter preserves node count both sides
});

test('diffHtml: produces a self-contained page with both panels + score rows', () => {
  const d = diffView(broken, defaultContract(''));
  const html = diffHtml('test', d);
  expect(html).toContain('<!doctype html>');
  expect(html).toContain('BEFORE');
  expect(html).toContain('AFTER');
  expect(html).toContain('hardIntegrity');
  expect(html).toContain('measuredAesthetic');
  // both SVGs embedded inline
  expect((html.match(/<svg\b/g) || []).length).toBe(2);
});
