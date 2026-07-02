import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Playwright bundles the ffmpeg it records with — reuse it. */
export function findPlaywrightFfmpeg(): string | null {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), '.cache', 'ms-playwright'),
    path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright'),
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
  ].filter((p): p is string => Boolean(p));
  for (const root of roots) {
    try {
      for (const entry of fs.readdirSync(root)) {
        if (!entry.startsWith('ffmpeg')) continue;
        for (const bin of ['ffmpeg-linux', 'ffmpeg-mac', 'ffmpeg-win64.exe']) {
          const candidate = path.join(root, entry, bin);
          if (fs.existsSync(candidate)) return candidate;
        }
      }
    } catch {
      /* not this root */
    }
  }
  return null;
}

export type ScreencastFrame = {
  file: string;
  /** seconds (monotonic-ish; only deltas matter) */
  t: number;
};

/**
 * Assemble variable-rate screencast frames into a constant-frame-rate vp8
 * webm. The compositor only emits frames when pixels change, so static holds
 * produce gaps — each output tick repeats the latest frame at or before it,
 * and the tail is padded to minDurationSec so end-holds survive.
 * Returns the resulting duration in seconds.
 */
export async function assembleCfrWebm(opts: {
  frames: ScreencastFrame[];
  outFile: string;
  fps?: number;
  minDurationSec?: number;
  bitrate?: string;
  ffmpegPath?: string | null;
}): Promise<number> {
  const { frames, outFile } = opts;
  const fps = opts.fps ?? 60;
  if (frames.length < 2) throw new Error(`too few screencast frames (${frames.length})`);

  const ffmpeg = opts.ffmpegPath ?? findPlaywrightFfmpeg();
  if (!ffmpeg) throw new Error('no ffmpeg available for screencast assembly');

  const t0 = frames[0].t;
  const tEnd = Math.max(frames[frames.length - 1].t, t0 + (opts.minDurationSec ?? 0));
  const durationSec = tEnd - t0;

  const proc = spawn(ffmpeg, [
    '-y',
    '-f', 'image2pipe',
    '-framerate', String(fps),
    '-c:v', 'mjpeg',
    '-i', 'pipe:0',
    '-c:v', 'vp8',
    '-b:v', opts.bitrate ?? '8M',
    '-g', String(fps),
    '-deadline', 'realtime',
    '-cpu-used', '5',
    '-an',
    outFile,
  ]);
  let stderr = '';
  proc.stderr.on('data', (d) => {
    stderr = (stderr + d.toString()).slice(-2000);
  });
  const exit = once(proc, 'close');

  let src = 0;
  let cached: Buffer | null = null;
  let cachedIdx = -1;
  const total = Math.max(2, Math.round(durationSec * fps));
  for (let i = 0; i < total; i++) {
    const t = t0 + i / fps;
    while (src + 1 < frames.length && frames[src + 1].t <= t) src++;
    if (cachedIdx !== src) {
      cached = fs.readFileSync(frames[src].file);
      cachedIdx = src;
    }
    if (!proc.stdin.write(cached!)) {
      await Promise.race([once(proc.stdin, 'drain'), exit]);
      if (proc.exitCode !== null) break;
    }
  }
  proc.stdin.end();
  const [code] = (await exit) as [number | null];
  if (code !== 0) throw new Error(`screencast assembly failed (ffmpeg exit ${code}): ${stderr.slice(-300)}`);
  const size = fs.existsSync(outFile) ? fs.statSync(outFile).size : 0;
  if (size < 20_000) throw new Error(`screencast assembly produced a suspiciously small file (${size}B)`);
  return durationSec;
}
