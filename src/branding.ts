/**
 * Product branding — kept in one module so a rename is a one-file change.
 * Client-side pages read the same values from /api/branding.
 */
export const BRAND = {
  name: 'ReelForge',
  tagline: 'Turn website redesigns into scroll-stopping videos.',
  description:
    'Paste two URLs — your client’s old site and your redesign — and get a cinematic before/after video, ready for Instagram, TikTok, Facebook and LinkedIn.',
  /** Shown on watermarked (free plan) exports. */
  watermarkText: 'Made with ReelForge',
  supportEmail: 'support@reelforge.app',
  /** Accent used across UI and default video template. */
  accent: '#0a84ff',
} as const;

export type Brand = typeof BRAND;
