#!/usr/bin/env node
// slop fold — deterministic post-hoc AI-slop signature scan. One of the engine's sibling
// measurement surfaces (measure.mjs · vuln.mjs · slop.mjs · structure.mjs · lint.mjs) —
// not a separate "axis" and not gated by what the geometry skills can or can't do.
// Mirrors lib/vuln.mjs: signature array + scan fold + TYPE_SUPPRESSIONS + overridable
// thresholds + advisory coverage.
//
// WHY SLOP LIVES IN ITS OWN MODULE (not merged into measure.mjs):
// Pure code-organization, not architectural incompatibility. Different input shape (slop reads
// raw source HTML/text; measure reads ALT nodes), different output shape (slop emits findings
// with remediation strings; measure emits numeric skill metrics), different consumers (slop
// feeds skill-post as advisory-only v1; measure feeds fix.mjs's closed-loop corrector). All
// of these are practical concerns — none of them are "slop is non-geometric so it can't live
// next to bbox arithmetic." The engine handles geometry AND slop AND structure AND tokens.
//
// WHY v1 = HTML ONLY:
// Slop tells are MEDIUM-SPECIFIC. HTML tells (gradient cliché, marketing lexicon, italic
// heading) differ from PPTX tells (stock chrome, default theme colors) and SVG tells
// (template icon paths) and raster-image tells (anatomical errors, frequency-domain fingerprints).
// Each medium needs its own scanner + its own calibrated signature set. v1 ships HTML because
// that's the only signature set calibrated so far. Scanner is literal-presence only — NOT a
// CSS mini-parser (spec §5 M1). For v2 medium-expansion roadmap see
// docs/superpowers/specs/2026-07-23-slop-v2-medium-expansion.md.
//
// RASTER IMAGES ARE OUT OF SCOPE — capability gap, not category gap: the engine already
// extracts quadtree geometry from pixels via the image adapter, so "pixels have no geometry"
// is wrong. The actual blocker for raster slop is that the tells (anatomical errors, texture
// artifacts, frequency-domain fingerprints) need a VISION MODEL — and a pure-JS no-browser
// engine can't host one (DESIGN.md out-of-scope). When Phase 3's image/vision hook lands,
// raster slop becomes feasible without restructuring anything here.
//
// Runs read-only under 'measure-only'. Deterministic (no Date/random).

import { assertAllowed } from './profiles.mjs';
import {
  scanHtmlSource, countCarriers, CARRIER_DEFAULT_THRESHOLDS, clampCarrierThreshold,
  CARRIER_HARD_RE, CARRIER_BOM_RE, ZWSP_RE, WJ_RE, EMOJI_TAG_SEQ_SPLIT_RE,
} from './slop/html-source-scan.mjs';
import { SIGNATURES as PALETTE } from './slop/signatures/palette.mjs';
import { SIGNATURES as DECO } from './slop/signatures/decoration.mjs';
import { SIGNATURES as COPY } from './slop/signatures/copy.mjs';
import { SIGNATURES as TMPL } from './slop/signatures/template.mjs';
import { SIGNATURES as IMG } from './slop/signatures/imagery.mjs';

const SIGNATURES = [...PALETTE, ...DECO, ...COPY, ...TMPL, ...IMG];

