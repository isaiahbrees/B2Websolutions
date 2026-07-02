import path from 'node:path';
import fs from 'node:fs';
import { getSegments, type ReelProps } from '../remotion/schema';
import type { ScrollVideoInfo } from '../types';
import { readJson } from '../util';

/**
 * Scene model: the generated reel decomposed into editable scenes. Derived
 * from the same segment math the composition uses, so what the workspace
 * shows is exactly what renders.
 */

export type Scene = {
  id: string;
  type: 'intro' | 'before' | 'split' | 'after' | 'end' | 'dwell';
  label: string;
  startSec: number;
  durationSec: number;
  /** which project style fields edit this scene */
  editableFields: string[];
  detail?: string;
};

export function deriveScenes(dir: string): Scene[] {
  // Prefer what was actually rendered; fall back to representative defaults.
  let props: Pick<ReelProps, 'beforeSeconds' | 'afterSeconds' | 'fps' | 'template'> = {
    beforeSeconds: 10,
    afterSeconds: 14,
    fps: 30,
    template: 'clean',
  };
  const infoFile = path.join(dir, 'render-info.json');
  if (fs.existsSync(infoFile)) {
    try {
      props = { ...props, ...readJson<typeof props>(infoFile) };
    } catch {
      /* advisory */
    }
  }
  const seg = getSegments(props);
  const s = (frames: number) => Math.round((frames / seg.fps) * 10) / 10;
  const scenes: Scene[] = [
    {
      id: 'intro',
      type: 'intro',
      label: 'Intro card',
      startSec: 0,
      durationSec: s(seg.intro),
      editableFields: ['title', 'clientName'],
    },
    {
      id: 'before',
      type: 'before',
      label: 'Before tour',
      startSec: s(seg.beforeStart),
      durationSec: s(seg.before),
      editableFields: ['beforeLabel', 'scrollSpeed', 'intensity'],
    },
  ];
  if (seg.split > 0) {
    scenes.push({
      id: 'split',
      type: 'split',
      label: 'Side-by-side',
      startSec: s(seg.splitStart),
      durationSec: s(seg.split),
      editableFields: ['beforeLabel', 'afterLabel'],
    });
  }
  scenes.push({
    id: 'after',
    type: 'after',
    label: 'After tour',
    startSec: s(seg.afterStart),
    durationSec: s(seg.after),
    editableFields: ['afterLabel', 'scrollSpeed', 'intensity'],
  });

  // dwell markers from the recorded tour (read-only, informational)
  const videoJson = path.join(dir, 'after', 'video.json');
  if (fs.existsSync(videoJson)) {
    try {
      const info = readJson<ScrollVideoInfo>(videoJson);
      for (const [i, stop] of info.stops.entries()) {
        scenes.push({
          id: `dwell-${i}`,
          type: 'dwell',
          label: `Push-in · ${stop.kind}`,
          startSec: Math.round((s(seg.afterStart) + stop.tSec) * 10) / 10,
          durationSec: stop.dwellSec,
          editableFields: [],
          detail: 'Camera dwell detected on the after site',
        });
      }
    } catch {
      /* informational only */
    }
  }

  scenes.push({
    id: 'end',
    type: 'end',
    label: 'End card',
    startSec: s(seg.endStart),
    durationSec: s(seg.end),
    editableFields: ['tagline', 'cta', 'brandName'],
  });
  return scenes;
}
