import { z } from 'zod';

export const DESIGN_WIDTH = 1080;
export const DESIGN_HEIGHT = 1920;

export const sectionSchema = z.object({
  y: z.number(),
  h: z.number(),
  kind: z.enum(['hero', 'heading', 'cards', 'testimonial', 'pricing', 'stats', 'gallery', 'cta']),
});

export const videoInfoSchema = z.object({
  /** seconds of page-setup at the head of the recording to trim */
  prepSec: z.number(),
  holdSec: z.number(),
  pxPerSec: z.number(),
  maxScroll: z.number(),
  viewportH: z.number(),
  durationSec: z.number(),
});

export type VideoInfo = z.infer<typeof videoInfoSchema>;

export const siteMeta = z.object({
  /** Actual image pixel dimensions (source of truth for camera math) */
  width: z.number(),
  height: z.number(),
  /** CSS px width of the capture viewport (sections are in CSS px) */
  cssWidth: z.number(),
  url: z.string(),
  sections: z.array(sectionSchema).default([]),
});

export const reelSchema = z.object({
  clientName: z.string(),
  /** Intro card title */
  title: z.string(),
  tagline: z.string(),
  services: z.string(),
  cta: z.string(),
  beforeLabel: z.string(),
  afterLabel: z.string(),
  brandName: z.string(),
  logoUrl: z.string().nullable(),
  accentColor: z.string(),
  template: z.enum(['clean', 'dark', 'split']),
  intensity: z.enum(['subtle', 'balanced', 'cinematic']),
  resolution: z.enum(['1080', '2160']),
  fps: z.union([z.literal(30), z.literal(60)]),
  beforeImage: z.string().describe('staticFile()-relative path or http URL'),
  afterImage: z.string(),
  /** Live scroll recordings — preferred over stills when present. */
  beforeVideo: z.string().nullable(),
  afterVideo: z.string().nullable(),
  beforeVideoInfo: videoInfoSchema.nullable(),
  afterVideoInfo: videoInfoSchema.nullable(),
  beforeMeta: siteMeta,
  afterMeta: siteMeta,
  beforeSeconds: z.number().min(3).max(60),
  afterSeconds: z.number().min(3).max(60),
  musicSrc: z.string().nullable(),
});

export type ReelProps = z.infer<typeof reelSchema>;
export type SiteMeta = z.infer<typeof siteMeta>;
export type Section = z.infer<typeof sectionSchema>;

export const defaultReelProps: ReelProps = {
  clientName: 'Acme Plumbing',
  title: 'Website Redesign',
  tagline: 'Your website should work as hard as you do.',
  services: 'Website Design + Development',
  cta: 'Message us for a redesign',
  beforeLabel: 'BEFORE',
  afterLabel: 'AFTER',
  brandName: 'B2 Web Solutions',
  logoUrl: null,
  accentColor: '#0a84ff',
  template: 'clean',
  intensity: 'balanced',
  resolution: '1080',
  fps: 30,
  beforeImage: 'job/before.jpg',
  afterImage: 'job/after.jpg',
  beforeVideo: null,
  afterVideo: null,
  beforeVideoInfo: null,
  afterVideoInfo: null,
  beforeMeta: { width: 2880, height: 8400, cssWidth: 1440, url: 'old-site.com', sections: [] },
  afterMeta: { width: 2880, height: 10400, cssWidth: 1440, url: 'acmeplumbing.com', sections: [] },
  beforeSeconds: 8,
  afterSeconds: 13,
  musicSrc: null,
};

/** Frame layout of the reel. Transition overlaps the start of AFTER. */
export function getSegments(props: Pick<ReelProps, 'beforeSeconds' | 'afterSeconds' | 'fps' | 'template'>) {
  const fps = props.fps;
  const intro = Math.round(2.2 * fps);
  const before = Math.round(props.beforeSeconds * fps);
  const split = props.template === 'split' ? Math.round(1.6 * fps) : 0;
  const after = Math.round(props.afterSeconds * fps);
  const flash = Math.round(0.45 * fps);
  const end = Math.round(3.2 * fps);
  return {
    fps,
    intro,
    before,
    split,
    after,
    flash,
    end,
    beforeStart: intro,
    splitStart: intro + before,
    afterStart: intro + before + split,
    endStart: intro + before + split + after,
    total: intro + before + split + after + end,
  };
}
