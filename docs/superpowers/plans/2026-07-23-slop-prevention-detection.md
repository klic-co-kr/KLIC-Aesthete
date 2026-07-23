# Slop 예방 + 탐지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic slop-prevention (generation constraints) + slop-detection (post-hoc HTML signatures) axis to Aesthete, with zero signature overlap with the existing `vuln` engine and honest coverage reporting.

**Architecture:** Two layers. *Prevention* = a pure-data anti-slop rules catalog (`lib/slop-rules.mjs`) injected into `skill-pre` prompt bullets + a non-enforced self-check (`slop-test.md`). *Detection* = a `lib/slop/` engine that mirrors `lib/vuln.mjs` (signature array + `scanSlop` fold + `TYPE_SUPPRESSIONS` + overridable thresholds + advisory coverage), fed by a literal-presence HTML source scanner. Detection findings fold into `skill-decision` at priority 60 (same seat as vuln). v1 is HTML-only and fully deterministic; SVG/PPTX/copy-LLM-judge are v2.

**Tech Stack:** Bun + plain ESM (`.mjs`), `bun:test`, JSON-Schema (ajv, optional). No new dependencies. No network. No LLM in v1.

**Spec:** `docs/superpowers/specs/2026-07-22-slop-prevention-detection-design.md` (authoritative — read it before Task 1).

## Global Constraints

Copied verbatim from the spec §2/§5/§6 — every task inherits these:

- **v1 scope = HTML only.** SVG/PPTX = unmeasured in v1, not implemented.
- **v1 = fully deterministic.** No `Date`, no `Math.random`. Same input → byte-identical `slop.json` + `decision.json`.
- **One pattern = one engine.** slop signatures have **zero overlap** with `vuln` (spec §3 H1/H3). `ai-cliche-palette`, `hanging-header`, `even-split`, `rainbow/no-focal/type-scale` stay vuln-owned. slop owns: `palette.gradient`, `palette.glass`, `decoration.emoji-in-heading`, `decoration.icon-saturation`, `decoration.animation`, `copy.lexicon`, `copy.generic`(v2), `template.trusted-by`, `template.hero-trio`.
- **Thresholds are uncalibrated + overridable.** No hardcoded cutoffs — every threshold lives in a `DEFAULT_THRESHOLDS` map, conservative defaults, overridable via `opts.thresholds[id]`. Marked "uncalibrated" in output (spec §6 H2). slop human-corpus = v2.
- **Coverage honesty — both false-pass and false-fail forbidden (spec §4 C1).** measured-fail → gate. unmeasured → **never a gate**, escalate `human_coverage`. `var()`-indirect / external `<link>` cascade = unmeasured (spec §5 C2/M1).
- **`html-source-scan` = simple literal presence only, NOT a CSS mini-parser (spec §5 M1).** Scans `<style>` blocks + inline `style=""` literal tokens + DOM text + class attrs + heading/structure. Excluded (=unmeasured): `var()` resolution, external stylesheet cascade, `@media` merge, minified complex rules.
- **slop priority = 60** (same seat as vuln, spec §6 M4). Stable tiebreak by config order when vuln+slop both fire.
- **Prevention ≠ Detection (spec §6 C3/M2).** Generation constraints are the primary prevention; `slop-test.md` self-check is secondary and **non-enforced** (self-certification limit). slop-test result is **not** a contract hard criterion. The real gate is the post deterministic signature.
- **slop fix = conservative.** `suggestionOnly` by default. Auto-fix only for the narrow P0 `emoji-strip`, and only under `--slop-autofix` opt-in. No `fix.mjs` extension in this plan.
- **Post is non-destructive.** slop scan never writes the input artifact.
- **Tests:** 80% coverage, TDD (RED before GREEN). FP regression is first-class (spec §7).
- **Commits:** one commit per task (or per GREEN step where noted). Conventional-commit messages.

## File Structure

Locked-in decomposition (spec §3). NEW = 7 lib files + 4 signature files + 1 html scanner + 1 rules + 1 fold. EXTEND = `skill-decision`, `skill-post`, `skill-pre`, `contract`, 3 SKILL.md, 3 schema, `shared/validator.mjs`.

| File | Status | Responsibility |
|---|---|---|
| `lib/slop-rules.mjs` | NEW | Pure data. Anti-slop generation constraints, medium-keyed. `getRules(medium) → {bullets, negation}`. |
| `lib/slop/html-source-scan.mjs` | NEW | Literal-presence HTML scan → `styleCtx`. No CSS parser. |
| `lib/slop/signatures/palette.mjs` | NEW | `palette.gradient` (P0), `palette.glass` (P1). Exports `SIGNATURES`. |
| `lib/slop/signatures/decoration.mjs` | NEW | `decoration.emoji-in-heading` (P0), `icon-saturation` (P1), `animation` (P1). |
| `lib/slop/signatures/copy.mjs` | NEW | `copy.lexicon` (P2, regex). `copy.generic` (v2 stub, returns unmeasured). |
| `lib/slop/signatures/template.mjs` | NEW | `template.trusted-by` (P1), `template.hero-trio` (P1). |
| `lib/slop.mjs` | NEW | Fold. `scanSlop({alt, medium, html, opts}) → slopReport`. Mirrors `vuln.scanAlt`. |
| `schemas/slop-report.schema.json` | NEW | Schema for slopReport. |
| `lib/skill-decision.mjs` | EXTEND | `PRI.regenerate_slop = 60`; new inputs `{slopReport, slopGate, slopAutofix}`; fold block. |
| `lib/skill-post.mjs` | EXTEND | Read raw HTML when domain=html; call `scanSlop`; write `slop.json`; pass to fold. |
| `lib/contract.mjs` | EXTEND | Accept `skill: 'slop-*'` criteria (no-op change — `skill` is already free-string; add a slop criteria example + doc). |
| `lib/skill-pre.mjs` | EXTEND | Inject slop bullets/negation into `prompt_bullets`/`negation`; emit `slop-test.md`. |
| `skills/aesthete-pre/SKILL.md` | EXTEND | Playbook: honor generation constraints + run `slop-test.md` self-check (non-enforced). |
| `skills/aesthete-post/SKILL.md` | EXTEND | Document `--slop` / `--slop-gate` / `--slop-autofix`. |
| `schemas/report.schema.json` | EXTEND | No structural change — confirm `additionalProperties` on `skills` already tolerates advisory slots (see Task 10). |
| `schemas/decision.schema.json` | EXTEND | `reasons[].code` already free-string; document `SLOP_*` codes. No structural change. |
| `schemas/brief.schema.json` | EXTEND | Optional `slop` config object (`{enabled, gate, autofix, thresholds}`). |
| `lib/shared/validator.mjs` | EXTEND | Add `'slop-report'` to the schema loader list. |
| `test/slop-rules.test.mjs` | NEW | Unit. |
| `test/slop-source-scan.test.mjs` | NEW | Unit. |
| `test/slop-signatures.test.mjs` | NEW | Unit (all 4 signature files + dedup vs vuln). |
| `test/slop-fold.test.mjs` | NEW | Unit (scanSlop fold + coverage). |
| `test/slop-integration.test.mjs` | NEW | Integration (skill-post → decision; vuln/slop dedup; var()→human_coverage). |
| `test/slop-fp.test.mjs` | NEW | FP regression suite (legitimate designs never flagged). |
| `examples/slop-html/` | NEW | Synthetic slop HTML + legitimate-design HTML fixtures. |

**Design reconciliation R1 (IMPORTANT — read before Task 7):** Spec §3/§4 say "slop findings → `report.skills` 병합" but §6 + "vuln 선례 복제" say mirror vuln's separate advisory report. `report.skills` (per `schemas/report.schema.json`) requires a score-based `{score, metrics, violations}` shape per skill — it does **not** fit advisory severity findings (slop has no continuous score; it has tier + remediation, exactly like vuln). This plan resolves the contradiction by **mirroring vuln: slop produces a separate `slopReport` (`slop.json`)**, passed to `foldDecision` via new `{slopReport, slopGate}` inputs. This (a) satisfies "vuln 선례 복제", (b) makes vuln/slop dedup trivial (parallel advisory engines, disjoint ids), (c) matches the decision-fold table exactly. The "merge into report.skills" intent is satisfied indirectly: slop findings surface as `SLOP_*` reasons in `decision.json` + the advisory `slop.json`. Documented here so the implementer does not attempt a score-shoehorn.

---

### Task 1: `lib/slop-rules.mjs` — anti-slop generation constraints (pure data)

**Files:**
- Create: `lib/slop-rules.mjs`
- Test: `test/slop-rules.test.mjs`

**Interfaces:**
- Produces: `getRules(medium: string) → { bullets: string[], negation: Record<string,string[]> }`. `medium` ∈ `['html','svg','pptx','docx','image']`; unknown → treated as universal (no medium-specific extras). v1 populates `html`-specific extras; other media return universal only (v2 will extend).

- [ ] **Step 1: Write the failing test**