// Conservative defaults — every one overridable via opts.thresholds[id]. UNCALIBRATED (spec §6 H2):
// slop human-corpus is v2; these are conservative presence floors, not tuned cutoffs.
export const DEFAULT_THRESHOLDS = {
  'slop.palette.gradient': { minClichéStops: 2, hueLo: 230, hueHi: 340, sMin: 0.25 },
  'slop.palette.glass': { minGlass: 1 },
  'slop.palette.gradient-border': { minGradientBorders: 1 },
  'slop.palette.tailwind-candy': { minHits: 3, minAttrs: 2 }, // candy list itself lives in palette.mjs (CANDY_HUES), overridable via t.hues — the lexicon pattern
  'slop.decoration.emoji-in-heading': { minEmojiHeadings: 1 },
  'slop.decoration.emoji-in-body': { minBodyEmoji: 1 },
  'slop.decoration.italic-heading': { minItalicHeadings: 1 },
  'slop.decoration.icon-saturation': { minIcons: 12 },
  'slop.decoration.animation': { minAnimSignals: 1 },
  'slop.decoration.side-tab-border': { minHits: 1, minThickness: 2, maxOtherSides: 1 }, // asymmetry-gated since issue #2 — full frames/double rails/1px dividers stay silent
  'slop.decoration.bounce-easing': { },
  'slop.decoration.hover-transform': { minHoverTransforms: 1 },
  'slop.decoration.pulse-animation': { minPulse: 1 },
  'slop.decoration.marquee': { minMarquee: 1 },
  'slop.decoration.blink-cursor': { },
  'slop.copy.lexicon': { minHits: 1 },
  'slop.copy.fake-precision': { minHits: 1 },
  'slop.copy.hidden-carrier': { ...CARRIER_DEFAULT_THRESHOLDS },
  'slop.template.trusted-by': { minTrustedBy: 1 },
  'slop.template.hero-trio': { minTrio: 3, maxWidthDiff: 0.15 },
  // --- 2026-08 expansion thresholds. Calibrated bands: dark-glow blur/alpha/saturation,
  // over-rounded 40–120px, oversized ≥10,000. ---
  'slop.copy.lorem': { minHits: 1 },
  'slop.copy.em-dash': { minHits: 1 },
  'slop.copy.oversized-number': { minHits: 1, minValue: 10000 },
  'slop.copy.not-x-but-y': { minHits: 1 },
  'slop.copy.apologetic-error': { minHits: 1 },
  'slop.copy.live-clock': { minHits: 1 },
  'slop.palette.overused-font': { minFamilies: 1 },
  'slop.decoration.hollow-text': { minHits: 1 },
  'slop.decoration.dark-glow': { minHits: 1, minBlurPx: 12, minSaturation: 0.4, minAlpha: 0.15 },
  'slop.decoration.over-rounded': { minHits: 1, radiusMin: 40, radiusMax: 120 },
  'slop.decoration.repeating-stripe': { minHits: 1 },
  'slop.decoration.decorative-divider': { minRuns: 1 },
  'slop.decoration.transition-all': { minHits: 1 },
  'slop.decoration.will-change-misuse': { minHits: 1 },
  'slop.decoration.layout-prop-anim': { minHits: 1 },
  'slop.decoration.body-display-contents': { },
  'slop.imagery.placeholder-src': { minHits: 1 },
  'slop.imagery.broken-src': { minHits: 1 },
};

// v1: no slop signature is a type-intended pattern (unlike vuln even-split→dashboard).
export const TYPE_SUPPRESSIONS = {};

export function scanSlop({ alt = null, medium = 'html', html = '', opts = {} } = {}) {
  assertAllowed('measure-only', 'slop-scan');

  const overrides = opts.thresholds || {};
  const thresholds = {};
  for (const id of Object.keys(DEFAULT_THRESHOLDS)) {
    thresholds[id] = { ...DEFAULT_THRESHOLDS[id], ...(overrides[id] || {}) };
  }

  const hasHtml = typeof html === 'string' && html.length > 0;
  const ctx = hasHtml ? scanHtmlSource(html) : null;
  if (ctx) ctx.alt = alt;

  const artifactType = opts.artifact_type || null;
  const suppressedByContext = artifactType ? (TYPE_SUPPRESSIONS[artifactType] || []) : [];

  const findings = [];
  const unmeasured = [];
  const byTier = { P0: 0, P1: 0, P2: 0 };

  for (const sig of SIGNATURES) {
    if (!hasHtml) {
      // v1: only HTML is scannable; non-html media → every signature unmeasured
      unmeasured.push({ id: sig.id, tier: sig.tier, reason: `medium '${medium}' not scannable in v1 (HTML only)` });
      continue;
    }
    if (suppressedByContext.includes(sig.id)) {
      // suppressed entries are reported (transparent), not hidden — mirror vuln
      continue;
    }
    let res;
    try { res = sig.detect(ctx, thresholds[sig.id]); } catch { continue; }
    if (!res) continue;
    if (res.unmeasured) { unmeasured.push({ id: sig.id, tier: sig.tier, reason: res.reason || 'unmeasured' }); continue; }
    byTier[sig.tier] = (byTier[sig.tier] || 0) + 1;
    findings.push({
      id: sig.id,
      title: sig.title,
      severity: sig.severity,
      tier: sig.tier,
      signal: res.signal,
      threshold: res.threshold,
      nodes: res.nodes || [],
      remediation: res.remediation,
      mode: 'suggestionOnly',
      detectionMode: sig.detectionMode ?? 'deterministic',
    });
  }

  return {
    schema_version: 1,
    summary: {
      slopCount: findings.length,
      byTier,
      coverage: {
        html: hasHtml ? 'measured' : 'unmeasurable',
        ...(hasHtml ? {} : { reason: `no HTML source for medium '${medium}' (v1 = HTML only)` }),
      },
      artifact_type: artifactType,
      suppressed: [],
      advisory: true,
      uncalibrated: true,
      profile: 'measure-only',
      unmeasured,
    },
    findings,
  };
}

