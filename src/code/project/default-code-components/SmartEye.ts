const controls = {
  eyeImage: { type: 'upload', label: 'Eye image', accept: 'image/*', default: '' },
  irisImage: { type: 'upload', label: 'Iris image', accept: 'image/*', default: '' },
  eyeWidth: { type: 'number', label: 'Eye width', default: 200, min: 1, max: 2000, step: 1 },
  eyeHeight: { type: 'number', label: 'Eye height', default: 100, min: 1, max: 2000, step: 1 },
  irisWidth: { type: 'number', label: 'Iris width', default: 50, min: 1, max: 2000, step: 1 },
  irisHeight: { type: 'number', label: 'Iris height', default: 50, min: 1, max: 2000, step: 1 },
  trackingIntensity: { type: 'number', label: 'Tracking speed', default: .5, min: .1, max: 2, step: .1 },
  verticalIntensity: { type: 'number', label: 'Vertical movement', default: .5, min: 0, max: 1, step: .1 },
};
export const SMART_EYE_COMPONENT = `'use client';
/** @label "Smart Eye" */
/** @defaultWidth 200 */
/** @defaultHeight 100 */
/** @canvasStyleOwner component */
/** @controls ${JSON.stringify(controls, null, 2)} */
import { RevymeSmartEye, withResponsiveProps, useStaticCanvas } from '@revyme/runtime';
type SmartEyeProps = import('@revyme/runtime').SmartEyeProps;
function SmartEye(props: SmartEyeProps) { const isStatic = useStaticCanvas(); return <RevymeSmartEye {...props} static={isStatic} />; }
export default withResponsiveProps(SmartEye);
`;
