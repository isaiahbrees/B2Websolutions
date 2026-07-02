import type { StoryType } from '../templates';

/**
 * Social copy generator. Deterministic templates today (works offline, zero
 * cost); the function signature is the seam where an LLM call slots in later
 * without touching any caller.
 */

export type GeneratedCopy = {
  hooks: string[];
  captions: { instagram: string; tiktok: string; facebook: string; linkedin: string };
  hashtags: string[];
  deliveryMessage: string;
};

type CopyInput = {
  clientName: string;
  industry?: string;
  storyType?: StoryType;
  afterUrl?: string;
  brandName?: string;
  socialHandle?: string;
};

const pick = <T>(arr: T[], seed: string): T => {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return arr[h % arr.length];
};

export function generateCopy(input: CopyInput): GeneratedCopy {
  const client = input.clientName.trim() || 'this business';
  const industry = (input.industry || '').toLowerCase();
  const brand = input.brandName || 'our studio';
  const handle = input.socialHandle ? ` ${input.socialHandle}` : '';
  const site = input.afterUrl ? input.afterUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') : '';
  const seed = client + (input.storyType ?? '');

  const hooks = [
    `This website was costing ${client} customers.`,
    `${client} deserved better than their old website.`,
    `We gave ${client} a website that finally matches their work.`,
    `Old site: forgettable. New site: unforgettable.`,
    `Watch this ${industry || 'business'} website glow up.`,
  ];

  const industryTags: Record<string, string[]> = {
    restaurant: ['#restaurantmarketing', '#localbusiness'],
    roofing: ['#roofing', '#contractormarketing'],
    salon: ['#salonlife', '#beautybusiness'],
    'real estate': ['#realestatemarketing', '#realtor'],
    saas: ['#saas', '#productdesign'],
    ecommerce: ['#ecommerce', '#shopify'],
  };
  const baseTags = ['#webdesign', '#websiteredesign', '#beforeandafter', '#webdesigner', '#smallbusiness'];
  const hashtags = [...baseTags, ...(industryTags[industry] ?? [])].slice(0, 8);

  const hook = pick(hooks, seed);
  const cta = site ? `See it live → ${site}` : `Want yours next? DM us "WEBSITE".`;

  const captions = {
    instagram: `${hook}\n\nSwipe-stopping before → after for ${client}. Designed & built by ${brand}${handle}.\n\n${cta}\n\n${hashtags.join(' ')}`,
    tiktok: `${hook} 🤯 #beforeandafter\n\nFull redesign for ${client} — watch till the reveal.\n${hashtags.slice(0, 5).join(' ')}`,
    facebook: `${hook}\n\nWe just launched a complete redesign for ${client}. Faster, cleaner, and built to turn visitors into customers.\n\n${cta}`,
    linkedin: `Before → after: ${client}.\n\nWhat changed:\n• A clear message above the fold\n• A design that builds trust in seconds\n• Calls-to-action people actually click\n\nDesigned and built by ${brand}. ${site ? `Live at ${site}.` : ''}\n\n#webdesign #casestudy #uxdesign`,
  };

  const deliveryMessage = `Hi! Your new website video is ready 🎉\n\nWe put together a short before/after reel of ${client}'s redesign — perfect for posting on your social pages (feel free to tag ${brand}${handle}).\n\nDownload it here and let us know what you think!`;

  return { hooks, captions, hashtags, deliveryMessage };
}
