const controls = {
  src: { type: 'upload', label: 'Image', accept: 'image/*', default: '' },
  fullSrc: { type: 'upload', label: 'Full image', accept: 'image/*', default: '' },
  alt: { type: 'text', label: 'Alternative text', default: '' },
  fit: { type: 'select', label: 'Fit', default: 'cover', options: ['cover', 'contain', 'fill'].map(value => ({ value, label: value })) },
  radius: { type: 'number', label: 'Radius', default: 0, min: 0, max: 500 },
  padding: { type: 'number', label: 'Modal padding', default: 20, min: 0, max: 200 },
  maxWidth: { type: 'number', label: 'Modal max width', default: 960, min: 100, max: 4000 },
  backdropColor: { type: 'color', label: 'Backdrop', default: 'rgba(0,0,0,0.8)' },
  stiffness: { type: 'number', label: 'Stiffness', default: 400, min: 1, max: 2000 },
  damping: { type: 'number', label: 'Damping', default: 30, min: 1, max: 100 },
  mass: { type: 'number', label: 'Mass', default: 1, min: .1, max: 10, step: .1 },
  openLabel: { type: 'text', label: 'Open label', default: 'Open image' },
  closeLabel: { type: 'text', label: 'Close label', default: 'Close image' },
};
export const IMAGE_LIGHTBOX_COMPONENT = `'use client';
/** @label "Image Lightbox" */
/** @defaultWidth 400 */
/** @defaultHeight 300 */
/** @canvasStyleOwner component */
/** @controls ${JSON.stringify(controls, null, 2)} */
import { RevymeImageLightbox, withResponsiveProps, useStaticCanvas } from '@revyme/runtime';
type ImageLightboxProps = import('@revyme/runtime').ImageLightboxProps;
function ImageLightbox(props: ImageLightboxProps) { const isStatic = useStaticCanvas(); return <RevymeImageLightbox {...props} static={isStatic} />; }
export default withResponsiveProps(ImageLightbox);
`;
