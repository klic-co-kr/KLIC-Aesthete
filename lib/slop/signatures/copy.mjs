// slop copy signatures. P2 = lexicon cliché words + fake-precision metrics (regex, v1).
// generic = LLM judge (v2 stub → always unmeasured; never fires, never gates).
// Conservative + overridable.
//
// FAKE-PRECISION regex targets two research-attested patterns (KLIC-Github ai-tells-sample.html
// footer + rule-callout-sample.html principle): many-9 percentages (99.9% / 99.99% uptime) and
// round multipliers (10x / 100x faster). Conservative — only fires on `\d+0x` (digit-run ending
// in 0 before x), so measured values like `3.1x`, `2x`, `1.5x` do NOT fire; only round-number
// multipliers (10x, 20x, 100x, 1000x) do. `\b9{2,}\.\d+%` requires ≥2 leading 9s, so `47.2%`
// and `9.1%` do NOT fire. Trade-off: `3.0x` would fire (rare in real copy).
//
// v2 candidates from the same research + Hallmark (nutlope/hallmark slop-test.md) — NOT
// implemented because they need scanner CSS-rule extraction (spec §5 M1 excludes from v1
// literal-presence scan) or new context fields:
//   - card-top colored bar / gradient stripe (border-top: Npx solid <hue> | <gradient>) — KLIC-Github
//   - callout left color rail (border-left: Npx solid <hue>) — KLIC-Github
//   - 4-color state tinting (`.warn`/`.danger`/`.info` with distinct bg/border hues — the
//     "4색 무지개 AI tell" named in rule-callout-sample.html) — KLIC-Github
//   - italic heading / display type (Hallmark gate 38a — "italic headers are a top AI tell").
//     HTML-detectable: <em>/<i> inside <h1>-<h6>, or inline style="font-style: italic" on a
//     heading. Needs scanner change: expose raw heading inner-HTML (currently only stripped
//     text), or a dedicated `italicHeadings` context field.
//
// Lexicon haystack covers BOTH ctx.textSamples (body copy) AND ctx.headings (h1–h6 text) — a
// cliché in a heading is at least as strong a slop tell as one in body copy, and the prior
// textSamples-only scan silently missed <h1>Unleash the power</h1>. Mirrors decoration.emoji-in-heading,
// which already reads ctx.headings directly.
//
// Separator normalization collapses whitespace + dash variants (ASCII '-' plus U+2010–U+2015:
// hyphen, non-breaking hyphen, en/em dashes) to a single '-' BEFORE matching, so the lexicon
// entry "cutting-edge" also matches "cutting edge" and "cutting–edge". Pure substring match is
// otherwise preserved (catches inflections: delve/delved/delving). Case normalized on both sides
// so a caller-supplied t.lexicon entry in any case still matches the lowercased haystack.

const DEFAULT_LEXICON = [
  'delve', 'unleash', 'leverage', 'robust', 'cutting-edge', 'seamless',
  'game-changer', 'revolutionary', 'empower', 'synergy', 'streamline',
  'elevate', // research-attested: ai-tells-sample.html footer forbids "Elevate/Seamless" copy
  // Hallmark (nutlope/hallmark copy.md "Banned opening lines" + "Microcopy bans") — explicit
  // AI-distribution-default phrases. FP risk assessed: skipped `transform`/`delight`/`magical`
  // (collide with legitimate vocabulary) and `next-generation` (legit technical: NGS/firewalls).
  'supercharge',
  'reimagine',
  'innovative solutions',
  'built for the modern team',
  "in today's digital landscape",
];

const SEPARATOR_RE = /[\s\u2010-\u2015\-]+/g;
const normalize = (s) => String(s).toLowerCase().replace(SEPARATOR_RE, '-');

// Many-9 percent (99.9%, 99.99%) OR round multiplier (10x, 100x, 1000x — `\d+0x`).
// Leading `\b` only — trailing `\b` fails on `%`-to-space (both non-word); see header comment.
const FAKE_PRECISION_RE = /\b(?:9{2,}\.\d+%|\d+0x)/gi;

export const SIGNATURES = [
  {
    id: 'slop.copy.lexicon',
    title: 'cliché LLM marketing lexicon',
    severity: 'low',
    tier: 'P2',
    needs: ['textSamples', 'headings'],
    detect(ctx, t = {}) {
      const lex = t.lexicon || DEFAULT_LEXICON;
      const parts = [
        ...(ctx.textSamples || []),
        ...(ctx.headings || []).map((h) => (h && h.text) || ''),
      ];
      const hay = normalize(parts.join(' '));
      const hits = lex.filter((w) => hay.includes(normalize(w)));
      const min = t.minHits ?? 1;
      if (hits.length < min) return null;
      return { signal: hits.length, threshold: min, nodes: [], remediation: `cliché lexicon (${hits.slice(0, 4).join(', ')}${hits.length > 4 ? '…' : ''}) — replace with concrete language: name the vertical, place, or deliverable; refuse the marketing verb (Hallmark voice rule: "Creative direction for culture since 2003", not "Unleash your creativity")` };
    },
  },
  {
    id: 'slop.copy.fake-precision',
    title: 'fake-precision metrics (many-9 % or round multipliers — too clean to be measured)',
    severity: 'low',
    tier: 'P2',
    needs: ['textSamples', 'headings'],
    detect(ctx, t = {}) {
      const parts = [
        ...(ctx.textSamples || []),
        ...(ctx.headings || []).map((h) => (h && h.text) || ''),
      ];
      const matches = parts.join(' ').match(FAKE_PRECISION_RE) || [];
      const min = t.minHits ?? 1;
      if (matches.length < min) return null;
      const uniq = [...new Set(matches.map((m) => m.toLowerCase()))];
      return { signal: matches.length, threshold: min, nodes: [], remediation: `fake-precision metrics (${uniq.slice(0, 4).join(', ')}${uniq.length > 4 ? '…' : ''}) — many-9 percentages and round multipliers read as invented; substitute measured values (e.g. 47.2%, 3.1×)` };
    },
  },
  {
    id: 'slop.copy.generic',
    title: 'generic templated copy (LLM judge)',
    severity: 'low',
    tier: 'P2',
    needs: ['textSamples'],
    detect() {
      // v2: LLM judge over headings + sampled text, content-hash cached. Until then, unmeasured.
      return { unmeasured: true, reason: 'copy.generic requires the LLM judge (v2) — not evaluated' };
    },
  },
];
