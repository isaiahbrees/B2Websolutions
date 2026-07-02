import { z } from 'zod';

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

export const siteMeta = z.object({
  width: z.number(),
  height: z.number(),
  url: z.string(),
});

export const reelSchema = z.object({
  clientName: z.string(),
  headline: z.string(),
  beforeImage: z.string().describe('staticFile()-relative path or http URL'),
  afterImage: z.string(),
  beforeMeta: siteMeta,
  afterMeta: siteMeta,
  beforeSeconds: z.number().min(3).max(30),
  afterSeconds: z.number().min(3).max(30),
  brandName: z.string(),
  cta: z.string(),
  accentColor: z.string(),
  musicSrc: z.string().nullable(),
});

export type ReelProps = z.infer<typeof reelSchema>;

export const defaultReelProps: ReelProps = {
  clientName: 'Acme Plumbing',
  headline: 'This website was costing them customers.',
  beforeImage: 'job/before.jpg',
  afterImage: 'job/after.jpg',
  beforeMeta: { width: 1440, height: 4200, url: 'old-site.com' },
  afterMeta: { width: 1440, height: 5200, url: 'acmeplumbing.com' },
  beforeSeconds: 8,
  afterSeconds: 11,
  brandName: 'B2 Web Solutions',
  cta: 'Want a site that converts? DM us "WEBSITE"',
  accentColor: '#22d3ee',
  musicSrc: null,
};

/** Frame layout of the reel. The swipe overlaps the start of AFTER. */
export function getSegments(props: Pick<ReelProps, 'beforeSeconds' | 'afterSeconds'>) {
  const hook = Math.round(2.5 * FPS);
  const before = Math.round(props.beforeSeconds * FPS);
  const after = Math.round(props.afterSeconds * FPS);
  const swipe = 18;
  const end = Math.round(4.5 * FPS);
  return {
    hook,
    before,
    after,
    swipe,
    end,
    beforeStart: hook,
    afterStart: hook + before,
    endStart: hook + before + after,
    total: hook + before + after + end,
  };
}
