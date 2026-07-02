import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { captureSite } from '../capture';
import { defaultCaption, postVideo, type PostVia } from '../post/index';
import { renderReel, type ScrollSpeed } from '../render';
import type { ReelProps } from '../remotion/schema';
import { ensureDir, log, readJson, writeJson } from '../util';

export type JobParams = {
  beforeUrl: string;
  afterUrl: string;
  clientName: string;
  caption?: string;
  /** Post automatically when the render finishes. */
  postVia?: PostVia | null;
  scrollSpeed?: ScrollSpeed;
  durationTarget?: number | null;
  /** Template/branding overrides for the composition. */
  style?: Partial<ReelProps>;
};

export type JobStatus = 'queued' | 'capturing' | 'rendering' | 'posting' | 'done' | 'error';

export type Job = {
  id: string;
  createdAt: string;
  params: JobParams;
  status: JobStatus;
  /** Human-readable progress detail, e.g. "Analyzing sections (after site)" */
  stage?: string;
  /** 0..1 while rendering */
  progress: number;
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
  log(`loaded ${jobs.size} job(s) from ${JOBS_DIR}`);
}

export function listJobs(): Job[] {
  return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function jobDir(job: Job): string {
  return path.join(JOBS_DIR, job.id);
}

// Renders are heavy (headless Chrome + encoding) — run one job at a time.
let queueTail: Promise<void> = Promise.resolve();

export function createJob(params: JobParams): Job {
  const job: Job = {
    id: crypto.randomUUID().slice(0, 8),
    createdAt: new Date().toISOString(),
    params,
    status: 'queued',
    stage: 'Waiting in queue',
    progress: 0,
  };
  jobs.set(job.id, job);
  ensureDir(jobDir(job));
  persist(job);
  queueTail = queueTail.then(() => runJob(job)).catch(() => {});
  return job;
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

async function runJob(job: Job): Promise<void> {
  const dir = jobDir(job);
  try {
    update(job, { status: 'capturing', stage: 'Loading the before site' });
    await captureSite(job.params.beforeUrl, path.join(dir, 'before'));
    update(job, { stage: 'Loading the after site' });
    await captureSite(job.params.afterUrl, path.join(dir, 'after'));

    update(job, { status: 'rendering', stage: 'Planning camera moves', progress: 0 });
    const videoFile = path.join(dir, 'reel.mp4');
    await renderReel({
      beforeDir: path.join(dir, 'before'),
      afterDir: path.join(dir, 'after'),
      outPath: videoFile,
      props: { ...job.params.style, clientName: job.params.clientName },
      scrollSpeed: job.params.scrollSpeed,
      durationTarget: job.params.durationTarget,
      onProgress: (progress) => {
        // Persisting every frame would hammer the disk; every ~2% is plenty.
        if (progress - job.progress >= 0.02 || progress === 1) {
          update(job, { progress, stage: 'Rendering the reel' });
        }
      },
    });
    update(job, { videoFile, progress: 1, stage: 'Finalizing MP4' });

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

export async function postJob(job: Job, via: PostVia): Promise<void> {
  if (!job.videoFile) throw new Error('No rendered video for this job yet.');
  update(job, { status: 'posting', stage: 'Uploading to ' + (via === 'make' ? 'Make.com' : 'Facebook') });
  try {
    const caption =
      job.params.caption ??
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
