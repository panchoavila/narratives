/**
 * Code overrides — HOCs applied to a single canvas element.
 *
 * An override file (`overrides/<Name>.tsx` in a Revyme project) exports
 * functions shaped `withX(Component) => Component`. A page applies one by
 * wrapping the element:
 *
 *   <Override with={withMouseDistanceHeight}>
 *     <motion.div data-id="card-1" style={…} />
 *   </Override>
 *
 * `Override` adds no DOM: it swaps its only child's type for the wrapped
 * component and forwards the child's props, key and ref untouched. The element
 * keeps its own JSX, so every editor generator that reads or writes it keeps
 * working; the canvas treats `<Override>` as transparent and never runs it
 * (overrides only run in preview and on the live site).
 *
 * A plain tag is rendered as its `motion.*` twin, so motion props apply.
 *
 * Also accepted, for override code imported from another editor:
 *   - a list: `with={[withA, withB]}` (applied left to right, innermost first)
 *   - legacy prop overrides: `function X(props) { return { animate: … } }`
 *   - a `text` prop on text layers (becomes the element's children)
 */
import { type ReactElement, type ReactNode } from 'react';
export type CodeOverride = (Component: any) => any;
export interface OverrideProps {
    with?: CodeOverride | null | undefined | Array<CodeOverride | null | undefined>;
    children: ReactNode;
}
export declare function Override({ with: fns, children }: OverrideProps): ReactElement | null;
/**
 * The shared override store: one module-level state object; every component
 * using the returned hook re-renders when any of them sets it. Lets two
 * overrides on different elements talk to each other.
 */
export declare function createStore<T>(initial: T): () => [T, (next: Partial<T> | ((prev: T) => Partial<T> | T)) => void];
/**
 * Stand-ins for the host-editor APIs that imported override code reaches for
 * (render target, a data store, locale and router helpers). An import rewrites
 * `import { RenderTarget } from "<host>"` to `const { RenderTarget } =
 * hostCompat;`. Overrides never run on the editor canvas, so everything here
 * reports "preview / live".
 */
export declare const hostCompat: {
    RenderTarget: {
        canvas: string;
        export: string;
        thumbnail: string;
        preview: string;
        current: () => string;
        hasRestrictions: () => boolean;
    };
    useIsOnCanvas: () => boolean;
    useIsStaticRenderer: () => boolean;
    isStaticRenderer: () => boolean;
    /** A host `Data` observable — a plain object is enough here. */
    Data: <T extends object>(value: T) => T;
    useObserveData: () => boolean;
    useLocaleInfo: () => {
        activeLocale: null;
        locales: never[];
        setLocale: () => void;
    };
    useRouter: () => {
        navigate: (path: string) => void;
    };
    addPropertyControls: () => void;
    ControlType: Record<string, string>;
    withCSS: <C>(Component: C) => C;
};
