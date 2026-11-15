import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '@babel/parser';
import { parseJSX, findFirstElementByDataId } from '@/code/parsing/ast-utils';
import { parseContainerRules } from '@/code/stores/container-query-store';
import { syncViewportWidths, getViewportWidths } from '@/code/stores/viewport-store';
import { updateContainerQueryStyle } from './generator-styles';
import { updateNodeInCode } from './generator-crud';
import { parseCanvasConfig, updateCanvasConfigInCode } from '@/code/project/canvas-config';
import {
  PAGE_FLOW_PROPERTY, pageFlowGates, pageFlowRefusal, pageFlowStragglers, parsePageFlow, setPageFlowInCode,
} from './page-flow-gen';

// Realistic page: desktop primary, three replica bands. Widths are the band tops.
const WIDTHS = { desktop: 1440, tablet: 1199, 'tablet-portrait': 999, mobile: 809 };
const CANVAS = {
  viewports: [
    { id: 'desktop', label: 'Desktop', width: 1440, isPrimary: true, order: 0, x: 0, y: 0 },
    { id: 'tablet', label: 'Tablet', width: 1199, designWidth: 1180, isPrimary: false, order: 1, x: 0, y: 0 },
    { id: 'tablet-portrait', label: 'Tablet portrait', width: 999, designWidth: 810, isPrimary: false, order: 2, x: 0, y: 0 },
    { id: 'mobile', label: 'Mobile', width: 809, designWidth: 390, isPrimary: false, order: 3, x: 0, y: 0 },
  ],
  positions: {},
};

const BASE_PAGE = `'use client';

/** @canvas ${JSON.stringify(CANVAS)} */

export default function Page() {
  return (
    <div data-id="root" style={{ position: 'relative', width: '100%', display: 'flex', flexDirection: 'column' }}>
      <header data-id="masthead">Masthead</header>
      <section data-id="hero" style={{ height: '80vh' }}>Hero</section>
    </div>
  );
}
`;

/** The fixture: BASE_PAGE plus one band override the page already had (root align-items at 809),
 *  written through updateContainerQueryStyle so the <style> block is in the generator's own format. */
function buildFixture(): string {
  syncViewportWidths(WIDTHS);
  return updateContainerQueryStyle(BASE_PAGE, 'root', 809, { alignItems: 'center' });
}

/** Independent reader: inline style values of a data-id element, as written in the source. */
function readInline(code: string, id: string): Record<string, string | null> {
  const ast = parseJSX(code);
  if (!ast) throw new Error('fixture does not parse');
  const out: Record<string, string | null> = {};
  findFirstElementByDataId(ast, id, (_path, el) => {
    const attr = el.openingElement.attributes.find(
      (a: any) => a.type === 'JSXAttribute' && a.name.name === 'style',
    ) as any;
    if (!attr) return;
    for (const prop of attr.value.expression.properties) {
      const key = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
      const v = prop.value;
      out[key] = v.type === 'StringLiteral' ? v.value : String(v.value);
    }
  });
  return out;
}

