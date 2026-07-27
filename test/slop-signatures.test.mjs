import { test, expect } from 'bun:test';
import { SIGNATURES as PALETTE } from '../lib/slop/signatures/palette.mjs';
import { SIGNATURES as DECO } from '../lib/slop/signatures/decoration.mjs';
import { scanHtmlSource } from '../lib/slop/html-source-scan.mjs';

const ctxOf = (html) => scanHtmlSource(html);
const detect = (sig, html, t = {}) => sig.detect(ctxOf(html), t);

test('palette.gradient: cliché indigo→pink fires (P0 high)', () => {
  const sig = PALETTE.find((s) => s.id === 'slop.palette.gradient');
  const html = `<style>.h{background:linear-gradient(135deg,#6366f1,#ec4899)}</style>`;
  const f = detect(sig, html);
  expect(f).toBeTruthy();
  expect(f.unmeasured).not.toBe(true);
  expect(sig.tier).toBe('P0');
  expect(sig.severity).toBe('high');
});

test('palette.gradient: legitimate warm-neutral gradient does NOT fire P0', () => {
  const sig = PALETTE.find((s) => s.id === 'slop.palette.gradient');
  const html = `<style>.h{background:linear-gradient(90deg,#f5f0e6,#e8dcc8)}</style>`;
  const f = detect(sig, html);
  // no cliché stop → no P0 finding (null)
  expect(f).toBeNull();
});

test('palette.gradient: var()-indirect gradient → unmeasured (never false-fail)', () => {
  const sig = PALETTE.find((s) => s.id === 'slop.palette.gradient');
  const html = `<style>.h{background:linear-gradient(var(--a),var(--b))}</style>`;
  const f = detect(sig, html);
  expect(f && f.unmeasured).toBe(true);
});

test('palette.glass: backdrop-filter literal fires (P1)', () => {
  const sig = PALETTE.find((s) => s.id === 'slop.palette.glass');
  const html = `<style>.g{backdrop-filter:blur(8px)}</style>`;
  const f = detect(sig, html);
  expect(f).toBeTruthy();
  expect(sig.tier).toBe('P1');
});

test('palette.gradient-border: gradient on border side OR border-image fires (card top bar / callout left rail tell)', () => {
  const sig = PALETTE.find((s) => s.id === 'slop.palette.gradient-border');
  // direct gradient on border-top
  expect(sig.detect(ctxOf(`<style>.card{border-top:linear-gradient(90deg,#f00,#00f)}</style>`), {})).toBeTruthy();
  // two-line idiom: solid border-top + border-image gradient
  expect(sig.detect(ctxOf(`<style>.card{border-top:4px solid;border-image:linear-gradient(red,blue) 1}</style>`), {})).toBeTruthy();
  // border-image-source gradient
  expect(sig.detect(ctxOf(`<style>x{border-image-source:radial-gradient(red,blue)}</style>`), {})).toBeTruthy();
  // FP guard: plain solid border-top (no gradient) does NOT fire
  expect(sig.detect(ctxOf(`<style>.card{border-top:4px solid #ccc}</style>`), {})).toBeNull();
  // FP guard: background gradient (not border) does NOT fire — palette.gradient handles that
  expect(sig.detect(ctxOf(`<style>.hero{background:linear-gradient(red,blue)}</style>`), {})).toBeNull();
  expect(sig.tier).toBe('P1');
});

test('decoration.emoji-in-heading: emoji inside h1 fires (P0)', () => {
  const sig = DECO.find((s) => s.id === 'slop.decoration.emoji-in-heading');
  const f = sig.detect(ctxOf(`<h1>Ship 🚀 faster</h1>`), {});
  expect(f).toBeTruthy();
  expect(sig.tier).toBe('P0');
});

test('decoration.emoji-in-heading: emoji in body paragraph does NOT fire', () => {
  const sig = DECO.find((s) => s.id === 'slop.decoration.emoji-in-heading');
  const f = sig.detect(ctxOf(`<p>see 🚀 below</p>`), {});
  expect(f).toBeNull();
});

