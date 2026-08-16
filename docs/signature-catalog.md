# Signature Catalog

Auto-generated from `lib/vuln.mjs` + `lib/slop/signatures/*.mjs` by `scripts/gen-signature-catalog.mjs`. Do not edit by hand — run `bun run gen:catalog`.

Every signature is **deterministic** unless its detection column says otherwise (`browser` = needs real CSS layout; `llm-only` = no deterministic detector, caught by an LLM judge). All vuln/slop signatures are `measure-only` / advisory — they never touch the 9-skill weighted score, so adding one never churns `examples/*.report.json`.

## vuln — known-bad-pattern negation

Multi-domain (geometry / text / color). Each negates a specific layout defect (no-focal, even-split, rainbow, hanging-header, …). Type-suppressed signatures are listed in the last column — they are the *intent* for that artifact type, not a defect.

| id | title | severity | needs | detection | default threshold | suppressed-for-types |
|---|---|---|---|---|---|---|
| `no-focal-point` | no dominant focal element (figure-ground failure) | high | `geometry` | `deterministic` | `dominance=0.34` | dashboard, diagram |
| `no-spacing-rhythm` | identical spacing everywhere (no rhythm scale) | medium | `geometry` | `deterministic` | `cv=0.06` | dashboard |
| `type-scale-accident` | too many type sizes (accidents, not a system) | medium | `text` | `deterministic` | `sizes=5` | — |
| `rainbow-categorical` | rainbow palette across categorical groups | medium | `color` | `deterministic` | `hueBands=5` `groups=3` | — |
| `even-split` | near-50/50 content split reads indecisive | low | `geometry` | `deterministic` | `band=0.48` | dashboard, diagram |
| `ai-cliche-palette` | default “AI” blue→purple palette | low | `color` | `deterministic` | `share=0.66` `hueLo=200` `hueHi=300` `lMin=0.15` `lMax=0.85` `sMin=0.35` | — |
| `hanging-header` | hanging header / left-margin label (templated-editorial tell) | medium | `text` | `deterministic` | `yOverlap=0.5` `widthRatio=0.5` `minPaired=1` `maxNodes=80` `displayMin=24` `fontRatio=0.6` | diagram |
| `icon-fill-mix` | filled and outline icons mixed in one set | low | `geometry` | `deterministic` | `minIcons=3` `minMixed=1` | diagram |
| `all-caps-text` | long text set in ALL CAPS | low | `text` | `deterministic` | `minLetters=8` `capsShare=0.9` `minNodes=1` | poster |
| `pure-black-text` | pure black text on a light field | low | `text` | `deterministic` | `minNodes=1` `bgLumMin=0.5` | — |
| `low-contrast-ui` | UI element below 3:1 against its backdrop (WCAG 1.4.11) | medium | `geometry` | `deterministic` | `ratio=3` `maxWidthShare=0.5` `maxHeightShare=0.15` `maxRepeats=4` | diagram |

## slop — AI-slop signatures

HTML-only v1 (SVG `<animate>` / PPTX `<p:timing>` are v2). Grouped by axis: `palette`, `decoration`, `copy`, `template`. Thresholds are conservative presence floors — uncalibrated until the v2 human-corpus lands.

