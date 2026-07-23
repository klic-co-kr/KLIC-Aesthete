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
const LINK_RE = /<link\b[^>]*rel\s*=\s*["']?stylesheet/gi;

function stripTags(s) {
  return String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
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

  // --- headings ---
  const headings = [...src.matchAll(HEADING_RE)].map((m) => ({ tag: m[1], text: stripTags(m[2]) }));

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

  // --- trusted-by ---
  const hasTrustedBy = /trusted\s+by/i.test(src);

  // --- external cascade: never measurable ---
  if (LINK_RE.test(src)) measuredNotes.push('external <link> stylesheet cascade — not measurable from source');

  return {
    gradientsLiteral,
    gradientVarIndirect,
    glassLiteral,
    glassVarIndirect,
    keyframesLiteral: kfMatches.map((m) => m[1]),
    animationSignals,
    headings,
    textSamples,
    classAttrs,
    svgIconCount,
    hasTrustedBy,
    measuredNotes,
  };
}
