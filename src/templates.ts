/**
 * Template registry — templates are data, not code. Each entry maps to the
 * composition's knobs (visual base, pacing, intensity, copy defaults) so new
 * templates are added here without touching the renderer.
 */

export type StoryType =
  | 'redesign-reveal'
  | 'before-after'
  | 'case-study'
  | 'social-ad'
  | 'client-launch'
  | 'agency-showcase';

export type TemplateDef = {
  id: string;
  name: string;
  description: string;
  /** which audiences this shines for (shown in gallery) */
  tags: string[];
  /** visual base rendered by the composition */
  base: 'clean' | 'dark' | 'split';
  /** multiplies scroll-tour dwell + segment pacing (1 = normal) */
  pacing: number;
  intensity: 'subtle' | 'balanced' | 'cinematic';
  accentColor: string;
  musicTag: 'none' | 'cinematic' | 'uplifting' | 'modern-tech' | 'minimal' | 'luxury' | 'energetic';
  copy: {
    title: string;
    tagline: string;
    cta: string;
    beforeLabel: string;
    afterLabel: string;
  };
  /** gallery card art (CSS gradient) */
  preview: { bg: string; fg: string };
  minPlan: 'free' | 'pro';
};

export const TEMPLATES: TemplateDef[] = [
  {
    id: 'clean-agency',
    name: 'Clean Agency',
    description: 'Bright, minimal, Apple-ish. The default for client showcases.',
    tags: ['Agencies', 'Freelancers'],
    base: 'clean',
    pacing: 1,
    intensity: 'balanced',
    accentColor: '#0a84ff',
    musicTag: 'minimal',
    copy: {
      title: 'Website Redesign',
      tagline: 'Your website should work as hard as you do.',
      cta: 'Message us for a redesign',
      beforeLabel: 'BEFORE',
      afterLabel: 'AFTER',
    },
    preview: { bg: 'linear-gradient(135deg,#f5f5f7,#e8eef7)', fg: '#1d1d1f' },
    minPlan: 'free',
  },
  {
    id: 'dark-luxury',
    name: 'Dark Luxury',
    description: 'Near-black, cinematic, slower pacing. For high-end brands.',
    tags: ['Luxury', 'Real estate', 'Hospitality'],
    base: 'dark',
    pacing: 1.15,
    intensity: 'cinematic',
    accentColor: '#d4af6a',
    musicTag: 'luxury',
    copy: {
      title: 'The New Standard',
      tagline: 'Crafted to match the caliber of your work.',
      cta: 'Book a private consultation',
      beforeLabel: 'BEFORE',
      afterLabel: 'AFTER',
    },
    preview: { bg: 'linear-gradient(135deg,#101013,#1d1a24)', fg: '#e9e2d4' },
    minPlan: 'free',
  },
  {
    id: 'split-comparison',
    name: 'Split Comparison',
    description: 'Side-by-side beat before the full reveal. Maximum contrast.',
    tags: ['Dramatic redesigns'],
    base: 'split',
    pacing: 1,
    intensity: 'balanced',
    accentColor: '#0a84ff',
    musicTag: 'modern-tech',
    copy: {
      title: 'Before & After',
      tagline: 'Same business. Whole new first impression.',
      cta: 'Want yours next? DM "WEBSITE"',
      beforeLabel: 'BEFORE',
      afterLabel: 'AFTER',
    },
    preview: { bg: 'linear-gradient(90deg,#f3f4f6 50%,#111318 50%)', fg: '#0a84ff' },
    minPlan: 'free',
  },
  {
    id: 'fast-social-ad',
    name: 'Fast Social Ad',
    description: 'Quick pacing, punchy copy. Built for paid social and hooks.',
    tags: ['Ads', 'TikTok', 'Reels'],
    base: 'clean',
    pacing: 0.72,
    intensity: 'cinematic',
    accentColor: '#f43f5e',
    musicTag: 'energetic',
    copy: {
      title: 'This site was losing them customers.',
      tagline: 'Fixed in one week.',
      cta: 'Your site could be next →',
      beforeLabel: 'THE PROBLEM',
      afterLabel: 'THE FIX',
    },
    preview: { bg: 'linear-gradient(135deg,#fff1f2,#ffe4e6)', fg: '#f43f5e' },
    minPlan: 'free',
  },
  {
    id: 'client-reveal',
    name: 'Client Reveal',
    description: 'Warmer, celebratory pacing for launch-day handoffs.',
    tags: ['Launches', 'Client delivery'],
    base: 'clean',
    pacing: 1.1,
    intensity: 'balanced',
    accentColor: '#16a34a',
    musicTag: 'uplifting',
    copy: {
      title: 'It’s launch day 🎉',
      tagline: 'Welcome to your new home on the internet.',
      cta: 'Go see it live',
      beforeLabel: 'WHERE WE STARTED',
      afterLabel: 'WHERE WE LANDED',
    },
    preview: { bg: 'linear-gradient(135deg,#ecfdf5,#d1fae5)', fg: '#16a34a' },
    minPlan: 'pro',
  },
  {
    id: 'case-study',
    name: 'Portfolio Case Study',
    description: 'Informative pacing and copy. Reads well on LinkedIn.',
    tags: ['LinkedIn', 'Portfolio'],
    base: 'clean',
    pacing: 1.2,
    intensity: 'subtle',
    accentColor: '#334155',
    musicTag: 'minimal',
    copy: {
      title: 'Case Study',
      tagline: 'Strategy, design, and build — under one roof.',
      cta: 'Read the full case study',
      beforeLabel: 'BEFORE',
      afterLabel: 'AFTER',
    },
    preview: { bg: 'linear-gradient(135deg,#f8fafc,#e2e8f0)', fg: '#334155' },
    minPlan: 'pro',
  },
  {
    id: 'local-business',
    name: 'Local Business Upgrade',
    description: 'Friendly and direct. For roofers, salons, restaurants, trades.',
    tags: ['Local', 'Service businesses'],
    base: 'clean',
    pacing: 0.9,
    intensity: 'balanced',
    accentColor: '#d97706',
    musicTag: 'uplifting',
    copy: {
      title: 'A local business, leveled up.',
      tagline: 'Look as good online as you do in person.',
      cta: 'Get your free website quote',
      beforeLabel: 'OLD SITE',
      afterLabel: 'NEW SITE',
    },
    preview: { bg: 'linear-gradient(135deg,#fffbeb,#fef3c7)', fg: '#d97706' },
    minPlan: 'pro',
  },
  {
    id: 'saas-launch',
    name: 'SaaS Launch',
    description: 'Product-led, crisp, made for software redesigns and v2s.',
    tags: ['SaaS', 'Product'],
    base: 'dark',
    pacing: 0.95,
    intensity: 'balanced',
    accentColor: '#7c3aed',
    musicTag: 'modern-tech',
    copy: {
      title: 'v2.0 is here',
      tagline: 'Rebuilt for speed, clarity, and conversion.',
      cta: 'See what’s new',
      beforeLabel: 'v1',
      afterLabel: 'v2',
    },
    preview: { bg: 'linear-gradient(135deg,#171123,#2b1d4d)', fg: '#a78bfa' },
    minPlan: 'pro',
  },
];

