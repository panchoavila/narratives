const controls = {
  children: { type: 'slot', label: 'Content', slotMax: 'infinite', collection: true },
  images: { type: 'imageList', label: 'Images', default: '' },
  targetId: { type: 'text', label: 'Target node ID', default: '' },
  width: { type: 'number', label: 'Width', default: 320, min: 1, max: 2000, step: 1 },
  height: { type: 'number', label: 'Height', default: 320, min: 1, max: 2000, step: 1 },
  frequency: { type: 'number', label: 'Frequency', default: 1, min: .1, max: 10, step: .1 },
  visibleFor: { type: 'number', label: 'Visible for', default: 2, min: .1, max: 20, step: .1 },
  radius: { type: 'number', label: 'Radius', default: 0, min: 0, max: 500, step: 1 },
  fit: { type: 'select', label: 'Fit', default: 'fit', options: [{ value: 'fit', label: 'Fit' }, { value: 'fill', label: 'Fill' }, { value: 'stretch', label: 'Stretch' }] },
};
export const GALLERY_TRAIL_COMPONENT = `'use client';
/** @label "Gallery Trail" */
/** @defaultWidth 600 */
/** @defaultHeight 400 */
/** @canvasStyleOwner component */
/** @controls ${JSON.stringify(controls, null, 2)} */
import { Children, cloneElement, isValidElement } from 'react';
import { RevymeGalleryTrail, withResponsiveProps, useStaticCanvas } from '@revyme/runtime';
type GalleryTrailProps = import('@revyme/runtime').GalleryTrailProps;
function GalleryTrail({ children, ...props }: GalleryTrailProps) {
  const isStatic = useStaticCanvas();
  const slots = Children.toArray(children).map(child => isValidElement<{ style?: import('react').CSSProperties }>(child)
    ? cloneElement(child, { style: { ...child.props.style, position: 'relative', left: 'auto', top: 'auto', right: 'auto', bottom: 'auto', margin: 0 } }) : child);
  return <RevymeGalleryTrail {...props} static={isStatic}>{slots}</RevymeGalleryTrail>;
}
export default withResponsiveProps(GalleryTrail);
`;
