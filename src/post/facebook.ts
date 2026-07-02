import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from '../util';

const GRAPH = 'https://graph.facebook.com/v21.0';
const GRAPH_VIDEO = 'https://graph-video.facebook.com/v21.0';

type FbCreds = { pageId: string; token: string };

export function fbCredsFromEnv(): FbCreds {
  const pageId = process.env.FB_PAGE_ID;
  const token = process.env.FB_PAGE_ACCESS_TOKEN;
  if (!pageId || !token) {
    throw new Error(
      'Set FB_PAGE_ID and FB_PAGE_ACCESS_TOKEN in .env (see .env.example and README "Getting a Facebook token").',
    );
  }
  return { pageId, token };
}

async function graphError(res: Response, step: string): Promise<never> {
  const body = await res.text().catch(() => '<no body>');
  throw new Error(`Facebook ${step} failed (HTTP ${res.status}): ${body}`);
}

/**
 * Post an mp4 to the Page feed as a regular video post.
 * Fine for files up to ~100MB; beyond that switch to the resumable API.
 */
export async function postFeedVideo(
  { pageId, token }: FbCreds,
  videoPath: string,
  description: string,
): Promise<string> {
  const bytes = await fs.readFile(videoPath);
  const form = new FormData();
  form.append('description', description);
  form.append('access_token', token);
  form.append('source', new Blob([bytes], { type: 'video/mp4' }), path.basename(videoPath));

  log(`uploading ${videoPath} (${(bytes.length / 1e6).toFixed(1)} MB) to page ${pageId}…`);
  const res = await fetch(`${GRAPH_VIDEO}/${pageId}/videos`, { method: 'POST', body: form });
  if (!res.ok) await graphError(res, 'video upload');
  const json = (await res.json()) as { id: string };
  log(`posted feed video, id=${json.id}`);
  return json.id;
}

/**
 * Publish as a Reel (what Facebook's algorithm currently favors for
 * short vertical video). Three-phase flow: start -> upload bytes -> finish.
 */
export async function postReel(
  { pageId, token }: FbCreds,
  videoPath: string,
  description: string,
): Promise<string> {
  const startParams = new URLSearchParams({ upload_phase: 'start', access_token: token });
  const startRes = await fetch(`${GRAPH}/${pageId}/video_reels?${startParams}`, {
    method: 'POST',
  });
  if (!startRes.ok) await graphError(startRes, 'reel start');
  const { video_id, upload_url } = (await startRes.json()) as {
    video_id: string;
    upload_url: string;
  };

  const bytes = await fs.readFile(videoPath);
  log(`uploading reel ${videoPath} (${(bytes.length / 1e6).toFixed(1)} MB)…`);
  const uploadRes = await fetch(upload_url, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${token}`,
      offset: '0',
      file_size: String(bytes.length),
      'Content-Type': 'application/octet-stream',
    },
    body: bytes,
  });
  if (!uploadRes.ok) await graphError(uploadRes, 'reel upload');

  const finishParams = new URLSearchParams({
    upload_phase: 'finish',
    video_id,
    video_state: 'PUBLISHED',
    description,
    access_token: token,
  });
  const finishRes = await fetch(`${GRAPH}/${pageId}/video_reels?${finishParams}`, {
    method: 'POST',
  });
  if (!finishRes.ok) await graphError(finishRes, 'reel finish');

  // Publishing is async on Meta's side; poll a little so failures surface here.
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const statusRes = await fetch(
      `${GRAPH}/${video_id}?fields=status&access_token=${encodeURIComponent(token)}`,
    );
    if (!statusRes.ok) break;
    const status = ((await statusRes.json()) as any)?.status;
    const phase = status?.processing_phase?.status ?? status?.video_status ?? 'unknown';
    log(`reel ${video_id} status: ${phase}`);
    if (phase === 'complete' || phase === 'ready') break;
    if (phase === 'error') throw new Error(`Reel processing failed: ${JSON.stringify(status)}`);
  }
  log(`posted reel, id=${video_id}`);
  return video_id;
}
