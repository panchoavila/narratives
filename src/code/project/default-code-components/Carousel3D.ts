import { DEFAULT_CAROUSEL_3D, type Carousel3DConfig } from '../../../../packages/revyme-runtime-scene/src/carousel-3d-config';

const number = (key: keyof typeof DEFAULT_CAROUSEL_3D, label: string, min: number, max: number, step = 1) =>
  ({ type: 'number', label, min, max, step, default: DEFAULT_CAROUSEL_3D[key] });
const toggle = (key: keyof typeof DEFAULT_CAROUSEL_3D, label: string) =>
  ({ type: 'toggle', label, default: DEFAULT_CAROUSEL_3D[key] });
const select = (key: keyof typeof DEFAULT_CAROUSEL_3D, label: string, values: string[]) =>
  ({ type: 'select', label, default: DEFAULT_CAROUSEL_3D[key],
    options: values.map(value => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) })) });

const controls = {
  children: { type: 'slot', label: 'Items', slotMax: 'infinite', collection: true },
  layout: select('layout', 'Surface', ['cylinder', 'sphere', 'line']),
  geometry: { type: 'group', label: 'Geometry', controls: {
    distribution: select('distribution', 'Distribution', ['fill', 'gap']),
    gap: { ...number('gap', 'Gap', 0, 1000), description: 'Gap mode sizes the surface from its items. Minimum space in local scene pixels.' },
    radius: number('radius', 'Radius', 1, 2000),
    depth: number('depth', 'Depth ratio', 0, 4, 0.05),
    arc: number('arc', 'Arc', 0, 360),
    phase: number('phase', 'Phase', -360, 360),
    rows: number('rows', 'Rows', 1, 30),
    rowGap: number('rowGap', 'Row gap', 0, 1000),
    stagger: number('stagger', 'Row offset', -180, 180),
    latitude: number('latitude', 'Latitude span', 0, 180),
    pitch: number('pitch', 'Helix rise', -2000, 2000),
    spacing: number('spacing', 'Line spacing', 0, 500),
  } },
  camera: { type: 'group', label: 'Scene', controls: {
    rotateX: number('rotateX', 'Rotate X', -180, 180),
    rotateY: number('rotateY', 'Rotate Y', -180, 180),
    rotateZ: number('rotateZ', 'Rotate Z', -180, 180),
    offsetX: number('offsetX', 'Offset X', -2000, 2000),
    offsetY: number('offsetY', 'Offset Y', -2000, 2000),
    offsetZ: number('offsetZ', 'Offset Z', -3000, 3000),
    perspective: { ...number('perspective', 'Perspective', 0, 10000, 50), description: 'Zero gives an orthographic view.' },
    zoom: number('zoom', 'Zoom', 0.05, 5, 0.05),
    fit: toggle('fit', 'Fit to frame'),
  } },
  items: { type: 'group', label: 'Items', controls: {
    itemWidth: number('itemWidth', 'Width', 1, 1000),
    itemHeight: number('itemHeight', 'Height', 1, 1000),
    orientation: select('orientation', 'Orientation', ['surface', 'billboard', 'radial', 'fixed']),
    itemRotateX: number('itemRotateX', 'Rotate X', -180, 180),
    itemRotateY: number('itemRotateY', 'Rotate Y', -180, 180),
    itemRotateZ: number('itemRotateZ', 'Rotate Z', -180, 180),
    twist: number('twist', 'Twist per item', -180, 180),
    backfaces: toggle('backfaces', 'Show back'),
    depthFade: number('depthFade', 'Depth fade', 0, 1, 0.05),
  } },
  playback: { type: 'group', label: 'Interaction', controls: {
    dragMode: select('dragMode', 'Drag', ['spin', 'orbit', 'none']),
    autoplay: toggle('autoplay', 'Auto rotate'),
    speed: number('speed', 'Degrees / sec', -90, 90),
    pauseOnHover: toggle('pauseOnHover', 'Pause on hover'),
    navigation: toggle('navigation', 'Arrows'),
  } },
};
function template(defaultValues: Partial<Carousel3DConfig>, propertyControls: Record<string, unknown>): string {
  const defaults = Object.entries(defaultValues).map(([key, value]) => key + ' = ' + JSON.stringify(value)).join(',\n  ');
  const bindings = Object.keys(defaultValues).map(key => key + '={' + key + '}').join('\n    ');

/** Thin editor adapter. Spatial layout and interaction ship in the shared runtime. */
  return `'use client';

/** @label "3D Carousel" */
/** @comment "Arrange connected HTML on a cylinder, sphere or line. Control the scene and each item independently." */
/** @defaultWidth 800 */
/** @defaultHeight 600 */
/** @controls ${JSON.stringify(propertyControls, null, 2)} */

import { Children, cloneElement, isValidElement } from 'react';
import { RevymeCarousel3D, withResponsiveProps, useStaticCanvas } from '@revyme/runtime';

type Carousel3DProps = import('@revyme/runtime').Carousel3DProps;
type CSSProperties = import('react').CSSProperties;

function Carousel3D({
  ${defaults},
  children, ...props
}: Carousel3DProps) {
  const isStatic = useStaticCanvas();
  const slots = Children.toArray(children).map(child => isValidElement<{ style?: CSSProperties }>(child)
    ? cloneElement(child, { style: { ...child.props.style, position: 'relative',
        left: 'auto', top: 'auto', right: 'auto', bottom: 'auto', margin: 0,
        width: '100%', height: '100%' } })
    : child);
  return <RevymeCarousel3D
    ${bindings}
    {...props} static={isStatic}>{slots}</RevymeCarousel3D>;
}
export default withResponsiveProps(Carousel3D);
`;
}

export const CAROUSEL_3D_COMPONENT = template(DEFAULT_CAROUSEL_3D, controls);

// An exact stock revision is safe to upgrade. Customized source is preserved.
const legacyDefaults = Object.fromEntries(Object.entries(DEFAULT_CAROUSEL_3D).filter(([key]) => key !== 'distribution' && key !== 'gap'));
const legacyControls = { ...controls, children: { type: 'slot', label: 'Items', slotMax: 'infinite' },
  geometry: { ...controls.geometry, controls: Object.fromEntries(Object.entries(controls.geometry.controls).filter(([key]) => key !== 'distribution' && key !== 'gap')) } };
export const LEGACY_CAROUSEL_3D_COMPONENT = template(legacyDefaults, legacyControls);
