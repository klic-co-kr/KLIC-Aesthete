// Simple LITERAL-PRESENCE HTML scan. NOT a CSS mini-parser (spec §5 M1).
// Extracts tokens from <style> blocks + inline style="" + DOM text/class/structure.
// EXCLUDED (= reported in measuredNotes, never faked): var() indirect resolution, external
// <link> cascade, @media merge, minified complex rules. Deterministic (no Date/random).

const GRAD_RE = /(?:linear|radial|conic)-gradient\([^;}]*/gi;
const GLASS_RE = /backdrop-filter\s*:[^;}]*/gi;
// Body allows ONE level of nested braces: @keyframes bodies always contain stage blocks
// like `from { ... }` / `to { ... }` / `N% { ... }`. Plain [^{}]* would match nothing.
const KEYFRAMES_RE = /@keyframes\s+([A-Za-z0-9_-]+)\s*\{((?:[^{}]+|\{[^{}]*\})*)\}/gi;
const HEADING_RE = /<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi;
const TEXT_TAGS = ['p', 'li', 'span', 'button', 'a', 'td'];
const SVG_RE = /<svg\b/gi;
// NOTE: no /g flag — this regex is only ever used with .test(), and a /g regex
// would advance lastIndex on each call, making repeated identical inputs oscillate
// (violating the spec's Same input → identical StyleCtx determinism guarantee).
const LINK_RE = /<link\b[^>]*rel\s*=\s*["']?stylesheet/i;
// Hidden-unicode watermark carriers — detection port of watermarks-remover Layer A
// (guillaumemeyer/watermarks-remover): edit-based LLM watermark marks hide in zero-width /
// tag / bidi codepoints, so their presence in raw source is direct "passed through an LLM"
// evidence. Four risk tiers (adversarial-review-calibrated):
//   HARD (fire at 1): bidi embedding/override U+202A–202E, tag chars U+E0000–U+E007F minus
//   well-formed emoji tag sequences (subdivision-flags — England/Scotland/Wales — are BUILT
//   from tag chars and are the one legitimate consumer of that block), and BOM U+FEFF
//   mid-source only (a BOM at index 0 is the UTF-8 encoding signature).
//   ISOLATES (fire at 6 codepoints): bidi isolates U+2066–U+2069 are the Unicode-recommended
//   mechanism for embedding opposite-direction runs; one embedding = a PAIR (2 codepoints),
//   so bilingual pages with 1–2 RTL runs stay silent (6 = three full pairs). stripCarriers
//   NEVER removes isolates (direction-bearing).
//   ZWSP (fire at 5, excluding ZWSP directly after '/'): watermark payloads sit between
//   letters; ZWSP after '/' is the standard URL line-break-control idiom (long-URL lists,
//   CJK wrap points) and is not evidence. KNOWN EVASION (accepted): an adversary can
//   slash-prefix every ZWSP in prose to hide the whole class — narrowing the carve-out to
//   href/src attribute values needs attribute parsing, out of v1 literal-presence scope.
//   WJ (fire at 3): U+2060 "Fig\u20601"/"Table\u20602" no-break typography is legit; three
//   or more reads as payload.
// DELIBERATELY EXCLUDED (legitimate invisible chars, per watermarks-remover's own FP
// warnings): U+200D ZWJ (emoji sequences, Arabic/Indic joiners), U+200C ZWNJ (Persian
// half-space), U+00AD soft hyphen (hyphenation), U+E000–U+F8FF PUA (icon fonts),
// U+FE0F (emoji presentation selector).
// ENTITY-ENCODED CARRIERS EVADE DETECTION IN v1: numeric refs are ASCII in source and the
// literal-presence scan does not decode them (spec §5 M1). The note regex below is a
// transparency best-effort (leading zeros, optional semicolon, decimal + hex forms) — an
// adversary who controls encoding defeats this scanner silently; that boundary is by design.
export const CARRIER_HARD_RE = /[\u202A-\u202E\u{E0000}-\u{E007F}]/gu;
export const CARRIER_ISOLATE_RE = /[\u2066-\u2069]/g;
export const CARRIER_BOM_RE = /\uFEFF/g;
export const ZWSP_RE = /\u200B/g;
export const WJ_RE = /\u2060/g;
// \u{1F3F4} black flag + tag payload + cancel-tag — a well-formed emoji tag sequence.
// Exported because stripCarriers must preserve exactly these while stripping raw tag chars.
// Payload restricted to tag LETTERS (U+E0061–U+E007A, i.e. ASCII a–z): every real
// subdivision flag (GB-ENG, GB-SCT, …) is letters-only, and the restriction closes the
// round-2 evasion where an arbitrary tag-char payload + cancel-tag hid behind the carve-out.
// A letters-only fake sequence remains possible (indistinguishable from an unknown-region
// flag) — documented residual, bounded to a–z payload.
export const EMOJI_TAG_SEQ_RE = /\u{1F3F4}[\u{E0061}-\u{E007A}]+\u{E007F}/gu;
// Capturing twin for split() — stripCarriers preserves sequences at odd indices.
export const EMOJI_TAG_SEQ_SPLIT_RE = /(\u{1F3F4}[\u{E0061}-\u{E007A}]+\u{E007F})/gu;
const CARRIER_ENTITY_RE = /&#0*(?:8203|8288|823[4-8]|829[4-7]|65279)(?![0-9])|&#x0*(?:200[b-f]|202[a-e]|206[0-9]|feff|e00[0-7][0-9a-f])(?![0-9a-f]);?/i;

// Pragmatic emoji detection: pictographic/dingbat/symbol ranges. Good enough for the cliché tell;
// not a full Unicode emoji parser. Deterministic. ONE source regex in twin forms so the
// decoration signatures (.test(), non-global — a /g regex would advance lastIndex and make
// repeated inputs oscillate, see LINK_RE) and this scanner (.match(), global) can never drift.
const PICTOGRAPH_SRC = '[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{2190}-\\u{21FF}\\u{2B00}-\\u{2BFF}]';
export const PICTOGRAPH_RE = new RegExp(PICTOGRAPH_SRC, 'u');
const PICTOGRAPH_G_RE = new RegExp(PICTOGRAPH_SRC, 'gu');

// Tailwind color utility token — FULL-token match (anchored ^$: `my-emerald-100` or
// `has-text-emerald-100` are not color utilities) over the last ':'-segment of the class token,
// so variant prefixes (hover:, dark:, md:…) don't hide the palette decision. Opacity modifiers
// (`text-emerald-800/70`) tolerated. Arbitrary values (`bg-[#hex]`, `bg-[var(--x)]`) and bare
// hue names (`bg-emerald`) are NOT matched — literal-presence v1 (spec §5 M1); hue data is kept
// per token so the candy-hue signature can filter without a CSS mini-parser.
const TW_COLOR_TOKEN_RE = /^(?:bg|text|border|ring|from|to|via|fill|stroke|outline|accent|caret|decoration|divide|shadow)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(\d{2,3})(?:\/\d+)?$/;

// Shared carrier-evidence thresholds + clamp — the SINGLE source of truth consumed by the
// signature (copy.mjs detect), the strip gate (slop.mjs stripCarriers), and
// DEFAULT_THRESHOLDS. A non-numeric or sub-1 override falls backs to the default; it can
// never silently arm the signature on every page or disable it.
export const CARRIER_DEFAULT_THRESHOLDS = { minHard: 1, minIsolates: 6, minZwsp: 5, minWj: 3 };
export const clampCarrierThreshold = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : d;
};

