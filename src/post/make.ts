import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from '../util';

/**
 * Hand the finished video to a Make.com scenario via a custom webhook.
 * Zero Meta-app setup: let Make's Facebook Pages module do the posting
 * (it handles OAuth to client pages, scheduling, retries).
 *
 * Scenario shape: Custom webhook -> Facebook Pages "Upload a Video/Reel"
 * mapping `file` and `caption` from the webhook payload.
 */
export async function postViaMake(
  webhookUrl: string,
  videoPath: string,
  caption: string,
  clientName: string,
): Promise<void> {
  const bytes = await fs.readFile(videoPath);
  const form = new FormData();
  form.append('caption', caption);
  form.append('client', clientName);
  form.append('file', new Blob([bytes], { type: 'video/mp4' }), path.basename(videoPath));

  log(`sending ${videoPath} to Make webhook…`);
  const res = await fetch(webhookUrl, { method: 'POST', body: form });
  if (!res.ok) {
    throw new Error(`Make webhook failed (HTTP ${res.status}): ${await res.text()}`);
  }
  log('Make webhook accepted the video');
}
