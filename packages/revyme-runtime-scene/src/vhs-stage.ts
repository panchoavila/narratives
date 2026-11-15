import { createVhsRenderer } from './vhs-renderer';
import type { VhsConfig } from './vhs-config';

type MovableHost = HTMLElement & { moveBefore?: (node: Node, before: Node | null) => void };
type DrawableCanvas = HTMLCanvasElement & MovableHost & {
  content?: string;
  requestPaint?: () => void;
  updateElementGeometry?: (element: Element, options: { canvasTransform: DOMMatrix }) => void;
};

const activeObjects = new Set<() => void>();

export function stopVhsObjects() {
  activeObjects.forEach(stop => stop());
}

/** Move only the stable presentation host. React continues to own its children. */
export function openVhsStage(anchor: MovableHost, mode: 'page' | 'object') {
  const doc = anchor.ownerDocument;
  const win = doc.defaultView;
  const content = anchor.querySelector<HTMLElement>(':scope > [data-revyme-vhs-content]');
  const target = content?.firstElementChild;
  if (!win || !content || !target || !anchor.isConnected || doc.hidden) return null;
  if (mode === 'object' && activeObjects.size >= 2) return null;

  const canvas = doc.createElement('canvas') as DrawableCanvas;
  canvas.setAttribute('content', 'drawable');
  if (canvas.content !== 'drawable' || !canvas.requestPaint || !canvas.updateElementGeometry ||
      typeof canvas.moveBefore !== 'function' || typeof anchor.moveBefore !== 'function') return null;

  const page = mode === 'page';
  const css = win.getComputedStyle(target);
  const box = target.getBoundingClientRect();
  const width = page ? doc.documentElement.clientWidth
    : target instanceof HTMLElement ? target.offsetWidth : (parseFloat(css.width) || box.width);
  const height = page ? win.innerHeight
    : target instanceof HTMLElement ? target.offsetHeight : (parseFloat(css.height) || box.height);
  if (!width || !height) return null;
  const ratio = Math.min(win.devicePixelRatio || 1, 1.5, Math.sqrt(1_500_000 / (width * height)), 4096 / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  canvas.dataset.revymeEffectOverlay = '';
  canvas.dataset.revymeVhsStage = mode;
  if (page) {
    canvas.style.cssText = 'position:fixed;inset:0;z-index:2147483646;display:block';
  } else {
    canvas.style.display = css.display.startsWith('inline') ? 'inline-block' : 'block';
    for (const key of [
      'position', 'top', 'right', 'bottom', 'left', 'margin', 'grid-area', 'order',
      'align-self', 'justify-self', 'vertical-align', 'z-index', 'transform', 'transform-origin',
    ]) canvas.style.setProperty(key, css.getPropertyValue(key));
    canvas.style.flex = '0 0 auto';
  }
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  canvas.style.boxSizing = 'border-box';
  const renderer = createVhsRenderer(canvas);
  if (!renderer) return null;

  const style = doc.createElement('style');
  style.textContent = [
    'canvas[data-revyme-vhs-stage="object"] > [drawable] > :first-child {',
    '  position: relative !important; inset: auto !important; margin: 0 !important;',
    '  width: 100% !important; height: 100% !important; transform: none !important;',
    '  box-sizing: border-box !important;',
    '}',
  ].join('\n');
  const spacer = doc.createElement('div');
  if (page) {
    spacer.style.height = doc.documentElement.scrollHeight + 'px';
    spacer.setAttribute('aria-hidden', 'true');
  }

  const originalStyle = content.style.cssText;
  let closed = false;
  let dirty = false;
  let cropY = page ? win.scrollY : 0;
  let geometryY: number | undefined;
  let pendingPaint: (() => void) | undefined;
  const paint = (event: Event) => {
    const changed = (event as Event & { changedElements?: readonly Element[] }).changedElements;
    if (!changed || changed.includes(content) || pendingPaint) dirty = true;
    pendingPaint?.();
  };

  function destroy() {
    if (closed) return;
    closed = true;
    activeObjects.delete(destroy);
    canvas.removeEventListener('paint', paint);
    canvas.removeEventListener('webglcontextlost', destroy);
    win!.removeEventListener('resize', destroy);
    doc.removeEventListener('visibilitychange', onVisibility);
    if (content!.parentNode === canvas) {
      if (anchor.isConnected) anchor.moveBefore!(content!, canvas);
      else anchor.insertBefore(content!, canvas);
    }
    content!.style.cssText = originalStyle;
    content!.removeAttribute('drawable');
    canvas.remove();
    style.remove();
    spacer.remove();
    renderer!.destroy();
    pendingPaint?.();
  }
  const onVisibility = () => { if (doc.hidden) destroy(); };

  try {
    if (page) anchor.append(spacer);
    else anchor.append(style);
    anchor.append(canvas);
    content.style.cssText = 'display:block;box-sizing:border-box;width:' + width + 'px;' +
      (page ? 'min-height:' + height + 'px' : 'height:' + height + 'px');
    content.setAttribute('drawable', '');
    canvas.moveBefore(content, null);
    if (!page) activeObjects.add(destroy);
    canvas.addEventListener('paint', paint);
    canvas.addEventListener('webglcontextlost', destroy);
    win.addEventListener('resize', destroy);
    doc.addEventListener('visibilitychange', onVisibility);
  } catch {
    destroy();
    return null;
  }

  return {
    canvas,
    get closed() { return closed; },
    nextPaint(): Promise<boolean> {
      if (closed) return Promise.resolve(false);
      return new Promise(resolve => {
        const finish = (ready: boolean) => {
          win.clearTimeout(timeout);
          pendingPaint = undefined;
          resolve(ready && !closed);
        };
        const timeout = win.setTimeout(() => finish(false), 400);
        pendingPaint = () => finish(true);
        canvas.requestPaint!();
      });
    },
    draw(config: VhsConfig, time: number, amount: number) {
      if (closed) return;
      const y = page ? win.scrollY : 0;
      if (dirty || y !== cropY) {
        renderer.upload(content, { sx: 0, sy: y, swidth: width, sheight: height });
        cropY = y;
        dirty = false;
        if (geometryY !== y) {
          canvas.updateElementGeometry!(content, { canvasTransform: new DOMMatrix().translate(0, -y) });
          geometryY = y;
        }
        canvas.dataset.revymeVhsPainted = 'true';
      }
      renderer.draw(config, width, height, time, amount);
    },
    destroy,
  };
}