test('decoration.icon-saturation: excessive svg icons fire (P1)', () => {
  const sig = DECO.find((s) => s.id === 'slop.decoration.icon-saturation');
  const html = `<svg></svg>`.repeat(14);
  const f = sig.detect(ctxOf(html), {});
  expect(f).toBeTruthy();
  expect(sig.tier).toBe('P1');
});

test('decoration.animation: scale/rotate keyframe fires (P1)', () => {
  const sig = DECO.find((s) => s.id === 'slop.decoration.animation');
  const html = `<style>@keyframes s{from{transform:scale(1)}to{transform:scale(1.1)}}</style>`;
  const f = sig.detect(ctxOf(html), {});
  expect(f).toBeTruthy();
});

test('decoration.italic-heading: <em>/<i> inside heading fires (Hallmark gate 38a — top AI tell)', () => {
  const sig = DECO.find((s) => s.id === 'slop.decoration.italic-heading');
  expect(sig.detect(ctxOf(`<h1><em>Beautiful</em> design</h1>`), {})).toBeTruthy();
  expect(sig.detect(ctxOf(`<h2>normal <i>ital</i> word</h2>`), {})).toBeTruthy();
  // FP guard: <em> in body p (not heading) does NOT fire
  expect(sig.detect(ctxOf(`<p><em>not a heading</em></p>`), {})).toBeNull();
  // FP guard: <strong> in heading (weight, not italic) does NOT fire
  expect(sig.detect(ctxOf(`<h1>use <strong>weight</strong> instead</h1>`), {})).toBeNull();
  expect(sig.detect(ctxOf(`<h1>Plain heading</h1>`), {})).toBeNull();
});

import { SIGNATURES as COPY } from '../lib/slop/signatures/copy.mjs';

test('copy.lexicon: cliché word fires (P2 advisory)', () => {
  const sig = COPY.find((s) => s.id === 'slop.copy.lexicon');
  const f = sig.detect(ctxOf(`<p>Let's delve into our robust, cutting-edge platform.</p>`), {});
  expect(f).toBeTruthy();
  expect(sig.tier).toBe('P2');
});

test('copy.lexicon: clean copy does NOT fire', () => {
  const sig = COPY.find((s) => s.id === 'slop.copy.lexicon');
  const f = sig.detect(ctxOf(`<p>The cache invalidates on write.</p>`), {});
  expect(f).toBeNull();
});

test('copy.generic: always unmeasured in v1 (LLM judge is v2, never gates)', () => {
  const sig = COPY.find((s) => s.id === 'slop.copy.generic');
  const f = sig.detect(ctxOf(`<p>anything</p>`), {});
  expect(f && f.unmeasured).toBe(true);
});

test('copy.lexicon: cliché inside <h1> fires (heading coverage — <h1>Unleash…</h1> was silently missed when only ctx.textSamples was scanned)', () => {
  const sig = COPY.find((s) => s.id === 'slop.copy.lexicon');
  const f = sig.detect(ctxOf(`<h1>Unleash the power of AI</h1>`), {});
  expect(f).toBeTruthy();
  expect(f.signal).toBe(1);
});

test('copy.lexicon: separator variants all match (cutting edge / cutting–edge U+2013 / cutting-edge)', () => {
  const sig = COPY.find((s) => s.id === 'slop.copy.lexicon');
  expect(sig.detect(ctxOf(`<p>cutting edge tech</p>`), {})).toBeTruthy();
  expect(sig.detect(ctxOf(`<p>cutting–edge tech</p>`), {})).toBeTruthy();
  expect(sig.detect(ctxOf(`<p>cutting-edge tech</p>`), {})).toBeTruthy();
});