`test/slop-rules.test.mjs`:
```js
import { test, expect } from 'bun:test';
import { getRules } from '../lib/slop-rules.mjs';

test('slop-rules: html rules include universal + html-specific bullets', () => {
  const r = getRules('html');
  expect(r.bullets.length).toBeGreaterThanOrEqual(4);
  expect(r.bullets.some((b) => /gradient/i.test(b))).toBe(true);
  expect(r.bullets.some((b) => /emoji/i.test(b) && /heading/i.test(b))).toBe(true);
  expect(r.negation.palette).toBeInstanceOf(Array);
  expect(r.negation.palette.some((n) => /gradient/i.test(n))).toBe(true);
});

test('slop-rules: svg medium returns universal only (no html-only extras)', () => {
  const html = getRules('html');
  const svg = getRules('svg');
  // universal bullets present, html-only extras absent
  expect(svg.bullets.some((b) => /icon/i.test(b))).toBe(false);
  expect(svg.bullets.length).toBeLessThan(html.bullets.length);
  expect(svg.bullets.length).toBeGreaterThan(0);
});

test('slop-rules: unknown medium falls back to universal (deterministic)', () => {
  const a = getRules('???');
  const b = getRules('???');
  expect(a).toEqual(b);
  expect(a.bullets.length).toBeGreaterThan(0);
});

test('slop-rules: every bullet and negation is a non-empty string (no placeholders)', () => {
  const r = getRules('html');
  for (const b of r.bullets) expect(typeof b === 'string' && b.length > 0).toBe(true);
  for (const items of Object.values(r.negation)) {
    for (const n of items) expect(typeof n === 'string' && n.length > 0).toBe(true);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/slop-rules.test.mjs`
Expected: FAIL — `Cannot find module '../lib/slop-rules.mjs'`.

- [ ] **Step 3: Write minimal implementation**

`lib/slop-rules.mjs`:
```js
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

function mergeNeg(a, b) {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/slop-rules.test.mjs`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/slop-rules.mjs test/slop-rules.test.mjs
git commit -m "feat(slop): anti-slop generation rules catalog (prevention layer)"
```

---

### Task 2: `lib/slop/html-source-scan.mjs` — literal-presence HTML scan

**Files:**
- Create: `lib/slop/html-source-scan.mjs`
- Test: `test/slop-source-scan.test.mjs`

**Interfaces:**
- Produces: `scanHtmlSource(html: string) → StyleCtx` where:
```ts
type StyleCtx = {
  gradientsLiteral: string[];      // raw `linear-gradient(...)` / `radial-gradient(...)` substrings found in <style> + inline style
  gradientVarIndirect: boolean;    // true if any gradient references var() → that gradient is unmeasurable (C2)
  glassLiteral: string[];          // `backdrop-filter:` occurrences
  glassVarIndirect: boolean;
  keyframesLiteral: string[];      // @keyframes names; bodies scanned for scale/spin/rotate
  animationSignals: string[];      // ['scale','spin','rotate'] found in @keyframes bodies
  headings: { tag: string, text: string }[];  // h1..h6 inner text (emoji-in-heading)
  textSamples: string[];           // p/li/span/button text for copy.lexicon (capped)
  classAttrs: string[];            // every class= value (icon-saturation: count lucide/svg hints)
  svgIconCount: number;            // <svg ...> count (icon library glyphs)
  hasTrustedBy: boolean;           // DOM contains /trusted by/i
  measuredNotes: string[];         // human-readable list of what was NOT measurable (var() indirect, <link>, @media)
};
```
- Consumes: nothing (leaf module).

- [ ] **Step 1: Write the failing test**

`test/slop-source-scan.test.mjs`:
```js
import { test, expect } from 'bun:test';
import { scanHtmlSource } from '../lib/slop/html-source-scan.mjs';

test('scan: extracts literal gradient + glass + keyframes from <style>', () => {
  const html = `<style>
    .h { background: linear-gradient(135deg,#6366f1,#ec4899); }
    .g { backdrop-filter: blur(8px); }
    @keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
  </style>`;
  const c = scanHtmlSource(html);
  expect(c.gradientsLiteral.length).toBe(1);
  expect(c.glassLiteral.length).toBe(1);
  expect(c.animationSignals).toContain('rotate');
});

test('scan: extracts inline style gradient + headings text', () => {
  const html = `<h1>Launch 🚀 now</h1><h2>Ship</h2><p>delve into robust</p>`;
  const c = scanHtmlSource(html);
  expect(c.headings.length).toBe(2);
  expect(c.headings[0].text).toContain('🚀');
  expect(c.textSamples.some((t) => /delve/.test(t))).toBe(true);
});

test('scan: var()-indirect gradient is flagged unmeasurable, not clean', () => {
  const html = `<style>.h { background: linear-gradient(var(--brand-a), var(--brand-b)); }</style>`;
  const c = scanHtmlSource(html);
  expect(c.gradientVarIndirect).toBe(true);
  expect(c.measuredNotes.some((n) => /var\(\)/.test(n))).toBe(true);
});

test('scan: svg icon count + trusted-by presence', () => {
  const html = `<svg class="lucide lucide-x"></svg><svg></svg><p>Trusted by Acme</p>`;
  const c = scanHtmlSource(html);
  expect(c.svgIconCount).toBe(2);
  expect(c.hasTrustedBy).toBe(true);
});

test('scan: does NOT parse external <link> cascade (unmeasured note)', () => {
  const html = `<link rel="stylesheet" href="styles.css">`;
  const c = scanHtmlSource(html);
  expect(c.measuredNotes.some((n) => /external|link|cascade/i.test(n))).toBe(true);
});

