'use client';
import { useEffect, useRef, type HTMLAttributes } from 'react';

export interface BodyScrollLockProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  active?: boolean;
  static?: boolean;
}
const locks = new WeakMap<Document, { count: number; overflow: string }>();
function acquire(doc: Document): () => void {
  let entry = locks.get(doc);
  if (!entry) { entry = { count: 0, overflow: doc.body.style.overflow }; locks.set(doc, entry); }
  entry.count++; doc.body.style.overflow = 'hidden';
  let released = false;
  return () => {
    if (released) return; released = true;
    if (--entry!.count === 0) {
      if (doc.body.style.overflow === 'hidden') doc.body.style.overflow = entry!.overflow;
      locks.delete(doc);
    }
  };
}
/** A nonvisual, reference-counted page scroll lock for transient overlays. */
export function RevymeBodyScrollLock({ active = true, static: isStatic = false, style, ...rest }: BodyScrollLockProps) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const doc = host.current?.ownerDocument;
    if (!doc || !active || isStatic) return;
    const query = doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');
    let release: (() => void) | undefined;
    const update = () => {
      if (query?.matches) { release?.(); release = undefined; }
      else if (!release) release = acquire(doc);
    };
    update(); query?.addEventListener?.('change', update);
    return () => { query?.removeEventListener?.('change', update); release?.(); };
  }, [active, isStatic]);
  return <div ref={host} {...rest} aria-hidden="true" style={{ width: 0, height: 0, overflow: 'hidden', ...style }} />;
}
