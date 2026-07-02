export const font =
  "'Inter', -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export type Theme = {
  /** page background behind the browser frame */
  bg: string;
  bgBefore: string;
  bgAfter: string;
  cardBg: string;
  text: string;
  textDim: string;
  chrome: string;
  chromeBar: string;
  chromeText: string;
  frameShadow: string;
  flash: string;
  before: string;
  after: string;
};

/** Clean Agency — bright, minimal, Apple-ish. */
const clean: Theme = {
  bg: '#f5f5f7',
  bgBefore: 'linear-gradient(180deg, #f7f2f1 0%, #f5f5f7 60%)',
  bgAfter: 'linear-gradient(180deg, #eff5f2 0%, #f5f5f7 60%)',
  cardBg: '#ffffff',
  text: '#1d1d1f',
  textDim: '#86868b',
  chrome: '#ffffff',
  chromeBar: '#f0f0f2',
  chromeText: '#86868b',
  frameShadow: '0 30px 80px rgba(0,0,0,0.16), 0 4px 16px rgba(0,0,0,0.08)',
  flash: '#ffffff',
  before: '#e8590c',
  after: '#0a9962',
};

/** Dark Luxury — near-black, deeper shadows, cinematic. */
const dark: Theme = {
  bg: '#0b0b0d',
  bgBefore: 'radial-gradient(120% 80% at 50% 0%, #1c1113 0%, #0b0b0d 70%)',
  bgAfter: 'radial-gradient(120% 80% at 50% 0%, #0f1a16 0%, #0b0b0d 70%)',
  cardBg: '#151518',
  text: '#f5f5f7',
  textDim: '#98989f',
  chrome: '#1a1a1e',
  chromeBar: '#242429',
  chromeText: '#98989f',
  frameShadow: '0 50px 120px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.07)',
  flash: '#e9e9ee',
  before: '#ff6b5e',
  after: '#3ddc97',
};

export function getTheme(template: 'clean' | 'dark' | 'split'): Theme {
  // Split comparison uses the clean look with its own timeline structure.
  return template === 'dark' ? dark : clean;
}
