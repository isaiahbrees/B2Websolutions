import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { BRAND } from '../branding';
import { FORMATS, STORY_TYPES, TEMPLATES, getTemplate } from '../templates';
import { log } from '../util';
import {
  checkLogin,
  clearSessionCookie,
  createSessionToken,
  requireAuth,
  sessionFromRequest,
  setSessionCookie,
} from './auth';
import { generateCopy } from './copy';
import {
  createJob,
  deleteJob,
  getJob,
  getJobByShareToken,
  jobDir,
  listJobs,
  loadJobs,
  postJob,
  rerenderJob,
  updateJobMeta,
  type JobParams,
} from './jobs';
import { PLANS, canAddBrandKit, canExport, canUse60fps, canUseResolution, type PlanId } from './plans';
import { deriveScenes } from './scenes';
import { applyPlanCaps, resolveRerenderStyle } from './style';
import {
  deleteAsset,
  deleteBrandKit,
  exportsUsedThisMonth,
  getAsset,
  getBrandKit,
  getWorkspace,
  listAssets,
  listBrandKits,
  saveAssetFromDataUrl,
  saveBrandKit,
  updateWorkspace,
} from './store';
import type { PostVia } from '../post/index';
import { resolveStyle } from './jobs';

const UI_DIR = fileURLToPath(new URL('./ui', import.meta.url));
const PORT = Number(process.env.PORT || 3000);

const app = express();
// Railway/Render/fly put the app behind a reverse proxy; this makes req.ip
// (login rate limiting) see the real client address.
app.set('trust proxy', 1);
app.use(express.json({ limit: '12mb' }));

const page = (name: string) => (_req: express.Request, res: express.Response) =>
  res.sendFile(path.join(UI_DIR, name));

// --- public pages ---
app.get('/', page('landing.html'));
app.get('/pricing', (_req, res) => res.redirect('/#pricing'));
app.get('/login', (req, res) => {
  if (sessionFromRequest(req)) return res.redirect('/app');
  res.sendFile(path.join(UI_DIR, 'login.html'));
});
app.get('/share/:token', page('share.html'));
// Only the shared static files — page shells are served by their routes above
// (the /app ones behind auth), never straight off disk.
const STATIC_FILES = new Set(['theme.css', 'shell.js']);
app.get('/assets/:file', (req, res) => {
  if (!STATIC_FILES.has(req.params.file)) return res.status(404).end();
  res.sendFile(path.join(UI_DIR, req.params.file), { maxAge: '1h' });
});

// --- app pages (auth-gated; APIs enforce separately) ---
const appPage = (name: string) => (req: express.Request, res: express.Response) => {
  if (!sessionFromRequest(req)) return res.redirect('/login');
  res.sendFile(path.join(UI_DIR, name));
};
app.get('/app', appPage('dashboard.html'));
app.get('/app/new', appPage('new.html'));
app.get('/app/projects', appPage('projects.html'));
app.get('/app/project/:id', appPage('project.html'));
app.get('/app/templates', appPage('templates.html'));
app.get('/app/brand', appPage('brand.html'));
app.get('/app/assets', appPage('assets.html'));
app.get('/app/billing', appPage('billing.html'));
app.get('/app/settings', appPage('settings.html'));
app.get('/app/help', appPage('help.html'));

// --- public APIs ---
app.get('/api/branding', (_req, res) => res.json(BRAND));

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

// Public share endpoints (token IS the auth).
app.get('/api/share/:token', (req, res) => {
  const job = getJobByShareToken(req.params.token);
  if (!job || !job.videoFile) return res.status(404).json({ error: 'This delivery link is not available.' });
  const ws = getWorkspace();
  const whiteLabel = PLANS[ws.plan].whiteLabelShare;
  res.json({
    clientName: job.params.clientName,
    projectName: job.params.projectName || job.params.clientName,
    brandName: whiteLabel ? job.params.style?.brandName ?? null : null,
    poweredBy: whiteLabel ? null : BRAND.name,
    createdAt: job.createdAt,
  });
});
app.get('/api/share/:token/video', (req, res) => {
  const job = getJobByShareToken(req.params.token);
  if (!job?.videoFile) return res.status(404).json({ error: 'Not available' });
  res.sendFile(path.resolve(job.videoFile));
});

// Asset files are fetched by id (unguessable) WITHOUT a session: the Remotion
// render browser loads brand-kit logos and music tracks from these URLs and
// has no cookie — behind requireAuth they would 401 and never render.
app.get('/api/assets/:id/file', (req, res) => {
  const asset = getAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: 'No such asset' });
  res.setHeader('Content-Type', asset.mime);
  res.sendFile(path.resolve(asset.file));
});

