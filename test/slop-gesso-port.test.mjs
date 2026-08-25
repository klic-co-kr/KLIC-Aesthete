// Detection + FP tests for the @gessobuild/anti-slop (v0.4.2, MIT) absorption — 18 literal-
// presence signatures ported from Gesso-Build/skills. Each test pins the ported threshold AND
// the FP guard the upstream rule documents (the FP case is never optional: the module header
// in lib/slop.mjs names FP rate as the #1 failure mode).
import { test, expect } from 'bun:test';
import { SIGNATURES as PALETTE } from '../lib/slop/signatures/palette.mjs';
import { SIGNATURES as DECO } from '../lib/slop/signatures/decoration.mjs';
import { SIGNATURES as COPY } from '../lib/slop/signatures/copy.mjs';
import { SIGNATURES as IMG } from '../lib/slop/signatures/imagery.mjs';
import { scanHtmlSource } from '../lib/slop/html-source-scan.mjs';

const ctxOf = (html) => scanHtmlSource(html);
const find = (list, id) => list.find((s) => s.id === id);

// ---------------------------------------------------------------- copy axis --
const C = () => COPY;

test('copy.lorem: "lorem ipsum"/"dolor sit amet" in visible text fires (P1)', () => {
  const sig = find(C(), 'slop.copy.lorem');
  expect(sig.detect(ctxOf('<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>'), {})).toBeTruthy();
  expect(sig.detect(ctxOf('<p>progress report — dolor sit amet draft</p>'), {})).toBeTruthy(); // second phrase alone
  expect(sig.tier).toBe('P1');
  expect(sig.severity).toBe('medium');
});

test('copy.lorem FP: realistic domain copy stays silent', () => {
  const sig = find(C(), 'slop.copy.lorem');
  expect(sig.detect(ctxOf('<p>Track every shipment from pickup to doorstep, in one timeline.</p>'), {})).toBeNull();
});

test('copy.em-dash: raw/entity em dash in visible copy fires (P2)', () => {
  const sig = find(C(), 'slop.copy.em-dash');
  expect(sig.detect(ctxOf('<p>Ship faster — without the busywork.</p>'), {})).toBeTruthy();
  expect(sig.detect(ctxOf('<p>Ship faster &mdash; without the busywork.</p>'), {})).toBeTruthy();
  expect(sig.detect(ctxOf('<p>Ship faster &#8212; without</p>'), {})).toBeTruthy();
  expect(sig.tier).toBe('P2');
});

test('copy.em-dash FP: title/comment em dashes invisible; comma copy stays silent', () => {
  const sig = find(C(), 'slop.copy.em-dash');
  // <title> and comments are not in TEXT_TAGS samples — the tailwind-legit FP fixture's two
  // em dashes both live there and must stay invisible to this signature.
  expect(sig.detect(ctxOf('<!doctype html><html><head><title>billing — settings</title></head><body><!-- note — here --><p>Plain copy, with commas.</p></body></html>'), {})).toBeNull();
  expect(sig.detect(ctxOf('<p>Ship faster, without the busywork.</p>'), {})).toBeNull();
});

test('copy.em-dash FP (adversarial round): ENTITY dash runs belong to decorative-divider', () => {
  const em = find(C(), 'slop.copy.em-dash');
  const div = find(D(), 'slop.decoration.decorative-divider');
  const html = '<span>OVERVIEW &mdash;&mdash;&mdash;&mdash; Q3</span>';
  expect(em.detect(ctxOf(html), {})).toBeNull();      // run of 4 — not a single dash
  expect(div.detect(ctxOf(html), {})).toBeTruthy();   // the divider rule owns entity runs too
});