// Deterministic carrier removal — the fix counterpart to the slop.copy.hidden-carrier
// signature. THRESHOLD-GATED on STRIPPABLE text only (adversarial-review round 2): the gate
// counts carriers OUTSIDE protected blocks, so carriers that live only inside
// <script>/<style> never open the gate (they are detected — the scanner counts the full
// source — but they are manual-review-only, and --strip will not pretend to fix them).
// A class is stripped only when its strippable count meets the same per-class threshold
// detection uses, so a page that scans clean is NEVER mutated, and a page that fired via
// one class keeps sub-threshold residue of other classes (strip fixes what was reported).
// Removes, when gated in: hard carriers (tag chars OUTSIDE emoji tag sequences, bidi
// embedding/override, mid-source BOM), ZWSP (except directly after '/', URL break
// control), and WJ. PRESERVES by design:
//   - the leading BOM (index 0 = UTF-8 encoding signature, not a carrier);
//   - bidi isolates U+2066–U+2069 (direction-bearing: removal changes RTL rendering —
//     the isolate tier firing means manual review, not auto-strip);
//   - well-formed emoji tag sequences (subdivision-flags are BUILT from tag chars);
//   - <script>/<style> block contents INCLUDING unclosed blocks (to EOF), which browsers
//     also treat as script text;
//   - ZWJ/ZWNJ/soft-hyphen/PUA/VS16 (legitimate invisible chars, scanner-excluded).
// `kept` reports counted-but-not-removed carriers per class — sub-threshold residue,
// URL-spared ZWSP, and protected-block carriers all show up there, so the audit trail
// reconstructs the scanner count (full = removed + kept). ZWSP is matched BEFORE hard
// classes so its '/'-lookback sees unshifted indices (a scanner-counted ZWSP whose
// predecessor is a removed carrier cannot be misread as URL-spared).
// Invariance scope: GLYPH content invariant; line-break opportunities may change where a
// fired class is removed; intentional bidi-override effects ARE removed (Trojan-Source
// spoofing class — security-positive default). Deterministic (no Date/random).
const PROTECTED_BLOCK_RE = /(<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<script\b[^>]*>[\s\S]*$|<style\b[^>]*>[\s\S]*$)/gi;

function stripSegment(text, gate, counts) {
  // Protect emoji tag sequences: split keeps captured sequences at odd indices, untouched.
  const parts = text.split(EMOJI_TAG_SEQ_SPLIT_RE);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      let hard = 0;
      let zwsp = 0;
      let wj = 0;
      const cleaned = part
        // ZWSP first — indices still unshifted by any removal.
        .replace(gate.zwsp ? ZWSP_RE : /(?!)/g, (m, off, whole) => {
          // ZWSP directly after '/' is URL break control — kept even when the class fires.
          if (off > 0 && whole[off - 1] === '/') return m;
          zwsp += 1;
          return '';
        })
        .replace(gate.hard ? CARRIER_HARD_RE : /(?!)/g, () => { hard += 1; return ''; })
        .replace(gate.hard ? CARRIER_BOM_RE : /(?!)/g, () => { hard += 1; return ''; })
        .replace(gate.wj ? WJ_RE : /(?!)/g, () => { wj += 1; return ''; });
      counts.hard += hard;
      counts.zwsp += zwsp;
      counts.wj += wj;
      return cleaned;
    })
    .join('');
}

