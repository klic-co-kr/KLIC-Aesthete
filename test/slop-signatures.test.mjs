import { test, expect } from 'bun:test';
import { SIGNATURES as PALETTE } from '../lib/slop/signatures/palette.mjs';
import { SIGNATURES as DECO } from '../lib/slop/signatures/decoration.mjs';
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