| id | title | severity/tier | needs | detection | default threshold | suppressed-for-types |
|---|---|---|---|---|---|---|
| `slop.palette.gradient` | cliché AI gradient (indigo→violet→pink stops) | high/P0 | `gradientsLiteral` | `deterministic` | `minClichéStops=2` `hueLo=230` `hueHi=340` `sMin=0.25` | — |
| `slop.palette.tailwind-candy` | candy-hue Tailwind utility tinting (emerald/amber pill badges + inline color spans — generated-dashboard tell) | medium/P1 | `tailwindColorClasses` | `deterministic` | `minHits=3` `minAttrs=2` | — |
| `slop.palette.glass` | glassmorphism surface (backdrop-filter) | medium/P1 | `glassLiteral` | `deterministic` | `minGlass=1` | — |
| `slop.palette.gradient-border` | gradient on a border side (card top bar / callout left rail — AI tell per KLIC-Github research) | medium/P1 | `gradientBorders` | `deterministic` | `minGradientBorders=1` | — |
| `slop.decoration.emoji-in-heading` | emoji inside heading text | high/P0 | `headings` | `deterministic` | `minEmojiHeadings=1` | — |
| `slop.decoration.emoji-in-body` | emoji inside body/UI copy | low/P2 | `bodyEmojiSamples` | `deterministic` | `minBodyEmoji=1` | — |
| `slop.decoration.italic-heading` | italic heading / display type (Hallmark gate 38a — names this a top AI tell) | medium/P1 | `headings` | `deterministic` | `minItalicHeadings=1` | — |
| `slop.decoration.icon-saturation` | icon saturation (excessive svg/icon glyphs) | medium/P1 | `svgIconCount` | `deterministic` | `minIcons=12` | — |
| `slop.decoration.animation` | decorative scale/rotate animation on static content | medium/P1 | `animationSignals` | `deterministic` | `minAnimSignals=1` | — |
| `slop.decoration.side-tab-border` | thick accent border on one side of a card (side-tab — AI UI #1 tell) | medium/P1 | `sideTabBorders` | `deterministic` | `minHits=1` `minThickness=4` | — |
| `slop.decoration.bounce-easing` | bounce/elastic easing on interface motion (dated AI tell) | medium/P1 | `easingBounce` | `deterministic` | — | — |
| `slop.decoration.hover-transform` | scale/rotate transform on hover (generated-UI signature) | low/P1 | `hoverTransforms` | `deterministic` | `minHoverTransforms=1` | — |
| `slop.decoration.pulse-animation` | pulsing opacity animation (decorative "live" indicator) | low/P1 | `animations` | `deterministic` | `minPulse=1` | — |
| `slop.decoration.marquee` | auto-scrolling marquee (translateX/left keyframes) | medium/P1 | `animations` | `deterministic` | `minMarquee=1` | — |
| `slop.decoration.blink-cursor` | fake blinking cursor (steps() opacity animation) | medium/P1 | `animations` `easingStep` | `deterministic` | — | — |
| `slop.copy.lexicon` | cliché LLM marketing lexicon | low/P2 | `textSamples` `headings` | `deterministic` | `minHits=1` | — |
| `slop.copy.fake-precision` | fake-precision metrics (many-9 % or round multipliers — too clean to be measured) | low/P2 | `textSamples` `headings` | `deterministic` | `minHits=1` | — |
| `slop.copy.generic` | generic templated copy (LLM judge) | low/P2 | `textSamples` | `llm-only` | — | — |
| `slop.copy.hidden-carrier` | invisible unicode watermark carriers (zero-width/tag/bidi — LLM edit-mark remnant) | medium/P2 | `carriers` | `deterministic` | `minHard=1` `minIsolates=6` `minZwsp=5` `minWj=3` | — |
| `slop.template.trusted-by` | "Trusted by" logo strip (templated-marketing tell) | medium/P1 | `hasTrustedBy` | `deterministic` | `minTrustedBy=1` | — |
| `slop.template.hero-trio` | three-up equal hero card row (templated-landing tell) | medium/P1 | `alt` | `deterministic` | `minTrio=3` `maxWidthDiff=0.15` | — |

## detection-mode legend

- `deterministic` — pure-function detector, no browser, no LLM. The whole v1 catalog.
- `browser` — reserved for signatures that need real CSS box layout (overflow, occlusion, viewport-edge). Not yet shipped; ALT geometry covers most of this today.
- `llm-only` — no deterministic detector exists; surfaced only when an LLM judge runs (v2+). `slop.copy.generic` is the current example — it reports `unmeasured` until the v2 LLM judge lands.