// `t` MUST mirror the thresholds the accompanying scan used
// (opts.thresholds['slop.copy.hidden-carrier']) — the CLI is safe because both sides share
// CARRIER_DEFAULT_THRESHOLDS, but an API caller that scans with a lowered threshold and
// strips with defaults gets a no-op strip that never clears the finding.
export function stripCarriers(html, t = {}) {
  const src = typeof html === 'string' ? html : '';
  const hasLeadingBom = src.charCodeAt(0) === 0xFEFF;
  const body = hasLeadingBom ? src.slice(1) : src;
  // Even indices = strippable text; odd indices = protected <script>/<style> blocks.
  const segments = body.split(PROTECTED_BLOCK_RE);
  const strippableText = 'x' + segments.filter((_, i) => i % 2 === 0).join(''); // 'x' sentinel: index-0 chars are mid-source here
  // Gate on STRIPPABLE counts only (shared counter — same formulas as the scanner).
  const gateCounts = countCarriers(strippableText);
  const gate = {
    hard: gateCounts.hard >= clampCarrierThreshold(t.minHard, CARRIER_DEFAULT_THRESHOLDS.minHard),
    zwsp: gateCounts.zwsp >= clampCarrierThreshold(t.minZwsp, CARRIER_DEFAULT_THRESHOLDS.minZwsp),
    wj: gateCounts.wj >= clampCarrierThreshold(t.minWj, CARRIER_DEFAULT_THRESHOLDS.minWj),
  };
  const counts = { hard: 0, zwsp: 0, wj: 0 };
  const out = segments
    .map((part, i) => (i % 2 === 1 ? part : stripSegment(part, gate, counts)))
    .join('');
  // Audit: kept = counted-but-not-removed (sub-threshold + URL-spared + protected-block).
  // Computed from FULL-source counts (what the scanner reports), not gate counts.
  const full = countCarriers(src);
  // kept.zwsp uses RAW ZWSP presence (URL-spared ones are not scanner evidence but ARE
  // still in the file) so removed + kept always reconstructs what is actually there.
  const rawZwsp = (src.match(ZWSP_RE) || []).length;
  return {
    html: hasLeadingBom ? '\uFEFF' + out : out,
    removed: counts,
    kept: {
      hard: Math.max(0, full.hard - counts.hard),
      isolates: full.isolates,
      zwsp: Math.max(0, rawZwsp - counts.zwsp),
      wj: Math.max(0, full.wj - counts.wj),
    },
  };
}

// CLI: bun lib/slop.mjs <artifact.html|alt> [slop.json] [--type T] [--medium html]
//      bun lib/slop.mjs <artifact.html> <cleaned.html> --strip   (deterministic carrier removal)
if (import.meta.url === `file://${process.argv[1]}`) {
  const { writeJson, parseArgs } = await import('./shared/cli.mjs');
  const { validate } = await import('./shared/validator.mjs');
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const inputPath = positional[0];
  if (!inputPath) { console.error('usage: bun lib/slop.mjs <artifact.html> [slop.json] [--type T] [--medium html] | <artifact.html> <out.html> --strip'); process.exit(2); }
  const fs = await import('node:fs');
  const path = await import('node:path');
  const html = fs.readFileSync(inputPath, 'utf8');
  if (flags.strip) {
    // Explicit fix action (never run by skill-post, which is non-destructive): strip invisible
    // watermark carriers, write cleaned HTML to the second positional path.
    if (!positional[1]) { console.error('--strip requires an output path: bun lib/slop.mjs <in.html> <out.html> --strip'); process.exit(2); }
    const { html: cleaned, removed, kept } = stripCarriers(html);
    fs.writeFileSync(positional[1], cleaned, 'utf8');
    const keptNote = (kept.hard + kept.zwsp + kept.wj) > 0
      ? ` | kept ${kept.hard + kept.zwsp + kept.wj} sub-threshold (below evidence threshold — page not mutated past what was reported)` : '';
    console.log(`stripped ${removed.hard} hard + ${removed.zwsp} zwsp + ${removed.wj} wj${keptNote} → ${positional[1]}`);
    process.exit(0);
  }
  const report = scanSlop({ html, medium: flags.medium || 'html', opts: { artifact_type: typeof flags.type === 'string' ? flags.type : undefined } });
  await validate('slop-report', report);
  const outPath = positional[1] || path.join(process.cwd(), `${path.basename(inputPath, path.extname(inputPath))}.slop.json`);
  writeJson(outPath, report);
  const b = report.summary.byTier;
  console.log(`${report.summary.slopCount} slop(s) | P0 ${b.P0} P1 ${b.P1} P2 ${b.P2} | coverage html/${report.summary.coverage.html === 'measured' ? '✓' : '·'} | advisory/uncalibrated | ${outPath}`);
}
