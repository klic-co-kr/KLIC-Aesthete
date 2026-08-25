// slop decoration signatures. P0 = emoji inside heading text; P1 = icon saturation, decorative animation;
// P2 = emoji inside body/UI copy. Thresholds conservative + overridable. "Uncalibrated" — corpus
// tuning is v2 (spec §6 H2).

// Pragmatic emoji detection: shared regex twin from the scanner (ONE source so the heading check
// here and the scanner's body-emoji extraction can never drift).
import { PICTOGRAPH_RE as EMOJI_RE, normalizeDashEntities } from '../html-source-scan.mjs';
import { colorToHslA } from './palette.mjs';

// 2026-08 absorption of @gessobuild/anti-slop v0.4.2 (MIT), decoration/motion/layout axis —
// declaration-literal ports (hollow-text, dark-glow, over-rounded, repeating-stripe,
// decorative-divider, transition-all, will-change-misuse, layout-prop-anim,
// body-display-contents). All read raw declaration VALUES from the scanner; interpretation
// lives here. Gesso's per-element `data-slop-allow` opt-out is NOT ported — our findings are
// aggregate (no element provenance in the literal scan), so an artifact-side opt-out would be
// unverifiable decoration; the threshold-override knob (opts.thresholds[id]) remains the
// per-project escape hatch.

// Paren-aware comma split — a shadow declaration's layers are comma-separated, but rgba()/hsl()
// colors carry commas of their own.
function splitLayers(decl) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of String(decl)) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

// First color token in a shadow layer (hex / rgba / hsl family). Named colors return null —
// see the colorToHslA stance in palette.mjs.
const COLOR_TOKEN_RE = /#[0-9a-f]{3,8}\b|(?:-webkit-)?(?:rgba?|hsla?)\([^)]*\)/i;

// Count neon-glow layers (anti-slop "dark-glow"): non-inset shadow layer whose color is
// saturated (S ≥ minSaturation) with blur ≥ minBlurPx and alpha ≥ minAlpha. Neutral elevation
// shadows carry no chroma and never match.
function glowLayerHits(decls, t) {
  const minBlur = t.minBlurPx ?? 12;
  const minSat = t.minSaturation ?? 0.4;
  const minAlpha = t.minAlpha ?? 0.15;
  let hits = 0;
  for (const decl of decls) {
    for (const layer of splitLayers(decl)) {
      if (/\binset\b/i.test(layer)) continue;
      // Dimensional parse AFTER removing the color token (its rgba()/hsl() args carry numbers
      // of their own). Unitless numerics are positional zeros — CSS only allows unitless 0,
      // and `box-shadow: 0 0 40px …` is the dominant generated form.
      const tokenless = layer.replace(COLOR_TOKEN_RE, ' ');
      const dims = [...tokenless.matchAll(/(-?\d+(?:\.\d+)?)(px)?\b/gi)]
        .map((m) => (m[2] ? Math.abs(Number(m[1])) : 0));
      const blur = dims.length >= 3 ? dims[2] : 0; // x y blur [spread] — third value is the blur
      if (blur < minBlur) continue;
      const token = layer.match(COLOR_TOKEN_RE);
      if (!token) continue;
      const c = colorToHslA(token[0]);
      if (!c) continue;
      if ((c.a ?? 1) < minAlpha) continue;
      if (c.s < minSat) continue;
      hits += 1;
    }
  }
  return hits;
}

