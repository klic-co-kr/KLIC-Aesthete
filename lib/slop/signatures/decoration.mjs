// slop decoration signatures. P0 = emoji inside heading text; P1 = icon saturation, decorative animation.
// Thresholds conservative + overridable. "Uncalibrated" — corpus tuning is v2 (spec §6 H2).

// Pragmatic emoji detection: pictographic/dingbat/symbol ranges. Good enough for the cliché tell;
// not a full Unicode emoji parser. Deterministic.
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u;

export const SIGNATURES = [
  {
    id: 'slop.decoration.emoji-in-heading',
    title: 'emoji inside heading text',
    severity: 'high',
    tier: 'P0',
    needs: ['headings'],
    detect(ctx, t = {}) {
      const heads = (ctx.headings || []).filter((h) => EMOJI_RE.test(h.text));
      const min = t.minEmojiHeadings ?? 1;
      if (heads.length < min) return null;
      return { signal: heads.length, threshold: min, nodes: [], remediation: 'remove emoji from heading text — decoration belongs outside the heading, not inside it' };
    },
  },
  {
    id: 'slop.decoration.italic-heading',
    title: 'italic heading / display type (Hallmark gate 38a — names this a top AI tell)',
    severity: 'medium',
    tier: 'P1',
    needs: ['headings'],
    detect(ctx, t = {}) {
      const heads = (ctx.headings || []).filter((h) => h && h.italic);
      const min = t.minItalicHeadings ?? 1;
      if (heads.length < min) return null;
      return { signal: heads.length, threshold: min, nodes: [], remediation: `italic heading text (${heads.length}) — italic display type is a top AI tell; emphasis comes from weight, accent colour, or a drawn underline, not italic. Roman for all h1–h6, wordmarks, hero stats, and pull quotes` };
    },
  },
  {
    id: 'slop.decoration.icon-saturation',
    title: 'icon saturation (excessive svg/icon glyphs)',
    severity: 'medium',
    tier: 'P1',
    needs: ['svgIconCount'],
    detect(ctx, t = {}) {
      const n = ctx.svgIconCount || 0;
      const min = t.minIcons ?? 12; // conservative; corpus-tuned value is v2
      if (n < min) return null;
      return { signal: n, threshold: min, nodes: [], remediation: `${n} svg/icon glyphs — icon saturation reads as templated; keep icons proportional to prose` };
    },
  },
  {
    id: 'slop.decoration.animation',
    title: 'decorative scale/rotate animation on static content',
    severity: 'medium',
    tier: 'P1',
    needs: ['animationSignals'],
    detect(ctx, t = {}) {
      const sigs = (ctx.animationSignals || []);
      if (sigs.length === 0) return null;
      const min = t.minAnimSignals ?? 1;
      if (sigs.length < min) return null;
      return { signal: sigs.length, threshold: min, nodes: [], remediation: 'drop decorative scale/rotate keyframes on static content — motion must serve meaning' };
    },
  },
];
