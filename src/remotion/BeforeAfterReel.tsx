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
import { EndCard } from './components/EndCard';
import { HookIntro } from './components/HookIntro';
import { SitePan } from './components/SitePan';
import { getSegments, type ReelProps } from './schema';
import { colors } from './theme';

const ProgressBar: React.FC<{ accentColor: string }> = ({ accentColor }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width } = useVideoConfig();
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        height: 12,
        width: (frame / durationInFrames) * width,
        background: accentColor,
        zIndex: 10,
      }}
    />
  );
};

export const BeforeAfterReel: React.FC<ReelProps> = (props) => {
  const seg = getSegments(props);
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();

  // AFTER slides in over BEFORE during the first `seg.swipe` frames.
  const swipeX = interpolate(
    frame - seg.afterStart,
    [0, seg.swipe],
    [width, 0],
    { easing: Easing.out(Easing.cubic), extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  return (
    <AbsoluteFill style={{ background: colors.bg }}>
      {props.musicSrc ? (
        <Audio
          src={props.musicSrc.startsWith('http') ? props.musicSrc : staticFile(props.musicSrc)}
          volume={0.5}
        />
      ) : null}

      <Sequence durationInFrames={seg.hook} name="Hook">
        <HookIntro
          headline={props.headline}
          clientName={props.clientName}
          accentColor={props.accentColor}
        />
      </Sequence>

      {/* Keeps rendering under the AFTER swipe for `seg.swipe` extra frames */}
      <Sequence from={seg.beforeStart} durationInFrames={seg.before + seg.swipe} name="Before">
        <SitePan
          image={props.beforeImage}
          meta={props.beforeMeta}
          durationInFrames={seg.before}
          label="BEFORE"
          labelColor={colors.before}
          clientName={props.clientName}
          zoom={1.04}
          grade="saturate(0.72) contrast(0.96) brightness(0.94)"
          backdrop={`radial-gradient(110% 80% at 50% 0%, #2a1420 0%, ${colors.bg} 75%)`}
        />
      </Sequence>

      <Sequence from={seg.afterStart} durationInFrames={seg.after} name="After">
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: `translateX(${swipeX}px)`,
            boxShadow: '-60px 0 120px rgba(0,0,0,0.6)',
          }}
        >
          <SitePan
            image={props.afterImage}
            meta={props.afterMeta}
            durationInFrames={seg.after}
            label="AFTER"
            labelColor={colors.after}
            clientName={props.clientName}
            zoom={1.07}
            backdrop={`radial-gradient(110% 80% at 50% 0%, #10261f 0%, ${colors.bg} 75%)`}
          />
        </div>
      </Sequence>

      <Sequence from={seg.endStart} durationInFrames={seg.end} name="EndCard">
        <EndCard brandName={props.brandName} cta={props.cta} accentColor={props.accentColor} />
      </Sequence>

      <ProgressBar accentColor={props.accentColor} />
    </AbsoluteFill>
  );
};
