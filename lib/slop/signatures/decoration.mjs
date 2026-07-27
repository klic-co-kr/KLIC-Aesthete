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
  {
    id: 'slop.decoration.side-tab-border',
    title: 'thick accent border on one side of a card (side-tab — AI UI #1 tell)',
    severity: 'medium',
    tier: 'P1',
    needs: ['sideTabBorders'],
    detect(ctx, t = {}) {
      const minThickness = t.minThickness ?? 4;
      const hits = (ctx.sideTabBorders || []).filter((b) => b.width >= minThickness);
      const min = t.minHits ?? 1;
      if (hits.length < min) return null;
      return { signal: hits.length, threshold: min, nodes: [], remediation: 'thick single-side accent border — the most recognizable AI-UI tell; use a subtler accent (typography, spacing, a full border, or remove it)' };
    },
  },
  {
    id: 'slop.decoration.bounce-easing',
    title: 'bounce/elastic easing on interface motion (dated AI tell)',
    severity: 'medium',
    tier: 'P1',
    needs: ['easingBounce'],
    detect(ctx, t = {}) {
      if (!ctx.easingBounce) return null;
      return { signal: 1, threshold: 1, nodes: [], remediation: 'bounce/elastic easing on UI elements feels dated and tacky; ease interface motion out smoothly (ease-out-quart/quint/expo), reserve spring physics for physically-animated elements' };
    },
  },
  {
    id: 'slop.decoration.hover-transform',
    title: 'scale/rotate transform on hover (generated-UI signature)',
    severity: 'low',
    tier: 'P1',
    needs: ['hoverTransforms'],
    detect(ctx, t = {}) {
      const n = ctx.hoverTransforms || 0;
      const min = t.minHoverTransforms ?? 1;
      if (n < min) return null;
      return { signal: n, threshold: min, nodes: [], remediation: 'scaling/rotating imagery on hover is a recurring generated-UI signature; let imagery sit still or use a subtler, purposeful interaction' };
    },
  },
  {
    id: 'slop.decoration.pulse-animation',
    title: 'pulsing opacity animation (decorative "live" indicator)',
    severity: 'low',
    tier: 'P1',
    needs: ['animations'],
    detect(ctx, t = {}) {
      const opacityAnims = (ctx.animations || []).filter((a) => a.props.includes('opacity'));
      const min = t.minPulse ?? 1;
      if (opacityAnims.length < min) return null;
      // FP guard: fade-in entrances use opacity keyframes too. Narrow to pulse-like name OR
      // infinite application (a one-shot entrance is finite; a pulse loops forever).
      const pulseName = opacityAnims.some((a) => /pulse|live|breathe|heartbeat|glow|status/i.test(a.name));
      if (!(pulseName || ctx.animationInfinite)) return null;
      return { signal: opacityAnims.length, threshold: min, nodes: [], remediation: 'a decorative pulse makes static status look live; animate only when the data is actually changing' };
    },
  },
  {
    id: 'slop.decoration.marquee',
    title: 'auto-scrolling marquee (translateX/left keyframes)',
    severity: 'medium',
    tier: 'P1',
    needs: ['animations'],
    detect(ctx, t = {}) {
      const marquees = (ctx.animations || []).filter((a) => a.props.includes('translateX') || a.props.includes('left'));
      const min = t.minMarquee ?? 1;
      if (marquees.length < min) return null;
      // FP guard: carousels/sliders use translateX too. Narrow to marquee-like name OR infinite
      // application (a deliberate one-shot slide is finite; a marquee loops forever).
      const marqueeName = marquees.some((a) => /marquee|scroll|ticker/i.test(a.name));
      if (!(marqueeName || ctx.animationInfinite)) return null;
      return { signal: marquees.length, threshold: min, nodes: [], remediation: 'continuous auto-scroll demands attention and hides content; let people read at their own pace' };
    },
  },
  {
    id: 'slop.decoration.blink-cursor',
    title: 'fake blinking cursor (steps() opacity animation)',
    severity: 'medium',
    tier: 'P1',
    needs: ['animations', 'easingStep'],
    detect(ctx, t = {}) {
      // A fake caret = opacity stepped to blink, on a non-editable element. Browser-native carets
      // on <input>/contenteditable are NOT CSS @keyframes, so any CSS steps() opacity blink is the
      // fake. Name hint tightens it (cursor/caret/blink/terminal) to suppress staged-fade FPs.
      const opacityAnim = (ctx.animations || []).some((a) => a.props.includes('opacity'));
      if (!opacityAnim || !ctx.easingStep) return null;
      const blinkName = (ctx.animations || []).some((a) => /blink|cursor|caret|terminal/i.test(a.name));
      if (!blinkName) return null;
      return { signal: 1, threshold: 1, nodes: [], remediation: 'a fake blinking cursor makes non-editable hero copy look like a terminal; let real inputs own the caret' };
    },
  },
];
