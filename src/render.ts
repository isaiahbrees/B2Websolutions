import fs from 'node:fs';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { defaultReelProps, getSegments, type ReelProps } from './remotion/schema';
import type { CaptureMeta, ScrollVideoInfo } from './types';
import { ensureDir, log, readJson } from './util';

export type ScrollSpeed = 'slow' | 'medium' | 'fast';

export type RenderOptions = {
  beforeDir: string;
  afterDir: string;
  outPath: string;
  /** Template/branding overrides merged over sensible defaults. */
  props?: Partial<ReelProps>;
  scrollSpeed?: ScrollSpeed;
  /** Optional total-duration target in seconds; segments scale to fit. */
  durationTarget?: number | null;
  /** Render at reduced resolution for fast previews, e.g. 0.5 */
  scale?: number;
  onProgress?: (progress: number) => void;
};

// Seconds of screen-time per viewport-height of page to scroll through.
const SPEED: Record<ScrollSpeed, number> = { slow: 3.4, medium: 2.3, fast: 1.5 };

function autoSeconds(meta: CaptureMeta, speed: ScrollSpeed, flavor: 'before' | 'after'): number {
  const viewportCss = 900;
  const screens = Math.max(0, meta.cssHeight / viewportCss - 1);
  const sectionHold = flavor === 'after' ? meta.sections.length * 0.7 : meta.sections.length * 0.35;
  const base = flavor === 'after' ? 5 : 4;
  const s = base + screens * SPEED[speed] + sectionHold;
  return Math.min(Math.max(s, flavor === 'after' ? 7 : 5), flavor === 'after' ? 22 : 14);
}

function readVideoInfo(dir: string): ScrollVideoInfo | null {
  const file = path.join(dir, 'video.json');
  if (!fs.existsSync(file) || !fs.existsSync(path.join(dir, 'scroll.webm'))) return null;
  try {
    return readJson<ScrollVideoInfo>(file);
  } catch {
    return null;
  }
}

function toSiteMeta(meta: CaptureMeta) {
  return {
    width: meta.imageWidth,
    height: meta.imageHeight,
    cssWidth: meta.cssWidth,
    url: meta.url,
    sections: meta.sections ?? [],
  };
}

/**
 * Bundle the Remotion project and render the reel. Captures are copied into
 * public/job/ so the composition can load them via staticFile().
 */
