# Slop v2 — Medium Expansion Design

**Status**: spec (not yet implemented)
**Date**: 2026-07-23
**Prerequisite read**: [`2026-07-22-slop-prevention-detection-design.md`](./2026-07-22-slop-prevention-detection-design.md) — v1 design (HTML only).
**Scope**: Define the v2 signature sets + scanners for PPTX and SVG, and document why raster images stay out of scope.

---

## 1. Why v1 stopped at HTML

Slop tells are **medium-specific**. v1 ships HTML only because:

1. Each medium needs its own **scanner** (the literal-presence extractor that turns source into a `ctx` object).
2. Each medium needs its own **calibrated signature set** — the tells differ per medium, so signatures don't transfer.
3. v1's HTML signature set (12 signatures across 4 axes) is the only calibrated set so far. Roadmap calibration needs a human-rated corpus per medium (v2 H2 in the v1 spec).

The scanner contract (`scanHtmlSource(html) → ctx`) and the signature contract (`{ id, title, severity, tier, needs, detect(ctx, t) → finding | null | { unmeasured } }`) **stay identical** in v2. Only the scanner implementations and the signature sets grow.

## 2. Architecture stays; scanner multiplies

```
lib/slop/
  html-source-scan.mjs     ← v1 (shipped)
  pptx-source-scan.mjs     ← v2 (this spec)
  svg-source-scan.mjs      ← v2 (this spec)
  signatures/
    palette.mjs            ← v1 (HTML-specific gradient/glass/gradient-border)
    decoration.mjs         ← v1 (HTML-specific emoji/italic/icon/animation)
    copy.mjs               ← v1 (HTML-specific lexicon/fake-precision)
    template.mjs           ← v1 (HTML-specific trusted-by/hero-trio)
    palette-pptx.mjs       ← v2 (PPTX-specific)
    decoration-pptx.mjs    ← v2
    palette-svg.mjs        ← v2 (SVG-specific)
    decoration-svg.mjs     ← v2
```

`lib/slop.mjs` gains a `medium` switch (currently hardcoded to `'html'`). Each medium loads its own scanner + signature set:

```js
const SCANNERS = {
  html: scanHtmlSource,
  pptx: scanPptxSource,   // v2
  svg:  scanSvgSource,    // v2
};
const SIGS_BY_MEDIUM = {
  html: [...PALETTE, ...DECO, ...COPY, ...TMPL],
  pptx: [...PALETTE_PPTX, ...DECO_PPTX],   // v2
  svg:  [...PALETTE_SVG, ...DECO_SVG],     // v2
};
```

`scanSlop({ medium })` picks the right pair. Findings schema is unchanged; downstream consumers (`skill-post.mjs`, `decision.mjs`, the CLI) are medium-agnostic.

## 3. PPTX scanner — design

### 3.1 Source model

A `.pptx` is a ZIP of OOXML parts. Unpack with the existing `lib/adapters/ooxml/` utilities (already used by the PPTX import adapter). Relevant parts:

- `ppt/slides/slideN.xml` — slide bodies (one per slide)
- `ppt/theme/theme1.xml` — theme colors (a:clrScheme)
- `ppt/slideMasters/slideMaster1.xml` — master layout chrome
- `ppt/slideLayouts/slideLayout*.xml` — inherited layout shells

### 3.2 Context fields (`scanPptxSource` return)

| Field | Type | Source | Why |
|---|---|---|---|
| `themeColors` | `string[]` | theme1.xml `a:clrScheme` | Cliché AI-default themes ship indigo→pink palettes |
| `slideCount` | `number` | slide files | Density signals |
| `bulletDensity` | `number` | per-slide `a:p` with `a:buChar` count | "All-bullets-no-prose" is a PPTX AI tell |
| `defaultTemplateChrome` | `boolean` | master/layout files unmodified from a known template signature | Shipping the template's stock chrome unchanged |
| `masterAnimCount` | `number` | `p:timing` blocks | Decorative transitions on every slide |
| `stockImageCount` | `number` | `<a:blip r:embed="rIdN">` referring to known-stock-image relationship targets | Stock-photo slop (limited by no internet — hash match only) |

### 3.3 Signature candidates (calibration-deferred)

Drafted from observation, **uncalibrated** — corpus tuning is v2 H2. Thresholds are conservative presence floors.

