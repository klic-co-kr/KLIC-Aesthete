// CLI integration: proves the main() flag wiring (parseArgs → measureAlt/fixAlt threading)
// that the unit tests can't reach. Spawns the real bun CLIs in a throwaway cwd.
import { test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { skillRoot } from '../lib/shared/cli.mjs';

const root = skillRoot();
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aesthete-cli-'));
// process.execPath is the bun binary running this test; pass the script path as argv[1].
const run = (script, args, cwd) => execFileSync(process.execPath, [path.join(root, 'lib', script), ...args], { cwd });

test('CLI: measure --profile threads into proximity (meanGroupP changes)', () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(root, 'skill-params.cli-prof.json'),
      JSON.stringify({ proximity: { ALPHA: 4, RANG_RATIO: 1.5, FRAG_FACTOR: 2.5, SIM_THRESHOLD: 0.6 } }));
    const layout = path.join(root, 'examples', 'catalog-bad.layout.json');
    const outNo = path.join(dir, 'no.json');
    const outProf = path.join(dir, 'prof.json');
    run('measure.mjs', [layout, outNo], dir);
    run('measure.mjs', [layout, outProf, '--profile', 'cli-prof'], dir);
    const no = JSON.parse(fs.readFileSync(outNo, 'utf8')).skills.proximity.metrics.meanGroupP;
    const prof = JSON.parse(fs.readFileSync(outProf, 'utf8')).skills.proximity.metrics.meanGroupP;
    expect(prof).toBeLessThan(no); // ALPHA 1 → 4 ⇒ exp(-α·d/dRef) smaller
  } finally {
    fs.unlinkSync(path.join(root, 'skill-params.cli-prof.json'));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: fix --neural yields enum outcome best-effort + neural stoppedReason', () => {
  const dir = tmpDir();
  try {
    const layout = path.join(dir, 'layout.json');
    fs.writeFileSync(layout, JSON.stringify({
      schema_version: 1, diagram_type: 'layout',
      meta: { title: 't', canvas: { w: 200, h: 200 }, source: 'abstract' },
      nodes: [{ id: 'a', kind: 'box', bbox: { x: 10, y: 10, w: 50, h: 50 }, style: { fontSize: 16, luminance: 0.1, opacity: 1, color: '#111827', bg: '#3b82f6', role: 'decor' } }],
    }));
    const contract = path.join(dir, 'contract.json');
    fs.writeFileSync(contract, JSON.stringify({
      schema_version: 1, brief: 'cli neural',
      criteria: [
        { skill: 'collision', metric: 'count', op: '==', threshold: 0, weight: 3 },
        { skill: '_neural.mllm', metric: 'aesthetic', op: '>=', threshold: 0.7, weight: 1 },
      ],
    }));
    const scores = path.join(dir, 'scores.json');
    fs.writeFileSync(scores, JSON.stringify({ '_neural.mllm': { score: 0.4, metrics: { aesthetic: 0.4 } } }));
    const fixed = path.join(dir, 'fixed.json');
    run('fix.mjs', [layout, '--contract', contract, '--neural', scores, '--out', fixed], dir);
    const log = JSON.parse(fs.readFileSync(path.join(dir, 'layout.fix-log.json'), 'utf8'));
    expect(['pass', 'best-effort', 'no-improvement', 'budget-exhausted']).toContain(log.outcome);
    expect(log.outcome).toBe('best-effort');
    expect(log.stoppedReason).toContain('neural-criteria-failed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
