import { test, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { scanSlop } from '../lib/slop.mjs';
import { scanHtmlSource as ctxOf2 } from '../lib/slop/html-source-scan.mjs';
import { foldDecision } from '../lib/skill-decision.mjs';

const FIX = (n) => fs.readFileSync(path.join(import.meta.dir, '..', 'examples', 'slop-html', n), 'utf8');
const alt = { meta: { canvas: { w: 1280, h: 800 } }, nodes: [] };
const scan = (name) => scanSlop({ alt, medium: 'html', html: FIX(name) });

test('FP suite: synthetic slop HTML → P0 measured-fail (gradient + emoji)', () => {
  const r = scan('slop-synthetic.html');
  expect(r.summary.coverage.html).toBe('measured');
  expect(r.summary.byTier.P0).toBeGreaterThanOrEqual(1);
  expect(r.findings.some((f) => f.id === 'slop.palette.gradient')).toBe(true);
});

test('FP suite: legitimate editorial design → ZERO slop findings (no false-positive)', () => {
  const r = scan('legit-editorial.html');
  expect(r.findings.length).toBe(0);
});

test('FP suite: issue #1 a11y-card — candy Tailwind tinting + body emoji fire (deterministic)', () => {
  const r = scan('a11y-card.html');
  const candy = r.findings.find((f) => f.id === 'slop.palette.tailwind-candy');
  expect(candy).toBeTruthy();
  expect(candy.signal).toBe(6); // 2 pill badges × (bg+text) + amber score + amber hint span
  expect(candy.detectionMode).toBe('deterministic');
  const emoji = r.findings.find((f) => f.id === 'slop.decoration.emoji-in-body');
  expect(emoji).toBeTruthy();
  expect(emoji.signal).toBe(1); // 트랩⚠
});

test('FP suite: hand-written Tailwind chrome (neutral + ONE status tint) → ZERO findings', () => {
  // The tailwind-candy FP pin: a page a human Tailwind developer actually writes — slate
  // chrome, one deliberate emerald status note (single attr/hue), legacy-red error text.
  const r = scan('tailwind-legit.html');
  expect(r.findings.length).toBe(0);
});

test('FP suite: side-tab accent borders fire (Impeccable #1 AI-UI tell)', () => {
  const r = scan('side-tab.html');
  expect(r.findings.some((f) => f.id === 'slop.decoration.side-tab-border')).toBe(true);
  // two thick single-side declarations (6px left + 5px top) → signal ≥ 2
  const f = r.findings.find((x) => x.id === 'slop.decoration.side-tab-border');
  expect(f.signal).toBeGreaterThanOrEqual(2);
  // detectionMode stamped (3a)
  expect(f.detectionMode).toBe('deterministic');
});

test('FP suite: issue #2 axis-card — 1px frame + 3px top override fires at P0; 1px footer divider does not', () => {
  const r = scan('axis-card.html');
  const f = r.findings.find((x) => x.id === 'slop.decoration.side-tab-border');
  expect(f).toBeTruthy();
  expect(f.signal).toBe(2); // .axis-card override + .card-min standalone bar; footer 1px stays silent
  expect(f.tier).toBe('P0');
  expect(f.severity).toBe('high');
  expect(f.detectionMode).toBe('deterministic');
});

test('FP suite: motion tells fire (bounce/hover/pulse/marquee/blink — all deterministic)', () => {
  const r = scan('motion-tells.html');
  const ids = ['bounce-easing', 'hover-transform', 'pulse-animation', 'marquee', 'blink-cursor'];
  for (const id of ids) {
    const f = r.findings.find((x) => x.id === `slop.decoration.${id}`);
    expect(f).toBeTruthy();
    expect(f.detectionMode).toBe('deterministic');
  }
});

test('FP suite: var()-indirect gradient → unmeasured, NOT a finding (no false-fail)', () => {
  const r = scan('var-indirect.html');
  expect(r.findings.some((f) => f.id === 'slop.palette.gradient')).toBe(false);
  expect(r.summary.unmeasured.some((u) => u.id === 'slop.palette.gradient')).toBe(true);
});

test('FP suite: var()-indirect gradient → decision human_coverage (escalate, no false-pass/false-fail)', () => {
  const d = foldDecision({
    report: { summary: { hardIntegrityScore: 1, coverageScore: 1 } },
    slopReport: scan('var-indirect.html'),
  });
  expect(d.decision).toBe('human');
  expect(d.reasons.some((r) => r.code.startsWith('SLOP_P0_UNMEASURED'))).toBe(true);
});

test('FP suite: vuln + slop on the same artifact → disjoint findings (H1 dedup)', () => {
  const html = FIX('slop-synthetic.html');
  const sr = scanSlop({ alt, medium: 'html', html });
  // vuln operates on ALT; feed a minimal alt derived presence is out of scope here — assert id sets
  // are conceptually disjoint by construction (slop.* vs vuln ids).
  const slopIds = new Set(sr.findings.map((f) => f.id));
  const vulnIds = new Set(['ai-cliche-palette','hanging-header','even-split','no-focal-point','rainbow-categorical','type-scale-accident','no-spacing-rhythm']);
  for (const id of slopIds) expect(vulnIds.has(id)).toBe(false);
});

test('FP suite: coverageScore:0 → human via GEOMETRY COVERAGE_ZERO (pre-existing), not via slop', () => {
  // v1 boundary: on a non-html medium slop is wholesale unmeasurable (coverage.html='unmeasurable').
  // The human decision here is driven by the PRE-EXISTING coverageScore:0 escalation in
  // skill-decision.mjs (COVERAGE_ZERO), NOT by the slop fold — slop is opt-in HTML-only and does
  // NOT independently escalate on a non-html medium (same boundary as vuln, which also does not
  // escalate an unmeasurable axis). The ONLY slop path to human is the html-measured `var()`-indirect
  // branch, proven by the var()-indirect test above (spec §4 C1).
  const slopReport = scanSlop({ alt, medium: 'svg', html: '' });
  expect(slopReport.summary.coverage.html).toBe('unmeasurable');
  const d = foldDecision({
    report: { summary: { hardIntegrityScore: 1, coverageScore: 0 } },
    slopReport,
  });
  expect(d.decision).toBe('human');
  expect(d.reasons.some((r) => r.code === 'COVERAGE_ZERO')).toBe(true);
});

test('FP suite: non-html slop unmeasurable does NOT force human (v1 boundary — opt-in HTML-only)', () => {
  // Locks the v1 boundary: when geometry coverage is fine (coverageScore:1) but slop is wholesale
  // unmeasurable on a non-html medium, slop MUST NOT escalate to human. A future change that
  // silently flipped this would break the opt-in HTML-only scope. Contrast with the var()-indirect
  // case above, which IS html-measured and DOES escalate (spec §4 C1).
  const slopReport = scanSlop({ alt, medium: 'svg', html: '' });
  expect(slopReport.summary.coverage.html).toBe('unmeasurable');
  expect(slopReport.findings.length).toBe(0);
  const d = foldDecision({
    report: { summary: { hardIntegrityScore: 1, coverageScore: 1 } },
    slopReport,
  });
  expect(d.decision).not.toBe('human');
  expect(d.decision).toBe('pass');
});

// Recursion guard: the smoke test below spawns `bun test ... test/slop-fp.test.mjs`, which would
// re-run this very test and recurse unboundedly (bun's 5s test timeout masks it as failure). The
// guard sets an env var in the subprocess; the subprocess skips its own smoke test, terminating
// the recursion at depth 1. Verbatim subprocess list and test intent preserved.
const RECURSE = process.env.AESTHETE_FP_RECURSE === '1';
(test.skipIf(RECURSE))('FP suite: full suite still green', async () => {
  // smoke: the new fixtures don't break existing measure/golden
  const { execSync } = await import('node:child_process');
  let out;
  // NOTE: bun routes the test summary ("N pass") to stderr; merge with `2>&1` so the assertion
  // below can see it. (Out-of-the-box execSync returns only stdout.)
  try { out = execSync('AESTHETE_FP_RECURSE=1 bun test test/slop-signatures.test.mjs test/slop-fold.test.mjs test/slop-integration.test.mjs test/slop-fp.test.mjs 2>&1', { encoding: 'utf8' }); }
  catch (e) { out = e.stdout || ''; throw new Error('slop suite failed:\n' + out); }
  expect(out).toMatch(/pass/);
});

// --- hidden-carrier (watermarks-remover Layer A port): integration + deterministic removal ---
import { stripCarriers } from '../lib/slop.mjs';

test('FP suite: hidden-carrier — scanSlop integration fires deterministic P2 finding on tag char', () => {
  const html = `<p>clean text</p><p>marked \u{E0001}text</p>`;
  const r = scanSlop({ alt, medium: 'html', html });
  const f = r.findings.find((x) => x.id === 'slop.copy.hidden-carrier');
  expect(f).toBeTruthy();
  expect(f.detectionMode).toBe('deterministic');
  expect(f.severity).toBe('medium');
  expect(f.tier).toBe('P2');
});

test('FP suite: hidden-carrier — clean html has NO carrier finding', () => {
  const r = scan('legit-editorial.html');
  expect(r.findings.some((x) => x.id === 'slop.copy.hidden-carrier')).toBe(false);
});

test('FP suite: hidden-carrier — stripCarriers strips fired classes, keeps sub-threshold + legit chars', () => {
  const TAG = 'a\u{E0001}b', BIDI = 'x\u202Dy', ZWSP = 'z\u200Bz';
  const LEGIT = '\u{1F468}\u200D\u{1F469} \u0646\u06CC\u200C\u0645\u06A9\u0627\u0646\u0647 so\xADftly \uF015\uFE0F';
  const html = `<p>${TAG}${BIDI}${ZWSP}${ZWSP}${ZWSP}</p><p>${LEGIT}</p>`;
  const { html: out, removed, kept } = stripCarriers(html);
  expect(removed.hard).toBe(2);      // tag char + bidi override — hard tier fired (2 >= 1)
  expect(removed.zwsp).toBe(0);      // 3 ZWSP < minZwsp 5 — sub-threshold, left in place
  expect(kept.zwsp).toBe(3);
  expect(out).not.toMatch(/[\u{E0001}\u202D]/);
  expect((out.match(/\u200B/g) || []).length).toBe(3); // sub-threshold ZWSP survives
  expect(out).toContain(LEGIT);      // emoji ZWJ, ZWNJ, soft hyphen, PUA, VS16 untouched
});

test('FP suite: hidden-carrier — stripCarriers is byte-identity on clean html', () => {
  const src = FIX('legit-editorial.html');
  const { html: out, removed } = stripCarriers(src);
  expect(out).toBe(src);
  expect(removed.hard + removed.zwsp).toBe(0);
});

test('FP suite: hidden-carrier — strip → re-scan clears the finding (closed loop)', () => {
  const html = `<p>marked \u{E0001} text with ​​​ payload</p>`;
  const before = scanSlop({ alt, medium: 'html', html });
  expect(before.findings.some((x) => x.id === 'slop.copy.hidden-carrier')).toBe(true);
  const { html: cleaned } = stripCarriers(html);
  const after = scanSlop({ alt, medium: 'html', html: cleaned });
  expect(after.findings.some((x) => x.id === 'slop.copy.hidden-carrier')).toBe(false);
});

test('FP suite: hidden-carrier — stripCarriers preserves leading BOM (encoding signature) and bidi isolates', () => {
  const src = '\uFEFF<p>x\u202Dy</p><p>\u2066rtl\u2069</p>';
  const { html: out, removed } = stripCarriers(src);
  expect(out.startsWith('\uFEFF')).toBe(true);          // leading BOM kept
  expect(removed.hard).toBe(1);                          // mid-text bidi override stripped
  expect(out).toContain('\u2066rtl\u2069');            // isolates NOT stripped (direction-bearing)
});

test('FP suite: multilingual-legit.html (RTL runs, flags, URL-ZWSP, WJ, ZWNJ, SHY, PUA) → ZERO findings', () => {
  const r = scan('multilingual-legit.html');
  expect(r.findings.length).toBe(0);
});

test('FP suite: stripCarriers on multilingual-legit is a byte-identity no-op (nothing reaches threshold)', () => {
  const src = FIX('multilingual-legit.html');
  const { html: out, removed } = stripCarriers(src);
  expect(out).toBe(src);                             // zero classes reach threshold → NO mutation at all
  expect(removed.hard + removed.zwsp + removed.wj).toBe(0);
});

test('FP suite: sub-threshold page (1 legit WJ + 4 ZWSP, scanner says clean) is NOT mutated', () => {
  const src = '<p>see Fig\u20601</p><p>a\u200Bb\u200Bc\u200Bd\u200Be</p>';
  const { html: out, removed, kept } = stripCarriers(src);
  expect(out).toBe(src);                             // wj 1 < 3, zwsp 4 < 5 → clean page stays byte-identical
  expect(removed.hard + removed.zwsp + removed.wj).toBe(0);
  expect(kept.wj).toBe(1);
  expect(kept.zwsp).toBe(4);
});

test('FP suite: protected-block carriers open no gate — script/style residue is manual-only (round-2 regression)', () => {
  // 5 ZWSP inside <style>: scanner counts full source → fires; strip gate counts STRIPPABLE
  // text only → gate closed → nothing removed, kept reports the manual-only residue.
  const html = '<style>p::after{content:"a​b​c​d​e​f"}</style><p>clean</p>';
  const r = scanSlop({ alt, medium: 'html', html });
  expect(r.findings.some((f) => f.id === 'slop.copy.hidden-carrier')).toBe(true);
  const { html: out, removed, kept } = stripCarriers(html);
  expect(removed.hard + removed.zwsp + removed.wj).toBe(0); // no gate → no mutation
  expect(out).toBe(html);
  expect(kept.zwsp).toBe(5); // audit reconstructs the scanner count
});

test('FP suite: <SCRIPT>-internal carriers must not open the gate and strip outside carriers (round-2 regression)', () => {
  // uppercase <SCRIPT> with 5 ZWSP + one ZWSP in a <p>: strippable zwsp = 1 < 5 → gate
  // closed → the <p> carrier survives too (fixes the inverted variant).
  const html = '<SCRIPT>var s = "a​b​c​d​e";</SCRIPT><p>one​ stray</p>';
  const { html: out, removed } = stripCarriers(html);
  expect(removed.hard + removed.zwsp + removed.wj).toBe(0);
  expect(out).toBe(html);
});

test('FP suite: kept reconstructs scanner count — URL-spare + removed-RLO reclassification (round-2 regression)', () => {
  // ZWSP preceded by a soon-to-be-removed RLO must NOT be misread as URL-spared (ZWSP pass
  // runs before hard removal, so its lookback sees the original predecessor).
  const shifted = '<p>/‮​x a​b​c​d​e​f</p>';
  const s1 = stripCarriers(shifted);
  expect(s1.removed.zwsp).toBe(6);
  expect(s1.kept.zwsp).toBe(0);
  // 6 counted ZWSP of which 1 sits directly after '/': removed 5, kept 1 (audit adds up).
  const urlSpare = '<p>a​b​c​d​e​f and /​spared</p>';
  const s2 = stripCarriers(urlSpare);
  expect(s2.removed.zwsp).toBe(5);
  expect(s2.kept.zwsp).toBe(1);
});

test('FP suite: unclosed <script> protects to EOF (round-2 regression)', () => {
  const html = '<script>const pw = "a\u{E0001}b"; // unclosed';
  const { html: out, removed, kept } = stripCarriers(html);
  expect(removed.hard).toBe(0);
  expect(out).toBe(html);
  expect(kept.hard).toBe(1);
});

test('FP suite: fake flag payload is strippable, real flag is not (letters-only carve-out)', () => {
  const REAL = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}';
  const FAKE = '\u{1F3F4}\u{E0041}\u{E0042}\u{E0043}\u{E007F}';
  const { html: out, removed } = stripCarriers(`<p>${REAL}${FAKE}</p>`);
  expect(out).toContain(REAL);                  // real England flag preserved
  expect(out).not.toContain(FAKE);              // fake payload stripped
  expect(removed.hard).toBe([...FAKE].length - 1); // payload + cancel tag chars, astral base preserved
});

test('FP suite: entity note — hex tag 5-digit fires the note, PUA hex does NOT', () => {
  const tag = ctxOf2('<p>a&#xE0041;b</p>');
  const pua = ctxOf2('<p>&#xE041;</p>');
  expect(tag.measuredNotes.some((n) => /entity-encoded carrier/.test(n))).toBe(true);
  expect(pua.measuredNotes.some((n) => /entity-encoded carrier/.test(n))).toBe(false);
});