// Per-class carrier counts over a source string. Leading BOM is exempt (encoding
// signature); tag chars inside well-formed emoji tag sequences are subtracted (flags);
// ZWSP directly after '/' is skipped (URL line-break control). Consumed by BOTH the
// scanner (full source) and stripCarriers (strippable segments + audit counts) — one
// implementation so the two can never drift.
export function countCarriers(src) {
  const bomCount = (src.match(CARRIER_BOM_RE) || []).length;
  const leadingBom = src.charCodeAt(0) === 0xFEFF ? 1 : 0;
  // Codepoint count, NOT UTF-16 length: the flag base U+1F3F4 is astral (2 units), so
  // `m[0].length - 1` over-subtracted one carrier per flag — each flag masked one real
  // tag-char carrier (round-2 integration review).
  const emojiTagChars = [...src.matchAll(EMOJI_TAG_SEQ_RE)]
    .reduce((n, m) => n + ([...m[0]].length - 1), 0);
  let zwsp = 0;
  for (const m of src.matchAll(ZWSP_RE)) {
    if (m.index > 0 && src[m.index - 1] === '/') continue;
    zwsp += 1;
  }
  return {
    hard: Math.max(0, (src.match(CARRIER_HARD_RE) || []).length + (bomCount - leadingBom) - emojiTagChars),
    isolates: (src.match(CARRIER_ISOLATE_RE) || []).length,
    zwsp,
    wj: (src.match(WJ_RE) || []).length,
  };
}