// Visible-text haystack for the divider rule (same shape as copy.mjs's visibleText).
const visibleText = (ctx) => [
  ...(ctx.textSamples || []),
  ...(ctx.headings || []).map((h) => (h && h.text) || ''),
];

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
    // Body/UI-copy emoji — issue #1: `트랩⚠` inside a <p> scanned clean because v1 only read
    // emoji out of headings. Scanner-side evidence (bodyEmojiSamples) covers the TEXT_TAGS
    // samples only, so this stays disjoint from emoji-in-heading by construction (headings are
    // not in TEXT_TAGS) — heading emoji is never double-reported. FP stance: subdivision flags
    // are stripped at the scanner (legitimate national symbols); known residual FP is the
    // deliberate semantic emoji in hand-written UIs ("✅ Done" in a table cell) — low/P2
    // advisory + `minBodyEmoji` override rather than a carve-out list that would need
    // maintaining against every new pictograph.
    id: 'slop.decoration.emoji-in-body',
    title: 'emoji inside body/UI copy',
    severity: 'low',
    tier: 'P2',
    needs: ['bodyEmojiSamples'],
    detect(ctx, t = {}) {
      const hits = ctx.bodyEmojiSamples || [];
      const min = t.minBodyEmoji ?? 1;
      if (hits.length < min) return null;
      return { signal: hits.length, threshold: min, nodes: [], remediation: `emoji inside body/UI copy (${hits.length} text sample${hits.length > 1 ? 's' : ''}) — inline pictographs read as generated decoration; carry the signal in wording or a drawn icon, not a ⚠/✅/🔥 glyph` };
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
    // P0 since issue #2 (Impeccable names this the "#1 AI-UI tell"; the KLIC RADIUS report
    // shipped 3px one-side bars past the old minThickness=4 floor). Elevation from P1 is safe
    // only because the scanner now reports per-context asymmetry (`maxOther`): a side fires
    // when it is ≥2px while the OTHER sides of the same rule/style stay ≤1px — so a full 3px
    // frame, a top+bottom double rail, and 1px dividers do not reach the regenerate gate.
    // Replacement guidance mirrors the issue: hover lift or internal badge, not a colored bar
    // (note translateY lifts are NOT the hover-transform tell — that signature owns scale/rotate).
    id: 'slop.decoration.side-tab-border',
    title: 'thick accent border on one side of a card (side-tab — Impeccable\'s #1 AI-UI tell)',
    severity: 'high',
    tier: 'P0',
    needs: ['sideTabBorders'],
    detect(ctx, t = {}) {
      const minThickness = t.minThickness ?? 2;
      const maxOtherSides = t.maxOtherSides ?? 1;
      const hits = (ctx.sideTabBorders || []).filter((b) => b.width >= minThickness && b.maxOther <= maxOtherSides);
      const min = t.minHits ?? 1;
      if (hits.length < min) return null;
      return { signal: hits.length, threshold: min, nodes: [], remediation: `thick single-side accent border — the most recognizable AI-UI tell; separate cards with a hover lift (transform: translateY(-2px) + a stronger box-shadow) or color-code with an internal tag badge instead of a one-side bar (scale/rotate hover transforms remain their own tell)` };
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
  {
    // Ported from anti-slop "hollow-text" (their sev 2 — can fail WCAG outright). Stroke
    // declaration + a transparent COLOR/FILL in the SAME declaration block (rule body or one
    // inline style) — co-occurrence is per-block, so a transparent overlay elsewhere on the
    // page never armors an unrelated stroke. `background: transparent` beside a stroke does
    // NOT fire (the glyph still has its fill).
    id: 'slop.decoration.hollow-text',
    title: 'hollow outlined type (text-stroke with transparent fill)',
    severity: 'medium',
    tier: 'P1',
    needs: ['styleBlocks'],
    detect(ctx, t = {}) {
      const hits = (ctx.styleBlocks || []).filter((b) =>
        /(?:-webkit-)?text-stroke\s*:/i.test(b)
        && /(?:^|[;{\s])(?:color|-webkit-text-fill-color|fill)\s*:\s*transparent/i.test(b));
      const min = t.minHits ?? 1;
      if (hits.length < min) return null;
      return { signal: hits.length, threshold: min, nodes: [], remediation: 'hollow outlined display type is a poster gimmick generated UI overuses — and wherever the stroke is not painted the text is literally invisible; use a solid fill (reduce opacity for a quiet read) instead of hollowing the glyph' };
    },
  },
  {
    // Ported from anti-slop "dark-glow" (their sev 2). The neon halo behind buttons/bento
    // tiles — the signature move of generated "premium dark SaaS". Neutral elevation shadows
    // carry no chroma and never match; drop-shadow() filters count too.
    id: 'slop.decoration.dark-glow',
    title: 'saturated glow shadow (neon dark-SaaS halo)',
    severity: 'medium',
    tier: 'P1',
    needs: ['shadowDecls', 'dropShadows'],
    detect(ctx, t = {}) {
      const hits = glowLayerHits([...(ctx.shadowDecls || []), ...(ctx.dropShadows || [])], t);
      const min = t.minHits ?? 1;
      if (hits < min) return null;
      return { signal: hits, threshold: min, nodes: [], remediation: `${hits} saturated glow layer${hits > 1 ? 's' : ''} — light does not leak out from under cards; the chromatic wide-blur halo is decoration posing as depth. Neutral elevation shadows only (e.g. 0 1px 2px rgba(0,0,0,0.24))` };
    },
  },
  {
    // Ported from anti-slop "over-rounded-card". SINGLE-value px radius in the 40–120 band;
    // pills (9999px) and circles (50%) fall outside by convention, and per-corner multi-value
    // radii are excluded (a deliberate asymmetric corner is a different decision). Gesso also
    // requires a filled surface — unresolvable in a literal scan (no cascade), so an unfilled
    // wrapper with a blob radius is a documented residual.
    id: 'slop.decoration.over-rounded',
    title: 'over-rounded surface (single-value border-radius 40–120px)',
    severity: 'low',
    tier: 'P2',
    needs: ['radiusDecls'],
    detect(ctx, t = {}) {
      const lo = t.radiusMin ?? 40;
      const hi = t.radiusMax ?? 120;
      const hits = (ctx.radiusDecls || []).filter((v) => {
        const m = String(v).trim().match(/^(\d+(?:\.\d+)?)px$/i); // CSS units are case-insensitive
        return !!m && Number(m[1]) >= lo && Number(m[1]) <= hi;
      });
      const min = t.minHits ?? 1;
      if (hits.length < min) return null;
      return { signal: hits.length, threshold: min, nodes: [], remediation: `${hits.length} radius declaration${hits.length > 1 ? 's' : ''} in the 40–120px band — corners that round turn content cards into blobs with text floating in amorphous shapes; confident systems hold 8–24px` };
    },
  },
  {
    // Ported from anti-slop "repeating-gradient-stripe". Texture without intent — the CSS
    // equivalent of construction tape. Deliberately separate from palette.gradient: the
    // GRAD_RE superset the cliché-hue rule reads still contains these (compat), and this rule
    // fires on the repeating FORM regardless of hue.
    id: 'slop.decoration.repeating-stripe',
    title: 'repeating-gradient stripe surface (construction-tape texture)',
    severity: 'low',
    tier: 'P2',
    needs: ['repeatingGradients'],
    detect(ctx, t = {}) {
      const list = ctx.repeatingGradients || [];
      const min = t.minHits ?? 1;
      if (list.length < min) return null;
      return { signal: list.length, threshold: min, nodes: [], remediation: `${list.length} repeating-gradient stripe${list.length > 1 ? 's' : ''} — stripes are texture without intent; a designed surface uses a flat tone or a pattern that means something` };
    },
  },
  {
    // Ported from anti-slop "decorative-divider". Runs of 2+ box-drawing characters
    // (U+2500–U+2570, U+2574–U+257F — diagonals excluded) or 2+ em/en dashes in VISIBLE
    // text: how a language model draws a line when it cannot draw a line. A single dash is
    // copy.em-dash's finding, never this one's. ASCII '---' runs are NOT included — in HTML
    // source they live overwhelmingly inside comments, which the visible-text haystack
    // already excludes, and rendered markdown hr's arrive as <hr>.
    id: 'slop.decoration.decorative-divider',
    title: 'box-drawing / dash-run divider in text',
    severity: 'low',
    tier: 'P2',
    needs: ['textSamples', 'headings'],
    detect(ctx, t = {}) {
      // box-drawing U+2500–U+2570 + U+2574–U+257F (diagonals U+2571–U+2573 excluded), em/en
      // dash runs — entity dash runs (&mdash;&mdash;) normalize to raw chars first so this
      // rule owns them, never copy.em-dash.
      const runRe = /[─-╰╴-╿]{2,}|[—–]{2,}/g;
      let runs = 0;
      for (const text of visibleText(ctx)) runs += (normalizeDashEntities(text).match(runRe) || []).length;
      const min = t.minRuns ?? 1;
      if (runs < min) return null;
      return { signal: runs, threshold: min, nodes: [], remediation: `${runs} character-run divider${runs > 1 ? 's' : ''} — terminal-art rules are chrome that conveys nothing and breaks when the font or width changes; draw a real hairline (flex + border-top) instead` };
    },
  },
  {
    // Ported from anti-slop "transition-all" (their GATE — the narrowing is a design
    // decision). `transition: all` animates every property that happens to change and forces
    // the browser to watch everything. P2 (not P1) deliberately: this one is common in
    // hand-written code too — it is a smell, not a generated-only tell.
    id: 'slop.decoration.transition-all',
    title: 'transition: all (unnamed-property motion)',
    severity: 'low',
    tier: 'P2',
    needs: ['transitionDecls'],
    detect(ctx, t = {}) {
      const hits = (ctx.transitionDecls || []).filter((v) => /\ball\b/i.test(v));
      const min = t.minHits ?? 1;
      if (hits.length < min) return null;
      return { signal: hits.length, threshold: min, nodes: [], remediation: `${hits.length} transition declaration${hits.length > 1 ? 's' : ''} on "all" — motion should name its subject (transform, opacity); transition-all is the lazy default behind janky hovers` };
    },
  },
  {
    // Ported from anti-slop "will-change-misuse". will-change pointed at layout/paint
    // properties allocates a GPU layer that cannot accelerate anything — performance cargo
    // cult residue. Compositable set + spec values + CSS-wide keywords stay silent.
    id: 'slop.decoration.will-change-misuse',
    title: 'will-change on non-compositable properties',
    severity: 'low',
    tier: 'P2',
    needs: ['willChangeDecls'],
    detect(ctx, t = {}) {
      const ok = new Set(['transform', 'opacity', 'filter', 'clip-path', 'scroll-position', 'contents', 'initial', 'inherit', 'unset', 'revert']);
      const hits = (ctx.willChangeDecls || []).filter((v) =>
        v.split(',').map((s) => s.trim().toLowerCase()).some((tok) => tok && !ok.has(tok)));
      const min = t.minHits ?? 1;
      if (hits.length < min) return null;
      return { signal: hits.length, threshold: min, nodes: [], remediation: `${hits.length} will-change declaration${hits.length > 1 ? 's' : ''} naming layout/paint properties — the compositor only owns transform, opacity, filter, clip-path; anything else is memory spent, zero motion gained` };
    },
  },
  {
    // Ported from anti-slop "layout-prop-animation" (their GATE). Transitioning layout
    // properties reflows the page every frame — the motion stutters exactly where it tries to
    // impress. `transition: all` is transition-all's finding and is excluded here.
    id: 'slop.decoration.layout-prop-anim',
    title: 'transition on layout properties (width/height/top/margin/padding)',
    severity: 'low',
    tier: 'P2',
    needs: ['transitionDecls'],
    detect(ctx, t = {}) {
      // TOKEN-level match: the property is the first word of each comma-separated entry.
      // A substring test would false-fire on paint properties carrying layout words
      // (`border-left-color`, `border-bottom-color`) — those are paint, not layout.
      const LAYOUT_PROPS = new Set(['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'top', 'left', 'right', 'bottom', 'inset', 'margin', 'padding']);
      const isLayout = (v) => v.split(',').some((tok) => {
        const m = tok.trim().toLowerCase().match(/^[a-z-]+/);
        if (!m) return false;
        return LAYOUT_PROPS.has(m[0]) || m[0].startsWith('margin-') || m[0].startsWith('padding-');
      });
      const hits = (ctx.transitionDecls || []).filter((v) => !/\ball\b/i.test(v) && isLayout(v));
      const min = t.minHits ?? 1;
      if (hits.length < min) return null;
      return { signal: hits.length, threshold: min, nodes: [], remediation: `${hits.length} layout-property transition${hits.length > 1 ? 's' : ''} — every animated frame reflows the page; animate transform/opacity (the compositor can own those) instead of width/top/margin` };
    },
  },
  {
    // Ported from anti-slop "body-display-contents" (their sev 2). display:contents on <body>
    // discards its padding/width/flex-gap — no side padding, content under any fixed bar, zero
    // section rhythm. Legitimate on nested wrappers, never on body; the scanner's
    // selector-list check keeps `body .child {}` out.
    id: 'slop.decoration.body-display-contents',
    title: 'display: contents on <body> (page-level layout collapse)',
    severity: 'medium',
    tier: 'P1',
    needs: ['bodyDisplayContents'],
    detect(ctx, t = {}) {
      if (!ctx.bodyDisplayContents) return null;
      return { signal: 1, threshold: 1, nodes: [], remediation: 'display:contents on <body> makes it generate no box — its padding, width, and flex gap are ALL discarded (no side padding, zero section rhythm); it is legitimate on a nested wrapper, never on body' };
    },
  },
];
