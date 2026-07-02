import React from 'react';
import { Composition } from 'remotion';
import { BeforeAfterReel } from './BeforeAfterReel';
import { defaultReelProps, FPS, getSegments, HEIGHT, reelSchema, WIDTH } from './schema';

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="BeforeAfterReel"
      component={BeforeAfterReel}
      schema={reelSchema}
      defaultProps={defaultReelProps}
      width={WIDTH}
      height={HEIGHT}
      fps={FPS}
      durationInFrames={getSegments(defaultReelProps).total}
      calculateMetadata={({ props }) => ({
        durationInFrames: getSegments(props).total,
      })}
    />
  );
};