test('copy phrase sigs FP (adversarial round): no phrase manufacturing across element boundaries', () => {
  const nxy = find(C(), 'slop.copy.not-x-but-y');
  const apo = find(C(), 'slop.copy.apologetic-error');
  // join(' ') across samples would weld "not a drill" + "It is" into the cadence — per-sample
  // matching is the fix; each sample must carry the whole phrase on its own
  expect(nxy.detect(ctxOf('<p>This is not a drill</p><span>It is fine now</span>'), {})).toBeNull();
  expect(apo.detect(ctxOf('<p>when something</p><p>went wrong here</p>'), {})).toBeNull();
  // the typographic apostrophe (U+2019) is the DEFAULT in generated copy — must fire
  expect(nxy.detect(ctxOf('<p>It’s not just a tool, it’s a workflow.</p>'), {})).toBeTruthy();
  expect(nxy.detect(ctxOf('<p>We’re not a dashboard, but rather a command center.</p>'), {})).toBeTruthy();
});

test('copy.em-dash FP: dash RUNS (2+) belong to decorative-divider, not here', () => {
  const sig = find(C(), 'slop.copy.em-dash');
  expect(sig.detect(ctxOf('<span>OVERVIEW ———— Q3</span>'), {})).toBeNull();
});

test('copy.oversized-number: raw ≥10,000 figure fires (P2)', () => {
  const sig = find(C(), 'slop.copy.oversized-number');
  expect(sig.detect(ctxOf('<p>$1,842,000</p>'), {})).toBeTruthy();
  expect(sig.detect(ctxOf('<span>47,200 users</span>'), {})).toBeTruthy();   // ≥10k, comma-grouped
  expect(sig.detect(ctxOf('<span>reached 842000 items</span>'), {})).toBeTruthy(); // 5+ digits, ungrouped
  expect(sig.tier).toBe('P2');
});

test('copy.oversized-number FP: abbreviated / percent / under-10k spared', () => {
  const sig = find(C(), 'slop.copy.oversized-number');
  expect(sig.detect(ctxOf('<p>$1.8M</p>'), {})).toBeNull();        // K/M/B-suffixed
  expect(sig.detect(ctxOf('<p>99.9% uptime</p>'), {})).toBeNull(); // percent-suffixed
  expect(sig.detect(ctxOf('<p>9,999 items</p>'), {})).toBeNull();  // under 10,000
  expect(sig.detect(ctxOf('<p>2026 report</p>'), {})).toBeNull();  // no comma, 4 digits
});

test('copy.not-x-but-y: manufactured-rebuttal cadence fires (P2)', () => {
  const sig = find(C(), 'slop.copy.not-x-but-y');
  expect(sig.detect(ctxOf("<p>It's not just a tool, it's a workflow.</p>"), {})).toBeTruthy();
  expect(sig.detect(ctxOf("<p>This is not a dashboard, it's a command center.</p>"), {})).toBeTruthy();
  expect(sig.tier).toBe('P2');
});

test('copy.not-x-but-y FP: plain declarative copy stays silent', () => {
  const sig = find(C(), 'slop.copy.not-x-but-y');
  expect(sig.detect(ctxOf('<p>A workflow that replaces the tool entirely.</p>'), {})).toBeNull();
});

test('copy.apologetic-error: "Oops"/"something went wrong" fires (P2)', () => {
  const sig = find(C(), 'slop.copy.apologetic-error');
  expect(sig.detect(ctxOf('<p>Oops! Something went wrong.</p>'), {})).toBeTruthy();
  expect(sig.detect(ctxOf('<p>Whoops — try again.</p>'), {})).toBeTruthy();
  expect(sig.tier).toBe('P2');
});

test('copy.apologetic-error FP: actionable error copy stays silent', () => {
  const sig = find(C(), 'slop.copy.apologetic-error');
  expect(sig.detect(ctxOf("<p>Couldn't save. Check your connection and retry.</p>"), {})).toBeNull();
});

test('copy.live-clock: whole-text LIVE/NOW ± dot ± HH:MM eyebrow fires (P2)', () => {
  const sig = find(C(), 'slop.copy.live-clock');
  expect(sig.detect(ctxOf('<span class="eyebrow">● LIVE · 09:41</span>'), {})).toBeTruthy();
  expect(sig.detect(ctxOf('<span>NOW</span>'), {})).toBeTruthy();
  expect(sig.detect(ctxOf('<span>LIVE 09:41 pm</span>'), {})).toBeTruthy();
  expect(sig.tier).toBe('P2');
});

