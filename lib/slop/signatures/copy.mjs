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

import { CARRIER_DEFAULT_THRESHOLDS, clampCarrierThreshold, normalizeDashEntities } from '../html-source-scan.mjs';

// Visible-copy haystack shared by the copy signatures: body samples (TEXT_TAGS)
// + heading text. <title>/comments/attributes are outside this haystack by construction — that
// boundary is load-bearing (the tailwind-legit FP fixture's two em dashes live in <title> and
// an HTML comment, and must stay invisible to copy.em-dash).
const visibleText = (ctx) => [
  ...(ctx.textSamples || []),
  ...(ctx.headings || []).map((h) => (h && h.text) || ''),
];

// 2026-08 copy-axis expansion — literal-regex tells:
// lorem / em-dash / oversized-number / not-x-but-y / apologetic-error / live-clock-eyebrow.
// Cross-signature boundary: dash RUNS (2+) belong to decoration.decorative-divider; a single
// em dash is copy.em-dash. Percent/K/M/B-suffixed numbers are fake-precision's neighborhood,
// not oversized-number's.

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
    detectionMode: 'llm-only',
    needs: ['textSamples'],
    detect() {
      // v2: LLM judge over headings + sampled text, content-hash cached. Until then, unmeasured.
      return { unmeasured: true, reason: 'copy.generic requires the LLM judge (v2) — not evaluated' };
    },
  },
  {
    // Detection port of watermarks-remover Layer A (guillaumemeyer/watermarks-remover):
    // edit-based LLM watermark schemes embed marks in invisible unicode codepoints. Their
    // presence in raw HTML source is deterministic evidence the text passed through an LLM —
    // the highest-confidence slop tell the scanner can make without a judge. Four tiers
    // (adversarial-review-calibrated, all conservative): HARD (tag chars minus emoji tag
    // sequences, bidi embedding/override, mid-source BOM) at 1; isolates at 6 codepoints
    // (three full RTL pairs — bilingual pages stay silent); ZWSP at 5 (URL-break ZWSP after
    // '/' excluded at the scanner); WJ at 3 (single "Fig\u20601" no-break is typography).
    // Legit invisible chars (ZWJ/ZWNJ/SHY/PUA/VS16) are excluded at the scanner level —
    // see CARRIER_*_RE in html-source-scan.mjs.
    // Removal: stripCarriers() in lib/slop.mjs removes hard + ZWSP (non-URL) + WJ only —
    // isolates are direction-bearing and stay (manual review when that tier fires).
    id: 'slop.copy.hidden-carrier',
    title: 'invisible unicode watermark carriers (zero-width/tag/bidi — LLM edit-mark remnant)',
    severity: 'medium',
    tier: 'P2',
    needs: ['carriers'],
    detect(ctx, t = {}) {
      const c = ctx.carriers || { hard: 0, isolates: 0, zwsp: 0, wj: 0 };
      // Clamp + defaults come from the shared scanner consts — stripCarriers gates on the
      // exact same numbers, so detection and removal can never disagree on the evidence bar.
      const minHard = clampCarrierThreshold(t.minHard, CARRIER_DEFAULT_THRESHOLDS.minHard);
      const minIsolates = clampCarrierThreshold(t.minIsolates, CARRIER_DEFAULT_THRESHOLDS.minIsolates);
      const minZwsp = clampCarrierThreshold(t.minZwsp, CARRIER_DEFAULT_THRESHOLDS.minZwsp);
      const minWj = clampCarrierThreshold(t.minWj, CARRIER_DEFAULT_THRESHOLDS.minWj);
      const hardFires = c.hard >= minHard;
      const isoFires = c.isolates >= minIsolates;
      const zwspFires = c.zwsp >= minZwsp;
      const wjFires = c.wj >= minWj;
      if (!hardFires && !isoFires && !zwspFires && !wjFires) return null;
      const parts = [];
      if (hardFires) parts.push(`${c.hard} hard carrier(s) (tag/bidi-override/mid-source BOM)`);
      if (zwspFires) parts.push(`${c.zwsp} zero-width space(s)`);
      if (wjFires) parts.push(`${c.wj} word joiner(s)`);
      if (isoFires) parts.push(`${c.isolates} bidi isolate(s) — verify RTL intent before acting`);
      // threshold reports the criterion that fired (hard > zwsp > wj > isolates precedence)
      const threshold = hardFires ? minHard : zwspFires ? minZwsp : wjFires ? minWj : minIsolates;
      // Isolate-only firing gets a manual-review remediation — --strip can NEVER remove
      // isolates (direction-bearing), so recommending it there would be a guaranteed no-op.
      const strippableFires = hardFires || zwspFires || wjFires;
      const action = strippableFires
        ? `${strippableFires && !isoFires
            ? 'strip deterministically'
            : 'strip strippable classes with'} 'bun lib/slop.mjs <file> <out.html> --strip' (removes hard+ZWSP+WJ that reached threshold)`
        : 'manual review only — --strip cannot remove isolates (direction-bearing)';
      return {
        signal: c.hard + c.zwsp + c.wj + c.isolates,
        threshold,
        nodes: [],
        remediation: `${parts.join(' + ')} — invisible unicode watermark carriers are edit-based LLM-mark residue (watermarks-remover Layer A class); ${action}; isolates, emoji tag sequences, leading BOM, and carriers inside <script>/<style> are never auto-stripped — those are manual review`,
      };
    },
  },
  {
    // lorem: both phrases, case-insensitive; either alone fires. P1 — an unambiguous
    // generated-and-never-reviewed artifact, not a judgment call (shipping filler is
    // always wrong).
    id: 'slop.copy.lorem',
    title: 'lorem-ipsum filler copy (abandoned template wearing the layout)',
    severity: 'medium',
    tier: 'P1',
    needs: ['textSamples', 'headings'],
    detect(ctx, t = {}) {
      const phrases = (t.phrases || ['lorem ipsum', 'dolor sit amet']).map((p) => String(p).toLowerCase());
      // Per-sample, never a join: "lorem</p><p>ipsum" must not manufacture a phrase.
      const hits = visibleText(ctx).filter((s) => phrases.some((p) => s.toLowerCase().includes(p)));
      const min = t.minHits ?? 1;
      if (hits.length < min) return null;
      return { signal: hits.length, threshold: min, nodes: [], remediation: 'lorem-ipsum filler in a finished screen means the design was never finished — replace with short, specific text in the product’s own domain' };
    },
  },
  {
    // em-dash: single em dash only (raw U+2014, &mdash;, &#8212;, &#x2014;) or a SPACED en
    // dash used as an em-dash substitute; unspaced ranges (Mon-Fri) are legitimate. Runs of
    // 2+ dashes are decoration.decorative-divider's finding. P2 advisory: editorial English
    // earns one occasionally — the TELL is density, and minHits is the knob for that judgment.
    id: 'slop.copy.em-dash',
    title: 'em dash in interface copy (the most recognizable generated-text tell)',
    severity: 'low',
    tier: 'P2',
    needs: ['textSamples', 'headings'],
    detect(ctx, t = {}) {
      // Per-sample with entity normalization: &mdash;/&#8212;/&#x2014; become raw '—' FIRST, so
      // an entity RUN lands in decorative-divider (its owner) and never counts as singles here.
      // The spaced-en check is also per-sample — a joined haystack could weld ' – </p><p>– '
      // into matches no single element contains.
      let hits = 0;
      for (const raw of visibleText(ctx)) {
        const s = normalizeDashEntities(raw);
        hits += (s.match(/(?<!—)—(?!—)/g) || []).length;
        hits += (s.match(/\s–\s/g) || []).length;
      }
      const min = t.minHits ?? 1;
      if (hits < min) return null;
      return { signal: hits, threshold: min, nodes: [], remediation: `${hits} em dash${hits > 1 ? 'es' : ''} in interface copy — the mid-sentence em dash is the most recognizable generated-text tell; interface copy wants commas, colons, and periods, not essayistic asides` };
    },
  },
  {
    // oversized-number: ≥10,000 rendered raw (comma-grouped or 5+ digits), currency symbol
    // optional. %/K/M/B-suffixed numbers are spared (abbreviated, or fake-precision's
    // neighborhood). FP stance: raw comma-grouped amounts are standard typography in some
    // locales (e.g. Korean 원 amounts) — this stays P2 advisory for that reason; dashboards
    // that should abbreviate are the target, not financial documents.
    id: 'slop.copy.oversized-number',
    title: 'un-abbreviated oversized figure (≥10,000 typeset raw)',
    severity: 'low',
    tier: 'P2',
    needs: ['textSamples', 'headings'],
    detect(ctx, t = {}) {
      const min = t.minHits ?? 1;
      const floor = t.minValue ?? 10000;
      const hits = [];
      // Per-sample so the suffix-spared lookahead reads the SAME element's text — a join
      // could put the next element's '%' after a figure this element never carried.
      for (const text of visibleText(ctx)) {
        for (const m of text.matchAll(/(?<![\d.,])\d{1,3}(?:,\d{3})+|(?<![\d.,])\d{5,}/g)) {
          const value = Number(m[0].replace(/,/g, ''));
          if (value < floor) continue;
          // suffix-spared: %, K/M/B (optionally space-separated) directly after the figure
          const after = text.slice((m.index || 0) + m[0].length);
          if (/^\s*[%kKmMbB]/.test(after)) continue;
          hits.push(m[0]);
        }
      }
      if (hits.length < min) return null;
      return { signal: hits.length, threshold: min, nodes: [], remediation: `${hits.length} oversized figure${hits.length > 1 ? 's' : ''} (${hits.slice(0, 3).join(', ')}) typeset raw — designed dashboards abbreviate magnitude ($1.8M, 47k) so the number stays scannable; a raw 7-digit figure reads as a database dump` };
    },
  },
  {
    // not-x-but-y: the manufactured rebuttal rhythm "it's not (just) X, it's Y" — the most
    // recognized generated-copy cadence; contrast as a tic. P2: occasionally a writer earns
    // it, so it reports for judgment rather than gating.
    id: 'slop.copy.not-x-but-y',
    title: '"not just X, it’s Y" rebuttal cadence',
    severity: 'low',
    tier: 'P2',
    needs: ['textSamples', 'headings'],
    detect(ctx, t = {}) {
      // Per-sample: the cadence must live inside ONE element. Typographic apostrophe (U+2019)
      // included — it is the default in generated copy, a straight-only pattern would miss it.
      const re = /\b(?:it['’]?s|this is|that['’]?s|we['’]?re|they['’]?re)\s+not\s+(?:just|only|merely|about)?\s*[^,.;:!?]{1,80}[,;]?\s*(?:it['’]?s|it is|but rather)\b/i;
      const hits = visibleText(ctx).filter((s) => re.test(s)).length;
      const min = t.minHits ?? 1;
      if (hits < min) return null;
      return { signal: hits, threshold: min, nodes: [], remediation: 'the "not just X, it’s Y" cadence is the most recognized generated-copy rhythm — if the difference matters, specifics carry it; the construction is what remains when they are missing' };
    },
  },
  {
    // apologetic-error: "Oops"/"Whoops"/"Uh oh"/"something went wrong" — the template default
    // error that names no failure and offers no next step. Errors are guidance surfaces,
    // not mood management.
    id: 'slop.copy.apologetic-error',
    title: 'apologetic error copy ("Oops! Something went wrong")',
    severity: 'low',
    tier: 'P2',
    needs: ['textSamples', 'headings'],
    detect(ctx, t = {}) {
      const re = /\b(?:oops|whoops|uh[\s-]?oh)\b|something\s+went\s+wrong/i;
      // Per-sample — same element-boundary rule as not-x-but-y ("something</p><p>went wrong"
      // is two fragments, not an apologetic error message).
      const hits = visibleText(ctx).filter((s) => re.test(s)).length;
      const min = t.minHits ?? 1;
      if (hits < min) return null;
      return { signal: hits, threshold: min, nodes: [], remediation: 'apologetic error copy helps no one — name what failed and the next step ("Couldn’t save. Check your connection and retry.")' };
    },
  },
  {
    // live-clock: WHOLE-TEXT equality on a sampled text element — optional leading status
    // dot, LIVE/NOW token, optional separator + clock time. The equality is the safety:
    // "Departs 09:41", "LIVE STREAM setup", and any time not fronted by LIVE/NOW never
    // match. Sampled TEXT_TAGS (p/li/span/button/a/td) are the eligible small-element set;
    // heading-tag eyebrows are out (headings fail the whole-text shape anyway).
    id: 'slop.copy.live-clock',
    title: '"LIVE · HH:MM" decorative status eyebrow',
    severity: 'low',
    tier: 'P2',
    needs: ['textSamples'],
    detect(ctx, t = {}) {
      const full = /^(?:[●•・·]\s*)?(?:live|now)\b\s*(?:[·|/—–-]\s*)?(?:\d{1,2}:\d{2}(?:\s*[ap]\.?m\.?)?)?\s*$/i;
      const hits = (ctx.textSamples || []).filter((s) => full.test(String(s).replace(/\s+/g, ' ').trim()));
      const min = t.minHits ?? 1;
      if (hits.length < min) return null;
      return { signal: hits.length, threshold: min, nodes: [], remediation: `"${hits[0]}" — the device status bar already shows the time, and a LIVE dot badge on a mockup is decorative urgency no data supports; drop the eyebrow` };
    },
  },
];