export async function renderReel(opts: RenderOptions): Promise<string> {
  const root = process.cwd();
  const publicDir = path.join(root, 'public');
  const jobDir = ensureDir(path.join(publicDir, 'job'));

  const beforeMeta = readJson<CaptureMeta>(path.join(opts.beforeDir, 'meta.json'));
  const afterMeta = readJson<CaptureMeta>(path.join(opts.afterDir, 'meta.json'));
  fs.copyFileSync(path.join(opts.beforeDir, 'site.jpg'), path.join(jobDir, 'before.jpg'));
  fs.copyFileSync(path.join(opts.afterDir, 'site.jpg'), path.join(jobDir, 'after.jpg'));

  const speed = opts.scrollSpeed ?? 'medium';
  let beforeSeconds = autoSeconds(beforeMeta, speed, 'before');
  let afterSeconds = autoSeconds(afterMeta, speed, 'after');

  // Live scroll recordings take priority: the segment plays the whole video.
  const beforeVideo = readVideoInfo(opts.beforeDir);
  const afterVideo = readVideoInfo(opts.afterDir);
  // Leave headroom at the tail: the Before segment plays flash-overlap frames
  // past its nominal end, and the segment must never outrun the footage.
  if (beforeVideo) {
    fs.copyFileSync(path.join(opts.beforeDir, 'scroll.webm'), path.join(jobDir, 'before.webm'));
    beforeSeconds = Math.min(Math.max(beforeVideo.durationSec - 1.0, 4), 55);
  }
  if (afterVideo) {
    fs.copyFileSync(path.join(opts.afterDir, 'scroll.webm'), path.join(jobDir, 'after.webm'));
    afterSeconds = Math.min(Math.max(afterVideo.durationSec - 0.6, 4), 58);
  }
  log(
    `footage: before=${beforeVideo ? 'live video' : 'still capture'}, after=${afterVideo ? 'live video' : 'still capture'}`,
  );

  const inputProps: ReelProps = {
    ...defaultReelProps,
    ...opts.props,
    beforeImage: 'job/before.jpg',
    afterImage: 'job/after.jpg',
    beforeVideo: beforeVideo ? 'job/before.webm' : null,
    afterVideo: afterVideo ? 'job/after.webm' : null,
    beforeVideoInfo: beforeVideo
      ? {
          prepSec: beforeVideo.prepSec,
          viewportW: beforeVideo.viewportW,
          viewportH: beforeVideo.viewportH,
          durationSec: beforeVideo.durationSec,
          stops: beforeVideo.stops,
        }
      : null,
    afterVideoInfo: afterVideo
      ? {
          prepSec: afterVideo.prepSec,
          viewportW: afterVideo.viewportW,
          viewportH: afterVideo.viewportH,
          durationSec: afterVideo.durationSec,
          stops: afterVideo.stops,
        }
      : null,
    beforeMeta: toSiteMeta(beforeMeta),
    afterMeta: toSiteMeta(afterMeta),
    beforeSeconds,
    afterSeconds,
  };

  if (opts.durationTarget && (beforeVideo || afterVideo)) {
    log('duration target ignored — live recordings play at their recorded length');
  }
  // Fit an exact duration target by scaling the two site segments (still
  // footage only — videos play at their recorded length).
  if (opts.durationTarget && !beforeVideo && !afterVideo) {
    const fixed = getSegments({ ...inputProps, beforeSeconds: 0, afterSeconds: 0 });
    const fixedSeconds = fixed.total / inputProps.fps;
    const budget = Math.max(opts.durationTarget - fixedSeconds, 6);
    const ratio = budget / (beforeSeconds + afterSeconds);
    inputProps.beforeSeconds = Math.max(3, beforeSeconds * ratio);
    inputProps.afterSeconds = Math.max(3, afterSeconds * ratio);
  }

  log('bundling Remotion project…');
  const serveUrl = await bundle({
    entryPoint: path.join(root, 'src/remotion/index.ts'),
    publicDir,
  });

  const composition = await selectComposition({
    serveUrl,
    id: 'BeforeAfterReel',
    inputProps,
    browserExecutable: process.env.REMOTION_CHROME || undefined,
  });

  // Containers report the host's core count; Remotion's default concurrency
  // (cores/2) would open dozens of browser tabs and get OOM-killed.
  const concurrency = Number(process.env.REMOTION_CONCURRENCY || 2);

  ensureDir(path.dirname(path.resolve(opts.outPath)));
  log(
    `rendering ${composition.durationInFrames} frames at ${composition.width}x${composition.height}@${composition.fps}fps…`,
  );
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    // Keep website text crisp: high-quality source frames, low CRF.
    crf: 16,
    jpegQuality: 92,
    x264Preset: 'veryfast',
    outputLocation: opts.outPath,
    inputProps,
    concurrency,
    scale: opts.scale ?? 1,
    // Video-frame extraction on long recordings can legitimately take a
    // while on shared CPUs; don't let the default 30s kill the render.
    timeoutInMilliseconds: 120_000,
    browserExecutable: process.env.REMOTION_CHROME || undefined,
    chromiumOptions: { ignoreCertificateErrors: true },
    onProgress: ({ progress }) => {
      if (opts.onProgress) {
        opts.onProgress(progress);
      } else {
        process.stdout.write(`\r[reelworks] render ${Math.round(progress * 100)}%   `);
      }
    },
  });
  if (!opts.onProgress) process.stdout.write('\n');
  log(`rendered ${opts.outPath}`);
  return opts.outPath;
}
