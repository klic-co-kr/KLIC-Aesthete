// Anti-slop GENERATION constraints — pure data, deterministic (no Date/random).
// The PREVENTION layer (spec §3). Medium-keyed: universal bans + format-specific extras.
// Mirrors preflight NEGATION_SPEC domain-scoping (lib/preflight.mjs): html-only tells don't
// leak into svg/pptx. v1 populates html; other media return universal only (v2 extends).

// Universal across every medium (the cross-format AI-slop tells).
const UNIVERSAL = {
  bullets: [
    'Avoid the indigo→pink/violet cliché gradient (#6366f1/#8b5cf6/#a855f7 → #ec4899/#d946ef) — the default "AI" look.',
    'No emoji inside heading text — decoration belongs outside the heading, not inside it.',
    'No glassmorphism (backdrop-filter blur) panels as the primary surface treatment.',
    'No "Trusted by …" logo strip with invented company names or fabricated metrics (+N%, 10×, 50,000+).',
  ],
  negation: {
    palette: ['cliché indigo→pink/violet gradient stops'],
    decoration: ['emoji inside heading text', 'glassmorphism (backdrop-filter) panels as primary surface'],
    template: ['"Trusted by" logo strip with fabricated names/metrics'],
    copy: ['invented metrics/testimonials/counts (+47%, 10×, 50,000+)'],
  },
};

// Format-specific extras (v1 = html only). svg/pptx/docx/image = [] in v1 (v2).
const MEDIUM_EXTRA = {
  html: {
    bullets: [
      'No decorative scale/spin keyframe animations on static content (motion must serve meaning).',
      'No icon saturation — do not stack lucide/svg icons beyond what the prose needs.',
    ],
    negation: {
      decoration: ['decorative scale/spin @keyframes on static content', 'excessive lucide/svg icon saturation'],
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
