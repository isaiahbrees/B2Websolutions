import React from 'react';
import { AbsoluteFill, Img, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { useCanvas } from '../canvas';
import { type SiteMeta } from '../schema';
import { font, type Theme } from '../theme';

const resolveSrc = (src: string) => (src.startsWith('http') ? src : staticFile(src));

/** Side-by-side moment for the Split Comparison template. */
export const SplitBeat: React.FC<{
  beforeImage: string;
  afterImage: string;
  beforeMeta: SiteMeta;
  afterMeta: SiteMeta;
  beforeLabel: string;
  afterLabel: string;
  theme: Theme;
}> = ({ beforeImage, afterImage, beforeMeta, afterMeta, beforeLabel, afterLabel, theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { W, H } = useCanvas();
  const halfW = (W - 150) / 2;
  const paneH = Math.min(Math.round(halfW * 1.65), H - 320);

  const pane = (
    img: string,
    meta: SiteMeta,
    label: string,
    color: string,
    delaySec: number,
    grade?: string,
  ) => {
    const s = spring({ frame: frame - Math.round(fps * delaySec), fps, config: { damping: 15, mass: 0.7 } });
    return (
      <div
        style={{
          opacity: s,
          transform: `translateY(${(1 - s) * 46}px)`,
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
          alignItems: 'center',
        }}
      >
        <div
          style={{
            background: color,
            color: '#fff',
            fontWeight: 800,
            fontSize: 24,
            letterSpacing: 4,
            padding: '9px 24px',
            borderRadius: 999,
          }}
        >
          {label}
        </div>
        <div
          style={{
            width: halfW,
            height: paneH,
            borderRadius: 18,
            overflow: 'hidden',
            background: theme.cardBg,
            boxShadow: theme.frameShadow,
          }}
        >
          <Img
            src={resolveSrc(img)}
            style={{ width: halfW, display: 'block', filter: grade }}
            onError={() => {}}
          />
        </div>
      </div>
    );
  };

  return (
    <AbsoluteFill
      style={{
        background: theme.bg,
        fontFamily: font,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 40,
        flexDirection: 'row',
        display: 'flex',
      }}
    >
      {pane(beforeImage, beforeMeta, beforeLabel, theme.before, 0, 'saturate(0.8) contrast(0.97)')}
      {pane(afterImage, afterMeta, afterLabel, theme.after, 0.14)}
    </AbsoluteFill>
  );
};