test('copy.live-clock FP: whole-text equality is the safety', () => {
  const sig = find(C(), 'slop.copy.live-clock');
  expect(sig.detect(ctxOf('<span>Departs 09:41</span>'), {})).toBeNull();   // time not fronted by LIVE/NOW
  expect(sig.detect(ctxOf('<h2>LIVE STREAM setup</h2>'), {})).toBeNull();   // not whole-text; heading not eligible
});

// -------------------------------------------------------------- palette axis --
test('palette.overused-font: Inter/Space Grotesk/Geist/Instrument Serif fires (P2)', () => {
  const sig = find(PALETTE, 'slop.palette.overused-font');
  expect(sig.detect(ctxOf('<style>body{font-family:Inter,sans-serif}</style>'), {})).toBeTruthy();
  expect(sig.detect(ctxOf('<style>.h{font-family:"Space Grotesk"}</style>'), {})).toBeTruthy();
  expect(sig.detect(ctxOf('<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;700" rel="stylesheet">'), {})).toBeTruthy();
  expect(sig.tier).toBe('P2');
});

test('palette.overused-font FP: distinctive families stay silent', () => {
  const sig = find(PALETTE, 'slop.palette.overused-font');
  expect(sig.detect(ctxOf('<style>body{font-family:"Iowan Old Style",Georgia,serif}</style>'), {})).toBeNull();
});

test('scanner: malformed percent-encoding in a Google Fonts URL never crashes the scan', () => {
  // decodeURIComponent throws URIError on a bare '%' — the scan must degrade to the raw
  // param, not die (scanHtmlSource runs outside every signature's try/catch).
  const ctx = ctxOf('<link href="https://fonts.googleapis.com/css2?family=%E0%A4&x=1" rel="stylesheet">');
  expect(Array.isArray(ctx.fontFamilies)).toBe(true);
});

// ----------------------------------------------------------- decoration axis --
const D = () => DECO;

test('decoration.hollow-text: text-stroke + transparent fill in one block fires (P1)', () => {
  const sig = find(D(), 'slop.decoration.hollow-text');
  expect(sig.detect(ctxOf('<h2 style="color: transparent; -webkit-text-stroke: 1.5px #16181d">SS26</h2>'), {})).toBeTruthy();
  expect(sig.detect(ctxOf('<style>.h{color:transparent;-webkit-text-stroke:1px #111}</style>'), {})).toBeTruthy();
  expect(sig.tier).toBe('P1');
});

test('decoration.hollow-text FP: stroke over a solid fill stays silent', () => {
  const sig = find(D(), 'slop.decoration.hollow-text');
  expect(sig.detect(ctxOf('<h2 style="color:#16181d;-webkit-text-stroke:1.5px #16181d">SS26</h2>'), {})).toBeNull();
  expect(sig.detect(ctxOf('<style>.h{color:transparent}</style>'), {})).toBeNull(); // transparent alone, no stroke
});

test('decoration.dark-glow: saturated wide-blur chromatic shadow fires (P1)', () => {
  const sig = find(D(), 'slop.decoration.dark-glow');
  expect(sig.detect(ctxOf('<style>.cta{box-shadow: 0 0 40px rgba(6,182,212,0.4)}</style>'), {})).toBeTruthy();
  expect(sig.detect(ctxOf('<style>.cta{box-shadow: 0 0 40px #22d3ee66}</style>'), {})).toBeTruthy(); // hex8, alpha 0.4
  expect(sig.tier).toBe('P1');
});

