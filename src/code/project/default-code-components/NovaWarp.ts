import { DEFAULT_NOVA_WARP } from '../../../../packages/revyme-runtime-scene/src/nova-warp-config';

const number = (key: keyof typeof DEFAULT_NOVA_WARP, label: string, min: number, max: number, step = 1) =>
  ({ type: 'number', label, min, max, step, default: DEFAULT_NOVA_WARP[key] });
const color = (key: keyof typeof DEFAULT_NOVA_WARP, label: string) =>
  ({ type: 'color', label, default: DEFAULT_NOVA_WARP[key] });
const controls = {
  colors: { type: 'group', label: 'Colors', controls: {
    bgColor: color('bgColor', 'Background'), starColor: color('starColor', 'Star'), starTint: color('starTint', 'Star tint'),
    cloudColor: color('cloudColor', 'Cloud'), cloudTint: color('cloudTint', 'Cloud tint'),
  } },
  stars: { type: 'group', label: 'Stars', controls: {
    starCount: number('starCount', 'Count', 0, 5000, 100), starSize: number('starSize', 'Size', 0.2, 3, 0.1),
    trailLength: number('trailLength', 'Trail', 0, 3, 0.1),
  } },
  clouds: { type: 'group', label: 'Clouds', controls: {
    cloudOpacity: number('cloudOpacity', 'Opacity', 0, 2, 0.05), cloudScale: number('cloudScale', 'Scale', 0.2, 4, 0.1),
    cloudRotation: number('cloudRotation', 'Rotation °/s', -45, 45),
  } },
  motion: { type: 'group', label: 'Motion', controls: {
    idleSpeed: number('idleSpeed', 'Idle speed', 0, 5, 0.1), boost: number('boost', 'Boost', 0, 3, 0.1),
    response: number('response', 'Response (s)', 0.1, 3, 0.1),
    paused: { type: 'toggle', label: 'Paused', default: false },
  } },
  interaction: { type: 'group', label: 'Interaction', controls: {
    triggerId: { type: 'text', label: 'Trigger ID', default: '', description: 'HTML id or node data-id of the button. Empty uses the whole frame. Touch boosts while held.' },
    followTarget: { type: 'toggle', label: 'Follow button', default: true },
    centerX: number('centerX', 'Center X (%)', 0, 100), centerY: number('centerY', 'Center Y (%)', 0, 100),
    parallax: number('parallax', 'Parallax', 0, 3, 0.1),
  } },
};

export const NOVA_WARP_COMPONENT = `'use client';

/** @label "Nova Warp" */
/** @comment "A drifting starfield that accelerates into a cloud tunnel. Link a button with Trigger ID, or hover the frame." */
/** @defaultWidth 1200 */
/** @defaultHeight 720 */
/** @controls ${JSON.stringify(controls, null, 2)} */

import { RevymeNovaWarp, withResponsiveProps, useStaticCanvas } from '@revyme/runtime';
type NovaWarpProps = import('@revyme/runtime').NovaWarpProps;

function NovaWarp({
  ${Object.entries(DEFAULT_NOVA_WARP).map(([key, value]) => key + ' = ' + JSON.stringify(value)).join(',\n  ')},
  ...props
}: NovaWarpProps) {
  const isStatic = useStaticCanvas();
  return <RevymeNovaWarp
    ${Object.keys(DEFAULT_NOVA_WARP).map(key => key + '={' + key + '}').join('\n    ')}
    {...props} static={isStatic} />;
}
export default withResponsiveProps(NovaWarp);
`;
