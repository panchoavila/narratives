const controls = {
  image: { type: 'upload', label: 'Image', accept: 'image/*', default: '' },
  alt: { type: 'text', label: 'Alternative text', default: '' },
  imageFit: { type: 'select', label: 'Fit', default: 'cover', options: [{ value: 'cover', label: 'Cover' }, { value: 'contain', label: 'Contain' }, { value: 'fill', label: 'Stretch' }] },
  threshold: { type: 'number', label: 'Threshold', default: 100, min: 0, max: 255, step: 1 },
  brightness: { type: 'number', label: 'Brightness', default: 0, min: -255, max: 255, step: 1 },
  midtones: { type: 'number', label: 'Midtones', default: 50, min: 0, max: 100, step: 1 },
  pixelSize: { type: 'number', label: 'Pixel size', default: 6, min: 1, max: 100, step: 1 },
  backgroundColor: { type: 'color', label: 'Background', default: '#000000' },
  dotColor: { type: 'color', label: 'Dot color', default: '#ffffff' },
  enabled: { type: 'toggle', label: 'Enabled', default: true },
};
export const DITHER_COMPONENT = `'use client';
/** @label "Dither" */
/** @defaultWidth 400 */
/** @defaultHeight 400 */
/** @canvasStyleOwner component */
/** @controls ${JSON.stringify(controls, null, 2)} */
import { RevymeDither, withResponsiveProps, useStaticCanvas } from '@revyme/runtime';
type DitherProps = import('@revyme/runtime').DitherProps;
function Dither(props: DitherProps) { const isStatic = useStaticCanvas(); return <RevymeDither {...props} static={isStatic} />; }
export default withResponsiveProps(Dither);
`;
