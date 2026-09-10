// anchor-buried — a connector endpoint buried INSIDE a node shape. Externalized from
// lib/vuln.mjs per the lib/slop/signatures/*.mjs precedent (keeps the engine file under the
// 650-line trigger; the vuln-gate catalog reads the threshold table from DEFAULT_THRESHOLDS).
//
// The rule (fiv.co.kr diagram conventions — "clip at the boundary"): an edge must END at the
// node boundary, never run to the centre — a centre-connected arrowhead is buried under the
// fill and reads as cut. Remediation quotes the fiv formulas verbatim: clip the centre-line
// at the box edge (t = min(hw/|dx|, hh/|dy|); intersection = C + t·d), retreat the head
// 4–8px, and spread multiple ports on one face by (k − (n−1)/2) × 14px. Measurement itself
// is only the burial depth — the distance from the recorded endpoint to the boundaryExit
// point along the stroke's approach axis.
//
// Raw input: the `endpoints` node key captured by lib/adapters/svg.mjs (<line> always;
// single-subpath fill=none <path>). Deterministic, pure geometry — no random/Date.

import { boundaryExit } from '../geometry.mjs';

export const ANCHOR_BURIED = {
  id: 'anchor-buried',
  title: 'connector endpoint buried inside a node shape (boundary-clip violation)',
  severity: 'medium',
  needs: ['geometry'],
  detect(ctx, t) {
    // GUARDS (each tied to evidence — a deterministic wrong answer is still wrong):
    //   maxNodes 400 — dense imports bail before the O(C×H) endpoint×host scan
    //                (label-baseline-off's cap, same value).
    //   endpoints PRESENCE is the honest coverage signal: domains without endpoint capture
    //                (html/pptx/image/abstract, filled/multi-subpath/closed paths) carry no
    //                key → graceful bail. Deliberately NOT a meta.source gate — a missing
    //                field means "unmeasured", never "clean".
    //   HOST FILTER kind ∈ {box,container} ∧ shape ∈ {rect,circle,ellipse}:
    //                text hosts are the legitimate anchors of label-only diagrams; icon is a
    //                decorative glyph; decor is what classifySvgSemantics demotes to intent
    //                (pills, shadows, tint layers — connectors pointing at badges is the
    //                normal case); path shapes (decision diamonds) approximate to their bbox
    //                with up to (√2−1)×hw of ghost corner penetration (~25px @120px half
    //                width) → excluded until path-aware port-fanout v2.
    //   minDepthPx 8 — the fiv retreat budget's ceiling (4–8px). Measured separation gap
    //                [5px, 60px]: bybit gallery (lint-clean corpus) 63 connectors → 0
    //                endpoints inside boxes, legit joints ≤0.5px; line-cuts-box.svg fail
    //                fixture → 5px each side (a routing defect whose endpoints are fine);
    //                centre-connect target → 60.0px (both ends at box centres).
    //   BOTH ENDS in one host — an internal leader/tick segment, not a buried arrowhead.
    //   KNOWN LIMIT (documented, unsuppressed): a marker with refX correction renders the
    //                arrowhead AT the boundary even when the raw endpoint coordinate is the
    //                node centre — legal output this detector would misread. 0 occurrences in
    //                the gallery+fixture corpus; severity stays medium and marker-aware
    //                endpoint resolution is the v2 seam.
    //   NO TYPE_SUPPRESSIONS entry: diagrams are this defect's home domain (the target
    //                fixture IS a diagram) — register one only on FP evidence. severity
    //                medium keeps it out of --vuln-gate's high-only regenerate branch
    //                (advisory notice, not a gate).
    if (ctx.nodes.length > t.maxNodes) return null;
    const connectors = ctx.nodes.filter((n) => Array.isArray(n.endpoints)
      && n.kind === 'decor' && (n.shape === 'line' || n.shape === 'path'));
    if (!connectors.length) return null;
    const hosts = ctx.nodes.filter((n) => (n.kind === 'box' || n.kind === 'container')
      && (n.shape === 'rect' || n.shape === 'circle' || n.shape === 'ellipse'));
    const inBox = (b, p) => p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h;
    let worst = null;
    for (const c of connectors) {
      for (const [e, other] of [[c.endpoints[0], c.endpoints[1]], [c.endpoints[1], c.endpoints[0]]]) {
        // smallest-area containing host — under nesting the inner real node wins; strict <
        // keeps the first on a tie → deterministic under the stable node order
        let host = null;
        for (const b of hosts) {
          if (!b.bbox || !inBox(b.bbox, e)) continue;
          if (!host || b.bbox.w * b.bbox.h < host.bbox.w * host.bbox.h) host = b;
        }
        if (!host) continue;                    // outside every host → boundary joint / gutter stub
        // when the endpoint sits EXACTLY on the host centre the centre→e ray is undefined —
        // the stroke physically arrived along its own axis, so that axis is the fallback
        const exit = boundaryExit(host.bbox, host.shape, e, [e[0] - other[0], e[1] - other[1]]);
        if (!exit) continue;
        const depth = Math.hypot(e[0] - exit[0], e[1] - exit[1]);
        if (!Number.isFinite(depth) || depth <= t.minDepthPx) continue;
        if (inBox(host.bbox, other)) continue;  // same-host leader/tick, not a buried head
        if (!worst || depth > worst.depth) worst = { depth, c, host };
      }
    }
    if (!worst) return null;
    return {
      signal: Number(worst.depth.toFixed(1)),
      threshold: t.minDepthPx,
      nodes: [worst.c.id, worst.host.id],
      remediation: 'end the edge at the node boundary, not its centre — clip the centre-line at the box edge (t = min(hw/|dx|, hh/|dy|); intersection = C + t·d) and pull the head back 4–8px along d so the tip clears the fill (fiv.co.kr diagram rule); with n edges leaving one face, spread ports (k − (n−1)/2) × 14px',
    };
  },
};
