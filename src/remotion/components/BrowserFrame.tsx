import React from 'react';
import { colors, font } from '../theme';

/**
 * A fake browser window (traffic lights + URL bar) that clips its children.
 * Gives raw website footage the "product shot" look.
 */
export const BrowserFrame: React.FC<{
  url: string;
  width: number;
  height: number;
  children: React.ReactNode;
}> = ({ url, width, height, children }) => {
  const barHeight = 64;
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 24,
        overflow: 'hidden',
        background: colors.chrome,
        boxShadow: '0 40px 100px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.08)',
      }}
    >
      <div
        style={{
          height: barHeight,
          background: colors.chromeBar,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 24px',
        }}
      >
        {(['#ff5f57', '#febc2e', '#28c840'] as const).map((c) => (
          <div key={c} style={{ width: 16, height: 16, borderRadius: 8, background: c }} />
        ))}
        <div
          style={{
            marginLeft: 18,
            flex: 1,
            height: 38,
            borderRadius: 19,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'center',
            padding: '0 20px',
            fontFamily: font,
            fontSize: 22,
            color: colors.textDim,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          {url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
        </div>
      </div>
      <div style={{ width, height: height - barHeight, overflow: 'hidden', position: 'relative' }}>
        {children}
      </div>
    </div>
  );
};