test('copy.lexicon: t.minHits raises threshold (override contract, both directions)', () => {
  const sig = COPY.find((s) => s.id === 'slop.copy.lexicon');
  // 2 cliché hits ('delve', 'robust'); threshold 3 → suppressed; threshold 2 → fires
  expect(sig.detect(ctxOf(`<p>delve and robust</p>`), { minHits: 3 })).toBeNull();
  expect(sig.detect(ctxOf(`<p>delve and robust</p>`), { minHits: 2 })).toBeTruthy();
});

test('copy.lexicon: t.lexicon replaces default list (override contract, both directions)', () => {
  const sig = COPY.find((s) => s.id === 'slop.copy.lexicon');
  // 'customword' is NOT in DEFAULT_LEXICON; 'delve' IS — override swaps which inputs fire
  expect(sig.detect(ctxOf(`<p>customword here</p>`), { lexicon: ['customword'] })).toBeTruthy();
  expect(sig.detect(ctxOf(`<p>delve here</p>`), { lexicon: ['customword'] })).toBeNull();
});

test('copy.lexicon: research-attested "elevate" fires (KLIC-Github ai-tells-sample.html forbids Elevate/Seamless)', () => {
  const sig = COPY.find((s) => s.id === 'slop.copy.lexicon');
  expect(sig.detect(ctxOf(`<h1>Elevate your workflow</h1>`), {})).toBeTruthy();
  expect(sig.detect(ctxOf(`<p>elevate the team</p>`), {})).toBeTruthy();
});

test('copy.lexicon: Hallmark banned phrases fire (single-word + multi-word + apostrophe, case-insensitive)', () => {
  const sig = COPY.find((s) => s.id === 'slop.copy.lexicon');
  // single-word
  expect(sig.detect(ctxOf(`<p>Supercharge your workflow</p>`), {})).toBeTruthy();
  expect(sig.detect(ctxOf(`<h1>Reimagine the way you work</h1>`), {})).toBeTruthy();
  // multi-word substring (case-insensitive via separator normalization)
  expect(sig.detect(ctxOf(`<p>we build innovative solutions</p>`), {})).toBeTruthy();
  expect(sig.detect(ctxOf(`<h2>Built for the modern team</h2>`), {})).toBeTruthy();
  // ASCII apostrophe — note: curly U+2019 apostrophe is a known FN (SEPARATOR_RE doesn't fold quotes)
  expect(sig.detect(ctxOf(`<p>In today's digital landscape, speed matters</p>`), {})).toBeTruthy();
});

test('copy.fake-precision: many-9 percent and round multipliers fire (research: "99.99%/10x 가짜 금지")', () => {
  const sig = COPY.find((s) => s.id === 'slop.copy.fake-precision');
  expect(sig.detect(ctxOf(`<p>99.99% uptime guaranteed</p>`), {})).toBeTruthy();
  expect(sig.detect(ctxOf(`<p>99.9% accurate</p>`), {})).toBeTruthy();
  expect(sig.detect(ctxOf(`<h1>10x faster</h1>`), {})).toBeTruthy();
  expect(sig.detect(ctxOf(`<p>100x performance boost</p>`), {})).toBeTruthy();
  // multiple hits → signal count rises
  const f = sig.detect(ctxOf(`<p>99.99% uptime and 10x faster</p>`), {});
  expect(f.signal).toBeGreaterThanOrEqual(2);
});

test('copy.fake-precision: measured numbers do NOT fire (no false positives on real data)', () => {
  const sig = COPY.find((s) => s.id === 'slop.copy.fake-precision');
  expect(sig.detect(ctxOf(`<p>47.2% pass rate</p>`), {})).toBeNull();
  expect(sig.detect(ctxOf(`<p>3.1x speedup measured</p>`), {})).toBeNull();
  expect(sig.detect(ctxOf(`<p>3.1× Unicode times sign</p>`), {})).toBeNull(); // U+00D7, not ASCII x
  expect(sig.detect(ctxOf(`<p>2x faster</p>`), {})).toBeNull(); // single-digit, no trailing 0
  expect(sig.detect(ctxOf(`<p>9.1% error rate</p>`), {})).toBeNull(); // only one 9 before decimal
  expect(sig.detect(ctxOf(`<p>100% committed</p>`), {})).toBeNull(); // round percent, no decimal, not many-9
  expect(sig.detect(ctxOf(`<p>cache invalidates on write</p>`), {})).toBeNull();
});