function stripTags(s) {
  return String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// --- side-tab border context extraction (issue #2: declaration-level matching fired on frames) ---
// Border width declarations are applied per CONTEXT (a CSS rule body, or one inline style
// attribute) SEQUENTIALLY — a later `border:` shorthand resets earlier per-side overrides, which
// is within-block CSS semantics — so the final four side widths reflect the block a browser
// would compute from that source alone. `border-width:` multi-value follows the CSS t/r/b/l
// expansion (1/2/3/4 values). Keyword widths (thin/medium/thick) and non-px units carry no
// literal width and are skipped. Gradient values are skipped — gradient-border owns those.
const BORDER_DECL_RE = /border(?:-(top|right|bottom|left))?(?:-width)?\s*:\s*([^;}]+)/gi;
const FOUR_SIDES = ['top', 'right', 'bottom', 'left'];

function borderContextsOf(src) {
  const blocks = [];
  // Rule bodies inside <style> blocks. One nesting level (@media/@supports wrappers) is
  // tolerated the same way KEYFRAMES_RE tolerates it: inner rules match, the outer at-rule
  // line produces no match because its body cannot satisfy [^{}]*.
  for (const sm of src.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    for (const rm of (sm[1] || '').matchAll(/[^{}]+\{([^{}]*)\}/g)) {
      if (rm[1] && /border/i.test(rm[1])) blocks.push(rm[1]);
    }
  }
  // Inline style attributes — one element context each (same attribute-looseness as classAttrs).
  for (const im of src.matchAll(/style\s*=\s*["']([^"']*)["']/gi)) {
    if (im[1] && /border/i.test(im[1])) blocks.push(im[1]);
  }
  return blocks;
}

function applyBorderDecls(block) {
  const sides = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const m of block.matchAll(BORDER_DECL_RE)) {
    const value = m[2] || '';
    if (/gradient/i.test(value)) continue;
    const w = [...value.matchAll(/(\d+(?:\.\d+)?)\s*px/gi)].map((x) => Number(x[1]));
    if (w.length === 0) continue;
    if (m[1]) {
      sides[m[1]] = w[0]; // border-{side} / border-{side}-width — capture group holds the bare side name
    } else if (/-width\s*:/i.test(m[0])) {
      if (w.length === 1) { sides.top = sides.right = sides.bottom = sides.left = w[0]; }
      else if (w.length === 2) { sides.top = sides.bottom = w[0]; sides.right = sides.left = w[1]; }
      else if (w.length === 3) { sides.top = w[0]; sides.right = sides.left = w[1]; sides.bottom = w[2]; }
      else { sides.top = w[0]; sides.right = w[1]; sides.bottom = w[2]; sides.left = w[3]; }
    } else {
      sides.top = sides.right = sides.bottom = sides.left = w[0]; // border: shorthand — first px is the width
    }
  }
  return sides;
}

