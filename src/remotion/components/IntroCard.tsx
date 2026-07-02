import React from 'react';
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { useCanvas } from '../canvas';
import { font, type Theme } from '../theme';

/** Minimal opening card: title, business name, brand mark. */
export const IntroCard: React.FC<{
  title: string;
  clientName: string;
  brandName: string;
  logoUrl: string | null;
  accentColor: string;
  theme: Theme;
}> = ({ title, clientName, brandName, logoUrl, accentColor, theme }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { H } = useCanvas();
  const titleIn = spring({ frame, fps, config: { damping: 16, mass: 0.7 } });
  const nameIn = spring({ frame: frame - Math.round(fps * 0.25), fps, config: { damping: 200 } });
  const brandIn = spring({ frame: frame - Math.round(fps * 0.5), fps, config: { damping: 200 } });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - Math.round(fps * 0.3), durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp' },
  );

  return (
    <AbsoluteFill
      style={{
        background: theme.bg,
        justifyContent: 'center',
        alignItems: 'center',
        fontFamily: font,
        padding: 90,
        gap: 34,
        opacity: fadeOut,
      }}
    >
      <div
        style={{
          fontSize: 96,
          fontWeight: 800,
          letterSpacing: -2.5,
          color: theme.text,
          textAlign: 'center',
          lineHeight: 1.08,
          opacity: titleIn,
          transform: `translateY(${(1 - titleIn) * 34}px)`,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 44,
          fontWeight: 600,
          color: theme.textDim,
          opacity: nameIn,
          transform: `translateY(${(1 - nameIn) * 24}px)`,
        }}
      >
        {clientName} — before &amp; after
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: Math.round(H * 0.068),
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          opacity: brandIn,
        }}
      >
        {logoUrl ? (
          <Img src={logoUrl} style={{ height: 52, maxWidth: 220, objectFit: 'contain' }} onError={() => {}} />
        ) : (
          <div style={{ width: 14, height: 14, borderRadius: 7, background: accentColor }} />
        )}
        <div style={{ fontSize: 32, fontWeight: 700, color: theme.text, letterSpacing: -0.5 }}>
          {brandName}
        </div>
      </div>
    </AbsoluteFill>
  );
};
