import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { chromium, type Page } from 'playwright';
import { assembleCfrWebm, findPlaywrightFfmpeg, type ScreencastFrame } from './screencast';
import type { CaptureMeta, PageSection, ScrollVideoInfo } from './types';
import { ensureDir, log, writeJson } from './util';

export type CaptureOptions = {
  /** CSS pixel width of the browser viewport. */
  width?: number;
  /** Cap on how much page height (CSS px) we capture — some pages are 30k px tall. */
  maxHeight?: number;
  /** 2 = retina-sharp footage, larger files. */
  deviceScaleFactor?: number;
  timeoutMs?: number;
  /** Hard budget for the whole capture — the last line of defense; every
   * individual step is also bounded so one stuck site never blocks the queue. */
  watchdogMs?: number;
  /** Software WebGL renders three.js scenes but is memory-hungry; lite
   * retries turn it off to survive on small containers. */
  webgl?: boolean;
};

const DEFAULTS: Required<CaptureOptions> = {
  width: 1440,
  maxHeight: 9000,
  // 1.5x = 2160px-wide capture: sharp on a 1080 reel without the tab-memory
  // cost of full retina on image-heavy pages.
  deviceScaleFactor: 1.5,
  timeoutMs: 40_000,
  watchdogMs: 150_000,
  webgl: true,
};

