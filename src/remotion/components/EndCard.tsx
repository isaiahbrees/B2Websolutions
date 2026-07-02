import React from 'react';
import { AbsoluteFill, Img, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { font, type Theme } from '../theme';

export const EndCard: React.FC<{
  tagline: string;
  brandName: string;
  services: string;
  cta: string;
  logoUrl: string | null;
  accentColor: string;
  theme: Theme;
}> = ({ tagline, brandName, services, cta, logoUrl, accentColor, theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const at = (delaySec: number, cfg: { damping: number } = { damping: 200 }) =>
    spring({ frame: frame - Math.round(fps * delaySec), fps, config: cfg });
  const taglineIn = at(0, { damping: 16 });
  const brandIn = at(0.25);
  const servicesIn = at(0.4);
  const ctaIn = at(0.6);

  return (
    <AbsoluteFill
      style={{
        background: theme.bg,
        justifyContent: 'center',
        alignItems: 'center',
        fontFamily: font,
        gap: 30,
        padding: 90,
      }}
    >
      <div
        style={{
          fontSize: 66,
          fontWeight: 800,
          letterSpacing: -1.5,
          color: theme.text,
          textAlign: 'center',
          lineHeight: 1.15,
          maxWidth: 880,
          opacity: taglineIn,
          transform: `translateY(${(1 - taglineIn) * 30}px)`,
        }}
      >
        {tagline}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          marginTop: 26,
          opacity: brandIn,
          transform: `translateY(${(1 - brandIn) * 22}px)`,
        }}
      >
        {logoUrl ? (
          <Img src={logoUrl} style={{ height: 58, maxWidth: 240, objectFit: 'contain' }} onError={() => {}} />
        ) : null}
        <div style={{ fontSize: 52, fontWeight: 800, letterSpacing: -1, color: theme.text }}>
          {brandName}
        </div>
      </div>
      <div style={{ fontSize: 32, fontWeight: 500, color: theme.textDim, opacity: servicesIn }}>
        {services}
      </div>
      <div
        style={{
          marginTop: 26,
          fontSize: 34,
          fontWeight: 700,
          color: '#ffffff',
          background: accentColor,
          padding: '22px 52px',
          borderRadius: 999,
          boxShadow: '0 16px 40px rgba(0,0,0,0.18)',
          opacity: ctaIn,
          transform: `translateY(${(1 - ctaIn) * 26}px) scale(${0.96 + ctaIn * 0.04})`,
        }}
      >
        {cta}
      </div>
    </AbsoluteFill>
  );
};
