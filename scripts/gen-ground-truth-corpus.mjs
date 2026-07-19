#!/usr/bin/env node
// Ground-truth corpus generator — the non-circular validation substrate.
//
// WHY THIS EXISTS — validate.mjs correlates engine scores against `humanScore`. The shipped
// examples/validation-corpus.json assigns those scores BY HAND from the same aesthetic intuition
// the metrics encode → the correlation is circular (DESIGN.md §"정직한 한계"). Real validation
// needs a ground-truth label that is INDEPENDENT of the metric formulas.
//
// This generator produces one. Each entry is a multi-element layout (the engine's actual domain —
// NOT logos/icons/flags, which are single artworks) with a STRUCTURAL DEFECT INJECTED BY
// CONSTRUCTION. The ground-truth label is the defect type + severity I planted — a fact about how
// the layout was assembled, not about how the metric scores it. So asking "does the engine's score
// drop when I plant a collision?" is a legitimate test, not a tautology.
//
// WHAT IT VALIDATES (honest scope):
//   ✓ severity calibration — does score drop monotonically as the injected defect grows?
//   ✓ orthogonality       — does a collision defect lower the COLLISION skill, not color harmony?
//   ✓ false-positive freedom — do clean layouts score high with no spurious failing skills?
//   ✗ human aesthetic preference — that still needs real humans. This is necessary, not sufficient.
//
// Layouts are emitted in native ALT (feeds measureAlt / validate.mjs directly). --svg also drops
// visual SVG renders for eyeballing that defects are actually visible.
//
//   node scripts/gen-ground-truth-corpus.mjs [--svg]
import fs from 'node:fs';
import path from 'node:path';
import { exportSvg } from '../lib/adapters/svg.mjs';
import { measureAlt } from '../lib/measure.mjs';

const OUT_JSON = 'examples/ground-truth-corpus.json';
const OUT_SVG_DIR = 'examples/ground-truth-svg';
const W = 1200, H = 800;

// analogous blue→indigo palette (harmonious baseline; lets the harmony skill measure ~1 on clean)
const ANALOG = ['#60a5fa', '#3b82f6', '#2563eb', '#4f46e5', '#6366f1'];
// clashing palettes by severity (hue separation grows)
const CLASH = {
  mild:     ['#3b82f6', '#f59e0b', '#10b981'],                              // ~120° apart
  moderate: ['#ef4444', '#06b6d4', '#eab308', '#a855f7'],                   // complement + more
  severe:   ['#ff0000', '#00ffff', '#ffff00', '#ff00ff', '#00ff00'],        // full clash
};
const SEV = { mild: 1, moderate: 2, severe: 3 };
const SEVSCORE = { mild: 0.7, moderate: 0.4, severe: 0.1 }; // ordinal ground-truth (from injection)

// ---- ALT helpers ----
// Label sits BELOW its box (catalog-good pattern) — never inside it. A label inside its own
// container is a self-collision (box↔label overlap) that saturates the collision skill at 0 and
// masks every other signal. The 8px gap + below placement keeps the pair a clean vertical unit.
function card(cat, x, y, w, h, label, fill) {
  return [
    { id: `${cat}-box`, label, category: cat, kind: 'container', shape: 'rect',
      bbox: { x, y, w, h }, style: { bg: fill, color: '#0f172a', luminance: 0.2, role: 'decor' } },
    { id: `${cat}-lbl`, label, category: cat, kind: 'text',
      bbox: { x, y: y + h + 8, w, h: 32 }, style: { fontSize: 22, color: '#0f172a', bg: fill, luminance: 0.2, role: 'heading' } },
  ];
}
function alt(title, nodes) {
  return { schema_version: 1, diagram_type: 'layout',
    meta: { title, canvas: { w: W, h: H }, source: 'synthetic-ground-truth' }, nodes };
}
const clone = (a) => JSON.parse(JSON.stringify(a));
function shiftCat(a, cat, dx, dy) {
  for (const n of a.nodes) if (n.category === cat) { n.bbox.x += dx; n.bbox.y += dy; }
}
function cats(a) { return [...new Set(a.nodes.map((n) => n.category))]; }

// ---- clean templates (multi-element by construction; geometries centered so clean passes balance) ----
function tRow3() {
  const nodes = [];
  // unit height = 170+8+32 = 210; vertically centered → y=(800-210)/2=295
  [0, 1, 2].forEach((i) => nodes.push(...card(`c${i + 1}`, 80 + i * 380, 295, 280, 170, `card ${i + 1}`, ANALOG[i])));
  return alt('row3', nodes);
}
function tGrid4() {
  const nodes = [];
  // unit h=260+40=300; rows y=80 & 420 (gap 40 between label1 and box2); span 80..720 center 400
  const pos = [[80, 80], [640, 80], [80, 420], [640, 420]];
  pos.forEach((p, i) => nodes.push(...card(`c${i + 1}`, p[0], p[1], 480, 260, `cell ${i + 1}`, ANALOG[i])));
  return alt('grid4', nodes);
}
function tHero3() {
  const nodes = [];
  // hero unit h=260+40=300 at y=60; 3 cards unit h=200+40=240 at y=420 (gap 60)
  nodes.push(...card('hero', 80, 60, 1040, 260, 'HERO', ANALOG[0]));
  [0, 1, 2].forEach((i) => nodes.push(...card(`c${i + 1}`, 80 + i * 360, 420, 320, 200, `card ${i + 1}`, ANALOG[i + 1])));
  return alt('hero3', nodes);
}
const TEMPLATES = { row3: tRow3, grid4: tGrid4, hero3: tHero3 };

