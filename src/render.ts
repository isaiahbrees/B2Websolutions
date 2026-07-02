import fs from 'node:fs';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import type { CaptureMeta, ReelInputProps } from './types';
import { ensureDir, log, readJson } from './util';

export type RenderOptions = {
  beforeDir: string;
  afterDir: string;
  outPath: string;
  clientName: string;
  headline?: string;
  brandName?: string;
  cta?: string;
  accentColor?: string;
  musicSrc?: string | null;
  beforeSeconds?: number;
  afterSeconds?: number;
  /** Render at reduced resolution for fast previews, e.g. 0.5 */
  scale?: number;
};

/**
 * Bundle the Remotion project and render the before/after reel.
 * Captured screenshots are copied into public/job/ so the composition can
 * load them via staticFile().
 */
export async function renderReel(opts: RenderOptions): Promise<string> {
  const root = process.cwd();
  const publicDir = path.join(root, 'public');
  const jobDir = ensureDir(path.join(publicDir, 'job'));

  const beforeMeta = readJson<CaptureMeta>(path.join(opts.beforeDir, 'meta.json'));
  const afterMeta = readJson<CaptureMeta>(path.join(opts.afterDir, 'meta.json'));
  fs.copyFileSync(path.join(opts.beforeDir, 'site.jpg'), path.join(jobDir, 'before.jpg'));
  fs.copyFileSync(path.join(opts.afterDir, 'site.jpg'), path.join(jobDir, 'after.jpg'));

  const inputProps: ReelInputProps = {
    clientName: opts.clientName,
    headline: opts.headline ?? 'This website was costing them customers.',
    beforeImage: 'job/before.jpg',
    afterImage: 'job/after.jpg',
    beforeMeta: {
      width: beforeMeta.cssWidth,
      height: beforeMeta.cssHeight,
      url: beforeMeta.url,
    },
    afterMeta: {
      width: afterMeta.cssWidth,
      height: afterMeta.cssHeight,
      url: afterMeta.url,
    },
    beforeSeconds: opts.beforeSeconds ?? 8,
    afterSeconds: opts.afterSeconds ?? 11,
    brandName: opts.brandName ?? 'B2 Web Solutions',
    cta: opts.cta ?? 'Want a site that converts? DM us "WEBSITE"',
    accentColor: opts.accentColor ?? '#22d3ee',
    musicSrc: opts.musicSrc ?? null,
  };

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

  ensureDir(path.dirname(path.resolve(opts.outPath)));
  log(`rendering ${composition.durationInFrames} frames at ${composition.width}x${composition.height}…`);
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: opts.outPath,
    inputProps,
    scale: opts.scale ?? 1,
    browserExecutable: process.env.REMOTION_CHROME || undefined,
    chromiumOptions: { ignoreCertificateErrors: true },
    onProgress: ({ progress }) => {
      if (Math.round(progress * 100) % 10 === 0) {
        process.stdout.write(`\r[reelworks] render ${Math.round(progress * 100)}%   `);
      }
    },
  });
  process.stdout.write('\n');
  log(`rendered ${opts.outPath}`);
  return opts.outPath;
}
