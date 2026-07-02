import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { PLANS, type PlanId } from './plans';
import { ensureDir, readJson, writeJson } from '../util';

/**
 * Data layer. JSON-file repositories today, Postgres tomorrow: every access
 * goes through this module and the shapes mirror the future tables
 * (workspaces, brand_kits, assets, usage_ledger). Swap the persistence here
 * and nothing above changes.
 */

const DATA_DIR = path.resolve('data');

export type Workspace = {
  id: string;
  name: string;
  ownerEmail: string;
  plan: PlanId;
  createdAt: string;
  /** future: stripeCustomerId, stripeSubscriptionId */
  stripeCustomerId: string | null;
  defaultBrandKitId: string | null;
};

export type BrandKit = {
  id: string;
  workspaceId: string;
  name: string;
  brandName: string;
  website: string;
  logoAssetId: string | null;
  primaryColor: string;
  accentColor: string;
  font: string;
  defaultCta: string;
  socialHandle: string;
  endCardMessage: string;
  musicPreference: 'none' | 'cinematic' | 'uplifting' | 'modern-tech' | 'minimal' | 'luxury' | 'energetic';
  createdAt: string;
  updatedAt: string;
};

export type Asset = {
  id: string;
  workspaceId: string;
  kind: 'logo' | 'music' | 'background' | 'export' | 'capture';
  name: string;
  file: string; // path under data/assets
  mime: string;
  size: number;
  createdAt: string;
};

export type UsageEntry = {
  id: string;
  workspaceId: string;
  projectId: string;
  kind: 'export';
  month: string; // YYYY-MM
  createdAt: string;
};

type Db = {
  workspaces: Workspace[];
  brandKits: BrandKit[];
  assets: Asset[];
  usage: UsageEntry[];
};

const DB_FILE = path.join(DATA_DIR, 'db.json');

let cache: Db | null = null;

function load(): Db {
  if (cache) return cache;
  if (fs.existsSync(DB_FILE)) {
    try {
      cache = readJson<Db>(DB_FILE);
      return cache!;
    } catch {
      /* corrupted — start fresh but keep a backup */
      fs.copyFileSync(DB_FILE, `${DB_FILE}.corrupt-${Date.now()}`);
    }
  }
  cache = { workspaces: [], brandKits: [], assets: [], usage: [] };
  return cache;
}

function save(): void {
  ensureDir(DATA_DIR);
  writeJson(DB_FILE, load());
}

export const newId = () => crypto.randomUUID().slice(0, 8);
export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

// --- workspace -------------------------------------------------------------

/** Single-workspace mode today; the model is multi-workspace-ready. */
export function getWorkspace(): Workspace {
  const db = load();
  if (db.workspaces.length === 0) {
    // A typo'd PLAN env var must not 500 every request downstream.
    const envPlan = process.env.PLAN as PlanId | undefined;
    db.workspaces.push({
      id: newId(),
      name: process.env.WORKSPACE_NAME || 'My Workspace',
      ownerEmail: process.env.ADMIN_EMAIL || 'owner@example.com',
      plan: envPlan && envPlan in PLANS ? envPlan : 'pro',
      createdAt: new Date().toISOString(),
      stripeCustomerId: null,
      defaultBrandKitId: null,
    });
    save();
  }
  const ws = db.workspaces[0];
  // Heal a workspace persisted with an invalid plan (e.g. old env typo).
  if (!(ws.plan in PLANS)) ws.plan = 'pro';
  return ws;
}

export function updateWorkspace(patch: Partial<Pick<Workspace, 'name' | 'plan' | 'defaultBrandKitId'>>): Workspace {
  const ws = getWorkspace();
  Object.assign(ws, patch);
  save();
  return ws;
}

// --- brand kits --------------------------------------------------------------

export function listBrandKits(): BrandKit[] {
  return load().brandKits.filter((b) => b.workspaceId === getWorkspace().id);
}

export function getBrandKit(id: string): BrandKit | undefined {
  return listBrandKits().find((b) => b.id === id);
}

