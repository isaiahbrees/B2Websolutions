import React, { useMemo, useState } from 'react';
import {
  Easing,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { buildCameraPath } from '../camera';
import { DESIGN_HEIGHT, DESIGN_WIDTH, type ReelProps, type SiteMeta } from '../schema';
import { font, type Theme } from '../theme';
import { BrowserFrame, CHROME_BAR_H } from './BrowserFrame';

const resolveSrc = (src: string) => (src.startsWith('http') ? src : staticFile(src));

/**
 * The hero shot: a browser window whose "camera" glides through a full-page
 * capture — eased scrolling, gentle push-ins on detected sections, holds,
 * pull-backs. The whole path is planned up front from the capture metadata.
 */
export const CameraPan: React.FC<{
  image: string;
  meta: SiteMeta;
  durationInFrames: number;
  label: string;
  labelColor: string;
  clientName: string;
  theme: Theme;
  backdrop: string;
  intensity: ReelProps['intensity'];
  flavor: 'minimal' | 'showcase';
  grade?: string;
}> = ({ image, meta, durationInFrames: d, label, labelColor, clientName, theme, backdrop, intensity, flavor, grade }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [failed, setFailed] = useState(false);

  const frameW = DESIGN_WIDTH - 104;
  const displayImgH = frameW * (meta.height / meta.width);
  // Browser viewport adapts to short pages so the frame is never half-empty.
  const maxInnerH = Math.round(DESIGN_HEIGHT * 0.615);
  const innerH = Math.min(maxInnerH, Math.round(displayImgH));
  const frameH = innerH + CHROME_BAR_H;

  const path = useMemo(
    () =>
      buildCameraPath({
        sections: meta.sections ?? [],
        pxPerCss: frameW / meta.cssWidth,
        imgH: displayImgH,
        viewH: innerH,
        duration: d,
        intensity,
        flavor,
      }),
    [meta, frameW, displayImgH, innerH, d, intensity, flavor],
  );

  const ease = Easing.inOut(Easing.cubic);
  const clampOpts = { easing: ease, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
  const camY = interpolate(frame, path.frames, path.ys, clampOpts);
  const camS = interpolate(frame, path.frames, path.scales, clampOpts);

  // Map "look at page-Y at zoom S" to a CSS transform, never showing past
  // the image edges.
  const tx = (frameW / 2) * (1 - camS);
  let ty = innerH / 2 - camS * camY;
  const minTy = innerH - camS * displayImgH;
  ty = displayImgH * camS <= innerH ? (innerH - camS * displayImgH) / 2 : Math.min(0, Math.max(minTy, ty));

  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: Math.round(fps * 0.7) });

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
        gap: 40,
        fontFamily: font,
      }}
    >
      <div
        style={{
          fontSize: 40,
          fontWeight: 700,
          color: theme.text,
          letterSpacing: -0.5,
          opacity: enter,
          transform: `translateY(${(1 - enter) * 24}px)`,
        }}
      >
        {clientName}
      </div>

      <div
        style={{
          position: 'relative',
          opacity: enter,
          // Starts slightly wide, settles in — the whole browser visible first.
          transform: `translateY(${(1 - enter) * 46}px) scale(${0.955 + enter * 0.045})`,
        }}
      >
        <BrowserFrame url={meta.url} width={frameW} height={frameH} theme={theme}>
          {failed ? (
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: theme.textDim,
                fontSize: 34,
                textAlign: 'center',
                padding: 40,
              }}
            >
              No capture found — run a capture first
            </div>
          ) : (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                transform: `translate(${tx}px, ${ty}px) scale(${camS})`,
                transformOrigin: '0 0',
                width: frameW,
              }}
            >
              <Img
                src={resolveSrc(image)}
                onError={() => setFailed(true)}
                style={{ width: frameW, display: 'block', filter: grade }}
              />
            </div>
          )}
        </BrowserFrame>

        {/* Small corner label */}
        <div
          style={{
            position: 'absolute',
            top: -20,
            left: 26,
            background: labelColor,
            color: '#ffffff',
            fontWeight: 800,
            fontSize: 26,
            letterSpacing: 4,
            padding: '10px 26px',
            borderRadius: 999,
            boxShadow: '0 10px 26px rgba(0,0,0,0.28)',
          }}
        >
          {label}
        </div>
      </div>
    </div>
  );
};
