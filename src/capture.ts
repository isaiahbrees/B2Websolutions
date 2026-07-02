import path from 'node:path';
import { chromium } from 'playwright';
import type { CaptureMeta } from './types';
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
  deviceScaleFactor: 1.5,
  timeoutMs: 45_000,
};

/**
 * Load a URL in headless Chromium, trigger lazy-loaded content by scrolling
 * through the page, then save a full-page screenshot + metadata that the
 * Remotion template uses to animate a scroll-through with zooms.
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
    // Corporate/agency proxies with TLS interception are common; a capture
    // rig has no secrets to protect, so favor "it captures" over strictness.
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

    // Scroll through the page so lazy-loaded images and animations fire,
    // then return to the top for the screenshot.
    await page.evaluate(async (maxHeight) => {
      const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const step = 700;
      const limit = Math.min(document.body.scrollHeight, maxHeight);
      for (let y = 0; y < limit; y += step) {
        window.scrollTo(0, y);
        await delay(120);
      }
      window.scrollTo(0, 0);
      await delay(400);
    }, opts.maxHeight);

    // Best effort: wait for images near the top to actually decode.
    await page
      .evaluate(() =>
        Promise.allSettled(
          Array.from(document.images)
            .slice(0, 30)
            .map((img) => img.decode()),
        ),
      )
      .catch(() => {});
    await page.waitForTimeout(500);

    const pageHeight: number = await page.evaluate(() => document.body.scrollHeight);
    const cssHeight = Math.min(Math.max(pageHeight, 900), opts.maxHeight);
    const title = await page.title();

    const imageFile = path.join(outDir, 'site.jpg');
    if (pageHeight <= opts.maxHeight) {
      await page.screenshot({ path: imageFile, type: 'jpeg', quality: 82, fullPage: true });
    } else {
      // Page is taller than we want in the video — capture only the top part.
      await page.screenshot({
        path: imageFile,
        type: 'jpeg',
        quality: 82,
        clip: { x: 0, y: 0, width: opts.width, height: cssHeight },
      });
    }

    const meta: CaptureMeta = {
      url,
      title,
      cssWidth: opts.width,
      cssHeight,
      deviceScaleFactor: opts.deviceScaleFactor,
      imageFile,
      capturedAt: new Date().toISOString(),
    };
    writeJson(path.join(outDir, 'meta.json'), meta);
    log(`captured ${url} -> ${imageFile} (${opts.width}x${cssHeight} css px)`);
    return meta;
  } finally {
    await browser.close();
  }
}
