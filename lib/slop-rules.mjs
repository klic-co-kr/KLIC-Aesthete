// Anti-slop GENERATION constraints — pure data, deterministic (no Date/random).
// The PREVENTION layer (spec §3). Medium-keyed: universal bans + format-specific extras.
// Mirrors preflight NEGATION_SPEC domain-scoping (lib/preflight.mjs): html-only tells don't
// leak into svg/pptx. v1 populates html; other media return universal only (v2 extends).

// Universal across every medium (the cross-format AI-slop tells).
const UNIVERSAL = {
  bullets: [
    'Avoid the indigo→pink/violet cliché gradient (#6366f1/#8b5cf6/#a855f7 → #ec4899/#d946ef) — the default "AI" look.',
    'No emoji inside heading text — decoration belongs outside the heading, not inside it.',
    'No emoji inside body/UI copy — inline pictographs (⚠ ✅ 🔥) in prose or labels read as generated decoration; carry the signal in wording, not a glyph.',
    'No glassmorphism (backdrop-filter blur) panels as the primary surface treatment.',
    'No "Trusted by …" logo strip with invented company names or fabricated metrics (+N%, 10×, 50,000+).',
    'No invisible unicode watermark carriers in emitted text (zero-width spaces, tag characters, bidi overrides) — edit-based LLM-mark residue; emit plain visible characters only.',
    // --- 2026-08 copy-axis tells (medium-independent). ---
    'No lorem-ipsum filler — short, specific copy in the product’s own domain; filler means the design was never finished.',
    'No em dashes in interface copy — the mid-sentence em dash is the most recognizable generated-text tell; use commas, colons, periods.',
    'Abbreviate oversized figures (≥10,000 → 1.8M / 47k) — raw 7-digit numbers read as a database dump.',
    'No apologetic error copy ("Oops! Something went wrong") — name what failed and the next step.',
    'No "not just X, it’s Y" rebuttal cadence — if the difference matters, specifics carry it.',
    'No default-reach fonts (Inter, Space Grotesk, Geist, Instrument Serif) — pick a face that argues for the subject.',
  ],
  negation: {
    palette: ['cliché indigo→pink/violet gradient stops', 'Inter/Space Grotesk/Geist/Instrument Serif default font reach'],
    decoration: ['emoji inside heading text', 'emoji inside body/UI copy', 'glassmorphism (backdrop-filter) panels as primary surface'],
    template: ['"Trusted by" logo strip with fabricated names/metrics'],
    copy: [
      'invented metrics/testimonials/counts (+47%, 10×, 50,000+)',
      'invisible unicode watermark carriers (zero-width/tag/bidi codepoints)',
      'lorem-ipsum filler copy',
      'em dashes in interface copy',
      'raw ≥10,000 figures (abbreviate as 1.8M/47k)',
      'apologetic error copy ("Oops! something went wrong")',
      '"not just X, it’s Y" rebuttal cadence',
    ],
  },
};

// Format-specific extras (v1 = html only). svg/pptx/docx/image = [] in v1 (v2).
const MEDIUM_EXTRA = {
  html: {
    bullets: [
      'No decorative scale/spin keyframe animations on static content (motion must serve meaning).',
      'No icon saturation — do not stack lucide/svg icons beyond what the prose needs.',
      'No candy-hue Tailwind utility tinting (bg-emerald-100/text-emerald-800 pill badges, amber/rose inline color spans) — pick one restrained accent hue; neutral surfaces for chrome.',
      'No thick single-side card borders (border-top/left 2px+ while the other sides stay hairline — the #1 AI-UI tell) — separate cards with a hover lift (translateY(-2px) + stronger box-shadow) or an internal tag badge, not a one-side colored bar. 1px dividers and full borders are fine.',
      // --- CSS/DOM tells (detection = lib/slop/signatures/decoration.mjs + imagery.mjs;
      // these bullets are the prevention mirror). ---
      'No saturated wide-blur glow shadows (the neon dark-SaaS halo) — neutral elevation shadows only (e.g. 0 1px 2px rgba(0,0,0,0.24)).',
      'No repeating-gradient stripes or hollow outlined type (text-stroke + transparent fill) — flat tones and solid fills.',
      'Single-value border-radius stays 8–24px — 40px+ corners turn cards into blobs.',
      'Name motion properties explicitly (transform/opacity) — never transition: all, layout properties (width/top/margin), or non-compositable will-change.',
      'Every <img> has a real src and an alt — no placeholder-service URLs (picsum/pravatar/placehold), no empty/path-to/{{template}} src.',
    ],
    negation: {
      palette: ['candy-hue Tailwind utility classes (emerald/amber/rose pill badges + inline tint spans)'],
      decoration: [
        'thick single-side card border (border-top/left 2px+ accent bar on a hairline card — hover lift or internal badge instead)',
        'decorative scale/spin @keyframes on static content',
        'excessive lucide/svg icon saturation',
        'saturated wide-blur glow shadow (neon dark-SaaS halo)',
        'repeating-gradient stripe surface',
        'hollow outlined type (text-stroke + transparent fill)',
        '40–120px blob border-radius',
        'transition: all / layout-property transitions / non-compositable will-change',
      ],
      template: [
        'placeholder-service <img> src (picsum/pravatar/placehold/…)',
        'broken or template-slot <img> src',
      ],
    },
  },
};

// Per-key union with array-concat (mirrors the merge concern already used internally
// for UNIVERSAL+medium). Exported so callers that need to merge a medium's negation
// onto an existing negation (e.g. skill-pre onto preflight's NEGATION_SPEC) do a
// per-key CONCAT, not a key-level REPLACE that drops the prior richer entry.
export function mergeNeg(a, b) {
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    out[k] = [...(a[k] || []), ...(b[k] || [])];
  }
  return out;
}

export function getRules(medium) {
  const extra = (medium && MEDIUM_EXTRA[medium]) || { bullets: [], negation: {} };
  return {
    bullets: [...UNIVERSAL.bullets, ...extra.bullets],
    negation: mergeNeg(UNIVERSAL.negation, extra.negation),
  };
}
