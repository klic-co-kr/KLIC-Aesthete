import { test, expect } from 'bun:test';
import { preflight, buildContract, resolveProfile } from '../lib/preflight.mjs';
import { evaluate } from '../lib/contract.mjs';
import { measureAlt } from '../lib/measure.mjs';
import { validate } from '../lib/shared/validator.mjs';

const brief = (artifact_type, extra = {}) => ({ artifact_type, canvas: { w: 1000, h: 700 }, ...extra });
const thr = (contract, skill, metric) => contract.criteria.find((c) => c.skill === skill && c.metric === metric)?.threshold;

test('preflight: recognized types get a directive + budget + negation', () => {
  for (const t of ['dashboard', 'marketing', 'report', 'diagram', 'poster']) {
    const s = preflight(brief(t));
    expect(s.recognized).toBe(true);
    expect(typeof s.directive).toBe('string');
    expect(s.budget).toBeTruthy();
    expect(s.budget.freeRatio.min).toBeGreaterThan(0);
    expect(s.negation.type.length).toBeGreaterThan(0);
    expect(s.negation.color.length).toBeGreaterThan(0);
    expect(s.negation.layout.length).toBeGreaterThan(0);
  }
});

test('preflight: type-tuned thresholds actually differ by artifact type', () => {
  // dashboard tolerates density (low freeRatio floor); marketing demands breathing (high floor)
  const dash = buildContract(brief('dashboard'));
  const mkt = buildContract(brief('marketing'));
  expect(thr(dash, 'whitespace', 'freeRatio')).toBeLessThan(thr(mkt, 'whitespace', 'freeRatio'));
  // poster allows dynamic tension (lower balance floor) vs report's sober stability
  const poster = buildContract(brief('poster'));
  const report = buildContract(brief('report'));
  expect(thr(poster, 'balance', 'BM')).toBeLessThan(thr(report, 'balance', 'BM'));
});

test('preflight: every contract carries the P0 structural floor regardless of type', () => {
  for (const t of ['dashboard', 'marketing', 'diagram']) {
    const c = buildContract(brief(t));
    expect(c.criteria.some((x) => x.skill === 'collision' && x.metric === 'count')).toBe(true);
    expect(c.criteria.some((x) => x.skill === 'boundary' && x.metric === 'overflowCount')).toBe(true);
  }
});

test('preflight: unknown artifact_type → generic fallback (recognized=false), still a verifiable contract', () => {
  const s = preflight(brief('something-new'));
  expect(s.recognized).toBe(false);
  expect(s.artifact_type).toBe('generic');
  // P0 floor + neutral defaults still present, so measure/fix can still run
  expect(s.contract.criteria.some((x) => x.skill === 'collision')).toBe(true);
  expect(s.contract.criteria.some((x) => x.skill === 'whitespace')).toBe(true);
});

test('preflight: emitted contract is consumable by contract.evaluate (pre⇄post loop closes)', () => {
  // generate the pre-flight contract, then evaluate a measured report against it — the same
  // contract defines the generation goal AND the acceptance check.
  const contract = buildContract(brief('dashboard'));
  const alt = {
    schema_version: 1, diagram_type: 'layout',
    meta: { title: 't', canvas: { w: 1000, h: 700 }, source: 'abstract' },
    nodes: [
      { id: 'a', category: 'kpi', kind: 'box', bbox: { x: 20, y: 20, w: 200, h: 120 }, style: { role: 'heading', fontSize: 20, luminance: 0.1, opacity: 1, bg: '#3b82f6', color: '#111827' } },
      { id: 'b', category: 'kpi', kind: 'box', bbox: { x: 260, y: 20, w: 200, h: 120 }, style: { role: 'body', fontSize: 14, luminance: 0.1, opacity: 1, bg: '#3b82f6', color: '#111827' } },
    ],
  };
  const report = measureAlt(alt);
  const ev = evaluate(report, contract);
  expect(Array.isArray(ev.criteria)).toBe(true);
  expect(['pass', 'fail']).toContain(ev.verdict);
});