import { SIGNATURES as TMPL } from '../lib/slop/signatures/template.mjs';

test('template.trusted-by: "Trusted by" + logo strip fires (P1)', () => {
  const sig = TMPL.find((s) => s.id === 'slop.template.trusted-by');
  const html = `<section><h3>Trusted by</h3><img src="a"><img src="b"><img src="c"></section>`;
  const f = sig.detect(ctxOf(html), {});
  expect(f).toBeTruthy();
  expect(sig.tier).toBe('P1');
});

test('template.trusted-by: absent does NOT fire', () => {
  const sig = TMPL.find((s) => s.id === 'slop.template.trusted-by');
  expect(sig.detect(ctxOf(`<p>hello</p>`), {})).toBeNull();
});

test('template.hero-trio: three equal hero cards fire (P1)', () => {
  const sig = TMPL.find((s) => s.id === 'slop.template.hero-trio');
  const alt = { nodes: [
    { id: 'a', bbox: { x: 0, y: 0, w: 100, h: 100 } },
    { id: 'b', bbox: { x: 110, y: 0, w: 100, h: 100 } },
    { id: 'c', bbox: { x: 220, y: 0, w: 100, h: 100 } },
  ] };
  const f = sig.detect({ ...ctxOf(`<div></div>`), alt }, {});
  expect(f).toBeTruthy();
});

test('decoration.side-tab-border: thick solid one-side border fires (P1, AI UI #1 tell)', () => {
  const sig = DECO.find((s) => s.id === 'slop.decoration.side-tab-border');
  // stylesheet thick left accent rail
  expect(sig.detect(ctxOf(`<style>.card{border-left:6px solid #6366f1}</style>`), {})).toBeTruthy();
  // inline thick top bar
  expect(sig.detect(ctxOf(`<div style="border-top:5px solid #f00"></div>`), {})).toBeTruthy();
  expect(sig.tier).toBe('P1');
});

test('FP-guard: all-side shorthand, thin per-side, and gradient variants do NOT fire side-tab', () => {
  const sig = DECO.find((s) => s.id === 'slop.decoration.side-tab-border');
  // all-side shorthand (no per-side keyword) — not a side-tab
  expect(sig.detect(ctxOf(`<style>.card{border:1px solid #ccc}</style>`), {})).toBeNull();
  // thin per-side (below minThickness) — legitimate hairline / underline
  expect(sig.detect(ctxOf(`<style>.card{border-bottom:1px solid #eee}</style>`), {})).toBeNull();
  // gradient on border side — gradient-border owns this, side-tab excludes gradient
  expect(sig.detect(ctxOf(`<style>.card{border-top:linear-gradient(90deg,#f00,#00f)}</style>`), {})).toBeNull();
});

// --- Phase 2 motion tells (extend decoration.animation infra) ---

test('decoration.bounce-easing: overshooting cubic-bezier OR bounce keyword fires (P1)', () => {
  const sig = DECO.find((s) => s.id === 'slop.decoration.bounce-easing');
  // cubic-bezier with control point outside [0,1] (overshoot)
  expect(sig.detect(ctxOf(`<style>.a{animation:x 1s cubic-bezier(.68,-0.55,.27,1.55)}</style>`), {})).toBeTruthy();
  // bounce keyword
  expect(sig.detect(ctxOf(`<style>.a{transition:transform .3s ease-bounce}</style>`), {})).toBeTruthy();
});

