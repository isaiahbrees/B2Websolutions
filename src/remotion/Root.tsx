import React from 'react';
import { Composition } from 'remotion';
import { BeforeAfterReel } from './BeforeAfterReel';
import { FORMAT_DIMS } from './canvas';
import { defaultReelProps, DESIGN_HEIGHT, DESIGN_WIDTH, getSegments, reelSchema } from './schema';

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="BeforeAfterReel"
      component={BeforeAfterReel}
      schema={reelSchema}
      defaultProps={defaultReelProps}
      width={DESIGN_WIDTH}
      height={DESIGN_HEIGHT}
      fps={defaultReelProps.fps}
      durationInFrames={getSegments(defaultReelProps).total}
      calculateMetadata={({ props }) => {
        const base = FORMAT_DIMS[props.format] ?? FORMAT_DIMS.reel;
        // 720p exports render at 2/3 scale; 4K at 2x.
        const scale = props.resolution === '2160' ? 2 : props.resolution === '720' ? 2 / 3 : 1;
        return {
          durationInFrames: getSegments(props).total,
          fps: props.fps,
          width: Math.round((base.w * scale) / 2) * 2,
          height: Math.round((base.h * scale) / 2) * 2,
        };
      }}
    />
  );
};
