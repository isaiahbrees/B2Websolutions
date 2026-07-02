import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { captureSite } from '../capture';
import { defaultCaption, postVideo, type PostVia } from '../post/index';
import { renderReel } from '../render';
import { ensureDir, log, readJson, writeJson } from '../util';

export type JobParams = {
  beforeUrl: string;
  afterUrl: string;
  clientName: string;
  headline?: string;
  brandName?: string;
  cta?: string;
  accentColor?: string;
  caption?: string;
  /** Post automatically when the render finishes. */
  postVia?: PostVia | null;
};

export type JobStatus = 'queued' | 'capturing' | 'rendering' | 'posting' | 'done' | 'error';

export type Job = {
  id: string;
  createdAt: string;
  params: JobParams;
  status: JobStatus;
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

async function runJob(job: Job): Promise<void> {
  const dir = jobDir(job);
  try {
    update(job, { status: 'capturing' });
    await captureSite(job.params.beforeUrl, path.join(dir, 'before'));
    await captureSite(job.params.afterUrl, path.join(dir, 'after'));

    update(job, { status: 'rendering', progress: 0 });
    const videoFile = path.join(dir, 'reel.mp4');
    await renderReel({
      beforeDir: path.join(dir, 'before'),
      afterDir: path.join(dir, 'after'),
      outPath: videoFile,
      clientName: job.params.clientName,
      headline: job.params.headline,
      brandName: job.params.brandName,
      cta: job.params.cta,
      accentColor: job.params.accentColor,
      onProgress: (progress) => {
        // Persisting every frame would hammer the disk; every ~2% is plenty.
        if (progress - job.progress >= 0.02 || progress === 1) {
          update(job, { progress });
        }
      },
    });
    update(job, { videoFile, progress: 1 });

    if (job.params.postVia) {
      await postJob(job, job.params.postVia);
    }
    update(job, { status: 'done' });
    log(`job ${job.id} done`);
  } catch (err) {
    update(job, { status: 'error', error: err instanceof Error ? err.message : String(err) });
    log(`job ${job.id} failed: ${job.error}`);
  }
}

export async function postJob(job: Job, via: PostVia): Promise<void> {
  if (!job.videoFile) throw new Error('No rendered video for this job yet.');
  update(job, { status: 'posting' });
  try {
    const caption =
      job.params.caption ??
      defaultCaption({
        headline: job.params.headline,
        clientName: job.params.clientName,
        cta: job.params.cta,
      });
    const postedId = await postVideo(via, job.videoFile, caption, job.params.clientName);
    update(job, { status: 'done', postedId, postedVia: via });
  } catch (err) {
    // Posting failed but the video exists — keep the job usable for retries.
    update(job, { status: 'done', error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
