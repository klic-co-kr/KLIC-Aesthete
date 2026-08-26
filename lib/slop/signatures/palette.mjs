// slop palette signatures. P0 = cliché AI gradient stops; P1 = glassmorphism + candy-hue
// Tailwind utilities. Cliché band = HSL hue ∈ [230,340] (indigo→violet→pink). Conservative:
// a gradient fires P0 only if ≥2 distinct cliché-band stops are present. var()-indirect →
// unmeasured (no false-fail).

const HEX_RE = /#([0-9a-f]{3,8})\b/gi;

// Candy hues — the distinctive pastel-dashboard Tailwind tints (see the FP stance on the
// tailwind-candy signature below for what is deliberately NOT in this list).
const CANDY_HUES = ['emerald', 'amber', 'rose', 'violet', 'fuchsia', 'pink', 'cyan', 'teal', 'lime', 'orange', 'sky'];

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  // d is hoisted to function scope: the saturation line below references it when max !== min.
  // (Brief's verbatim text scoped d inside the if-block → ReferenceError; hoisting is the
  // root-cause fix, algorithm unchanged — s short-circuits to 0 exactly when d would be unset.)
  const d = max - min;
  let hue = 0;
  if (max !== min) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  const s = max === min ? 0 : (l > 0.5 ? d / (2 - max - min) : d / (max + min));
  return { h: hue, s, l };
}

