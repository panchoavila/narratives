'use client';
import { useId, type HTMLAttributes } from 'react';

export interface AlternatingRowsProps extends HTMLAttributes<HTMLDivElement> {
  targetId?: string;
  itemTargetId?: string;
  parity?: 'even' | 'odd';
  direction?: 'row-reverse' | 'column-reverse';
  enabled?: boolean;
  itemPinnedTargetId?: string;
  pinFrom?: 'top' | 'right' | 'bottom' | 'left';
  pinTo?: 'top' | 'right' | 'bottom' | 'left';
  pinOffset?: number;
}
/** Select exact native IDs or their component-instance-prefixed counterparts. */
function idSelector(id: string): string | null {
  if (!/^[\w:.-]+$/.test(id)) return null;
  return `:is([data-id="${id}"],[data-id$=":${id}"])`;
}
export function alternatingRowsCss(scope: string, targetId: string, itemTargetId: string, parity: 'even' | 'odd', direction: 'row-reverse' | 'column-reverse', itemPinnedTargetId = '', pinFrom = 'top', pinTo = 'bottom', pinOffset = 0): string {
  const list = targetId ? idSelector(targetId) : '';
  const target = itemTargetId ? idSelector(itemTargetId) : '';
  if (list === null || target === null || !['even','odd'].includes(parity) || !['row-reverse','column-reverse'].includes(direction)) return '';
  // Only actual row nodes take part in the count; style tags and pagination
  // sentinels without data-id do not shift the alternating pattern.
  const row = `${scope}${list ? ' ' + list : ''} > :nth-child(${parity} of [data-id])`;
  const pins = ['top','right','bottom','left'];
  const pinned = itemPinnedTargetId ? idSelector(itemPinnedTargetId) : '';
  const offset = Number.isFinite(pinOffset) ? Math.max(-4096, Math.min(4096, pinOffset)) : 0;
  const pinCss = pinned && pins.includes(pinFrom) && pins.includes(pinTo) && pinFrom !== pinTo ? `${row} ${pinned}{${pinFrom}:auto!important;${pinTo}:${offset}px!important}` : '';
  return `${row}${target ? ' ' + target : ''}{flex-direction:${direction}!important}${pinCss}`;
}
/** Persistent layout treatment; the children remain native editable elements. */
export function RevymeAlternatingRows({ children, targetId = '', itemTargetId = '', parity = 'even', direction = 'row-reverse', enabled = true, itemPinnedTargetId = '', pinFrom = 'top', pinTo = 'bottom', pinOffset = 0, style, ...props }: AlternatingRowsProps) {
  const uid = useId();
  const scope = `[data-revyme-alternating-rows=${JSON.stringify(uid)}]`;
  return <div {...props} data-revyme-alternating-rows={uid} style={{ position: 'relative', width: '100%', ...style }}>
    <style>{enabled ? alternatingRowsCss(scope, targetId, itemTargetId, parity, direction, itemPinnedTargetId, pinFrom, pinTo, pinOffset) : ''}</style>
    {children}
  </div>;
}