- `slop.pptx.theme-cliche` — theme1.xml uses a cliché indigo→violet→pink `a:clrScheme` (a P0 mirror of HTML `palette.gradient`).
- `slop.pptx.bullet-overload` — bullet-density > N per slide across all slides (PPTX equivalent of icon-saturation).
- `slop.pptx.template-chrome` — slideMaster unmodified from a known stock template (Microsoft default / Google Slides default / AI generator default).
- `slop.pptx.decorative-transition` — every slide has a `p:timing` transition (mirror of HTML `decoration.animation`).
- `slop.pptx.stock-image` — embed hash matches a known stock-image set.

### 3.4 Honest v1 scope carry-overs

- **Master/theme editing is out of scope** (already noted in main README "Out of scope" — PPTX slide masters/themes). Detection is read-only and works against whatever the file contains; remediation is human/regeneration.
- **C2PA / provenance metadata** for embedded raster images is a separate concern (§5 raster limitation applies transitively).

## 4. SVG scanner — design

### 4.1 Source model

An SVG is XML. Parse with the existing `lib/adapters/svg/` adapter. Relevant extractions:

- `<linearGradient>` / `<radialGradient>` `<stop>` colors and offsets
- `<path>` `d` attributes (geometry fingerprinting)
- inline `<style>` blocks (CSS-in-SVG)
- icon-template fingerprints (e.g., Lucide / Heroicons path signatures)

### 4.2 Context fields (`scanSvgSource` return)

| Field | Type | Source | Why |
|---|---|---|---|
| `gradientsLiteral` | `string[]` | gradient element outer-XML | Reuses the v1 HTML cliché-band HSL check |
| `stopColors` | `string[]` | all `<stop stop-color="…">` | Cliché indigo→violet→pink detection |
| `pathFingerprints` | `string[]` | path-d hashes (Ratcliff-Obershelp or length+centroid) | Icon-template fingerprint match |
| `inlineStyle` | `string` | `<style>` block text | Same CSS patterns as HTML (border-top gradient etc.) |
| `filterCount` | `number` | `<filter>` elements | Over-use of `feGaussianBlur` / `feColorMatrix` for fake depth |

### 4.3 Signature candidates (calibration-deferred)

- `slop.svg.gradient-cliche` — stop sequence in cliché hue band (mirror of HTML `palette.gradient`).
- `slop.svg.icon-template` — path-d fingerprint matches a known icon-library template (Lucide / Heroicons / Feather). Hashes against a shipped allowlist (`examples/icon-template-fingerprints.json` — v2 deliverable).
- `slop.svg.glass-filter` — `<filter>` chain dominated by `feGaussianBlur` + `feColorMatrix` (SVG equivalent of HTML `backdrop-filter`).
- `slop.svg.decorative-animation` — `<animate>` / `<animateTransform>` on static content.

### 4.4 Overlap with HTML signatures

When SVG is embedded in HTML, both scanners run. Findings dedupe by signature `id` already (v1 dedup-by-id behavior in `scanSlop`). The same gradient cliche in an inline SVG inside HTML may produce one `palette.gradient` finding (HTML scan) AND one `svg.gradient-cliche` finding (SVG scan). Downstream consumers see both; they're different signatures with different `id`s, so dedup doesn't collapse them — that's intentional (the HTML tell and the SVG tell are independent signals).

## 5. Raster images — out of scope, with documented reason

### 5.1 Why raster is out of scope

AI-generated raster images (ChatGPT image gen, Nanobanana, Midjourney, Stable Diffusion outputs) carry tells:

- **Anatomical errors** (extra fingers, merged limbs, asymmetrical eyes)
- **Texture artifacts** (smooth-then-noisy transitions, repetitive patterns)
- **Lighting inconsistencies** (multiple light sources, shadow direction mismatch)
- **Frequency-domain fingerprints** (diffusion-model artifacts in high-frequency components)
- **C2PA / provenance metadata** (when present)

None of these are detectable by current capability (this is a capability gap, not a category gap — the engine already extracts quadtree geometry from pixels via the image adapter, so "pixels have no geometry" would be wrong):
- **The image adapter's quadtree** extracts layout-level geometry, not pixel-level AI-tell fingerprints (different problem).
- **Literal-presence regex** (slop v1 scanner) reads text/CSS from source — raster pixels have neither.
- **A vision model** is what these tells actually need (frequency analysis, GAN-fingerprint matching, C2PA parsing) — and a pure-JS no-browser engine can't host one (DESIGN.md out-of-scope).

