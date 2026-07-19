// Region → ALT-node normalization, shared by the image/html/docx adapters' optional `regions`
// input — the import-side seam for Phase 3 (render hooks).
//
// WHY A SEAM, NOT A BROWSER IN THE CORE. The measurement core is pure-JS/no-browser by identity
// (the evaluator is arithmetic; no Date/random, no DOM). But raster images, HTML flex/grid, and
// paginated docs have NO declared geometry — measuring them needs a renderer/vision model. Rather
// than pull Playwright/SAM/LibreOffice into the core, regions are PRODUCED OUT OF BAND by a render
// hook (lib/hooks/browser-hook.mjs, sam-hook.mjs) and PASSED IN via the adapter's opts.regions as a
// plain array. The adapter stays synchronous and dependency-free; the impure hook runs before it.
// No regions supplied → the adapter reports coverage:'unmeasurable' exactly as before, so every
// existing caller is unaffected.
//
// Region (fields optional except dimensions): { x, y, w, h, id?, label?, category?, kind?,
//   fontSize?, luminance?, color?, bg?, role? }. Accepts bbox-aliased keys (width/height) too.

export function regionsToNodes(regions) {
  return (regions || [])
    .filter((r) => r && regionDim(r, 'w') > 0 && regionDim(r, 'h') > 0)
    .map((r, i) => {
      const b = r.bbox || {};
      const id = r.id || `region-${i}`;
      return {
        id,
        label: r.label || id,
        category: r.category || 'region',
        kind: r.kind || 'box',
        shape: 'rect',
        bbox: { x: num(r.x ?? b.x), y: num(r.y ?? b.y), w: regionDim(r, 'w'), h: regionDim(r, 'h') },
        style: {
          fontSize: r.fontSize || 16,
          luminance: r.luminance ?? 0.1,
          color: r.color || '#111827',
          bg: r.bg || '#ffffff',
          role: r.role || 'decor',
        },
      };
    });
}

function regionDim(r, key) {
  const b = r.bbox || {};
  return num(r[key] ?? b[key] ?? r[key === 'w' ? 'width' : 'height']);
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

// Canonical Region shape (documentation / for hook authors). Not enforced at runtime.
export const REGION_SHAPE = {
  x: 'number', y: 'number', w: 'number', h: 'number',
  id: 'string?', label: 'string?', category: 'string?', kind: "'text'|'image'|'box'?",
  fontSize: 'number?', luminance: 'number?', color: 'string?', bg: 'string?', role: 'string?',
};
