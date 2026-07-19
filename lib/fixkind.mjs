// Fix-kind registry: which deterministic patches the fixer (fix.mjs PATCHES) can actually
// apply vs. which only flag a problem the geometry fixer cannot resolve.
//
// A violation whose fix.kind is in AUTO_FIXABLE_KINDS → mode 'autoFixable' (the closed-loop
// fixer will attempt it). Anything else (font/color/semantic/reading-flow fixes that need
// source ownership or model judgment) → 'suggestionOnly'. This is the §12 contract: the
// report never implies a fix is auto-applicable when it isn't.
//
// Keep this in sync with fix.mjs PATCHES — test/fixkind.test.mjs asserts the two sets match.

export const AUTO_FIXABLE_KINDS = new Set([
  'clamp-overflow',
  'separate-overlap',
  'shift-heaviest-toward-center',
  'shift-toward-cluster-centroid',
  'increase-gap',
  'scale-group-down',
]);

export function fixMode(kind) {
  return AUTO_FIXABLE_KINDS.has(kind) ? 'autoFixable' : 'suggestionOnly';
}
