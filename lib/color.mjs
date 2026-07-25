// Luminance weighting for Ngo balance (darker = heavier) + WCAG contrast.
// Convention: declared style.luminance is 0 (white) .. 1 (black).
// luminanceWeight: white ≈ 0.36, black ≈ 1.0 (~2.8× range — dark text visually outweighs a light field).

export function parseHex(hex) {
  if (typeof hex !== 'string') return null;
  const h = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]+$/.test(h)) return null;
  let full = h;
  if (h.length === 3) full = h.split('').map((c) => c + c).join('');
  if (full.length !== 6) return null;
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// relative luminance 0 (black) .. 1 (white), WCAG formula
export function relativeLuminance(hex) {
  const c = parseHex(hex);
  if (!c) return 1; // unknown → neutral white
  const ch = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

// contrast ratio between two hex colors (1..21)
export function contrastRatio(hexA, hexB) {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// Ngo optical-weight luminance scalar: 0 (white) → 0.36, 1 (black) → 1.0
export function luminanceWeight(luminance01) {
  const l = Number.isFinite(luminance01) ? Math.max(0, Math.min(1, luminance01)) : 0.5;
  return 0.36 + 0.64 * l;
}

// derive a 0..1 luminance from a style block: declared luminance wins, else infer from text color.
export function luminanceFromStyle(style) {
  if (!style) return 0.5;
  if (Number.isFinite(style.luminance)) return Math.max(0, Math.min(1, style.luminance));
  if (style.color) return 1 - relativeLuminance(style.color); // dark text → high luminance
  return 0.5;
}

// A node's OWN color — what it contributes to the palette, as opposed to what sits behind it.
// For a shape, its fill IS its own color (style.bg). For TEXT, its own color is the glyph
// foreground (style.color); style.bg is the surface it happens to sit on, which belongs to the
// element underneath. Palette consumers (harmony hue moments, similarity group consistency,
// symmetry axis matching, vuln palette signatures) must read this, not style.bg directly —
// otherwise every text node reports its backdrop and clashing type colors become invisible.
export function ownColor(node) {
  const c = node?.kind === 'text' ? node?.style?.color : node?.style?.bg;
  return c && c !== 'none' && c !== 'transparent' ? c : null;
}

// hex → {h:0..360, s:0..1, l:0..1}. For the Color Harmony skill (hue-wheel moment balance).
export function hexToHsl(hex) {
  const c = parseHex(hex);
  if (!c) return null;
  const r = c.r / 255; const g = c.g / 255; const b = c.b / 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0; let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = ((b - r) / d + 2); break;
      default: h = ((r - g) / d + 4);
    }
    h *= 60;
  }
  return { h, s, l };
}