// Whitelist for saveBrandKit — request bodies must not be able to reassign
// id/workspaceId/createdAt (classic mass-assignment).
const KIT_FIELDS = [
  'name',
  'brandName',
  'website',
  'logoAssetId',
  'primaryColor',
  'accentColor',
  'font',
  'defaultCta',
  'socialHandle',
  'endCardMessage',
  'musicPreference',
] as const;

export function saveBrandKit(input: Partial<BrandKit> & { name: string }): BrandKit {
  const db = load();
  const ws = getWorkspace();
  const existing = input.id ? db.brandKits.find((b) => b.id === input.id) : undefined;
  if (existing) {
    for (const key of KIT_FIELDS) {
      if (input[key] !== undefined) (existing as Record<string, unknown>)[key] = input[key];
    }
    existing.updatedAt = new Date().toISOString();
    save();
    return existing;
  }
  const kit: BrandKit = {
    id: newId(),
    workspaceId: ws.id,
    name: input.name,
    brandName: input.brandName ?? input.name,
    website: input.website ?? '',
    logoAssetId: input.logoAssetId ?? null,
    primaryColor: input.primaryColor ?? '#1d1d1f',
    accentColor: input.accentColor ?? '#0a84ff',
    font: input.font ?? 'Inter',
    defaultCta: input.defaultCta ?? 'Message us for a redesign',
    socialHandle: input.socialHandle ?? '',
    endCardMessage: input.endCardMessage ?? 'Your website should work as hard as you do.',
    musicPreference: input.musicPreference ?? 'none',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.brandKits.push(kit);
  if (!ws.defaultBrandKitId) ws.defaultBrandKitId = kit.id;
  save();
  return kit;
}

export function deleteBrandKit(id: string): boolean {
  const db = load();
  const before = db.brandKits.length;
  db.brandKits = db.brandKits.filter((b) => b.id !== id);
  const ws = getWorkspace();
  if (ws.defaultBrandKitId === id) ws.defaultBrandKitId = db.brandKits[0]?.id ?? null;
  save();
  return db.brandKits.length < before;
}

// --- assets ------------------------------------------------------------------

export const ASSETS_DIR = path.join(DATA_DIR, 'assets');

export function listAssets(kind?: Asset['kind']): Asset[] {
  const all = load().assets.filter((a) => a.workspaceId === getWorkspace().id);
  return kind ? all.filter((a) => a.kind === kind) : all;
}

export function getAsset(id: string): Asset | undefined {
  return listAssets().find((a) => a.id === id);
}

export function saveAssetFromDataUrl(opts: {
  kind: Asset['kind'];
  name: string;
  dataUrl: string;
}): Asset {
  const m = opts.dataUrl.match(/^data:([\w/+.-]+);base64,(.+)$/s);
  if (!m) throw new Error('Expected a base64 data URL');
  const mime = m[1];
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 8 * 1024 * 1024) throw new Error('Asset too large (8MB max)');
  const ext = mime.split('/')[1]?.replace('svg+xml', 'svg') || 'bin';
  const id = newId();
  ensureDir(ASSETS_DIR);
  const file = path.join(ASSETS_DIR, `${id}.${ext}`);
  fs.writeFileSync(file, buf);
  const asset: Asset = {
    id,
    workspaceId: getWorkspace().id,
    kind: opts.kind,
    name: opts.name.slice(0, 80),
    file,
    mime,
    size: buf.length,
    createdAt: new Date().toISOString(),
  };
  load().assets.push(asset);
  save();
  return asset;
}

export function deleteAsset(id: string): boolean {
  const db = load();
  const asset = db.assets.find((a) => a.id === id);
  if (!asset) return false;
  fs.rmSync(asset.file, { force: true });
  db.assets = db.assets.filter((a) => a.id !== id);
  save();
  return true;
}

// --- usage -------------------------------------------------------------------

export function recordExport(projectId: string): void {
  const db = load();
  db.usage.push({
    id: newId(),
    workspaceId: getWorkspace().id,
    projectId,
    kind: 'export',
    month: monthKey(),
    createdAt: new Date().toISOString(),
  });
  save();
}

export function exportsUsedThisMonth(): number {
  const ws = getWorkspace();
  const month = monthKey();
  return load().usage.filter((u) => u.workspaceId === ws.id && u.month === month && u.kind === 'export').length;
}
