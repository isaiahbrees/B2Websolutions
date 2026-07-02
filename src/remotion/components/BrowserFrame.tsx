import React from 'react';
import { font, type Theme } from '../theme';

export const CHROME_BAR_H = 62;

/**
 * A realistic minimal browser window (traffic lights + URL pill) that clips
 * its children. Soft shadow and rounded corners give the "product shot" look.
 */
export const BrowserFrame: React.FC<{
  url: string;
  width: number;
  height: number;
  theme: Theme;
  children: React.ReactNode;
}> = ({ url, width, height, theme, children }) => {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 22,
        overflow: 'hidden',
        background: theme.chrome,
        boxShadow: theme.frameShadow,
      }}
    >
      <div
        style={{
          height: CHROME_BAR_H,
          background: theme.chromeBar,
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: '0 22px',
        }}
      >
        {(['#ff5f57', '#febc2e', '#28c840'] as const).map((c) => (
          <div key={c} style={{ width: 14, height: 14, borderRadius: 7, background: c }} />
        ))}
        <div
          style={{
            marginLeft: 16,
            flex: 1,
            height: 36,
            borderRadius: 18,
            background: 'rgba(120,120,128,0.14)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: font,
            fontSize: 20,
            color: theme.chromeText,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          {url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
        </div>
        <div style={{ width: 60 }} />
      </div>
      <div
        style={{
          width,
          height: height - CHROME_BAR_H,
          overflow: 'hidden',
          position: 'relative',
          background: theme.cardBg,
        }}
      >
        {children}
      </div>
    </div>
  );
};
