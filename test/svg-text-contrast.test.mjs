import { test, expect } from 'bun:test';
import { importSvg } from '../lib/adapters/svg.mjs';
import { measureAlt } from '../lib/measure.mjs';
import { contrastRatio } from '../lib/color.mjs';

// ALT color contract (set by lib/adapters/html.mjs): style.color = FOREGROUND, style.bg = BACKDROP.
// The svg adapter used to put a <text> element's glyph fill into style.bg and default style.color
// to '#111827', so lib/skills/hierarchy.mjs compared a constant against the glyph color — every
// SVG import failed WCAG contrast even when the text was perfectly legible.

const byId = (alt, id) => alt.nodes.find((n) => n.id === id);
const textNode = (alt) => alt.nodes.find((n) => n.kind === 'text');

test('svg text: glyph fill lands in style.color (foreground), not style.bg', () => {
  const alt = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200">
    <text x="20" y="100" font-size="16" fill="#0f172a">legible body copy</text>
  </svg>`);
  const t = textNode(alt);
  expect(t.style.color).toBe('#0f172a');
  expect(t.style.bg).not.toBe('#0f172a');
});

test('svg text: bg resolves to the page backdrop when no card encloses the text', () => {
  const alt = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200">
    <rect width="400" height="200" fill="#ffffff"/>
    <text x="20" y="100" font-size="16" fill="#0f172a">on the page</text>
  </svg>`);
  const t = textNode(alt);
  expect(t.style.bg).toBe('#ffffff');
  // real contrast of #0f172a on #ffffff is ~17:1 — must read as legible
  expect(contrastRatio(t.style.color, t.style.bg)).toBeGreaterThan(4.5);
});

test('svg text: a non-white page backdrop is used, not a hardcoded white', () => {
  const alt = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200">
    <rect width="400" height="200" fill="#0b1120"/>
    <text x="20" y="100" font-size="16" fill="#e5e7eb">dark mode copy</text>
  </svg>`);
  const t = textNode(alt);
  expect(t.style.bg).toBe('#0b1120');
  expect(contrastRatio(t.style.color, t.style.bg)).toBeGreaterThan(4.5);
});

test('svg text: bg resolves to the enclosing card fill (painter-order stack)', () => {
  const alt = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
    <rect width="400" height="400" fill="#ffffff"/>
    <rect id="card" x="40" y="40" width="200" height="120" fill="#1d4ed8"/>
    <text id="onCard" x="60" y="110" font-size="16" fill="#ffffff">on the card</text>
    <text id="onPage" x="60" y="300" font-size="16" fill="#111827">on the page</text>
  </svg>`);
  expect(byId(alt, 'onCard').style.bg).toBe('#1d4ed8');
  expect(byId(alt, 'onPage').style.bg).toBe('#ffffff');
});

test('svg text: a card painted AFTER the text is not its backdrop (painter order respected)', () => {
  const alt = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
    <rect width="400" height="400" fill="#ffffff"/>
    <text id="under" x="60" y="110" font-size="16" fill="#111827">painted first</text>
    <rect id="later" x="40" y="40" width="200" height="120" fill="#1d4ed8"/>
  </svg>`);
  expect(byId(alt, 'under').style.bg).toBe('#ffffff');
});

test('svg text: a stroke-only (unfilled) shape beneath the text is not a backdrop', () => {
  const alt = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
    <rect width="400" height="400" fill="#ffffff"/>
    <rect id="outline" x="40" y="40" width="200" height="120" fill="none" stroke="#1d4ed8"/>
    <text id="inOutline" x="60" y="110" font-size="16" fill="#111827">inside an outline box</text>
  </svg>`);
  expect(byId(alt, 'inOutline').style.bg).toBe('#ffffff');
});

test('svg text: partial overlap is not containment — falls back to the page backdrop', () => {
  const alt = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
    <rect width="400" height="400" fill="#ffffff"/>
    <rect id="card" x="40" y="40" width="60" height="120" fill="#1d4ed8"/>
    <text id="spill" x="60" y="110" font-size="16" fill="#111827">this text runs past the card edge</text>
  </svg>`);
  expect(byId(alt, 'spill').style.bg).toBe('#ffffff');
});

test('svg non-text shapes keep own fill in style.bg (a rect fill IS its background)', () => {
  const alt = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200">
    <rect id="card" x="10" y="10" width="100" height="60" fill="#f47974"/>
  </svg>`);
  expect(byId(alt, 'card').style.bg).toBe('#f47974');
});

test('svg text: optical weight (luminance) still derives from the glyph fill, not the backdrop', () => {
  const alt = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200">
    <rect width="400" height="200" fill="#ffffff"/>
    <text x="20" y="100" font-size="16" fill="#000000">heavy black glyphs</text>
  </svg>`);
  // convention (lib/color.mjs): luminance 0 = white, 1 = black. Black glyphs are HEAVY.
  expect(textNode(alt).style.luminance).toBeGreaterThan(0.9);
});

test('integration: the clean reference SVG no longer fails hierarchy on contrast', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
    <rect width="1200" height="800" fill="#ffffff"/>
    <rect x="80" y="60" width="1040" height="260" fill="#60a5fa"/>
    <text x="80" y="350" font-size="22" fill="#0f172a">HERO</text>
    <text x="80" y="420" font-size="14" fill="#0f172a">supporting body copy</text>
  </svg>`;
  const report = measureAlt(importSvg(svg));
  expect(report.skills.hierarchy.metrics.contrastAdequacy).toBe(1);
});

// ---------------------------------------------------------------------------
// Regression: moving the glyph fill out of style.bg must NOT blind the palette
// consumers. harmony/similarity/symmetry/vuln read a node's OWN color, which for
// a text node is its foreground — not the surface behind it.
// ---------------------------------------------------------------------------

test('regression: clashing text colors in one group stay visible to similarity', () => {
  // two headings, same category, same size, on the same white card — only the glyph color differs
  const alt = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
    <rect width="600" height="400" fill="#ffffff"/>
    <rect x="20" y="20" width="560" height="300" fill="#ffffff"/>
    <text x="40" y="80" font-size="24" fill="#dc2626" data-category="hdr">Red heading</text>
    <text x="40" y="160" font-size="24" fill="#1d4ed8" data-category="hdr">Navy heading</text>
  </svg>`);
  const r = measureAlt(alt);
  expect(r.skills.similarity.metrics.inconsistentGroups).toBeGreaterThan(0);
});

test('regression: text glyph hues still reach the harmony color wheel', () => {
  const alt = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
    <rect width="600" height="400" fill="#ffffff"/>
    <text x="40" y="80" font-size="24" fill="#dc2626">Red heading</text>
    <text x="40" y="160" font-size="24" fill="#1d4ed8">Navy heading</text>
  </svg>`);
  expect(measureAlt(alt).skills.harmony.metrics.distinctHues).toBeGreaterThan(0);
});