### 5.2 What would unlock raster slop detection

Three prerequisites, all out of current scope:

1. **Phase 3 image/vision hook** (per main README) — turn a raster screenshot/image into an ALT via a vision model. This gives the engine geometric primitives for the image's *layout*, but not its *AI-tell* fingerprints.
2. **A vision model host** — for direct AI-image classification (frequency analysis, GAN fingerprinting, C2PA parsing). Pure-JS no-browser engine explicitly refuses this.
3. **A signature calibration corpus** of human-labeled AI-generated vs human-made images, per generator family.

Until all three exist, raster slop detection is documented as **out of scope** in both the main README and `lib/slop.mjs` header. Slop signatures that fire on raster metadata only (e.g., C2PA `SignedBy` field matching a known AI generator) could be added as a v2.5 concession if the engine ever gains metadata-reading capability — but that's an edge case, not a roadmap item.

## 6. Cross-cutting concerns

### 6.1 Schema stability

`schemas/slop-report.schema.json` doesn't change. Findings carry the same `{ id, title, severity, tier, signal, threshold, nodes, remediation, mode }` shape regardless of medium. The `summary.coverage` field gains a `medium` value:

```json
"coverage": {
  "html": "measured",
  "pptx": "unmeasurable",   // v2
  "svg":  "unmeasurable",   // v2
  "raster": "out-of-scope", // permanent
  ...
}
```

### 6.2 CLI surface

`bun lib/slop.mjs <artifact> [out.json] [--type T] [--medium html]`

`--medium` already exists in v1 (defaults to `html`). v2 accepts `pptx` | `svg`. Each medium routes to its scanner+signature pair. No new CLI flags.

### 6.3 Threshold overrides

Threshold overrides (`opts.thresholds[sigId]`) stay per-signature. A user can override `slop.pptx.theme-cliche.minClichéStops` without affecting the HTML `slop.palette.gradient` threshold, because the ids differ. The `DEFAULT_THRESHOLDS` map grows per medium.

## 7. Implementation phasing

**Phase 2a — PPTX (estimated: 1 scanner + 4-5 signatures + tests)**
- Ship `lib/slop/pptx-source-scan.mjs`
- Ship `lib/slop/signatures/palette-pptx.mjs` + `decoration-pptx.mjs`
- Wire `medium: 'pptx'` branch in `lib/slop.mjs`
- Test fixtures: `examples/slop-pptx/` (clean + cliché samples)
- Corpus tuning deferred (v2 H2)

**Phase 2b — SVG (estimated: 1 scanner + 3-4 signatures + tests)**
- Ship `lib/slop/svg-source-scan.mjs`
- Ship `lib/slop/signatures/palette-svg.mjs` + `decoration-svg.mjs`
- Wire `medium: 'svg'`
- Test fixtures: `examples/slop-svg/`

**Phase 2c — Raster (out of scope indefinitely)**
- Document the prerequisite chain in `DESIGN.md` Phase 3 hook spec
- No scanner shipped

## 8. What this spec does NOT do

- Does not ship any new code. v1 stays HTML-only on disk.
- Does not change the existing HTML signature set.
- Does not commit to a calibration corpus — that's v2 H2 (a separate human-rated-corpus effort, parallel to the existing `validate.mjs` Bradely-Terry harness).
- Does not address **pre-generation** rules (`lib/slop-rules.mjs`) — those are medium-agnostic in spirit (rules are prose) and stay as-is. A v2 rules expansion for PPTX/SVG-specific generation guidance is a separate doc.

## 9. Open questions

1. **Icon-template fingerprint allowlist** — Lucide/Heroicons/Feather are obvious inclusions, but maintaining the allowlist is ongoing work. Defer to v2 H1.
2. **Cross-medium finding dedup** — when the same artifact triggers both an HTML and an SVG finding for the same effective tell (e.g., gradient cliche in inline SVG), is one finding redundant? Current answer: no — they're independent signals with different `id`s. Revisit after corpus tuning.
3. **PPTX template-chrome fingerprint source** — Microsoft defaults are well-known; Google Slides defaults less so; AI-generator defaults (Gamma, Beautiful.ai) are emerging. Allowlist maintenance is ongoing.