// ---- defect injectors (each returns a NEW mutated alt; severity ∈ mild|moderate|severe) ----
const DEFECTS = {
  collision: (a, s) => {            // slide c2 left so it overlaps c1 by 20/55/88% of card width
    const f = { mild: 0.2, moderate: 0.55, severe: 0.88 }[s];
    const c1w = a.nodes.find((n) => n.category === 'c1').bbox.w;
    shiftCat(a, 'c2', -c1w * f, 0); return a;
  },
  boundary: (a, s) => {             // shove the last card past the right edge by 30/110/280px
    const over = { mild: 30, moderate: 110, severe: 280 }[s];
    const last = cats(a).slice(-1)[0];
    shiftCat(a, last, over, 0); return a;
  },
  proximity: (a, s) => {            // squeeze every category toward c1 — gaps collapse to near-zero
    const squeeze = { mild: 0.35, moderate: 0.65, severe: 0.92 }[s];
    const cs = cats(a);
    const c1x = a.nodes.find((n) => n.category === 'c1').bbox.x;
    cs.forEach((c, i) => { if (i === 0) return; shiftCat(a, c, -((a.nodes.find((n) => n.category === c).bbox.x - c1x) * squeeze), 0); });
    return a;
  },
  balance: (a, s) => {              // uniform scale (pos+size) into the top-left quadrant — mass
    const f = { mild: 0.55, moderate: 0.35, severe: 0.2 }[s]; //  concentrates, NO overlap (relative layout preserved)
    for (const n of a.nodes) { n.bbox.x *= f; n.bbox.y *= f; n.bbox.w *= f; n.bbox.h *= f; }
    return a;
  },
  whitespace: (a, s) => {           // tile the canvas with a dense grid of extra boxes → occupancy
    const n = { mild: 24, moderate: 54, severe: 96 }[s]; //  >75% (freeRatio<0.25) with NO overlap (2px gaps).
    const cw = a.meta.canvas.w, ch = a.meta.canvas.h; //  (The whitespace skill only fails on cramping;
    const cols = Math.ceil(Math.sqrt(n * cw / ch));      //   reaching 75% cover with few boxes is impossible
    const rows = Math.ceil(n / cols);                    //   without overlap — so a fill-grid is the clean trigger.)
    const bw = cw / cols, bh = ch / rows;
    let k = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      a.nodes.push({ id: `fill-${k}`, label: '', category: `fill-${k}`, kind: 'container', shape: 'rect',
        bbox: { x: c * bw + 2, y: r * bh + 2, w: bw - 4, h: bh - 4 },
        style: { bg: '#cbd5e1', color: '#475569', luminance: 0.45, role: 'decor' } });
      k++;
    }
    return a;
  },
  harmony: (a, s) => {              // re-paint categories with clashing hues (geometry untouched)
    const pal = CLASH[s]; const cs = cats(a);
    cs.forEach((c, i) => { const fill = pal[i % pal.length]; a.nodes.filter((n) => n.category === c).forEach((n) => { n.style.bg = fill; if (n.kind === 'text') n.style.bg = fill; }); });
    return a;
  },
};

// ---- generate the corpus ----
function generate() {
  const entries = [];
  for (const [tname, build] of Object.entries(TEMPLATES)) {
    const clean = build();
    entries.push({ id: `${tname}--clean`, template: tname, defect: null, severity: 0, humanScore: 1.0, alt: clean });
    for (const [dname, inject] of Object.entries(DEFECTS)) {
      for (const sev of ['mild', 'moderate', 'severe']) {
        const a = inject(clone(clean), sev);
        entries.push({ id: `${tname}--${dname}--${sev}`, template: tname, defect: dname, severity: SEV[sev], humanScore: SEVSCORE[sev], alt: a });
      }
    }
  }
  return entries;
}

