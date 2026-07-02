import React, { useMemo, useState } from 'react';
import {
  Easing,
  Img,
  interpolate,
  OffthreadVideo,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { buildCameraPath, buildVideoZoom } from '../camera';
import { DESIGN_HEIGHT, DESIGN_WIDTH, type ReelProps, type SiteMeta, type VideoInfo } from '../schema';
import { font, type Theme } from '../theme';
import { BrowserFrame, CHROME_BAR_H } from './BrowserFrame';

const resolveSrc = (src: string) => (src.startsWith('http') ? src : staticFile(src));

/**
 * The hero shot. Two modes:
 * - video: a live scroll recording plays inside the browser frame with
 *   timed push-ins on detected sections (preferred — shows real motion).
 * - still: the camera glides through a full-page capture with eased
 *   scrolling and section push-ins (fallback).
 */
export const CameraPan: React.FC<{
  image: string;
  video: string | null;
  videoInfo: VideoInfo | null;
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
}> = ({ image, video, videoInfo, meta, durationInFrames: d, label, labelColor, clientName, theme, backdrop, intensity, flavor, grade }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [failed, setFailed] = useState(false);

  const useVideo = Boolean(video && videoInfo);
  const frameW = DESIGN_WIDTH - 104;

  // Inner viewport: video is a fixed 1440x900 recording; stills adapt to the
  // page so short sites don't leave the frame half-empty.
  const displayImgH = useVideo
    ? frameW * (900 / 1440)
    : frameW * (meta.height / meta.width);
  const maxInnerH = Math.round(DESIGN_HEIGHT * 0.615);
  const innerH = Math.min(maxInnerH, Math.round(displayImgH));
  const frameH = innerH + CHROME_BAR_H;

  const ease = Easing.inOut(Easing.cubic);
  const clampOpts = { easing: ease, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

  // Still-mode camera path (scroll the tall capture).
  const path = useMemo(
    () =>
      useVideo
        ? null
        : buildCameraPath({
            sections: meta.sections ?? [],
            pxPerCss: frameW / meta.cssWidth,
            imgH: displayImgH,
            viewH: innerH,
            duration: d,
            intensity,
            flavor,
          }),
    [useVideo, meta, frameW, displayImgH, innerH, d, intensity, flavor],
  );

  // Video-mode zoom plan (push into sections as they scroll past).
  const zoomPlan = useMemo(
    () =>
      useVideo && videoInfo
        ? buildVideoZoom({
            sections: meta.sections ?? [],
            info: videoInfo,
            fps,
            durationInFrames: d,
            intensity,
            flavor,
          })
        : null,
    [useVideo, videoInfo, meta, fps, d, intensity, flavor],
  );

  let content: React.ReactNode;
  if (useVideo && videoInfo) {
    const zoom =
      zoomPlan && zoomPlan.frames.length >= 2
        ? interpolate(frame, zoomPlan.frames, zoomPlan.scales, clampOpts)
        : 1;
    content = (
      <div
        style={{
          width: '100%',
          height: '100%',
          transform: `scale(${zoom})`,
          transformOrigin: '50% 42%',
        }}
      >
        <OffthreadVideo
          src={resolveSrc(video as string)}
          muted
          startFrom={Math.round(videoInfo.prepSec * fps)}
          style={{ width: frameW, display: 'block', filter: grade }}
        />
      </div>
    );
  } else if (failed) {
    content = (
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
    );
  } else {
    const camY = interpolate(frame, path!.frames, path!.ys, clampOpts);
    const camS = interpolate(frame, path!.frames, path!.scales, clampOpts);
    const tx = (frameW / 2) * (1 - camS);
    let ty = innerH / 2 - camS * camY;
    const minTy = innerH - camS * displayImgH;
    ty = displayImgH * camS <= innerH ? (innerH - camS * displayImgH) / 2 : Math.min(0, Math.max(minTy, ty));
    content = (
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
    );
  }

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
          transform: `translateY(${(1 - enter) * 46}px) scale(${0.955 + enter * 0.045})`,
        }}
      >
        <BrowserFrame url={meta.url} width={frameW} height={frameH} theme={theme}>
          {content}
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