/** Read width/height straight out of a JPEG's SOF marker. */
export function jpegDimensions(file: string): { width: number; height: number } | null {
  const buf = fs.readFileSync(file);
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    // SOF0..SOF15 except DHT(C4)/JPG(C8)/DAC(CC) carry the frame dimensions.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

// In-page scripts are strings on purpose: tsx/esbuild transpiles function
// arguments and injects helpers (__name) that don't exist inside the page.

const REVEAL_SCRIPT = `(() => {
  // Freeze animations and un-hide scroll-reveal content so the full-page
  // screenshot doesn't contain half-faded or opacity:0 sections.
  const style = document.createElement('style');
  style.textContent =
    '*, *::before, *::after {' +
    ' animation-play-state: paused !important;' +
    ' transition: none !important;' +
    ' scroll-behavior: auto !important; }' +
    ' ::-webkit-scrollbar { display: none !important; }' +
    ' html { scrollbar-width: none !important; }';
  document.head.appendChild(style);
  let fixed = 0;
  for (const el of document.querySelectorAll('div, section, article, li, img, h1, h2, h3, p')) {
    const cs = getComputedStyle(el);
    if (Number(cs.opacity) < 0.1 && cs.display !== 'none' && cs.visibility !== 'hidden') {
      el.style.setProperty('opacity', '1', 'important');
      el.style.setProperty('transform', 'none', 'important');
      fixed++;
      if (fixed > 400) break;
    }
  }
  return fixed;
})()`;

// WebGL buffers are normally cleared right after compositing, so canvases
// read back blank and go blank on viewport changes. Force
// preserveDrawingBuffer at context creation — this runs BEFORE any page
// script, so it catches three.js/R3F no matter how they schedule frames.
const PRESERVE_WEBGL_INIT = `(() => {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
      attrs = Object.assign({}, attrs || {}, { preserveDrawingBuffer: true });
    }
    return orig.call(this, type, attrs);
  };
})();`;

// With preserved buffers, canvases can be snapshotted at any time — swap
// each for a plain <img> so every capture strategy renders it. Tainted
// canvases (cross-origin textures) throw on readback; leave those live,
// the preserved buffer still displays in screenshots.
const CANVAS_FREEZE_SCRIPT = `(() => {
  let frozen = 0, tainted = 0, blank = 0, total = 0;
  for (const c of Array.from(document.querySelectorAll('canvas'))) {
    if (c.clientWidth < 50 || c.clientHeight < 50) continue;
    total++;
    try {
      const url = c.toDataURL('image/png');
      if (url.length < 2000) { blank++; continue; }
      const img = new Image();
      img.src = url;
      img.style.cssText = 'width:' + c.clientWidth + 'px;height:' + c.clientHeight + 'px;display:block;';
      img.className = c.className;
      c.replaceWith(img);
      frozen++;
    } catch (e) { tainted++; }
  }
  return total + ' canvas(es): ' + frozen + ' frozen, ' + tainted + ' tainted, ' + blank + ' blank';
})()`;

// img.decode() on an image that never finishes loading stays pending FOREVER
// (proven in testing) — every await here must self-timeout inside the page.
const DECODE_SCRIPT = `Promise.race([
  Promise.allSettled(
    Array.from(document.images)
      .filter((im) => im.src && !im.complete)
      .slice(0, 40)
      .map((img) => img.decode())
  ),
  new Promise((r) => setTimeout(r, 4000)),
]).then(() => true)`;

const FONTS_SCRIPT = `Promise.race([
  document.fonts.ready,
  new Promise((r) => setTimeout(r, 4000)),
]).then(() => true)`;

// SPA-style sites often scroll inside an inner container while the body
// stays one viewport tall — full-page screenshots then capture a single
// screen and the reel "doesn't scroll". Detect the real scroller and expand
// it into the document flow so the whole page is capturable.
const EXPAND_SCROLLER_SCRIPT = `(() => {
  const doc = document.scrollingElement || document.documentElement;
  const vh = innerHeight;
  if (doc.scrollHeight > vh * 1.3) return 'body scrolls (' + doc.scrollHeight + 'px)';
  let best = null;
  const els = document.querySelectorAll('div, main, section');
  const cap = Math.min(els.length, 4000);
  for (let i = 0; i < cap; i++) {
    const el = els[i];
    if (el.scrollHeight > el.clientHeight + 200 && el.clientHeight > vh * 0.4) {
      const o = getComputedStyle(el).overflowY;
      if (o === 'auto' || o === 'scroll' || o === 'overlay' || o === 'hidden') {
        if (!best || el.scrollHeight > best.scrollHeight) best = el;
      }
    }
  }
  if (!best) return 'no inner scroller found (' + doc.scrollHeight + 'px)';
  const fix = (el) => {
    el.style.setProperty('height', 'auto', 'important');
    el.style.setProperty('max-height', 'none', 'important');
    el.style.setProperty('overflow', 'visible', 'important');
  };
  fix(best);
  let p = best.parentElement;
  while (p) { fix(p); p = p.parentElement; }
  document.documentElement.style.setProperty('height', 'auto', 'important');
  document.body.style.setProperty('height', 'auto', 'important');
  return 'expanded inner scroller to ' + (document.scrollingElement || document.documentElement).scrollHeight + 'px';
})()`;

// Lazy-loading libraries hide images behind data-src/data-srcset until their
// own observers fire — force everything eager so the capture isn't full of
// blank product cards.
const FORCE_LAZY_SCRIPT = `(() => {
  let n = 0;
  for (const img of document.querySelectorAll('img')) {
    if (img.loading === 'lazy') { img.loading = 'eager'; n++; }
    const d = img.dataset || {};
    if (!img.getAttribute('src') && (d.src || d.lazySrc || d.original)) { img.src = d.src || d.lazySrc || d.original; n++; }
    if (!img.getAttribute('srcset') && (d.srcset || d.lazySrcset)) { img.srcset = d.srcset || d.lazySrcset; n++; }
  }
  for (const el of document.querySelectorAll('[data-bg], [data-background-image]')) {
    const bg = el.dataset.bg || el.dataset.backgroundImage;
    if (bg && !el.style.backgroundImage) { el.style.backgroundImage = 'url(' + bg + ')'; n++; }
  }
  return n;
})()`;

// Viewport-relative section detector used during scroll-and-stitch: measures
// where sections sit ON SCREEN at each scroll stop, which maps 1:1 onto the
// stitched image even when the site scrolls via transforms.
const SECTIONS_IN_VIEW_SCRIPT = `(() => {
  const out = [];
  const vw = document.documentElement.clientWidth;
  const vh = innerHeight;
  const add = (el, kind) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width < vw * 0.25 || r.height < 40) return;
    if (r.top < -80 || r.top > vh * 0.85) return;
    if (getComputedStyle(el).display === 'none') return;
    out.push({ top: Math.round(r.top), h: Math.round(Math.min(r.height, 1200)), kind });
  };
  const q = (sel) => { try { return Array.from(document.querySelectorAll(sel)); } catch { return []; } };
  add(q('h1')[0], 'hero');
  q('[class*="testimonial" i], [class*="review" i], blockquote').slice(0, 3).forEach((el) => add(el, 'testimonial'));
  q('[class*="pricing" i], [class*="plans" i]').slice(0, 2).forEach((el) => add(el, 'pricing'));
  q('[class*="stat" i], [class*="metric" i]').slice(0, 2).forEach((el) => add(el, 'stats'));
  q('[class*="gallery" i], [class*="portfolio" i], [class*="work" i]').slice(0, 2).forEach((el) => add(el, 'gallery'));
  q('[class*="bento" i], [class*="card" i], [class*="grid" i], [class*="feature" i], [class*="service" i]').slice(0, 4).forEach((el) => add(el, 'cards'));
  q('form, [class*="contact" i], [class*="cta" i]').slice(0, 3).forEach((el) => add(el, 'cta'));
  q('h2').slice(0, 6).forEach((el) => add(el, 'heading'));
  return JSON.stringify(out.slice(0, 8));
})()`;

const SECTIONS_SCRIPT = `(() => {
  const out = [];
  const taken = [];
  const vw = document.documentElement.clientWidth;
  const add = (el, kind) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const y = Math.round(r.top + window.scrollY);
    if (r.width < vw * 0.25 || r.height < 40 || y < 0) return;
    if (getComputedStyle(el).display === 'none') return;
    for (const t of taken) if (Math.abs(t - y) < 350) return;
    taken.push(y);
    out.push({ y, h: Math.round(Math.min(r.height, 1200)), kind });
  };
  const q = (sel) => { try { return Array.from(document.querySelectorAll(sel)); } catch { return []; } };
  add(q('h1')[0] || q('[class*="hero" i]')[0], 'hero');
  q('[class*="testimonial" i], [class*="review" i], blockquote').slice(0, 1).forEach((el) => add(el, 'testimonial'));
  q('[class*="pricing" i], [class*="plans" i]').slice(0, 1).forEach((el) => add(el, 'pricing'));
  q('[class*="stat" i], [class*="metric" i], [class*="number" i]').slice(0, 1).forEach((el) => add(el, 'stats'));
  q('[class*="gallery" i], [class*="portfolio" i], [class*="work" i]').slice(0, 1).forEach((el) => add(el, 'gallery'));
  q('[class*="bento" i], [class*="card" i], [class*="grid" i], [class*="feature" i], [class*="service" i]').slice(0, 2).forEach((el) => add(el, 'cards'));
  q('form, [class*="contact" i], [class*="cta" i], [class*="book" i]').slice(0, 2).forEach((el) => add(el, 'cta'));
  q('h2').slice(0, 5).forEach((el) => add(el, 'heading'));
  out.sort((a, b) => a.y - b.y);
  return JSON.stringify(out.slice(0, 6));
})()`;

// --- scroll-and-stitch fallback -------------------------------------------
// Some sites never scroll the document: a fixed wrapper translates content
// via JS (GSAP ScrollSmoother, Locomotive, slide-deck builds). Screenshots
// then capture a single screen no matter what. The one thing that always
// works is doing what a human does: scroll, look, repeat — so we screenshot
// viewport by viewport and stitch on a canvas inside the page.

const SCROLL_PROBE_SCRIPT = `(async () => {
  const d = (ms) => new Promise((r) => setTimeout(r, ms));
  window.scrollTo(0, 1e9);
  await d(700);
  const max = Math.round(window.scrollY);
  window.scrollTo(0, 0);
  await d(500);
  return max;
})()`;

// Fixed/sticky bars would repeat in every stitched segment — hide the small
// ones (navs, cookie bars) but never full-viewport wrappers (that's where
// the content lives on transform-scroll sites).
const STITCH_HIDE_BARS_SCRIPT = `(() => {
  let n = 0;
  for (const el of document.querySelectorAll('header, nav, div, aside')) {
    const cs = getComputedStyle(el);
    if ((cs.position === 'fixed' || cs.position === 'sticky') && el.getBoundingClientRect().height < innerHeight * 0.4) {
      el.setAttribute('data-reelworks-hide', '');
      n++;
      if (n > 60) break;
    }
  }
  const st = document.createElement('style');
  st.textContent = '[data-reelworks-hide]{visibility:hidden !important}';
  document.head.appendChild(st);
  return n;
})()`;

async function scrollStitch(
  page: Page,
  imageFile: string,
  opts: Required<CaptureOptions>,
): Promise<{ ok: boolean; sections: PageSection[] }> {
  const fail = { ok: false, sections: [] as PageSection[] };
  // Never assume the viewport height — screenshots are exactly innerHeight
  // tall, and a wrong segment step leaves bands between segments.
  const vh = Number(await page.evaluate('window.innerHeight')) || 900;
  const maxScroll = Number(await page.evaluate(SCROLL_PROBE_SCRIPT));
  if (!Number.isFinite(maxScroll) || maxScroll < vh * 0.5) return fail;

  const totalCss = Math.min(maxScroll + vh, opts.maxHeight);
  const dsf = opts.deviceScaleFactor;
  const ys: number[] = [];
  for (let y = 0; y < totalCss - vh; y += vh) ys.push(y);
  ys.push(totalCss - vh);

  log(`  stitch: document doesn't scroll but content does (${maxScroll}px range) — capturing ${ys.length} segments`);
  await page.evaluate(
    `(window.__rwCanvas = Object.assign(document.createElement('canvas'), { width: ${Math.round(
      opts.width * dsf,
    )}, height: ${Math.round(totalCss * dsf)} }), window.__rwCtx = window.__rwCanvas.getContext('2d'), true)`,
  );

  // Detect sections at each stop: on-screen position + scroll offset maps
  // exactly onto the stitched image, even for transform-scroll sites.
  const sections: PageSection[] = [];
  const collect = async (y: number) => {
    try {
      const found = JSON.parse(String(await page.evaluate(SECTIONS_IN_VIEW_SCRIPT))) as Array<{
        top: number;
        h: number;
        kind: PageSection['kind'];
      }>;
      for (const s of found) {
        const abs = y + s.top;
        if (abs < 0) continue;
        // The same element shows up in adjacent segments at shifted offsets —
        // dedupe harder within a kind.
        if (
          sections.some(
            (e) => Math.abs(e.y - abs) < 350 || (e.kind === s.kind && Math.abs(e.y - abs) < 700),
          )
        ) {
          continue;
        }
        sections.push({ y: abs, h: s.h, kind: s.kind });
      }
    } catch {
      /* section detection is a nice-to-have */
    }
  };

  for (let i = 0; i < ys.length; i++) {
    await page.evaluate(`(async () => { window.scrollTo(0, ${ys[i]}); await new Promise((r) => setTimeout(r, 650)); return true; })()`);
    if (i === 1) {
      // after the first segment, hide repeating fixed bars
      await page.evaluate(STITCH_HIDE_BARS_SCRIPT).catch(() => {});
      await page.waitForTimeout(120);
    }
    await collect(ys[i]);
    const shot = await page.screenshot({ type: 'jpeg', quality: 88, timeout: 30_000 });
    await page.evaluate(
      `(async () => {
        const img = new Image();
        img.src = "data:image/jpeg;base64,${shot.toString('base64')}";
        await img.decode();
        window.__rwCtx.drawImage(img, 0, ${Math.round(ys[i] * dsf)});
        return true;
      })()`,
    );
  }

  const dataUrl = String(await page.evaluate(`window.__rwCanvas.toDataURL('image/jpeg', 0.86)`));
  if (!dataUrl.startsWith('data:image/jpeg;base64,')) return fail;
  fs.writeFileSync(imageFile, Buffer.from(dataUrl.slice('data:image/jpeg;base64,'.length), 'base64'));
  sections.sort((a, b) => a.y - b.y);
  return { ok: true, sections: sections.slice(0, 6) };
}

async function dismissCookieBanners(page: Page): Promise<void> {
  const attempts = [
    '#onetrust-accept-btn-handler',
    '[id*="accept" i][id*="cookie" i]',
    'button:has-text("Accept all")',
    'button:has-text("Accept")',
    'button:has-text("I agree")',
    'button:has-text("Allow all")',
    '[class*="cookie" i] button',
  ];
  for (const sel of attempts) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible()) {
        await el.click({ timeout: 800 });
        log(`dismissed cookie banner via ${sel}`);
        await page.waitForTimeout(400);
        return;
      }
    } catch {
      /* not this one — keep trying */
    }
  }
}