// Single color-parsing home for every slop signature (gradient stops, dark-glow shadow layers).
// Returns {h,s,l,a} (s/l/a normalized 0–1, h in degrees) or null for unparseable/named tokens —
// 4/8-digit hex carry alpha in their last pair; 3/6-digit default to a=1.
export function hexToHsl(hex) {
  let h = String(hex).replace('#', '');
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  if (h.length > 6) h = h.slice(0, 6);
  const { h: hue, s, l } = rgbToHsl(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
  return { h: hue, s, l, a };
}

// rgba()/rgb()/hsla()/hsl() literal → {h,s,l,a}; null when the token is neither hex nor a
// function color (named colors are deliberately out — generated output overwhelmingly uses
// hex/rgba, and a named-color table buys FP surface, not coverage).
export function colorToHslA(token) {
  const t = String(token || '').trim().toLowerCase();
  if (t.startsWith('#')) return hexToHsl(t);
  const pct = (v) => (v.endsWith('%') ? Number(v.slice(0, -1)) / 100 : Number(v));
  let m = t.match(/^rgba?\(\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (m) {
    const { h, s, l } = rgbToHsl(pct(m[1]) / 255, pct(m[2]) / 255, pct(m[3]) / 255);
    return { h, s, l, a: m[4] === undefined ? 1 : pct(m[4]) };
  }
  m = t.match(/^hsla?\(\s*([\d.]+)(?:deg)?\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (m) return { h: Number(m[1]), s: Number(m[2]) / 100, l: Number(m[3]) / 100, a: m[4] === undefined ? 1 : pct(m[4]) };
  return null;
}

function clichéStops(gradientLiteral, t) {
  const hueLo = t.hueLo ?? 230;
  const hueHi = t.hueHi ?? 340;
  const sMin = t.sMin ?? 0.25; // chromatic only — exclude near-grey neutrals
  const stops = [...gradientLiteral.matchAll(HEX_RE)].map((m) => hexToHsl(m[1]));
  return stops.filter((c) => c.s >= sMin && c.h >= hueLo && c.h <= hueHi);
}

export const SIGNATURES = [
  {
    id: 'slop.palette.gradient',
    title: 'cliché AI gradient (indigo→violet→pink stops)',
    severity: 'high',
    tier: 'P0',
    needs: ['gradientsLiteral'],
    detect(ctx, t = {}) {
      if (!ctx.gradientsLiteral || ctx.gradientsLiteral.length === 0) return null; // no literal gradient = measured-clean
      if (ctx.gradientVarIndirect) return { unmeasured: true, reason: 'gradient uses var() — cascade not resolvable (C2)' };
      const cliche = ctx.gradientsLiteral.flatMap((g) => clichéStops(g, t));
      const min = t.minClichéStops ?? 2;
      if (cliche.length < min) return null;
      return { signal: cliche.length, threshold: min, nodes: [], remediation: 'replace the indigo→violet→pink gradient with a distinctive hue relationship — this stop band is the default “AI” look' };
    },
  },
  {
    // Class-based candy tinting — issue #1: the KLIC RADIUS a11y card shipped
    // `bg-emerald-100 text-emerald-800` pill badges + amber score/hint spans and the v1 scan
    // read it as 0 slop (class attrs were collected but never consumed). FP stance:
    //   - Neutral scales (slate/gray/zinc/neutral/stone) and legacy primary hues
    //     (blue/red/green/yellow/indigo/purple) are NOT candy — those are every hand-written
    //     Tailwind app's brand/error colors; the default list is the distinctive
    //     pastel-dashboard hues only. `t.hues` replaces the list wholesale — the per-project
    //     allowlist knob (drop 'amber' if your design system uses it legitimately).
    //   - Evidence must span ≥ minAttrs elements (default 2): one legitimate status banner
    //     (`bg-emerald-50 border-emerald-200 text-emerald-800` in a single class attr) is one
    //     deliberate color decision and stays silent; the tell is candy tinting SPRAYED across
    //     pill badges and inline color spans.
    id: 'slop.palette.tailwind-candy',
    title: 'candy-hue Tailwind utility tinting (emerald/amber pill badges + inline color spans — generated-dashboard tell)',
    severity: 'medium',
    tier: 'P1',
    needs: ['tailwindColorClasses'],
    detect(ctx, t = {}) {
      const hues = Array.isArray(t.hues) && t.hues.length > 0 ? t.hues.map(String) : CANDY_HUES;
      const hits = (ctx.tailwindColorClasses || []).filter((c) => hues.includes(c.hue));
      const min = t.minHits ?? 3;
      if (hits.length < min) return null;
      const attrs = new Set(hits.map((c) => c.attrIndex)).size;
      const minAttrs = t.minAttrs ?? 2;
      if (attrs < minAttrs) return null;
      const distinct = [...new Set(hits.map((c) => c.hue))];
      return { signal: hits.length, threshold: min, nodes: [], remediation: `${hits.length} candy-hue Tailwind color utilities across ${attrs} element(s) (${distinct.join('·')}) — pastel emerald/amber/rose tinting on pill badges and inline spans is the generated-dashboard default; commit to one restrained accent hue and neutral surfaces for chrome` };
    },
  },
  {
    id: 'slop.palette.glass',
    title: 'glassmorphism surface (backdrop-filter)',
    severity: 'medium',
    tier: 'P1',
    needs: ['glassLiteral'],
    detect(ctx, t = {}) {
      if (!ctx.glassLiteral || ctx.glassLiteral.length === 0) return null;
      if (ctx.glassVarIndirect) return { unmeasured: true, reason: 'backdrop-filter uses var() — not resolvable (C2)' };
      const min = t.minGlass ?? 1;
      if (ctx.glassLiteral.length < min) return null;
      return { signal: ctx.glassLiteral.length, threshold: min, nodes: [], remediation: 'drop backdrop-filter as the primary surface treatment — glassmorphism reads as a template default' };
    },
  },
  {
    id: 'slop.palette.gradient-border',
    title: 'gradient on a border side (card top bar / callout left rail — AI tell per KLIC-Github research)',
    severity: 'medium',
    tier: 'P1',
    needs: ['gradientBorders'],
    detect(ctx, t = {}) {
      const list = ctx.gradientBorders || [];
      if (list.length === 0) return null;
      const min = t.minGradientBorders ?? 1;
      if (list.length < min) return null;
      return { signal: list.length, threshold: min, nodes: [], remediation: `gradient border${list.length > 1 ? 's' : ''} (${list.length}) — the colored/gradient top-bar or left-rail reads as a templated-editorial default; replace with solid surface + inset depth, use typography for emphasis` };
    },
  },
  {
    // overused-font: P2 advisory by design — a deliberate Inter body under a distinctive
    // display face is defensible, so this reports without gating. Exact-match on the family
    // name (quote-stripped, lowercased by the scanner): "Inter Display" is a different cut
    // and does not fire — absence of a fuzzy match is the conservative choice.
    id: 'slop.palette.overused-font',
    title: 'overused default font stack (Inter / Space Grotesk / Geist / Instrument Serif)',
    severity: 'low',
    tier: 'P2',
    needs: ['fontFamilies'],
    detect(ctx, t = {}) {
      const list = Array.isArray(t.families) && t.families.length > 0
        ? t.families.map((f) => String(f).toLowerCase())
        : ['inter', 'space grotesk', 'geist', 'instrument serif'];
      const found = [...new Set((ctx.fontFamilies || []).filter((f) => list.includes(f)))];
      const min = t.minFamilies ?? 1;
      if (found.length < min) return null;
      return { signal: found.length, threshold: min, nodes: [], remediation: `default-reach font (${found.join(', ')}) — these four faces headline every list of AI design tells; exhausted by being the default reach. Pick a face that argues for the subject — that is the difference between a designed page and a generated one` };
    },
  },
];