test('preflight: deterministic — same brief → byte-identical spec', () => {
  const b = brief('report', { brief: 'exec deck' });
  expect(JSON.stringify(preflight(b))).toBe(JSON.stringify(preflight(JSON.parse(JSON.stringify(b)))));
});

test('resolveProfile: known → profile, unknown → null', () => {
  expect(resolveProfile({ artifact_type: 'dashboard' })).toBeTruthy();
  expect(resolveProfile({ artifact_type: 'nope' })).toBeNull();
});

test('preflight: emitted contract is schema-valid (no stray fields like artifact_type)', async () => {
  // the contract feeds fix.mjs --contract and must satisfy contract.schema.json
  // (additionalProperties:false). Regression guard: an earlier build put artifact_type on the
  // contract and broke validation.
  const spec = preflight(brief('dashboard'));
  await validate('contract', spec.contract);
  expect(spec.contract.artifact_type).toBeUndefined();
  expect(spec.artifact_type).toBe('dashboard'); // type lives on the spec wrapper, not the contract
});

// ---- structural priors (shape-only catalog) ----

test('preflight: every recognized type emits a structure pick + alternatives', () => {
  for (const t of ['dashboard', 'marketing', 'report', 'diagram', 'poster']) {
    const s = preflight(brief(t));
    expect(typeof s.structure.id).toBe('string');
    expect(typeof s.structure.shape).toBe('string');
    expect(Array.isArray(s.structures)).toBe(true);
    expect(s.structures.length).toBeGreaterThanOrEqual(3); // enough to rotate across runs
    expect(s.structures.map((x) => x.id)).toContain(s.structure.id);
  }
});

test('preflight: structural priors differ by type (not one universal shape set)', () => {
  const dash = preflight(brief('dashboard')).structures.map((s) => s.id);
  const mkt = preflight(brief('marketing')).structures.map((s) => s.id);
  expect(dash).not.toEqual(mkt);
});

test('preflight: unknown type → generic structure (unspecified), still a pick', () => {
  const s = preflight(brief('something-new'));
  expect(s.structure.id).toBe('unspecified');
  expect(s.structures.length).toBeGreaterThanOrEqual(1);
});

test('preflight: structure lives on the spec wrapper, NOT the schema-locked contract', async () => {
  const spec = preflight(brief('dashboard'));
  await validate('contract', spec.contract); // still schema-valid
  expect(spec.contract.structure).toBeUndefined(); // contract carries only criteria
  expect(spec.structure).toBeTruthy(); // structure is on the wrapper
});

// ---- negation extension (concrete anti-pattern tells) ----

test('preflight: negation carries the concrete anti-pattern tells + a copy category', () => {
  const s = preflight(brief('marketing'));
  const flat = [...s.negation.layout, ...s.negation.copy, ...s.negation.type];
  expect(s.negation.copy.length).toBeGreaterThan(0); // invented-metrics ban
  expect(flat.some((n) => /hanging header/i.test(n))).toBe(true); // gate 66
  expect(flat.some((n) => /re-drawn fake chrome/i.test(n))).toBe(true); // gate 57
  expect(flat.some((n) => /bare 1fr/i.test(n))).toBe(true); // gate 61
  expect(flat.some((n) => /two-line clickable/i.test(n))).toBe(true); // gate 59
  expect(flat.some((n) => /invented metrics/i.test(n))).toBe(true); // gate 56
});

test('preflight: HTML-only negation gates suppressed for non-HTML formats (no HTMLism leakage)', () => {
  // CSS/web-shaped gates must NOT leak into svg/pptx/diagram preflight
  // (telling a diagram author to "use minmax(0,1fr)" is nonsense).
  const svg = preflight(brief('diagram', { format: 'svg' }));
  const flat = [...svg.negation.layout, ...svg.negation.type, ...svg.negation.color, ...svg.negation.copy];
  // universal gates still present
  expect(flat.some((n) => /hanging header/i.test(n))).toBe(true);
  expect(flat.some((n) => /invented metrics/i.test(n))).toBe(true);
  expect(flat.some((n) => /50\/50 split/i.test(n))).toBe(true);
  // HTML/CSS-only gates suppressed for svg
  expect(flat.some((n) => /bare 1fr/i.test(n))).toBe(false);
  expect(flat.some((n) => /oklch/i.test(n))).toBe(false);
  expect(flat.some((n) => /re-drawn fake chrome/i.test(n))).toBe(false);
  expect(flat.some((n) => /two-line clickable/i.test(n))).toBe(false);
});

