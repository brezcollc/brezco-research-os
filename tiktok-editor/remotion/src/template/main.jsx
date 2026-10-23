import {registerRoot, Composition} from 'remotion';
import React from 'react';
import {Edit, FPS} from './Edit';
import plan from './plan.json';
registerRoot(() => <Composition id="Edit" component={Edit} durationInFrames={Math.round(plan.duration * FPS)} fps={FPS} width={1080} height={1920} />);