test('FP-guard: in-range cubic-bezier and plain ease-out do NOT fire bounce-easing', () => {
  const sig = DECO.find((s) => s.id === 'slop.decoration.bounce-easing');
  // all control points within [0,1] — legitimate ease-out-quart
  expect(sig.detect(ctxOf(`<style>.a{transition:transform .3s cubic-bezier(.25,1,.5,1)}</style>`), {})).toBeNull();
  // plain ease-out, no cubic-bezier
  expect(sig.detect(ctxOf(`<style>.a{transition:opacity .3s ease-out}</style>`), {})).toBeNull();
});

test('decoration.hover-transform: :hover scale/rotate fires (P1)', () => {
  const sig = DECO.find((s) => s.id === 'slop.decoration.hover-transform');
  expect(sig.detect(ctxOf(`<style>.card:hover{transform:scale(1.05)}</style>`), {})).toBeTruthy();
  expect(sig.detect(ctxOf(`<style>a:hover{transform:rotate(2deg)}</style>`), {})).toBeTruthy();
});

test('FP-guard: :hover without transform does NOT fire hover-transform', () => {
  const sig = DECO.find((s) => s.id === 'slop.decoration.hover-transform');
  // hover changes background only — legitimate interaction, not the tell
  expect(sig.detect(ctxOf(`<style>.btn:hover{background:#f00}</style>`), {})).toBeNull();
});

test('decoration.pulse-animation: opacity keyframes with pulse name OR infinite fires (P1)', () => {
  const sig = DECO.find((s) => s.id === 'slop.decoration.pulse-animation');
  // pulse name on opacity
  expect(sig.detect(ctxOf(`<style>@keyframes pulse{0%{opacity:.4}50%{opacity:1}100%{opacity:.4}}.d{animation:pulse 2s infinite}</style>`), {})).toBeTruthy();
  // non-pulse name but infinite application
  expect(sig.detect(ctxOf(`<style>@keyframes glow{0%{opacity:.5}100%{opacity:1}}.d{animation:glow 1s infinite}</style>`), {})).toBeTruthy();
});

test('FP-guard: finite fade-in entrance does NOT fire pulse-animation', () => {
  const sig = DECO.find((s) => s.id === 'slop.decoration.pulse-animation');
  // fade-in entrance: opacity keyframes, finite, non-pulse name — legitimate reveal
  expect(sig.detect(ctxOf(`<style>@keyframes fadeIn{from{opacity:0}to{opacity:1}}.hero{animation:fadeIn .6s ease-out forwards}</style>`), {})).toBeNull();
});

test('decoration.marquee: translateX/left keyframes with marquee name OR infinite fires (P1)', () => {
  const sig = DECO.find((s) => s.id === 'slop.decoration.marquee');
  expect(sig.detect(ctxOf(`<style>@keyframes marquee{from{transform:translateX(0)}to{transform:translateX(-100%)}}.m{animation:marquee 10s linear infinite}</style>`), {})).toBeTruthy();
});

test('FP-guard: non-marquee finite translateX (deliberate one-shot slide) does NOT fire marquee', () => {
  const sig = DECO.find((s) => s.id === 'slop.decoration.marquee');
  expect(sig.detect(ctxOf(`<style>@keyframes nudge{from{transform:translateX(0)}to{transform:translateX(-10px)}}.x{animation:nudge .3s ease-out forwards}</style>`), {})).toBeNull();
});

test('decoration.blink-cursor: opacity + steps() + blink/cursor name fires (P1)', () => {
  const sig = DECO.find((s) => s.id === 'slop.decoration.blink-cursor');
  expect(sig.detect(ctxOf(`<style>@keyframes blink{0%{opacity:1}50%{opacity:0}}.c{animation:blink 1s steps(2) infinite}</style>`), {})).toBeTruthy();
});

test('FP-guard: opacity + steps without blink name does NOT fire blink-cursor', () => {
  const sig = DECO.find((s) => s.id === 'slop.decoration.blink-cursor');
  // legitimate stepped fade, no cursor/caret/blink name
  expect(sig.detect(ctxOf(`<style>@keyframes strobe{0%{opacity:1}50%{opacity:0}}.x{animation:strobe 1s steps(2) infinite}</style>`), {})).toBeNull();
});
