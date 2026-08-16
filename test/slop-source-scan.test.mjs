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

test('scan: repeated calls on identical link-bearing input are byte-identical (determinism)', () => {
  const html = `<link rel="stylesheet" href="styles.css">`;
  const a = scanHtmlSource(html);
  const b = scanHtmlSource(html);
  const c = scanHtmlSource(html);
  const d = scanHtmlSource(html);
  expect(a).toEqual(b);
  expect(b).toEqual(c);
  expect(c).toEqual(d);
  expect(a.measuredNotes.length).toBeGreaterThan(0); // the link note must NOT drop on alternating calls
});

// --- tailwind color tokens + body emoji (issue #1: class-attr palette + 본문 이모지 were unscanned) ---

test('scan: tailwind color tokens extracted per class attr (variant prefixes stripped, opacity tolerated)', () => {
  const html = `<div class="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">x</div><p class="hover:text-amber-700/80 dark:bg-sky-900">y</p>`;
  const c = scanHtmlSource(html);
  expect(c.tailwindColorClasses.map((t) => t.token).sort())
    .toEqual(['bg-emerald-100', 'bg-sky-900', 'text-amber-700/80', 'text-emerald-800']);
  expect(c.tailwindColorClasses.map((t) => t.hue).sort()).toEqual(['amber', 'emerald', 'emerald', 'sky']);
  expect(new Set(c.tailwindColorClasses.map((t) => t.attrIndex)).size).toBe(2); // badge div + p — spread is measurable
});

test('scan: non-tailwind and arbitrary-value classes are NOT color tokens (full-token anchor)', () => {
  const c = scanHtmlSource(`<div class="hero text-sm bg-[#6366f1] py-0.5 my-emerald-100 has-text-emerald-100 bg-emerald">x</div>`);
  expect(c.tailwindColorClasses).toEqual([]);
});

test('scan: body emoji captured from text tags; subdivision flags and heading emoji excluded', () => {
  const FLAG = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}';
  const c = scanHtmlSource(`<p>Tab 4회 · 트랩⚠</p><p>Regional: ${FLAG}</p><h1>🚀 heading</h1><span>✅ Done</span>`);
  // ⚠ + ✅ samples; the flag is stripped pre-match (legit national symbol), h1 is not a TEXT_TAG
  expect(c.bodyEmojiSamples.length).toBe(2);
  expect(c.bodyEmojiSamples[0]).toContain('⚠');
});

test('scan: side-tab borders are context-scoped with maxOther (issue #2 — frames/rails carry the asymmetry)', () => {
  const c = scanHtmlSource(`<style>
    .axis-card { border:1px solid var(--line); border-top:3px solid var(--ac); }
    .frame { border-top:3px solid c; border-right:3px solid c; border-bottom:3px solid c; border-left:3px solid c; }
    .card-min { border-top:3px solid #b91c1c; }
    footer { border-top:1px solid #eee; }
  </style><div style="border-top:5px solid #f00">x</div>`);
  // qualifying tabs at the signature's default shape (≥2px one side, others ≤1px), source order
  expect(c.sideTabBorders.filter((b) => b.width >= 2 && b.maxOther <= 1)).toEqual([
    { side: 'top', width: 3, maxOther: 1 }, // .axis-card — hairline frame + accent override
    { side: 'top', width: 3, maxOther: 0 }, // .card-min — standalone bar
    { side: 'top', width: 5, maxOther: 0 }, // inline style
  ]);
  // every frame side sees a thick "other" → the asymmetry data is what keeps it silent
  expect(c.sideTabBorders.filter((b) => b.side === 'top' && b.width === 3 && b.maxOther === 3).length).toBe(1);
  // 1px footer divider is recorded but below every tab floor
  expect(c.sideTabBorders.some((b) => b.width === 1 && b.maxOther === 0)).toBe(true);
});

test('scan: border-width multi-value follows the CSS t/r/b/l expansion', () => {
  const c = scanHtmlSource(`<style>.w { border-width: 1px 3px; }</style>`);
  expect(c.sideTabBorders).toEqual([
    { side: 'top', width: 1, maxOther: 3 },
    { side: 'right', width: 3, maxOther: 3 }, // the opposite side is also 3px — symmetric rails
    { side: 'bottom', width: 1, maxOther: 3 },
    { side: 'left', width: 3, maxOther: 3 },
  ]);
  // symmetric emphasis is not a one-side tab: nothing here passes the ≥2px/hairline-others shape
  expect(c.sideTabBorders.filter((b) => b.width >= 2 && b.maxOther <= 1)).toEqual([]);
});
