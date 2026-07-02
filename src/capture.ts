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
};

const DEFAULTS: Required<CaptureOptions> = {
  width: 1440,
  maxHeight: 6500,
  deviceScaleFactor: 2,
  timeoutMs: 45_000,
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
  q('[class*="card" i], [class*="grid" i], [class*="feature" i], [class*="service" i]').slice(0, 2).forEach((el) => add(el, 'cards'));
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
      if (await el.isVisible({ timeout: 300 })) {
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
 */
export async function captureSite(
  url: string,
  outDir: string,
  options: CaptureOptions = {},
): Promise<CaptureMeta> {
  const opts = { ...DEFAULTS, ...options };
  ensureDir(outDir);

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
  });

  try {
    const context = await browser.newContext({
      viewport: { width: opts.width, height: 900 },
      deviceScaleFactor: opts.deviceScaleFactor,
      ignoreHTTPSErrors: true,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    log(`loading ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs });
    await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {
      log('network never went idle (ads/analytics?) — continuing');
    });

    await dismissCookieBanners(page);

    // Wait for web fonts so text isn't captured mid font-swap.
    await page
      .evaluate('Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 4000))])')
      .catch(() => {});

    // Scroll through the page so lazy-loaded content and scroll-triggered
    // animations fire, then return to the top.
    await page.evaluate(
      `(async () => {
        const delay = (ms) => new Promise((r) => setTimeout(r, ms));
        const limit = Math.min(document.body.scrollHeight, ${opts.maxHeight});
        for (let y = 0; y < limit; y += 600) {
          window.scrollTo(0, y);
          await delay(140);
        }
        window.scrollTo(0, 0);
        await delay(500);
      })()`,
    );

    // Freeze animations + force scroll-revealed content visible, so sections
    // that only appear "in view" aren't blank in the screenshot.
    const revealed = Number(await page.evaluate(REVEAL_SCRIPT).catch(() => 0));
    if (revealed > 0) log(`forced ${revealed} scroll-reveal element(s) visible`);

    // Best effort: wait for images to actually decode.
    await page
      .evaluate(
        `Promise.allSettled(
          Array.from(document.images).slice(0, 60).map((img) => img.decode())
        )`,
      )
      .catch(() => {});
    await page.waitForTimeout(600);

    // Detect sections for the smart camera plan.
    let sections: PageSection[] = [];
    try {
      sections = JSON.parse(String(await page.evaluate(SECTIONS_SCRIPT)));
    } catch {
      log('section detection failed — falling back to plain scroll');
    }

    const pageHeight = Number(await page.evaluate('document.body.scrollHeight'));
    const cssHeightGuess = Math.min(Math.max(pageHeight, 900), opts.maxHeight);
    const title = await page.title();

    const imageFile = path.join(outDir, 'site.jpg');
    if (pageHeight <= opts.maxHeight) {
      await page.screenshot({ path: imageFile, type: 'jpeg', quality: 90, fullPage: true });
    } else {
      await page.screenshot({
        path: imageFile,
        type: 'jpeg',
        quality: 90,
        clip: { x: 0, y: 0, width: opts.width, height: cssHeightGuess },
      });
    }

    // THE source of truth: what's actually in the file. DOM-reported heights
    // lie on animated/parallax sites, and trusting them made the camera
    // scroll past the end of the image into blank space.
    const dims = jpegDimensions(imageFile);
    if (!dims) throw new Error(`Could not read dimensions of capture ${imageFile}`);
    const trueCssHeight = Math.round(dims.height / (dims.width / opts.width));

    // Drop sections the screenshot doesn't actually cover.
    sections = sections.filter((s) => s.y < trueCssHeight - 200);

    const meta: CaptureMeta = {
      url,
      title,
      cssWidth: opts.width,
      cssHeight: trueCssHeight,
      imageWidth: dims.width,
      imageHeight: dims.height,
      deviceScaleFactor: opts.deviceScaleFactor,
      sections,
      imageFile,
      capturedAt: new Date().toISOString(),
    };
    writeJson(path.join(outDir, 'meta.json'), meta);
    log(
      `captured ${url} -> ${dims.width}x${dims.height}px (${opts.width}x${trueCssHeight} css), ${sections.length} section(s) detected`,
    );
    return meta;
  } finally {
    await browser.close();
  }
}