test('decoration.dark-glow FP: neutral elevation / low alpha / inset / short blur stay silent', () => {
  const sig = find(D(), 'slop.decoration.dark-glow');
  expect(sig.detect(ctxOf('<style>.card{box-shadow: 0 1px 2px rgba(0,0,0,0.24)}</style>'), {})).toBeNull(); // neutral
  expect(sig.detect(ctxOf('<style>.card{box-shadow: 0 0 40px rgba(6,182,212,0.1)}</style>'), {})).toBeNull(); // alpha < 0.15
  expect(sig.detect(ctxOf('<style>.card{box-shadow: inset 0 0 40px rgba(6,182,212,0.4)}</style>'), {})).toBeNull(); // inset
  expect(sig.detect(ctxOf('<style>.card{box-shadow: 0 0 6px rgba(6,182,212,0.4)}</style>'), {})).toBeNull(); // blur < 12
});

test('decoration.dark-glow: rgba drop-shadow() fires — paren-nested color must survive capture', () => {
  const sig = find(D(), 'slop.decoration.dark-glow');
  expect(sig.detect(ctxOf('<style>.c{filter: drop-shadow(0 0 18px rgba(34,211,238,.45))}</style>'), {})).toBeTruthy();
});

test('decoration.over-rounded: single px radius 40–120 fires (P2)', () => {
  const sig = find(D(), 'slop.decoration.over-rounded');
  expect(sig.detect(ctxOf('<style>.card{border-radius:48px}</style>'), {})).toBeTruthy();
  expect(sig.detect(ctxOf('<div style="border-radius: 64px">blob</div>'), {})).toBeTruthy();
  expect(sig.tier).toBe('P2');
});

test('decoration.over-rounded FP: 8–24px systems, pills, circles, per-corner stay silent', () => {
  const sig = find(D(), 'slop.decoration.over-rounded');
  expect(sig.detect(ctxOf('<style>.card{border-radius:12px}</style>'), {})).toBeNull();
  expect(sig.detect(ctxOf('<style>.pill{border-radius:9999px}</style>'), {})).toBeNull(); // pill convention
  expect(sig.detect(ctxOf('<style>.av{border-radius:50%}</style>'), {})).toBeNull();     // circle convention
  expect(sig.detect(ctxOf('<style>.c{border-radius:12px 24px 12px 24px}</style>'), {})).toBeNull(); // per-corner (multi-value)
});

test('decoration.repeating-stripe: repeating-*-gradient fires (P2)', () => {
  const sig = find(D(), 'slop.decoration.repeating-stripe');
  expect(sig.detect(ctxOf('<div style="background: repeating-linear-gradient(45deg, #111 0 2px, transparent 2px 6px)"></div>'), {})).toBeTruthy();
  expect(sig.detect(ctxOf('<style>.s{background:repeating-conic-gradient(#000 0 25%, #fff 0 50%)}</style>'), {})).toBeTruthy();
  expect(sig.tier).toBe('P2');
});

test('decoration.repeating-stripe FP: plain gradient is palette.gradient’s domain', () => {
  const sig = find(D(), 'slop.decoration.repeating-stripe');
  expect(sig.detect(ctxOf('<style>.h{background:linear-gradient(90deg,#f5f0e6,#e8dcc8)}</style>'), {})).toBeNull();
});

test('decoration.decorative-divider: box-drawing / dash runs ≥2 in visible text fire (P2)', () => {
  const sig = find(D(), 'slop.decoration.decorative-divider');
  expect(sig.detect(ctxOf('<span>OVERVIEW ───────────── Q3</span>'), {})).toBeTruthy();
  expect(sig.detect(ctxOf('<span>OVERVIEW ———— Q3</span>'), {})).toBeTruthy(); // em-dash run
  expect(sig.tier).toBe('P2');
});

test('decoration.decorative-divider FP: single dashes and unspaced ranges stay silent', () => {
  const sig = find(D(), 'slop.decoration.decorative-divider');
  expect(sig.detect(ctxOf('<p>Ship faster — without the busywork.</p>'), {})).toBeNull(); // single em dash = copy.em-dash
  expect(sig.detect(ctxOf('<p>Mon-Fri 9-5</p>'), {})).toBeNull();
});

