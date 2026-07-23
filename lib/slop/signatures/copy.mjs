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
