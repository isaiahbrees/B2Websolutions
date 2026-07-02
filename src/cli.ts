import 'dotenv/config';
import path from 'node:path';
import { Command } from 'commander';
import { captureSite, recordScrollVideo } from './capture';
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

const styleFromFlags = (o: Record<string, string | undefined>) => ({
  clientName: o.client as string,
  ...(o.headline ? { title: o.headline } : {}),
  ...(o.brand ? { brandName: o.brand } : {}),
  ...(o.cta ? { cta: o.cta } : {}),
  ...(o.accent ? { accentColor: o.accent } : {}),
  ...(o.music ? { musicSrc: o.music } : {}),
  ...(o.template ? { template: o.template as 'clean' | 'dark' | 'split' } : {}),
  ...(o.intensity ? { intensity: o.intensity as 'subtle' | 'balanced' | 'cinematic' } : {}),
  ...(o.resolution ? { resolution: o.resolution as '1080' | '2160' } : {}),
});

program
  .command('render')
  .description('Render a reel from two existing captures')
  .requiredOption('--before <dir>', 'capture dir of the old site')
  .requiredOption('--after <dir>', 'capture dir of the new site')
  .requiredOption('--client <name>', 'client name shown in the video')
  .option('--headline <text>', 'intro title')
  .option('--brand <name>', 'your agency name')
  .option('--cta <text>', 'end-card call to action')
  .option('--accent <color>', 'accent color, e.g. #0a84ff')
  .option('--template <t>', 'clean | dark | split')
  .option('--intensity <i>', 'subtle | balanced | cinematic')
  .option('--resolution <r>', '1080 | 2160')
  .option('--speed <s>', 'scroll speed: slow | medium | fast')
  .option('--music <path>', 'audio file (public/-relative or URL)')
  .option('--out <file>', 'output mp4', 'out/reel.mp4')
  .option('--scale <n>', 'render scale for fast previews, e.g. 0.5')
  .action(async (o) => {
    await renderReel({
      beforeDir: o.before,
      afterDir: o.after,
      outPath: o.out,
      props: styleFromFlags(o),
      scrollSpeed: o.speed as 'slow' | 'medium' | 'fast' | undefined,
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
  .option('--headline <text>', 'intro title')
  .option('--brand <name>', 'your agency name')
  .option('--cta <text>', 'end-card call to action')
  .option('--accent <color>', 'accent color')
  .option('--template <t>', 'clean | dark | split')
  .option('--intensity <i>', 'subtle | balanced | cinematic')
  .option('--resolution <r>', '1080 | 2160')
  .option('--speed <s>', 'scroll speed: slow | medium | fast')
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

    const speed = (o.speed as 'slow' | 'medium' | 'fast' | undefined) ?? 'medium';
    await captureSite(o.before, beforeDir);
    await recordScrollVideo(o.before, beforeDir, speed);
    await captureSite(o.after, afterDir);
    await recordScrollVideo(o.after, afterDir, speed);

    const outPath = path.join(jobDir, 'reel.mp4');
    await renderReel({
      beforeDir,
      afterDir,
      outPath,
      props: styleFromFlags(o),
      scrollSpeed: o.speed as 'slow' | 'medium' | 'fast' | undefined,
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