export const getTemplate = (id: string): TemplateDef =>
  TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];

export const STORY_TYPES: { id: StoryType; name: string; blurb: string; suggestedTemplate: string }[] = [
  { id: 'redesign-reveal', name: 'Redesign reveal', blurb: 'The classic glow-up: old site, swipe, new site.', suggestedTemplate: 'clean-agency' },
  { id: 'before-after', name: 'Before / after comparison', blurb: 'Maximum contrast with a side-by-side beat.', suggestedTemplate: 'split-comparison' },
  { id: 'case-study', name: 'Portfolio case study', blurb: 'Calmer pacing, professional copy, LinkedIn-ready.', suggestedTemplate: 'case-study' },
  { id: 'social-ad', name: 'Social media ad', blurb: 'Punchy hook and fast cuts for paid or organic reach.', suggestedTemplate: 'fast-social-ad' },
  { id: 'client-launch', name: 'Client launch video', blurb: 'Celebratory reveal to hand your client on launch day.', suggestedTemplate: 'client-reveal' },
  { id: 'agency-showcase', name: 'Agency showcase', blurb: 'Show the caliber of your studio’s work.', suggestedTemplate: 'dark-luxury' },
];

export type VideoFormat = 'reel' | 'square' | 'landscape';

export const FORMATS: { id: VideoFormat; name: string; dims: string; use: string }[] = [
  { id: 'reel', name: 'Reel / TikTok / Story', dims: '1080 × 1920', use: 'Instagram, TikTok, Facebook Reels, Stories' },
  { id: 'square', name: 'Square post', dims: '1080 × 1080', use: 'Feed posts, carousels' },
  { id: 'landscape', name: 'Landscape', dims: '1920 × 1080', use: 'LinkedIn, YouTube, websites' },
];