export function scanHtmlSource(html) {
  const src = typeof html === 'string' ? html : '';
  const measuredNotes = [];

  // --- gradients (literal only) ---
  const gradientsLiteral = (src.match(GRAD_RE) || []).map((s) => s.trim());
  const gradientVarIndirect = gradientsLiteral.some((g) => /var\(/i.test(g));
  if (gradientVarIndirect) measuredNotes.push('gradient references var() — indirect cascade not resolvable');

  // --- glass ---
  const glassLiteral = (src.match(GLASS_RE) || []).map((s) => s.trim());
  const glassVarIndirect = glassLiteral.some((g) => /var\(/i.test(g));

  // --- keyframes + animation signals ---
  const kfMatches = [...src.matchAll(KEYFRAMES_RE)];
  const kfBodies = kfMatches.map((m) => m[2] || '').join('\n');
  const animationSignals = [];
  if (/scale\s*\(/i.test(kfBodies)) animationSignals.push('scale');
  if (/spin/i.test(kfBodies) || /rotate\s*\(/i.test(kfBodies)) animationSignals.push('rotate');

  // Structured per-keyframe extraction (motion tells). Backward-compat: animationSignals above
  // is unchanged (same regexes on the same joined kfBodies). Each entry = one @keyframes rule with
  // the animated CSS properties we care about. Literal-presence only (spec §5 M1) — no cascade.
  const animations = kfMatches.map((m) => {
    const name = (m[1] || '').toLowerCase();
    const body = m[2] || '';
    const props = [];
    if (/opacity\s*:/i.test(body)) props.push('opacity');
    if (/transform\s*:[^;}]*translate(?:X|3d|Y)/i.test(body)) props.push('translateX');
    if (/scale\s*\(/i.test(body)) props.push('scale');
    if (/rotate\s*\(/i.test(body) || /spin/i.test(name)) props.push('rotate');
    if (/(?:^|[^-])\b(?:left|margin)\s*:/im.test(body)) props.push('left');
    return { name, props };
  });

  // --- motion-tell declaration signals (outside @keyframes bodies) ---
  // bounce/elastic easing: cubic-bezier control point outside [0,1] (overshoot) OR bounce keyword.
  const cbMatches = [...src.matchAll(/cubic-bezier\s*\(([^)]*)\)/gi)];
  const overshoot = cbMatches.some((m) => {
    const parts = (m[1] || '').split(/[, ]+/).map(Number).filter((n) => !Number.isNaN(n));
    return parts.some((n) => n < -0.01 || n > 1.01);
  });
  const easingBounce = overshoot || /\b(?:ease-bounce|elastic|spring|back-out|anticipate|bounce|rubber-band)\b/i.test(src);
  // steps() timing (discrete jumps — blinking cursor tell).
  const easingStep = /steps\s*\(\s*\d+/i.test(src);
  // infinite animation application (pulse/marquee tell — distinguishes from finite entrances).
  const animationInfinite = /\binfinite\b/i.test(src);
  // :hover blocks that scale/rotate (generated-UI hover-transform tell).
  const hoverTransforms = [...src.matchAll(/:hover\s*\{([^}]*)\}/gi)]
    .filter((m) => /transform\s*:[^;}]*\b(?:scale|rotate)\b/i.test(m[1] || '')).length;

  // --- headings ---
  // `italic` exposes raw-inner check for <em>/<i> so signatures can catch the Hallmark gate 38a
  // "italic heading = top AI tell". Scope: tag-based italic only. Inline `style="font-style: italic"`
  // on the heading opener and class-based italic are NOT caught — both need attribute/cascade
  // resolution beyond v1 literal-presence scan (spec §5 M1).
  const headings = [...src.matchAll(HEADING_RE)].map((m) => {
    const raw = m[2] || '';
    return { tag: m[1], text: stripTags(raw), italic: /<(?:em|i)\b/i.test(raw) };
  });

  // --- decorative gradient borders (KLIC-Github research: card top bar / callout left rail) ---
  // Strongest CSS-pattern AI tell, lowest FP: gradient on a border side OR via border-image (the
  // `border-top: 4px solid; border-image: <gradient> 1` two-line idiom). Solid colored bars need
  // hue parsing (deferred — scanner stays literal-presence, not a CSS mini-parser per spec §5 M1).
  const gradientBorders = [...src.matchAll(
    /border-(?:top|right|bottom|left|image(?:-source)?)?\s*:[^;}]*?(?:linear|radial|conic|repeating-linear|repeating-radial)-gradient/gi,
  )].map((m) => m[0].trim());

  // --- side-tab accent borders (Impeccable's "#1 AI-UI tell": thick border on ONE side of a card) ---
  // Complement to gradient-border: this catches the SOLID variant. RULE-BLOCK + INLINE-STYLE
  // scoped (issue #2 — bare declaration-level matching fired on full frames and double rails):
  // every side ≥1px is reported with `maxOther` (the widest of the remaining sides in the same
  // context), and the side-tab SHAPE — one side ≥2px while the others stay hairline — is decided
  // by the signature thresholds. A full 3px frame, a top+bottom double rail, and a 1px footer
  // divider all fail that test. Scope stays literal-presence (spec §5 M1): one block at a time,
  // no selector→element resolution, no cross-rule cascade merge — an accent bar split across two
  // rules for one element is a documented residual.
  const sideTabBorders = [];
  for (const block of borderContextsOf(src)) {
    const sides = applyBorderDecls(block);
    for (const side of FOUR_SIDES) {
      if (sides[side] < 1) continue;
      const maxOther = Math.max(...FOUR_SIDES.filter((s) => s !== side).map((s) => sides[s]));
      sideTabBorders.push({ side, width: sides[side], maxOther });
    }
  }

  // --- text samples (capped) ---
  const textSamples = [];
  for (const tag of TEXT_TAGS) {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    for (const m of src.matchAll(re)) {
      const t = stripTags(m[1]);
      if (t) textSamples.push(t);
      if (textSamples.length >= 64) break;
    }
    if (textSamples.length >= 64) break;
  }

  // --- class attrs + svg icons ---
  const classAttrs = [...src.matchAll(/class\s*=\s*["']([^"']*)["']/gi)].map((m) => m[1]);
  const svgIconCount = (src.match(SVG_RE) || []).length;

  // --- tailwind color utility tokens (class-based palette — issue #1's emerald/amber badges) ---
  // One entry per matching class token; `attrIndex` keys it back to its class attribute so the
  // candy-hue signature can require evidence SPREAD ACROSS elements (one legitimate status
  // banner = several utilities in a single attr) without the scanner grouping further.
  const tailwindColorClasses = [];
  classAttrs.forEach((attr, attrIndex) => {
    for (const token of attr.split(/\s+/)) {
      const base = token.split(':').pop();
      const m = base.match(TW_COLOR_TOKEN_RE);
      if (m) tailwindColorClasses.push({ token: base, hue: m[1], attrIndex });
    }
  });

  // --- body-text emoji (TEXT_TAGS samples; heading emoji is emoji-in-heading's own domain) ---
  // Subdivision flags are stripped BEFORE matching — they are legitimate national symbols, and
  // their base char U+1F3F4 falls inside the pictograph range (multilingual-legit.html FP).
  const bodyEmojiSamples = textSamples
    .filter((t) => t.replace(EMOJI_TAG_SEQ_RE, '').match(PICTOGRAPH_G_RE));

  // --- trusted-by ---
  const hasTrustedBy = /trusted\s+by/i.test(src);

  // --- hidden-unicode carrier counts (shared counter — see countCarriers above) ---
  const carriers = countCarriers(src);
  if (CARRIER_ENTITY_RE.test(src)) {
    measuredNotes.push('entity-encoded carrier forms present (&#8203;-class) — literal-presence scan does not decode entities');
  }

  // --- external cascade: never measurable ---
  if (LINK_RE.test(src)) measuredNotes.push('external <link> stylesheet cascade — not measurable from source');

  return {
    gradientsLiteral,
    gradientVarIndirect,
    glassLiteral,
    glassVarIndirect,
    keyframesLiteral: kfMatches.map((m) => m[1]),
    animationSignals,
    animations,
    easingBounce,
    easingStep,
    animationInfinite,
    hoverTransforms,
    headings,
    gradientBorders,
    sideTabBorders,
    textSamples,
    classAttrs,
    tailwindColorClasses,
    bodyEmojiSamples,
    svgIconCount,
    hasTrustedBy,
    carriers,
    measuredNotes,
  };
}
