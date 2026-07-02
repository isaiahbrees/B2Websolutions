import { fbCredsFromEnv, postFeedVideo, postReel } from './facebook';
import { postViaMake } from './make';

export type PostVia = 'facebook' | 'reel' | 'make';

export async function postVideo(
  via: PostVia,
  videoPath: string,
  caption: string,
  client: string,
): Promise<string | undefined> {
  if (via === 'make') {
    const url = process.env.MAKE_WEBHOOK_URL;
    if (!url) throw new Error('Set MAKE_WEBHOOK_URL in .env to post via Make.');
    await postViaMake(url, videoPath, caption, client);
    return undefined;
  }
  if (via === 'reel') {
    return postReel(fbCredsFromEnv(), videoPath, caption);
  }
  return postFeedVideo(fbCredsFromEnv(), videoPath, caption);
}

export function defaultCaption(opts: {
  headline?: string;
  clientName: string;
  cta?: string;
}): string {
  return `${opts.headline ?? 'This website was costing them customers.'}\n\nBefore ➜ After for ${opts.clientName}.\n${opts.cta ?? 'Want a site that converts? DM us "WEBSITE"'}`;
}
