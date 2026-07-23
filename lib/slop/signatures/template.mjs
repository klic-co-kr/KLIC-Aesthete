// slop template signatures. P1 = trusted-by logo strip, hero-trio (3-up equal hero cards).
// hanging-header + even-split are VULN-owned (lib/vuln.mjs) — NOT duplicated here (spec §3 H1).
// hero-trio needs alt geometry; the fold attaches ctx.alt.

export const SIGNATURES = [
  {
    id: 'slop.template.trusted-by',
    title: '"Trusted by" logo strip (templated-marketing tell)',
    severity: 'medium',
    tier: 'P1',
    needs: ['hasTrustedBy'],
    detect(ctx, t = {}) {
      if (!ctx.hasTrustedBy) return null;
      const min = t.minTrustedBy ?? 1; // presence is enough for v1 (logo-count tuning is v2)
      return { signal: 1, threshold: min, nodes: [], remediation: 'drop the "Trusted by" logo strip — especially with fabricated names/metrics; earn trust with one concrete proof' };
    },
  },
  {
    id: 'slop.template.hero-trio',
    title: 'three-up equal hero card row (templated-landing tell)',
    severity: 'medium',
    tier: 'P1',
    needs: ['alt'],
    detect(ctx, t = {}) {
      const nodes = (ctx.alt?.nodes || []).filter((n) => n?.bbox);
      if (nodes.length < 3) return null;
      // three siblings of near-equal area on the same row band
      const byRow = new Map();
      for (const n of nodes) {
        const row = Math.round(n.bbox.y / 40); // 40px row bucket
        if (!byRow.has(row)) byRow.set(row, []);
        byRow.get(row).push(n);
      }
      const min = t.minTrio ?? 3;
      const maxWdiff = t.maxWidthDiff ?? 0.15;
      let hit = null;
      for (const grp of byRow.values()) {
        if (grp.length < min) continue;
        const ws = grp.map((n) => n.bbox.w);
        const meanW = ws.reduce((a, b) => a + b, 0) / ws.length;
        if (meanW <= 0) continue;
        const spread = Math.max(...ws.map((w) => Math.abs(w - meanW) / meanW));
        if (spread <= maxWdiff) { hit = { count: grp.length, spread }; break; }
      }
      if (!hit) return null;
      return { signal: hit.count, threshold: min, nodes: [], remediation: 'three-up equal hero cards read as a template — vary scale/weight or commit a single focal' };
    },
  },
];
