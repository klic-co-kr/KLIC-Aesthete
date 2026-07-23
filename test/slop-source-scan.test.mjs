import { test, expect } from 'bun:test';
import { scanHtmlSource } from '../lib/slop/html-source-scan.mjs';

test('scan: extracts literal gradient + glass + keyframes from <style>', () => {
  const html = `<style>
    .h { background: linear-gradient(135deg,#6366f1,#ec4899); }
    .g { backdrop-filter: blur(8px); }
    @keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
  </style>`;
  const c = scanHtmlSource(html);
  expect(c.gradientsLiteral.length).toBe(1);
  expect(c.glassLiteral.length).toBe(1);
  expect(c.animationSignals).toContain('rotate');
});

test('scan: extracts inline style gradient + headings text', () => {
  const html = `<h1>Launch 🚀 now</h1><h2>Ship</h2><p>delve into robust</p>`;
  const c = scanHtmlSource(html);
  expect(c.headings.length).toBe(2);
  expect(c.headings[0].text).toContain('🚀');
  expect(c.textSamples.some((t) => /delve/.test(t))).toBe(true);
});

test('scan: var()-indirect gradient is flagged unmeasurable, not clean', () => {
  const html = `<style>.h { background: linear-gradient(var(--brand-a), var(--brand-b)); }</style>`;
  const c = scanHtmlSource(html);
  expect(c.gradientVarIndirect).toBe(true);
  expect(c.measuredNotes.some((n) => /var\(\)/.test(n))).toBe(true);
});

test('scan: svg icon count + trusted-by presence', () => {
  const html = `<svg class="lucide lucide-x"></svg><svg></svg><p>Trusted by Acme</p>`;
  const c = scanHtmlSource(html);
  expect(c.svgIconCount).toBe(2);
  expect(c.hasTrustedBy).toBe(true);
});

test('scan: does NOT parse external <link> cascade (unmeasured note)', () => {
  const html = `<link rel="stylesheet" href="styles.css">`;
  const c = scanHtmlSource(html);
  expect(c.measuredNotes.some((n) => /external|link|cascade/i.test(n))).toBe(true);
});

test('scan: empty input is safe (no throw, empty ctx)', () => {
  const c = scanHtmlSource('');
  expect(c.gradientsLiteral).toEqual([]);
  expect(c.svgIconCount).toBe(0);
});
