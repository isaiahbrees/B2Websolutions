import React from 'react';
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { colors, font } from '../theme';

export const EndCard: React.FC<{
  brandName: string;
  cta: string;
  accentColor: string;
}> = ({ brandName, cta, accentColor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12, mass: 0.7 } });
  const ctaIn = spring({ frame: frame - 12, fps, config: { damping: 200 } });

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(120% 90% at 50% 100%, #17202e 0%, ${colors.bg} 70%)`,
        justifyContent: 'center',
        alignItems: 'center',
        fontFamily: font,
        gap: 56,
        padding: 90,
      }}
    >
      <div
        style={{
          fontSize: 88,
          fontWeight: 900,
          color: colors.text,
          textAlign: 'center',
          transform: `scale(${pop})`,
        }}
      >
        {brandName}
      </div>
      <div
        style={{
          fontSize: 44,
          fontWeight: 700,
          color: '#0a0e14',
          background: accentColor,
          padding: '26px 54px',
          borderRadius: 999,
          textAlign: 'center',
          opacity: ctaIn,
          transform: `translateY(${(1 - ctaIn) * 40}px)`,
          maxWidth: 900,
        }}
      >
        {cta}
      </div>
    </AbsoluteFill>
  );
};
