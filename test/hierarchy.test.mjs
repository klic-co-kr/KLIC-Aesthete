import { test, expect } from 'bun:test';
import hierarchy from '../lib/skills/hierarchy.mjs';

// WCAG 2.1 AA (W3C) text contrast has TWO thresholds, not one:
//   small text            → 4.5:1
//   large text (≥24px, or ≥18px bold) → 3:1
// The skill applied 4.5:1 flat, so legitimate large display type read as a contrast failure.
// The ≥18px-BOLD branch stays unmeasurable while ALT carries no fontWeight — documented, not faked.

const text = (id, fontSize, color, bg) => ({
  id, kind: 'text', bbox: { x: 0, y: 0, w: 100, h: fontSize },
  style: { fontSize, color, bg, opacity: 1, role: 'body' },
});
const alt = (nodes) => ({
  schema_version: 1, diagram_type: 'layout',
  meta: { title: 't', canvas: { w: 500, h: 500 }, source: 'abstract' }, nodes,
});

// #757575 on #ffffff ≈ 4.6:1  |  #949494 on #ffffff ≈ 3.1:1  |  #b0b0b0 on #ffffff ≈ 2.2:1

test('hierarchy: small text at ~3:1 is a contrast shortfall (needs 4.5:1)', () => {
  const r = hierarchy.measure(alt([text('a', 16, '#949494', '#ffffff')]));
  expect(r.metrics.contrastAdequacy).toBeLessThan(1);
});

test('hierarchy: small text at ~4.6:1 satisfies the 4.5:1 requirement', () => {
  const r = hierarchy.measure(alt([text('a', 16, '#757575', '#ffffff')]));
  expect(r.metrics.contrastAdequacy).toBe(1);
});

test('hierarchy: LARGE text (≥24px) at ~3:1 satisfies the large-text 3:1 exemption', () => {
  const r = hierarchy.measure(alt([text('a', 24, '#949494', '#ffffff')]));
  expect(r.metrics.contrastAdequacy).toBe(1);
});

test('hierarchy: large text below 3:1 is still a shortfall', () => {
  const r = hierarchy.measure(alt([text('a', 32, '#b0b0b0', '#ffffff')]));
  expect(r.metrics.contrastAdequacy).toBeLessThan(1);
});

test('hierarchy: 18px regular is NOT large text — still held to 4.5:1', () => {
  // WCAG's 18px threshold applies to BOLD only; ALT carries no fontWeight, so regular is assumed.
  const r = hierarchy.measure(alt([text('a', 18, '#949494', '#ffffff')]));
  expect(r.metrics.contrastAdequacy).toBeLessThan(1);
});

test('hierarchy: mixed sizes are graded per-node against their own threshold', () => {
  // 32px at 3:1 passes (large), 14px at 3:1 falls short (small) → partial adequacy, not 0 or 1
  const r = hierarchy.measure(alt([
    text('big', 32, '#949494', '#ffffff'),
    text('small', 14, '#949494', '#ffffff'),
  ]));
  expect(r.metrics.contrastAdequacy).toBeGreaterThan(0);
  expect(r.metrics.contrastAdequacy).toBeLessThan(1);
});

test('hierarchy: no fg/bg pair → contrast dimension unmeasured, not scored as a failure', () => {
  const r = hierarchy.measure(alt([
    { id: 'a', kind: 'text', bbox: { x: 0, y: 0, w: 10, h: 10 }, style: { fontSize: 16, role: 'body' } },
  ]));
  expect(r.metrics.contrastAdequacy).toBe(1);
  expect(r.coverage).toBe('unmeasurable');
});

test('hierarchy: one dimension measurable and one not → coverage partial, not measured', () => {
  // Two font sizes make stepRegularity real, but no node carries fg/bg so contrastAdequacy is a
  // default. Reporting that as fully `measured` is the "measured vs unmeasurable" conflation the
  // coverage field exists to prevent — and it is how PPTX imports look, since
  // lib/adapters/pptx.mjs does not read run colors.
  const r = hierarchy.measure(alt([
    { id: 'a', kind: 'text', label: 'Quarterly revenue', bbox: { x: 0, y: 0, w: 200, h: 18 },
      style: { fontSize: 18, luminance: 0.1, role: 'body' } },
    { id: 'b', kind: 'text', label: 'Second line', bbox: { x: 0, y: 40, w: 200, h: 24 },
      style: { fontSize: 24, luminance: 0.1, role: 'heading' } },
  ]));
  expect(r.coverage).toBe('partial');
  expect(r.metrics.contrastAdequacy).toBe(1); // a default, not a pass
});

test('hierarchy: contrast measurable but only one font size → also partial', () => {
  const r = hierarchy.measure(alt([text('a', 16, '#757575', '#ffffff')]));
  expect(r.coverage).toBe('partial');
});

test('hierarchy: both dimensions present → measured', () => {
  const r = hierarchy.measure(alt([
    text('a', 16, '#757575', '#ffffff'), text('b', 32, '#111827', '#ffffff'),
  ]));
  expect(r.coverage).toBe('measured');
});
