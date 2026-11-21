/** Reference-counted scroll locking for editable overlays. */
export const BODY_SCROLL_LOCK_COMPONENT = `'use client';
/** @label "Body Scroll Lock" */
/** @defaultWidth 20 */
/** @defaultHeight 20 */
/** @controls { "active": { "type": "toggle", "label": "Active", "default": true } } */
import { RevymeBodyScrollLock, withResponsiveProps, useStaticCanvas } from '@revyme/runtime';
type Props = import('@revyme/runtime').BodyScrollLockProps;
function BodyScrollLock(props: Props) { const isStatic = useStaticCanvas(); return <RevymeBodyScrollLock {...props} static={isStatic} />; }
export default withResponsiveProps(BodyScrollLock);
`;
