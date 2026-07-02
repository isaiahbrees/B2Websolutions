import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { colors, font } from '../theme';

/** Bold opening card — the first second decides whether anyone keeps watching. */
export const HookIntro: React.FC<{
  headline: string;
  clientName: string;
  accentColor: string;
}> = ({ headline, clientName, accentColor }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const words = headline.split(' ');
  const fadeOut = interpolate(frame, [durationInFrames - 10, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(120% 90% at 50% 0%, #17202e 0%, ${colors.bg} 70%)`,
        justifyContent: 'center',
        alignItems: 'center',
        fontFamily: font,
        padding: 90,
        opacity: fadeOut,
      }}
    >
      <div style={{ fontSize: 92, fontWeight: 900, color: colors.text, lineHeight: 1.15, textAlign: 'center' }}>
        {words.map((word, i) => {
          const s = spring({
            frame: frame - i * 3,
            fps,
            config: { damping: 14, mass: 0.6 },
          });
          return (
            <span
              key={i}
              style={{
                display: 'inline-block',
                marginRight: 22,
                opacity: s,
                transform: `translateY(${(1 - s) * 40}px)`,
              }}
            >
              {word}
            </span>
          );
        })}
      </div>
      <div
        style={{
          marginTop: 60,
          fontSize: 42,
          fontWeight: 600,
          color: accentColor,
          opacity: spring({ frame: frame - words.length * 3 - 5, fps }),
        }}
      >
        {clientName} — before &amp; after
      </div>
    </AbsoluteFill>
  );
};
