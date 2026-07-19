#!/usr/bin/env node
// Batch-probe a directory of SVGs through the engine: node count + score distribution.
// Empirically answers "is this corpus inside the engine's domain (multi-element) or degenerate?"
//
//   node scripts/probe-corpus.mjs <dir>
import fs from 'node:fs';
import path from 'node:path';
import { importSvg } from '../lib/adapters/svg.mjs';
import { measureAlt } from '../lib/measure.mjs';

const dir = process.argv[2] || 'examples/validation-svg/logos';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.svg')).sort();

const stats = { n: 0, nodeCounts: [], overall: [], measured: [], coverage: [], hard: [], zeroNode: 0, crashed: 0 };
const rows = [];
for (const f of files) {
  try {
    const alt = importSvg(fs.readFileSync(path.join(dir, f), 'utf8'));
    const nc = alt.nodes.length;
    const rep = measureAlt(alt);
    const s = rep.summary;
    stats.n++; stats.nodeCounts.push(nc);
    if (nc === 0) stats.zeroNode++;
    stats.overall.push(s.overallScore);
    stats.measured.push(s.measuredAestheticScore);
    stats.coverage.push(s.coverageScore);
    stats.hard.push(s.hardIntegrityScore);
    rows.push({ f, nc, overall: s.overallScore, measured: s.measuredAestheticScore, coverage: s.coverageScore });
  } catch (e) { stats.crashed++; rows.push({ f, err: e.message.split('\n')[0] }); }
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const mn = (a) => (a.length ? Math.min(...a) : 0);
const mx = (a) => (a.length ? Math.max(...a) : 0);
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) * p)]; };

console.log(`=== ${dir} ===`);
console.log(`files=${stats.n} crashed=${stats.crashed} zeroNode=${stats.zeroNode}`);
console.log(`nodes: mean=${mean(stats.nodeCounts).toFixed(1)} min=${mn(stats.nodeCounts)} max=${mx(stats.nodeCounts)} p50=${pct(stats.nodeCounts, .5)}`);
console.log(`overallScore:       mean=${mean(stats.overall).toFixed(3)} min=${mn(stats.overall).toFixed(3)} max=${mx(stats.overall).toFixed(3)} spread=${(mx(stats.overall)-mn(stats.overall)).toFixed(3)}`);
console.log(`measuredAesthetic:  mean=${mean(stats.measured).toFixed(3)} min=${mn(stats.measured).toFixed(3)} max=${mx(stats.measured).toFixed(3)} spread=${(mx(stats.measured)-mn(stats.measured)).toFixed(3)}`);
console.log(`coverageScore:      mean=${mean(stats.coverage).toFixed(3)} min=${mn(stats.coverage).toFixed(3)} max=${mx(stats.coverage).toFixed(3)}`);
console.log(`hardIntegrityScore: mean=${mean(stats.hard).toFixed(3)} min=${mn(stats.hard).toFixed(3)} max=${mx(stats.hard).toFixed(3)}`);
// spread is the discriminative signal: spread≈0 → engine is flat on this corpus (outside domain).
