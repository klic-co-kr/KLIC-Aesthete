// OOXML uses EMU (English Metric Units): 914400 EMU = 1 inch = 96 CSS px.
// So 1 px = 9525 EMU.

export const EMU_PER_PX = 9525;

export function emuToPx(emu) {
  const v = Number(emu);
  if (!Number.isFinite(v)) return 0;
  return v / EMU_PER_PX;
}

export function pxToEmu(px) {
  return Math.round(px * EMU_PER_PX);
}
