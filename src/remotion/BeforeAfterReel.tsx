import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Easing,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { CameraPan } from './components/CameraPan';
import { EndCard } from './components/EndCard';
import { IntroCard } from './components/IntroCard';
import { SplitBeat } from './components/SplitBeat';
import { DESIGN_HEIGHT, DESIGN_WIDTH, getSegments, type ReelProps } from './schema';
import { getTheme } from './theme';

const ProgressBar: React.FC<{ accentColor: string }> = ({ accentColor }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        height: 10,
        width: (frame / durationInFrames) * DESIGN_WIDTH,
        background: accentColor,
        zIndex: 10,
      }}
    />
  );
};

export const BeforeAfterReel: React.FC<ReelProps> = (props) => {
  const seg = getSegments(props);
  const frame = useCurrentFrame();
  const { width, fps, durationInFrames } = useVideoConfig();
  const theme = getTheme(props.template);

  // The AFTER settles in with a soft flash + scale, not a hard cut.
  const sinceAfter = frame - seg.afterStart;
  const flashOpacity = interpolate(
    sinceAfter,
    [-seg.flash * 0.4, 0, seg.flash],
    [0, 0.92, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) },
  );
  const afterSettle = interpolate(sinceAfter, [0, seg.flash * 1.6], [1.045, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  // Gentle music bed with fade in/out, if provided.
  const musicVolume = (f: number) =>
    Math.max(
      0,
      Math.min(1, f / (fps * 1.5), (durationInFrames - f) / (fps * 2)),
    ) * 0.35;

  // Design at 1080x1920; scale up for 4K exports.
  const k = width / DESIGN_WIDTH;

  return (
    <AbsoluteFill style={{ background: theme.bg }}>
      {props.musicSrc ? (
        <Audio
          src={props.musicSrc.startsWith('http') ? props.musicSrc : staticFile(props.musicSrc)}
          volume={musicVolume}
        />
      ) : null}

      <div
        style={{
          width: DESIGN_WIDTH,
          height: DESIGN_HEIGHT,
          transform: `scale(${k})`,
          transformOrigin: 'top left',
          position: 'absolute',
        }}
      >
        <Sequence durationInFrames={seg.intro} name="Intro">
          <IntroCard
            title={props.title}
            clientName={props.clientName}
            brandName={props.brandName}
            logoUrl={props.logoUrl}
            accentColor={props.accentColor}
            theme={theme}
          />
        </Sequence>

        <Sequence from={seg.beforeStart} durationInFrames={seg.before + seg.flash} name="Before">
          <CameraPan
            image={props.beforeImage}
            video={props.beforeVideo}
            videoInfo={props.beforeVideoInfo}
            meta={props.beforeMeta}
            durationInFrames={seg.before}
            label={props.beforeLabel}
            labelColor={theme.before}
            clientName={props.clientName}
            theme={theme}
            backdrop={theme.bgBefore}
            intensity={props.intensity}
            flavor="minimal"
            grade="saturate(0.82) contrast(0.97) brightness(0.985)"
          />
        </Sequence>

        {seg.split > 0 ? (
          <Sequence from={seg.splitStart} durationInFrames={seg.split + seg.flash} name="SplitBeat">
            <SplitBeat
              beforeImage={props.beforeImage}
              afterImage={props.afterImage}
              beforeMeta={props.beforeMeta}
              afterMeta={props.afterMeta}
              beforeLabel={props.beforeLabel}
              afterLabel={props.afterLabel}
              theme={theme}
            />
          </Sequence>
        ) : null}

        <Sequence from={seg.afterStart} durationInFrames={seg.after} name="After">
          <div style={{ position: 'absolute', inset: 0, transform: `scale(${afterSettle})` }}>
            <CameraPan
              image={props.afterImage}
              video={props.afterVideo}
              videoInfo={props.afterVideoInfo}
              meta={props.afterMeta}
              durationInFrames={seg.after}
              label={props.afterLabel}
              labelColor={theme.after}
              clientName={props.clientName}
              theme={theme}
              backdrop={theme.bgAfter}
              intensity={props.intensity}
              flavor="showcase"
            />
          </div>
        </Sequence>

        <Sequence from={seg.endStart} durationInFrames={seg.end} name="EndCard">
          <EndCard
            tagline={props.tagline}
            brandName={props.brandName}
            services={props.services}
            cta={props.cta}
            logoUrl={props.logoUrl}
            accentColor={props.accentColor}
            theme={theme}
          />
        </Sequence>

        {flashOpacity > 0.01 ? (
          <AbsoluteFill style={{ background: theme.flash, opacity: flashOpacity, zIndex: 5 }} />
        ) : null}

        <ProgressBar accentColor={props.accentColor} />
      </div>
    </AbsoluteFill>
  );
};