// --- authed APIs ---
app.use('/api', requireAuth);

app.get('/api/me', (req, res) => {
  res.json({ email: sessionFromRequest(req)?.email });
});

app.get('/api/workspace', (req, res) => {
  const ws = getWorkspace();
  const plan = PLANS[ws.plan];
  res.json({
    id: ws.id,
    name: ws.name,
    email: sessionFromRequest(req)?.email,
    plan: { id: plan.id, name: plan.name, ...plan },
    usage: { used: exportsUsedThisMonth(), limit: plan.exportsPerMonth },
    defaultBrandKitId: ws.defaultBrandKitId,
    branding: BRAND,
  });
});

app.get('/api/integrations', (_req, res) => {
  res.json({
    facebook: Boolean(process.env.FB_PAGE_ID && process.env.FB_PAGE_ACCESS_TOKEN),
    make: Boolean(process.env.MAKE_WEBHOOK_URL),
  });
});

app.get('/api/catalog', (_req, res) => {
  const ws = getWorkspace();
  res.json({
    templates: TEMPLATES.map((t) => ({ ...t, locked: t.minPlan === 'pro' && ['free', 'starter'].includes(ws.plan) })),
    storyTypes: STORY_TYPES,
    formats: FORMATS,
    plans: Object.values(PLANS),
  });
});

// --- projects ---
const isHttpUrl = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\/\S+$/i.test(v);
const POST_VIAS: PostVia[] = ['reel', 'facebook', 'make'];
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
const optional = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

function serializeJob(job: ReturnType<typeof listJobs>[number], detail = false) {
  const base = {
    id: job.id,
    createdAt: job.createdAt,
    status: job.status,
    archived: Boolean(job.archived),
    stage: job.stage,
    progress: job.progress,
    captures: job.captures,
    error: job.error,
    hasVideo: Boolean(job.videoFile),
    postedVia: job.postedVia,
    shareToken: job.shareToken,
    params: {
      projectName: job.params.projectName || job.params.clientName,
      clientName: job.params.clientName,
      beforeUrl: job.params.beforeUrl,
      afterUrl: job.params.afterUrl,
      templateId: job.params.templateId ?? 'clean-agency',
      storyType: job.params.storyType,
      industry: job.params.industry,
      format: job.params.style?.format ?? 'reel',
    },
  };
  if (!detail) return base;
  return {
    ...base,
    style: resolveStyle(job.params),
    copy: job.copy ?? null,
    scenes: job.captures?.after && job.status === 'done' ? deriveScenes(jobDir(job)) : [],
  };
}

