import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { captureSite, recordScrollVideo } from '../capture';
import { defaultCaption, postVideo, type PostVia } from '../post/index';
import { renderReel as doRender, type ScrollSpeed } from '../render';
import type { ReelProps } from '../remotion/schema';
import { getTemplate, type StoryType } from '../templates';
import { ensureDir, log, readJson, writeJson } from '../util';
import { generateCopy, type GeneratedCopy } from './copy';
import { recordExport } from './store';

export type JobParams = {
  beforeUrl: string;
  afterUrl: string;
  clientName: string;
  projectName?: string;
  templateId?: string;
  storyType?: StoryType;
  industry?: string;
  brandKitId?: string | null;
  caption?: string;
  /** Post automatically when the render finishes. */
  postVia?: PostVia | null;
  scrollSpeed?: ScrollSpeed;
  durationTarget?: number | null;
  /** Resolved composition props (template + brand kit + user overrides). */
  style?: Partial<ReelProps>;
};

export type JobStatus = 'queued' | 'capturing' | 'rendering' | 'posting' | 'done' | 'error';

export type CaptureSummary = {
  cssWidth: number;
  cssHeight: number;
  sections: number;
  mode: string;
};

export type Job = {
  id: string;
  createdAt: string;
  params: JobParams;
  status: JobStatus;
  archived?: boolean;
  /** Human-readable progress detail, e.g. "Recording the after site" */
  stage?: string;
  /** 0..1 while rendering */
  progress: number;
  /** What each capture actually got — shown as thumbnails in the UI. */
  captures?: { before?: CaptureSummary; after?: CaptureSummary };
  /** Generated social copy (captions, hashtags, delivery message). */
  copy?: GeneratedCopy;
  /** Public delivery-page token. */
  shareToken?: string;
  error?: string;
  videoFile?: string;
  postedId?: string;
  postedVia?: PostVia;
};

const JOBS_DIR = path.resolve('out/jobs');

const jobs = new Map<string, Job>();

function persist(job: Job): void {
  writeJson(path.join(JOBS_DIR, job.id, 'job.json'), job);
}

export function loadJobs(): void {
  if (!fs.existsSync(JOBS_DIR)) return;
  for (const id of fs.readdirSync(JOBS_DIR)) {
    const file = path.join(JOBS_DIR, id, 'job.json');
    if (!fs.existsSync(file)) continue;
    try {
      const job = readJson<Job>(file);
      // Anything that was mid-flight when the server stopped is dead.
      if (!['done', 'error'].includes(job.status)) {
        job.status = 'error';
        job.error = 'Interrupted by server restart — submit again.';
        persist(job);
      }
      jobs.set(job.id, job);
    } catch {
      log(`skipping unreadable job dir ${id}`);
    }
  }
  log(`loaded ${jobs.size} project(s) from ${JOBS_DIR}`);
}

export function listJobs(): Job[] {
  return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function getJobByShareToken(token: string): Job | undefined {
  return [...jobs.values()].find((j) => j.shareToken === token);
}

export function jobDir(job: Job): string {
  return path.join(JOBS_DIR, job.id);
}

export function updateJobMeta(job: Job, patch: Partial<Pick<Job, 'archived' | 'params'>>): void {
  Object.assign(job, patch);
  persist(job);
}

export function deleteJob(job: Job): void {
  jobs.delete(job.id);
  fs.rmSync(jobDir(job), { recursive: true, force: true });
}

// Renders are heavy (headless Chrome + encoding) — run one job at a time.
let queueTail: Promise<void> = Promise.resolve();

/** Resolve template + user overrides into final composition props. */
export function resolveStyle(params: JobParams): Partial<ReelProps> {
  const tpl = getTemplate(params.templateId ?? 'clean-agency');
  return {
    template: tpl.base,
    intensity: tpl.intensity,
    accentColor: tpl.accentColor,
    title: tpl.copy.title,
    tagline: tpl.copy.tagline,
    cta: tpl.copy.cta,
    beforeLabel: tpl.copy.beforeLabel,
    afterLabel: tpl.copy.afterLabel,
    ...params.style,
    clientName: params.clientName,
  };
}

export function templatePace(params: JobParams): number {
  return getTemplate(params.templateId ?? 'clean-agency').pacing;
}

export function createJob(params: JobParams): Job {
  const job: Job = {
    id: crypto.randomUUID().slice(0, 8),
    createdAt: new Date().toISOString(),
    params,
    status: 'queued',
    stage: 'Waiting in queue',
    progress: 0,
    shareToken: crypto.randomBytes(12).toString('base64url'),
    copy: generateCopy({
      clientName: params.clientName,
      industry: params.industry,
      storyType: params.storyType,
      afterUrl: params.afterUrl,
      brandName: params.style?.brandName,
    }),
  };
  jobs.set(job.id, job);
  ensureDir(jobDir(job));
  persist(job);
  queueTail = queueTail.then(() => runJob(job)).catch(() => {});
  return job;
}

/** Re-render with new style — reuses existing captures and recordings. */
export function rerenderJob(job: Job, styleParams: Partial<JobParams>): void {
  job.params = { ...job.params, ...styleParams, style: { ...job.params.style, ...styleParams.style } };
  job.status = 'queued';
  job.stage = 'Waiting in queue (re-render)';
  job.progress = 0;
  job.error = undefined;
  persist(job);
  queueTail = queueTail.then(() => renderPhase(job)).catch(() => {});
}

function update(job: Job, patch: Partial<Job>): void {
  Object.assign(job, patch);
  persist(job);
}

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/net::ERR_NAME_NOT_RESOLVED|ENOTFOUND/.test(msg)) return 'That URL could not be found — check the address.';
  if (/net::ERR_CONNECTION|ECONNREFUSED/.test(msg)) return 'The site refused the connection — it may be blocking automated visits.';
  if (/Timeout .* exceeded|TimeoutError/.test(msg)) return 'The site took too long to load (timeout). Try again, or try the www/non-www variant.';
  return msg;
}

