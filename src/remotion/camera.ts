import type { Section } from './schema';

export type CameraPath = {
  frames: number[];
  /** page Y (image px) the camera looks at */
  ys: number[];
  /** zoom scale */
  scales: number[];
};

const KIND_ZOOM: Record<Section['kind'], number> = {
  hero: 1.10,
  heading: 1.07,
  cards: 1.12,
  testimonial: 1.13,
  pricing: 1.10,
  stats: 1.10,
  gallery: 1.10,
  cta: 1.15,
};

const INTENSITY: Record<'subtle' | 'balanced' | 'cinematic', number> = {
  subtle: 0.45,
  balanced: 1,
  cinematic: 1.55,
};

/**
 * Turn detected page sections into a camera plan: start on the hero, glide
 * between sections with a gentle push-in and hold on each, end at the bottom.
 * All positions are in image pixels; the component maps them to transforms.
 */
export function buildCameraPath(opts: {
  sections: Section[];
  /** image px per CSS px (sections are detected in CSS px) */
  pxPerCss: number;
  imgH: number;
  viewH: number;
  duration: number;
  intensity: 'subtle' | 'balanced' | 'cinematic';
  /** BEFORE gets minimal movement; AFTER gets the show */
  flavor: 'minimal' | 'showcase';
}): CameraPath {
  const { sections, pxPerCss, imgH, viewH, duration: d, intensity, flavor } = opts;
  const minC = Math.min(viewH / 2, imgH / 2);
  const maxC = Math.max(imgH - viewH / 2, minC);
  const boost = INTENSITY[intensity] * (flavor === 'minimal' ? 0.5 : 1);
  const zoomFor = (kind: Section['kind']) => 1 + (KIND_ZOOM[kind] - 1) * boost;

  const frames: number[] = [];
  const ys: number[] = [];
  const scales: number[] = [];
  const push = (f: number, y: number, s: number) => {
    const fi = Math.round(f);
    if (frames.length && fi <= frames[frames.length - 1]) return;
    frames.push(fi);
    ys.push(Math.min(Math.max(y, minC), maxC));
    scales.push(s);
  };

  // Short page that fits in the viewport: a single slow push-in, no scroll.
  if (imgH <= viewH * 1.05) {
    const z = 1 + 0.06 * boost;
    push(0, minC, 1);
    push(d * 0.55, minC, z);
    push(d, minC, z * 0.995);
    return { frames, ys, scales };
  }

  const focal = sections
    .map((s) => ({
      cy: (s.y + Math.min(s.h, (viewH / pxPerCss) * 0.7) / 2) * pxPerCss,
      zoom: zoomFor(s.kind),
    }))
    .filter((s) => s.cy > minC * 0.5 && s.cy < imgH - 100)
    .sort((a, b) => a.cy - b.cy)
    .slice(0, flavor === 'minimal' ? 3 : 5);

  // No usable sections: tasteful full-page scroll with one mid push-in.
  if (focal.length === 0) {
    const z = 1 + 0.07 * boost;
    push(0, minC, 1);
    push(d * 0.1, minC, 1);
    push(d * 0.45, minC + (maxC - minC) * 0.45, z);
    push(d * 0.62, minC + (maxC - minC) * 0.62, z);
    push(d * 0.92, maxC, 1);
    push(d, maxC, 1);
    return { frames, ys, scales };
  }

  // Opening hold on the top of the page, slightly wide.
  push(0, minC, 1);
  push(d * 0.09, minC, 1.0);

  // Visit each focal point: travel eased, push in, hold, ease back out a bit.
  const travelWindow: [number, number] = [d * 0.09, d * 0.88];
  const slot = (travelWindow[1] - travelWindow[0]) / focal.length;
  focal.forEach((f, i) => {
    const arrive = travelWindow[0] + slot * (i + 0.55);
    const holdEnd = travelWindow[0] + slot * (i + 0.92);
    push(arrive, f.cy, f.zoom);
    push(holdEnd, f.cy + viewH * 0.02, f.zoom);
  });

  // Settle at the bottom of the page, back to wide.
  push(d * 0.985, maxC, 1);
  push(d, maxC, 1);
  return { frames, ys, scales };
}
