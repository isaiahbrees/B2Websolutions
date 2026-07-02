import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import type { CaptureMeta, PageSection } from './types';
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
  maxHeight: 6500,
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
    ' scroll-behavior: auto !important; }';
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

// WebGL canvases (three.js scenes) come out blank in screenshots: their
// buffer is only readable inside the page's own rAF callback, and viewport
// changes clear it. Snapshot each canvas at exactly that moment and swap in
// a plain <img> — any screenshot method then captures it (proven in testing).
const CANVAS_FREEZE_SCRIPT = `new Promise((done) => {
  const canvases = Array.from(document.querySelectorAll('canvas')).filter((c) => c.clientWidth > 50 && c.clientHeight > 50);
  if (!canvases.length) { done('no canvases'); return; }
  const orig = window.requestAnimationFrame.bind(window);
  let fired = false;
  window.requestAnimationFrame = (cb) => orig((t) => {
    cb(t);
    if (fired) return;
    fired = true;
    let n = 0;
    for (const c of canvases) {
      try {
        const url = c.toDataURL('image/png');
        if (url.length < 2000) continue;
        const img = new Image();
        img.src = url;
        img.style.cssText = 'width:' + c.clientWidth + 'px;height:' + c.clientHeight + 'px;display:block;';
        img.className = c.className;
        c.replaceWith(img);
        n++;
      } catch (e) { /* tainted canvas — leave it live */ }
    }
    done('froze ' + n + ' canvas(es)');
  });
  setTimeout(() => { if (!fired) { fired = true; done('no rAF fired'); } }, 2500);
})`;

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
      maxHeight: 4500,
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
  await step('web fonts', 6_000, () => page.evaluate(FONTS_SCRIPT), undefined);
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
  const shoot = (height: number, timeout: number) =>
    pageHeight <= opts.maxHeight && height >= cssHeightGuess
      ? page.screenshot({ path: imageFile, type: 'jpeg', quality: 90, fullPage: true, timeout })
      : page.screenshot({
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
  const dims = jpegDimensions(imageFile);
  if (!dims) throw new Error(`Could not read dimensions of capture ${imageFile}`);
  const trueCssHeight = Math.round(dims.height / (dims.width / opts.width));

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
