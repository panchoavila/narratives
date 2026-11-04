// variant-ssr-copies.ts — every breakpoint's variant, in the HTML the server sends.
//
// The pre-hydration stylesheet (variant-prestyle.ts) can restyle and hide what
// the server rendered, but it cannot CREATE what it didn't: an element gated by
// `{initialVariant === 'variant-2' && …}` is false on the server, so a phone's
// burger menu is simply absent until React hydrates. Styles stopped flashing;
// structure still did.
//
// So render the component once per distinct variant and let CSS pick — Framer's
// approach, which is why their sites never flash. Two differences from theirs:
//
//   - the copies exist only in the RENDER, never in the source. One component in
//     ProjectFS, one row in the layers panel, no publish transform.
//   - the CLIENT renders the same copies on its first pass, so hydration sees an
//     identical tree — no structural mismatch, no recovery re-render. An effect
//     then collapses to the matched copy, and the rest unmount.
//
// The wrappers are `display: contents`, so they add no box; the whole mechanism
// is invisible to layout.

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
export function planVariantCopies(
  variantByBreakpoint: Record<number, string>,
  baseVariant: string,
  instanceId: string,
): VariantCopy[] {
  const bps = Object.keys(variantByBreakpoint).map(Number).filter((n) => n > 0).sort((a, b) => a - b);
  if (!bps.length) return [];
  // Widest first: the base design, then each breakpoint descending.
  const ordered: { variant: string; maxWidth: number | null; minWidth: number | null }[] = [];
  ordered.push({ variant: baseVariant, maxWidth: null, minWidth: bps[bps.length - 1] });
  for (let i = bps.length - 1; i >= 0; i--) {
    ordered.push({ variant: variantByBreakpoint[bps[i]], maxWidth: bps[i], minWidth: i > 0 ? bps[i - 1] : null });
  }
  // Collapse neighbours that render the SAME variant into one copy spanning both.
  const merged: VariantCopy[] = [];
  for (const band of ordered) {
    const prev = merged[merged.length - 1];
    if (prev && prev.variant === band.variant) {
      prev.minWidth = band.minWidth;      // widen downward
      continue;
    }
    merged.push({ ...band, className: '' });
  }
  if (merged.length < 2) return [];       // one design everywhere — nothing to pick between
  merged.forEach((c, i) => { c.className = `rv-v${i}-${safe(instanceId)}`; });
  return merged;
}

/** Hide every copy outside its own band. No rule for a copy that spans everything. */
export function copiesCss(copies: VariantCopy[]): string {
  const out: string[] = [];
  for (const c of copies) {
    // Narrower than this copy's band.
    if (c.minWidth !== null) out.push(`@media (max-width: ${c.minWidth}px) { .${c.className} { display: none !important } }`);
    // Wider than it.
    if (c.maxWidth !== null) out.push(`@media (min-width: ${c.maxWidth + 0.02}px) { .${c.className} { display: none !important } }`);
  }
  return out.join('\n');
}

/** A class-safe form of the instance id. */
function safe(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '_');
}
