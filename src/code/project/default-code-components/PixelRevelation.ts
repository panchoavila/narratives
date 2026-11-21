const controls = {
  image: { type: 'upload', label: 'Image', accept: 'image/*', default: '' },
  alt: { type: 'text', label: 'Alternative text', default: '' },
  imageFit: { type: 'select', label: 'Fit', default: 'cover', options: [{ value: 'cover', label: 'Cover' }, { value: 'contain', label: 'Contain' }, { value: 'fill', label: 'Stretch' }] },
  duration: { type: 'number', label: 'Duration', default: 1, min: .05, max: 30, step: .1 },
  steps: { type: 'number', label: 'Steps', default: 4, min: 1, max: 20, step: 1 },
  startPixelSize: { type: 'number', label: 'Pixel size', default: 50, min: 1, max: 200, step: 1 },
  delay: { type: 'number', label: 'Delay', default: 0, min: 0, max: 60, step: .1 },
  replay: { type: 'toggle', label: 'Replay', default: false },
};
export const PIXEL_REVELATION_COMPONENT = `'use client';
/** @label "Pixel Revelation" */
/** @defaultWidth 400 */
/** @defaultHeight 400 */
/** @canvasStyleOwner component */
/** @controls ${JSON.stringify(controls, null, 2)} */
import { RevymePixelRevelation, withResponsiveProps, useStaticCanvas } from '@revyme/runtime';
type PixelRevelationProps = import('@revyme/runtime').PixelRevelationProps;
function PixelRevelation(props: PixelRevelationProps) { const isStatic = useStaticCanvas(); return <RevymePixelRevelation {...props} static={isStatic} />; }
export default withResponsiveProps(PixelRevelation);
`;