app.post('/api/projects', (req, res) => {
  const b = req.body ?? {};
  if (!isHttpUrl(b.beforeUrl) || !isHttpUrl(b.afterUrl)) {
    return res.status(400).json({ error: 'Both the before and after URLs must be full http(s) links.' });
  }
  if (typeof b.clientName !== 'string' || !b.clientName.trim()) {
    return res.status(400).json({ error: 'Client / business name is required.' });
  }
  const ws = getWorkspace();
  const plan = PLANS[ws.plan];

  const gate = canExport(plan, exportsUsedThisMonth());
  if (!gate.ok) return res.status(402).json({ error: gate.reason, upgradeTo: gate.upgradeTo });

  const resolution = oneOf(b.resolution, ['720', '1080', '2160'] as const) ?? plan.maxResolution;
  if (resolution !== '720') {
    const rGate = canUseResolution(plan, resolution);
    if (!rGate.ok) return res.status(402).json({ error: rGate.reason, upgradeTo: rGate.upgradeTo });
  }
  let fps: 30 | 60 = b.fps === 60 || b.fps === '60' ? 60 : 30;
  if (fps === 60 && !canUse60fps(plan).ok) fps = 30;

  const templateId = oneOf(b.templateId, TEMPLATES.map((t) => t.id) as [string, ...string[]]) ?? 'clean-agency';
  const tpl = getTemplate(templateId);
  if (tpl.minPlan === 'pro' && ['free', 'starter'].includes(plan.id)) {
    return res.status(402).json({ error: `The ${tpl.name} template is available on Pro and above.`, upgradeTo: 'pro' });
  }

  const kit = optional(b.brandKitId) ? getBrandKit(String(b.brandKitId)) : undefined;

  const params: JobParams = {
    beforeUrl: b.beforeUrl,
    afterUrl: b.afterUrl,
    clientName: b.clientName.trim(),
    projectName: optional(b.projectName),
    templateId,
    storyType: oneOf(b.storyType, STORY_TYPES.map((s) => s.id) as [string, ...string[]]) as JobParams['storyType'],
    industry: optional(b.industry),
    brandKitId: kit?.id ?? null,
    caption: optional(b.caption),
    postVia: POST_VIAS.includes(b.postVia) ? b.postVia : null,
    scrollSpeed: oneOf(b.scrollSpeed, ['slow', 'medium', 'fast'] as const),
    durationTarget: Number(b.durationTarget) >= 12 && Number(b.durationTarget) <= 90 ? Number(b.durationTarget) : null,
    style: {
      format: oneOf(b.format, ['reel', 'square', 'landscape'] as const) ?? 'reel',
      resolution,
      fps,
      watermark: plan.watermark,
      title: optional(b.title),
      tagline: optional(b.tagline),
      cta: optional(b.cta) ?? kit?.defaultCta,
      beforeLabel: optional(b.beforeLabel),
      afterLabel: optional(b.afterLabel),
      brandName: optional(b.brandName) ?? kit?.brandName,
      accentColor: optional(b.accentColor) ?? kit?.accentColor,
      logoUrl: isHttpUrl(b.logoUrl) ? b.logoUrl : kit?.logoAssetId ? `${req.protocol}://${req.get('host')}/api/assets/${kit.logoAssetId}/file` : undefined,
      musicSrc: isHttpUrl(b.musicUrl) ? b.musicUrl : undefined,
    },
  };
  params.style = Object.fromEntries(
    Object.entries(params.style ?? {}).filter(([, v]) => v !== undefined),
  ) as JobParams['style'];
  const job = createJob(params);
  res.status(201).json(serializeJob(job));
});

app.get('/api/projects', (_req, res) => {
  res.json(listJobs().map((j) => serializeJob(j)));
});

app.get('/api/projects/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'No such project' });
  res.json(serializeJob(job, true));
});

app.patch('/api/projects/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'No such project' });
  const b = req.body ?? {};
  if (typeof b.archived === 'boolean') updateJobMeta(job, { archived: b.archived });
  if (optional(b.projectName)) updateJobMeta(job, { params: { ...job.params, projectName: b.projectName.trim() } });
  res.json(serializeJob(job));
});

app.post('/api/projects/:id/rerender', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'No such project' });
  if (!['done', 'error'].includes(job.status)) return res.status(409).json({ error: 'Project is still processing.' });
  if (!fs.existsSync(path.join(jobDir(job), 'before', 'meta.json'))) {
    return res.status(409).json({ error: 'Original captures are gone — create a new project instead.' });
  }
  const ws = getWorkspace();
  const plan = PLANS[ws.plan];
  const gate = canExport(plan, exportsUsedThisMonth());
  if (!gate.ok) return res.status(402).json({ error: gate.reason, upgradeTo: gate.upgradeTo });

  const b = req.body ?? {};
  const tplId = oneOf(b.templateId, TEMPLATES.map((t) => t.id) as [string, ...string[]]);
  const nextTpl = getTemplate(tplId ?? job.params.templateId ?? 'clean-agency');
  if (nextTpl.minPlan === 'pro' && ['free', 'starter'].includes(plan.id)) {
    return res
      .status(402)
      .json({ error: `The ${nextTpl.name} template is available on Pro and above.`, upgradeTo: 'pro' });
  }
  const style = resolveRerenderStyle({
    currentStyle: job.params.style,
    currentTemplateId: job.params.templateId ?? 'clean-agency',
    nextTemplateId: nextTpl.id,
    body: b,
  });
  applyPlanCaps(style, plan);
  rerenderJob(job, { ...(tplId ? { templateId: tplId } : {}), style });
  res.json(serializeJob(job));
});

app.post('/api/projects/:id/duplicate', (req, res) => {
  const src = getJob(req.params.id);
  if (!src) return res.status(404).json({ error: 'No such project' });
  const ws = getWorkspace();
  const plan = PLANS[ws.plan];
  const gate = canExport(plan, exportsUsedThisMonth());
  if (!gate.ok) return res.status(402).json({ error: gate.reason, upgradeTo: gate.upgradeTo });
  const srcTpl = getTemplate(src.params.templateId ?? 'clean-agency');
  if (srcTpl.minPlan === 'pro' && ['free', 'starter'].includes(plan.id)) {
    return res
      .status(402)
      .json({ error: `The ${srcTpl.name} template is available on Pro and above.`, upgradeTo: 'pro' });
  }
  const style: NonNullable<JobParams['style']> = { ...src.params.style };
  applyPlanCaps(style, plan);
  const job = createJob({ ...src.params, projectName: `${src.params.projectName || src.params.clientName} (copy)`, style });
  res.status(201).json(serializeJob(job));
});

