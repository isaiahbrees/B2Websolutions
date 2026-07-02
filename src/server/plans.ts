/**
 * Plan catalog + usage enforcement. Stripe-ready: plan ids map 1:1 to future
 * Stripe price ids, and every gate goes through `can()` so swapping the
 * billing source of truth later touches nothing else.
 */

export type PlanId = 'free' | 'starter' | 'pro' | 'agency' | 'enterprise';

export type Plan = {
  id: PlanId;
  name: string;
  priceMonthly: number | null; // null = custom
  exportsPerMonth: number;
  maxResolution: '720' | '1080' | '2160';
  watermark: boolean;
  brandKits: number;
  fps60: boolean;
  aiCopy: boolean;
  whiteLabelShare: boolean;
  teamSeats: number;
  priorityQueue: boolean;
  highlights: string[];
};

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    priceMonthly: 0,
    exportsPerMonth: 3,
    maxResolution: '720',
    watermark: true,
    brandKits: 0,
    fps60: false,
    aiCopy: false,
    whiteLabelShare: false,
    teamSeats: 1,
    priorityQueue: false,
    highlights: ['3 exports / month', '720p, watermarked', 'Core templates'],
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    priceMonthly: 29,
    exportsPerMonth: 20,
    maxResolution: '1080',
    watermark: false,
    brandKits: 1,
    fps60: true,
    aiCopy: false,
    whiteLabelShare: false,
    teamSeats: 1,
    priorityQueue: false,
    highlights: ['20 videos / month', '1080p, no watermark', 'Brand kit', 'All core templates'],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceMonthly: 79,
    exportsPerMonth: 75,
    maxResolution: '2160',
    watermark: false,
    brandKits: 5,
    fps60: true,
    aiCopy: true,
    whiteLabelShare: false,
    teamSeats: 1,
    priorityQueue: true,
    highlights: ['75 videos / month', '4K export', 'AI captions & social copy', 'Multiple brand kits', 'Priority rendering'],
  },
  agency: {
    id: 'agency',
    name: 'Agency',
    priceMonthly: 199,
    exportsPerMonth: 250,
    maxResolution: '2160',
    watermark: false,
    brandKits: 50,
    fps60: true,
    aiCopy: true,
    whiteLabelShare: true,
    teamSeats: 5,
    priorityQueue: true,
    highlights: ['250 videos / month', 'Client brand kits', 'White-label delivery pages', 'Team seats', 'Priority support'],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    priceMonthly: null,
    exportsPerMonth: 10_000,
    maxResolution: '2160',
    watermark: false,
    brandKits: 1_000,
    fps60: true,
    aiCopy: true,
    whiteLabelShare: true,
    teamSeats: 100,
    priorityQueue: true,
    highlights: ['Custom usage', 'API access', 'Dedicated rendering', 'SSO', 'Custom templates'],
  },
};

export type Gate =
  | { ok: true }
  | { ok: false; reason: string; upgradeTo: PlanId };

export function canExport(plan: Plan, usedThisMonth: number): Gate {
  if (usedThisMonth >= plan.exportsPerMonth) {
    return {
      ok: false,
      reason: `You've used all ${plan.exportsPerMonth} exports on the ${plan.name} plan this month.`,
      upgradeTo: plan.id === 'free' ? 'starter' : plan.id === 'starter' ? 'pro' : 'agency',
    };
  }
  return { ok: true };
}

export function canUseResolution(plan: Plan, resolution: '1080' | '2160'): Gate {
  if (resolution === '2160' && plan.maxResolution !== '2160') {
    return { ok: false, reason: '4K export is available on Pro and above.', upgradeTo: 'pro' };
  }
  if (resolution === '1080' && plan.maxResolution === '720') {
    return { ok: false, reason: '1080p export is available on Starter and above.', upgradeTo: 'starter' };
  }
  return { ok: true };
}

export function canUse60fps(plan: Plan): Gate {
  return plan.fps60
    ? { ok: true }
    : { ok: false, reason: '60fps export is available on Starter and above.', upgradeTo: 'starter' };
}

export function canAddBrandKit(plan: Plan, existing: number): Gate {
  return existing < plan.brandKits
    ? { ok: true }
    : {
        ok: false,
        reason:
          plan.brandKits === 0
            ? 'Brand kits are available on Starter and above.'
            : `The ${plan.name} plan includes ${plan.brandKits} brand kit${plan.brandKits === 1 ? '' : 's'}.`,
        upgradeTo: plan.brandKits === 0 ? 'starter' : plan.id === 'starter' ? 'pro' : 'agency',
      };
}
