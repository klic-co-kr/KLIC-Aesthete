// Image adapter. A raster image has NO declared geometry — pure geometry math cannot
// segment pixels (that needs CV / a canvas). So this adapter is honest about the split:
//   - the image supplies the CANVAS: we read pixel dimensions from PNG/JPEG/GIF headers
//     in pure JS (no browser, no canvas dependency).
//   - the ELEMENTS (regions of interest) must be DECLARED as a sidecar list by the
//     user/LLM (annotated bounding boxes). Without regions you get the canvas only.
// This keeps the measurement core domain-agnostic while admitting images as a source.

function dv(u8) { return new DataView(u8.buffer, u8.byteOffset, u8.byteLength); }

export function readImageDimensions(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (u8.length < 12) return null;
  // PNG: 89 50 4E 47
  if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) {
    const v = dv(u8);
    return { w: v.getUint32(16), h: v.getUint32(20) };
  }
  // JPEG: ff d8
  if (u8[0] === 0xff && u8[1] === 0xd8) return jpegDims(u8);
  // GIF: 47 49 46
  if (u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46) {
    const v = dv(u8);
    return { w: v.getUint16(6, true), h: v.getUint16(8, true) };
  }
  // WebP: 52 49 46 46 ... 57 45 42 50
  if (u8[0] === 0x52 && u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50) {
    const v = dv(u8);
    if (u8[12] === 0x56 && u8[13] === 0x50 && u8[14] === 0x38 && u8[15] === 0x4c) {
      return { w: v.getUint16(26, true) & 0x3fff, h: v.getUint16(28, true) & 0x3fff };
    }
  }
  return null;
}

function jpegDims(u8) {
  let i = 2;
  const v = dv(u8);
  while (i < u8.length) {
    if (u8[i] !== 0xff) { i++; continue; }
    let marker = u8[i + 1];
    i += 2;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      // SOFn: length(2) precision(1) height(2) width(2)
      return { h: v.getUint16(i + 3), w: v.getUint16(i + 5) };
    }
    const len = v.getUint16(i);
    i += len;
  }
  return null;
}

function normalizeRegion(r, i) {
  const b = r.bbox || r;
  return {
    id: r.id || `region-${i}`,
    label: r.label || r.id || `region-${i}`,
    category: r.category || 'region',
    kind: r.kind || 'box',
    bbox: { x: b.x || 0, y: b.y || 0, w: b.w || (b.width ?? 0), h: b.h || (b.height ?? 0) },
    style: {
      fontSize: r.fontSize || 16,
      luminance: r.luminance ?? 0.1,
      color: r.color || '#111827',
      bg: r.bg || '#ffffff',
      role: r.role || 'decor',
    },
  };
}

export function importImage({ imageBuffer, regions, canvas } = {}) {
  const dims = imageBuffer ? readImageDimensions(imageBuffer) : null;
  const cv = canvas || dims || { w: 1200, h: 800 };
  const nodes = Array.isArray(regions) ? regions.map((r, i) => normalizeRegion(r, i)) : [];
  const note = !regions
    ? 'image supplied canvas only; annotate regions (bbox list) to measure elements'
    : undefined;
  return {
    schema_version: 1,
    diagram_type: 'layout',
    meta: { title: 'image import', canvas: cv, source: 'image', ...(note ? { note } : {}) },
    nodes,
  };
}
