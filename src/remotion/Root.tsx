import React from 'react';
import { Composition } from 'remotion';
import { BeforeAfterReel } from './BeforeAfterReel';
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
        const scale = props.resolution === '2160' ? 2 : 1;
        return {
          durationInFrames: getSegments(props).total,
          fps: props.fps,
          width: DESIGN_WIDTH * scale,
          height: DESIGN_HEIGHT * scale,
        };
      }}
    />
  );
};