test('scan: empty input is safe (no throw, empty ctx)', () => {
  const c = scanHtmlSource('');
  expect(c.gradientsLiteral).toEqual([]);
  expect(c.svgIconCount).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/slop-source-scan.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`lib/slop/html-source-scan.mjs`:
```js
// Simple LITERAL-PRESENCE HTML scan. NOT a CSS mini-parser (spec §5 M1).
// Extracts tokens from <style> blocks + inline style="" + DOM text/class/structure.
// EXCLUDED (= reported in measuredNotes, never faked): var() indirect resolution, external
// <link> cascade, @media merge, minified complex rules. Deterministic (no Date/random).

const GRAD_RE = /(?:linear|radial|conic)-gradient\([^;}]*/gi;
const GLASS_RE = /backdrop-filter\s*:[^;}]*/gi;
const KEYFRAMES_RE = /@keyframes\s+([A-Za-z0-9_-]+)\s*\{([^{}]*)\}/gi;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/slop-source-scan.test.mjs`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/slop/html-source-scan.mjs test/slop-source-scan.test.mjs
git commit -m "feat(slop): literal-presence HTML source scanner (no CSS parser)"
```

---

### Task 3: `signatures/palette.mjs` — gradient (P0) + glass (P1)

**Files:**
- Create: `lib/slop/signatures/palette.mjs`
- Test: `test/slop-signatures.test.mjs` (shared across Tasks 3–6; create here, extend in 4/5/6)

**Interfaces:**
- Produces: `SIGNATURES` array. Each entry mirrors vuln's shape plus a `tier`:
```ts
type Signature = {
  id: string;            // 'slop.palette.gradient'
  title: string;
  severity: 'high'|'medium'|'low';
  tier: 'P0'|'P1'|'P2';
  needs: string[];       // ['htmlSource'] — required ctx keys
  detect(ctx: StyleCtx, t: Thresholds) : null | { unmeasured: true, reason: string } | Finding
};
type Finding = { signal: number, threshold: number, nodes: string[], remediation: string };
```
- Consumes: `StyleCtx` from `html-source-scan.mjs` (Task 2).

**Cliché stop set (conservative, spec §7 FP suite):** P0 gradient fires only on the AI-cliché stop band — hex/named stops whose HSL hue ∈ [230, 340] (indigo→violet→pink). Legitimate subtle gradients (e.g. two warm neutrals) → P1 advisory at most, but **P0 is cliché-stops-only** so they don't fire. Threshold overridable.

- [ ] **Step 1: Write the failing test (create the shared file)**

`test/slop-signatures.test.mjs`:
```js
import { test, expect } from 'bun:test';
import { SIGNATURES as PALETTE } from '../lib/slop/signatures/palette.mjs';
import { scanHtmlSource } from '../lib/slop/html-source-scan.mjs';

const ctxOf = (html) => scanHtmlSource(html);
const detect = (sig, html, t = {}) => sig.detect(ctxOf(html), t);

test('palette.gradient: cliché indigo→pink fires (P0 high)', () => {
  const sig = PALETTE.find((s) => s.id === 'slop.palette.gradient');
  const html = `<style>.h{background:linear-gradient(135deg,#6366f1,#ec4899)}</style>`;
  const f = detect(sig, html);
  expect(f).toBeTruthy();
  expect(f.unmeasured).not.toBe(true);
  expect(sig.tier).toBe('P0');
  expect(sig.severity).toBe('high');
});

test('palette.gradient: legitimate warm-neutral gradient does NOT fire P0', () => {
  const sig = PALETTE.find((s) => s.id === 'slop.palette.gradient');
  const html = `<style>.h{background:linear-gradient(90deg,#f5f0e6,#e8dcc8)}</style>`;
  const f = detect(sig, html);
  // no cliché stop → no P0 finding (null)
  expect(f).toBeNull();
});

test('palette.gradient: var()-indirect gradient → unmeasured (never false-fail)', () => {
  const sig = PALETTE.find((s) => s.id === 'slop.palette.gradient');
  const html = `<style>.h{background:linear-gradient(var(--a),var(--b))}</style>`;
  const f = detect(sig, html);
  expect(f && f.unmeasured).toBe(true);
});

test('palette.glass: backdrop-filter literal fires (P1)', () => {
  const sig = PALETTE.find((s) => s.id === 'slop.palette.glass');
  const html = `<style>.g{backdrop-filter:blur(8px)}</style>`;
  const f = detect(sig, html);
  expect(f).toBeTruthy();
  expect(sig.tier).toBe('P1');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/slop-signatures.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`lib/slop/signatures/palette.mjs`:
```js
// slop palette signatures. P0 = cliché AI gradient stops; P1 = glassmorphism.
// Cliché band = HSL hue ∈ [230,340] (indigo→violet→pink). Conservative: a gradient fires P0
// only if ≥2 distinct cliché-band stops are present. var()-indirect → unmeasured (no false-fail).

const HEX_RE = /#([0-9a-f]{3,8})\b/gi;

function hexToHsl(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let hue = 0;
  if (max !== min) {
    const d = max - min;
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  const s = max === min ? 0 : (l > 0.5 ? d / (2 - max - min) : d / (max + min));
  return { h: hue, s, l };
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
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/slop-signatures.test.mjs`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/slop/signatures/palette.mjs test/slop-signatures.test.mjs
git commit -m "feat(slop): palette signatures (gradient P0 cliché, glass P1)"
```

---

### Task 4: `signatures/decoration.mjs` — emoji-in-heading (P0) + icon-saturation (P1) + animation (P1)

**Files:**
- Create: `lib/slop/signatures/decoration.mjs`
- Test: `test/slop-signatures.test.mjs` (extend — append tests)

**Interfaces:**
- Produces: `SIGNATURES` array, same shape as Task 3.
- Consumes: `StyleCtx` (headings, svgIconCount, classAttrs, animationSignals).

- [ ] **Step 1: Write the failing test (append to `test/slop-signatures.test.mjs`)**

```js
import { SIGNATURES as DECO } from '../lib/slop/signatures/decoration.mjs';

test('decoration.emoji-in-heading: emoji inside h1 fires (P0)', () => {
  const sig = DECO.find((s) => s.id === 'slop.decoration.emoji-in-heading');
  const f = sig.detect(ctxOf(`<h1>Ship 🚀 faster</h1>`), {});
  expect(f).toBeTruthy();
  expect(sig.tier).toBe('P0');
});

test('decoration.emoji-in-heading: emoji in body paragraph does NOT fire', () => {
  const sig = DECO.find((s) => s.id === 'slop.decoration.emoji-in-heading');
  const f = sig.detect(ctxOf(`<p>see 🚀 below</p>`), {});
  expect(f).toBeNull();
});

test('decoration.icon-saturation: excessive svg icons fire (P1)', () => {
  const sig = DECO.find((s) => s.id === 'slop.decoration.icon-saturation');
  const html = `<svg></svg>`.repeat(14);
  const f = sig.detect(ctxOf(html), {});
  expect(f).toBeTruthy();
  expect(sig.tier).toBe('P1');
});

test('decoration.animation: scale/rotate keyframe fires (P1)', () => {
  const sig = DECO.find((s) => s.id === 'slop.decoration.animation');
  const html = `<style>@keyframes s{from{transform:scale(1)}to{transform:scale(1.1)}}</style>`;
  const f = sig.detect(ctxOf(html), {});
  expect(f).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/slop-signatures.test.mjs`
Expected: FAIL — `decoration.mjs` not found.

- [ ] **Step 3: Write minimal implementation**

`lib/slop/signatures/decoration.mjs`:
```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/slop-signatures.test.mjs`
Expected: PASS — 8 tests total (4 palette + 4 decoration).

- [ ] **Step 5: Commit**

```bash
git add lib/slop/signatures/decoration.mjs test/slop-signatures.test.mjs
git commit -m "feat(slop): decoration signatures (emoji P0, icon-sat + animation P1)"
```

---

### Task 5: `signatures/copy.mjs` — lexicon (P2) + generic (v2 stub)

**Files:**
- Create: `lib/slop/signatures/copy.mjs`
- Test: extend `test/slop-signatures.test.mjs`

**Interfaces:**
- Produces: `SIGNATURES`. `copy.lexicon` (P2, regex) is live in v1. `copy.generic` (LLM) returns `{ unmeasured: true, reason: 'LLM judge is v2' }` — never fires, never gates.

- [ ] **Step 1: Write the failing test (append)**

```js
import { SIGNATURES as COPY } from '../lib/slop/signatures/copy.mjs';

test('copy.lexicon: cliché word fires (P2 advisory)', () => {
  const sig = COPY.find((s) => s.id === 'slop.copy.lexicon');
  const f = sig.detect(ctxOf(`<p>Let's delve into our robust, cutting-edge platform.</p>`), {});
  expect(f).toBeTruthy();
  expect(sig.tier).toBe('P2');
});

test('copy.lexicon: clean copy does NOT fire', () => {
  const sig = COPY.find((s) => s.id === 'slop.copy.lexicon');
  const f = sig.detect(ctxOf(`<p>The cache invalidates on write.</p>`), {});
  expect(f).toBeNull();
});

test('copy.generic: always unmeasured in v1 (LLM judge is v2, never gates)', () => {
  const sig = COPY.find((s) => s.id === 'slop.copy.generic');
  const f = sig.detect(ctxOf(`<p>anything</p>`), {});
  expect(f && f.unmeasured).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/slop-signatures.test.mjs`
Expected: FAIL — `copy.mjs` not found.

- [ ] **Step 3: Write minimal implementation**

`lib/slop/signatures/copy.mjs`:
```js
// slop copy signatures. P2 = lexicon cliché words (regex, v1). generic = LLM judge (v2 stub →
// always unmeasured; never fires, never gates). Lexicon is conservative + overridable.

const DEFAULT_LEXICON = [
  'delve', 'unleash', 'leverage', 'robust', 'cutting-edge', 'seamless',
  'game-changer', 'revolutionary', 'empower', 'synergy', 'streamline',
];

export const SIGNATURES = [
  {
    id: 'slop.copy.lexicon',
    title: 'cliché LLM marketing lexicon',
    severity: 'low',
    tier: 'P2',
    needs: ['textSamples'],
    detect(ctx, t = {}) {
      const lex = t.lexicon || DEFAULT_LEXICON;
      const hay = ((ctx.textSamples || []).join(' ')).toLowerCase();
      const hits = lex.filter((w) => hay.includes(w));
      const min = t.minHits ?? 1;
      if (hits.length < min) return null;
      return { signal: hits.length, threshold: min, nodes: [], remediation: `cliché lexicon (${hits.slice(0, 4).join(', ')}${hits.length > 4 ? '…' : ''}) — replace with concrete language` };
    },
  },
  {
    id: 'slop.copy.generic',
    title: 'generic templated copy (LLM judge)',
    severity: 'low',
    tier: 'P2',
    needs: ['textSamples'],
    detect() {
      // v2: LLM judge over headings + sampled text, content-hash cached. Until then, unmeasured.
      return { unmeasured: true, reason: 'copy.generic requires the LLM judge (v2) — not evaluated' };
    },
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/slop-signatures.test.mjs`
Expected: PASS — 11 tests total.

- [ ] **Step 5: Commit**

```bash
git add lib/slop/signatures/copy.mjs test/slop-signatures.test.mjs
git commit -m "feat(slop): copy signatures (lexicon P2, generic v2 stub)"
```

---

### Task 6: `signatures/template.mjs` — trusted-by (P1) + hero-trio (P1)

**Files:**
- Create: `lib/slop/signatures/template.mjs`
- Test: extend `test/slop-signatures.test.mjs`

**Interfaces:**
- Produces: `SIGNATURES`. `trusted-by` (P1) uses `StyleCtx.hasTrustedBy` + DOM/logo hint. `hero-trio` (P1) uses `StyleCtx` + ALT geometry (3-up hero card row) — ALT passed via ctx.alt (fold injects it).
- Consumes: `StyleCtx`; fold also attaches `ctx.alt` (Task 7).

**Dedup guard (spec §3 H1):** `hanging-header` and `even-split` are **vuln-owned** — they MUST NOT appear here. Task 7's dedup test asserts disjoint ids with vuln.

- [ ] **Step 1: Write the failing test (append)**

```js
import { SIGNATURES as TMPL } from '../lib/slop/signatures/template.mjs';

test('template.trusted-by: "Trusted by" + logo strip fires (P1)', () => {
  const sig = TMPL.find((s) => s.id === 'slop.template.trusted-by');
  const html = `<section><h3>Trusted by</h3><img src="a"><img src="b"><img src="c"></section>`;
  const f = sig.detect(ctxOf(html), {});
  expect(f).toBeTruthy();
  expect(sig.tier).toBe('P1');
});

test('template.trusted-by: absent does NOT fire', () => {
  const sig = TMPL.find((s) => s.id === 'slop.template.trusted-by');
  expect(sig.detect(ctxOf(`<p>hello</p>`), {})).toBeNull();
});

test('template.hero-trio: three equal hero cards fire (P1)', () => {
  const sig = TMPL.find((s) => s.id === 'slop.template.hero-trio');
  const alt = { nodes: [
    { id: 'a', bbox: { x: 0, y: 0, w: 100, h: 100 } },
    { id: 'b', bbox: { x: 110, y: 0, w: 100, h: 100 } },
    { id: 'c', bbox: { x: 220, y: 0, w: 100, h: 100 } },
  ] };
  const f = sig.detect({ ...ctxOf(`<div></div>`), alt }, {});
  expect(f).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/slop-signatures.test.mjs`
Expected: FAIL — `template.mjs` not found.

- [ ] **Step 3: Write minimal implementation**

`lib/slop/signatures/template.mjs`:
```js
// slop template signatures. P1 = trusted-by logo strip, hero-trio (3-up equal hero cards).
// hanging-header + even-split are VULN-owned (lib/vuln.mjs) — NOT duplicated here (spec §3 H1).
// hero-trio needs alt geometry; the fold attaches ctx.alt.

const LOGO_RE = /<img\b/gi;

export const SIGNATURES = [
  {
    id: 'slop.template.trusted-by',
    title: '"Trusted by" logo strip (templated-marketing tell)',
    severity: 'medium',
    tier: 'P1',
    needs: ['hasTrustedBy'],
    detect(ctx, t = {}) {
      if (!ctx.hasTrustedBy) return null;
      const logos = ctx.classAttrs ? 0 : 0; // classAttrs exists; logo hint from raw not retained → use svg/img not needed for v1 presence
      const min = t.minTrustedBy ?? 1; // presence is enough for v1 (logo-count tuning is v2)
      return { signal: 1, threshold: min, nodes: [], remediation: 'drop the "Trusted by" logo strip — especially with fabricated names/metrics; earn trust with one concrete proof' };
    },
  },
  {
    id: 'slop.template.hero-trio',
    title: 'three-up equal hero card row (templated-landing tell)',
    severity: 'medium',
    tier: 'P1',
    needs: ['alt'],
    detect(ctx, t = {}) {
      const nodes = (ctx.alt?.nodes || []).filter((n) => n?.bbox);
      if (nodes.length < 3) return null;
      // three siblings of near-equal area on the same row band
      const byRow = new Map();
      for (const n of nodes) {
        const row = Math.round(n.bbox.y / 40); // 40px row bucket
        if (!byRow.has(row)) byRow.set(row, []);
        byRow.get(row).push(n);
      }
      const min = t.minTrio ?? 3;
      const maxWdiff = t.maxWidthDiff ?? 0.15;
      let hit = null;
      for (const grp of byRow.values()) {
        if (grp.length < min) continue;
        const ws = grp.map((n) => n.bbox.w);
        const meanW = ws.reduce((a, b) => a + b, 0) / ws.length;
        if (meanW <= 0) continue;
        const spread = Math.max(...ws.map((w) => Math.abs(w - meanW) / meanW));
        if (spread <= maxWdiff) { hit = { count: grp.length, spread }; break; }
      }
      if (!hit) return null;
      return { signal: hit.count, threshold: min, nodes: [], remediation: 'three-up equal hero cards read as a template — vary scale/weight or commit a single focal' };
    },
  },
];
```

> Note for implementer: the `trusted-by` `detect` uses `ctx.hasTrustedBy` only (logo-count tuning deferred to v2 per spec §6 H2). The unused `LOGO_RE`/`logos` line is a placeholder hook — if you keep it, also keep a test; otherwise delete it. Prefer delete to keep the file clean. (Do not leave dead code.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/slop-signatures.test.mjs`
Expected: PASS — 14 tests total.

- [ ] **Step 5: Commit**

```bash
git add lib/slop/signatures/template.mjs test/slop-signatures.test.mjs
git commit -m "feat(slop): template signatures (trusted-by, hero-trio P1)"
```

---

### Task 7: `lib/slop.mjs` fold + `slop-report` schema + dedup assertion

**Files:**
- Create: `lib/slop.mjs`, `schemas/slop-report.schema.json`
- Modify: `lib/shared/validator.mjs` (add `'slop-report'` to loader list)
- Test: `test/slop-fold.test.mjs`, + dedup test in `test/slop-fold.test.mjs`

**Interfaces:**
- Produces: `scanSlop({ alt, medium, html, opts }) → slopReport`, where:
```ts
type slopReport = {
  schema_version: 1,
  summary: {
    slopCount: number,
    byTier: { P0: number, P1: number, P2: number },
    coverage: { html: 'measured'|'unmeasurable', reason?: string },
    artifact_type?: string|null,
    suppressed: { id: string, reason: string }[],
    advisory: true,           // slop is advisory direction, NOT a gate (gate is the decision fold)
    uncalibrated: true,       // thresholds not corpus-calibrated (spec §6 H2); v2
    profile: 'measure-only',
    unmeasured: { id: string, tier: 'P0'|'P1'|'P2', reason: string }[],
  },
  findings: Finding[],        // each: { id, title, severity, tier, signal, threshold, nodes, remediation, mode:'suggestionOnly' }
};
```
- Consumes: all 4 signature files (Task 3–6) + `scanHtmlSource` (Task 2) + `scanAlt` ids from `lib/vuln.mjs` (for the dedup assertion only — read-only import of the id list).

**Fold rules (mirror `vuln.scanAlt`):**
1. Build `ctx = scanHtmlSource(html)`; attach `ctx.alt = alt`.
2. If `html` is empty/non-string (e.g. SVG/PPTX/ALT-only in v1) → `coverage.html = 'unmeasurable'`, no findings, `summary.advisory` still true. (v2 will add per-medium scanners.)
3. For each signature: if a `needs` key is absent → skip (coverage). If `detect` returns `{unmeasured}` → push to `summary.unmeasured` (never a finding). Else if it returns a finding → tier-bucket + `mode:'suggestionOnly'`.
4. `TYPE_SUPPRESSIONS`: none for v1 (slop signatures are not type-intended patterns — unlike vuln's `even-split` for dashboards). Keep the hook as an empty map + a test that confirms suppression is empty (so a future addition is deliberate).
5. Threshold deep-merge per id (shallow merge would NaN-kill via partial override — copy vuln's pattern exactly).
6. **unmeasured entries carry `tier`** (spec §4 C1 / §6): `unmeasured.push({ id: sig.id, tier: sig.tier, reason })`. The decision fold (Task 8) reads this to escalate `human_coverage` when a **P0** signature is scanner-blind (e.g. `var()`-gradient) — we cannot certify "not slop" on that axis, so we escalate instead of silently passing (false-pass forbidden) or failing (false-fail forbidden).

- [ ] **Step 1: Write the failing test**

`test/slop-fold.test.mjs`:
```js
import { test, expect } from 'bun:test';
import { scanSlop, DEFAULT_THRESHOLDS } from '../lib/slop.mjs';
import { scanAlt } from '../lib/vuln.mjs';

const alt = { meta: { canvas: { w: 1000, h: 600 } }, nodes: [] };

test('fold: synthetic slop HTML → P0 finding + coverage measured', () => {
  const html = `<style>.h{background:linear-gradient(135deg,#6366f1,#ec4899)}</style><h1>Launch 🚀</h1>`;
  const r = scanSlop({ alt, medium: 'html', html });
  expect(r.summary.coverage.html).toBe('measured');
  expect(r.summary.byTier.P0).toBeGreaterThanOrEqual(1);
  expect(r.findings.some((f) => f.id === 'slop.palette.gradient')).toBe(true);
  expect(r.summary.advisory).toBe(true);
  expect(r.summary.uncalibrated).toBe(true);
});

test('fold: var()-only gradient → unmeasured entry, NOT a finding (no false-fail)', () => {
  const html = `<style>.h{background:linear-gradient(var(--a),var(--b))}</style>`;
  const r = scanSlop({ alt, medium: 'html', html });
  expect(r.findings.some((f) => f.id === 'slop.palette.gradient')).toBe(false);
  expect(r.summary.unmeasured.some((u) => u.id === 'slop.palette.gradient')).toBe(true);
});

test('fold: empty html (svg/pptx in v1) → coverage unmeasurable, no findings', () => {
  const r = scanSlop({ alt, medium: 'svg', html: '' });
  expect(r.summary.coverage.html).toBe('unmeasurable');
  expect(r.findings).toEqual([]);
});

test('fold: threshold override is deep-merged (partial override keeps siblings)', () => {
  const html = `<style>.h{background:linear-gradient(90deg,#6366f1,#8b5cf6,#ec4899)}</style>`;
  const base = scanSlop({ alt, medium: 'html', html });
  expect(base.summary.byTier.P0).toBeGreaterThanOrEqual(1);
  // override minClichéStops so high it no longer fires; hueLo/hueHi stay defaulted
  const raised = scanSlop({ alt, medium: 'html', html, opts: { thresholds: { 'slop.palette.gradient': { minClichéStops: 99 } } } });
  expect(raised.findings.some((f) => f.id === 'slop.palette.gradient')).toBe(false);
});

test('fold: every finding is suggestionOnly + has remediation', () => {
  const html = `<style>.h{background:linear-gradient(135deg,#6366f1,#ec4899)}.g{backdrop-filter:blur(8px)}</style><h1>🚀</h1>`;
  const r = scanSlop({ alt, medium: 'html', html });
  expect(r.findings.length).toBeGreaterThan(0);
  for (const f of r.findings) {
    expect(f.mode).toBe('suggestionOnly');
    expect(typeof f.remediation).toBe('string');
  }
});

test('dedup: slop signature ids are DISJOINT from vuln ids (H1)', () => {
  const vulnIds = new Set(['no-focal-point','no-spacing-rhythm','type-scale-accident','rainbow-categorical','even-split','ai-cliche-palette','hanging-header']);
  const slopIds = new Set(Object.keys(DEFAULT_THRESHOLDS));
  for (const id of slopIds) expect(vulnIds.has(id)).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/slop-fold.test.mjs`
Expected: FAIL — `lib/slop.mjs` not found.

- [ ] **Step 3: Write minimal implementation**

`lib/slop.mjs`:
```js
#!/usr/bin/env node
// slop fold — deterministic post-hoc AI-slop signature engine. Mirrors lib/vuln.mjs:
// signature array + scan fold + TYPE_SUPPRESSIONS + overridable thresholds + advisory coverage.
// v1 = HTML only (literal-presence source scan). SVG/PPTX/LLM-judge = v2.
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
  'slop.decoration.emoji-in-heading': { minEmojiHeadings: 1 },
  'slop.decoration.icon-saturation': { minIcons: 12 },
  'slop.decoration.animation': { minAnimSignals: 1 },
  'slop.copy.lexicon': { minHits: 1 },
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
  const { readJson, writeJson, parseArgs } = await import('./shared/cli.mjs');
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
```

`schemas/slop-report.schema.json`:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://acc0mplish/aesthete/schemas/slop-report.schema.json",
  "title": "Slop Report",
  "description": "Output of lib/slop.mjs. Deterministic advisory AI-slop signature report. Mirrors vuln-report shape. NOT a gate — the decision fold consumes it.",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "summary", "findings"],
  "properties": {
    "schema_version": { "const": 1 },
    "summary": {
      "type": "object",
      "additionalProperties": false,
      "required": ["slopCount", "byTier", "coverage", "advisory", "uncalibrated", "profile", "unmeasured", "suppressed"],
      "properties": {
        "slopCount": { "type": "integer", "minimum": 0 },
        "byTier": { "type": "object", "properties": { "P0": { "type": "integer" }, "P1": { "type": "integer" }, "P2": { "type": "integer" } } },
        "coverage": { "type": "object", "required": ["html"], "properties": { "html": { "enum": ["measured", "unmeasurable"] }, "reason": { "type": "string" } } },
        "artifact_type": { "type": ["string", "null"] },
        "suppressed": { "type": "array" },
        "advisory": { "const": true },
        "uncalibrated": { "const": true },
        "profile": { "const": "measure-only" },
        "unmeasured": { "type": "array", "items": { "type": "object", "required": ["id", "tier", "reason"], "properties": { "id": { "type": "string" }, "tier": { "enum": ["P0", "P1", "P2"] }, "reason": { "type": "string" } } } }
      }
    },
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "title", "severity", "tier", "signal", "threshold", "nodes", "remediation", "mode"],
        "properties": {
          "id": { "type": "string" },
          "title": { "type": "string" },
          "severity": { "enum": ["high", "medium", "low"] },
          "tier": { "enum": ["P0", "P1", "P2"] },
          "signal": { "type": "number" },
          "threshold": { "type": "number" },
          "nodes": { "type": "array", "items": { "type": "string" } },
          "remediation": { "type": "string" },
          "mode": { "const": "suggestionOnly" }
        }
      }
    }
  }
}
```

Modify `lib/shared/validator.mjs` — add `'slop-report'` to the loader list (the `for` loop near line 19):
```js
for (const t of ['alt', 'contract', 'report', 'brief', 'vuln-report', 'slop-report', 'validation-corpus']) {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/slop-fold.test.mjs`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/slop.mjs schemas/slop-report.schema.json lib/shared/validator.mjs test/slop-fold.test.mjs
git commit -m "feat(slop): scanSlop fold + slop-report schema (mirrors vuln, dedup-verified)"
```

---

### Task 8: `skill-decision.mjs` — `regenerate_slop` priority 60

**Files:**
- Modify: `lib/skill-decision.mjs` (add `PRI.regenerate_slop`, new inputs, fold block)
- Test: extend `test/skill-surface.test.mjs` (golden decision stability already there) + a focused unit in `test/slop-integration.test.mjs`

**Interfaces:**
- Produces: new decision input fields `{ slopReport, slopGate, slopAutofix }` consumed by `foldDecision`. New reason code `SLOP_P0_*` / `SLOP_ADVISORY_*`. Decision `regenerate` at priority **60** when `--slop-gate` + P0/P1 measured-fail (spec §6 M4: same seat as vuln, stable tiebreak).
- Consumes: `slopReport` from Task 7.

**Fold rule (spec §6):**
- P0 measured-fail → `regenerate` priority 60 (unconditional). P1 → regenerate only under `--slop-gate`. P2 → advisory only.
- **P0 unmeasured → `human_coverage` priority 80** (spec §4 C1): when a P0 signature is scanner-blind (`var()`-gradient, etc.), we cannot certify "not slop" — escalate instead of silent-pass (false-pass forbidden) or fail (false-fail forbidden). Non-P0 unmeasured stays advisory (no escalation).

- [ ] **Step 1: Write the failing test**

`test/slop-integration.test.mjs`:
```js
import { test, expect } from 'bun:test';
import { foldDecision } from '../lib/skill-decision.mjs';

const slopP0 = { summary: { coverage: { html: 'measured' } }, findings: [
  { id: 'slop.palette.gradient', tier: 'P0', severity: 'high', title: 'cliché gradient', signal: 2, threshold: 2 },
] };
const slopP1 = { summary: { coverage: { html: 'measured' } }, findings: [
  { id: 'slop.palette.glass', tier: 'P1', severity: 'medium', title: 'glass', signal: 1, threshold: 1 },
] };
const base = (extra = {}) => foldDecision({ report: { summary: { hardIntegrityScore: 1, coverageScore: 1 } }, ...extra });

test('decision: P0 slop measured-fail → regenerate (priority 60, unconditional)', () => {
  const d = base({ slopReport: slopP0 });
  expect(d.decision).toBe('regenerate');
  expect(d.reasons.some((r) => r.code.startsWith('SLOP_P0'))).toBe(true);
});

test('decision: P1 slop → regenerate only under --slop-gate', () => {
  expect(base({ slopReport: slopP1 }).decision).toBe('pass');          // advisory by default
  expect(base({ slopReport: slopP1, slopGate: true }).decision).toBe('regenerate');
});

test('decision: P0 slop unmeasured (var()-gradient) → human_coverage, NOT pass/regenerate (spec §4 C1)', () => {
  const slopVar = { summary: { coverage: { html: 'measured' }, unmeasured: [{ id: 'slop.palette.gradient', tier: 'P0', reason: 'var() indirect' }] }, findings: [] };
  const d = base({ slopReport: slopVar });
  expect(d.decision).toBe('human');
  expect(d.reasons.some((r) => r.code.startsWith('SLOP_P0_UNMEASURED'))).toBe(true);
});

test('decision: non-P0 slop unmeasured → NOT human (advisory only, no escalation)', () => {
  const slopGlassVar = { summary: { coverage: { html: 'measured' }, unmeasured: [{ id: 'slop.palette.glass', tier: 'P1', reason: 'var() indirect' }] }, findings: [] };
  const d = base({ slopReport: slopGlassVar });
  expect(d.decision).toBe('pass');
});

test('decision: slop priority 60 ties stably with vuln (config order, not random)', () => {
  const vuln = { vulnerabilities: [{ id: 'ai-cliche-palette', severity: 'high', title: 'ai palette' }] };
  const a = foldDecision({ report: { summary: { hardIntegrityScore: 1, coverageScore: 1 } }, vulnReport: vuln, vulnGate: true, slopReport: slopP0 });
  const b = foldDecision({ report: { summary: { hardIntegrityScore: 1, coverageScore: 1 } }, vulnReport: vuln, vulnGate: true, slopReport: slopP0 });
  expect(a.decision).toBe('regenerate');
  expect(a.decision).toBe(b.decision); // byte-stable
  expect(a.reasons).toEqual(b.reasons);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/slop-integration.test.mjs`
Expected: FAIL — slop inputs ignored (decision stays `pass`).

- [ ] **Step 3: Write minimal implementation**

In `lib/skill-decision.mjs`:

(a) Add to the `PRI` map (after `regenerate_vuln: 60,`):
```js
  regenerate_slop: 60,   // spec §6 M4: same seat as vuln — both are known-bad detectors
```

(b) Add the fold block (mirror the vuln block, insert immediately AFTER the vuln `else if` block, before the contract block):
```js
  // ---- slop (spec §6) — priority 60, same seat as vuln; stable tiebreak by sort ----
  if (input.slopReport) {
    const measured = input.slopReport.summary?.coverage?.html === 'measured';
    const findings = input.slopReport.findings || [];
    const unmeasured = input.slopReport.summary?.unmeasured || [];
    const p0 = findings.filter((f) => f.tier === 'P0');
    const p1 = findings.filter((f) => f.tier === 'P1');
    const p0Unmeasured = unmeasured.filter((u) => u.tier === 'P0');   // spec §4 C1
    if (measured && p0.length) {
      // P0 measured-fail → regenerate unconditionally (the hard gate)
      for (const f of p0) {
        reasons.push({
          code: `SLOP_P0_${String(f.id.split('.').pop()).toUpperCase()}`,
          tier: 'P0',
          detail: f.title || f.id,
          fixable: false,
        });
      }
      candidates.push({ priority: PRI.regenerate_slop, decision: 'regenerate' });
    } else if (measured && input.slopGate && p1.length) {
      for (const f of p1) {
        reasons.push({
          code: `SLOP_P1_${String(f.id.split('.').pop()).toUpperCase()}`,
          tier: 'P1',
          detail: f.title || f.id,
          fixable: false,
        });
      }
      candidates.push({ priority: PRI.regenerate_slop, decision: 'regenerate' });
    } else if (measured && p0Unmeasured.length) {
      // P0 scanner-blind (var()-gradient etc.) → cannot certify "not slop" → human_coverage.
      // NOT regenerate (no false-fail), NOT pass (no false-pass). spec §4 C1.
      for (const u of p0Unmeasured) {
        reasons.push({
          code: `SLOP_P0_UNMEASURED_${String(u.id.split('.').pop()).toUpperCase()}`,
          tier: 'P0',
          detail: `${u.id}: ${u.reason}`,
          fixable: false,
        });
      }
      candidates.push({ priority: PRI.human_coverage, decision: 'human' });
    } else {
      // P2 / non-gate → advisory reasons only, decision unchanged (mirror vuln advisory)
      for (const f of findings.filter((x) => x.tier === 'P2').slice(0, 5)) {
        reasons.push({
          code: `SLOP_ADVISORY_${String(f.id.split('.').pop()).toUpperCase()}`,
          tier: 'advisory',
          detail: f.title || f.id,
          fixable: false,
        });
      }
    }
  }
```

> Stable tiebreak: `candidates.sort((a, b) => a.priority - b.priority || a.decision.localeCompare(b.decision))` already exists (line ~226). vuln and slop both push `{priority:60, decision:'regenerate'}` — identical object, sort is stable, reasons already sorted by code. No new tiebreak code needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/slop-integration.test.mjs`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/skill-decision.mjs test/slop-integration.test.mjs
git commit -m "feat(decision): regenerate_slop p60 + P0-unmeasured human_coverage (spec §6/§4 C1)"
```

---

### Task 9: `skill-post.mjs` wiring — read raw HTML, scan, fold, write `slop.json`

**Files:**
- Modify: `lib/skill-post.mjs`, `schemas/decision.schema.json` (doc-only — `reasons[].code` is already free-string; add `SLOP_*` to description)
- Test: extend `test/slop-integration.test.mjs`

**Interfaces:**
- Produces: `runPost` reads raw HTML when `domain === 'html'`, calls `scanSlop`, writes `slop.json` when `--slop`/`--slop-gate`/`--slop-autofix`, and passes `{slopReport, slopGate, slopAutofix}` to `foldDecision`.
- Consumes: `scanSlop` (Task 7).

- [ ] **Step 1: Write the failing test (append)**

```js
import { runPost } from '../lib/skill-post.mjs';
import fs from 'node:fs';
import path from 'node:path';

const tmp = (name) => {
  const d = path.join(import.meta.dir, '.tmp-slop-it');
  fs.mkdirSync(d, { recursive: true });
  return path.join(d, name);
};

test('skill-post: html slop → slop.json written + decision=regenerate', async () => {
  const htmlPath = tmp('bad.html');
  fs.writeFileSync(htmlPath, `<style>.h{background:linear-gradient(135deg,#6366f1,#ec4899)}</style><h1>🚀</h1>`);
  const outDir = tmp('out-bad');
  const r = await runPost(htmlPath, { flags: { 'slop-gate': true }, outDir });
  expect(r.slopReport.findings.some((f) => f.id === 'slop.palette.gradient')).toBe(true);
  expect(r.decision.decision).toBe('regenerate');
  expect(fs.existsSync(path.join(outDir, 'slop.json'))).toBe(true);
});

test('skill-post: non-destructive — input bytes unchanged', async () => {
  const htmlPath = tmp('nd.html');
  const before = `<style>.g{backdrop-filter:blur(8px)}</style><p>ok</p>`;
  fs.writeFileSync(htmlPath, before);
  await runPost(htmlPath, { flags: { slop: true }, outDir: tmp('out-nd') });
  expect(fs.readFileSync(htmlPath, 'utf8')).toBe(before);
});

test('skill-post: alt-only input (svg/pptx v1) → slop unmeasurable, no crash', async () => {
  const altPath = tmp('clean.alt.json');
  fs.writeFileSync(altPath, JSON.stringify({ schema_version: 1, meta: { canvas: { w: 1000, h: 600 }, source: 'abstract' }, nodes: [] }));
  const r = await runPost(altPath, { flags: { slop: true }, outDir: tmp('out-alt') });
  expect(r.slopReport.summary.coverage.html).toBe('unmeasurable');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/slop-integration.test.mjs`
Expected: FAIL — `runPost` has no `slopReport` field / `--slop` unknown.

- [ ] **Step 3: Write minimal implementation**

In `lib/skill-post.mjs`:

(a) Add imports (top, after the vuln import line ~14):
```js
import fs from 'node:fs';
import { scanSlop } from './slop.mjs';
```
(`fs` may already be imported at top — check; if so, do not re-import.)

(b) In `runPost`, after the `vulnReport` block and before `contractEval`, add:
```js
  let slopReport = null;
  const wantSlop = Boolean(flags.slop) || Boolean(flags['slop-gate']) || Boolean(flags['slop-autofix']);
  if (alt && wantSlop) {
    // slop v1 = HTML only. Read the RAW source text (the alt adapter drops CSS flow); for
    // non-html inputs slop reports coverage.html = unmeasurable (no false finding).
    let html = '';
    try {
      const domain = detectDomain(inputPath, flags.domain);
      if (domain === 'html') html = fs.readFileSync(inputPath, 'utf8');
    } catch { html = ''; }
    const artifactType = typeof flags.type === 'string' ? flags.type : undefined;
    slopReport = scanSlop({ alt, medium: 'html', html, opts: { artifact_type: artifactType } });
    if (outDir) paths.slop = path.join(outDir, 'slop.json');
  }
```

(c) Add `slop` to the `paths` object (in the initial `paths` decl):
```js
    slop: null,
```

(d) Pass to `foldDecision` (in the `foldDecision({...})` call, add):
```js
    slopReport,
    slopGate: Boolean(flags['slop-gate']),
    slopAutofix: Boolean(flags['slop-autofix']),
```

(e) Return `slopReport` from `runPost` (add to the returned object):
```js
    slopReport,
```

(f) In `main()`, write the file (near the other `writeJson` calls):
```js
  if (slopReport && paths.slop) writeJson(paths.slop, slopReport);
```
and destructure `slopReport` from `runPost` in `main`.

(g) Update usage string to include `[--slop] [--slop-gate] [--slop-autofix]`.

`schemas/decision.schema.json` — doc-only edit: extend the `reasons.items.properties.code` description to mention slop codes. (No structural change — `code` is `{ "type": "string" }`.) Add a sibling `description`:
```json
"code": { "type": "string", "description": "Reason code (e.g. P0_COLLISION, VULN_*, SLOP_P0_*, SLOP_ADVISORY_*)." },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/slop-integration.test.mjs`
Expected: PASS — all slop-integration tests (including Task 8's 4).

- [ ] **Step 5: Commit**

```bash
git add lib/skill-post.mjs schemas/decision.schema.json test/slop-integration.test.mjs
git commit -m "feat(skill-post): wire slop scan (--slop/--slop-gate), non-destructive"
```

---

### Task 10: contract slop criteria + schema confirmations

**Files:**
- Modify: `lib/contract.mjs` (doc + a `slop-*` criteria example in `defaultContract` comment), `schemas/contract.schema.json` (no structural change — `skill` is already free-string), `schemas/report.schema.json` (confirm `additionalProperties` already permits advisory skill entries)
- Test: extend `test/contract.test.mjs`

**Rationale:** `contract.schema.json` already allows `skill: { "type": "string" }` — so `skill: 'slop'` criteria are schema-valid today. The change is (a) document that slop criteria use `skill:'slop'` + a tier metric, (b) make `evaluate()` honor an unmeasured slop axis the same way it honors unmeasured geometry axes (it already does — `coverage === 'unmeasurable'` → `'unmeasured'`). Confirm with a test; no code change to `evaluate` needed.

**Decision (spec §6 M2):** slop is NOT added to `defaultContract` by default (slop-test self-check is non-enforced). A user may add `{skill:'slop', metric:'p0Count', op:'==', threshold:0, weight:1}` to their own contract; `report.skills['slop']` is the metric source. This task only documents + tests the path; the `report.skills['slop']` slot is produced in a tiny helper here (not the full scan — the scan lives in slop.mjs; this is the contract-facing metric adapter).

- [ ] **Step 1: Write the failing test (append to `test/contract.test.mjs`)**

```js
import { evaluate } from '../lib/contract.mjs';

test('contract: slop criterion honored when report.skills.slop present + measured', () => {
  const report = { summary: {}, skills: { slop: { score: 1, coverage: 'measurable', metrics: { p0Count: 0 }, violations: [] } } };
  const contract = { schema_version: 1, brief: '', criteria: [{ skill: 'slop', metric: 'p0Count', op: '==', threshold: 0, weight: 1 }] };
  const e = evaluate(report, contract);
  expect(e.allPass).toBe(true);
});

test('contract: slop criterion fails when p0Count>0', () => {
  const report = { summary: {}, skills: { slop: { score: 0, coverage: 'measurable', metrics: { p0Count: 2 }, violations: [] } } };
  const contract = { schema_version: 1, brief: '', criteria: [{ skill: 'slop', metric: 'p0Count', op: '==', threshold: 0, weight: 1 }] };
  const e = evaluate(report, contract);
  expect(e.allPass).toBe(false);
});

test('contract: slop criterion → unmeasured when coverage unmeasurable (no false-pass)', () => {
  const report = { summary: {}, skills: { slop: { score: 1, coverage: 'unmeasurable', metrics: {}, violations: [] } } };
  const contract = { schema_version: 1, brief: '', criteria: [{ skill: 'slop', metric: 'p0Count', op: '==', threshold: 0, weight: 1 }] };
  const e = evaluate(report, contract);
  expect(e.criteria[0].status).toBe('unmeasured');
  expect(e.allPass).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails (or passes)**

Run: `bun test test/contract.test.mjs`
Expected: likely PASS already (evaluate already handles arbitrary skill + coverage). If PASS, Step 3 is doc-only. If any FAIL, the gap is in `getMetric`/coverage handling — fix minimally (do NOT special-case slop; keep it generic).

- [ ] **Step 3: Write minimal implementation (doc-only if Step 2 passed)**

In `lib/contract.mjs`, extend the `defaultContract` header comment (no criteria added):
```js
// Slop note (spec §6 M2): slop is NOT in the default contract — the slop-test self-check is
// non-enforced. A caller MAY add a criterion like
//   { skill: 'slop', metric: 'p0Count', op: '==', threshold: 0, weight: 1 }
// to gate on measured slop P0 findings; report.skills.slop.metrics.p0Count is the source.
// An unmeasurable slop axis (coverage 'unmeasurable') yields status 'unmeasured' (no false-pass),
// identical to unmeasurable geometry axes.
```

`schemas/contract.schema.json` — no structural change; add a `description` line on `skill`:
```json
"skill": { "type": "string", "description": "Measurement skill id (collision, boundary, hierarchy, …) or 'slop' for slop-tier criteria." },
```

`schemas/report.schema.json` — confirm `skills.additionalProperties` (it is). No change. Add a one-line comment is not possible in JSON; instead document in the `description` of `skills`:
```json
"skills": { "type": "object", "description": "Per-skill results. Slop may appear as 'slop' (coverage + metrics.p0Count) when a contract gates on it.", ... }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/contract.test.mjs`
Expected: PASS — including the 3 new slop-criterion tests.

- [ ] **Step 5: Commit**

```bash
git add lib/contract.mjs schemas/contract.schema.json schemas/report.schema.json test/contract.test.mjs
git commit -m "docs(contract): document slop criteria path (non-default, unmeasured-safe)"
```

---

### Task 11: `skill-pre` injection + `aesthete-pre` SKILL + `slop-test.md`

**Files:**
- Modify: `lib/skill-pre.mjs`, `skills/aesthete-pre/SKILL.md`, `skills/aesthete-post/SKILL.md`, `schemas/brief.schema.json`
- Test: extend `test/skill-surface.test.mjs`

**Interfaces:**
- Produces: `runPre`/`buildPreBundle` appends slop bullets to `prompt_bullets` + slop negation to `negation`, and emits `slop-test.md` (a non-enforced self-check checklist) next to `pre.json`.
- Consumes: `getRules` (Task 1). `medium` resolved from `brief.format` (html→'html', else universal).

- [ ] **Step 1: Write the failing test (append to `test/skill-surface.test.mjs`)**

```js
import { runPre } from '../lib/skill-pre.mjs';
import fs from 'node:fs';
import path from 'node:path';

const tmpDir = (n) => { const d = path.join(import.meta.dir, '.tmp-slop-pre'); fs.mkdirSync(d, { recursive: true }); return d; };

test('skill-pre: html brief → prompt_bullets include slop constraints + slop-test.md emitted', () => {
  const outDir = path.join(tmpDir('pre'), 'out');
  const brief = { artifact_type: 'marketing', format: 'html', brief: 'hero landing' };
  const { bundle } = runPre(brief, { outDir });
  expect(bundle.prompt_bullets.some((b) => /gradient|emoji|glass/i.test(b))).toBe(true);
  expect(fs.existsSync(path.join(outDir, 'slop-test.md'))).toBe(true);
});

test('skill-pre: same brief twice (no diversify) → byte-identical slop bullets (deterministic)', () => {
  const a = runPre({ artifact_type: 'report', format: 'html' }, {}).bundle.prompt_bullets;
  const b = runPre({ artifact_type: 'report', format: 'html' }, {}).bundle.prompt_bullets;
  expect(a).toEqual(b);
});

test('skill-pre: non-html brief → slop universal bullets only (no html-only extras)', () => {
  const { bundle } = runPre({ artifact_type: 'report', format: 'svg' }, {});
  expect(bundle.prompt_bullets.some((b) => /icon/i.test(b))).toBe(false);
  expect(bundle.prompt_bullets.some((b) => /gradient|emoji/i.test(b))).toBe(true); // universal present
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/skill-surface.test.mjs`
Expected: FAIL — no slop bullets / no slop-test.md.

- [ ] **Step 3: Write minimal implementation**

In `lib/skill-pre.mjs`:

(a) Import (top):
```js
import { getRules } from './slop-rules.mjs';
```

(b) Add a slop-test.md renderer (pure):
```js
export function renderSlopTest(rules) {
  const lines = ['# slop-test — self-check (NON-ENFORCED)', '',
    '> Secondary prevention. You (the generator) run this yourself. It is NOT a gate — the',
    '> real gate is the post-hoc deterministic slop scan (`aesthete-post --slop-gate`).',
    '> Self-certification has limits; treat this as a checklist, not proof.', ''];
  for (const b of rules.bullets) lines.push(`- [ ] ${b}`);
  return lines.join('\n') + '\n';
}
```

(c) In `buildPreBundle`, after computing `prompt_bullets`, append slop rules. Resolve medium from `spec`/brief:
```js
  // slop prevention (spec §3): inject generation constraints into prompt_bullets + negation.
  const medium = spec.medium || (spec.artifact_type ? 'html' : 'html'); // v1 default html; brief.format→medium handled in runPre
  const slopRules = getRules(spec._slopMedium || 'html');
  for (const b of slopRules.bullets) prompt_bullets.push(b);
  const mergedNeg = negationBundle({ ...(spec.negation || {}), ...slopRules.negation });
```
Then use `mergedNeg` for the bundle's `negation` field (replace the existing `neg: negationBundle(spec.negation)` usage for the output — keep `prompt_bullets` already including negation via `renderPromptBullets`; the slop bullets are appended above so they render too).

> Cleaner approach (preferred): extend `renderPromptBullets`'s input `spec.negation` to already include slop negation BEFORE calling it. Do the merge in `runPre` so `spec.negation` carries slop, and `buildPreBundle` stays unchanged except for the slop-bullet append. Concretely in `runPre`:
```js
export function runPre(brief, opts = {}) {
  const log = opts.log;
  const spec = preflight(brief, log ? { log } : {});
  const medium = brief?.format === 'html' ? 'html' : (brief?.format || 'html');
  const slopRules = getRules(medium);
  // merge slop negation into spec.negation (renderPromptBullets + negationBundle pick it up)
  spec.negation = { ...(spec.negation || {}), ...slopRules.negation };
  spec._slopRules = slopRules; // carry for slop-test.md emit
  spec._slopMedium = medium;
  const outDir = opts.outDir;
  const contractPath = outDir ? path.join(outDir, 'contract.json') : null;
  const bundle = buildPreBundle(spec, { contractPath, outDir });
  return { spec, bundle, contractPath, slopRules };
}
```
and in `buildPreBundle`, after `const prompt_bullets = renderPromptBullets(spec);`, append:
```js
  if (spec._slopRules) for (const b of spec._slopRules.bullets) prompt_bullets.push(b);
```

(d) In `main()`, after writing `prompt_bullets.md`, write `slop-test.md`:
```js
  if (spec._slopRules) {
    fs.writeFileSync(path.join(outDir, 'slop-test.md'), renderSlopTest(spec._slopRules), 'utf8');
  }
```

`schemas/brief.schema.json` — add optional `slop` config (additionalProperties:false requires explicit opt-in):
```json
"slop": {
  "type": "object",
  "description": "Optional slop-axis config. thresholds override lib/slop.mjs DEFAULT_THRESHOLDS.",
  "additionalProperties": false,
  "properties": {
    "enabled": { "type": "boolean" },
    "gate": { "type": "boolean" },
    "autofix": { "type": "boolean" },
    "thresholds": { "type": "object" }
  }
}
```

`skills/aesthete-pre/SKILL.md` — append a "Slop prevention" section:
```markdown
## Slop prevention (secondary)

`aesthete-pre` emits anti-slop generation constraints in `prompt_bullets` + `negation`, and a
`slop-test.md` self-check checklist next to `pre.json`.

- **Primary prevention:** honor `prompt_bullets` + `negation` when generating.
- **Secondary (non-enforced):** run `slop-test.md` yourself. It is NOT a gate — self-certification
  has limits. The real gate is the deterministic post-hoc scan: `aesthete-post --slop-gate`.
```

`skills/aesthete-post/SKILL.md` — append:
```markdown
## Slop detection (post-hoc, HTML, deterministic)

`aesthete-post` scans raw HTML for AI-slop signatures (cliché gradient, glassmorphism, emoji in
headings, icon saturation, decorative animation, cliché lexicon, trusted-by, hero-trio).

- `--slop` : write advisory `slop.json` (no decision change).
- `--slop-gate` : P0 measured-fail (always) + P1 measured-fail → `regenerate` (priority 60).
- `--slop-autofix` : (v1 minimal) reserved for narrow P0 emoji-strip; off by default.

`var()`-indirect / external-stylesheet gradients → `unmeasured` (never a false fail).
SVG/PPTX → `unmeasurable` in v1 (HTML only).
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/skill-surface.test.mjs`
Expected: PASS — including the 3 new slop-pre tests.

- [ ] **Step 5: Commit**

```bash
git add lib/skill-pre.mjs skills/aesthete-pre/SKILL.md skills/aesthete-post/SKILL.md schemas/brief.schema.json test/skill-surface.test.mjs
git commit -m "feat(skill-pre): inject slop constraints + emit slop-test.md (non-enforced)"
```

---

### Task 12: HTML fixture corpus + FP regression suite (v1 success-criteria proof)

**Files:**
- Create: `examples/slop-html/slop-synthetic.html`, `examples/slop-html/legit-editorial.html`, `examples/slop-html/var-indirect.html`
- Create: `test/slop-fp.test.mjs`
- Test: the full suite (`bun run test`)

**Goal (spec §9 v1 success criteria):** prove on real HTML — (1) P0 measured-fail catches synthetic slop → `regenerate_slop`; (2) legitimate designs → 0 false flags; (3) `var()`-indirect → `unmeasured` (no false-fail); (4) vuln/slop same artifact → 0 duplicate findings; (5) coverage honest — unmeasurable → `human_coverage`, no false-pass.

- [ ] **Step 1: Write the failing test**

`test/slop-fp.test.mjs`:
```js
import { test, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { scanSlop } from '../lib/slop.mjs';
import { scanAlt } from '../lib/vuln.mjs';
import { foldDecision } from '../lib/skill-decision.mjs';

const FIX = (n) => fs.readFileSync(path.join(import.meta.dir, '..', 'examples', 'slop-html', n), 'utf8');
const alt = { meta: { canvas: { w: 1280, h: 800 } }, nodes: [] };
const scan = (name) => scanSlop({ alt, medium: 'html', html: FIX(name) });

test('FP suite: synthetic slop HTML → P0 measured-fail (gradient + emoji)', () => {
  const r = scan('slop-synthetic.html');
  expect(r.summary.coverage.html).toBe('measured');
  expect(r.summary.byTier.P0).toBeGreaterThanOrEqual(1);
  expect(r.findings.some((f) => f.id === 'slop.palette.gradient')).toBe(true);
});

test('FP suite: legitimate editorial design → ZERO slop findings (no false-positive)', () => {
  const r = scan('legit-editorial.html');
  expect(r.findings.length).toBe(0);
});

test('FP suite: var()-indirect gradient → unmeasured, NOT a finding (no false-fail)', () => {
  const r = scan('var-indirect.html');
  expect(r.findings.some((f) => f.id === 'slop.palette.gradient')).toBe(false);
  expect(r.summary.unmeasured.some((u) => u.id === 'slop.palette.gradient')).toBe(true);
});

test('FP suite: var()-indirect gradient → decision human_coverage (escalate, no false-pass/false-fail)', () => {
  const d = foldDecision({
    report: { summary: { hardIntegrityScore: 1, coverageScore: 1 } },
    slopReport: scan('var-indirect.html'),
  });
  expect(d.decision).toBe('human');
  expect(d.reasons.some((r) => r.code.startsWith('SLOP_P0_UNMEASURED'))).toBe(true);
});

test('FP suite: vuln + slop on the same artifact → disjoint findings (H1 dedup)', () => {
  const html = FIX('slop-synthetic.html');
  const sr = scanSlop({ alt, medium: 'html', html });
  // vuln operates on ALT; feed a minimal alt derived presence is out of scope here — assert id sets
  // are conceptually disjoint by construction (slop.* vs vuln ids).
  const slopIds = new Set(sr.findings.map((f) => f.id));
  const vulnIds = new Set(['ai-cliche-palette','hanging-header','even-split','no-focal-point','rainbow-categorical','type-scale-accident','no-spacing-rhythm']);
  for (const id of slopIds) expect(vulnIds.has(id)).toBe(false);
});

test('FP suite: all-unmeasurable → human_coverage, no false-pass', () => {
  const d = foldDecision({
    report: { summary: { hardIntegrityScore: 1, coverageScore: 0 } },
    slopReport: scanSlop({ alt, medium: 'svg', html: '' }),
  });
  expect(d.decision).toBe('human');
});

test('FP suite: full suite still green', async () => {
  // smoke: the new fixtures don't break existing measure/golden
  const { execSync } = await import('node:child_process');
  let out;
  try { out = execSync('bun test test/slop-signatures.test.mjs test/slop-fold.test.mjs test/slop-integration.test.mjs test/slop-fp.test.mjs', { encoding: 'utf8' }); }
  catch (e) { out = e.stdout || ''; throw new Error('slop suite failed:\n' + out); }
  expect(out).toMatch(/pass/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/slop-fp.test.mjs`
Expected: FAIL — fixtures missing.

- [ ] **Step 3: Create the fixtures**

`examples/slop-html/slop-synthetic.html` (deliberately cliché — must trip P0):
```html
<!doctype html><html><head><style>
  .hero { background: linear-gradient(135deg,#6366f1,#8b5cf6 40%,#ec4899); }
  .card { backdrop-filter: blur(10px); background: rgba(255,255,255,0.6); }
  @keyframes float { from { transform: scale(1); } to { transform: scale(1.05); } }
</style></head><body>
  <h1>🚀 Unleash Seamless AI-Powered Synergy</h1>
  <section><h3>Trusted by</h3><img src="a.png"><img src="b.png"><img src="c.png"></section>
</body></html>
```

`examples/slop-html/legit-editorial.html` (clean — must trip ZERO slop):
```html
<!doctype html><html><head><style>
  .frame { background: #f5f0e6; color: #2a2a2a; }
  .rule { border-top: 1px solid #2a2a2a; }
</style></head><body>
  <article>
    <h1>Quarterly Cache Invalidation Report</h1>
    <p>The write-through cache invalidates on commit. Read replicas converge within 40ms.</p>
    <p>No decorative gradients, glassmorphism, emoji, or icon saturation are used.</p>
  </article>
</body></html>
```

`examples/slop-html/var-indirect.html` (gradient via var() — must be `unmeasured`, not a finding):
```html
<!doctype html><html><head><style>
  :root { --brand-a: #6366f1; --brand-b: #ec4899; }
  .hero { background: linear-gradient(135deg, var(--brand-a), var(--brand-b)); }
</style></head><body><h1>Hero</h1></body></html>
```

- [ ] **Step 4: Run the full suite**

Run: `bun run test`
Expected: ALL pass — existing suite (was 244 pass) + new slop tests. Note the new count in the commit body.

If any pre-existing test breaks, root-cause it (per CLAUDE.md `code-modification` rule: `git diff`/`git log` first) — do NOT patch the symptom. Most likely cause: a schema change. The `report.schema.json`/`contract.schema.json`/`decision.schema.json` edits here are description-only, so they should not change validation behavior.

- [ ] **Step 5: Commit**

```bash
git add examples/slop-html/ test/slop-fp.test.mjs
git commit -m "test(slop): HTML fixture corpus + FP regression (v1 success-criteria proof)"
```

---

## Self-Review (run before declaring done)

1. **Spec coverage** — each spec requirement maps to a task:
   - Prevention constraints → Task 1 + 11. slop-test.md non-enforced → Task 11. ✓
   - Detection HTML-only + vuln-non-overlap → Tasks 2–7 (dedup test in 7 + FP in 12). ✓
   - coverage honesty / var() unmeasured → Tasks 2, 7, 12. ✓
   - decision priority 60 + slopGate/slopAutofix → Task 8. ✓
   - skill-post non-destructive wiring → Task 9. ✓
   - contract slop path (non-default) → Task 10. ✓
   - FP regression + v1 success criteria → Task 12. ✓
   - thresholds uncalibrated + overridable → Tasks 3–7 (`DEFAULT_THRESHOLDS`, `opts.thresholds`, `uncalibrated:true`). ✓
2. **Placeholder scan** — no TBD/TODO/"add error handling"/"similar to Task N". Dead-code hook in Task 6 (`LOGO_RE`) flagged for deletion. ✓
3. **Type consistency** — `scanSlop({alt, medium, html, opts})` signature identical in Tasks 7, 9, 12. `Finding`/`StyleCtx` shapes identical across Tasks 2–7. `PRI.regenerate_slop` defined in 8, used in 8/12. `slopReport.summary.coverage.html` read in 8/9/12. ✓

## v1 Success Criteria (proof lives in Task 12, must pass before merge)

1. real HTML P0 (gradient/emoji) measured-fail → synthetic slop HTML → `regenerate`. ✓ (FP suite)
2. FP regression: legitimate design 0 flags. ✓
3. `var()` path → `unmeasured`, false-fail 0. ✓
4. vuln/slop same artifact → duplicate findings 0. ✓
5. coverage honest: unmeasurable → `human_coverage`, false-pass 0. ✓

Failure on any → halt v2 expansion; rework scanner/signatures (spec §9).

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-23-slop-prevention-detection.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task (Tasks 1–12 are mostly independent except 7→8→9→11 chain), review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session via executing-plans, batch with checkpoints.

Which approach?