// Discount/newsletter popups (Klaviyo etc.) photobomb captures. Escape
// closes most of them; otherwise click the usual close buttons.
async function dismissOverlays(page: Page): Promise<void> {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(250);
  const closers = [
    '.klaviyo-close-form',
    '[aria-label*="close" i]',
    '[class*="modal" i] [class*="close" i]',
    '[class*="popup" i] [class*="close" i]',
    '[id*="popup" i] [class*="close" i]',
    '[class*="overlay" i] [class*="close" i]',
  ];
  for (const sel of closers) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible()) {
        await el.click({ timeout: 800 });
        log(`dismissed overlay via ${sel}`);
        await page.waitForTimeout(300);
        return;
      }
    } catch {
      /* not this one */
    }
  }
}

/**
 * Load a URL in headless Chromium, settle the page (fonts, lazy images,
 * scroll-reveal animations, cookie banners), save a sharp full-page
 * screenshot, and detect page sections so the renderer can plan camera moves.
 *
 * Every step is individually time-boxed and logged; optional steps degrade
 * gracefully. Heavy pages that crash or stall retry once in a lite profile.
 */
export async function captureSite(
  url: string,
  outDir: string,
  options: CaptureOptions = {},
): Promise<CaptureMeta> {
  try {
    return await attemptCapture(url, outDir, { ...DEFAULTS, ...options });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/crashed|closed|disconnected|watchdog/i.test(msg)) {
      throw err;
    }
    log(`capture failed on ${url} (${msg.slice(0, 80)}) — retrying in lite mode (no WebGL, 1x)`);
    return attemptCapture(url, outDir, {
      ...DEFAULTS,
      ...options,
      deviceScaleFactor: 1,
      maxHeight: 6000,
      watchdogMs: 100_000,
      webgl: false,
    });
  }
}

