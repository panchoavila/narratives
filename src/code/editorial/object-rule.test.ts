// object-rule.test.ts — an object's own rule (`MediaObjectBlock.rule`), merged over its role's rule.
//
// Written before the engine reads the field. Free-form elements joining a flow through the editor
// (`data-flow`) carry their placement this way; it must be honoured, merged shallowly, sanitised
// like any rule, and never cost text.

import { describe, it, expect, beforeAll } from 'vitest';
import { layoutFlow, type FlowBlock, type FlowDocument, type PlacedObject } from '../../../packages/revyme-runtime-scene/src/editorial';
import { installStubCanvas } from './stub-canvas';
import { baseSpec, env, words, expectAllInvariants, expectRound5Invariants, findObject } from './fixtures';

const TIMEOUT = 5000;

function body(count: number): FlowBlock[] {
  return Array.from({ length: count }, (_, i) => ({
    kind: 'paragraph' as const,
    id: `p${i + 1}`,
    role: 'body' as const,
    runs: [{ text: words(70, i % 2 ? 'bbbb' : 'aaaa') }],
  }));
}

/** Four body paragraphs, then the object, then four more: the object is anchored after ¶4. */
function docWith(object: FlowBlock): FlowDocument {
  const paragraphs = body(8);
  return { blocks: [...paragraphs.slice(0, 4), object, ...paragraphs.slice(4)] };
}

function placed(doc: FlowDocument, width = 1440, height = 900): { object: PlacedObject; layout: ReturnType<typeof layoutFlow> } {
  const spec = baseSpec();
  const layout = layoutFlow(doc, spec, env(width, height, 'paged-x'));
  const object = findObject(layout, 'slot');
  if (object === undefined) throw new Error('the object was not placed');
  expectAllInvariants(doc, layout, spec);
  expectRound5Invariants(doc, layout, spec);
  return { object, layout };
}

describe('an object\'s own rule', () => {
  beforeAll(() => installStubCanvas());

  it('without a rule of its own, follows its role: media is set in the flow, two columns wide', () => {
    const { object, layout } = placed(docWith({ kind: 'media-object', id: 'slot', role: 'media', aspect: 1.5 }));
    const columnWidth = layout.body.columnWidth;
    expect(object.rect.width).toBeGreaterThan(columnWidth * 1.5);
  }, TIMEOUT);

  it('takes its own placement: the last column, at the top of the page, one column wide', () => {
    const { object, layout } = placed(docWith({
      kind: 'media-object',
      id: 'slot',
      role: 'media',
      aspect: 1.5,
      rule: { place: { column: -1, span: 1, vertical: 'top', clearance: 1 } },
    }));
    const page = layout.pages[object.page];
    const last = page.frames[page.frames.length - 1];
    expect(object.rect.x).toBe(last.x);
    expect(object.rect.width).toBe(last.width);
    expect(object.rect.y).toBe(last.y);
  }, TIMEOUT);

  it('replaces only what it gives: its own height, its role\'s placement', () => {
    const { object, layout } = placed(docWith({
      kind: 'media-object',
      id: 'slot',
      role: 'media',
      rule: { height: { kind: 'lines', lines: 5 } },
    }));
    expect(object.rect.height).toBe(5 * layout.body.lineHeight);
    expect(object.rect.width).toBeGreaterThan(layout.body.columnWidth * 1.5);
  }, TIMEOUT);

  it('is sanitised like any rule: hostile values never reach the result', () => {
    const { object } = placed(docWith({
      kind: 'media-object',
      id: 'slot',
      role: 'media',
      rule: {
        place: { column: Number.NaN, span: Number.POSITIVE_INFINITY, vertical: 'top', clearance: -40, inset: { side: 'end', fraction: Number.NaN } },
        height: { kind: 'lines', lines: Number.NaN },
        maxHeight: Number.POSITIVE_INFINITY,
      },
    }));
    for (const value of [object.rect.x, object.rect.y, object.rect.width, object.rect.height]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(object.rect.width).toBeGreaterThan(0);
    expect(object.rect.height).toBeGreaterThan(0);
  }, TIMEOUT);

  it('applies at every reference viewport without losing text or overlapping lines', () => {
    const doc = docWith({
      kind: 'media-object',
      id: 'slot',
      role: 'aside',
      aspect: 0.8,
      rule: { place: { column: 0, span: 1, vertical: 'bottom', clearance: 1, inset: { side: 'start', fraction: 0.8 } }, maxHeight: 0.5 },
    });
    for (const [w, h] of [[1440, 900], [1180, 820], [820, 1180], [390, 844]]) {
      const spec = baseSpec();
      const layout = layoutFlow(doc, spec, env(w, h, w >= 1000 ? 'paged-x' : 'paged-y'));
      expectAllInvariants(doc, layout, spec);
      expectRound5Invariants(doc, layout, spec);
      expect(findObject(layout, 'slot')).toBeDefined();
    }
  }, TIMEOUT);
});