// ---- discrimination analysis ----
function analyze(entries) {
  const measured = entries.map((e) => {
    const r = measureAlt(e.alt);
    return { ...e, summary: r.summary, skillScores: Object.fromEntries(Object.entries(r.skills).map(([k, v]) => [k, v.score])) };
  });

  // 1) overall monotonicity per (template, defect): clean ≥ mild ≥ moderate ≥ severe?
  let monoFamilies = 0, totFamilies = 0;
  const monoDetail = [];
  for (const tname of Object.keys(TEMPLATES)) {
    for (const dname of Object.keys(DEFECTS)) {
      const pick = (sev) => measured.find((m) => m.template === tname && m.defect === dname && m.severity === sev);
      const clean = measured.find((m) => m.template === tname && m.defect === null);
      const seq = [clean, pick(1), pick(2), pick(3)].map((m) => m.summary.measuredAestheticScore);
      const mono = seq[0] >= seq[1] - 0.001 && seq[1] >= seq[2] - 0.001 && seq[2] >= seq[3] - 0.001;
      totFamilies++; if (mono) monoFamilies++;
      monoDetail.push({ tname, dname, mono, seq: seq.map((v) => v.toFixed(3)) });
    }
  }

  // 2) per-skill responsiveness: avg skill-score drop (defect vs clean) grouped by defect type.
  //    Orthogonal engine → diagonal: each defect lowers its OWN skill most.
  const SKILL_LIST = Object.keys(measured[0].skillScores);
  const cleanByTpl = {};
  for (const tname of Object.keys(TEMPLATES)) cleanByTpl[tname] = measured.find((m) => m.template === tname && m.defect === null).skillScores;
  const resp = {}; // resp[defect][skill] = avg drop
  for (const dname of Object.keys(DEFECTS)) {
    resp[dname] = {};
    for (const sk of SKILL_LIST) {
      const drops = measured.filter((m) => m.defect === dname).map((m) => cleanByTpl[m.template][sk] - m.skillScores[sk]);
      resp[dname][sk] = drops.reduce((x, y) => x + y, 0) / drops.length;
    }
  }

  // 3) clean false-positive rate: failing skills on clean entries (should be ~0)
  const cleanFP = measured.filter((m) => m.defect === null).map((m) => m.summary.failing).flat();

  return { measured, monoFamilies, totFamilies, monoDetail, resp, SKILL_LIST, cleanFP };
}

// ---- main ----
const entries = generate();   // rich entries (with template/defect/severity) — used for analysis
// schema-conformant corpus for validate.mjs: defect+severity are encoded in `id` (row3--collision--severe)
const corpus = {
  schema_version: 1,
  demo: false,
  note: 'Synthetic GROUND-TRUTH corpus. Labels are INJECTED defect type + severity (construction facts independent of the metrics) — ordinal humanScore = 1.0 clean / 0.7 mild / 0.4 moderate / 0.1 severe. Validates severity calibration, orthogonality, and false-positive freedom. NOT human aesthetic preference. id format: <template>--<defect|--clean>--<severity>.',
  entries: entries.map((e) => ({ id: e.id, humanScore: e.humanScore, alt: e.alt })),
};
fs.writeFileSync(OUT_JSON, JSON.stringify(corpus, null, 2) + '\n');

if (process.argv.includes('--svg')) {
  fs.rmSync(OUT_SVG_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_SVG_DIR, { recursive: true });
  for (const e of entries) fs.writeFileSync(path.join(OUT_SVG_DIR, `${e.id}.svg`), exportSvg(e.alt));
  console.log(`wrote ${entries.length} SVGs → ${OUT_SVG_DIR}/`);
}

const A = analyze(entries);
console.log(`\nwrote ${entries.length} entries → ${OUT_JSON}`);
console.log(`\n=== DISCRIMINATION ANALYSIS ===`);
console.log(`severity monotonicity: ${A.monoFamilies}/${A.totFamilies} defect families score clean ≥ mild ≥ moderate ≥ severe on measuredAesthetic`);
const monoFail = A.monoDetail.filter((d) => !d.mono);
if (monoFail.length) { console.log(`  NON-monotonic families:`); for (const d of monoFail) console.log(`    ${d.tname}/${d.dname}: ${d.seq.join(' → ')}`); }

console.log(`\n=== PER-SKILL RESPONSIVENESS (avg score drop vs clean; diagonal = orthogonal) ===`);
const hdr = 'defect         ' + A.SKILL_LIST.map((s) => s.padStart(10)).join('');
console.log(hdr);
for (const dname of Object.keys(DEFECTS)) {
  const row = dname.padEnd(14) + A.SKILL_LIST.map((sk) => (A.resp[dname][sk] >= 0.001 ? A.resp[dname][sk].toFixed(3) : '·').padStart(10)).join('');
  console.log(row);
  const top = Object.entries(A.resp[dname]).sort((x, y) => y[1] - x[1])[0];
  console.log(`${' '.repeat(14)}↳ top responder: ${top[0]} (drop ${top[1].toFixed(3)})${top[0] === dname || (dname === 'proximity' && top[0] !== 'harmony') ? '  ✓ on-axis' : '  ⚠ off-axis'}`);
}

console.log(`\n=== CLEAN FALSE POSITIVES ===`);
console.log(`failing skills across ${Object.keys(TEMPLATES).length} clean layouts: ${A.cleanFP.length ? A.cleanFP.join(', ') : '(none — clean is clean)'}`);
