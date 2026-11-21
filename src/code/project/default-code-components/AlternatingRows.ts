const controls = {
  children: { type: 'slot', label: 'Content', slotMax: 'infinite', collection: true },
  targetId: { type: 'text', label: 'List node ID', default: '' },
  itemTargetId: { type: 'text', label: 'Item content node ID', default: '' },
  itemPinnedTargetId: { type: 'text', label: 'Pinned item node ID', default: '' },
  pinFrom: { type: 'select', label: 'Original pin', default: 'top', options: ['top','right','bottom','left'].map(value => ({ value, label: value })) },
  pinTo: { type: 'select', label: 'Alternate pin', default: 'bottom', options: ['top','right','bottom','left'].map(value => ({ value, label: value })) },
  pinOffset: { type: 'number', label: 'Alternate offset', default: 0, min: -4096, max: 4096, step: 1 },
  enabled: { type: 'toggle', label: 'Enabled', default: true },
  parity: { type: 'select', label: 'Rows', default: 'even', options: ['even', 'odd'].map(value => ({ value, label: value })) },
  direction: { type: 'select', label: 'Direction', default: 'row-reverse', options: ['row-reverse', 'column-reverse'].map(value => ({ value, label: value })) },
};
export const ALTERNATING_ROWS_COMPONENT = `'use client';
/** @label "Alternating Rows" */
/** @defaultWidth 1000 */
/** @defaultHeight 600 */
/** @canvasStyleOwner component */
/** @controls ${JSON.stringify(controls, null, 2)} */
import { Children, cloneElement, isValidElement } from 'react';
import { RevymeAlternatingRows, withResponsiveProps } from '@revyme/runtime';
type AlternatingRowsProps = import('@revyme/runtime').AlternatingRowsProps;
type CSSProperties = import('react').CSSProperties;
function AlternatingRows({ children, ...props }: AlternatingRowsProps) {
  const slots = Children.toArray(children).map(child =>
    isValidElement<{ style?: CSSProperties; 'data-canvas-node'?: boolean | string }>(child) && child.props['data-canvas-node']
      ? cloneElement(child, { style: { ...child.props.style, position: 'relative', left: 'auto', top: 'auto', right: 'auto', bottom: 'auto', margin: 0 } }) : child);
  return <RevymeAlternatingRows {...props}>{slots}</RevymeAlternatingRows>;
}
export default withResponsiveProps(AlternatingRows);
`;
