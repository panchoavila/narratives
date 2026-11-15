// responsive.test.ts — band overrides a canvas tile applies inline to a node.
//
// Written before the fix: a custom property in a band (`--revyme-page-flow: vertical`, written by
// Page Flow for the bands below its gate) must reach the tile under its own name. Camel-casing it
// gave `-RevymePageFlow`, an expando the element ignores, so a vertical tile kept the root's inline
// `horizontal` whenever the band's container query was off (a viewport-width drag pins them).

import { describe, it, expect, beforeEach } from 'vitest';
import { getResponsiveOverridesForNode, setResponsiveBreakpoints } from './responsive';

describe('canvas band overrides', () => {
  beforeEach(() => {
    setResponsiveBreakpoints([
      { maxWidth: 999, minWidth: 809.02, nodes: new Map([['root', new Map([['flex-direction', 'column'], ['--revyme-page-flow', 'vertical']])]]) },
      { maxWidth: 809, minWidth: 0, nodes: new Map([['root', new Map([['--revyme-page-flow', 'vertical'], ['align-items', 'center']])]]) },
    ] as never);
  });

  it('keeps a custom property under its own name, and camel-cases ordinary properties', () => {
    const at810 = getResponsiveOverridesForNode('root', 810);
    expect(at810['--revyme-page-flow']).toBe('vertical');
    expect(at810.flexDirection).toBe('column');
    expect(Object.keys(at810).some((k) => k.startsWith('-R'))).toBe(false);
  });

  it('the smallest band (max-width only) is read too', () => {
    const at390 = getResponsiveOverridesForNode('root', 390);
    expect(at390['--revyme-page-flow']).toBe('vertical');
    expect(at390.alignItems).toBe('center');
  });

  it('a tile above every band gets no overrides', () => {
    expect(getResponsiveOverridesForNode('root', 1440)).toEqual({});
  });
});