async function attemptCapture(
  url: string,
  outDir: string,
  opts: Required<CaptureOptions>,
): Promise<CaptureMeta> {
  ensureDir(outDir);

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
    // --disable-dev-shm-usage: containers cap /dev/shm at 64MB; heavy pages
    // crash the renderer without it. --disable-gpu alone kills WebGL (blank
    // three.js canvases in captures) — the SwiftShader flags restore
    // software-rendered WebGL (verified in headless testing).
    args: [
      '--disable-dev-shm-usage',
      '--disable-gpu',
      ...(opts.webgl ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : []),
    ],
  });

  try {
    const work = captureWork(url, outDir, opts, browser);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watchdog = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `capture watchdog: ${url} took longer than ${Math.round(opts.watchdogMs / 1000)}s (frozen tab?)`,
            ),
          ),
        opts.watchdogMs,
      );
    });
    try {
      return await Promise.race([work, watchdog]);
    } finally {
      clearTimeout(timer);
      // If the watchdog fired, the abandoned work promise will reject once we
      // close the browser — don't let that become an unhandled rejection.
      work.catch(() => {});
    }
  } finally {
    await browser.close();
  }
}

async function captureWork(
  url: string,
  outDir: string,
  opts: Required<CaptureOptions>,
  browser: Awaited<ReturnType<typeof chromium.launch>>,
): Promise<CaptureMeta> {
  const context = await browser.newContext({
    viewport: { width: opts.width, height: 900 },
    deviceScaleFactor: opts.deviceScaleFactor,
    ignoreHTTPSErrors: true,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });

  // Background/autoplay videos eat hundreds of MB of tab memory and never
  // appear in a still capture. A RegExp route only intercepts matching URLs —
  // routing '**/*' would slow every request on a heavy page.
  await context.route(/\.(mp4|webm|m3u8|mov|ts)(\?|#|$)/i, (route) => route.abort());

  // Must be registered before the page loads so it patches canvas creation
  // ahead of any site script.
  await context.addInitScript(PRESERVE_WEBGL_INIT);

  const page = await context.newPage();
  page.setDefaultTimeout(15_000);

  // Time-boxed step runner: optional work can be slow or stuck on hostile
  // pages; log how long each step took and move on when the budget is spent.
  const step = async <T>(name: string, ms: number, fn: () => Promise<T>, fallback: T): Promise<T> => {
    const s0 = Date.now();
    try {
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`step '${name}' hit its ${ms / 1000}s budget`)), ms),
        ),
      ]);
      log(`  ${name}: ${((Date.now() - s0) / 1000).toFixed(1)}s`);
      return result;
    } catch (err) {
      const detail = err instanceof Error ? err.message.split('\n')[0].slice(0, 90) : String(err);
      // A dead tab/browser means nothing later can succeed — fail the attempt
      // now so the lite retry kicks in, instead of limping to the screenshot.
      if (/crashed|closed|disconnected/i.test(detail)) throw err;
      log(`  ${name}: skipped after ${((Date.now() - s0) / 1000).toFixed(1)}s (${detail})`);
      return fallback;
    }
  };

  const t0 = Date.now();
  log(`loading ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs });
  await step('settle network', 9_000, () => page.waitForLoadState('networkidle', { timeout: 8_000 }), undefined);
  await step('cookie banners', 10_000, () => dismissCookieBanners(page), undefined);
  await step('marketing popups', 8_000, () => dismissOverlays(page), undefined);
  await step('web fonts', 6_000, () => page.evaluate(FONTS_SCRIPT), undefined);
  const eager = await step('force lazy media', 6_000, async () => Number(await page.evaluate(FORCE_LAZY_SCRIPT)), 0);
  if (eager > 0) log(`  forced ${eager} lazy image(s)/background(s) eager`);
  const scrollerInfo = await step(
    'find real scroller',
    10_000,
    async () => String(await page.evaluate(EXPAND_SCROLLER_SCRIPT)),
    'skipped',
  );
  log(`  ${scrollerInfo}`);

  // Scroll through the page so lazy-loaded content and scroll-triggered
  // animations fire, then return to the top. Iteration-capped so infinite
  // scroll pages terminate.
  await step(
    'scroll-through',
    22_000,
    () =>
      page.evaluate(
        `(async () => {
          const delay = (ms) => new Promise((r) => setTimeout(r, ms));
          const pageH = () => (document.scrollingElement || document.body).scrollHeight;
          let y = 0;
          for (let i = 0; i < 14 && y < ${opts.maxHeight}; i++) {
            y += 650;
            window.scrollTo(0, Math.min(y, pageH()));
            await delay(130);
            if (y >= pageH()) break;
          }
          window.scrollTo(0, 0);
          await delay(400);
        })()`,
      ),
    undefined,
  );

  // Second pass: some lazyload libraries only rewrite attributes on scroll.
  await step('force lazy media (2nd pass)', 5_000, () => page.evaluate(FORCE_LAZY_SCRIPT), undefined);
  // Popups often re-open on scroll or exit-intent — one more sweep.
  await step('marketing popups (2nd pass)', 6_000, () => dismissOverlays(page), undefined);

  const revealed = await step('reveal hidden content', 10_000, async () => Number(await page.evaluate(REVEAL_SCRIPT)), 0);
  if (revealed > 0) log(`  forced ${revealed} scroll-reveal element(s) visible`);

  const frozen = await step('freeze canvases', 8_000, async () => String(await page.evaluate(CANVAS_FREEZE_SCRIPT)), 'skipped');
  log(`  ${frozen}`);
  await step('image decode', 8_000, () => page.evaluate(DECODE_SCRIPT), undefined);
  await page.waitForTimeout(500);

  const sections = await step(
    'detect sections',
    10_000,
    async () => JSON.parse(String(await page.evaluate(SECTIONS_SCRIPT))) as PageSection[],
    [],
  );

  // Fallback pushes us into the (always safe) clip branch below.
  const pageHeight = await step(
    'measure page height',
    8_000,
    async () =>
      Number(await page.evaluate('(document.scrollingElement || document.body).scrollHeight')),
    opts.maxHeight + 1,
  );
  const cssHeightGuess = Math.min(Math.max(pageHeight, 900), opts.maxHeight);
  const title = await step('read title', 5_000, () => page.title(), '');

  const imageFile = path.join(outDir, 'site.jpg');
  // Always clip, never fullPage: fullPage may resize the viewport internally,
  // which clears WebGL canvases before they can redraw. A clip larger than
  // the viewport captures beyond it without any resize (verified via CDP).
  const shoot = (height: number, timeout: number) =>
    page.screenshot({
      path: imageFile,
      type: 'jpeg',
      quality: 90,
      clip: { x: 0, y: 0, width: opts.width, height },
      timeout,
    });
  try {
    await shoot(cssHeightGuess, 60_000);
  } catch (err) {
    log(`screenshot failed (${err instanceof Error ? err.message.split('\n')[0].slice(0, 80) : err}) — retrying shorter`);
    await shoot(Math.min(cssHeightGuess, 3500), 45_000);
  }

  // THE source of truth: what's actually in the file. DOM-reported heights
  // lie on animated/parallax sites, and trusting them made the camera
  // scroll past the end of the image into blank space.
  let dims = jpegDimensions(imageFile);
  if (!dims) throw new Error(`Could not read dimensions of capture ${imageFile}`);
  let trueCssHeight = Math.round(dims.height / (dims.width / opts.width));
  let stitched = false;

  // One-viewport capture on a page whose content actually scrolls? That's a
  // transform-scroll site — fall back to scroll-and-stitch.
  if (trueCssHeight <= 1125) {
    const stitch = await step('stitch capture', 120_000, () => scrollStitch(page, imageFile, opts), {
      ok: false,
      sections: [],
    });
    if (stitch.ok) {
      stitched = true;
      dims = jpegDimensions(imageFile) ?? dims;
      trueCssHeight = Math.round(dims.height / (dims.width / opts.width));
      // Replace DOM-space sections with the ones measured on-screen during
      // the stitch — those map exactly onto the stitched image.
      sections.length = 0;
      sections.push(...stitch.sections);
      log(`  stitch found ${stitch.sections.length} section(s) on-screen`);
    }
  }

  const meta: CaptureMeta = {
    url,
    title,
    cssWidth: opts.width,
    cssHeight: trueCssHeight,
    imageWidth: dims.width,
    imageHeight: dims.height,
    deviceScaleFactor: opts.deviceScaleFactor,
    mode: opts.webgl ? 'full' : 'lite',
    // Drop sections the screenshot doesn't actually cover.
    sections: sections.filter((s) => s.y < trueCssHeight - 200),
    imageFile,
    capturedAt: new Date().toISOString(),
  };
  writeJson(path.join(outDir, 'meta.json'), meta);
  log(
    `captured ${url} -> ${dims.width}x${dims.height}px in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${meta.sections.length} section(s)`,
  );
  return meta;
}

// --- live scroll video ------------------------------------------------------
// Records the compositor's actual output while a scripted smooth scroll runs.
// This captures EVERYTHING a human sees — WebGL scenes, scroll animations,
// videos, canvas-in-worker rendering — with zero readback tricks, because it
// never asks the page for pixels; the browser's own frame stream is recorded.

const SPEED_PX_PER_SEC: Record<'slow' | 'medium' | 'fast', number> = {
  slow: 300,
  medium: 430,
  fast: 620,
};

const execFileP = promisify(execFile);

/**
 * Playwright's webm has sparse keyframes, so seeking N seconds in (which the
 * renderer does constantly) can force a linear decode from zero and blow
 * Remotion's frame timeout. Re-encode with a keyframe every second — flags
 * verified against Playwright's own ffmpeg build. Keeps the original on any
 * failure.
 */
async function makeSeekable(file: string): Promise<void> {
  const ffmpeg = findPlaywrightFfmpeg();
  if (!ffmpeg) {
    log('  ffmpeg not found — recording keeps sparse keyframes');
    return;
  }
  const tmp = `${file}.seekable.webm`;
  try {
    await execFileP(
      ffmpeg,
      ['-y', '-i', file, '-c:v', 'vp8', '-b:v', '5M', '-g', '25', '-deadline', 'realtime', '-cpu-used', '5', '-an', tmp],
      { timeout: 120_000 },
    );
    const size = fs.statSync(tmp).size;
    if (size > 10_000) {
      fs.renameSync(tmp, file);
      log('  re-encoded recording for fast seeking');
      return;
    }
    throw new Error(`suspiciously small output (${size}B)`);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    log(`  seekable re-encode skipped (${err instanceof Error ? err.message.split('\n')[0].slice(0, 70) : err})`);
  }
}

/**
 * Record a webm of the page smoothly scrolling top to bottom at constant
 * velocity. Returns timing info the renderer needs to trim the setup phase
 * and map page positions to video timestamps. Returns null on failure —
 * callers fall back to the still capture.
 */
export async function recordScrollVideo(
  url: string,
  outDir: string,
  scrollSpeed: 'slow' | 'medium' | 'fast' = 'medium',
  options: CaptureOptions = {},
): Promise<ScrollVideoInfo | null> {
  const opts = { ...DEFAULTS, ...options };
  const pxPerSec = SPEED_PX_PER_SEC[scrollSpeed];
  ensureDir(outDir);
  // Never let a failed re-record leave a stale recording behind — the
  // renderer would pair it with fresh sections/meta from a different run.
  for (const stale of ['video.json', 'scroll.webm']) {
    fs.rmSync(path.join(outDir, stale), { force: true });
  }

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
    args: [
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  });

  const attempt = async (mode: 'screencast' | 'legacy', budgetMs: number) => {
    const work = recordWork(url, outDir, opts, pxPerSec, browser, mode);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watchdog = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`video watchdog (${mode}): ${url} exceeded ${budgetMs / 1000}s`)),
        budgetMs,
      );
    });
    try {
      return await Promise.race([work, watchdog]);
    } finally {
      clearTimeout(timer);
      work.catch(() => {});
    }
  };

  const brief = (e: unknown) => (e instanceof Error ? e.message.split('\n')[0].slice(0, 90) : String(e));
  try {
    // 60fps compositor screencast first; Playwright's 25fps recorder as backup.
    return await attempt('screencast', 220_000);
  } catch (e1) {
    log(`screencast recording failed (${brief(e1)}) — falling back to standard recorder`);
    try {
      return await attempt('legacy', 160_000);
    } catch (e2) {
      log(`scroll video failed for ${url} (${brief(e2)}) — reel falls back to stills`);
      return null;
    }
  } finally {
    await browser.close();
  }
}

async function recordWork(
  url: string,
  outDir: string,
  opts: Required<CaptureOptions>,
  pxPerSec: number,
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  mode: 'screencast' | 'legacy',
): Promise<ScrollVideoInfo | null> {
  // Portrait viewport: the browser frame in a 9:16 reel should be TALL.
  // 1600 wide matches how designs look on a real desktop — at 1440, sites
  // tuned for wider screens crop their hero art at the right edge.
  const VIEW_W = 1600;
  const VIEW_H = 2000;
  const context = await browser.newContext({
    viewport: { width: VIEW_W, height: VIEW_H },
    deviceScaleFactor: 1,
    ignoreHTTPSErrors: true,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    // The legacy path records via Playwright's built-in 25fps recorder; the
    // screencast path streams compositor frames itself at up to 60fps.
    ...(mode === 'legacy'
      ? { recordVideo: { dir: outDir, size: { width: VIEW_W, height: VIEW_H } } }
      : {}),
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  // The recording starts when the page exists — measure prep from here so
  // startFrom trims exactly the setup, not imaginary context-creation time.
  const t0 = Date.now();

  try {
    log(`recording ${url} (${pxPerSec}px/s tour)`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs });
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    await dismissCookieBanners(page);
    await dismissOverlays(page);
    await page.evaluate(FONTS_SCRIPT).catch(() => {});
    await page.evaluate(FORCE_LAZY_SCRIPT).catch(() => {});

    // Warm the page (lazy content, scroll-reveal animations) with a quick
    // pass, then return to the top. This is part of the trimmed prep phase.
    const maxScroll = Number(await page.evaluate(SCROLL_PROBE_SCRIPT));
    if (!Number.isFinite(maxScroll) || maxScroll < 200) {
      log(`  page barely scrolls (${maxScroll}px) — skipping video`);
      await context.close();
      const v = page.video();
      if (v) await v.delete().catch(() => {});
      return null;
    }
    await page.evaluate(`document.head.appendChild(Object.assign(document.createElement('style'), { textContent: '::-webkit-scrollbar{display:none!important} html{scrollbar-width:none!important}' })), true`);
    await page.waitForTimeout(300);

    // Detect sections in THIS viewport (positions shift with viewport height
    // on vh-based layouts) to plan the tour: glide to a section, settle,
    // dwell while the renderer pushes in, glide on — the Screen Studio
    // rhythm, not a conveyor belt.
    let tourSections: PageSection[] = [];
    try {
      tourSections = JSON.parse(String(await page.evaluate(SECTIONS_SCRIPT)));
    } catch {
      /* tour degrades to a single glide */
    }
    // The tour has its own budget — don't inherit the still-capture height
    // cap, or long pages stop short of the footer.
    const target = Math.min(maxScroll, 14_000);
    const clampY = (y: number) => Math.min(Math.max(y, 0), target);

    let waypoints = tourSections
      .map((s) => ({ y: clampY(s.y + Math.min(s.h, VIEW_H * 0.7) / 2 - VIEW_H * 0.42), kind: s.kind }))
      .filter((w) => w.y > 250)
      .sort((a, b) => a.y - b.y)
      .filter((w, i, arr) => i === 0 || w.y - arr[i - 1].y > 600)
      .slice(0, 4);

    // Build the tour timeline (Node side, deterministic) and the in-page
    // script together, trimming dwells until it fits the time budget.
    const DWELL = 1.5;
    const holdSec = 0.9;
    const plan = () => {
      const stops: ScrollVideoInfo['stops'] = [];
      const moves: string[] = [];
      let t = holdSec;
      let cur = 0;
      for (const w of waypoints) {
        const d = Math.min(Math.max((w.y - cur) / pxPerSec, 0.9), 4.5);
        moves.push(`await tween(${Math.round(cur)}, ${Math.round(w.y)}, ${Math.round(d * 1000)});`);
        t += d;
        stops.push({ tSec: t, dwellSec: DWELL, kind: w.kind });
        moves.push(`await hold(${DWELL * 1000});`);
        t += DWELL;
        cur = w.y;
      }
      if (target - cur > 150) {
        const d = Math.min(Math.max((target - cur) / pxPerSec, 1.2), 6.5);
        moves.push(`await tween(${Math.round(cur)}, ${target}, ${Math.round(d * 1000)});`);
        t += d;
      }
      const endHold = Math.max(1.0, 5.6 - t);
      moves.push(`await hold(${Math.round(endHold * 1000)});`);
      t += endHold;
      return { stops, moves, total: t };
    };
    let tour = plan();
    while (tour.total > 30 && waypoints.length > 1) {
      waypoints = waypoints.slice(0, waypoints.length - 1);
      tour = plan();
    }

    const prepSec = (Date.now() - t0) / 1000;
    const tourScript = `(async () => {
        const hold = (ms) => new Promise((r) => setTimeout(r, ms));
        const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
        const tween = (from, to, durMs) => new Promise((done) => {
          const t0 = performance.now();
          const step = (now) => {
            const p = Math.min((now - t0) / durMs, 1);
            window.scrollTo(0, from + (to - from) * ease(p));
            if (p >= 1) done(); else requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        });
        window.scrollTo(0, 0);
        await hold(${Math.round(holdSec * 1000)});
        ${tour.moves.join('\n        ')}
      })()`;

    const file = path.join(outDir, 'scroll.webm');
    let durationSec: number;
    let infoPrepSec: number;

    if (mode === 'screencast') {
      const framesDir = path.join(outDir, 'frames-tmp');
      fs.rmSync(framesDir, { recursive: true, force: true });
      fs.mkdirSync(framesDir, { recursive: true });
      const frames: ScreencastFrame[] = [];
      try {
        const cdp = await context.newCDPSession(page);
        cdp.on('Page.screencastFrame', (ev) => {
          try {
            const frameFile = path.join(framesDir, `f${String(frames.length).padStart(6, '0')}.jpg`);
            fs.writeFileSync(frameFile, Buffer.from(ev.data, 'base64'));
            frames.push({ file: frameFile, t: ev.metadata?.timestamp ?? Date.now() / 1000 });
          } catch {
            /* one dropped frame is fine */
          }
          cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
        });
        await cdp.send('Page.startScreencast', {
          format: 'jpeg',
          quality: 92,
          maxWidth: VIEW_W,
          maxHeight: VIEW_H,
          everyNthFrame: 1,
        });
        await page.evaluate(tourScript);
        await cdp.send('Page.stopScreencast').catch(() => {});
        await page.waitForTimeout(200);
        await context.close();
        // The compositor only emits on change — CFR assembly duplicates
        // frames through the dwells and pads to the planned duration.
        durationSec = await assembleCfrWebm({
          frames,
          outFile: file,
          fps: 60,
          minDurationSec: tour.total,
          bitrate: '8M',
        });
        // Screencast starts at the tour itself — nothing to trim.
        infoPrepSec = 0;
        log(`  screencast: ${frames.length} frames -> ${durationSec.toFixed(1)}s @60fps CFR`);
      } finally {
        fs.rmSync(framesDir, { recursive: true, force: true });
      }
    } else {
      await page.evaluate(tourScript);
      const video = page.video();
      await context.close(); // finalizes the recording
      if (!video) return null;
      await video.saveAs(file);
      await video.delete().catch(() => {});
      await makeSeekable(file);
      durationSec = tour.total;
      infoPrepSec = prepSec;
    }

    const info: ScrollVideoInfo = {
      file,
      prepSec: infoPrepSec,
      viewportW: VIEW_W,
      viewportH: VIEW_H,
      durationSec,
      stops: tour.stops,
    };
    writeJson(path.join(outDir, 'video.json'), info);
    log(
      `  recorded ${info.durationSec.toFixed(1)}s tour (${mode}, ${tour.stops.length} dwell(s), ${target}px)`,
    );
    return info;
  } catch (err) {
    await context.close().catch(() => {});
    // Don't leave the raw random-named webm behind on failure (legacy mode).
    await page.video()?.delete().catch(() => {});
    throw err;
  }
}
