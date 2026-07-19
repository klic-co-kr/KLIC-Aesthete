// HTML render hook (Phase 3 import side). Renders a page in a headless browser and reads every
// element's bounding box via getBoundingClientRect — the ONLY way to see flex/grid/flow layout
// (the pure-JS html adapter sees only explicit absolute coords). The regions it returns are fed
// to importHtml(html, { regions, canvas }).
//
// IMPURE by design: depends on a browser binary at runtime. The dependency is LAZY (dynamic
// import of cloakbrowser inside the function), so the measurement core and the adapters stay
// zero-dep / no-browser unless a caller explicitly opts into this hook. cloakbrowser auto-
// downloads its Chromium on first launch. Swap the import for stock Playwright if preferred.
//
// NOTE: cloakbrowser's stealth Chromium hangs on page.setContent in headless; we route HTML-string
// input through a temp file + page.goto('file://…'), which works reliably.
//
//   const regions = await htmlRegions('<div style="display:flex;gap:8px"><span>A</span><span>B</span></div>',
//                                     { viewport: { width: 1280, height: 720 } });
//   const alt = importHtml(html, { regions, canvas: { w: 1280, h: 720 } });

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tmpSeq = 0; // deterministic temp-name counter (the hook is impure, but no need for Date/random)

export async function htmlRegions(htmlOrUrl, opts = {}) {
  const { launch } = await import('cloakbrowser'); // drop-in Playwright; auto-downloads Chromium
  const browser = await launch({ headless: true, ...(opts.launchOpts || {}) });
  const isUrl = typeof htmlOrUrl === 'string' && /^https?:\/\//.test(htmlOrUrl);
  let tmpFile = null;
  try {
    const page = await browser.newPage();
    if (opts.viewport) await page.setViewportSize(opts.viewport);
    let target = htmlOrUrl;
    if (!isUrl) {
      tmpFile = path.join(os.tmpdir(), `aesthete-hook-${process.pid}-${tmpSeq++}.html`);
      fs.writeFileSync(tmpFile, String(htmlOrUrl));
      target = 'file://' + tmpFile;
    }
    const wait = opts.waitUntil || 'domcontentloaded';
    await page.goto(target, { waitUntil: wait, ...(opts.timeout ? { timeout: opts.timeout } : {}) });
    const sel = opts.selector || 'body *';
    const raw = await page.$$eval(sel, (els) => els.map((el) => {
      const r = el.getBoundingClientRect();
      const label = (el.getAttribute('data-label') || (el.textContent || '').trim().slice(0, 40)) || null;
      return {
        x: r.left, y: r.top, w: r.width, h: r.height,
        id: el.id || undefined,
        label: label || undefined,
        category: el.getAttribute('data-category') || undefined,
        kind: el.getAttribute('data-kind') || undefined,
      };
    }));
    return raw.filter((r) => r.w > 0 && r.h > 0); // drop zero-size (off-screen / display:none)
  } finally {
    await browser.close().catch(() => {});
    if (tmpFile) { try { fs.unlinkSync(tmpFile); } catch {} }
  }
}
