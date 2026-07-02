import React, { useState } from 'react';
import {
  Easing,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { colors, font } from '../theme';
import { BrowserFrame } from './BrowserFrame';

const resolveSrc = (src: string) => (src.startsWith('http') ? src : staticFile(src));

/**
 * The Screen-Studio-style shot: a browser window scrolls through a full-page
 * screenshot with a gentle zoom, because the "tour" is scripted we know the
 * whole camera path up front.
 */
export const SitePan: React.FC<{
  image: string;
  meta: { width: number; height: number; url: string };
  durationInFrames: number;
  label: string;
  labelColor: string;
  clientName: string;
  /** peak zoom while scrolling, e.g. 1.06 */
  zoom: number;
  /** CSS filter applied to the site footage (used to grunge up the BEFORE) */
  grade?: string;
  backdrop: string;
}> = ({ image, meta, durationInFrames: d, label, labelColor, clientName, zoom, grade, backdrop }) => {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const [failed, setFailed] = useState(false);

  const frameW = W - 100;
  const frameH = Math.round(H * 0.66);
  const innerH = frameH - 64;

  // Site image is rendered at the frame's inner width; pan the overflow.
  const imgH = frameW * (meta.height / meta.width);
  const maxScroll = Math.max(0, imgH - innerH);
  const panProgress = interpolate(frame, [d * 0.14, d * 0.94], [0, 1], {
    easing: Easing.inOut(Easing.cubic),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const scale = interpolate(
    frame,
    [0, d * 0.14, d * 0.5, d * 0.72, d],
    [1.05, 1, zoom, zoom, 1],
    { easing: Easing.inOut(Easing.quad), extrapolateRight: 'clamp' },
  );

  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 20 });

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: backdrop,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 44,
        fontFamily: font,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 28,
          opacity: enter,
          transform: `translateY(${(1 - enter) * 30}px)`,
        }}
      >
        <div
          style={{
            background: labelColor,
            color: '#0a0e14',
            fontWeight: 800,
            fontSize: 40,
            letterSpacing: 6,
            padding: '14px 36px',
            borderRadius: 999,
          }}
        >
          {label}
        </div>
        <div style={{ color: colors.text, fontSize: 44, fontWeight: 700 }}>{clientName}</div>
      </div>

      <div
        style={{
          opacity: enter,
          transform: `translateY(${(1 - enter) * 60}px) scale(${0.97 + enter * 0.03})`,
        }}
      >
        <BrowserFrame url={meta.url} width={frameW} height={frameH}>
          {failed ? (
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: colors.textDim,
                fontSize: 36,
                background: colors.bgPanel,
                textAlign: 'center',
                padding: 40,
              }}
            >
              No capture found — run `npm run capture` first
            </div>
          ) : (
            <div
              style={{
                transform: `scale(${scale})`,
                transformOrigin: '50% 30%',
                width: '100%',
                height: '100%',
              }}
            >
              <Img
                src={resolveSrc(image)}
                onError={() => setFailed(true)}
                style={{
                  width: frameW,
                  display: 'block',
                  transform: `translateY(${-maxScroll * panProgress}px)`,
                  filter: grade,
                }}
              />
            </div>
          )}
        </BrowserFrame>
      </div>
    </div>
  );
};