test('decoration.transition-all: transition value containing keyword "all" fires (P2)', () => {
  const sig = find(D(), 'slop.decoration.transition-all');
  expect(sig.detect(ctxOf('<style>.card{transition: all 0.3s ease}</style>'), {})).toBeTruthy();
  expect(sig.detect(ctxOf('<style>.card{-webkit-transition-property:all}</style>'), {})).toBeTruthy();
  expect(sig.detect(ctxOf('<div style="transition: all .2s"></div>'), {})).toBeTruthy();
  expect(sig.tier).toBe('P2');
});

test('decoration.transition-all FP: named-property transitions stay silent', () => {
  const sig = find(D(), 'slop.decoration.transition-all');
  expect(sig.detect(ctxOf('<style>.card{transition: transform 200ms ease-out, opacity 200ms ease-out}</style>'), {})).toBeNull();
});

test('decoration.will-change-misuse: non-compositable will-change fires (P2)', () => {
  const sig = find(D(), 'slop.decoration.will-change-misuse');
  expect(sig.detect(ctxOf('<style>.card{will-change: top, box-shadow}</style>'), {})).toBeTruthy();
  expect(sig.detect(ctxOf('<div style="will-change: width"></div>'), {})).toBeTruthy();
  expect(sig.tier).toBe('P2');
});

test('decoration.will-change-misuse FP: compositable / spec values stay silent', () => {
  const sig = find(D(), 'slop.decoration.will-change-misuse');
  expect(sig.detect(ctxOf('<style>.card{will-change: transform}</style>'), {})).toBeNull();
  expect(sig.detect(ctxOf('<style>.sc{will-change: scroll-position}</style>'), {})).toBeNull();
});

test('decoration.layout-prop-anim: transition naming layout props fires (P2)', () => {
  const sig = find(D(), 'slop.decoration.layout-prop-anim');
  expect(sig.detect(ctxOf('<style>.menu{transition: width 0.3s ease}</style>'), {})).toBeTruthy();
  expect(sig.detect(ctxOf('<style>.m{transition: margin-left .3s}</style>'), {})).toBeTruthy(); // margin-left contains margin
  expect(sig.detect(ctxOf('<div style="transition: padding .2s"></div>'), {})).toBeTruthy();
  expect(sig.tier).toBe('P2');
});

test('decoration.layout-prop-anim FP: compositor-owned props and "all" stay silent (all = transition-all)', () => {
  const sig = find(D(), 'slop.decoration.layout-prop-anim');
  expect(sig.detect(ctxOf('<style>.card{transition: transform .2s, opacity .2s}</style>'), {})).toBeNull();
  expect(sig.detect(ctxOf('<style>.card{transition: all 0.3s ease}</style>'), {})).toBeNull();
});

test('decoration.layout-prop-anim FP: PAINT properties containing layout words stay silent (token-level match)', () => {
  const sig = find(D(), 'slop.decoration.layout-prop-anim');
  // substring match on 'left'/'bottom' inside border-*-color would be a false fire —
  // the property TOKEN is what must match, not any substring
  expect(sig.detect(ctxOf('<style>.c{transition: border-left-color .3s}</style>'), {})).toBeNull();
  expect(sig.detect(ctxOf('<style>.c{transition: border-bottom-color .3s, box-shadow .3s}</style>'), {})).toBeNull();
  // real sub-side layout props still fire (margin-left/padding-top are layout)
  expect(sig.detect(ctxOf('<style>.c{transition: padding-top .3s}</style>'), {})).toBeTruthy();
});

test('decoration.body-display-contents: display:contents on <body> fires (P1)', () => {
  const sig = find(D(), 'slop.decoration.body-display-contents');
  expect(sig.detect(ctxOf('<body style="display: contents">'), {})).toBeTruthy();
  expect(sig.detect(ctxOf('<style>html, body { display: contents }</style>'), {})).toBeTruthy(); // selector list counts
  expect(sig.tier).toBe('P1');
});

