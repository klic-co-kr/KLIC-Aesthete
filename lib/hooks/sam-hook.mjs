// Image segmentation hook (Phase 3 import side). Segments a raster image into element regions
// via a vision model (SAM 3 / segment-anything-2.1). The regions it returns are fed to
// importImage({ imageBuffer, regions }).
//
// IMPURE by design: depends on a running inference server (bring your own — no model is bundled).
// The fetch is lazy (only when this function is called), so the core/adapters stay zero-dep.
// If no endpoint is configured or it's unreachable, returns [] so the caller falls back
// gracefully to canvas-only measurement (coverage:'unmeasurable') rather than crashing.
//
//   const regions = await imageRegions('screenshot.png', { endpoint: 'http://localhost:8000/segment' });
//   const alt = importImage({ imageBuffer: fs.readFileSync('screenshot.png'), regions });
//
// Expected server contract: POST { image: <base64> } → [{ bbox: { x, y, w, h }, label?, score? }, ...].

export async function imageRegions(imagePathOrBuffer, opts = {}) {
  const endpoint = opts.endpoint || process.env.SAM_ENDPOINT;
  if (!endpoint) return []; // no server configured → graceful fallback to canvas-only
  const fs = await import('node:fs');
  const buf = Buffer.isBuffer(imagePathOrBuffer) ? imagePathOrBuffer : fs.readFileSync(imagePathOrBuffer);
  const b64 = buf.toString('base64');
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: b64, ...(opts.params || {}) }),
    });
    if (!res.ok) return [];
    const masks = await res.json();
    return (Array.isArray(masks) ? masks : [])
      .filter((m) => m && m.bbox)
      .map((m) => ({ ...m.bbox, label: m.label, category: m.category }));
  } catch {
    return []; // network/server error → graceful fallback
  }
}