async function renderPhase(job: Job): Promise<void> {
  const dir = jobDir(job);
  try {
    update(job, { status: 'rendering', stage: 'Planning camera moves', progress: 0 });
    const videoFile = path.join(dir, 'reel.mp4');
    const render = (ignoreVideos: boolean) =>
      doRender({
        beforeDir: path.join(dir, 'before'),
        afterDir: path.join(dir, 'after'),
        outPath: videoFile,
        props: resolveStyle(job.params),
        scrollSpeed: job.params.scrollSpeed,
        durationTarget: job.params.durationTarget,
        pace: templatePace(job.params),
        ignoreVideos,
        onProgress: (progress) => {
          if (progress - job.progress >= 0.02 || progress === 1) {
            update(job, { progress, stage: 'Rendering the reel' });
          }
        },
      });
    try {
      await render(false);
    } catch (err) {
      const hadVideo =
        fs.existsSync(path.join(dir, 'before', 'video.json')) ||
        fs.existsSync(path.join(dir, 'after', 'video.json'));
      if (!hadVideo) throw err;
      // The job must ALWAYS produce a reel: if the video render dies for any
      // reason, fall back to the proven still-capture render.
      log(
        `job ${job.id}: video render failed (${err instanceof Error ? err.message.split('\n')[0].slice(0, 90) : err}) — retrying with stills`,
      );
      update(job, { stage: 'Video render failed — retrying with stills', progress: 0 });
      await render(true);
    }
    update(job, { videoFile, progress: 1, stage: 'Finalizing MP4' });
    recordExport(job.id);

    if (job.params.postVia) {
      await postJob(job, job.params.postVia);
    }
    update(job, { status: 'done', stage: undefined });
    log(`job ${job.id} done`);
  } catch (err) {
    update(job, { status: 'error', stage: undefined, error: friendlyError(err) });
    log(`job ${job.id} failed: ${job.error}`);
  }
}

async function runJob(job: Job): Promise<void> {
  const dir = jobDir(job);
  try {
    const summarize = (m: Awaited<ReturnType<typeof captureSite>>): CaptureSummary => ({
      cssWidth: m.cssWidth,
      cssHeight: m.cssHeight,
      sections: m.sections.length,
      mode: m.mode,
    });
    update(job, { status: 'capturing', stage: 'Loading the before site' });
    const beforeMeta = await captureSite(job.params.beforeUrl, path.join(dir, 'before'));
    update(job, { captures: { before: summarize(beforeMeta) }, stage: 'Recording the before site in motion' });
    await recordScrollVideo(job.params.beforeUrl, path.join(dir, 'before'), job.params.scrollSpeed);

    update(job, { stage: 'Loading the after site' });
    const afterMeta = await captureSite(job.params.afterUrl, path.join(dir, 'after'));
    update(job, {
      captures: { before: summarize(beforeMeta), after: summarize(afterMeta) },
      stage: 'Recording the after site in motion',
    });
    await recordScrollVideo(job.params.afterUrl, path.join(dir, 'after'), job.params.scrollSpeed);

    await renderPhase(job);
  } catch (err) {
    update(job, { status: 'error', stage: undefined, error: friendlyError(err) });
    log(`job ${job.id} failed: ${job.error}`);
  }
}

export async function postJob(job: Job, via: PostVia): Promise<void> {
  if (!job.videoFile) throw new Error('No rendered video for this project yet.');
  update(job, { status: 'posting', stage: 'Uploading to ' + (via === 'make' ? 'Make.com' : 'Facebook') });
  try {
    const caption =
      job.params.caption ??
      job.copy?.captions.facebook ??
      defaultCaption({
        headline: job.params.style?.title,
        clientName: job.params.clientName,
        cta: job.params.style?.cta,
      });
    const postedId = await postVideo(via, job.videoFile, caption, job.params.clientName);
    update(job, { status: 'done', stage: undefined, postedId, postedVia: via });
  } catch (err) {
    // Posting failed but the video exists — keep the job usable for retries.
    update(job, { status: 'done', stage: undefined, error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
