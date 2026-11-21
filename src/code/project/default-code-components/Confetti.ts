const controls = {
  colors: { type: 'text', label: 'Colors (semicolon separated)', default: '#f92147;#4ce893;#bcff05;#ff2a12;#33ff00;#350adb;#ffd65b;#ff0099' },
  density: { type: 'number', label: 'Density', default: 128, min: 0, max: 500, step: 1 },
  size: { type: 'number', label: 'Size', default: 10, min: 1, max: 100, step: 1 },
  speed: { type: 'number', label: 'Speed', default: 6.6, min: 0, max: 50, step: .1 },
  delay: { type: 'number', label: 'Delay', default: 1, min: 0, max: 60, step: .1 },
  sizeVariance: { type: 'number', label: 'Size variance', default: .5, min: 0, max: 2, step: .1 },
  speedVariance: { type: 'number', label: 'Speed variance', default: .5, min: 0, max: 2, step: .1 },
  flip: { type: 'number', label: 'Flip', default: 10, min: 0, max: 50, step: 1 },
  flipVariance: { type: 'number', label: 'Flip variance', default: 2, min: 0, max: 20, step: .1 },
  swayIntensity: { type: 'number', label: 'Sway', default: 3.3, min: 0, max: 20, step: .1 },
  dragIntensity: { type: 'number', label: 'Drag', default: .4, min: 0, max: 1, step: .1 },
  lengthFactor: { type: 'number', label: 'Length', default: 2, min: .1, max: 10, step: .1 },
  explode: { type: 'toggle', label: 'Explode', default: true },
  explodeDistance: { type: 'number', label: 'Explosion', default: 10, min: 0, max: 30, step: 1 },
};
export const CONFETTI_COMPONENT = `'use client';
/** @label "Confetti" */
/** @defaultWidth 600 */
/** @defaultHeight 400 */
/** @canvasStyleOwner component */
/** @controls ${JSON.stringify(controls, null, 2)} */
import { RevymeConfetti, withResponsiveProps, useStaticCanvas } from '@revyme/runtime';
type ConfettiProps = import('@revyme/runtime').ConfettiProps;
function Confetti(props: ConfettiProps) { const isStatic = useStaticCanvas(); return <RevymeConfetti {...props} static={isStatic} />; }
export default withResponsiveProps(Confetti);
`;