app.delete('/api/projects/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'No such project' });
  if (!['done', 'error'].includes(job.status)) return res.status(409).json({ error: 'Project is still processing.' });
  deleteJob(job);
  res.json({ ok: true });
});

app.get('/api/projects/:id/video', (req, res) => {
  const job = getJob(req.params.id);
  if (!job?.videoFile) return res.status(404).json({ error: 'No video for this project' });
  res.sendFile(path.resolve(job.videoFile));
});

app.get('/api/projects/:id/capture/:which(before|after)', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'No such project' });
  res.sendFile(path.join(jobDir(job), req.params.which, 'site.jpg'), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Capture not ready' });
  });
});

app.post('/api/projects/:id/post', async (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'No such project' });
  const via: PostVia = POST_VIAS.includes(req.body?.via) ? req.body.via : 'reel';
  try {
    await postJob(job, via);
    res.json(serializeJob(job));
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/projects/:id/copy', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'No such project' });
  job.copy = generateCopy({
    clientName: job.params.clientName,
    industry: optional(req.body?.industry) ?? job.params.industry,
    storyType: job.params.storyType,
    afterUrl: job.params.afterUrl,
    brandName: job.params.style?.brandName,
  });
  updateJobMeta(job, {});
  res.json(job.copy);
});

// --- brand kits ---
app.get('/api/brandkits', (_req, res) => res.json(listBrandKits()));
app.post('/api/brandkits', (req, res) => {
  const b = req.body ?? {};
  if (!optional(b.name)) return res.status(400).json({ error: 'Give the brand kit a name.' });
  const ws = getWorkspace();
  if (!b.id) {
    const gate = canAddBrandKit(PLANS[ws.plan], listBrandKits().length);
    if (!gate.ok) return res.status(402).json({ error: gate.reason, upgradeTo: gate.upgradeTo });
  }
  res.json(saveBrandKit(b));
});
app.delete('/api/brandkits/:id', (req, res) => {
  res.json({ ok: deleteBrandKit(req.params.id) });
});
app.post('/api/brandkits/:id/default', (req, res) => {
  if (!getBrandKit(req.params.id)) return res.status(404).json({ error: 'No such brand kit' });
  updateWorkspace({ defaultBrandKitId: req.params.id });
  res.json({ ok: true });
});

// --- assets ---
app.get('/api/assets', (req, res) => {
  const kind = oneOf(req.query.kind, ['logo', 'music', 'background', 'export', 'capture'] as const);
  res.json(listAssets(kind).map(({ file, ...a }) => a));
});
app.post('/api/assets', (req, res) => {
  const b = req.body ?? {};
  const kind = oneOf(b.kind, ['logo', 'music', 'background'] as const);
  if (!kind || typeof b.dataUrl !== 'string') return res.status(400).json({ error: 'kind and dataUrl required' });
  try {
    const { file, ...asset } = saveAssetFromDataUrl({ kind, name: optional(b.name) ?? 'Untitled', dataUrl: b.dataUrl });
    res.status(201).json(asset);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
app.delete('/api/assets/:id', (req, res) => {
  res.json({ ok: deleteAsset(req.params.id) });
});

// --- billing (Stripe-ready: swap setPlan for a checkout session later) ---
app.post('/api/billing/plan', (req, res) => {
  const plan = oneOf(req.body?.plan, ['free', 'starter', 'pro', 'agency'] as const);
  if (!plan) return res.status(400).json({ error: 'Unknown plan' });
  // Self-hosted single workspace: switching is immediate. When Stripe lands,
  // this endpoint creates a Checkout session instead.
  updateWorkspace({ plan: plan as PlanId });
  res.json({ ok: true, plan });
});

app.patch('/api/workspace', (req, res) => {
  const name = optional(req.body?.name);
  if (name) updateWorkspace({ name });
  res.json({ ok: true });
});

loadJobs();
app.listen(PORT, () => {
  log(`${BRAND.name} running at http://localhost:${PORT}`);
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    log('WARNING: set ADMIN_EMAIL and ADMIN_PASSWORD in .env — login is disabled until you do.');
  }
});
