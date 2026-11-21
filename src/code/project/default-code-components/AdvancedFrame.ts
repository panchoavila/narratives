import { CORNER_STYLES, DEFAULT_ADVANCED_FRAME, PATTERN_PRESETS } from '../../../../packages/revyme-runtime-scene/src/advanced-config';

const number = (key: keyof typeof DEFAULT_ADVANCED_FRAME, label: string, min: number, max: number, step = 1) =>
  ({ type: 'number', label, min, max, step, default: DEFAULT_ADVANCED_FRAME[key] });
const color = (key: keyof typeof DEFAULT_ADVANCED_FRAME, label: string) =>
  ({ type: 'color', label, default: DEFAULT_ADVANCED_FRAME[key] });
const select = (key: keyof typeof DEFAULT_ADVANCED_FRAME, label: string, values: readonly string[]) =>
  ({ type: 'select', label, default: DEFAULT_ADVANCED_FRAME[key], options: values.map(value => ({ value, label: value })) });
const controls = {
  children: { type: 'slot', label: 'Content', slotMax: 'infinite' },
  fillColor: color('fillColor', 'Fill'),
  corners: { type: 'group', label: 'Corners', controls: {
    cornerStyle: select('cornerStyle', 'Shape', CORNER_STYLES),
    cornerSize: number('cornerSize', 'Size', 0, 300), cornerStroke: number('cornerStroke', 'Stroke', 0, 30, 0.5),
    cornerColor: color('cornerColor', 'Color'), cornerFill: color('cornerFill', 'Fill'),
    cornerOffsetX: { ...number('cornerOffsetX', 'Inset X', -1000, 1000, 0.5), description: 'Positive: inward. Negative: outward. Zero centers on the corner.' },
    cornerOffsetY: { ...number('cornerOffsetY', 'Inset Y', -1000, 1000, 0.5), description: 'Positive: inward. Negative: outward. Zero centers on the corner.' },
  } },
  pattern: { type: 'group', label: 'Pattern', controls: {
    patternPreset: select('patternPreset', 'Preset', PATTERN_PRESETS), patternColor: color('patternColor', 'Color'),
    tileSize: number('tileSize', 'Tile', 1, 1000), lineWidth: number('lineWidth', 'Line', 0, 100, 0.5), dotSize: number('dotSize', 'Dot', 0, 1000),
    flip: { type: 'toggle', label: 'Flip', default: false },
    customPatternImage: { type: 'upload', accept: 'image/*', label: 'Image', default: '' },
    customPatternSizing: select('customPatternSizing', 'Sizing', ['fill', 'fit', 'stretch', 'tile']),
    customPatternPosition: select('customPatternPosition', 'Position', ['topLeft', 'topCenter', 'topRight', 'left', 'center', 'right', 'bottomLeft', 'bottomCenter', 'bottomRight']),
    customPatternMode: select('customPatternMode', 'Mask', ['alpha', 'luminance']),
  } },
  animation: { type: 'group', label: 'Animation', controls: {
    patternMotion: select('patternMotion', 'Pattern motion', ['none', 'shimmer']),
    patternDuration: number('patternDuration', 'Duration', 0.2, 60, 0.1),
  } },
  compositionMask: { type: 'group', label: 'Composition mask', controls: {
    compositionMaskImage: { type: 'upload', accept: 'image/*', label: 'Image', default: '' },
    compositionMaskMode: select('compositionMaskMode', 'Mode', ['alpha', 'luminance']),
    compositionMaskSizing: select('compositionMaskSizing', 'Sizing', ['fill', 'fit', 'stretch', 'tile']),
    compositionMaskPosition: select('compositionMaskPosition', 'Position', ['topLeft', 'topCenter', 'topRight', 'left', 'center', 'right', 'bottomLeft', 'bottomCenter', 'bottomRight']),
    compositionMaskTileSize: number('compositionMaskTileSize', 'Tile size', 1, 4096),
  } },
};

export const ADVANCED_FRAME_COMPONENT = `'use client';
/** @label "Advanced Frame" */
/** @comment "Live content with adjustable corner markers and a patterned background. Positive insets move corners inside; negative insets move them outside." */
/** @defaultWidth 600 */
/** @defaultHeight 400 */
/** @canvasStyleOwner component */
/** @controls ${JSON.stringify(controls, null, 2)} */
import { Children, cloneElement, isValidElement } from 'react';
import { RevymeAdvancedFrame, withResponsiveProps, useStaticCanvas } from '@revyme/runtime';
type AdvancedFrameProps = import('@revyme/runtime').AdvancedFrameProps;
type CSSProperties = import('react').CSSProperties;
function AdvancedFrame({
  ${Object.entries(DEFAULT_ADVANCED_FRAME).map(([key, value]) => key + ' = ' + JSON.stringify(value)).join(',\n  ')},
  children, ...props
}: AdvancedFrameProps) {
  const isStatic = useStaticCanvas();
  // Connected canvas roots carry workspace coordinates. Inline content keeps its own layout.
  const slots = Children.toArray(children).map(child =>
    isValidElement<{ style?: CSSProperties; 'data-canvas-node'?: boolean | string }>(child) && child.props['data-canvas-node']
      ? cloneElement(child, { style: { ...child.props.style, position: 'relative', left: 'auto', top: 'auto', right: 'auto', bottom: 'auto', margin: 0 } })
      : child);
  return <RevymeAdvancedFrame
    ${Object.keys(DEFAULT_ADVANCED_FRAME).map(key => key + '={' + key + '}').join('\n    ')}
    {...props} static={isStatic}>{slots}</RevymeAdvancedFrame>;
}
export default withResponsiveProps(AdvancedFrame);
`;
