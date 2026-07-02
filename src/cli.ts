import 'dotenv/config';
import path from 'node:path';
import { Command } from 'commander';
import { captureSite } from './capture';
import { defaultCaption, postVideo, type PostVia } from './post/index';
import { renderReel } from './render';
import { ensureDir, log, slugify } from './util';

const program = new Command()
  .name('reelworks')
  .description('URL in → before/after reel out → posted to Facebook');

program
  .command('capture')
  .description('Capture a full-page screenshot + metadata for one URL')
  .requiredOption('--url <url>', 'website to capture')
  .option('--out <dir>', 'output directory', 'out/capture')
  .option('--width <px>', 'viewport width', '1440')
  .option('--max-height <px>', 'cap on captured page height', '6500')
  .action(async (o) => {
    await captureSite(o.url, o.out, {
      width: Number(o.width),
      maxHeight: Number(o.maxHeight),
    });
  });

program
  .command('render')
  .description('Render a reel from two existing captures')
  .requiredOption('--before <dir>', 'capture dir of the old site')
  .requiredOption('--after <dir>', 'capture dir of the new site')
  .requiredOption('--client <name>', 'client name shown in the video')
  .option('--headline <text>', 'hook line')
  .option('--brand <name>', 'your agency name')
  .option('--cta <text>', 'end-card call to action')
  .option('--accent <color>', 'accent color, e.g. #22d3ee')
  .option('--music <path>', 'audio file (public/-relative or URL)')
  .option('--out <file>', 'output mp4', 'out/reel.mp4')
  .option('--scale <n>', 'render scale for fast previews, e.g. 0.5')
  .action(async (o) => {
    await renderReel({
      beforeDir: o.before,
      afterDir: o.after,
      outPath: o.out,
      clientName: o.client,
      headline: o.headline,
      brandName: o.brand,
      cta: o.cta,
      accentColor: o.accent,
      musicSrc: o.music ?? null,
      scale: o.scale ? Number(o.scale) : undefined,
    });
  });

program
  .command('post')
  .description('Post an existing mp4 to Facebook (or hand it to Make)')
  .requiredOption('--video <file>', 'mp4 to post')
  .requiredOption('--caption <text>', 'post caption')
  .option('--client <name>', 'client name (forwarded to Make)', '')
  .option('--via <via>', 'facebook | reel | make', 'reel')
  .action(async (o) => {
    await postVideo(o.via as PostVia, o.video, o.caption, o.client);
  });

program
  .command('run')
  .description('Full pipeline: capture both sites, render the reel, optionally post it')
  .requiredOption('--before <url>', 'URL of the old site (or archive.org snapshot)')
  .requiredOption('--after <url>', 'URL of the new site')
  .requiredOption('--client <name>', 'client name shown in the video')
  .option('--headline <text>', 'hook line')
  .option('--brand <name>', 'your agency name')
  .option('--cta <text>', 'end-card call to action')
  .option('--accent <color>', 'accent color')
  .option('--music <path>', 'audio file (public/-relative or URL)')
  .option('--caption <text>', 'Facebook caption (defaults to headline + CTA)')
  .option('--post <via>', 'post after rendering: facebook | reel | make')
  .option('--out <dir>', 'job output directory (default: out/<client>-<date>)')
  .option('--scale <n>', 'render scale for fast previews')
  .action(async (o) => {
    const stamp = new Date().toISOString().slice(0, 10);
    const jobDir = ensureDir(o.out ?? path.join('out', `${slugify(o.client)}-${stamp}`));
    const beforeDir = path.join(jobDir, 'before');
    const afterDir = path.join(jobDir, 'after');

    await captureSite(o.before, beforeDir);
    await captureSite(o.after, afterDir);

    const outPath = path.join(jobDir, 'reel.mp4');
    await renderReel({
      beforeDir,
      afterDir,
      outPath,
      clientName: o.client,
      headline: o.headline,
      brandName: o.brand,
      cta: o.cta,
      accentColor: o.accent,
      musicSrc: o.music ?? null,
      scale: o.scale ? Number(o.scale) : undefined,
    });

    if (o.post) {
      const caption =
        o.caption ?? defaultCaption({ headline: o.headline, clientName: o.client, cta: o.cta });
      await postVideo(o.post as PostVia, outPath, caption, o.client);
    } else {
      log(`done — reel at ${outPath} (re-run with --post reel to publish)`);
    }
  });

program.parseAsync().catch((err) => {
  console.error(`\n[reelworks] error: ${err.message}`);
  process.exit(1);
});
