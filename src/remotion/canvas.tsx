import React, { createContext, useContext } from 'react';

/** Design canvas per output format. Components lay out against these and the
 * whole canvas scales for 4K exports. */
export const FORMAT_DIMS = {
  reel: { w: 1080, h: 1920 },
  square: { w: 1080, h: 1080 },
  landscape: { w: 1920, h: 1080 },
} as const;

export type VideoFormat = keyof typeof FORMAT_DIMS;

export const CanvasCtx = createContext<{ W: number; H: number }>({ W: 1080, H: 1920 });
export const useCanvas = () => useContext(CanvasCtx);