/** Independent reader: band overrides per breakpoint for one node, keyed by kebab property. */
function readBands(code: string, id: string): Record<number, Record<string, string>> {
  const block = /<style>\s*\{[`']([\s\S]*?)[`']\}\s*<\/style>/.exec(code);
  const rules = parseContainerRules(block ? block[1] : '');
  const out: Record<number, Record<string, string>> = {};
  for (const [width, nodes] of rules) {
    const props = nodes.get(id);
    if (props && props.size) out[width] = Object.fromEntries(props);
  }
  return out;
}

const TOUCHED_KEBAB = ['display', 'flex-direction', 'flex-wrap', 'align-items', 'overflow', 'overflow-x', '--revyme-page-flow', 'flex-shrink', 'height'];

describe('Page Flow — gates', () => {
  beforeEach(() => syncViewportWidths(WIDTHS));

  it('one gate per viewport, widest first; each band starts one px above the next smaller width', () => {
    expect(pageFlowGates(buildFixture())).toEqual([
      { from: 1200, viewportId: 'desktop', label: 'Desktop' },
      { from: 1000, viewportId: 'tablet', label: 'Tablet and up' },
      { from: 810, viewportId: 'tablet-portrait', label: 'Tablet portrait and up' },
      { from: 0, viewportId: 'mobile', label: 'Every width' },
    ]);
  });

  it('no @canvas block means no gates', () => {
    expect(pageFlowGates("'use client';\n\nexport default function Page() { return <div data-id=\"root\" />; }\n")).toEqual([]);
  });
});

describe('Page Flow — ON', () => {
  beforeEach(() => syncViewportWidths(WIDTHS));

  it('writes the horizontal values inline on the root and on each direct child, and the file parses as TSX', () => {
    const out = setPageFlowInCode(buildFixture(), 1000);
    expect(() => parse(out, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow();
    expect(readInline(out, 'root')).toMatchObject({
      position: 'relative', width: '100%',
      display: 'flex', flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'stretch',
      '--revyme-page-flow': 'horizontal',
    });
    expect(out).toContain(`'--revyme-page-flow': 'horizontal'`);
    expect(readInline(out, 'masthead')).toMatchObject({ flexShrink: '0', height: '100svh' });
    expect(readInline(out, 'hero')).toMatchObject({ flexShrink: '0', height: '100svh' });
  });

  it('bands at or above the gate hold no Page Flow values; bands below it carry the vertical values', () => {
    const out = setPageFlowInCode(buildFixture(), 1000);

    // Tablet band (1199, lower edge 1000 >= gate): horizontal applies inline, so nothing is overridden.
    for (const id of ['root', 'masthead', 'hero']) {
      const at1199 = readBands(out, id)[1199] ?? {};
      for (const k of TOUCHED_KEBAB) expect(at1199[k]).toBeUndefined();
    }

    // Tablet portrait (999) and mobile (809): vertical.
    expect(readBands(out, 'root')[999]).toEqual({
      display: 'flex', 'flex-direction': 'column', 'flex-wrap': 'nowrap', 'align-items': 'normal', overflow: 'visible', 'overflow-x': 'visible', '--revyme-page-flow': 'vertical',
    });
    expect(readBands(out, 'root')[809]).toEqual({
      display: 'flex', 'flex-direction': 'column', 'flex-wrap': 'nowrap', 'align-items': 'center', overflow: 'visible', 'overflow-x': 'visible', '--revyme-page-flow': 'vertical',
    });
    expect(readBands(out, 'hero')[999]).toEqual({ 'flex-shrink': '1', height: '80vh' });
    expect(readBands(out, 'hero')[809]).toEqual({ 'flex-shrink': '1', height: '80vh' });
    expect(readBands(out, 'masthead')[999]).toEqual({ 'flex-shrink': '1', height: 'auto' });
    expect(readBands(out, 'masthead')[809]).toEqual({ 'flex-shrink': '1', height: 'auto' });
  });

  it('the @pageFlow block sits after @canvas, keeps \'use client\' first, and holds the gate and the originals', () => {
    const out = setPageFlowInCode(buildFixture(), 1000);
    expect(out.startsWith("'use client';")).toBe(true);
    expect(out.indexOf('@pageFlow')).toBeGreaterThan(out.indexOf('@canvas'));
    const state = parsePageFlow(out);
    expect(state).not.toBeNull();
    expect(state!.from).toBe(1000);
    expect(state!.saved.root.inline).toMatchObject({
      display: 'flex', flexDirection: 'column', flexWrap: null, alignItems: null, '--revyme-page-flow': null,
    });
    expect(state!.saved.hero.inline).toEqual({ flexShrink: null, height: '80vh' });
    expect(state!.saved.masthead.inline).toEqual({ flexShrink: null, height: null });
    expect(state!.saved.root.bands['809']).toMatchObject({ alignItems: 'center', display: null });
    expect(state!.saved.root.bands['999']).toMatchObject({ alignItems: null, display: null });
    expect(state!.saved.root.bands['1199']).toMatchObject({ alignItems: null, display: null });
  });

  it('ON from 0 leaves no vertical overrides in any band', () => {
    const out = setPageFlowInCode(buildFixture(), 0);
    expect(parsePageFlow(out)!.from).toBe(0);
    for (const id of ['root', 'masthead', 'hero']) {
      for (const bandProps of Object.values(readBands(out, id))) {
        for (const k of TOUCHED_KEBAB) expect(bandProps[k]).toBeUndefined();
      }
    }
  });

  it('ON 1000 then ON 1200 equals ON 1200 applied to the original (no Page Flow values saved as originals)', () => {
    // The generators reformat the file on each write (see the OFF byte-identical note), so compare parsed state.
    const fixture = buildFixture();
    const twice = setPageFlowInCode(setPageFlowInCode(fixture, 1000), 1200);
    const once = setPageFlowInCode(fixture, 1200);
    expect(parsePageFlow(twice)).toEqual(parsePageFlow(once));
    for (const id of ['root', 'masthead', 'hero']) {
      expect(readInline(twice, id)).toEqual(readInline(once, id));
      expect(readBands(twice, id)).toEqual(readBands(once, id));
    }
    expect(parsePageFlow(twice)!.saved.root.bands['809']).toMatchObject({ alignItems: 'center' });
  });

  it('the global breakpoint list is the same after ON as before it, and is restored even when it differed', () => {
    const before = { ...getViewportWidths() };
    setPageFlowInCode(buildFixture(), 1000);
    expect(getViewportWidths()).toEqual(before);

    const fixture = buildFixture();
    syncViewportWidths({ desktop: 1440 });
    setPageFlowInCode(fixture, 1000);
    expect(getViewportWidths()).toEqual({ desktop: 1440 });
  });
});

describe('Page Flow — OFF', () => {
  beforeEach(() => syncViewportWidths(WIDTHS));

  it('restores the original inline and band styles and removes the block', () => {
    const fixture = buildFixture();
    const off = setPageFlowInCode(setPageFlowInCode(fixture, 1000), null);
    for (const id of ['root', 'masthead', 'hero']) {
      expect(readInline(off, id)).toEqual(readInline(fixture, id));
      expect(readBands(off, id)).toEqual(readBands(fixture, id));
    }
    expect(off).not.toContain('@pageFlow');
    expect(parsePageFlow(off)).toBeNull();
  });

  it('a page that never had Page Flow comes back with the same parsed styles (not byte-identical: the AST path reformats)', () => {
    const fixture = buildFixture();
    const off = setPageFlowInCode(setPageFlowInCode(fixture, 1000), null);
    for (const id of ['root', 'masthead', 'hero']) {
      expect(readInline(off, id)).toEqual(readInline(fixture, id));
      expect(readBands(off, id)).toEqual(readBands(fixture, id));
    }
  });

  it('OFF on a page without the block returns the code unchanged', () => {
    const fixture = buildFixture();
    expect(setPageFlowInCode(fixture, null)).toBe(fixture);
  });

  it('a malformed @pageFlow block parses to null, and OFF leaves the code unchanged', () => {
    const fixture = buildFixture();
    const broken = fixture.replace('export default', '/** @pageFlow {"from": 1000, "saved": } */\n\nexport default');
    expect(parsePageFlow(broken)).toBeNull();
    expect(setPageFlowInCode(broken, null)).toBe(broken);

    const wrongShape = fixture.replace('export default', '/** @pageFlow {"from": "1000"} */\n\nexport default');
    expect(parsePageFlow(wrongShape)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tiles: a horizontal tile's pages overflow to its right on the canvas, so ON stacks the tiles
// that read across in a column (each one device-height tall) and puts the ones that read down
// below them, side by side; OFF gives the page its own arrangement back.
// ---------------------------------------------------------------------------

describe('Page Flow — tile arrangement', () => {
  beforeEach(() => syncViewportWidths(WIDTHS));

  const sideBySide = () => {
    const code = buildFixture();
    const config = parseCanvasConfig(code)!;
    return code.replace(JSON.stringify(CANVAS), JSON.stringify({
      ...CANVAS,
      positions: { desktop: { x: 0, y: 0 }, tablet: { x: 1600, y: 0 }, 'tablet-portrait': { x: 2940, y: 0 }, mobile: { x: 3910, y: 0 } },
    })) || config;
  };

  it('ON stacks the horizontal tiles in a column at their device heights and puts the vertical ones below, side by side', () => {
    const code = sideBySide() as string;
    const on = setPageFlowInCode(code, 1000);
    const p = parseCanvasConfig(on)!.positions;
    // Desktop (1440 drawn → 900 tall) then tablet landscape (1180 drawn → 737.5 tall), one column.
    expect(p.desktop.x).toBe(p.tablet.x);
    expect(p.tablet.y).toBeGreaterThanOrEqual(p.desktop.y + 900);
    // The vertical tiles start below the last horizontal one, left to right.
    const bottom = p.tablet.y + 1180 * 0.625;
    expect(p['tablet-portrait'].y).toBeGreaterThanOrEqual(bottom);
    expect(p.mobile.y).toBe(p['tablet-portrait'].y);
    expect(p.mobile.x).toBeGreaterThanOrEqual(p['tablet-portrait'].x + 810);
  });

  it('OFF gives back the arrangement the page had', () => {
    const code = sideBySide() as string;
    const before = parseCanvasConfig(code)!.positions;
    const off = setPageFlowInCode(setPageFlowInCode(code, 1000), null);
    expect(parseCanvasConfig(off)!.positions).toEqual(before);
  });

  it('re-applying with another gate re-arranges from the page\'s own arrangement', () => {
    const code = sideBySide() as string;
    const twice = setPageFlowInCode(setPageFlowInCode(code, 1000), 1200);
    const once = setPageFlowInCode(code, 1200);
    expect(parseCanvasConfig(twice)!.positions).toEqual(parseCanvasConfig(once)!.positions);
    expect(parsePageFlow(twice)?.positions).toEqual(parseCanvasConfig(code)!.positions);
  });
});

// ---------------------------------------------------------------------------
// Review fixes: OFF keeps later edits, children added after ON, out-of-flow children,
// numeric originals, vanished breakpoints, guards, stragglers.
// ---------------------------------------------------------------------------

/** BASE_PAGE with `base`'s text replaced once; throws if the replacement does not apply. */
function withBase(from: string, to: string): string {
  const page = BASE_PAGE.replace(from, to);
  if (page === BASE_PAGE) throw new Error(`fixture edit did not apply: ${from}`);
  return page;
}

/** A fixture from `base`, with `extra` JSX appended to the root and the root's band override written. */
function fixtureFrom(base: string, extra = ''): string {
  syncViewportWidths(WIDTHS);
  const page = extra ? base.replace('    </div>\n  );', `${extra}\n    </div>\n  );`) : base;
  return updateContainerQueryStyle(page, 'root', 809, { alignItems: 'center' });
}

/** Adds JSX after the hero panel of a page that already carries Page Flow. */
function insertAfterHero(code: string, jsx: string): string {
  if (!code.includes('Hero</section>')) throw new Error('fixture has no hero text to insert after');
  return code.replace('Hero</section>', `Hero</section>\n      ${jsx}`);
}

describe('Page Flow — OFF keeps edits made after ON', () => {
  beforeEach(() => syncViewportWidths(WIDTHS));

  it('keeps the masthead 999 height, the hero inline height and the moved tile; restores every other value', () => {
    const fixture = buildFixture();
    const on = setPageFlowInCode(fixture, 1000);
    let edited = updateContainerQueryStyle(on, 'masthead', 999, { height: '300px' });
    edited = updateNodeInCode(edited, 'hero', { height: '50vh' });
    const config = parseCanvasConfig(edited)!;
    edited = updateCanvasConfigInCode(edited, { ...config, positions: { ...config.positions, mobile: { x: 4000, y: 300 } } });

    const off = setPageFlowInCode(edited, null);
    expect(readBands(off, 'masthead')).toEqual({ 999: { height: '300px' } });
    expect(readInline(off, 'hero')).toEqual({ height: '50vh' });
    expect(parseCanvasConfig(off)!.positions).toEqual(parseCanvasConfig(edited)!.positions);
    expect(readInline(off, 'root')).toEqual(readInline(fixture, 'root'));
    expect(readInline(off, 'masthead')).toEqual(readInline(fixture, 'masthead'));
    expect(readBands(off, 'root')).toEqual(readBands(fixture, 'root'));
    expect(readBands(off, 'hero')).toEqual(readBands(fixture, 'hero'));
    expect(off).not.toContain('@pageFlow');
  });
});

describe('Page Flow — children added after ON', () => {
  beforeEach(() => syncViewportWidths(WIDTHS));

  it('a duplicate made after ON has no saved originals after a gate change, and OFF clears its Page Flow values', () => {
    const on = setPageFlowInCode(buildFixture(), 1000);
    let dup = insertAfterHero(on, `<section data-id="dup" style={{ flexShrink: '0', height: '100svh' }}>Dup</section>`);
    dup = updateContainerQueryStyle(dup, 'dup', 999, { flexShrink: '1', height: 'auto' });
    dup = updateContainerQueryStyle(dup, 'dup', 809, { flexShrink: '1', height: 'auto' });

    const regated = setPageFlowInCode(dup, 1200);
    const state = parsePageFlow(regated)!;
    expect(state.saved.dup.inline).toEqual({ flexShrink: null, height: null });
    expect(state.saved.dup.bands['999']).toEqual({ flexShrink: null, height: null });
    expect(state.saved.dup.bands['809']).toEqual({ flexShrink: null, height: null });

    const off = setPageFlowInCode(dup, null);
    expect(readInline(off, 'dup')).toEqual({});
    expect(readBands(off, 'dup')).toEqual({});
  });
});

describe('Page Flow — out-of-flow children', () => {
  beforeEach(() => syncViewportWidths(WIDTHS));

  it('fixed, absolute and display:none children are not panels: ON neither saves nor writes them', () => {
    const extra = `<div data-id="toast" style={{ position: 'fixed', bottom: 0 }}>Toast</div>
      <div data-id="pin" style={{ position: 'absolute', top: 0 }}>Pin</div>
      <div data-id="gone" style={{ display: 'none' }}>Gone</div>`;
    const fixture = fixtureFrom(BASE_PAGE, extra);
    const on = setPageFlowInCode(fixture, 1000);
    expect(Object.keys(parsePageFlow(on)!.saved).sort()).toEqual(['hero', 'masthead', 'root']);
    for (const id of ['toast', 'pin', 'gone']) {
      expect(readInline(on, id)).toEqual(readInline(fixture, id));
      expect(readBands(on, id)).toEqual({});
    }
  });
});

describe('Page Flow — numeric originals', () => {
  beforeEach(() => syncViewportWidths(WIDTHS));

  it('a numeric literal original is saved as a CSS value and restores as one', () => {
    const fixture = fixtureFrom(withBase("style={{ height: '80vh' }}", 'style={{ height: 600, flexShrink: 1 }}'));
    const on = setPageFlowInCode(fixture, 1000);
    expect(parsePageFlow(on)!.saved.hero.inline).toEqual({ flexShrink: '1', height: '600px' });
    const off = setPageFlowInCode(on, null);
    expect(readInline(off, 'hero')).toEqual({ height: '600px', flexShrink: '1' });
    expect(() => parse(off, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow();
  });
});

describe('Page Flow — breakpoints changed between ON and OFF', () => {
  beforeEach(() => syncViewportWidths(WIDTHS));

  it('OFF writes no band for a width the @canvas no longer has', () => {
    const fixture = updateContainerQueryStyle(buildFixture(), 'hero', 1199, { flexShrink: '3' });
    const on = setPageFlowInCode(fixture, 1000);
    expect(parsePageFlow(on)!.saved.hero.bands['1199']).toEqual({ flexShrink: '3', height: null });
    const config = parseCanvasConfig(on)!;
    const moved = updateCanvasConfigInCode(on, {
      ...config,
      viewports: config.viewports.map((v) => (v.id === 'tablet' ? { ...v, width: 1100 } : v)),
    });
    const off = setPageFlowInCode(moved, null);
    expect(off).not.toMatch(/max-width: 1199px/);
    expect(readBands(off, 'hero')[1199]).toBeUndefined();
  });
});

describe('Page Flow — guards and refusals', () => {
  beforeEach(() => syncViewportWidths(WIDTHS));

  it('a component file (variantConfig) is refused: ON and OFF return the code unchanged', () => {
    const component = buildFixture().replace('export default', 'const variantConfig = { rootId: "root" };\n\nexport default');
    expect(pageFlowRefusal(component)).not.toBeNull();
    expect(setPageFlowInCode(component, 1000)).toBe(component);
    expect(setPageFlowInCode(component, null)).toBe(component);
  });

  it('a page without a @canvas block is refused: ON and OFF return the code unchanged', () => {
    const bare = BASE_PAGE.replace(/\/\*\* @canvas[\s\S]*?\*\/\n\n/, '');
    expect(bare).not.toContain('@canvas');
    expect(pageFlowRefusal(bare)).not.toBeNull();
    expect(setPageFlowInCode(bare, 1000)).toBe(bare);
    expect(setPageFlowInCode(bare, null)).toBe(bare);
  });

  it('an opaque inline value on a touched prop is refused, and the reason names the node', () => {
    const page = fixtureFrom(withBase("style={{ height: '80vh' }}", 'style={{ height: heroHeight }}'));
    expect(pageFlowRefusal(page)).toMatch(/hero/);
    expect(setPageFlowInCode(page, 1000)).toBe(page);
  });

  it('a malformed @pageFlow block and a missing root are refused', () => {
    const fixture = buildFixture();
    const broken = fixture.replace('export default', '/** @pageFlow {"from": 1000, "saved": } */\n\nexport default');
    expect(pageFlowRefusal(broken)).toMatch(/@pageFlow/);
    const noRoot = fixture.replace('data-id="root"', 'data-id="main"');
    expect(pageFlowRefusal(noRoot)).toMatch(/root/);
    expect(setPageFlowInCode(noRoot, 1000)).toBe(noRoot);
  });
});

describe('Page Flow — stragglers', () => {
  beforeEach(() => syncViewportWidths(WIDTHS));

  it('no stragglers when Page Flow is off or freshly applied', () => {
    expect(pageFlowStragglers(buildFixture())).toEqual({ children: [], bands: [] });
    expect(pageFlowStragglers(setPageFlowInCode(buildFixture(), 1000))).toEqual({ children: [], bands: [] });
  });

  it('reports a section added after ON and a breakpoint added after ON', () => {
    const on = setPageFlowInCode(buildFixture(), 1000);
    const late = insertAfterHero(on, '<div data-id="late">Late</div>');
    const config = parseCanvasConfig(late)!;
    const withPhone = updateCanvasConfigInCode(late, {
      ...config,
      viewports: [...config.viewports, { id: 'phone', label: 'Phone', width: 700, isPrimary: false, order: 4, x: 0, y: 0 }],
    });
    expect(pageFlowStragglers(withPhone)).toEqual({ children: ['late'], bands: [700] });
  });
});

// A page the editor scaffolds has `overflowX: 'clip'` on its root (page-root-shell), which would cut
// the panels off at the window's right edge: Page Flow takes that property over too.
describe('Page Flow — root overflow', () => {
  beforeEach(() => syncViewportWidths(WIDTHS));

  it('ON makes a clipping root visible inline and keeps its own clip below the gate; OFF gives it back', () => {
    const code = buildFixture().replace(
      `style={{ position: 'relative', width: '100%', display: 'flex', flexDirection: 'column' }}`,
      `style={{ position: 'relative', width: '100%', display: 'flex', flexDirection: 'column', overflowX: 'clip' }}`,
    );
    const on = setPageFlowInCode(code, 1000);
    expect(readInline(on, 'root').overflowX).toBe('visible');
    const css = (on.match(/<style>\{`([\s\S]*?)`\}<\/style>/) ?? [])[1] ?? '';
    const at999 = css.slice(css.indexOf('(max-width: 999px)'));
    expect(at999.slice(0, at999.indexOf('}'))).toContain('overflow-x: clip');
    const off = setPageFlowInCode(on, null);
    expect(readInline(off, 'root').overflowX).toBe('clip');
  });
});

// A root clipped with the `overflow` shorthand: adding `overflow-x: visible` beside `overflow-y:
// hidden` computes to `auto`, which makes the root a scroll container instead of letting the
// document scroll sideways (review finding). Page Flow takes the shorthand over too.
describe('Page Flow — root overflow shorthand', () => {
  beforeEach(() => syncViewportWidths(WIDTHS));

  it('ON makes a root clipped with `overflow: hidden` visible inline, keeps `hidden` below the gate, and OFF gives it back', () => {
    const code = buildFixture().replace(
      `style={{ position: 'relative', width: '100%', display: 'flex', flexDirection: 'column' }}`,
      `style={{ position: 'relative', width: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}`,
    );
    const on = setPageFlowInCode(code, 1000);
    expect(readInline(on, 'root').overflow).toBe('visible');
    expect(readInline(on, 'root').overflowX).toBe('visible');
    expect(readBands(on, 'root')[999]?.overflow).toBe('hidden');
    const off = setPageFlowInCode(on, null);
    expect(readInline(off, 'root').overflow).toBe('hidden');
  });
});
