import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import {
  checkLogin,
  clearSessionCookie,
  createSessionToken,
  requireAuth,
  sessionFromRequest,
  setSessionCookie,
} from './auth';
import { createJob, getJob, jobDir, listJobs, loadJobs, postJob, type JobParams } from './jobs';
import type { PostVia } from '../post/index';
import { log } from '../util';

const UI_DIR = fileURLToPath(new URL('./ui', import.meta.url));
const PORT = Number(process.env.PORT || 3000);

const app = express();
// Railway/Render/fly put the app behind a reverse proxy; this makes req.ip
// (login rate limiting) see the real client address.
app.set('trust proxy', 1);
app.use(express.json());

// --- pages & assets ---
app.get('/', (req, res) => {
  if (!sessionFromRequest(req)) return res.redirect('/login');
  res.sendFile(path.join(UI_DIR, 'index.html'));
});
app.get('/login', (req, res) => {
  if (sessionFromRequest(req)) return res.redirect('/');
  res.sendFile(path.join(UI_DIR, 'login.html'));
});
app.use('/assets', express.static(UI_DIR));

// --- auth ---
app.post('/api/login', (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password required' });
  }
  try {
    if (!checkLogin(req, email, password)) {
      return res.status(401).json({ error: 'Wrong email or password' });
    }
  } catch (err) {
    return res.status(429).json({ error: err instanceof Error ? err.message : String(err) });
  }
  setSessionCookie(res, createSessionToken(email));
  res.json({ ok: true });
});

app.post('/api/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.use('/api', requireAuth);

app.get('/api/me', (req, res) => {
  res.json({ email: sessionFromRequest(req)?.email });
});

// --- jobs ---
const isHttpUrl = (v: unknown): v is string =>
  typeof v === 'string' && /^https?:\/\/\S+$/i.test(v);
const POST_VIAS: PostVia[] = ['reel', 'facebook', 'make'];

app.post('/api/jobs', (req, res) => {
  const b = req.body ?? {};
  if (!isHttpUrl(b.beforeUrl) || !isHttpUrl(b.afterUrl)) {
    return res.status(400).json({ error: 'beforeUrl and afterUrl must be http(s) URLs' });
  }
  if (typeof b.clientName !== 'string' || !b.clientName.trim()) {
    return res.status(400).json({ error: 'clientName is required' });
  }
  if (b.postVia && !POST_VIAS.includes(b.postVia)) {
    return res.status(400).json({ error: `postVia must be one of ${POST_VIAS.join(', ')}` });
  }
  const optional = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const params: JobParams = {
    beforeUrl: b.beforeUrl,
    afterUrl: b.afterUrl,
    clientName: b.clientName.trim(),
    headline: optional(b.headline),
    brandName: optional(b.brandName),
    cta: optional(b.cta),
    accentColor: optional(b.accentColor),
    caption: optional(b.caption),
    postVia: b.postVia || null,
  };
  const job = createJob(params);
  res.status(201).json(job);
});

app.get('/api/jobs', (_req, res) => {
  res.json(listJobs());
});

app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'No such job' });
  res.json(job);
});

app.get('/api/jobs/:id/video', (req, res) => {
  const job = getJob(req.params.id);
  if (!job?.videoFile) return res.status(404).json({ error: 'No video for this job' });
  res.sendFile(path.resolve(job.videoFile));
});

app.get('/api/jobs/:id/capture/:which(before|after)', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'No such job' });
  res.sendFile(path.join(jobDir(job), req.params.which, 'site.jpg'), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Capture not ready' });
  });
});

app.post('/api/jobs/:id/post', async (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'No such job' });
  const via: PostVia = POST_VIAS.includes(req.body?.via) ? req.body.via : 'reel';
  try {
    await postJob(job, via);
    res.json(job);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

loadJobs();
app.listen(PORT, () => {
  log(`web app running at http://localhost:${PORT}`);
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    log('WARNING: set ADMIN_EMAIL and ADMIN_PASSWORD in .env — login is disabled until you do.');
  }
});
