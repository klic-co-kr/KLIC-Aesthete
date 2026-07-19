#!/usr/bin/env node
// Before/after diff viewer — when the fixer raises the score, show the corrected SVG next
// to the original on ONE screen (self-contained HTML).
//
// Design note: BOTH panels go through the same adapter pipeline (import → exportSvg). The
// BEFORE panel is exportSvg(import(input)) — the round-tripped baseline with NO fix — and the
// AFTER panel is exportSvg(fixAlt(...)). Because both pass through the same adapter transform,
// adapter lossiness cancels out: the visible diff is the FIXER's geometry changes only.
// (Adapted SVG export is a re-emission, not a source patch — see DESIGN §5.)

import fs from 'node:fs';
import path from 'node:path';
import { readJson, parseArgs, skillRoot, isMain } from './shared/cli.mjs';
import { importPath, detectDomain } from './adapters/index.mjs';
import { exportSvg } from './adapters/svg.mjs';
import { measureAlt } from './measure.mjs';
import { fixAlt } from './fix.mjs';
import { defaultContract } from './contract.mjs';

// Build the diff data (no HTML). Exported so it's testable without writing files.
export function diffView(alt, contract) {
  const beforeReport = measureAlt(alt);
  const beforeSvg = exportSvg(alt); // round-tripped baseline (adapter only, no fix)
  const fixResult = fixAlt(alt, contract);
  const afterAlt = fixResult.fixed;
  const afterReport = fixResult.report; // report of the best snapshot
  const afterSvg = exportSvg(afterAlt);
  const applied = (fixResult.iterations_log || []).reduce((a, it) => a + (it.applied || 0), 0);
  return {
    before: beforeReport.summary,
    after: afterReport.summary,
    outcome: fixResult.outcome,
    profile: fixResult.profile,
    appliedFixes: applied,
    skippedFixes: (fixResult.skippedFixes || []).length,
    beforeSvg,
    afterSvg,
  };
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const SCORE_COLS = [
  ['hardIntegrityScore', 'hardIntegrity'],
  ['measuredAestheticScore', 'measuredAesthetic'],
  ['overallScore', 'overall (legacy)'],
  ['coverageScore', 'coverage'],
];

function deltaArrow(b, a) {
  const d = Number((a - b).toFixed(3));
  if (Math.abs(d) < 0.0005) return `<span class="flat">→</span>`;
  return d > 0
    ? `<span class="up">▲ +${d.toFixed(3)}</span>`
    : `<span class="down">▼ ${d.toFixed(3)}</span>`;
}

export function diffHtml(name, d) {
  const rows = SCORE_COLS.map(([k, label]) => {
    const b = d.before[k] ?? 0;
    const a = d.after[k] ?? 0;
    return `<tr><td class="lbl">${label}</td><td>${b.toFixed(3)}</td><td class="arr">${deltaArrow(b, a)}</td><td>${a.toFixed(3)}</td></tr>`;
  }).join('\n');
  // the SVG strings are valid inline-HTML SVG; embed raw (they already carry their own viewBox)
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"/>
<title>aesthete fix diff — ${esc(name)}</title>
<style>
  :root{ color-scheme: dark; }
  body{ margin:0; background:#0b0f17; color:#e5e7eb; font:14px/1.45 ui-monospace,monospace; }
  header{ padding:14px 18px; border-bottom:1px solid #1f2937; }
  header h1{ font-size:15px; margin:0 0 6px; }
  .meta{ color:#9ca3af; font-size:12px; }
  .meta b{ color:#e5e7eb; }
  .scores{ display:flex; gap:18px; padding:12px 18px; border-bottom:1px solid #1f2937; align-items:center; }
  table{ border-collapse:collapse; font-size:13px; }
  td{ padding:2px 10px; }
  td.lbl{ color:#9ca3af; text-align:right; }
  td.arr{ color:#9ca3af; }
  .up{ color:#34d399; } .down{ color:#f87171; } .flat{ color:#6b7280; }
  .badge{ padding:3px 8px; border-radius:6px; background:#1f2937; color:#e5e7eb; font-size:12px; }
  .pair{ display:grid; grid-template-columns:1fr 1fr; gap:0; min-height:70vh; }
  .panel{ padding:14px; border-right:1px solid #1f2937; display:flex; flex-direction:column; }
  .panel:last-child{ border-right:0; }
  .panel h2{ font-size:13px; margin:0 0 8px; color:#9ca3af; font-weight:600; }
  .svgwrap{ flex:1; display:flex; align-items:center; justify-content:center; background:#1118270a; border:1px dashed #1f2937; border-radius:8px; padding:8px; overflow:auto; }
  .svgwrap svg{ max-width:100%; height:auto; max-height:72vh; background:#ffffff; border-radius:4px; }
</style></head>
<body>
<header>
  <h1>fix diff — ${esc(name)}</h1>
  <div class="meta">outcome <b>${esc(d.outcome)}</b> · profile <b>${esc(d.profile||'')}</b> · applied <b>${d.appliedFixes}</b> patch(es) · skipped(suggestionOnly) <b>${d.skippedFixes}</b></div>
</header>
<div class="scores">
  <table>${rows}</table>
</div>
<div class="pair">
  <div class="panel"><h2>BEFORE — round-tripped (adapter only)</h2><div class="svgwrap">${d.beforeSvg}</div></div>
  <div class="panel"><h2>AFTER — fixAlt()</h2><div class="svgwrap">${d.afterSvg}</div></div>
</div>
</body></html>`;
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const inputPath = positional[0];
  if (!inputPath) {
    console.error('usage: bun lib/diffview.mjs <layout-or-svg> [out.html] [--contract c.json]');
    process.exit(2);
  }
  const domain = detectDomain(inputPath);
  const alt = domain === 'alt' ? readJson(inputPath) : importPath(inputPath, { domain });
  const contract = flags.contract ? readJson(flags.contract) : defaultContract('');

  const d = diffView(alt, contract);
  const name = path.basename(inputPath);
  const html = diffHtml(name, d);
  const outPath = positional[1] || path.join(process.cwd(), `${path.basename(inputPath, path.extname(inputPath))}.diff.html`);
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`${d.outcome} | hard ${d.before.hardIntegrityScore}→${d.after.hardIntegrityScore} | measured ${d.before.measuredAestheticScore}→${d.after.measuredAestheticScore} | applied ${d.appliedFixes} | ${outPath}`);
}

if (isMain(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
