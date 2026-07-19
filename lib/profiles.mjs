// Execution-profile matrix — adapted from the searchpo pattern.
//
// HONEST SCOPE (learned via realistic review): this is a LAYER-NAMING + TRANSPARENCY
// convention, NOT a security/enforcement boundary. Real enforcement in Aesthete is
// STRUCTURAL — e.g. the fixer's PATCHES map simply contains no suggestionOnly kinds, so it
// cannot apply them regardless of any allow/deny list. The matrix here names the intended
// layers and records what each forbids; the `enforced` flag states whether a runtime
// actually binds it. Like OPA used in-process (per the AI SDK / runtime-governance pattern),
// an allow/deny list the same process consults is advisory: it has no OS/network isolation
// and a caller can bypass it. Treat it as documented discipline + the skippedFixes record,
// not as a guarantee.
//
//   profile        | enforced | bound by              | forbidden (intent)
//   measure-only   | true     | lib/vuln.mjs          | mutate-alt, apply-fix, call-model
//   fix-geometry   | true     | lib/fix.mjs           | apply-suggestionOnly, mutate-semantics
//   llm-judge      | false    | (aspirational)        | publish, approve, auto-mutate   — no publish/approve code exists yet
//   human-gate     | false    | (aspirational)        | auto-approve, auto-publish       — no human-signature runtime exists yet
//
// Autonomy levels follow loopify (L0 human … L5 autonomous publish). Aesthete never exceeds L3.

export const PROFILES = {
  'measure-only': {
    autonomy: 'L1',
    enforced: true, // bound: lib/vuln.mjs asserts this profile before scanning
    allowed: ['measure', 'report', 'vuln-scan', 'preflight'],
    forbidden: ['mutate-alt', 'apply-fix', 'call-model', 'publish', 'approve'],
    successTruth: 'coverage + measuredAestheticScore emitted; ALT unchanged',
  },
  'fix-geometry': {
    autonomy: 'L3',
    enforced: true, // bound: lib/fix.mjs gates each patch through isAllowed; real enforcement is structural (PATCHES has no suggestionOnly kinds)
    allowed: ['measure', 'apply-autoFixable-patch', 'snapshot-pre'],
    forbidden: ['apply-suggestionOnly', 'call-model', 'publish', 'approve', 'mutate-semantics'],
    successTruth: 'contract pass + monotonic-improvement gate held; only bbox moved',
  },
  'llm-judge': {
    autonomy: 'L3',
    enforced: false, // ASPIRATIONAL: the neural seam does not yet bind this; no publish/approve code exists to gate
    allowed: ['merge-external-axis', 'evaluate-contract', 'write-evidence-ledger'],
    forbidden: ['publish', 'approve', 'auto-mutate-from-judgment'],
    successTruth: 'multi-judge agreement + source-bound evidence; never auto-publish',
  },
  'human-gate': {
    autonomy: 'L0',
    enforced: false, // ASPIRATIONAL: no human-signature runtime exists
    allowed: ['present', 'await-signature'],
    forbidden: ['publish', 'approve', 'auto-publish', 'auto-approve', 'mutate'],
    successTruth: 'human signature recorded',
  },
};

export const PROFILE_NAMES = Object.keys(PROFILES);

export function getProfile(name) {
  return PROFILES[name] || null;
}

export function isEnforced(name) {
  const p = PROFILES[name];
  return Boolean(p && p.enforced);
}

// assertAllowed(profile, action) — throw if `action` is forbidden by the profile.
// ADVISORY: this is a same-process decision gate (see OPA in-process pattern), not a
// security boundary. Use it as documented discipline; structural enforcement (e.g. what
// PATCHES contains) is what actually prevents forbidden actions.
export function assertAllowed(profile, action) {
  const label = typeof profile === 'string' ? profile : '(anon)';
  const p = typeof profile === 'string' ? PROFILES[profile] : profile;
  if (!p) throw new Error(`unknown execution profile '${label}'`);
  if (p.forbidden.includes(action)) {
    throw new Error(`execution profile '${label}' forbids '${action}' (autonomy ${p.autonomy}, enforced ${p.enforced})`);
  }
  return true;
}

export function isAllowed(profile, action) {
  const p = typeof profile === 'string' ? PROFILES[profile] : profile;
  if (!p) return false;
  return !p.forbidden.includes(action);
}
