/** A copy to render: the variant, and the band it is the answer for. */
export interface VariantCopy {
    variant: string;
    /** Upper bound of its band in px, or null for the base (widest) design. */
    maxWidth: number | null;
    /** Lower bound, exclusive — the next narrower breakpoint. */
    minWidth: number | null;
    className: string;
}
/**
 * One copy per DISTINCT variant across the breakpoints, widest first.
 *
 * Bands that render the same variant share a copy — three breakpoints with two
 * designs means two copies, not three (exactly what Framer ships: the services
 * page's tablet and phone share one).
 */
export declare function planVariantCopies(variantByBreakpoint: Record<number, string>, baseVariant: string, instanceId: string): VariantCopy[];
/** Hide every copy outside its own band. No rule for a copy that spans everything. */
export declare function copiesCss(copies: VariantCopy[]): string;
