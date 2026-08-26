// slop imagery signatures — 5th sub-axis (2026-08). P1 = placeholder-service <img> src
// (lorem ipsum for pictures) and broken/template src (missing, empty, mustache slot,
// path/to/). Reads the scanner's raw <img> tags; every src interpretation lives here,
// not in the scanner.

// src extractor — null when the tag carries no src attribute at all. The left boundary
// ((?:^|\s)) keeps `data-src`/`srcset` from matching (`\b` alone would split at the hyphen),
// and the three value forms cover double-quoted, single-quoted, and UNQUOTED (valid
// minified HTML5 — an unquoted real src must not read as "missing").
const SRC_OF_RE = /(?:^|\s)src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const srcOf = (tag) => {
  const m = String(tag).match(SRC_OF_RE);
  if (!m) return null;
  return m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3];
};

// Placeholder-service hosts. Real photo CDNs (images.unsplash.com, images.pexels.com) are
// deliberately absent — a real photo is a real photo regardless of CDN. The leading \b keeps
// the match from starting mid-DNS-label ('notpicsum.photos' is one label and must not fire).
// Documented residual: a hyphenated look-alike label ('evil-picsum.photos') still matches —
// a real domain squat, not HTML copy.
const PLACEHOLDER_HOST_RE = /\b(?:[a-z0-9-]+\.)*(?:pravatar\.cc|randomuser\.me|ui-avatars\.com|api\.dicebear\.com|placekitten\.com|placehold\.(?:co|it)|via\.placeholder\.com|placeimg\.com|dummyimage\.com|fakeimg\.pl|lorempixel\.com|loremflickr\.com|picsum\.photos|source\.unsplash\.com)/i;

// Broken-src literals: exact values (missing/empty/#/about:blank/undefined/null/todo) plus
// template-slot and stand-in patterns.
const BROKEN_LITERALS = new Set(['', '#', 'about:blank', 'undefined', 'null', 'todo']);
const BROKEN_PATTERN_RE = /path\/to\/|your-image-here|placeholder\.\.\.|\{\{|\[\[|example\.com\/(?:placeholder|img|image)/i;

// Resolver slots a host pipeline sanctions and fills after generation:
// data-photo-query, data-photo-placeholder, data-illustration, data-attachment-ref.
const RESOLVER_SLOT_RE = /\bdata-(?:photo-query|photo-placeholder|illustration|attachment-ref)\b/i;

export const SIGNATURES = [
  {
    // placeholder-src: P1 — placeholder imagery is the single strongest "this screen was
    // never finished with real assets" tell, and several of these services rotate or die —
    // the design literally changes under you.
    id: 'slop.imagery.placeholder-src',
    title: 'placeholder-service image src (picsum/pravatar/placehold/…)',
    severity: 'medium',
    tier: 'P1',
    needs: ['imgTags'],
    detect(ctx, t = {}) {
      const re = t.pattern instanceof RegExp ? t.pattern : PLACEHOLDER_HOST_RE;
      const hits = (ctx.imgTags || []).filter((tag) => {
        const src = srcOf(tag);
        return src !== null && re.test(src);
      });
      const min = t.minHits ?? 1;
      if (hits.length < min) return null;
      return { signal: hits.length, threshold: min, nodes: [], remediation: `${hits.length} placeholder-service <img> — placeholder imagery is lorem ipsum for pictures; use a real asset (local file or a real photo CDN), not a rotating placeholder service` };
    },
  },
  {
    // broken-src: a missing image beats a broken one — missing/empty src, template mustache
    // slots, path/to/ stand-ins, example.com placeholder hosts. Resolver-slot imgs
    // (data-photo-query etc.) are sanctioned — a pipeline fills them.
    id: 'slop.imagery.broken-src',
    title: 'broken image src (missing / empty / template slot / path-to stand-in)',
    severity: 'medium',
    tier: 'P1',
    needs: ['imgTags'],
    detect(ctx, t = {}) {
      const hits = (ctx.imgTags || []).filter((tag) => {
        if (RESOLVER_SLOT_RE.test(tag)) return false; // sanctioned: pipeline fills src + alt
        const src = srcOf(tag);
        if (src === null) return true; // no src attribute at all
        const v = src.trim();
        if (BROKEN_LITERALS.has(v.toLowerCase())) return true;
        return BROKEN_PATTERN_RE.test(v);
      });
      const min = t.minHits ?? 1;
      if (hits.length < min) return null;
      return { signal: hits.length, threshold: min, nodes: [], remediation: `${hits.length} <img> with a broken src — the broken-image glyph is the fastest way a screen reads as generated and unreviewed; a missing image beats a broken one (drop the tag or fill a real src)` };
    },
  },
];