test('decoration.body-display-contents FP: contents on wrappers / descendants stays silent', () => {
  const sig = find(D(), 'slop.decoration.body-display-contents');
  expect(sig.detect(ctxOf('<div style="display:contents">row</div>'), {})).toBeNull(); // nested wrapper = legitimate
  expect(sig.detect(ctxOf('<style>body .child { display: contents }</style>'), {})).toBeNull(); // descendant selector
});

// -------------------------------------------------------------- imagery axis --
test('imagery.placeholder-src: placeholder-service img src fires (P1)', () => {
  const sig = find(IMG, 'slop.imagery.placeholder-src');
  expect(sig.detect(ctxOf('<img src="https://i.pravatar.cc/150?img=3" alt="avatar">'), {})).toBeTruthy();
  expect(sig.detect(ctxOf('<img src="https://picsum.photos/400/300" alt="cover">'), {})).toBeTruthy();
  expect(sig.detect(ctxOf('<img src="https://placehold.co/600x400" alt="x">'), {})).toBeTruthy();
  expect(sig.tier).toBe('P1');
});

test('imagery.placeholder-src FP: real photo CDNs and local assets stay silent', () => {
  const sig = find(IMG, 'slop.imagery.placeholder-src');
  expect(sig.detect(ctxOf('<img src="team/ana.jpg" alt="Ana Ruiz">'), {})).toBeNull();
  expect(sig.detect(ctxOf('<img src="https://images.unsplash.com/photo-15060" alt="Alpine ridge">'), {})).toBeNull();
  // look-alike labels must not substring-match: 'notpicsum' is one DNS label, and the
  // host alternation may not start mid-label
  expect(sig.detect(ctxOf('<img src="https://notpicsum.photos/400" alt="x">'), {})).toBeNull();
  expect(sig.detect(ctxOf('<img src="https://cdn.example-notplacehold.co/x" alt="x">'), {})).toBeNull();
});

test('imagery FP (adversarial round): commented-out / lazy-load / unquoted srcs', () => {
  const ph = find(IMG, 'slop.imagery.placeholder-src');
  const brk = find(IMG, 'slop.imagery.broken-src');
  // commented-out markup is not rendered — neither signature may see it
  expect(ph.detect(ctxOf('<!-- <img src="https://placehold.co/600x400" alt="x"> -->'), {})).toBeNull();
  expect(brk.detect(ctxOf('<!-- <img alt="x"> -->'), {})).toBeNull();
  // lazy-load data-src is not src — the resolved src attribute is what counts
  expect(ph.detect(ctxOf('<img data-src="https://picsum.photos/400/300" alt="x">'), {})).toBeNull();
  // unquoted src (valid minified HTML5) is a resolvable src, not a missing one
  expect(brk.detect(ctxOf('<img src=hero.jpg alt=x>'), {})).toBeNull();
  // the quoted forms still fire as before
  expect(ph.detect(ctxOf('<img src="https://picsum.photos/400/300" alt="x">'), {})).toBeTruthy();
  expect(brk.detect(ctxOf('<img src="{{template}}" alt="x">'), {})).toBeTruthy();
});

test('imagery.broken-src: missing/empty/template src fires (P1)', () => {
  const sig = find(IMG, 'slop.imagery.broken-src');
  expect(sig.detect(ctxOf('<img src="" alt="x">'), {})).toBeTruthy();
  expect(sig.detect(ctxOf('<img alt="x">'), {})).toBeTruthy();                    // no src at all
  expect(sig.detect(ctxOf('<img src="path/to/hero.jpg" alt="x">'), {})).toBeTruthy();
  expect(sig.detect(ctxOf('<img src="{{template}}" alt="x">'), {})).toBeTruthy();  // mustache slot
  expect(sig.tier).toBe('P1');
});

test('imagery.broken-src FP: resolvable srcs stay silent', () => {
  const sig = find(IMG, 'slop.imagery.broken-src');
  expect(sig.detect(ctxOf('<img src="hero.jpg" alt="Peaks">'), {})).toBeNull();
  expect(sig.detect(ctxOf('<img data-photo-query="alpine ridge dawn" alt="">'), {})).toBeNull(); // resolver slot: pipeline fills it
});
