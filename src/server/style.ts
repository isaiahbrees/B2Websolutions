import { getTemplate } from '../templates';
import { canUse60fps, canUseResolution, type Plan } from './plans';
import type { JobParams } from './jobs';

/**
 * Style-override resolution, kept free of heavy imports so it can be unit
 * tested without express/playwright/remotion in scope.
 */

const optional = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

const COPY_FIELDS = ['title', 'tagline', 'cta', 'beforeLabel', 'afterLabel', 'brandName', 'accentColor'] as const;
const INTENSITIES = ['subtle', 'balanced', 'cinematic'] as const;

/**
 * Compute the stored style override set for a re-render. An override only
 * exists where the user diverged from the template — values that merely
 * restate a template's defaults are dropped, otherwise switching templates
 * is inert because the old template's copy shadows the new one.
 *
 * `body` is the raw request body; only fields present in it are treated as
 * user edits (the editor sends touched fields only).
 */
export function resolveRerenderStyle(opts: {
  currentStyle: JobParams['style'];
  currentTemplateId: string;
  nextTemplateId: string;
  body: Record<string, unknown>;
}): NonNullable<JobParams['style']> {
  const prevTpl = getTemplate(opts.currentTemplateId);
  const nextTpl = getTemplate(opts.nextTemplateId);
  const switching = nextTpl.id !== prevTpl.id;
  const tplDefaults = (t: typeof nextTpl): Record<string, string> => ({ ...t.copy, accentColor: t.accentColor });
  const prevDef = tplDefaults(prevTpl);
  const nextDef = tplDefaults(nextTpl);

  const style: NonNullable<JobParams['style']> = { ...opts.currentStyle };
  for (const key of COPY_FIELDS) {
    if (style[key] !== undefined && style[key] === prevDef[key]) delete style[key];
    if (!(key in opts.body)) continue;
    const v = optional(opts.body[key]);
    if (!v || v === nextDef[key] || (switching && v === prevDef[key])) delete style[key];
    else style[key] = v;
  }
  if (style.intensity && style.intensity === prevTpl.intensity) delete style.intensity;
  if ('intensity' in opts.body) {
    const v = INTENSITIES.find((x) => x === opts.body.intensity);
    if (!v || v === nextTpl.intensity || (switching && v === prevTpl.intensity)) delete style.intensity;
    else style.intensity = v;
  }
  return style;
}

/**
 * Plan-derived style fields (watermark, resolution, fps) are re-derived from
 * the CURRENT plan every time a job is queued — not frozen at creation — so
 * upgrades and downgrades apply to re-renders and duplicates too.
 */
export function applyPlanCaps(style: NonNullable<JobParams['style']>, plan: Plan): void {
  style.watermark = plan.watermark;
  if (style.fps === 60 && !canUse60fps(plan).ok) style.fps = 30;
  if ((style.resolution === '1080' || style.resolution === '2160') && !canUseResolution(plan, style.resolution).ok) {
    style.resolution = plan.maxResolution;
  }
}
