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
import { scanHtmlSource } from './slop/html-source-scan.mjs';
import { SIGNATURES as PALETTE } from './slop/signatures/palette.mjs';
import { SIGNATURES as DECO } from './slop/signatures/decoration.mjs';
import { SIGNATURES as COPY } from './slop/signatures/copy.mjs';
import { SIGNATURES as TMPL } from './slop/signatures/template.mjs';

const SIGNATURES = [...PALETTE, ...DECO, ...COPY, ...TMPL];

// Conservative defaults — every one overridable via opts.thresholds[id]. UNCALIBRATED (spec §6 H2):
// slop human-corpus is v2; these are conservative presence floors, not tuned cutoffs.
export const DEFAULT_THRESHOLDS = {
  'slop.palette.gradient': { minClichéStops: 2, hueLo: 230, hueHi: 340, sMin: 0.25 },
  'slop.palette.glass': { minGlass: 1 },
  'slop.palette.gradient-border': { minGradientBorders: 1 },
  'slop.decoration.emoji-in-heading': { minEmojiHeadings: 1 },
  'slop.decoration.italic-heading': { minItalicHeadings: 1 },
  'slop.decoration.icon-saturation': { minIcons: 12 },
  'slop.decoration.animation': { minAnimSignals: 1 },
  'slop.copy.lexicon': { minHits: 1 },
  'slop.copy.fake-precision': { minHits: 1 },
  'slop.template.trusted-by': { minTrustedBy: 1 },
  'slop.template.hero-trio': { minTrio: 3, maxWidthDiff: 0.15 },
};

// v1: no slop signature is a type-intended pattern (unlike vuln even-split→dashboard).
const TYPE_SUPPRESSIONS = {};

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

// CLI: bun lib/slop.mjs <artifact.html|alt> [slop.json] [--type T] [--medium html]
if (import.meta.url === `file://${process.argv[1]}`) {
  const { writeJson, parseArgs } = await import('./shared/cli.mjs');
  const { validate } = await import('./shared/validator.mjs');
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const inputPath = positional[0];
  if (!inputPath) { console.error('usage: bun lib/slop.mjs <artifact.html> [slop.json] [--type T] [--medium html]'); process.exit(2); }
  const fs = await import('node:fs');
  const path = await import('node:path');
  const html = fs.readFileSync(inputPath, 'utf8');
  const report = scanSlop({ html, medium: flags.medium || 'html', opts: { artifact_type: typeof flags.type === 'string' ? flags.type : undefined } });
  await validate('slop-report', report);
  const outPath = positional[1] || path.join(process.cwd(), `${path.basename(inputPath, path.extname(inputPath))}.slop.json`);
  writeJson(outPath, report);
  const b = report.summary.byTier;
  console.log(`${report.summary.slopCount} slop(s) | P0 ${b.P0} P1 ${b.P1} P2 ${b.P2} | coverage html/${report.summary.coverage.html === 'measured' ? '✓' : '·'} | advisory/uncalibrated | ${outPath}`);
}