test('preflight: format=html keeps the HTML/CSS gates; omitted format keeps everything (back-compat)', () => {
  const html = preflight(brief('marketing', { format: 'html' }));
  const htmlFlat = [...html.negation.layout, ...html.negation.type];
  expect(htmlFlat.some((n) => /bare 1fr/i.test(n))).toBe(true);
  expect(htmlFlat.some((n) => /oklch/i.test(n))).toBe(true);
  // no format → all gates (backward-compatible with pre-format briefs)
  const nofmt = preflight(brief('marketing'));
  const noFlat = [...nofmt.negation.layout, ...nofmt.negation.type];
  expect(noFlat.some((n) => /bare 1fr/i.test(n))).toBe(true);
});

// ---- diversification (opt-in rotation; default stays deterministic) ----

test('preflight: WITHOUT a log → deterministic, structure pick is index 0', () => {
  const b = brief('dashboard');
  const s1 = preflight(b);
  const s2 = preflight(JSON.parse(JSON.stringify(b)));
  expect(s1.structure.id).toBe(s2.structure.id);
  expect(s1.structure.id).toBe(s1.structures[0].id);
});

test('preflight: WITH a log → structure rotates off the last same-type entry', () => {
  const b = brief('dashboard');
  const base = preflight(b); // index 0 (evidence-grid)
  // simulate a prior dashboard run that used the default structure
  const log = [{ seq: 1, artifact_type: 'dashboard', structure: base.structure.id }];
  const rotated = preflight(b, { log });
  expect(rotated.structure.id).not.toBe(base.structure.id);
  expect(rotated.structure.id).toBe(base.structures[1].id); // advanced by one, mod len
  // and keeps rotating
  const log2 = [{ seq: 2, artifact_type: 'dashboard', structure: rotated.structure.id }];
  const rotated2 = preflight(b, { log: log2 });
  expect(rotated2.structure.id).toBe(base.structures[2].id);
});

test('preflight: a log entry for a DIFFERENT type does not rotate this type (starts at 0)', () => {
  const b = brief('dashboard');
  const log = [{ seq: 1, artifact_type: 'marketing', structure: 'stat-led' }];
  expect(preflight(b, { log }).structure.id).toBe(preflight(b).structures[0].id);
});

// ---- brief → structure inference (pick precedence: signal > rotate > default) ----

test('preflight: brief signal picks the fitting structure (not the index-0 default)', () => {
  // marketing default = hero-led (index 0); a "manifesto" brief must pick manifesto
  expect(preflight(brief('marketing', { brief: 'a product manifesto page' })).structure.id).toBe('manifesto');
  expect(preflight(brief('marketing', { brief: '한 페이지 선언문' })).structure.id).toBe('manifesto');
  expect(preflight(brief('marketing', { brief: 'stat-led proof with one big number' })).structure.id).toBe('stat-led');
  // dashboard default = evidence-grid; "bento" brief picks bento
  expect(preflight(brief('dashboard', { brief: 'bento layout, mixed cell sizes' })).structure.id).toBe('bento');
  // reason is recorded
  expect(preflight(brief('marketing', { brief: 'manifesto' })).structurePickReason).toBe('inferred');
});

test('preflight: brief with NO signal falls through to the index-0 default', () => {
  expect(preflight(brief('marketing', { brief: 'a landing page' })).structure.id).toBe('hero-led');
  expect(preflight(brief('marketing', { brief: 'a landing page' })).structurePickReason).toBe('default');
});

test('preflight: brief signal OVERRIDES diversification (brief-fit wins over forced variety)', () => {
  // a "manifesto" brief + a log that would rotate → still manifesto, not rotated
  const log = [{ seq: 1, artifact_type: 'marketing', structure: 'hero-led' }];
  const s = preflight(brief('marketing', { brief: 'manifesto' }), { log });
  expect(s.structure.id).toBe('manifesto');
  expect(s.structurePickReason).toBe('inferred');
});
